# Sentrix Interfaces

This document covers every interface a developer interacts with when building or consuming agents on the Sentrix mesh — from running your first agent to discovering and calling remote agents.

---

## Table of Contents

1. [IAgent — building an agent](#iagent)
2. [AgentRequest / AgentResponse — the message envelope](#agentrequest--agentresponse)
3. [IAgentDiscovery — registering and finding agents](#iagentdiscovery)
4. [IAgentClient — calling other agents](#iagentclient)
5. [AgentSession — communicating with a remote agent](#agentsession)
6. [Mesh protocols — heartbeat, capability exchange, gossip](#mesh-protocols)
7. [End-to-end flow](#end-to-end-flow)

---

## IAgent

The root contract. Every Sentrix agent — whether built from scratch or wrapped from a framework like Google ADK, LangGraph, CrewAI, etc. — must satisfy this interface.

```typescript
interface IAgent {
  // Identity
  readonly agentId:     string;         // "did:key:z..." or "sentrix://agent/<addr>"
  readonly owner?:      string;         // wallet address or "anonymous"
  readonly metadataUri?: string;        // IPFS / Arweave pointer
  readonly metadata?:   AgentMetadata;  // name, version, description, tags

  // Capabilities
  getCapabilities(): string[];

  // Request handling
  handleRequest(request: AgentRequest): Promise<AgentResponse>;
  preProcess?(request: AgentRequest):    Promise<void>;   // auth, rate-limit, logging
  postProcess?(response: AgentResponse): Promise<void>;   // audit, billing

  // Discovery
  registerDiscovery?():   Promise<void>;  // announce to mesh; prints startup banner
  unregisterDiscovery?(): Promise<void>;  // graceful shutdown

  // Permissions
  checkPermission?(caller: string, capability: string): Promise<boolean>;

  // Signing
  signMessage?(message: string): Promise<string>;

  // Identity exposure (see sections below)
  getAnr():             DiscoveryEntry;        // full ANR record
  getPeerId():          Promise<string | null>; // libp2p peer ID from ANR key
}
```

### Startup banner

When `registerDiscovery()` is called, Sentrix prints a startup banner to stdout:

```
────────────────────────────────────────────────────────────
  Sentrix Agent Online  v1.0.0
────────────────────────────────────────────────────────────
  Name         SupportAgent
  Agent ID     did:key:zQ3shvU8…
  Owner        0xABC123…
  Endpoint     http://localhost:8080
  Discovery    libp2p  →  /ip4/0.0.0.0/udp/9000/quic-v1
  Peer ID      QmXoypiz…
  Capabilities (3)
           • answer_question
           • summarise_ticket  [x402 $0.0010]
           • escalate_ticket
────────────────────────────────────────────────────────────
```

The banner shows everything needed to confirm the agent is on the mesh: identity (ANR / DID), endpoint, discovery backend, libp2p peer ID, and all exposed capabilities with any x402 pricing.

### AgentMetadata

```typescript
interface AgentMetadata {
  name:        string;
  version:     string;
  description?: string;
  author?:      string;
  license?:     string;
  repository?:  string;
  tags?:        string[];
  resourceRequirements?: {
    minMemoryMb?: number;
    minCpuCores?: number;
    storageGb?:   number;
  };
}
```

### getAnr()

Returns the full **Agent Network Record** — the authoritative self-description of the agent on the mesh. Callers can inspect it to verify identity and capabilities without going through the discovery layer.

```typescript
const anr = agent.getAnr();
// {
//   agentId:      "did:key:zQ3sh...",
//   name:         "SupportAgent",
//   capabilities: ["answer_question", "summarise_ticket"],
//   network:      { protocol: "http", host: "localhost", port: 8080, tls: false },
//   health:       { status: "healthy", ... },
//   ...
// }
```

### getPeerId()

Returns the libp2p **PeerId** derived from the agent's secp256k1 ANR signing key. One keypair, one identity — the same key signs ANR records and identifies the agent on the P2P transport layer.

```typescript
const peerId = await agent.getPeerId();
// "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco"
// null → anonymous agent (no signing key)
```

---

## AgentRequest / AgentResponse

The standard message envelope for all agent-to-agent calls.

### AgentRequest

```typescript
interface AgentRequest {
  requestId:   string;           // UUID — correlation ID
  from:        string;           // caller agent ID or "anonymous"
  capability:  string;           // which capability to invoke
  payload:     Record<string, unknown>;  // capability-specific input
  signature?:  string;           // EIP-712 signature over this envelope
  timestamp?:  number;           // Unix ms — used to reject stale requests
  sessionKey?: string;           // delegated execution session (ERC-8004)
  payment?:    PaymentInfo;      // one-shot / stream / subscription payment
  x402?:       X402Payment;      // x402 micropayment proof (set on retry)
}
```

### AgentResponse

```typescript
interface AgentResponse {
  requestId:    string;
  status:       'success' | 'error' | 'payment_required';
  result?:      Record<string, unknown>;  // present when status='success'
  errorMessage?: string;                  // present when status='error'
  proof?:        string;                  // ZK proof or attestation
  signature?:    string;                  // signed by the responding agent
  timestamp:     number;                  // Unix ms
  // present when status='payment_required'
  paymentRequirements?: X402PaymentRequirements[];
}
```

### Reserved capabilities

These capability names are intercepted before normal dispatch and handled automatically:

| Capability | Handled by | Description |
|---|---|---|
| `__heartbeat` | `handleHeartbeat()` | Liveness ping — returns `HeartbeatResponse` |
| `__capabilities` | `handleCapabilityExchange()` | Returns current capabilities + ANR — only called as part of a handshake |
| `__gossip` | `handleGossip()` | Receives a `GossipMessage` — fire-and-forget |
| `__disconnect` | default no-op | Signals session close — best-effort |

---

## IAgentDiscovery

Manages agent registration and lookup. The backend is swappable (local, HTTP, libp2p/DHT, gossip).

```typescript
interface IAgentDiscovery {
  // Registration
  register(entry: DiscoveryEntry):   Promise<void>;
  unregister(agentId: string):       Promise<void>;
  heartbeat(agentId: string):        Promise<void>;

  // Lookup
  query(capability: string):         Promise<DiscoveryEntry[]>; // all agents with capability
  listAll():                         Promise<DiscoveryEntry[]>; // every registered agent

  // Convenience (default implementations on all backends)
  find?(capability: string):         Promise<DiscoveryEntry | null>; // best healthy match
  findById?(agentId: string):        Promise<DiscoveryEntry | null>; // by exact agent ID
}
```

`find()` filters to healthy entries and returns the first. `findById()` scans `listAll()`. Both have default implementations — you don't need to override them.

---

## IAgentClient

The standard interface for **discovering and calling other agents**. Combines lookup and invocation in one API.

```typescript
interface IAgentClient {
  // ── Lookup ────────────────────────────────────────────────────────────────
  find(capability: string):              Promise<DiscoveryEntry | null>;
  findAll(capability: string):           Promise<DiscoveryEntry[]>;
  findById(agentId: string):             Promise<DiscoveryEntry | null>;

  // ── Handshake → Session ───────────────────────────────────────────────────
  connect(entry: DiscoveryEntry, options?: { timeoutMs?: number }): Promise<AgentSession>;

  // ── Direct call (no handshake) ────────────────────────────────────────────
  call(agentId: string, capability: string, payload: Record<string, unknown>, options?: CallOptions): Promise<AgentResponse>;
  callCapability(capability: string, payload: Record<string, unknown>, options?: CallOptions): Promise<AgentResponse>;
  callEntry(entry: DiscoveryEntry, capability: string, payload: Record<string, unknown>, options?: CallOptions): Promise<AgentResponse>;

  // ── Mesh protocols ────────────────────────────────────────────────────────
  ping(agentId: string, options?: { timeoutMs?: number }): Promise<HeartbeatResponse>;
  gossipAnnounce(entry: DiscoveryEntry, options?: { ttl?: number }): Promise<void>;
  gossipQuery(capability: string, options?: { ttl?: number; timeoutMs?: number }): Promise<DiscoveryEntry[]>;
}
```

### Lookup methods

| Method | Returns | Description |
|---|---|---|
| `find(capability)` | `DiscoveryEntry \| null` | Best healthy agent for this capability |
| `findAll(capability)` | `DiscoveryEntry[]` | All healthy agents for this capability |
| `findById(agentId)` | `DiscoveryEntry \| null` | Specific agent by ID |

### Call methods (no handshake)

Use these for fire-and-forget calls when you don't need capability verification:

| Method | Description |
|---|---|
| `callCapability(capability, payload)` | Discover best agent + call in one step |
| `call(agentId, capability, payload)` | Call a specific agent by ID |
| `callEntry(entry, capability, payload)` | Call using an entry you already have |

### Quick start

```python
from discovery.http_discovery import DiscoveryFactory
from interfaces.iagent_client import AgentClient

discovery = DiscoveryFactory.create()
client    = AgentClient(discovery, caller_id="sentrix://agent/me")

# One-liner: discover best agent and call
resp = await client.call_capability("weather_forecast", {"city": "NYC"})

# Or call a specific agent
resp = await client.call("sentrix://agent/0xABC", "weather_forecast", {"city": "NYC"})
```

```typescript
import { AgentClient }     from './interfaces/IAgentClient';
import { DiscoveryFactory } from './discovery/DiscoveryFactory';

const discovery = DiscoveryFactory.create({ type: 'local' });
const client    = new AgentClient(discovery, { callerId: 'sentrix://agent/me' });

const resp = await client.callCapability('weather_forecast', { city: 'NYC' });
```

---

## AgentSession

`AgentSession` is returned by `connect()`. It represents an active connection to a remote agent, established after a **two-step handshake**:

1. **Heartbeat ping** — confirms liveness and health status.
2. **Capability exchange** — verifies the agent's current capabilities match what was advertised in the discovery layer.

Capability exchange is part of the handshake by design. It ensures you know *exactly* what the agent can do *right now* before committing to any calls.

```typescript
interface AgentSession {
  readonly entry:     DiscoveryEntry;
  readonly handshake: HandshakeResult;  // cached result of the handshake

  get agentId():     string;
  get capabilities(): string[];
  get isHealthy():   boolean;

  // Interaction
  call(capability: string, payload: Record<string, unknown>, options?: { timeoutMs?: number }): Promise<AgentResponse>;

  // Maintenance
  ping(options?: { timeoutMs?: number }): Promise<HeartbeatResponse>;
  refreshCapabilities(options?: { timeoutMs?: number }): Promise<CapabilityExchangeResponse>;
  close(): Promise<void>;
}

interface HandshakeResult {
  agentId:      string;
  healthStatus: 'healthy' | 'degraded' | 'unhealthy';
  capabilities: string[];
  latencyMs:    number;
  connectedAt:  number;   // Unix ms
  anr?:         DiscoveryEntry;
  version?:     string;
}
```

### When to use connect() vs callCapability()

| | `callCapability()` | `connect()` + session |
|---|---|---|
| **Capability verification** | No — trusts discovery cache | Yes — re-verified at connect time |
| **Session reuse** | No — one-shot | Yes — reuse across multiple calls |
| **Latency** | 1 round-trip | 2 round-trips (amortised across calls) |
| **Use case** | Fire-and-forget, simple scripts | Production, long-running interactions |

### Quick start

```python
# 1. Discover
entry = await client.find("weather_forecast")
if entry is None:
    raise RuntimeError("No agent available for weather_forecast")

# 2. Handshake → session (capability exchange happens here)
session = await client.connect(entry)

if not session.handshake.supports("weather_forecast"):
    raise RuntimeError("Agent no longer supports weather_forecast")

# 3. Call (reuse session for subsequent calls)
resp = await session.call("weather_forecast", {"city": "NYC"})
resp2 = await session.call("weather_forecast", {"city": "London"})

# 4. Check liveness anytime
hb = await session.ping()

# 5. Graceful disconnect
await session.close()
```

```typescript
const entry   = await client.find('weather_forecast');
const session = await client.connect(entry!);

if (!handshakeSupports(session.handshake, 'weather_forecast')) {
  throw new Error('Capability no longer available');
}

const resp = await session.call('weather_forecast', { city: 'NYC' });
await session.close();
```

---

## Mesh Protocols

### Heartbeat

```typescript
// ping returns immediately — no session needed
const hb = await client.ping('sentrix://agent/0xABC');
// hb.status:            'healthy' | 'degraded' | 'unhealthy'
// hb.capabilitiesCount: 3
// hb.version:           '1.0.0'
// hb.latencyMs:         (available on HandshakeResult, not raw ping)
```

Agents handle heartbeats automatically via `handleHeartbeat()`. The default implementation returns `status='healthy'` with capability count. Override to add custom health checks (database reachability, model loading status, etc.).

### Gossip

Gossip propagates capability announcements across the mesh without requiring every agent to poll the discovery layer.

```python
# Announce your agent to all connected peers
await client.gossip_announce(agent.get_anr(), ttl=3)

# Query the mesh for agents with a capability
entries = await client.gossip_query("weather_forecast", ttl=3, timeout_ms=5_000)
```

`GossipMessage` types:

| Type | Direction | Description |
|---|---|---|
| `announce` | outbound | Agent is online; here are its capabilities |
| `revoke` | outbound | Agent is going offline or revoking capabilities |
| `heartbeat` | outbound | Lightweight liveness signal (TTL=1) |
| `query` | outbound | Ask the mesh for agents with a capability |

---

## End-to-End Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  Agent A (caller)          Sentrix Mesh          Agent B (callee)│
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. DISCOVER                                                     │
│  entry = find("weather_forecast")                                │
│     ─────────────────────────────────►  (discovery layer)       │
│                                                                  │
│  2. HANDSHAKE                                                    │
│  session = connect(entry)                                        │
│     ── ping ──────────────────────────► handle_heartbeat()      │
│     ◄─ HeartbeatResponse ─────────────                          │
│     ── __capabilities ────────────────► handle_capability_      │
│     ◄─ CapabilityExchangeResponse ────    exchange()            │
│                                                                  │
│  3. CALL                                                         │
│  resp = session.call("weather_forecast", {...})                  │
│     ── AgentRequest ──────────────────► handle_request()        │
│     ◄─ AgentResponse ─────────────────                          │
│                                                                  │
│  4. CLOSE                                                        │
│  session.close()                                                 │
│     ── __disconnect ──────────────────► (best-effort)           │
│                                                                  │
│  (OPTIONAL) GOSSIP                                               │
│  client.gossip_announce(anr)                                     │
│     ── GossipMessage ─────────────────► receive() → forward     │
│                                                │                 │
│                                           ◄── rebroadcast ──►   │
└─────────────────────────────────────────────────────────────────┘
```

### x402 Payment flow (when agent B requires payment)

```
  session.call("premium_analysis", {...})
      ── AgentRequest ───────────────────► (no payment)
      ◄─ payment_required ───────────────  (X402PaymentRequirements)
      ── AgentRequest + x402 proof ──────► verify payment
      ◄─ AgentResponse (success) ────────
```

Pass `x402_wallet` to `AgentClient` to handle this automatically:

```python
from addons.x402.client import MockWalletProvider   # dev
client = AgentClient(discovery, x402_wallet=MockWalletProvider(), auto_pay=True)
```

---

## Interface implementation matrix

| Interface | Python | TypeScript | Rust | Zig |
|---|---|---|---|---|
| `IAgent` | `interfaces/iagent.py` | `interfaces/IAgent.ts` | `src/agent.rs` | `src/iagent.zig` |
| `AgentRequest/Response` | `interfaces/agent_*.py` | `interfaces/IAgent*.ts` | `src/request.rs` / `src/response.rs` | `src/types.zig` |
| `IAgentDiscovery` | `interfaces/iagent_discovery.py` | `interfaces/IAgentDiscovery.ts` | `src/discovery.rs` | `src/discovery.zig` |
| `IAgentClient` | `interfaces/iagent_client.py` | `interfaces/IAgentClient.ts` | `src/client.rs` | `src/client.zig` |
| `IAgentMesh` | `interfaces/iagent_mesh.py` | `interfaces/IAgentMesh.ts` | _(planned)_ | _(planned)_ |
| `GossipDiscovery` | `discovery/gossip_discovery.py` | `discovery/GossipDiscovery.ts` | _(planned)_ | _(planned)_ |
