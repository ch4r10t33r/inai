# sentrix-cli

> Scaffold ERC-8004 compliant, P2P-discoverable Sentrix agents in seconds.

## Installation

```bash
npm install -g sentrix-cli
```

## Commands

| Command | Description |
|---|---|
| `sentrix init <name> [--lang ts\|py\|rust\|zig]` | Scaffold a new project |
| `sentrix create agent <Name> [-c cap1,cap2]` | Add an agent to an existing project |
| `sentrix run <AgentName> [--port 8080]` | Start agent in dev mode |
| `sentrix discover [-c capability]` | Query the discovery layer |

## Quick Start

```bash
# TypeScript (default)
sentrix init my-agent
cd my-agent && npm install && npm run dev

# Python
sentrix init my-agent --lang python
cd my-agent && pip install -r requirements.txt

# Rust
sentrix init my-agent --lang rust
cd my-agent && cargo run

# Zig
sentrix init my-agent --lang zig
cd my-agent && zig build run
```

## Generated Project Layout

```
my-agent/
├── interfaces/          # ERC-8004 core interfaces
│   ├── IAgent           # Agent identity + capabilities + request handling
│   ├── IAgentRequest    # Request envelope (EIP-712 compatible)
│   ├── IAgentResponse   # Response envelope
│   └── IAgentDiscovery  # Discovery layer contract
├── agents/
│   └── ExampleAgent     # Starter agent (replace with your logic)
├── discovery/
│   └── LocalDiscovery   # In-memory registry (swap for P2P/on-chain)
└── sentrix.config.json   # Project configuration
```

## Discovery Adapters

| Adapter | Backend | Use case |
|---|---|---|
| `LocalDiscovery` | In-memory | Dev & testing |
| `HttpDiscovery` | REST API | Centralised staging |
| `GossipDiscovery` | P2P gossip | Production mesh |
| `OnChainDiscovery` | ERC-8004 | Ethereum-native |

## ERC-8004 Identity

Every agent has:
- `agentId` — `sentrix://agent/<address>`
- `owner` — wallet or contract address
- `metadataUri` — IPFS / Arweave metadata pointer
- `capabilities` — verifiable list of what the agent can do

## AMP Spec Modules

| Module | Description |
|---|---|
| AMP-1 | Discovery (indexing + queries) |
| AMP-2 | Interaction (request/response standard) |
| AMP-3 | Payments (stream, oneshot, subscription) |
| AMP-4 | Delegation & multi-agent workflows |

## License

MIT
