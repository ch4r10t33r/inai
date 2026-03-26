//! Libp2pDiscovery — in-memory registry aligned with the Sentrix libp2p transport.
//!
//! The Zig `transport/libp2p` FFI (Rust `sentrix-libp2p`) exposes **invoke**, **dial**, and
//! **gossip publish** — not a Kademlia DHT like the full Rust `Libp2pDiscovery` module.
//! This template keeps a **local** registry and provides JSON blobs you can pass to
//! `libp2p.gossipPublish` after `register` / `unregister`, plus `ingestGossipMessage` to merge
//! announcements when you parse inbound gossip elsewhere.
//!
//! For DHT-grade discovery, run a Rust Sentrix agent or extend the FFI.

const std = @import("std");
const json = std.json;
const types = @import("types.zig");
const discovery = @import("discovery.zig");
const discovery_http = @import("discovery_http.zig");

pub const Libp2pDiscovery = struct {
    allocator: std.mem.Allocator,
    registry: std.StringHashMap(types.DiscoveryEntry),

    pub fn init(allocator: std.mem.Allocator) Libp2pDiscovery {
        return .{
            .allocator = allocator,
            .registry = std.StringHashMap(types.DiscoveryEntry).init(allocator),
        };
    }

    pub fn deinit(self: *Libp2pDiscovery) void {
        var it = self.registry.iterator();
        while (it.next()) |kv| {
            discovery.freeDiscoveryEntry(self.allocator, kv.value_ptr.*);
            self.allocator.free(kv.key_ptr.*);
        }
        self.registry.deinit();
    }

    pub fn register(self: *Libp2pDiscovery, entry: types.DiscoveryEntry) !void {
        const owned = try discovery.cloneDiscoveryEntry(self.allocator, entry);
        errdefer discovery.freeDiscoveryEntry(self.allocator, owned);
        if (self.registry.fetchRemove(owned.agent_id)) |kv| {
            discovery.freeDiscoveryEntry(self.allocator, kv.value);
            self.allocator.free(kv.key);
        }
        const k = try self.allocator.dupe(u8, owned.agent_id);
        errdefer self.allocator.free(k);
        try self.registry.put(k, owned);
        std.log.info("[Libp2pDiscovery] Registered: {s}", .{k});
    }

    pub fn unregister(self: *Libp2pDiscovery, agent_id: []const u8) void {
        if (self.registry.fetchRemove(agent_id)) |kv| {
            discovery.freeDiscoveryEntry(self.allocator, kv.value);
            self.allocator.free(kv.key);
        }
        std.log.info("[Libp2pDiscovery] Unregistered: {s}", .{agent_id});
    }

    pub fn query(
        self: *Libp2pDiscovery,
        capability: []const u8,
        out: *std.ArrayList(types.DiscoveryEntry),
    ) !void {
        var iter = self.registry.valueIterator();
        while (iter.next()) |entry| {
            if (entry.health == .unhealthy) continue;
            for (entry.capabilities) |cap| {
                if (std.mem.eql(u8, cap, capability)) {
                    try out.append(try discovery.cloneDiscoveryEntry(self.allocator, entry.*));
                    break;
                }
            }
        }
    }

    pub fn findById(self: *Libp2pDiscovery, agent_id: []const u8) !?types.DiscoveryEntry {
        const e = self.registry.get(agent_id) orelse return null;
        return discovery.cloneDiscoveryEntry(self.allocator, e);
    }

    pub fn heartbeat(self: *Libp2pDiscovery, agent_id: []const u8) void {
        if (self.registry.getPtr(agent_id)) |entry| {
            entry.health = .healthy;
        }
    }

    /// JSON suitable for `sentrix_gossip_publish` (topic `/sentrix/gossip/1.0.0`).
    pub fn gossipAnnounceJson(self: *Libp2pDiscovery, entry: types.DiscoveryEntry) ![]u8 {
        return gossipPayloadJson(self.allocator, "announce", entry);
    }

    pub fn gossipRevokeJson(self: *Libp2pDiscovery, entry: types.DiscoveryEntry) ![]u8 {
        return gossipPayloadJson(self.allocator, "revoke", entry);
    }

    pub fn ingestGossipMessage(self: *Libp2pDiscovery, raw: []const u8) !void {
        var p = try json.parseFromSlice(json.Value, self.allocator, raw, .{});
        defer p.deinit();
        const o = switch (p.value) {
            .object => |m| m,
            else => return error.InvalidGossipJson,
        };
        const kind_val = o.get("kind") orelse return error.InvalidGossipJson;
        const kind = switch (kind_val) {
            .string => |s| s,
            else => return error.InvalidGossipJson,
        };
        const ent_val = o.get("entry") orelse return error.InvalidGossipJson;
        const ent = try discovery_http.parseDiscoveryEntryFromValue(self.allocator, ent_val);
        defer discovery.freeDiscoveryEntry(self.allocator, ent);
        if (std.mem.eql(u8, kind, "announce")) {
            try self.register(ent);
        } else if (std.mem.eql(u8, kind, "revoke")) {
            self.unregister(ent.agent_id);
        }
    }
};

fn gossipPayloadJson(allocator: std.mem.Allocator, kind: []const u8, entry: types.DiscoveryEntry) ![]u8 {
    var list = std.ArrayList(u8).init(allocator);
    errdefer list.deinit();
    const w = list.writer();
    try w.writeAll("{\"kind\":\"");
    try escapeJsonString(w, kind);
    try w.writeAll("\",\"entry\":");
    const inner = try discovery_http.stringifyDiscoveryEntryForWire(allocator, entry);
    defer allocator.free(inner);
    try w.writeAll(inner);
    try w.writeByte('}');
    return list.toOwnedSlice();
}

fn escapeJsonString(writer: anytype, s: []const u8) !void {
    for (s) |c| {
        switch (c) {
            '\\' => try writer.writeAll("\\\\"),
            '"' => try writer.writeAll("\\\""),
            '\n' => try writer.writeAll("\\n"),
            '\r' => try writer.writeAll("\\r"),
            '\t' => try writer.writeAll("\\t"),
            else => try writer.writeByte(c),
        }
    }
}
