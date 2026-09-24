import { describe, expect, it } from "vitest";
import { compactRunLogChunk } from "../services/heartbeat.js";

const SECRET = "sk-fake-AAAABBBBCCCCDDDDEEEEFFFF0011";

function jsonLines(chunk: string) {
  const segments = chunk.split("\n");
  const complete = segments.slice(0, -1);
  return complete.filter((line) => line.startsWith("{") || line.startsWith("["));
}

function expectEveryLineParses(chunk: string) {
  for (const line of jsonLines(chunk)) expect(() => JSON.parse(line)).not.toThrow();
}

describe("run-log chunk structure-aware redaction", () => {
  it("keeps an env dump inside an escaped tool_execution_end string parseable", () => {
    const envDump = [
      "PAPERCLIP_AGENT_ID=abcdef01-2345-6789-abcd-ef0123456789",
      `PAPERCLIP_API_KEY=${SECRET}`,
      'PAPERCLIP_ALLOWED_PATHS=["/etc/resolv.conf","/etc/hosts","/etc/ssl/certs"]',
      "PAPERCLIP_BASE_URL=https://paperclip.example/",
    ].join("\n");
    const chunk = `${JSON.stringify({
      type: "tool_execution_end",
      toolCallId: "toolu_01AAAABBBBCCCCDDDDEEEE",
      toolName: "fabric_exec",
      result: { content: [{ type: "text", text: envDump }] },
    })}\n`;

    const compacted = compactRunLogChunk(chunk);

    expectEveryLineParses(compacted);
    expect(compacted).not.toContain(SECRET);
    expect(compacted).toContain("/etc/resolv.conf");
    expect(compacted).toContain("PAPERCLIP_BASE_URL=https://paperclip.example/");
    expect(JSON.parse(compacted.split("\n")[0]!).toolName).toBe("fabric_exec");
  });

  it("keeps a Bearer-prefixed toolcall_delta fragment parseable", () => {
    const chunk = `${JSON.stringify({
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_delta",
        contentIndex: 0,
        delta: "Bearer ",
      },
    })}\n${JSON.stringify({ type: "message_update", contentIndex: 1 })}\n`;

    const compacted = compactRunLogChunk(chunk);

    expectEveryLineParses(compacted);
    expect(jsonLines(compacted)).toHaveLength(2);
  });

  it("does not eat the closing quote of a Bearer credential ending a delta", () => {
    const record = JSON.stringify({
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_delta",
        contentIndex: 0,
        delta: `Bearer ${SECRET}`,
      },
    });
    const chunk = `${record}\n${JSON.stringify({ type: "message_update", contentIndex: 1 })}\n`;

    const compacted = compactRunLogChunk(chunk);

    expectEveryLineParses(compacted);
    expect(compacted).not.toContain(SECRET);
    expect(jsonLines(compacted)).toHaveLength(2);
    expect(
      JSON.parse(jsonLines(compacted)[0]!).assistantMessageEvent.contentIndex,
    ).toBe(0);
  });

  it("does not let a credential span glue two adjacent log lines", () => {
    const chunk = `${JSON.stringify({ type: "a", apiKey: SECRET })}\n${JSON.stringify({
      type: "b",
      note: "kept-visible-note",
    })}\n`;

    const compacted = compactRunLogChunk(chunk);

    expectEveryLineParses(compacted);
    expect(compacted).not.toContain(SECRET);
    expect(jsonLines(compacted)).toHaveLength(2);
    expect(JSON.parse(jsonLines(compacted)[1]!).note).toBe("kept-visible-note");
  });

  it("redacts credential-named keys while preserving neighbouring values", () => {
    const chunk = `${JSON.stringify({
      authorization: SECRET,
      token: SECRET,
      apiKey: SECRET,
      model: "claude-opus",
      count: 7,
    })}\n`;

    const compacted = compactRunLogChunk(chunk);

    expectEveryLineParses(compacted);
    const parsed = JSON.parse(compacted.split("\n")[0]!);
    expect(parsed.authorization).toBe("***REDACTED***");
    expect(parsed.token).toBe("***REDACTED***");
    expect(parsed.apiKey).toBe("***REDACTED***");
    expect(parsed.model).toBe("claude-opus");
    expect(parsed.count).toBe(7);
  });

  it("leaves a trailing partial line on the text redactor", () => {
    const chunk = `${JSON.stringify({ type: "a" })}\n{"type":"b","apiKey":"${SECRET}`;

    const compacted = compactRunLogChunk(chunk);

    expect(compacted).not.toContain(SECRET);
    expect(compacted.endsWith("\n")).toBe(false);
    expect(compacted.split("\n")).toHaveLength(2);
    expect(() => JSON.parse(compacted.split("\n")[0]!)).not.toThrow();
  });

  it("still redacts plain-text lines that are not JSON", () => {
    const chunk = `Authorization: Bearer ${SECRET}\nplain tail line\n`;

    const compacted = compactRunLogChunk(chunk);

    expect(compacted).not.toContain(SECRET);
    expect(compacted).toContain("plain tail line");
  });
});
