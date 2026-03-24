/**
 * Standard response envelope returned by every agent capability.
 */
export interface AgentResponse {
  /** Echoed from the originating AgentRequest */
  requestId: string;
  /** 'success' or 'error' */
  status: 'success' | 'error';
  /** Capability-specific result payload */
  result?: Record<string, unknown>;
  /** Human-readable error message (only when status === 'error') */
  errorMessage?: string;
  /** Optional ZK proof or attestation */
  proof?: string;
  /** EIP-712 signature over this response, signed by the agent */
  signature?: string;
  /** Unix timestamp (ms) when the response was produced */
  timestamp?: number;
}
