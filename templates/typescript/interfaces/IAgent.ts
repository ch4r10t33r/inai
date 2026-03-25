import { AgentRequest } from './IAgentRequest';
import { AgentResponse } from './IAgentResponse';

/**
 * Sentrix agent interface.
 * Every Sentrix agent must implement this contract.
 *
 * Identity note
 * ─────────────
 * `agentId` is required. `owner` is optional — a local secp256k1 key is
 * sufficient for signed ANR records and P2P discovery without an on-chain
 * wallet. ERC-8004 on-chain registration remains available as an opt-in.
 * See identity/IdentityProvider for the LocalKeystoreIdentity default.
 */
export interface IAgent {
  // ─── Identity ─────────────────────────────────────────────────────────────
  /** Sentrix agent URI, e.g. "sentrix://agent/0xABC..." */
  readonly agentId: string;
  /**
   * Owner identifier — Ethereum address when using ERC-8004 or key-derived
   * identity; any unique string otherwise. Defaults to "anonymous".
   */
  readonly owner?: string;
  /** Optional IPFS / on-chain metadata URI */
  readonly metadataUri?: string;
  /** Human-readable metadata bag */
  readonly metadata?: AgentMetadata;

  // ─── Capabilities ─────────────────────────────────────────────────────────
  /** Return the list of capability names this agent exposes */
  getCapabilities(): string[];

  // ─── Request handling ─────────────────────────────────────────────────────
  /** Primary dispatch method — all inbound calls arrive here */
  handleRequest(request: AgentRequest): Promise<AgentResponse>;
  /** Optional pre-processing hook (auth, rate-limit, logging…) */
  preProcess?(request: AgentRequest): Promise<void>;
  /** Optional post-processing hook (audit log, billing…) */
  postProcess?(response: AgentResponse): Promise<void>;

  // ─── Discovery (optional) ─────────────────────────────────────────────────
  /** Announce this agent to the discovery layer */
  registerDiscovery?(): Promise<void>;
  /** Gracefully withdraw from the discovery layer */
  unregisterDiscovery?(): Promise<void>;

  // ─── Delegation / permissions (optional) ─────────────────────────────────
  /** Return true if `caller` is permitted to invoke `capability` */
  checkPermission?(caller: string, capability: string): Promise<boolean>;

  // ─── Signing (optional) ───────────────────────────────────────────────────
  /** EIP-712 compatible message signing */
  signMessage?(message: string): Promise<string>;
}

export interface AgentMetadata {
  name: string;
  version: string;
  description?: string;
  author?: string;
  license?: string;
  repository?: string;
  tags?: string[];
  resourceRequirements?: {
    minMemoryMb?: number;
    minCpuCores?: number;
    storageGb?: number;
  };
}
