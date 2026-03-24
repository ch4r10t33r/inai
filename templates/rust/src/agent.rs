use crate::request::AgentRequest;
use crate::response::AgentResponse;
use async_trait::async_trait;

/// ERC-8004 compliant agent trait.
/// Every Sentrix agent must implement this.
#[async_trait]
pub trait IAgent: Send + Sync {
    // ── ERC-8004 Identity ──────────────────────────────────────────────────
    fn agent_id(&self) -> &str;
    fn owner(&self) -> &str;
    fn metadata_uri(&self) -> Option<&str> { None }

    // ── Capabilities ───────────────────────────────────────────────────────
    fn get_capabilities(&self) -> Vec<String>;

    // ── Request handling ───────────────────────────────────────────────────
    async fn handle_request(&self, request: AgentRequest) -> AgentResponse;

    async fn pre_process(&self, _request: &AgentRequest) -> Result<(), String> {
        Ok(()) // override for auth / rate-limiting
    }

    async fn post_process(&self, _response: &AgentResponse) -> Result<(), String> {
        Ok(()) // override for audit logging / billing
    }

    // ── Discovery (optional) ───────────────────────────────────────────────
    async fn register_discovery(&self) -> Result<(), Box<dyn std::error::Error>> {
        Ok(())
    }

    async fn unregister_discovery(&self) -> Result<(), Box<dyn std::error::Error>> {
        Ok(())
    }

    // ── Permissions (optional) ─────────────────────────────────────────────
    async fn check_permission(&self, _caller: &str, _capability: &str) -> bool {
        true // open by default; override for production
    }

    // ── Signing (optional) ─────────────────────────────────────────────────
    async fn sign_message(&self, _message: &str) -> Result<String, Box<dyn std::error::Error>> {
        Err("sign_message not implemented".into())
    }
}
