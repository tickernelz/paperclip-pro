import { describe, expect, it } from "vitest";
import { readConnectionFailure } from "./connection-failure.js";

describe("readConnectionFailure", () => {
  const git = { schemaVersion: 1, provider: "git", operation: "clone", reason: "authentication_failed" };
  const gateway = { schemaVersion: 1, provider: "hermes_gateway", operation: "create_run", reason: "connection_refused" };
  const mcp = { schemaVersion: 1, provider: "mcp_http", operation: "discover_tools", reason: "connection_refused" };

  it.each([
    "authentication_failed", "repository_unavailable", "invalid_remote", "dns_failure", "connection_refused",
    "network_unreachable", "connection_reset", "connection_timeout", "tls_failure", "rate_limited", "remote_unavailable",
  ])("accepts the Git clone reason %s", (reason) => {
    const input = { ...git, reason };
    expect(readConnectionFailure(input)).toEqual(input);
  });

  it.each([
    "authentication_failed", "endpoint_not_found", "rate_limited", "remote_unavailable", "connection_refused",
    "dns_failure", "network_unreachable", "connection_reset", "connection_timeout", "tls_failure",
  ])("accepts the MCP tool discovery request reason %s", (reason) => {
    const input = { ...mcp, reason };
    expect(readConnectionFailure(input)).toEqual(input);
  });

  it.each([
    { ...git, operation: "fetch" },
    { ...git, operation: "create_run" },
    { ...git, reason: "endpoint_not_found" },
    gateway,
    { ...gateway, operation: "configuration", reason: "endpoint_missing" },
    { ...gateway, operation: "clone" },
    { ...gateway, operation: "poll_status" },
    { ...gateway, operation: "stop_run" },
    { ...gateway, operation: "configuration" },
    { ...gateway, reason: "credentials_missing" },
    { ...gateway, reason: "repository_unavailable" },
    { ...gateway, reason: "timeout" },
    { ...gateway, reason: "unknown" },
    { ...gateway, provider: "other_gateway" },
    { ...gateway, provider: "hermes_local" },
    { ...mcp, operation: "create_run" },
    { ...mcp, operation: "clone" },
    { ...mcp, operation: "configuration" },
    { ...mcp, operation: "call_tool" },
    { ...mcp, reason: "credentials_missing" },
    { ...mcp, reason: "repository_unavailable" },
    { ...gateway, operation: "discover_tools" },
    { ...git, operation: "discover_tools" },
  ])("rejects an unsupported provider/operation/reason combination: %j", (input) => {
    expect(readConnectionFailure(input)).toBeNull();
  });

  it.each([
    undefined, null, false, 1, "connection_refused", [], [mcp], {},
    { ...mcp, schemaVersion: 0 }, { ...mcp, schemaVersion: 2 }, { ...mcp, schemaVersion: "1" },
    { ...mcp, schemaVersion: null }, { ...mcp, schemaVersion: undefined },
    { ...mcp, provider: null }, { ...mcp, provider: ["mcp_http"] },
    { ...mcp, operation: null }, { ...mcp, operation: 1 },
    { ...mcp, reason: null }, { ...mcp, reason: 1 }, { ...mcp, reason: ["connection_refused"] },
    { ...mcp, reason: { code: "ECONNREFUSED" } },
    { provider: "mcp_http", operation: "discover_tools", reason: "connection_refused" },
    { ...mcp, reason: "connection_refused " }, { ...mcp, reason: "CONNECTION_REFUSED" },
  ])("rejects unknown versions or malformed values: %j", (input) => {
    expect(readConnectionFailure(input)).toBeNull();
  });

  it.each([
    { url: "https://private.example.test" },
    { account: "private-account" },
    { token: "synthetic-secret" },
    { remoteRunAccepted: false },
    { providerWorkStarted: false },
    { details: { message: "private diagnostics" } },
    { extra: undefined },
  ])("rejects extra metadata instead of broadening the bounded marker: %j", (extra) => {
    expect(readConnectionFailure({ ...mcp, ...extra })).toBeNull();
  });

  it("rejects unknown own fields even when a prototype supplies a valid descriptor", () => {
    const input = Object.assign(Object.create(mcp), { a: 1, b: 2, c: 3, d: 4 });
    expect(readConnectionFailure(input)).toBeNull();
  });

  it("returns an independent bounded value without mutating its producer's input", () => {
    const input = Object.freeze({ ...mcp });
    const output = readConnectionFailure(input);
    expect(output).toEqual(mcp);
    expect(output).not.toBe(input);
    expect(input).toEqual(mcp);
    expect(Object.keys(output ?? {}).sort()).toEqual(["operation", "provider", "reason", "schemaVersion"]);
  });
});
