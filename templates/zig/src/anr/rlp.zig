//! Minimal RLP encoder/decoder for ANR wire format.

const std = @import("std");

// ── encode ────────────────────────────────────────────────────────────────────

/// Encode a list of byte slices as an RLP list. Caller frees result.
pub fn encodeList(alloc: std.mem.Allocator, items: []const []const u8) ![]u8 {
    var payload = std.ArrayList(u8).init(alloc);
    defer payload.deinit();

    for (items) |item| {
        const encoded = try encodeBytes(alloc, item);
        defer alloc.free(encoded);
        try payload.appendSlice(encoded);
    }

    var out = std.ArrayList(u8).init(alloc);
    try appendLengthPrefix(&out, payload.items.len, 0xC0);
    try out.appendSlice(payload.items);
    return out.toOwnedSlice();
}

/// Encode a byte slice as an RLP string item. Caller frees result.
pub fn encodeBytes(alloc: std.mem.Allocator, data: []const u8) ![]u8 {
    var out = std.ArrayList(u8).init(alloc);
    if (data.len == 1 and data[0] < 0x80) {
        try out.append(data[0]);
    } else {
        try appendLengthPrefix(&out, data.len, 0x80);
        try out.appendSlice(data);
    }
    return out.toOwnedSlice();
}

fn appendLengthPrefix(out: *std.ArrayList(u8), length: usize, offset: u8) !void {
    if (length < 56) {
        try out.append(offset + @as(u8, @intCast(length)));
    } else {
        var be_buf: [8]u8 = undefined;
        var ll: u8 = 0;
        var n = length;
        while (n > 0) : (n >>= 8) { be_buf[7 - ll] = @intCast(n & 0xFF); ll += 1; }
        try out.append(offset + 55 + ll);
        try out.appendSlice(be_buf[8 - ll ..]);
    }
}

// ── decode ────────────────────────────────────────────────────────────────────

/// Decode RLP-encoded data as a list of byte slices.
/// Each slice is freshly allocated. Caller frees each slice and the ArrayList.
pub fn decodeList(alloc: std.mem.Allocator, data: []const u8) !std.ArrayList([]u8) {
    var list = std.ArrayList([]u8).init(alloc);
    errdefer {
        for (list.items) |item| alloc.free(item);
        list.deinit();
    }

    const prefix = data[0];
    var payload: []const u8 = undefined;

    if (prefix <= 0xF7) {
        const len = prefix - 0xC0;
        payload = data[1 .. 1 + len];
    } else {
        const ll  = prefix - 0xF7;
        var len: usize = 0;
        for (data[1 .. 1 + ll]) |b| len = (len << 8) | b;
        payload = data[1 + ll .. 1 + ll + len];
    }

    var pos: usize = 0;
    while (pos < payload.len) {
        const p = payload[pos];
        if (p < 0x80) {
            const item = try alloc.alloc(u8, 1);
            item[0] = p;
            try list.append(item);
            pos += 1;
        } else if (p <= 0xB7) {
            const len   = p - 0x80;
            const item  = try alloc.dupe(u8, payload[pos + 1 .. pos + 1 + len]);
            try list.append(item);
            pos += 1 + len;
        } else if (p <= 0xBF) {
            const ll    = p - 0xB7;
            var len: usize = 0;
            for (payload[pos + 1 .. pos + 1 + ll]) |b| len = (len << 8) | b;
            const item  = try alloc.dupe(u8, payload[pos + 1 + ll .. pos + 1 + ll + len]);
            try list.append(item);
            pos += 1 + ll + len;
        } else {
            return error.NestedListNotSupported;
        }
    }

    return list;
}
