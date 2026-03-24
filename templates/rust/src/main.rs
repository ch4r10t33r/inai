mod agent;
mod discovery;
mod example_agent;
mod request;
mod response;

use crate::agent::IAgent;
use crate::example_agent::ExampleAgent;
use crate::request::AgentRequest;
use serde_json::json;

#[tokio::main]
async fn main() {
    let agent = ExampleAgent::new();

    // Register with the local discovery layer
    agent.register_discovery().await.expect("Discovery registration failed");

    // Smoke test
    let req = AgentRequest {
        request_id: "test-001".into(),
        from:        "0xCaller".into(),
        capability:  "ping".into(),
        payload:     json!({}),
        signature:   None,
        timestamp:   None,
        session_key: None,
        payment:     None,
    };

    let resp = agent.handle_request(req).await;
    println!("Response: {:?}", resp);
}
