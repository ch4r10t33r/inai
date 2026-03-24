/**
 * Standard request envelope for all agent-to-agent calls.
 * Signature is EIP-712 compatible when `from` is a wallet.
 */
export interface AgentRequest {
  /** Unique request identifier (UUID v4 recommended) */
  requestId: string;
  /** Caller identity — agent ID or wallet address */
  from: string;
  /** Target capability name */
  capability: string;
  /** Arbitrary payload — structure is capability-specific */
  payload: Record<string, unknown>;
  /** Optional EIP-712 signature over the request envelope */
  signature?: string;
  /** Unix timestamp (ms) — used to reject stale requests */
  timestamp?: number;
  /** Session key if using delegated execution */
  sessionKey?: string;
  /** Payment info if the capability requires it */
  payment?: PaymentInfo;
}

export interface PaymentInfo {
  type: 'oneshot' | 'stream' | 'subscription';
  token: string;   // e.g. "USDC", "ETH"
  amount: string;  // human-readable, e.g. "0.001"
  txHash?: string; // optional pre-authorisation tx
}
