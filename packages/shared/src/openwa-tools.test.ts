import { describe, expect, it } from "vitest";
import { z } from "zod";
import { OPENWA_TOOLS, OPENWA_TOOL_SCHEMA_BUDGET_BYTES, openwaTool } from "./openwa-tools.js";

describe("OpenWA tool catalog", () => {
  it("keeps every tool schema within the context budget", () => {
    const listing = OPENWA_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
    expect(Buffer.byteLength(JSON.stringify(listing))).toBeLessThanOrEqual(OPENWA_TOOL_SCHEMA_BUDGET_BYTES);
    expect(OPENWA_TOOL_SCHEMA_BUDGET_BYTES).toBe(12_000);
  });

  it("exposes the first-class tools with a risk and no run-context arguments", () => {
    expect(OPENWA_TOOLS.map((tool) => [tool.name, tool.risk])).toEqual([
      ["openwa_send", "write"],
      ["openwa_read_chat", "read"],
      ["openwa_get_media", "read"],
      ["openwa_find", "read"],
      ["openwa_stay_silent", "write"],
      ["openwa_handoff", "write"],
    ]);
    for (const tool of OPENWA_TOOLS) {
      const properties = Object.keys((tool.inputSchema.properties ?? {}) as Record<string, unknown>);
      for (const forbidden of ["companyId", "endpointId", "sessionId", "issueId", "runId", "profile", "triggerClass"])
        expect(properties).not.toContain(forbidden);
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });

  it("validates send shapes per kind and requires an idempotency key", () => {
    const send = openwaTool("openwa_send")!.schema;
    const key = "9c0dc094-41b6-4d84-a2f1-1df331774489";
    expect(send.safeParse({ text: "hi", idempotencyKey: key }).success).toBe(true);
    expect(send.safeParse({ text: "hi" }).success).toBe(false);
    expect(send.safeParse({ kind: "image", idempotencyKey: key }).success).toBe(false);
    expect(send.safeParse({ kind: "voice", attachmentId: key, idempotencyKey: key }).success).toBe(true);
    expect(send.safeParse({ kind: "poll", poll: { question: "Lunch?", options: ["a", "b"] }, idempotencyKey: key }).success).toBe(true);
    expect(send.safeParse({ kind: "poll", poll: { question: "Lunch?", options: ["a"] }, idempotencyKey: key }).success).toBe(false);
    expect(send.safeParse({ text: "hi", mentions: ["not-a-number"], idempotencyKey: key }).success).toBe(false);
    expect(send.safeParse({ text: "hi", companyId: key, idempotencyKey: key }).success).toBe(false);
    expect(openwaTool("openwa_find")!.schema.safeParse({ query: "a", phone: "+628111" }).success).toBe(false);
    expect(z.toJSONSchema(openwaTool("openwa_handoff")!.schema)).toMatchObject({ required: ["triggerIds", "note"] });
  });
});
