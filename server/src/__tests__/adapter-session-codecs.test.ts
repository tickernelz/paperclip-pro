import { describe, expect, it } from "vitest";
import { sessionCodec as codexSessionCodec } from "../services/ai-providers/codex/session-codec.js";
import { isCodexUnknownSessionError } from "../services/ai-providers/codex/parse.js";

describe("adapter session codecs", () => {
  it("normalizes codex session params with cwd", () => {
    const parsed = codexSessionCodec.deserialize({
      sessionId: "codex-session-1",
      cwd: "/tmp/codex",
    });
    expect(parsed).toEqual({
      sessionId: "codex-session-1",
      cwd: "/tmp/codex",
    });

    const serialized = codexSessionCodec.serialize(parsed);
    expect(serialized).toEqual({
      sessionId: "codex-session-1",
      cwd: "/tmp/codex",
    });
    expect(codexSessionCodec.getDisplayId?.(serialized ?? null)).toBe("codex-session-1");
  });

  it("preserves codex ACP session params for ACP lane resumes", () => {
    const parsed = codexSessionCodec.deserialize({
      sessionKey: "paperclip:company:agent:task:fingerprint",
      runtimeSessionName: "runtime-session-1",
      acpxRecordId: "record-1",
      acpSessionId: "acp-session-1",
      agentSessionId: "agent-session-1",
      agent: "codex",
      cwd: "/tmp/codex-acp",
      mode: "persistent",
      stateDir: "/tmp/codex-acp-state",
      configFingerprint: "fingerprint",
      workspaceId: "workspace-1",
    });

    expect(parsed).toMatchObject({
      runtimeSessionName: "runtime-session-1",
      acpSessionId: "acp-session-1",
      agent: "codex",
      cwd: "/tmp/codex-acp",
      configFingerprint: "fingerprint",
      workspaceId: "workspace-1",
    });
    expect(codexSessionCodec.serialize(parsed)).toEqual(parsed);
    expect(codexSessionCodec.getDisplayId?.(parsed)).toBe("runtime-session-1");
  });
});

describe("codex resume recovery detection", () => {
  it("detects unknown session errors from codex output", () => {
    expect(
      isCodexUnknownSessionError(
        '{"type":"error","message":"Unknown session id abc"}',
        "",
      ),
    ).toBe(true);
    expect(
      isCodexUnknownSessionError(
        "",
        "thread 123 not found",
      ),
    ).toBe(true);
    expect(
      isCodexUnknownSessionError(
        '{"type":"result","ok":true}',
        "",
      ),
    ).toBe(false);
  });
});
