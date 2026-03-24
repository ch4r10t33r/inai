[package]
name = "{{PROJECT_NAME}}"
version = "0.1.0"
edition = "2021"
description = "Sentrix agent project — ERC-8004 compliant"

[[bin]]
name = "{{PROJECT_NAME}}"
path = "src/main.rs"

[dependencies]
async-trait = "0.1"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
chrono = { version = "0.4", features = ["serde"] }
axum = "0.7"
tower = "0.4"
uuid = { version = "1", features = ["v4"] }
