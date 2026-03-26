/// LocalDiscovery — in-memory registry for development and testing.
///
/// Swap for HttpDiscovery, GossipDiscovery, or OnChainDiscovery in production.

const std = @import("std");
const types = @import("types.zig");

/// Deep-copy a discovery entry (all slices allocated with `allocator`).
pub fn cloneDiscoveryEntry(allocator: std.mem.Allocator, e: types.DiscoveryEntry) !types.DiscoveryEntry {
    const agent_id = try allocator.dupe(u8, e.agent_id);
    errdefer allocator.free(agent_id);
    const name = try allocator.dupe(u8, e.name);
    errdefer allocator.free(name);
    const owner = try allocator.dupe(u8, e.owner);
    errdefer allocator.free(owner);

    const caps = try allocator.alloc([]const u8, e.capabilities.len);
    errdefer {
        for (caps) |c| allocator.free(c);
        allocator.free(caps);
    }
    for (e.capabilities, 0..) |c, i| caps[i] = try allocator.dupe(u8, c);

    const host = try allocator.dupe(u8, e.network.host);
    errdefer allocator.free(host);
    const peer_id = try allocator.dupe(u8, e.network.peer_id);
    errdefer allocator.free(peer_id);
    const multiaddr = try allocator.dupe(u8, e.network.multiaddr);
    errdefer allocator.free(multiaddr);

    const meta: ?[]const u8 = if (e.metadata_uri) |m| try allocator.dupe(u8, m) else null;
    errdefer if (meta) |m| allocator.free(m);

    return .{
        .agent_id = agent_id,
        .name = name,
        .owner = owner,
        .capabilities = caps,
        .network = .{
            .protocol = e.network.protocol,
            .host = host,
            .port = e.network.port,
            .tls = e.network.tls,
            .peer_id = peer_id,
            .multiaddr = multiaddr,
        },
        .health = e.health,
        .registered_at = e.registered_at,
        .metadata_uri = meta,
    };
}

/// Free all slices in an entry produced by `cloneDiscoveryEntry` or HTTP discovery parsers.
pub fn freeDiscoveryEntry(allocator: std.mem.Allocator, e: types.DiscoveryEntry) void {
    allocator.free(e.agent_id);
    allocator.free(e.name);
    allocator.free(e.owner);
    for (e.capabilities) |c| allocator.free(c);
    allocator.free(e.capabilities);
    allocator.free(e.network.host);
    allocator.free(e.network.peer_id);
    allocator.free(e.network.multiaddr);
    if (e.metadata_uri) |m| allocator.free(m);
}

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

    pub fn findById(self: *LocalDiscovery, agent_id: []const u8) ?types.DiscoveryEntry {
        return self.registry.get(agent_id);
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
