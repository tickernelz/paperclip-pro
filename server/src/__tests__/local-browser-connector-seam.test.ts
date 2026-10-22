import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { Db } from "@tickernelz/paperclip-pro-db";
import { instanceSettings, localBrowserConnections } from "@tickernelz/paperclip-pro-db";
import { localBrowserService } from "../services/local-browser/service.js";
import { registerSession, resetSessions } from "../services/local-browser/registry.js";
import type { BridgeSocket } from "../services/local-browser/types.js";
import { executeConnectorTool, resolveConnectorAssignments } from "../services/connector-runtime.js";

const settingsRow = {
  singletonKey: "default",
  general: {},
  experimental: {},
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const pairedConnections: Array<Record<string, unknown>> = [];

function stubDb(): Db {
  const chain = (rows: unknown[]) => {
    const query = {
      where: () => query,
      innerJoin: () => query,
      leftJoin: () => query,
      orderBy: () => Promise.resolve(rows),
      limit: () => Promise.resolve(rows),
      then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
    };
    return query;
  };
  return {
    select: () => ({
      from: (table: unknown) => chain(
        table === instanceSettings
          ? [settingsRow]
          : table === localBrowserConnections
            ? pairedConnections
            : [],
      ),
    }),
  } as unknown as Db;
}

const socket: BridgeSocket = {
  readyState: 1,
  send: () => {},
  close: () => {},
  terminate: () => {},
  on: () => {},
};

const db = stubDb();
const companyId = "11111111-1111-4111-8111-111111111111";
const binding = {
  companyId,
  agentId: "22222222-2222-4222-8222-222222222222",
  runId: "77777777-7777-4777-8777-777777777777",
  issueId: "88888888-8888-4888-8888-888888888888",
};

function pair(ownerUserId: string | null, label: string, connectedAt: Date) {
  return registerSession({
    socket,
    companyId,
    connectionId: randomUUID(),
    createdByUserId: ownerUserId,
    createdByAgentId: null,
    client: "chromium",
    clientVersion: "0.1.0",
    label,
    profileName: null,
    tabs: [{ tabId: 1, title: "Inbox", url: "https://app.example.com/inbox", active: true }],
    tier: "refine",
    allowedOrigins: ["https://app.example.com"],
    tokenHash: randomUUID(),
    now: connectedAt,
  });
}

afterEach(() => {
  resetSessions();
  pairedConnections.length = 0;
});

describe("Local Browser connector seam", () => {
  it("reports an empty browser list instead of throwing when nothing is paired", async () => {
    await expect(
      executeConnectorTool(db, binding, "local_browser_sessions", {}),
    ).resolves.toEqual({ sessions: [] });
  });

  it("keeps the tool manifest assigned while no browser is connected", async () => {
    const assignments = await resolveConnectorAssignments(db, binding);
    const localBrowser = assignments.find((entry) => entry.key === "local-browser");
    expect(localBrowser).toBeTruthy();
    expect(localBrowser!.resources).toEqual([]);
    expect(localBrowser!.tools.map((tool) => tool.name)).toContain("local_browser_snapshot");
  });

  it("lists a paired browser that is not connected right now", async () => {
    const connectionId = randomUUID();
    pairedConnections.push({
      id: connectionId,
      companyId,
      label: "Firefox on win",
      client: "firefox",
      tier: "full",
      createdByUserId: "user-alice",
      status: "active",
      connectedAt: new Date("2026-10-21T00:00:00.000Z"),
    });

    const assignments = await resolveConnectorAssignments(db, binding);
    const localBrowser = assignments.find((entry) => entry.key === "local-browser");
    expect(localBrowser!.resources).toHaveLength(1);
    expect(localBrowser!.resources[0]).toMatchObject({
      id: connectionId,
      connectionId,
      metadata: { live: false, client: "firefox", tier: "full" },
    });
    expect(localBrowser!.resources[0]!.label).toContain("not connected");
  });

  it("marks a live session as live next to the paired record", async () => {
    const connectionId = randomUUID();
    pairedConnections.push({
      id: connectionId,
      companyId,
      label: "Alice laptop",
      client: "chromium",
      tier: "refine",
      createdByUserId: "user-alice",
      status: "active",
      connectedAt: new Date("2026-10-21T00:00:00.000Z"),
    });
    const session = registerSession({
      socket,
      companyId,
      connectionId,
      createdByUserId: "user-alice",
      createdByAgentId: null,
      client: "chromium",
      clientVersion: "0.1.0",
      label: "Alice laptop",
      profileName: null,
      tabs: [{ tabId: 1, title: "Inbox", url: "https://app.example.com/inbox", active: true }],
      tier: "refine",
      allowedOrigins: ["https://app.example.com"],
      tokenHash: randomUUID(),
      now: new Date("2026-10-21T00:01:00.000Z"),
    });

    const assignments = await resolveConnectorAssignments(db, binding);
    const resources = assignments.find((entry) => entry.key === "local-browser")!.resources;
    expect(resources).toHaveLength(1);
    expect(resources[0]).toMatchObject({ id: session.sessionId, metadata: { live: true } });
  });

  it("raises local_browser_not_paired with its hint once the browser is gone", async () => {
    const error = await executeConnectorTool(db, binding, "local_browser_snapshot", {
      selector: "main",
    }).catch((failure: unknown) => failure as { code?: string; details?: { hint?: string } });
    expect(error).toMatchObject({ code: "local_browser_not_paired" });
    expect((error as { details?: { hint?: string } }).details?.hint).toContain("pair");
  });

  it("refuses an untargeted call when two different people have browsers live", async () => {
    pair("user-alice", "Alice laptop", new Date("2026-10-21T00:00:00.000Z"));
    pair("user-bob", "Bob laptop", new Date("2026-10-21T00:01:00.000Z"));

    const sessions = await executeConnectorTool(db, binding, "local_browser_sessions", {});
    expect((sessions as { sessions: unknown[] }).sessions).toHaveLength(2);
    expect(
      (sessions as { sessions: { label: string; ownerUserId?: string | null }[] }).sessions.map(
        (session) => session.ownerUserId,
      ),
    ).toEqual(["user-alice", "user-bob"]);

    await expect(
      executeConnectorTool(db, binding, "local_browser_snapshot", { selector: "main" }),
    ).rejects.toMatchObject({ code: "local_browser_not_paired" });
  });

  it("selects the single owner's browser when only one person is paired", async () => {
    const session = pair("user-alice", "Alice laptop", new Date("2026-10-21T00:00:00.000Z"));
    const error = await localBrowserService(db, { callTimeoutMs: 50 })
      .executeTool(
        { companyId, agentId: binding.agentId, runId: binding.runId, issueId: binding.issueId },
        "local_browser_snapshot",
        { selector: "main" },
      )
      .catch((failure: unknown) => failure as { code?: string });
    expect(error).toMatchObject({ code: "local_browser_timeout" });
    expect(session.sessionId).toBeTruthy();
  });
});
