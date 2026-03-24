"""
LocalDiscovery — in-process registry for development & testing.

Swap this for:
  HttpDiscovery    → production REST registry
  GossipDiscovery  → P2P gossip network
  OnChainDiscovery → ERC-8004 Ethereum registry
"""

from interfaces.iagent_discovery import IAgentDiscovery, DiscoveryEntry
from datetime import datetime, timezone
from typing import Dict, List


class LocalDiscovery(IAgentDiscovery):
    _instance: "LocalDiscovery | None" = None
    _registry: Dict[str, DiscoveryEntry]

    def __init__(self):
        self._registry = {}

    @classmethod
    def get_instance(cls) -> "LocalDiscovery":
        """Singleton — share one registry per process."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def register(self, entry: DiscoveryEntry) -> None:
        entry.registered_at = datetime.now(timezone.utc).isoformat()
        self._registry[entry.agent_id] = entry
        print(f"[LocalDiscovery] Registered: {entry.agent_id} ({', '.join(entry.capabilities)})")

    async def unregister(self, agent_id: str) -> None:
        self._registry.pop(agent_id, None)
        print(f"[LocalDiscovery] Unregistered: {agent_id}")

    async def query(self, capability: str) -> List[DiscoveryEntry]:
        return [
            e for e in self._registry.values()
            if capability in e.capabilities and e.health.status != "unhealthy"
        ]

    async def list_all(self) -> List[DiscoveryEntry]:
        return list(self._registry.values())

    async def heartbeat(self, agent_id: str) -> None:
        entry = self._registry.get(agent_id)
        if entry:
            entry.health.last_heartbeat = datetime.now(timezone.utc).isoformat()
            entry.health.status = "healthy"
