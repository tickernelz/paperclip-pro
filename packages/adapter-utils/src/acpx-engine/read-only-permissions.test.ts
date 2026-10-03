import { describe, expect, it } from "vitest";
import type { AcpPermissionRequest } from "acpx/runtime";
import { readOnlyAcpPermissionDecision } from "./execute.js";

function request(toolCall: Record<string, unknown>, extra: Record<string, unknown> = {}): AcpPermissionRequest {
  return {
    sessionId: "s",
    inferredKind: (toolCall.kind as AcpPermissionRequest["inferredKind"]) ?? undefined,
    raw: { sessionId: "s", options: [], toolCall: { toolCallId: "t", ...toolCall }, ...extra },
  } as AcpPermissionRequest;
}

const reject = { outcome: "reject_once" };

describe("readOnlyAcpPermissionDecision", () => {
  it.each(["claude", "codex", "gemini"])("rejects edit, delete and move requests for %s", (agent) => {
    for (const kind of ["edit", "delete", "move"]) {
      expect(readOnlyAcpPermissionDecision(agent, request({ kind }))).toEqual(reject);
    }
  });

  it("rejects Claude file-writing tools by name and defers Bash and reads", () => {
    for (const name of ["Edit", "Write", "MultiEdit", "NotebookEdit"]) {
      expect(readOnlyAcpPermissionDecision("claude", request({ name, kind: "other" }))).toEqual(reject);
    }
    expect(readOnlyAcpPermissionDecision("claude", request({ name: "Bash", kind: "execute" }))).toBeUndefined();
    expect(readOnlyAcpPermissionDecision("claude", request({ name: "Read", kind: "read" }))).toBeUndefined();
  });

  it("rejects Codex sandbox escalations and defers reads and MCP tool approvals", () => {
    expect(readOnlyAcpPermissionDecision("codex", request({ kind: "execute" }))).toEqual(reject);
    expect(readOnlyAcpPermissionDecision("codex", request({ kind: "other", title: "Permissions Request" }))).toEqual(reject);
    expect(
      readOnlyAcpPermissionDecision("codex", request({ kind: "execute" }, { _meta: { is_mcp_tool_approval: true } })),
    ).toBeUndefined();
    for (const kind of ["read", "search", "fetch", "think"]) {
      expect(readOnlyAcpPermissionDecision("codex", request({ kind }))).toBeUndefined();
    }
  });
});
