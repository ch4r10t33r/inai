"""
Standard response envelope returned by every agent capability.
"""

from dataclasses import dataclass, field
from typing import Any, Dict, Optional
import time


@dataclass
class AgentResponse:
    request_id: str
    status: str                               # "success" | "error"
    result: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None
    proof: Optional[str] = None              # ZK proof or attestation
    signature: Optional[str] = None          # Signed by the responding agent
    timestamp: int = field(default_factory=lambda: int(time.time() * 1000))

    @staticmethod
    def success(request_id: str, result: Dict[str, Any]) -> "AgentResponse":
        return AgentResponse(request_id=request_id, status="success", result=result)

    @staticmethod
    def error(request_id: str, message: str) -> "AgentResponse":
        return AgentResponse(request_id=request_id, status="error", error_message=message)

    def to_dict(self) -> dict:
        return {
            "requestId":    self.request_id,
            "status":       self.status,
            "result":       self.result,
            "errorMessage": self.error_message,
            "proof":        self.proof,
            "timestamp":    self.timestamp,
        }
