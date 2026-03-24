use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

/// Standard response envelope returned by every agent capability.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentResponse {
    pub request_id: String,
    /// "success" | "error"
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    /// Optional ZK proof or attestation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proof: Option<String>,
    /// Signed by the responding agent (EIP-712)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    pub timestamp: u64,
}

impl AgentResponse {
    pub fn success(request_id: String, result: Value) -> Self {
        Self {
            request_id,
            status: "success".into(),
            result: Some(result),
            error_message: None,
            proof: None,
            signature: None,
            timestamp: now_ms(),
        }
    }

    pub fn error(request_id: String, message: String) -> Self {
        Self {
            request_id,
            status: "error".into(),
            result: None,
            error_message: Some(message),
            proof: None,
            signature: None,
            timestamp: now_ms(),
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
