/**
 * x402 payment protocol types.
 * Reference: https://x402.org / https://github.com/coinbase/x402
 */

// ── payment requirements (server → client) ────────────────────────────────────

export interface X402PaymentRequirements {
  /** "exact" | "upto" */
  scheme: 'exact' | 'upto';
  /** Chain name: "base" | "ethereum" | "polygon" | … */
  network: string;
  /** Amount in smallest unit (USDC: 6 decimals, ETH: 18 decimals) */
  maxAmountRequired: string;
  /** ERC-20 contract address or "ETH" / "native" */
  asset: string;
  /** Recipient wallet address */
  payTo: string;
  /** Correlation ID (use requestId) */
  memo?: string;
  /** How long the payment authorisation is valid (seconds) */
  maxTimeoutSeconds?: number;
  /** Human-readable description of the charge */
  description?: string;
  /** Extra asset metadata, e.g. { name: 'USDC', version: '2' } */
  extra?: Record<string, unknown>;
}

// ── payment proof (client → server, attached to AgentRequest) ─────────────────

export interface X402Payment {
  x402Version: number;
  /** "exact" | "upto" */
  scheme: string;
  /** Chain name */
  network: string;
  /** Base64url-encoded signed EIP-3009 transferWithAuthorization */
  payload: string;
  /** Outer EIP-712 signature (signs scheme + network + payload) */
  signature: string;
}

// ── payment receipt (from facilitator) ────────────────────────────────────────

export interface X402Receipt {
  success: boolean;
  transactionHash?: string;
  networkId?: string;
  errorReason?: string;
  payer?: string;
  amountSettled?: string;
}

// ── capability pricing (server configuration) ─────────────────────────────────

export interface CapabilityPricing {
  network: string;
  asset: string;
  /** Amount in smallest unit */
  amount: string;
  payTo: string;
  scheme?: 'exact' | 'upto';
  maxTimeoutSeconds?: number;
  description?: string;
  extra?: Record<string, unknown>;
}

// ── convenience constructors ──────────────────────────────────────────────────

/** Charge amountUsdCents USD cents in USDC on Base. */
export function usdcBase(amountUsdCents: number, payTo: string, description?: string): CapabilityPricing {
  return {
    network:           'base',
    asset:             '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    amount:            String(amountUsdCents * 10_000),   // cents → 6-decimal units
    payTo,
    description:       description ?? `$${(amountUsdCents / 100).toFixed(2)} USD`,
    extra:             { name: 'USDC', version: '2' },
  };
}

/** Charge amountWei ETH (in wei) on Base. */
export function ethBase(amountWei: bigint, payTo: string, description?: string): CapabilityPricing {
  return {
    network:     'base',
    asset:       'ETH',
    amount:      amountWei.toString(),
    payTo,
    description: description ?? `${amountWei} wei ETH on Base`,
  };
}

/** Convert CapabilityPricing → X402PaymentRequirements (for sending to client). */
export function toRequirements(
  pricing: CapabilityPricing,
  memo = '',
): X402PaymentRequirements {
  return {
    scheme:             (pricing.scheme ?? 'exact') as 'exact' | 'upto',
    network:            pricing.network,
    maxAmountRequired:  pricing.amount,
    asset:              pricing.asset,
    payTo:              pricing.payTo,
    memo,
    maxTimeoutSeconds:  pricing.maxTimeoutSeconds ?? 300,
    description:        pricing.description ?? '',
    extra:              pricing.extra ?? {},
  };
}
