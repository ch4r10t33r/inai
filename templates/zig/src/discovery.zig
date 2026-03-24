/// LocalDiscovery — in-memory registry for development and testing.
///
/// Swap for HttpDiscovery, GossipDiscovery, or OnChainDiscovery in production.

const std = @import("std");
const types = @import("types.zig");

pub const LocalDiscovery = struct {
    allocator: std.mem.Allocator,
    registry:  std.StringHashMap(types.DiscoveryEntry),

    pub fn init(allocator: std.mem.Allocator) LocalDiscovery {
        return .{
            .allocator = allocator,
            .registry  = std.StringHashMap(types.DiscoveryEntry).init(allocator),
        };
    }

    pub fn deinit(self: *LocalDiscovery) void {
        self.registry.deinit();
    }

    pub fn register(self: *LocalDiscovery, entry: types.DiscoveryEntry) !void {
        try self.registry.put(entry.agent_id, entry);
        std.log.info("[LocalDiscovery] Registered: {s}", .{entry.agent_id});
    }

    pub fn unregister(self: *LocalDiscovery, agent_id: []const u8) void {
        _ = self.registry.remove(agent_id);
        std.log.info("[LocalDiscovery] Unregistered: {s}", .{agent_id});
    }

    /// Returns all entries that have the requested capability.
    pub fn query(
        self: *LocalDiscovery,
        capability: []const u8,
        out: *std.ArrayList(types.DiscoveryEntry),
    ) !void {
        var iter = self.registry.valueIterator();
        while (iter.next()) |entry| {
            if (entry.health == .unhealthy) continue;
            for (entry.capabilities) |cap| {
                if (std.mem.eql(u8, cap, capability)) {
                    try out.append(entry.*);
                    break;
                }
            }
        }
    }

    pub fn heartbeat(self: *LocalDiscovery, agent_id: []const u8) void {
        if (self.registry.getPtr(agent_id)) |entry| {
            entry.health = .healthy;
        }
    }
};
