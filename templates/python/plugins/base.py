"""
Sentrix Plugin Base
──────────────────────────────────────────────────────────────────────────────
Defines the plugin contract that every framework adapter must implement.

A plugin wraps a framework-native agent object and produces an IAgent-compliant
instance that can be registered, discovered, and called through Sentrix.

Lifecycle:
  1.  plugin = LangGraphPlugin(config)   # or GoogleADKPlugin, etc.
  2.  agent  = plugin.wrap(my_agent)     # returns IAgent
  3.  await  agent.register_discovery()  # appears on the mesh
  4.         agent.handle_request(req)   # receives Sentrix calls

Plugin responsibilities:
  - extract_capabilities()   map framework tools → Sentrix capability names
  - translate_request()      AgentRequest  → framework-native invocation args
  - translate_response()     framework result → AgentResponse
  - build_anr()              produce a signed ANR for the wrapped agent
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Generic, Optional, TypeVar

from interfaces import IAgent, AgentRequest, AgentResponse
from interfaces.iagent_discovery import DiscoveryEntry, NetworkInfo, HealthStatus
from identity.provider import _b58encode
from datetime import datetime, timezone

TAgent = TypeVar("TAgent")   # framework-native agent type


# ── plugin config ─────────────────────────────────────────────────────────────

@dataclass
class PluginConfig:
    """Configuration shared by all framework plugins."""

    # ── Identity ──────────────────────────────────────────────────────────────
    # Use identity_from_config() or an IdentityProvider to populate these.
    # ERC-8004 on-chain registration is optional — a local key is enough.
    #
    #   from identity.provider import LocalKeystoreIdentity
    #   identity = LocalKeystoreIdentity("my-agent")
    #   config   = PluginConfig(**identity.to_plugin_config_fields(), port=8080)

    agent_id:     str          = "sentrix://agent/unnamed"
    owner:        str          = "anonymous"  # wallet address or any identifier
    name:         str          = "UnnamedAgent"
    version:      str          = "0.1.0"
    description:  str          = ""
    tags:         list[str]    = field(default_factory=list)
    metadata_uri: Optional[str] = None

    # Identity mode (informational — used by identity helpers)
    # "anonymous" | "local" | "env" | "raw" | "erc8004"
    identity_mode: str = "local"

    # ANR signing — 32-byte hex private key (None = unsigned / dev mode)
    # Populated automatically by IdentityProvider.to_plugin_config_fields()
    signing_key: Optional[str] = None

    # ── Network (where this agent listens) ────────────────────────────────────
    host:         str  = "localhost"
    port:         int  = 8080
    protocol:     str  = "http"
    tls:          bool = False

    # ── Discovery ─────────────────────────────────────────────────────────────
    discovery_type: str           = "local"   # "local" | "http" | "libp2p"
    discovery_url:  Optional[str] = None
    discovery_key:  Optional[str] = None

    # ── x402 Payments (optional add-on) ───────────────────────────────────────
    # Map of capability name → CapabilityPricing.
    # Capabilities not listed are served free of charge.
    # Import: from addons.x402.types import CapabilityPricing
    #
    #   x402_pricing = {
    #       "premium_search": CapabilityPricing.usdc_base(50, "0xMyWallet"),
    #   }
    x402_pricing: dict = field(default_factory=dict)

    # ── Request / response ────────────────────────────────────────────────────
    timeout_ms:     int = 30_000
    capability_map: dict[str, str] = field(default_factory=dict)
    """Optional override: { "meshAiCapName": "frameworkToolName" }"""


# ── capability descriptor ─────────────────────────────────────────────────────

@dataclass
class CapabilityDescriptor:
    """Describes a single capability extracted from a framework agent."""
    name:          str
    description:   str
    input_schema:  Optional[dict] = None
    output_schema: Optional[dict] = None
    tags:          list[str] = field(default_factory=list)
    # The native tool/function name inside the framework
    native_name:   str = ""


# ── plugin base class ─────────────────────────────────────────────────────────

class SentrixPlugin(ABC, Generic[TAgent]):
    """
    Abstract base for all Sentrix framework adapters.

    Subclass this to integrate a new agent framework.
    Only four methods are mandatory:
      - extract_capabilities()
      - translate_request()
      - translate_response()
      - invoke_native()
    """

    def __init__(self, config: PluginConfig):
        self.config = config

    # ── mandatory ─────────────────────────────────────────────────────────────

    @abstractmethod
    def extract_capabilities(self, agent: TAgent) -> list[CapabilityDescriptor]:
        """
        Inspect the framework-native agent and return its capabilities
        as a list of CapabilityDescriptor objects.
        """
        ...

    @abstractmethod
    def translate_request(
        self,
        req: AgentRequest,
        descriptor: CapabilityDescriptor,
    ) -> Any:
        """
        Convert a Sentrix AgentRequest into whatever the framework expects
        as its invocation input (e.g. a dict, a Pydantic model, etc.).
        """
        ...

    @abstractmethod
    def translate_response(self, native_result: Any, request_id: str) -> AgentResponse:
        """
        Convert the framework's native result into a Sentrix AgentResponse.
        """
        ...

    @abstractmethod
    async def invoke_native(
        self,
        agent: TAgent,
        capability: CapabilityDescriptor,
        native_input: Any,
    ) -> Any:
        """
        Actually call the framework agent with the translated input
        and return the raw framework output.
        """
        ...

    # ── optional overrides ────────────────────────────────────────────────────

    def validate_request(self, req: AgentRequest, descriptor: CapabilityDescriptor) -> Optional[str]:
        """
        Return an error string if the request is invalid, or None if OK.
        Override to add JSON-schema validation, auth checks, etc.
        """
        return None

    def on_error(self, req: AgentRequest, exc: Exception) -> AgentResponse:
        """Default error handler — override for custom error mapping."""
        return AgentResponse.error(req.request_id, f"[{type(exc).__name__}] {exc}")

    # ── wrap ──────────────────────────────────────────────────────────────────

    def wrap(self, agent: TAgent) -> "WrappedAgent[TAgent]":
        """
        Wrap a framework-native agent in a Sentrix-compatible IAgent.
        This is the main entrypoint for plugin consumers.

        Usage:
          plugin  = LangGraphPlugin(config)
          iagent  = plugin.wrap(my_langgraph_graph)
          await iagent.register_discovery()
        """
        caps = self.extract_capabilities(agent)
        return WrappedAgent(agent=agent, plugin=self, capabilities=caps, config=self.config)

    # ── ANR builder helper ────────────────────────────────────────────────────

    def build_anr_text(self, caps: list[CapabilityDescriptor]) -> Optional[str]:
        """
        Produce a signed ANR text string for this agent.
        Returns None if no signing_key is configured (dev mode).
        """
        if not self.config.signing_key:
            return None
        try:
            from anr.anr import AnrBuilder
            import socket, struct
            priv = bytes.fromhex(self.config.signing_key)
            cap_names = [c.name for c in caps]
            builder = (
                AnrBuilder()
                .seq(1)
                .agent_id(self.config.agent_id)
                .name(self.config.name)
                .version(self.config.version)
                .capabilities(cap_names)
                .tags(self.config.tags)
                .proto(self.config.protocol)
                .agent_port(self.config.port)
                .tls(self.config.tls)
            )
            if self.config.metadata_uri:
                builder = builder.meta_uri(self.config.metadata_uri)
            try:
                ip_int = struct.unpack("!I", socket.inet_aton(self.config.host))[0]
                builder = builder.ipv4(ip_int.to_bytes(4, 'big'))
            except OSError:
                pass
            return builder.sign(priv).encode_text()
        except Exception as e:
            import warnings
            warnings.warn(f"ANR signing failed: {e}")
            return None


# ── wrapped agent ─────────────────────────────────────────────────────────────

class WrappedAgent(IAgent, Generic[TAgent]):
    """
    An IAgent produced by SentrixPlugin.wrap().
    Dispatches incoming Sentrix requests to the framework-native agent
    via the plugin's translation layer.
    """

    def __init__(
        self,
        agent:        TAgent,
        plugin:       SentrixPlugin,
        capabilities: list[CapabilityDescriptor],
        config:       PluginConfig,
    ):
        self._agent  = agent
        self._plugin = plugin
        self._caps   = {c.name: c for c in capabilities}
        self.config  = config

        # IAgent identity
        self.agent_id     = config.agent_id
        self.owner        = config.owner
        self.metadata_uri = config.metadata_uri
        self.metadata     = {
            "name":        config.name,
            "version":     config.version,
            "description": config.description,
            "tags":        config.tags,
        }

    def get_capabilities(self) -> list[str]:
        return list(self._caps.keys())

    async def handle_request(self, req: AgentRequest) -> AgentResponse:
        descriptor = self._caps.get(req.capability)
        if not descriptor:
            return AgentResponse.error(
                req.request_id,
                f'Unknown capability: "{req.capability}". '
                f'Available: {", ".join(self._caps)}'
            )

        # Validate
        err = self._plugin.validate_request(req, descriptor)
        if err:
            return AgentResponse.error(req.request_id, err)

        try:
            native_input  = self._plugin.translate_request(req, descriptor)
            native_result = await self._plugin.invoke_native(self._agent, descriptor, native_input)
            return self._plugin.translate_response(native_result, req.request_id)
        except Exception as exc:
            return self._plugin.on_error(req, exc)

    async def register_discovery(self) -> None:
        from discovery.http_discovery import DiscoveryFactory
        registry = DiscoveryFactory.create(
            discovery_type=self.config.discovery_type,
            http_base_url=self.config.discovery_url,
            api_key=self.config.discovery_key,
        )
        await registry.register(DiscoveryEntry(
            agent_id=self.agent_id,
            name=self.config.name,
            owner=self.config.owner,
            capabilities=self.get_capabilities(),
            network=NetworkInfo(
                protocol=self.config.protocol,
                host=self.config.host,
                port=self.config.port,
                tls=self.config.tls,
            ),
            health=HealthStatus(
                status="healthy",
                last_heartbeat=datetime.now(timezone.utc).isoformat(),
            ),
            registered_at=datetime.now(timezone.utc).isoformat(),
            metadata_uri=self.metadata_uri,
        ))
        print(f"[Sentrix] {self.config.name} registered to {self.config.discovery_type} discovery")

    async def unregister_discovery(self) -> None:
        from discovery.http_discovery import DiscoveryFactory
        registry = DiscoveryFactory.create(
            discovery_type=self.config.discovery_type,
            http_base_url=self.config.discovery_url,
        )
        await registry.unregister(self.agent_id)

    # ── ANR / Identity exposure ────────────────────────────────────────────

    def get_anr(self) -> DiscoveryEntry:
        """Return the full ANR (Agent Network Record) for this agent."""
        return DiscoveryEntry(
            agent_id=self.agent_id,
            name=self.config.name,
            owner=self.config.owner,
            capabilities=self.get_capabilities(),
            network=NetworkInfo(
                protocol=self.config.protocol,
                host=self.config.host,
                port=self.config.port,
                tls=self.config.tls,
            ),
            health=HealthStatus(
                status="healthy",
                last_heartbeat=datetime.now(timezone.utc).isoformat(),
            ),
            registered_at=datetime.now(timezone.utc).isoformat(),
            metadata_uri=self.metadata_uri,
        )

    def get_peer_id(self) -> Optional[str]:
        """
        Return the libp2p PeerId derived from this agent's secp256k1 ANR key.
        Returns None if no signing key is configured (anonymous mode).
        """
        if not self.config.signing_key:
            return None
        try:
            from coincurve import PublicKey
            import hashlib
            key = bytes.fromhex(self.config.signing_key)
            pub_compressed = PublicKey.from_secret(key).format(compressed=True)  # 33 bytes
            # Protobuf PublicKey: field 1 (KeyType=Secp256k1=231), field 2 (bytes=compressed pubkey)
            # \x08=field-1-varint \xe7\x01=231 \x12=field-2-bytes \x21=33-length
            proto_pubkey = b'\x08\xe7\x01\x12\x21' + pub_compressed
            digest = hashlib.sha256(proto_pubkey).digest()
            multihash = b'\x12\x20' + digest  # sha2-256 multihash prefix
            return _b58encode(multihash)
        except ImportError:
            import warnings
            warnings.warn("get_peer_id() requires coincurve: pip install coincurve")
            return None
        except Exception:
            return None
