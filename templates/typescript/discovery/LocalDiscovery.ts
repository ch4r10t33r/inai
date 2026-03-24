import { IAgentDiscovery, DiscoveryEntry } from '../interfaces/IAgentDiscovery';

/**
 * LocalDiscovery — in-process registry for development & testing.
 *
 * Swap this for:
 *   - HttpDiscovery     → production REST registry
 *   - GossipDiscovery   → P2P gossip network
 *   - OnChainDiscovery  → ERC-8004 Ethereum registry
 */
export class LocalDiscovery implements IAgentDiscovery {
  private static instance: LocalDiscovery;
  private registry = new Map<string, DiscoveryEntry>();

  private constructor() {}

  /** Singleton — share one registry per process */
  static getInstance(): LocalDiscovery {
    if (!LocalDiscovery.instance) {
      LocalDiscovery.instance = new LocalDiscovery();
    }
    return LocalDiscovery.instance;
  }

  async register(entry: DiscoveryEntry): Promise<void> {
    this.registry.set(entry.agentId, { ...entry, registeredAt: new Date().toISOString() });
    console.log(`[LocalDiscovery] Registered: ${entry.agentId} (${entry.capabilities.join(', ')})`);
  }

  async unregister(agentId: string): Promise<void> {
    this.registry.delete(agentId);
    console.log(`[LocalDiscovery] Unregistered: ${agentId}`);
  }

  async query(capability: string): Promise<DiscoveryEntry[]> {
    return [...this.registry.values()].filter(e =>
      e.capabilities.includes(capability) && e.health.status !== 'unhealthy'
    );
  }

  async listAll(): Promise<DiscoveryEntry[]> {
    return [...this.registry.values()];
  }

  async heartbeat(agentId: string): Promise<void> {
    const entry = this.registry.get(agentId);
    if (entry) {
      entry.health.lastHeartbeat = new Date().toISOString();
      entry.health.status = 'healthy';
    }
  }
}
