"""
x402 payment protocol types.

Reference: https://x402.org / https://github.com/coinbase/x402
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class X402PaymentRequirements:
    """
    Describes what payment a server requires for a capability.

    Returned (embedded in AgentResponse) when a request is made to a
    capability that requires payment and no valid payment proof is present.

    Fields mirror the x402 spec's PaymentRequirements object.
    """

    # ── required ──────────────────────────────────────────────────────────────
    scheme: str            # "exact" | "upto"
    network: str           # chain name: "base", "ethereum", "polygon", etc.
    max_amount_required: str   # amount in smallest unit (e.g. USDC has 6 decimals)
    asset: str             # ERC-20 contract address or "ETH" / "native"
    pay_to: str            # recipient wallet address

    # ── optional ──────────────────────────────────────────────────────────────
    memo: str = ""                   # correlation ID (use request_id)
    max_timeout_seconds: int = 300   # how long the payment auth is valid
    description: str = ""            # human-readable description of the charge
    extra: Dict[str, Any] = field(default_factory=dict)
    """Extra asset metadata, e.g. {"name": "USDC", "version": "2"}"""

    def to_dict(self) -> dict:
        return {
            "scheme":             self.scheme,
            "network":            self.network,
            "maxAmountRequired":  self.max_amount_required,
            "asset":              self.asset,
            "payTo":              self.pay_to,
            "memo":               self.memo,
            "maxTimeoutSeconds":  self.max_timeout_seconds,
            "description":        self.description,
            "extra":              self.extra,
        }

    @staticmethod
    def from_dict(d: dict) -> "X402PaymentRequirements":
        return X402PaymentRequirements(
            scheme=d["scheme"],
            network=d["network"],
            max_amount_required=d["maxAmountRequired"],
            asset=d["asset"],
            pay_to=d["payTo"],
            memo=d.get("memo", ""),
            max_timeout_seconds=d.get("maxTimeoutSeconds", 300),
            description=d.get("description", ""),
            extra=d.get("extra", {}),
        )


@dataclass
class X402Payment:
    """
    Payment proof attached to an AgentRequest by the caller.

    The payload is a base64url-encoded signed EIP-3009 / EIP-712 authorization
    (for ERC-20 tokens) or equivalent for native assets.
    """

    x402_version: int = 1
    scheme: str = "exact"
    network: str = "base"
    payload: str = ""    # base64url-encoded signed authorisation
    signature: str = ""  # outer EIP-712 signature (signs scheme+network+payload)

    def to_dict(self) -> dict:
        return {
            "x402Version": self.x402_version,
            "scheme":      self.scheme,
            "network":     self.network,
            "payload":     self.payload,
            "signature":   self.signature,
        }

    @staticmethod
    def from_dict(d: dict) -> "X402Payment":
        return X402Payment(
            x402_version=d.get("x402Version", 1),
            scheme=d.get("scheme", "exact"),
            network=d.get("network", "base"),
            payload=d.get("payload", ""),
            signature=d.get("signature", ""),
        )


@dataclass
class X402Receipt:
    """
    Result of payment verification (from facilitator or self-verification).
    """

    success: bool
    transaction_hash: Optional[str] = None
    network_id: Optional[str] = None
    error_reason: Optional[str] = None
    payer: Optional[str] = None          # address that made the payment
    amount_settled: Optional[str] = None  # actual amount settled

    def to_dict(self) -> dict:
        return {
            "success":         self.success,
            "transactionHash": self.transaction_hash,
            "networkId":       self.network_id,
            "errorReason":     self.error_reason,
            "payer":           self.payer,
            "amountSettled":   self.amount_settled,
        }


@dataclass
class CapabilityPricing:
    """
    Pricing configuration for one capability on the server side.

    Add this to X402ServerMixin.x402_pricing to charge callers.

    Example:
        x402_pricing = {
            'generate_image': CapabilityPricing(
                network='base',
                asset='0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',  # USDC on Base
                amount='500000',   # 0.50 USDC
                pay_to='0xYourAddress',
                description='Image generation — 0.50 USDC per request',
            )
        }
    """

    network: str           # "base" | "ethereum" | "polygon" | ...
    asset: str             # ERC-20 address or "ETH"
    amount: str            # in smallest unit (USDC: 6 decimals, ETH: 18 decimals)
    pay_to: str            # recipient wallet address

    scheme: str = "exact"
    max_timeout_seconds: int = 300
    description: str = ""
    extra: Dict[str, Any] = field(default_factory=dict)

    # ── convenience constructors ───────────────────────────────────────────────

    @staticmethod
    def usdc_base(amount_usd_cents: int, pay_to: str, description: str = "") -> "CapabilityPricing":
        """
        Shorthand: charge `amount_usd_cents` USD cents in USDC on Base.

        Example:
            CapabilityPricing.usdc_base(50, '0xMyWallet', 'Image gen — $0.50')
            # → 0.50 USDC on Base
        """
        return CapabilityPricing(
            network="base",
            asset="0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",  # USDC on Base
            amount=str(amount_usd_cents * 10_000),  # cents → 6-decimal units
            pay_to=pay_to,
            description=description or f"${amount_usd_cents / 100:.2f} USD",
            extra={"name": "USDC", "version": "2"},
        )

    @staticmethod
    def eth_base(amount_wei: int, pay_to: str, description: str = "") -> "CapabilityPricing":
        """Charge `amount_wei` ETH (in wei) on Base."""
        return CapabilityPricing(
            network="base",
            asset="ETH",
            amount=str(amount_wei),
            pay_to=pay_to,
            description=description,
        )

    def to_requirements(self, memo: str = "") -> X402PaymentRequirements:
        """Convert this pricing config to a payment requirements object."""
        return X402PaymentRequirements(
            scheme=self.scheme,
            network=self.network,
            max_amount_required=self.amount,
            asset=self.asset,
            pay_to=self.pay_to,
            memo=memo,
            max_timeout_seconds=self.max_timeout_seconds,
            description=self.description,
            extra=self.extra,
        )
