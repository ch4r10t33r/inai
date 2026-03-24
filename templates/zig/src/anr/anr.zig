//! ANR — Agent Network Record
//! ──────────────────────────────────────────────────────────────────────────
//! Zig reference implementation.
//!
//! Wire format : RLP( [sig, seq, k₁, v₁, k₂, v₂, …] )
//! Signed over : keccak256( RLP( ["anr-v1", seq_be, k₁, v₁, …] ) )
//! Text form   : "anr:" ++ base64url(wire, no padding)
//! Max size    : 512 bytes
//! Key order   : lexicographic, unique
//!
//! Deps (build.zig.zon): zig-crypto (keccak + secp256k1)

const std      = @import("std");
const rlp      = @import("rlp.zig");
const base64   = std.base64.url_safe_no_pad;

// ── constants ─────────────────────────────────────────────────────────────────

pub const ANR_PREFIX:    []const u8 = "anr:";
pub const ANR_ID_SCHEME: []const u8 = "amp-v1";
pub const ANR_MAX_BYTES: usize      = 512;
pub const SIGN_DOMAIN:   []const u8 = "anr-v1";

// ── key-value entry ───────────────────────────────────────────────────────────

pub const KvEntry = struct {
    key:   []const u8,
    value: []const u8,
};

/// Compare two KvEntry values by key (for lexicographic sort).
fn kv_less_than(_: void, a: KvEntry, b: KvEntry) bool {
    return std.mem.lessThan(u8, a.key, b.key);
}

// ── ANR record ────────────────────────────────────────────────────────────────

pub const AnrRecord = struct {
    seq:       u64,
    entries:   []KvEntry,           // sorted lexicographically before encoding
    signature: [64]u8,              // r‖s (compact secp256k1 signature)
    allocator: std.mem.Allocator,

    pub fn deinit(self: *AnrRecord) void {
        for (self.entries) |e| {
            self.allocator.free(e.key);
            self.allocator.free(e.value);
        }
        self.allocator.free(self.entries);
    }

    // ── encode ────────────────────────────────────────────────────────────────

    /// Encode to binary RLP wire format. Caller frees result.
    pub fn encode(self: *const AnrRecord, alloc: std.mem.Allocator) ![]u8 {
        // Sort entries lexicographically
        var sorted = try alloc.dupe(KvEntry, self.entries);
        defer alloc.free(sorted);
        std.sort.pdq(KvEntry, sorted, {}, kv_less_than);

        // Build flat item list: [sig, seq_be8, k1, v1, k2, v2, ...]
        var items = std.ArrayList([]const u8).init(alloc);
        defer items.deinit();

        try items.append(&self.signature);
        const seq_be = std.mem.toBytes(std.mem.nativeToBig(u64, self.seq));
        try items.append(&seq_be);
        for (sorted) |e| {
            try items.append(e.key);
            try items.append(e.value);
        }

        const wire = try rlp.encodeList(alloc, items.items);
        if (wire.len > ANR_MAX_BYTES) {
            alloc.free(wire);
            return error.AnrTooLarge;
        }
        return wire;
    }

    /// Encode to "anr:<base64url>" text form. Caller frees result.
    pub fn encodeText(self: *const AnrRecord, alloc: std.mem.Allocator) ![]u8 {
        const wire = try self.encode(alloc);
        defer alloc.free(wire);

        const b64_len = base64.Encoder.calcSize(wire.len);
        const buf     = try alloc.alloc(u8, ANR_PREFIX.len + b64_len);
        @memcpy(buf[0..ANR_PREFIX.len], ANR_PREFIX);
        _ = base64.Encoder.encode(buf[ANR_PREFIX.len..], wire);
        return buf;
    }

    // ── decode ────────────────────────────────────────────────────────────────

    /// Decode from raw RLP bytes. Caller must call deinit().
    pub fn decode(alloc: std.mem.Allocator, wire: []const u8) !AnrRecord {
        if (wire.len > ANR_MAX_BYTES) return error.AnrTooLarge;

        var items = try rlp.decodeList(alloc, wire);
        defer {
            for (items.items) |item| alloc.free(item);
            items.deinit();
        }

        if (items.items.len < 2 or (items.items.len % 2) != 0) {
            return error.InvalidAnrStructure;
        }

        var sig: [64]u8 = undefined;
        if (items.items[0].len != 64) return error.InvalidSignature;
        @memcpy(&sig, items.items[0]);

        var seq_be: [8]u8 = undefined;
        if (items.items[1].len != 8) return error.InvalidSeq;
        @memcpy(&seq_be, items.items[1]);
        const seq = std.mem.bigToNative(u64, std.mem.bytesToValue(u64, &seq_be));

        const kv_items = items.items[2..];
        var entries = try alloc.alloc(KvEntry, kv_items.len / 2);
        for (0..entries.len) |i| {
            entries[i] = .{
                .key   = try alloc.dupe(u8, kv_items[i * 2]),
                .value = try alloc.dupe(u8, kv_items[i * 2 + 1]),
            };
        }

        return AnrRecord{ .seq = seq, .entries = entries, .signature = sig, .allocator = alloc };
    }

    /// Decode from "anr:<base64url>" text form.
    pub fn decodeText(alloc: std.mem.Allocator, text: []const u8) !AnrRecord {
        if (!std.mem.startsWith(u8, text, ANR_PREFIX)) return error.MissingAnrPrefix;
        const b64_part = text[ANR_PREFIX.len..];
        const wire_len = try base64.Decoder.calcSizeForSlice(b64_part);
        const wire     = try alloc.alloc(u8, wire_len);
        defer alloc.free(wire);
        try base64.Decoder.decode(wire, b64_part);
        return decode(alloc, wire);
    }

    // ── content RLP (what gets signed) ────────────────────────────────────────

    /// Produce the RLP-encoded content buffer to be hashed for signing.
    pub fn contentRlp(self: *const AnrRecord, alloc: std.mem.Allocator) ![]u8 {
        var sorted = try alloc.dupe(KvEntry, self.entries);
        defer alloc.free(sorted);
        std.sort.pdq(KvEntry, sorted, {}, kv_less_than);

        var items = std.ArrayList([]const u8).init(alloc);
        defer items.deinit();

        try items.append(SIGN_DOMAIN);
        const seq_be = std.mem.toBytes(std.mem.nativeToBig(u64, self.seq));
        try items.append(&seq_be);
        for (sorted) |e| {
            try items.append(e.key);
            try items.append(e.value);
        }
        return rlp.encodeList(alloc, items.items);
    }
};

// ── parsed view ───────────────────────────────────────────────────────────────

pub const ParsedAnr = struct {
    seq:          u64,
    agent_id:     ?[]const u8,
    name:         ?[]const u8,
    version:      ?[]const u8,
    proto:        ?[]const u8,
    agent_port:   ?u16,
    tls:          bool,
    meta_uri:     ?[]const u8,
    ip:           ?[4]u8,
    tcp_port:     ?u16,

    pub fn fromRecord(r: *const AnrRecord) ParsedAnr {
        const find = struct {
            fn f(entries: []const KvEntry, key: []const u8) ?[]const u8 {
                for (entries) |e| {
                    if (std.mem.eql(u8, e.key, key)) return e.value;
                }
                return null;
            }
        }.f;

        return .{
            .seq        = r.seq,
            .agent_id   = find(r.entries, "a.id"),
            .name       = find(r.entries, "a.name"),
            .version    = find(r.entries, "a.ver"),
            .proto      = find(r.entries, "a.proto"),
            .agent_port = if (find(r.entries, "a.port")) |p| std.mem.readInt(u16, p[0..2], .big) else null,
            .tls        = if (find(r.entries, "a.tls")) |t| t[0] == 1 else false,
            .meta_uri   = find(r.entries, "a.meta"),
            .ip         = if (find(r.entries, "ip")) |v| v[0..4].* else null,
            .tcp_port   = if (find(r.entries, "tcp")) |p| std.mem.readInt(u16, p[0..2], .big) else null,
        };
    }
};

// ── builder ───────────────────────────────────────────────────────────────────

/// Fluent ANR builder. Call finish() to get the constructed entry list.
pub const AnrBuilder = struct {
    allocator: std.mem.Allocator,
    seq:       u64 = 0,
    entries:   std.ArrayList(KvEntry),

    pub fn init(alloc: std.mem.Allocator) AnrBuilder {
        return .{ .allocator = alloc, .entries = std.ArrayList(KvEntry).init(alloc) };
    }

    pub fn deinit(self: *AnrBuilder) void {
        for (self.entries.items) |e| {
            self.allocator.free(e.key);
            self.allocator.free(e.value);
        }
        self.entries.deinit();
    }

    fn set(self: *AnrBuilder, key: []const u8, value: []const u8) !void {
        // Remove existing key if present
        for (self.entries.items, 0..) |e, i| {
            if (std.mem.eql(u8, e.key, key)) {
                self.allocator.free(e.key);
                self.allocator.free(e.value);
                _ = self.entries.swapRemove(i);
                break;
            }
        }
        try self.entries.append(.{
            .key   = try self.allocator.dupe(u8, key),
            .value = try self.allocator.dupe(u8, value),
        });
    }

    fn setU16(self: *AnrBuilder, key: []const u8, n: u16) !void {
        var buf: [2]u8 = undefined;
        std.mem.writeInt(u16, &buf, n, .big);
        try self.set(key, &buf);
    }

    pub fn setSeq(self: *AnrBuilder, n: u64)          -> *AnrBuilder { self.seq = n; return self; }
    pub fn setAgentId(self: *AnrBuilder, v: []const u8)  !void { try self.set("a.id",    v); }
    pub fn setName(self: *AnrBuilder, v: []const u8)     !void { try self.set("a.name",  v); }
    pub fn setVersion(self: *AnrBuilder, v: []const u8)  !void { try self.set("a.ver",   v); }
    pub fn setProto(self: *AnrBuilder, v: []const u8)    !void { try self.set("a.proto", v); }
    pub fn setAgentPort(self: *AnrBuilder, p: u16)       !void { try self.setU16("a.port", p); }
    pub fn setTls(self: *AnrBuilder, on: bool)           !void { try self.set("a.tls", &[_]u8{if (on) 1 else 0}); }
    pub fn setMetaUri(self: *AnrBuilder, v: []const u8)  !void { try self.set("a.meta",  v); }
    pub fn setTcpPort(self: *AnrBuilder, p: u16)         !void { try self.setU16("tcp", p); }
    pub fn setUdpPort(self: *AnrBuilder, p: u16)         !void { try self.setU16("udp", p); }
    pub fn setIpv4(self: *AnrBuilder, ip: [4]u8)         !void { try self.set("ip",  &ip); }
};
