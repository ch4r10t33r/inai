"""
HermesPlugin — Inai adapter for Nous Research Hermes agents.

Hermes is a full autonomous agent (built-in toolsets: web, browser, terminal, …).
It does not expose arbitrary Python @tools like CrewAI; instead each Inai
*capability* you advertise becomes a labeled channel that forwards to the same
`AIAgent.chat()` / `run_conversation()` entrypoint.

Install (from upstream — not always on PyPI):
    pip install git+https://github.com/NousResearch/hermes-agent.git

Environment: set `OPENROUTER_API_KEY` and/or `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`
per Hermes docs. Use `quiet_mode=True` on `AIAgent` when embedding.

Docs: https://hermes-agent.nousresearch.com/docs/guides/python-library
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from typing import Any, List, Optional

from plugins.base import (
    InaiPlugin,
    PluginConfig,
    CapabilityDescriptor,
    WrappedAgent,
)
from interfaces.agent_request import AgentRequest
from interfaces.agent_response import AgentResponse

# ── Optional Hermes import (git install) ──────────────────────────────────────

try:
    from run_agent import AIAgent as HermesAIAgent

    _HERMES_OK = True
except ImportError:
    _HERMES_OK = False
    HermesAIAgent = Any  # type: ignore[assignment,misc]


# ── Plugin config ─────────────────────────────────────────────────────────────


@dataclass
class HermesPluginConfig(PluginConfig):
    """
    Inai-side settings for a Hermes `AIAgent`.

    `mesh_capabilities` lists the capability names published on the mesh (e.g.
    echo, research). Each maps to the same Hermes runtime; the capability name
    is prefixed into the user message unless disabled.
    """

    mesh_capabilities: List[str] = field(default_factory=lambda: ["chat"])
    """Capability names advertised via discovery (default: a single `chat`)."""

    use_run_conversation: bool = False
    """If True, always use `run_conversation` instead of `chat()`."""

    prefix_capability_in_message: bool = True
    """Prefix requests with `[Inai capability: …]` so Hermes can specialize."""

    default_task_id: Optional[str] = None
    """Optional fixed task_id for `run_conversation`; otherwise a UUID per call."""


# ── Plugin ────────────────────────────────────────────────────────────────────


class HermesPlugin(InaiPlugin):
    """Bridge Inai `AgentRequest` ↔ Hermes `AIAgent.chat` / `run_conversation`."""

    def __init__(self, config: HermesPluginConfig):
        if not _HERMES_OK:
            raise ImportError(
                "Hermes agent is not installed — run:\n"
                "  pip install git+https://github.com/NousResearch/hermes-agent.git"
            )
        super().__init__(config)
        self._cfg: HermesPluginConfig = config
        if not self._cfg.mesh_capabilities:
            self._cfg.mesh_capabilities = ["chat"]

    def extract_capabilities(self, agent: HermesAIAgent) -> List[CapabilityDescriptor]:
        del agent  # Hermes tools are internal; we only advertise configured names.
        return [
            CapabilityDescriptor(
                name=c,
                description=(
                    f"Hermes (Nous Research) agent — capability `{c}`. "
                    "Send message/task in payload keys: message, task, query, or input."
                ),
                native_name=c,
            )
            for c in self._cfg.mesh_capabilities
        ]

    def translate_request(
        self,
        req: AgentRequest,
        descriptor: CapabilityDescriptor,
    ) -> dict[str, Any]:
        pl = req.payload
        body = (
            pl.get("message")
            or pl.get("task")
            or pl.get("query")
            or pl.get("input")
            or str(pl)
        )
        if self._cfg.prefix_capability_in_message:
            user_message = f"[Inai capability: {descriptor.name}]\n{body}"
        else:
            user_message = str(body)

        use_rc = bool(
            pl.get("run_conversation")
            or pl.get("use_run_conversation")
            or self._cfg.use_run_conversation
        )
        return {
            "user_message": user_message,
            "use_run_conversation": use_rc,
            "task_id": pl.get("task_id"),
            "system_message": pl.get("system_message"),
            "conversation_history": pl.get("conversation_history"),
        }

    async def invoke_native(
        self,
        agent: HermesAIAgent,
        descriptor: CapabilityDescriptor,
        native_input: dict[str, Any],
    ) -> Any:
        del descriptor
        loop = asyncio.get_event_loop()

        if native_input.get("use_run_conversation"):

            def _run_conv() -> Any:
                tid = (
                    native_input.get("task_id")
                    or self._cfg.default_task_id
                    or str(uuid.uuid4())
                )
                kw: dict[str, Any] = {
                    "user_message": native_input["user_message"],
                    "task_id": tid,
                }
                if native_input.get("system_message"):
                    kw["system_message"] = native_input["system_message"]
                if native_input.get("conversation_history") is not None:
                    kw["conversation_history"] = native_input["conversation_history"]
                return agent.run_conversation(**kw)

            return await loop.run_in_executor(None, _run_conv)

        return await loop.run_in_executor(
            None,
            lambda: agent.chat(native_input["user_message"]),
        )

    def translate_response(self, native_result: Any, request_id: str) -> AgentResponse:
        if isinstance(native_result, dict) and "final_response" in native_result:
            return AgentResponse.success(
                request_id,
                {
                    "content": native_result["final_response"],
                    "messages_count": len(native_result.get("messages", [])),
                    "task_id": native_result.get("task_id"),
                },
            )
        return AgentResponse.success(request_id, {"content": str(native_result)})


# ── Convenience wrapper ───────────────────────────────────────────────────────


def wrap_hermes(
    agent: HermesAIAgent,
    name: str,
    agent_id: str,
    owner: str,
    tags: Optional[List[str]] = None,
    mesh_capabilities: Optional[List[str]] = None,
    use_run_conversation: bool = False,
    prefix_capability_in_message: bool = True,
    **kwargs: Any,
) -> WrappedAgent:
    """
    Wrap a Hermes `AIAgent` for the Inai mesh.

    Args:
        agent: Configured `AIAgent` (typically `quiet_mode=True`).
        name: Display name for discovery.
        agent_id: Unique URI, e.g. `inai://agent/hermes`.
        owner: Owner wallet or id.
        tags: Extra discovery tags.
        mesh_capabilities: Capability names to advertise (default: `["chat"]`).
        use_run_conversation: Default to `run_conversation` instead of `chat()`.
        prefix_capability_in_message: Prefix with capability label for routing context.
        **kwargs: Forwarded to `HermesPluginConfig` / `PluginConfig` where recognized.

    Example::

        from run_agent import AIAgent
        from plugins.hermes_plugin import wrap_hermes

        _agent = AIAgent(
            model="openai/gpt-4o-mini",
            quiet_mode=True,
            skip_memory=True,
            skip_context_files=True,
        )

        hermes_mesh = wrap_hermes(
            agent=_agent,
            name="HermesAgent",
            agent_id="inai://agent/hermes",
            owner="0xYourWallet",
            tags=["hermes", "nous"],
            mesh_capabilities=["research", "summarize"],
        )
    """
    known = (
        "version",
        "description",
        "metadata_uri",
        "host",
        "port",
        "protocol",
        "tls",
        "discovery_type",
        "discovery_url",
        "discovery_key",
        "signing_key",
        "identity_mode",
        "timeout_ms",
        "capability_map",
        "default_task_id",
    )
    extra = {k: v for k, v in kwargs.items() if k in known}
    caps = mesh_capabilities if mesh_capabilities else ["chat"]
    cfg = HermesPluginConfig(
        name=name,
        agent_id=agent_id,
        owner=owner,
        tags=tags or [],
        mesh_capabilities=caps,
        use_run_conversation=use_run_conversation,
        prefix_capability_in_message=prefix_capability_in_message,
        **extra,
    )
    return HermesPlugin(cfg).wrap(agent)
