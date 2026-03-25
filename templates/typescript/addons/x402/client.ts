/**
 * x402 Client
 * ─────────────────────────────────────────────────────────────────────────────
 * Adds automatic payment handling to agent-to-agent calls.
 *
 * @example
 * Basic (returns payment_required for manual handling):
 * ```ts
 * const client = new X402Client();
 * const resp   = await client.call(agent, req);
 * if (resp.status === 'payment_required') {
 *   console.log('Payment needed:', (resp as any).paymentRequirements);
 * }
 * ```
 *
 * With mock wallet (dev mode):
 * ```ts
 * const client = new X402Client({ wallet: new MockWalletProvider(), autoPay: true });
 * const resp   = await client.call(agent, req);
 * ```
 *
 * With real wallet (production):
 * ```ts
 * class MyWallet implements WalletProvider {
 *   async signPayment(req, requirements) { ... }
 *   address() { return '0x...'; }
 * }
 * const client = new X402Client({ wallet: new MyWallet(), autoPay: true });
 * ```
 */

import type { IAgent }               from '../../interfaces/IAgent';
import type { AgentRequest }         from '../../interfaces/IAgentRequest';
import type { AgentResponse }        from '../../interfaces/IAgentResponse';
import type {
  X402Payment,
  X402PaymentRequirements,
}                                    from './types';

// ── wallet provider interface ─────────────────────────────────────────────────

export interface WalletProvider {
  /**
   * Sign a payment authorisation.
   *
   * @param requirements  What the server expects (network, asset, amount, payTo)
   * @param originalReq   The original AgentRequest (for memo / correlation)
   * @returns Signed X402Payment proof
   */
  signPayment(
    requirements: X402PaymentRequirements,
    originalReq: AgentRequest,
  ): Promise<X402Payment>;

  /** Return the wallet's Ethereum address. */
  address(): string;
}

// ── mock wallet (dev only) ────────────────────────────────────────────────────

/**
 * Mock wallet for development and testing.
 * Returns unsigned dummy payment proofs — accepted by X402ServerMixin in dev mode.
 * NOT suitable for production.
 */
export class MockWalletProvider implements WalletProvider {
  constructor(private readonly _address = '0xDevWallet0000000000000000000000000000000') {}

  address() { return this._address; }

  async signPayment(
    requirements: X402PaymentRequirements,
    _originalReq: AgentRequest,
  ): Promise<X402Payment> {
    console.warn(
      '[x402] MockWalletProvider: returning unsigned dummy payment. ' +
      'Use a real WalletProvider in production.'
    );
    return {
      x402Version: 1,
      scheme:      requirements.scheme,
      network:     requirements.network,
      payload:     'mock-unsigned-payload',
      signature:   'mock-signature',
    };
  }
}

// ── x402 client ───────────────────────────────────────────────────────────────

export interface X402ClientOptions {
  /**
   * Wallet provider for signing payments.
   * If not provided, payment_required responses are returned to the caller.
   */
  wallet?: WalletProvider;
  /**
   * If true, pays automatically without calling onPaymentRequired().
   * Default: false.
   */
  autoPay?: boolean;
  /** Maximum retry attempts after payment. Default: 1. */
  maxRetries?: number;
}

export class X402Client {
  private readonly wallet?: WalletProvider;
  private readonly autoPay: boolean;
  private readonly maxRetries: number;

  constructor(options: X402ClientOptions = {}) {
    this.wallet     = options.wallet;
    this.autoPay    = options.autoPay ?? false;
    this.maxRetries = options.maxRetries ?? 1;
  }

  /**
   * Call an agent, handling x402 payment_required responses automatically.
   */
  async call(agent: IAgent, req: AgentRequest): Promise<AgentResponse> {
    const resp = await agent.handleRequest(req);

    if (resp.status !== ('payment_required' as any)) {
      return resp;
    }

    if (!this.wallet) {
      // No wallet configured — return payment_required for caller to handle
      return resp;
    }

    const rawReqs: X402PaymentRequirements[] = (resp as any).paymentRequirements ?? [];
    if (rawReqs.length === 0) {
      return {
        requestId:    req.requestId,
        status:       'error',
        errorMessage: 'payment_required response missing paymentRequirements',
      };
    }

    const requirements = rawReqs[0];

    if (!this.autoPay) {
      const confirmed = await this.onPaymentRequired(requirements, req, resp);
      if (!confirmed) return resp;
    }

    const payment = await this.wallet.signPayment(requirements, req);

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const paidReq   = this._attachPayment(req, payment);
      const retryResp = await agent.handleRequest(paidReq);
      if (retryResp.status !== ('payment_required' as any)) return retryResp;
      if (attempt < this.maxRetries - 1) {
        console.warn(`[x402] Payment retry ${attempt + 1}/${this.maxRetries} — server still returned payment_required`);
      }
    }

    return {
      requestId:    req.requestId,
      status:       'error',
      errorMessage: `x402 payment failed after ${this.maxRetries} attempt(s)`,
    };
  }

  /**
   * Called when autoPay=false and payment is required.
   * Override to prompt the user for confirmation.
   * Default: logs and returns true (proceeds with payment).
   */
  protected async onPaymentRequired(
    requirements: X402PaymentRequirements,
    originalReq: AgentRequest,
    _paymentResp: AgentResponse,
  ): Promise<boolean> {
    console.log(
      `[x402] Payment required for '${originalReq.capability}':\n` +
      `       Network : ${requirements.network}\n` +
      `       Asset   : ${requirements.asset}\n` +
      `       Amount  : ${requirements.maxAmountRequired}\n` +
      `       Pay to  : ${requirements.payTo}\n` +
      `       Desc    : ${requirements.description ?? '(none)'}`
    );
    return true;
  }

  private _attachPayment(req: AgentRequest, payment: X402Payment): AgentRequest {
    return { ...req, x402: payment } as AgentRequest & { x402: X402Payment };
  }
}
