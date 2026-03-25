import type { X402PaymentRequirements } from '../addons/x402/types';

/**
 * Standard response envelope returned by every agent capability.
 *
 * status values:
 *   'success'          — capability ran successfully
 *   'error'            — capability failed
 *   'payment_required' — caller must attach an x402 payment proof and retry
 */
export interface AgentResponse {
  /** Echoed from the originating AgentRequest */
  requestId: string;
  /**
   * 'success' | 'error' | 'payment_required'
   *
   * payment_required: the capability requires x402 payment.
   * Attach an X402Payment to AgentRequest.x402 and retry.
   * X402Client handles this automatically.
   */
  status: 'success' | 'error' | 'payment_required';
  /** Capability-specific result payload (present when status === 'success') */
  result?: Record<string, unknown>;
  /** Human-readable error message (present when status === 'error' or 'payment_required') */
  errorMessage?: string;
  /** Optional ZK proof or attestation */
  proof?: string;
  /** EIP-712 signature over this response, signed by the agent */
  signature?: string;
  /** Unix timestamp (ms) when the response was produced */
  timestamp?: number;
  /**
   * Payment requirements (present only when status === 'payment_required').
   * Contains one or more X402PaymentRequirements objects describing
   * acceptable payment methods.
   */
  paymentRequirements?: X402PaymentRequirements[];
}
