const std   = @import("std");
const types = @import("types.zig");
const iface = @import("iagent.zig");
const disc  = @import("discovery.zig");

/// ExampleAgent — starter template.
/// Replace capability implementations with your own logic.
pub const ExampleAgent = struct {
    discovery: disc.LocalDiscovery,

    // ── IAgent interface ───────────────────────────────────────────────────

    pub fn agentId(_: *const ExampleAgent) []const u8 {
        return "sentrix://agent/example";
    }

    pub fn owner(_: *const ExampleAgent) []const u8 {
        return "0xYourWalletAddress";
    }

    pub fn getCapabilities(_: *const ExampleAgent) []const []const u8 {
        return &.{ "echo", "ping" };
    }

    pub fn handleRequest(self: *ExampleAgent, req: types.AgentRequest) types.AgentResponse {
        _ = self;
        if (std.mem.eql(u8, req.capability, "echo")) {
            return types.AgentResponse.success(req.request_id, req.payload);
        } else if (std.mem.eql(u8, req.capability, "ping")) {
            return types.AgentResponse.success(req.request_id, "{\"pong\":true}");
        } else {
            return types.AgentResponse.err(req.request_id, "Unknown capability");
        }
    }

    // ── Discovery ──────────────────────────────────────────────────────────

    pub fn registerDiscovery(self: *ExampleAgent) !void {
        try self.discovery.register(.{
            .agent_id      = self.agentId(),
            .name          = "ExampleAgent",
            .owner         = self.owner(),
            .capabilities  = self.getCapabilities(),
            .network       = .{ .host = "localhost", .port = 8080 },
            .health        = .healthy,
            .registered_at = std.time.milliTimestamp(),
        });
    }

    // ── Compile-time interface validation ─────────────────────────────────
    // This triggers a compile error if the interface contract is broken.
    comptime {
        _ = iface.IAgent(ExampleAgent);
    }
};

// ── Dev runner ────────────────────────────────────────────────────────────────
pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    var agent = ExampleAgent{
        .discovery = disc.LocalDiscovery.init(allocator),
    };
    defer agent.discovery.deinit();

    try agent.registerDiscovery();

    const req = types.AgentRequest{
        .request_id = "test-001",
        .from       = "0xCaller",
        .capability = "ping",
        .payload    = "{}",
    };
    const resp = agent.handleRequest(req);
    std.log.info("Response: status={s} result={s}", .{ @tagName(resp.status), resp.result orelse "null" });
}
