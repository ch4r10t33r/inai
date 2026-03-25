"""
x402 Facilitator Client
─────────────────────────────────────────────────────────────────────────────
Optional server-side payment verification via the x402 facilitator service.

The facilitator is a trusted third party that verifies EIP-3009 / EIP-712
payment authorisations without requiring the agent server to run its own
blockchain node.

Reference: https://x402.org/facilitator

Usage (in X402ServerMixin._verify_x402_payment override):
    from addons.x402 import X402Facilitator

    async def _verify_x402_payment(self, payment, pricing, req):
        fac = X402Facilitator(base_url="https://x402.org/facilitator")
        return await fac.verify(payment, pricing.to_requirements(memo=req.request_id))

Self-hosted:
    fac = X402Facilitator(base_url="https://your-facilitator.example.com")
"""

from __future__ import annotations

import json
import warnings
from dataclasses import dataclass
from typing import Optional

from .types import X402Payment, X402PaymentRequirements, X402Receipt


@dataclass
class X402Facilitator:
    """
    Client for an x402 facilitator service.

    Supports two operations:
      verify()  — check a payment authorisation is valid (does NOT settle)
      settle()  — deduct from the authorisation (finalises the payment)

    Use verify() for low-value / high-frequency calls.
    Use settle() when you want guaranteed finality.

    Args:
        base_url:   Facilitator base URL (default: https://x402.org/facilitator)
        api_key:    Optional API key for private facilitator deployments.
        timeout_s:  HTTP request timeout in seconds (default: 10).
    """

    base_url: str = "https://x402.org/facilitator"
    api_key: Optional[str] = None
    timeout_s: float = 10.0

    async def verify(
        self,
        payment: X402Payment,
        requirements: X402PaymentRequirements,
    ) -> X402Receipt:
        """
        Verify that a payment authorisation is valid.

        Checks:
          - Signature is valid
          - Amount >= requirements.max_amount_required
          - Network matches
          - Not expired
          - Memo matches (correlation)

        Does NOT move funds — call settle() for that.
        """
        return await self._post("/verify", payment, requirements)

    async def settle(
        self,
        payment: X402Payment,
        requirements: X402PaymentRequirements,
    ) -> X402Receipt:
        """
        Settle (deduct from) a payment authorisation.

        This moves funds on-chain and returns a transaction hash.
        After a successful settle(), the authorisation cannot be reused.
        """
        return await self._post("/settle", payment, requirements)

    async def _post(
        self,
        path: str,
        payment: X402Payment,
        requirements: X402PaymentRequirements,
    ) -> X402Receipt:
        url = self.base_url.rstrip("/") + path
        body = {
            "payment":      payment.to_dict(),
            "requirements": requirements.to_dict(),
        }
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        try:
            import aiohttp
        except ImportError:
            warnings.warn(
                "X402Facilitator requires aiohttp. Install: pip install aiohttp"
            )
            return X402Receipt(
                success=False,
                error_reason="aiohttp not installed",
            )

        try:
            import aiohttp as aiohttp_lib
            async with aiohttp_lib.ClientSession() as session:
                async with session.post(
                    url,
                    json=body,
                    headers=headers,
                    timeout=aiohttp_lib.ClientTimeout(total=self.timeout_s),
                ) as response:
                    data = await response.json()

            if not isinstance(data, dict):
                return X402Receipt(success=False, error_reason="Invalid facilitator response")

            return X402Receipt(
                success=data.get("success", False),
                transaction_hash=data.get("transactionHash"),
                network_id=data.get("networkId"),
                error_reason=data.get("errorReason"),
                payer=data.get("payer"),
                amount_settled=data.get("amountSettled"),
            )
        except Exception as exc:
            return X402Receipt(
                success=False,
                error_reason=f"Facilitator request failed: {exc}",
            )
