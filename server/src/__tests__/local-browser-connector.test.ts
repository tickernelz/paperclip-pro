import { describe, expect, it, vi } from "vitest";
import type { Db } from "@tickernelz/paperclip-pro-db";
import { instanceSettings } from "@tickernelz/paperclip-pro-db";
import { LOCAL_BROWSER_TOOL_NAMES } from "@tickernelz/paperclip-pro-shared";

const { listSessions, executeTool } = vi.hoisted(() => ({
  listSessions: vi.fn(),
  executeTool: vi.fn(),
}));

vi.mock("../services/local-browser/service.js", () => ({
  localBrowserService: () => ({ listSessions, executeTool }),
}));

const {
  executeConnectorTool,
  isConnectorSkill,
  isConnectorTool,
  resolveConnectorAssignments,
} = await import("../services/connector-runtime.js");

const settingsRow = {
  singletonKey: "default",
  general: {},
  experimental: {},
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

function stubDb(): Db {
  const rowsFor = (table: unknown) => (table === instanceSettings ? [settingsRow] : []);
  const chain = (rows: unknown[]) => {
    const query = {
      where: () => Promise.resolve(rows),
      innerJoin: () => query,
      leftJoin: () => query,
      orderBy: () => Promise.resolve(rows),
      limit: () => Promise.resolve(rows),
    };
    return query;
  };
  return {
    select: () => ({ from: (table: unknown) => chain(rowsFor(table)) }),
  } as unknown as Db;
}

const db = stubDb();
const binding = {
  companyId: "11111111-1111-4111-8111-111111111111",
  agentId: "22222222-2222-4222-8222-222222222222",
};

function liveSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "33333333-3333-4333-8333-333333333333",
    connectionId: "44444444-4444-4444-8444-444444444444",
    client: "chromium",
    clientVersion: "0.1.0",
    label: "Work laptop",
    profileName: null,
    tier: "refine",
    connectedAt: "2026-10-21T00:00:00.000Z",
    lastSeenAt: "2026-10-21T00:00:05.000Z",
    tabs: [],
    controlledByViewer: false,
    ...overrides,
  };
}

describe("Local Browser connector", () => {
  it("stays unassigned while no browser is paired", async () => {
    listSessions.mockReturnValue([]);
    await expect(resolveConnectorAssignments(db, binding)).resolves.toEqual([]);
    expect(listSessions).toHaveBeenCalledWith(binding.companyId);
  });

  it("exposes one resource per live paired browser", async () => {
    listSessions.mockReturnValue([
      liveSession(),
      liveSession({
        sessionId: "55555555-5555-4555-8555-555555555555",
        connectionId: "66666666-6666-4666-8666-666666666666",
        client: "firefox",
        label: "Personal",
      }),
    ]);

    const assignments = await resolveConnectorAssignments(db, binding);
    const assignment = assignments.find((entry) => entry.key === "local-browser");
    expect(assignment).toBeDefined();
    expect(assignment!.skillKey).toBe("paperclipai/paperclip/local-browser");
    expect(assignment!.resources).toEqual([
      {
        id: "33333333-3333-4333-8333-333333333333",
        label: "chromium — Work laptop",
        connectionId: "44444444-4444-4444-8444-444444444444",
      },
      {
        id: "55555555-5555-4555-8555-555555555555",
        label: "firefox — Personal",
        connectionId: "66666666-6666-4666-8666-666666666666",
      },
    ]);
    expect(assignment!.tools.map((tool) => tool.name)).toEqual([...LOCAL_BROWSER_TOOL_NAMES]);
  });

  it("never offers the viewer or raw input channel to agents", () => {
    expect(LOCAL_BROWSER_TOOL_NAMES).not.toContain("local_browser_viewer");
    expect(LOCAL_BROWSER_TOOL_NAMES).not.toContain("local_browser_input");
    expect(isConnectorTool("local_browser_viewer")).toBe(false);
    expect(isConnectorTool("local_browser_input")).toBe(false);
    expect(isConnectorTool("local_browser_snapshot")).toBe(true);
    expect(isConnectorSkill("paperclipai/paperclip/local-browser")).toBe(true);
  });

  it("delegates a call to the local browser service", async () => {
    listSessions.mockReturnValue([liveSession()]);
    executeTool.mockResolvedValue({ url: "https://example.test/", nodes: [] });
    const value = { tabId: 7, selector: "main" };

    await expect(
      executeConnectorTool(
        db,
        { ...binding, runId: "77777777-7777-4777-8777-777777777777", issueId: "88888888-8888-4888-8888-888888888888" },
        "local_browser_snapshot",
        value,
      ),
    ).resolves.toEqual({ url: "https://example.test/", nodes: [] });

    expect(executeTool).toHaveBeenCalledWith(
      {
        companyId: binding.companyId,
        agentId: binding.agentId,
        runId: "77777777-7777-4777-8777-777777777777",
        issueId: "88888888-8888-4888-8888-888888888888",
      },
      "local_browser_snapshot",
      value,
    );
  });

  it("still dispatches when the last browser disconnected mid-run so the service can explain why", async () => {
    listSessions.mockReturnValue([]);
    executeTool.mockReset();
    executeTool.mockRejectedValue(
      Object.assign(new Error("[local_browser_not_paired] No browser is paired for this company"), {
        code: "local_browser_not_paired",
      }),
    );
    await expect(
      executeConnectorTool(db, { ...binding, runId: "r", issueId: "i" }, "local_browser_snapshot", {
        selector: "main",
      }),
    ).rejects.toMatchObject({ code: "local_browser_not_paired" });
    expect(executeTool).toHaveBeenCalledTimes(1);
  });

  it("labels each resource with the browser owner so one person's browser is never mistaken for another's", async () => {
    listSessions.mockReturnValue([
      liveSession({ ownerUserId: "user-alice" }),
      liveSession({
        sessionId: "55555555-5555-4555-8555-555555555555",
        connectionId: "66666666-6666-4666-8666-666666666666",
        label: "Personal",
        ownerUserId: null,
      }),
    ]);
    const assignment = (await resolveConnectorAssignments(db, binding)).find(
      (entry) => entry.key === "local-browser",
    )!;
    expect(assignment.resources.map((resource) => resource.label)).toEqual([
      "chromium — Work laptop · owner user-alice",
      "chromium — Personal",
    ]);
  });

  it("refuses an internal-only tool name", async () => {
    listSessions.mockReturnValue([liveSession()]);
    executeTool.mockClear();
    await expect(
      executeConnectorTool(db, { ...binding, runId: "r", issueId: "i" }, "local_browser_input", {
        kind: "key",
      }),
    ).rejects.toThrow("no longer assigned");
    expect(executeTool).not.toHaveBeenCalled();
  });
});
