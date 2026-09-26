import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { PaperclipApiClient } from "./client.js";
import { HTTP_STATUS_META_KEY, formatErrorResponse, formatTextResponse } from "./format.js";
import { createToolDefinitions } from "./tools.js";

function makeClient() {
  return new PaperclipApiClient({
    apiUrl: "http://localhost:3100/api",
    apiKey: "token-123",
    companyId: "11111111-1111-1111-1111-111111111111",
    agentId: "22222222-2222-2222-2222-222222222222",
    runId: "33333333-3333-3333-3333-333333333333",
    toolsets: ["core"],
    agentRole: null,
  });
}

function getTool(name: string) {
  const tool = createToolDefinitions(makeClient()).find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  return tool;
}

function mockJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("paperclip MCP error responses", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  for (const status of [400, 401, 403, 404, 500]) {
    it(`marks a ${status} tool failure as an MCP error`, async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(mockJsonResponse({ error: `denied ${status}` }, status)),
      );

      const response = await getTool("paperclipGetIssue").execute({ issueId: "PAP-1" });

      expect(response.isError).toBe(true);
      expect(response.content[0]?.text).toContain(`denied ${status}`);
      expect(response._meta).toEqual({ [HTTP_STATUS_META_KEY]: status });
    });
  }

  it("leaves a successful tool response unflagged", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockJsonResponse({ id: "PAP-1" })));

    const response = await getTool("paperclipGetIssue").execute({ issueId: "PAP-1" });

    expect(response.isError).toBeUndefined();
    expect(response._meta).toBeUndefined();
  });

  it("flattens a validation failure into one readable line per problem", async () => {
    const response = await getTool("paperclipGetIssue").execute({});

    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toBe("issueId: expected string, received undefined");
    expect(response.content[0]?.text).not.toContain('"code"');
  });

  it("lists every invalid field on its own line", async () => {
    const response = await getTool("paperclipListComments").execute({ issueId: "PAP-1", limit: -3 });

    expect(response.isError).toBe(true);
    expect(response.content[0]?.text.split("\n")).toEqual([
      "limit: Too small: expected number to be >0",
    ]);
  });

  it("flags an unknown failure with its message and no status metadata", () => {
    const response = formatErrorResponse(new Error("boom"));

    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toBe('{\n  "error": "boom"\n}');
    expect(response._meta).toBeUndefined();
  });

  it("flags a non-Error throw", () => {
    expect(formatErrorResponse("nope").isError).toBe(true);
  });

  it("keeps the success shape free of error metadata", () => {
    expect(formatTextResponse({ ok: true })).toEqual({
      content: [{ type: "text", text: '{\n  "ok": true\n}' }],
    });
  });

  it("reports a root-level validation problem without an empty path", () => {
    let error: unknown;
    try {
      z.string().parse(1);
    } catch (caught) {
      error = caught;
    }
    expect(formatErrorResponse(error).content[0]?.text).toBe(
      "(root): expected string, received number",
    );
  });
});
