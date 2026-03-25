/**
 * x402 Facilitator Client
 * ─────────────────────────────────────────────────────────────────────────────
 * Optional server-side payment verification via the x402 facilitator service.
 *
 * The facilitator is a trusted third party that verifies EIP-3009 / EIP-712
 * payment authorisations without requiring the agent server to run its own
 * blockchain node.
 *
 * Reference: https://x402.org/facilitator
 *
 * @example
 * ```ts
 * // In withX402Payment() options:
 * import { X402Facilitator } from '../addons/x402/facilitator';
 *
 * const fac   = new X402Facilitator();
 * const agent = withX402Payment(new MyAgent(), {
 *   pricing: { ... },
 *   verify:  (payment, requirements) => fac.verify(payment, requirements),
 * });
 * ```
 */

import type { X402Payment, X402PaymentRequirements, X402Receipt } from './types';

export interface X402FacilitatorOptions {
  /** Facilitator base URL. Default: https://x402.org/facilitator */
  baseUrl?: string;
  /** Optional API key for private facilitator deployments. */
  apiKey?: string;
  /** HTTP request timeout in milliseconds. Default: 10000. */
  timeoutMs?: number;
}

export class X402Facilitator {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;

  constructor(options: X402FacilitatorOptions = {}) {
    this.baseUrl   = (options.baseUrl ?? 'https://x402.org/facilitator').replace(/\/$/, '');
    this.apiKey    = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /**
   * Verify a payment authorisation.
   * Checks signature, amount, network, and expiry.
   * Does NOT move funds — call settle() for that.
   */
  async verify(
    payment: X402Payment,
    requirements: X402PaymentRequirements,
  ): Promise<X402Receipt> {
    return this._post('/verify', payment, requirements);
  }

  /**
   * Settle (deduct from) a payment authorisation.
   * Moves funds on-chain and returns a transaction hash.
   * After a successful settle(), the authorisation cannot be reused.
   */
  async settle(
    payment: X402Payment,
    requirements: X402PaymentRequirements,
  ): Promise<X402Receipt> {
    return this._post('/settle', payment, requirements);
  }

  private async _post(
    path: string,
    payment: X402Payment,
    requirements: X402PaymentRequirements,
  ): Promise<X402Receipt> {
    const url  = this.baseUrl + path;
    const body = JSON.stringify({ payment, requirements });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    try {
      const controller = new AbortController();
      const timerId    = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(url, {
        method:  'POST',
        headers,
        body,
        signal:  controller.signal,
      });
      clearTimeout(timerId);

      const data = await response.json() as Record<string, unknown>;
      return {
        success:         Boolean(data.success),
        transactionHash: data.transactionHash as string | undefined,
        networkId:       data.networkId as string | undefined,
        errorReason:     data.errorReason as string | undefined,
        payer:           data.payer as string | undefined,
        amountSettled:   data.amountSettled as string | undefined,
      };
    } catch (err: any) {
      return {
        success:     false,
        errorReason: `Facilitator request failed: ${err.message ?? err}`,
      };
    }
  }
}
