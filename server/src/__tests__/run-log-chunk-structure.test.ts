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

  it("keeps an oversized tool_execution_end line valid JSON so the transcript still pairs it", () => {
    const agents = Array.from({ length: 40 }, (_, index) => ({
      id: `agent-${index}`,
      name: `Agent ${index}`,
      instructionsPath: `/home/agents/agent-${index}/${"instructions".repeat(200)}.md`,
    }));
    const chunk = `${JSON.stringify({
      type: "tool_execution_end",
      toolCallId: "toolu_01EyHjw8gipigp44NGtydR2W",
      toolName: "paperclipListAgents",
      result: { content: [{ type: "text", text: JSON.stringify(agents, null, 2) }] },
    })}\n`;

    expect(chunk.length).toBeGreaterThan(70_000);

    const compacted = compactRunLogChunk(chunk);
    const [line, ...rest] = compacted.split("\n");

    expect(rest).toEqual([""]);
    expect(JSON.parse(line!)).toMatchObject({
      type: "tool_execution_end",
      toolCallId: "toolu_01EyHjw8gipigp44NGtydR2W",
      toolName: "paperclipListAgents",
      truncated: true,
    });
    expect(compacted.length).toBeLessThanOrEqual(64 * 1024);
  });

  it("never splits a JSON line when the whole chunk exceeds the persisted cap", () => {
    const chunk = `${[
      JSON.stringify({ type: "message_start", message: { role: "toolResult", toolCallId: "toolu_1" } }),
      JSON.stringify({ type: "message_end", message: { role: "toolResult", text: "y".repeat(40_000) } }),
      JSON.stringify({ type: "turn_end", message: { role: "assistant", text: "z".repeat(40_000) } }),
      JSON.stringify({ type: "agent_end", messages: [{ role: "custom", text: "w".repeat(40_000) }] }),
    ].join("\n")}\n`;

    const compacted = compactRunLogChunk(chunk, 16_384);
    const lines = compacted.split("\n");

    expect(lines.at(-1)).toBe("");
    expect(lines.slice(0, -1)).toHaveLength(4);
    const types = lines.slice(0, -1).map((line) => {
      const parsed: unknown = JSON.parse(line);
      return parsed && typeof parsed === "object" && "type" in parsed ? parsed.type : null;
    });
    expect(types).toEqual(["message_start", "message_end", "turn_end", "agent_end"]);
    expect(compacted.length).toBeLessThanOrEqual(16_384);
  });
});
