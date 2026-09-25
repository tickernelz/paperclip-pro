import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaperclipApiClient } from "./client.js";
import { hasManagementAuthority, resolveToolsets } from "./config.js";
import { createGeneratedToolDefinitions, generatedToolSpecs } from "./generated-tools.js";
import { createToolDefinitions } from "./tools.js";
import { CURATED_OPERATIONS } from "./tool-overrides.js";

function makeClient() {
  return new PaperclipApiClient({
    apiUrl: "http://localhost:3100/api",
    apiKey: "token-123",
    companyId: "11111111-1111-1111-1111-111111111111",
    agentId: "22222222-2222-2222-2222-222222222222",
    runId: "33333333-3333-3333-3333-333333333333",
    toolsets: ["core", "extended"],
    agentRole: null,
  });
}

function getTool(name: string) {
  const tool = createGeneratedToolDefinitions(makeClient(), ["core", "extended"], true).find(
    (candidate) => candidate.name === name,
  );
  if (!tool) throw new Error(`Missing generated tool ${name}`);
  return tool;
}

function mockJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("generated Paperclip API tools", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fills the company id from config when the route is company scoped", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse([{ id: "label-1" }]));
    vi.stubGlobal("fetch", fetchMock);

    await getTool("paperclipListLabels").execute({});

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe(
      "http://localhost:3100/api/companies/11111111-1111-1111-1111-111111111111/labels",
    );
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("prefers an explicit company id over the configured default", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await getTool("paperclipListLabels").execute({
      companyId: "44444444-4444-4444-4444-444444444444",
    });

    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(String(url)).toBe(
      "http://localhost:3100/api/companies/44444444-4444-4444-4444-444444444444/labels",
    );
  });

  it("sends path and query parameters in the right places", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await getTool("paperclipListIssueWorkProducts").execute({
      id: "PAP-1135",
      refreshPullRequests: "true",
    });

    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(String(url)).toBe(
      "http://localhost:3100/api/issues/PAP-1135/work-products?refreshPullRequests=true",
    );
  });

  it("merges documented body properties into the request body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse({ id: "goal-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await getTool("paperclipUpdateGoal").execute({ id: "55555555-5555-5555-5555-555555555555", title: "Ship it" });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe(
      "http://localhost:3100/api/goals/55555555-5555-5555-5555-555555555555",
    );
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ title: "Ship it" });
    expect((init.headers as Record<string, string>)["X-Paperclip-Run-Id"]).toBe(
      "33333333-3333-3333-3333-333333333333",
    );
  });

  it("passes an undocumented body through the body property", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse({ id: "child-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await getTool("paperclipCreateChildIssue").execute({
      id: "PAP-1135",
      body: { title: "Child", assigneeAgentId: null },
    });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe("http://localhost:3100/api/issues/PAP-1135/children");
    expect(JSON.parse(String(init.body))).toEqual({ title: "Child", assigneeAgentId: null });
  });

  it("reports a failed request instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockJsonResponse({ error: "nope" }, 403)));

    const response = await getTool("paperclipListLabels").execute({});

    expect(response.content[0]?.text).toContain("403");
  });

  it("marks deletions destructive and reads read-only", () => {
    expect(getTool("paperclipDeleteIssue").annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
    expect(getTool("paperclipListLabels").annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    });
  });

  it("registers only the selected toolsets", () => {
    const core = createGeneratedToolDefinitions(makeClient(), ["core"]).map((tool) => tool.name);
    expect(core).toContain("paperclipListLabels");
    expect(core).not.toContain("paperclipDeleteIssue");
    expect(core.length).toBeLessThan(
      createGeneratedToolDefinitions(makeClient(), ["core", "extended"], true).length,
    );
  });

  it("hides board-authority tools unless the caller has management authority", () => {
    const withoutManagement = createGeneratedToolDefinitions(makeClient(), ["core", "extended"]);
    const withManagement = createGeneratedToolDefinitions(makeClient(), ["core", "extended"], true);
    const boardOnly = generatedToolSpecs().filter((spec) => spec.authority === "board");

    expect(boardOnly.length).toBeGreaterThan(0);
    expect(withManagement.length - withoutManagement.length).toBe(boardOnly.length);
    expect(withoutManagement.map((tool) => tool.name)).not.toContain(boardOnly[0].name);
    expect(
      boardOnly.every((spec) =>
        spec.authoritySource === "handler" ? spec.boardGuard !== null : spec.authoritySource === "registry",
      ),
    ).toBe(true);
  });

  it("treats only management roles as board authority", () => {
    expect(hasManagementAuthority("ceo")).toBe(true);
    expect(hasManagementAuthority("CEO")).toBe(true);
    expect(hasManagementAuthority("engineer")).toBe(false);
    expect(hasManagementAuthority(null)).toBe(false);
  });

  it("defaults to the core toolset and honours explicit selection", () => {
    expect(resolveToolsets({}, [])).toEqual(["core"]);
    expect(resolveToolsets({ PAPERCLIP_MCP_TOOLSETS: "core,extended" }, [])).toEqual([
      "core",
      "extended",
    ]);
    expect(resolveToolsets({ PAPERCLIP_MCP_TOOLSETS: "core" }, ["--toolsets", "all"])).toEqual([
      "core",
      "extended",
    ]);
    expect(resolveToolsets({ PAPERCLIP_MCP_TOOLSETS: "nonsense" }, [])).toEqual(["core"]);
  });

  it("never collides with a curated tool name or repeats a route", () => {
    const curated = createToolDefinitions(makeClient()).map((tool) => tool.name);
    const generated = generatedToolSpecs();
    const names = generated.map((spec) => spec.name);

    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((name) => curated.includes(name))).toEqual([]);
    expect(
      generated.filter((spec) => CURATED_OPERATIONS[spec.operationId] !== undefined),
    ).toEqual([]);
  });

  it("builds a usable input schema for every generated tool", () => {
    const tools = createGeneratedToolDefinitions(makeClient(), ["core", "extended"], true);
    expect(tools.length).toBe(generatedToolSpecs().length);
    for (const tool of tools) {
      expect(Object.keys(tool.schema.shape).length).toBeGreaterThanOrEqual(0);
    }
  });
});
