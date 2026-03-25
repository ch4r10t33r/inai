"""
Standard response envelope returned by every agent capability.

status values
─────────────
  "success"          — capability ran successfully; result contains the output
  "error"            — capability failed; error_message describes why
  "payment_required" — caller must supply an x402 payment proof and retry;
                       payment_requirements contains the payment details
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
import time


@dataclass
class AgentResponse:
    request_id: str
    status: str                               # "success" | "error" | "payment_required"
    result: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None
    proof: Optional[str] = None              # ZK proof or attestation
    signature: Optional[str] = None          # Signed by the responding agent
    timestamp: int = field(default_factory=lambda: int(time.time() * 1000))
    # ── x402 payment fields (set when status == "payment_required") ────────
    payment_requirements: Optional[List[Dict[str, Any]]] = None
    """List of X402PaymentRequirements dicts. Present only when status='payment_required'."""

    @staticmethod
    def success(request_id: str, result: Dict[str, Any]) -> "AgentResponse":
        return AgentResponse(request_id=request_id, status="success", result=result)

    @staticmethod
    def error(request_id: str, message: str) -> "AgentResponse":
        return AgentResponse(request_id=request_id, status="error", error_message=message)

    @staticmethod
    def payment_required(
        request_id: str,
        requirements: List[Dict[str, Any]],
        message: str = "Payment required. Attach an x402 payment proof and retry.",
    ) -> "AgentResponse":
        """
        Return a payment_required response.
        Callers using X402Client will automatically handle this response.
        """
        return AgentResponse(
            request_id=request_id,
            status="payment_required",
            error_message=message,
            payment_requirements=requirements,
        )

    def to_dict(self) -> dict:
        return {
            "requestId":    self.request_id,
            "status":       self.status,
            "result":       self.result,
            "errorMessage": self.error_message,
            "proof":        self.proof,
            "timestamp":    self.timestamp,
        }
