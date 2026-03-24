/// ERC-8004 compliant agent interface (comptime vtable pattern).
///
/// Usage:
///   const MyAgent = struct {
///       pub fn agentId(_: *const @This()) []const u8 { return "sentrix://agent/my"; }
///       pub fn owner  (_: *const @This()) []const u8 { return "0xWallet"; }
///       pub fn getCapabilities(_: *const @This()) []const []const u8 { return &.{"myCapability"}; }
///       pub fn handleRequest(self: *@This(), req: types.AgentRequest) types.AgentResponse { ... }
///   };

const std = @import("std");
const types = @import("types.zig");

pub fn IAgent(comptime T: type) type {
    return struct {
        // Verify the implementing type exposes the required interface at compile time
        comptime {
            if (!@hasDecl(T, "agentId"))        @compileError(std.fmt.comptimePrint("{s} must implement agentId()", .{@typeName(T)}));
            if (!@hasDecl(T, "owner"))           @compileError(std.fmt.comptimePrint("{s} must implement owner()", .{@typeName(T)}));
            if (!@hasDecl(T, "getCapabilities")) @compileError(std.fmt.comptimePrint("{s} must implement getCapabilities()", .{@typeName(T)}));
            if (!@hasDecl(T, "handleRequest"))   @compileError(std.fmt.comptimePrint("{s} must implement handleRequest()", .{@typeName(T)}));
        }

        /// Dispatch a request through optional pre/post hooks.
        pub fn dispatch(self: *T, req: types.AgentRequest) types.AgentResponse {
            // pre-process hook (optional)
            if (@hasDecl(T, "preProcess")) self.preProcess(req);

            const response = self.handleRequest(req);

            // post-process hook (optional)
            if (@hasDecl(T, "postProcess")) self.postProcess(response);

            return response;
        }

        /// Check if caller has permission for a capability (default: open).
        pub fn checkPermission(_: *T, _: []const u8, _: []const u8) bool {
            return true;
        }
    };
}
