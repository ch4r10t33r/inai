use crate::agent::IAgent;
use crate::discovery::{DiscoveryEntry, HealthStatus, LocalDiscovery, NetworkInfo};
use crate::request::AgentRequest;
use crate::response::AgentResponse;
use async_trait::async_trait;
use serde_json::json;

pub struct ExampleAgent {
    pub discovery: LocalDiscovery,
}

impl ExampleAgent {
    pub fn new() -> Self {
        Self { discovery: LocalDiscovery::default() }
    }
}

#[async_trait]
impl IAgent for ExampleAgent {
    fn agent_id(&self) -> &str { "sentrix://agent/example" }
    fn owner(&self)    -> &str { "0xYourWalletAddress" }

    fn get_capabilities(&self) -> Vec<String> {
        vec!["echo".into(), "ping".into()]
    }

    async fn handle_request(&self, req: AgentRequest) -> AgentResponse {
        if !self.check_permission(&req.from, &req.capability).await {
            return AgentResponse::error(req.request_id, "Permission denied".into());
        }

        match req.capability.as_str() {
            "echo" => AgentResponse::success(req.request_id, json!({ "echo": req.payload })),
            "ping" => AgentResponse::success(req.request_id, json!({ "pong": true, "agentId": self.agent_id() })),
            _      => AgentResponse::error(req.request_id, format!("Unknown capability: {}", req.capability)),
        }
    }

    async fn register_discovery(&self) -> Result<(), Box<dyn std::error::Error>> {
        use crate::discovery::IAgentDiscovery;
        self.discovery.register(DiscoveryEntry {
            agent_id:      self.agent_id().into(),
            name:          "ExampleAgent".into(),
            owner:         self.owner().into(),
            capabilities:  self.get_capabilities(),
            network:       NetworkInfo { protocol: "http".into(), host: "localhost".into(), port: 8080, tls: false },
            health:        HealthStatus { status: "healthy".into(), last_heartbeat: chrono::Utc::now().to_rfc3339(), uptime_seconds: 0 },
            registered_at: chrono::Utc::now().to_rfc3339(),
            metadata_uri:  Some("ipfs://QmYourMetadataHashHere".into()),
        }).await
    }
}
