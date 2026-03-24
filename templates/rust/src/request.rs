use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Standard request envelope for all agent-to-agent calls.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRequest {
    /// Unique request identifier (UUID v4 recommended)
    pub request_id: String,
    /// Caller identity — agent ID or wallet address
    pub from: String,
    /// Target capability name
    pub capability: String,
    /// Arbitrary capability-specific payload
    pub payload: Value,
    /// Optional EIP-712 signature over the request envelope
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    /// Unix timestamp (ms)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<u64>,
    /// Session key for delegated execution
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_key: Option<String>,
    /// Optional payment info
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payment: Option<PaymentInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentInfo {
    /// "oneshot" | "stream" | "subscription"
    pub payment_type: String,
    /// e.g. "USDC", "ETH"
    pub token: String,
    /// human-readable amount, e.g. "0.001"
    pub amount: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tx_hash: Option<String>,
}
