const std = @import("std");

// ── AgentRequest ──────────────────────────────────────────────────────────────
pub const PaymentInfo = struct {
    payment_type: []const u8, // "oneshot" | "stream" | "subscription"
    token:        []const u8,
    amount:       []const u8,
    tx_hash:      ?[]const u8 = null,
};

pub const AgentRequest = struct {
    request_id:  []const u8,
    from:        []const u8,   // caller agent ID or wallet
    capability:  []const u8,
    payload:     []const u8,   // JSON-encoded payload
    signature:   ?[]const u8 = null,
    timestamp:   ?i64 = null,
    session_key: ?[]const u8 = null,
    payment:     ?PaymentInfo = null,
};

// ── AgentResponse ─────────────────────────────────────────────────────────────
pub const AgentStatus = enum { success, @"error" };

pub const AgentResponse = struct {
    request_id:    []const u8,
    status:        AgentStatus,
    result:        ?[]const u8 = null,  // JSON-encoded result
    error_message: ?[]const u8 = null,
    proof:         ?[]const u8 = null,
    signature:     ?[]const u8 = null,
    timestamp:     i64,

    pub fn success(request_id: []const u8, result: []const u8) AgentResponse {
        return .{
            .request_id = request_id,
            .status     = .success,
            .result     = result,
            .timestamp  = std.time.milliTimestamp(),
        };
    }

    pub fn err(request_id: []const u8, message: []const u8) AgentResponse {
        return .{
            .request_id    = request_id,
            .status        = .@"error",
            .error_message = message,
            .timestamp     = std.time.milliTimestamp(),
        };
    }
};

// ── Discovery ─────────────────────────────────────────────────────────────────
pub const NetworkProtocol = enum { http, websocket, grpc, tcp };

pub const NetworkInfo = struct {
    protocol:  NetworkProtocol = .http,
    host:      []const u8,
    port:      u16,
    tls:       bool = false,
    /// libp2p PeerId string (empty when not in P2P mode).
    peer_id:   []const u8 = "",
    /// Full listen multiaddr when known (empty otherwise).
    multiaddr: []const u8 = "",
};

pub const HealthStatus = enum { healthy, degraded, unhealthy };

pub const DiscoveryEntry = struct {
    agent_id:       []const u8,
    name:           []const u8,
    owner:          []const u8,
    capabilities:   []const []const u8,
    network:        NetworkInfo,
    health:         HealthStatus = .healthy,
    registered_at:  i64,         // Unix ms
    metadata_uri:   ?[]const u8 = null,
};
