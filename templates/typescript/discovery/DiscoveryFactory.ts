/**
 * DiscoveryFactory — selects the appropriate discovery backend.
 *
 * Priority order (highest → lowest):
 *   1. Explicit `type` in config
 *   2. SENTRIX_DISCOVERY_URL env var  → HttpDiscovery
 *   3. default                       → LocalDiscovery
 *
 * Usage:
 *   const registry = DiscoveryFactory.create(config);
 *   await registry.register(entry);
 */

import { IAgentDiscovery } from '../interfaces/IAgentDiscovery';
import { LocalDiscovery }  from './LocalDiscovery';
import { HttpDiscovery }   from './HttpDiscovery';

export type DiscoveryType = 'local' | 'http' | 'gossip' | 'onchain';

export interface DiscoveryConfig {
  type?: DiscoveryType;
  /** Required when type === 'http' */
  http?: {
    baseUrl: string;
    apiKey?: string;
    timeoutMs?: number;
    heartbeatIntervalMs?: number;
  };
}

export class DiscoveryFactory {
  static create(config: DiscoveryConfig = {}): IAgentDiscovery {
    const type = config.type
      ?? (process.env['SENTRIX_DISCOVERY_URL'] ? 'http' : 'local');

    switch (type) {
      case 'http': {
        const url = config.http?.baseUrl ?? process.env['SENTRIX_DISCOVERY_URL'];
        if (!url) throw new Error('[DiscoveryFactory] http type requires baseUrl');
        return new HttpDiscovery({
          baseUrl: url,
          apiKey:               config.http?.apiKey               ?? process.env['SENTRIX_DISCOVERY_KEY'],
          timeoutMs:            config.http?.timeoutMs,
          heartbeatIntervalMs:  config.http?.heartbeatIntervalMs,
        });
      }
      case 'gossip':
        throw new Error('[DiscoveryFactory] GossipDiscovery not yet implemented — contribute at github.com/sentrix');
      case 'onchain':
        throw new Error('[DiscoveryFactory] OnChainDiscovery not yet implemented — contribute at github.com/sentrix');
      case 'local':
      default:
        return LocalDiscovery.getInstance();
    }
  }
}
