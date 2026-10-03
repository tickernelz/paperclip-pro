import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  activityLog,
  agents,
  authUsers,
  chatAuditEntries,
  chatConversations,
  chatEndpointOwners,
  chatEndpoints,
  chatExternalPrincipals,
  chatIdentityLinks,
  companies,
  companyMemberships,
  createDb,
  heartbeatRuns,
  issues,
  toolApplications,
  toolConnections,
} from "@tickernelz/paperclip-pro-db";
import { CHAT_AUDIT_ENTRY_KINDS, type ChatAuditEntryKind } from "@tickernelz/paperclip-pro-shared";
import { startEmbeddedPostgresTestDatabase } from "../helpers/embedded-postgres.js";
import { describeEmbeddedPostgres } from "../helpers/route-test-harness.js";
import { errorHandler } from "../../middleware/index.js";
import { chatChannelRoutes } from "../../routes/chat-channels.js";
import { chatChannelService, type ChatChannelService } from "../../services/chat-channels.js";
import { ChatSdkRuntime } from "../../services/chat-sdk-runtime.js";
import { REDACTED_EVENT_VALUE } from "../../redaction.js";
import {
  OPENWA_ACTIVITY_ACTIONS,
  OPENWA_AUDIT_ARG_LIMIT_BYTES,
  OPENWA_AUDIT_CONTENT_LIMIT_BYTES,
  OPENWA_AUDIT_RESULT_LIMIT_BYTES,
  listOpenwaAudit,
  logOpenwaActivity,
  openwaAuditPurgeScheduler,
  purgeOpenwaAuditContent,
  recordOpenwaAudit,
} from "../../services/openwa/audit.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const CHAT = "628111222333@c.us";
const GROUP = "120363000000000001@g.us";

type BoardUser = { userId: string; role: string };

interface Fixture {
  companyId: string;
  endpointId: string;
  agentId: string;
  conversationId: string;
  companyOwner: BoardUser;
  endpointOwner: BoardUser;
  member: BoardUser;
}

describeEmbeddedPostgres("OpenWA audit and retention", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  const services: ChatChannelService[] = [];

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-openwa-audit-");
    db = createDb(database.connectionString);
  }, 30_000);

  afterEach(async () => {
    await Promise.all(services.splice(0).map((service) => service.shutdown()));
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await database?.cleanup();
  });

  async function user(companyId: string, role: string): Promise<BoardUser> {
    const userId = "user-" + randomUUID();
    const now = new Date();
    await db.insert(authUsers).values({ id: userId, name: role, email: userId + "@example.test", emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: role });
    return { userId, role };
  }

  async function seed(policy: Record<string, unknown> = {}): Promise<Fixture> {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const endpointId = randomUUID();
    const applicationId = randomUUID();
    const connectionId = randomUUID();
    const issueId = randomUUID();
    await db.insert(companies).values({
      id: companyId, name: "OpenWA audit", issuePrefix: "A" + companyId.replace(/-/g, "").slice(0, 7).toUpperCase(),
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId, companyId, name: "WA agent", role: "engineer", status: "idle",
      adapterType: "claude_local", adapterConfig: {}, runtimeConfig: {}, permissions: {},
    });
    await db.insert(issues).values({ id: issueId, companyId, title: "WhatsApp chat", status: "todo", assigneeAgentId: agentId });
    await db.insert(toolApplications).values({
      id: applicationId, companyId, applicationKey: "chat:openwa:" + endpointId, name: "OpenWA", type: "chat", status: "active",
    });
    await db.insert(toolConnections).values({
      id: connectionId, companyId, applicationId, name: "OpenWA", uid: "chat-openwa-" + endpointId,
      connectionPurpose: "channel", transport: "chat_sdk", status: "active", enabled: true,
    });
    await db.insert(chatEndpoints).values({
      id: endpointId, companyId, connectionId, provider: "openwa", publicId: randomUUID(), assignedAgentId: agentId,
      status: "active", providerAccountId: "http://gw#session-" + endpointId, policy,
    });
    const companyOwner = await user(companyId, "owner");
    const endpointOwner = await user(companyId, "operator");
    const member = await user(companyId, "operator");
    const [principal] = await db.insert(chatExternalPrincipals).values({
      companyId, provider: "openwa", providerAccountId: "acct-" + endpointId, externalId: "628999888777@c.us", displayName: "Owner WA",
    }).returning();
    const [link] = await db.insert(chatIdentityLinks).values({
      companyId, endpointId, principalId: principal!.id, paperclipUserId: endpointOwner.userId, status: "linked",
    }).returning();
    await db.insert(chatEndpointOwners).values({ companyId, endpointId, identityLinkId: link!.id, addedByUserId: companyOwner.userId });
    const [conversation] = await db.insert(chatConversations).values({
      companyId, endpointId, issueId, externalConversationId: "openwa:session:" + CHAT, externalThreadId: "openwa:session:" + CHAT,
      externalLabel: "Member", state: "active", isDirectMessage: true,
    }).returning();
    return { companyId, endpointId, agentId, conversationId: conversation!.id, companyOwner, endpointOwner, member };
  }

  function fakeRuntime(): ChatSdkRuntime {
    const runtime = new ChatSdkRuntime();
    vi.spyOn(runtime, "replaceEndpoint").mockImplementation(async () => ({ initialize: async () => undefined, shutdown: async () => undefined }) as never);
    vi.spyOn(runtime, "get").mockImplementation(() => null);
    vi.spyOn(runtime, "removeEndpoint").mockImplementation(async () => true);
    return runtime;
  }

  function app(companyId: string, viewer: BoardUser) {
    const service = chatChannelService(db, {
      runtime: fakeRuntime(),
      publicBaseUrl: "https://paperclip.example",
      heartbeat: { wakeup: async () => ({ accepted: true }) } as never,
      scheduleDeferredWork: () => {},
    });
    services.push(service);
    const server = express();
    server.use(express.json());
    server.use((req, _res, next) => {
      req.actor = {
        type: "board",
        source: "session",
        userId: viewer.userId,
        isInstanceAdmin: false,
        companyIds: [companyId],
        memberships: [{ companyId, status: "active", membershipRole: viewer.role }],
      } as never;
      next();
    });
    server.use("/api", chatChannelRoutes(db, { heartbeat: { wakeup: async () => undefined } as never, service }));
    server.use(errorHandler);
    return server;
  }

  async function record(t: Fixture, kind: ChatAuditEntryKind, occurredAt: Date, extra: { chatKey?: string; actorKind?: "user" | "agent" | "chat_principal" | "system"; text?: string } = {}) {
    await recordOpenwaAudit(db, {
      companyId: t.companyId,
      endpointId: t.endpointId,
      conversationId: t.conversationId,
      chatKey: extra.chatKey ?? CHAT,
      kind,
      actorKind: extra.actorKind ?? "system",
      metadata: { marker: kind + "@" + occurredAt.toISOString() },
      content: { text: extra.text ?? "secret message for " + kind },
      occurredAt,
    });
  }

  it("shows content to company and endpoint owners, metadata only to plain board users, and 404 to another company", async () => {
    const t = await seed();
    const other = await seed();
    await record(t, "message_sent", new Date("2026-10-01T10:00:00.000Z"), { actorKind: "agent", text: "Hello Budi, the invoice is ready" });
    const path = "/api/chat-endpoints/" + t.endpointId + "/audit";

    for (const viewer of [t.companyOwner, t.endpointOwner]) {
      const response = await request(app(t.companyId, viewer)).get(path);
      expect(response.status).toBe(200);
      expect(response.body.access).toBe("content");
      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0]).toMatchObject({
        kind: "message_sent",
        actorKind: "agent",
        chatKey: CHAT,
        content: { text: "Hello Budi, the invoice is ready" },
        contentPurged: false,
      });
      expect(response.headers["cache-control"]).toBe("no-store");
    }

    const plain = await request(app(t.companyId, t.member)).get(path);
    expect(plain.status).toBe(200);
    expect(plain.body.access).toBe("metadata");
    expect(plain.body.items[0].content).toBeNull();
    expect(plain.body.items[0].metadata.marker).toMatch(/^message_sent@/);
    expect(JSON.stringify(plain.body)).not.toContain("invoice");

    const foreign = await request(app(other.companyId, other.companyOwner)).get(path);
    expect(foreign.status).toBe(404);
    expect(JSON.stringify(foreign.body)).not.toContain("invoice");
  });

  it("drops endpoint-owner content access when the identity link is revoked", async () => {
    const t = await seed();
    await record(t, "approval_requested", new Date("2026-10-01T10:00:00.000Z"), { text: "Please approve the refund" });
    await db.update(chatIdentityLinks).set({ status: "revoked" }).where(eq(chatIdentityLinks.endpointId, t.endpointId));
    const page = await listOpenwaAudit(db, {
      companyId: t.companyId,
      endpointId: t.endpointId,
      viewer: { type: "board", userId: t.endpointOwner.userId, instanceAdmin: false },
    });
    expect(page.access).toBe("metadata");
    expect(page.items[0]!.content).toBeNull();
  });

  it("scopes the service to the caller's company", async () => {
    const t = await seed();
    const other = await seed();
    await record(t, "tool_called", new Date("2026-10-01T10:00:00.000Z"));
    await expect(listOpenwaAudit(db, {
      companyId: other.companyId,
      endpointId: t.endpointId,
      viewer: { type: "board", userId: other.companyOwner.userId, instanceAdmin: false },
    })).rejects.toMatchObject({ status: 404 });
  });

  it("gives owner-class runs content and refuses other runs", async () => {
    const t = await seed();
    await record(t, "config_changed", new Date("2026-10-01T10:00:00.000Z"), { text: "before/after" });
    const run = async (triggerClass: string, endpointId = t.endpointId) => {
      const id = randomUUID();
      await db.insert(heartbeatRuns).values({
        id, companyId: t.companyId, agentId: t.agentId, status: "running", startedAt: new Date(),
        contextSnapshot: { paperclipOpenwa: { endpointId, chatKey: CHAT, triggerClass, profile: triggerClass === "owner" ? "full" : "read_only", grantIds: [] } },
      });
      return id;
    };
    const owner = await listOpenwaAudit(db, { companyId: t.companyId, endpointId: t.endpointId, viewer: { type: "owner_run", runId: await run("owner") } });
    expect(owner.access).toBe("content");
    expect(owner.items[0]!.content).toEqual({ text: "before/after" });
    await expect(listOpenwaAudit(db, { companyId: t.companyId, endpointId: t.endpointId, viewer: { type: "owner_run", runId: await run("other") } }))
      .rejects.toMatchObject({ status: 403 });
    await expect(listOpenwaAudit(db, { companyId: t.companyId, endpointId: t.endpointId, viewer: { type: "owner_run", runId: await run("owner", randomUUID()) } }))
      .rejects.toMatchObject({ status: 403 });
  });

  it("filters by kind, chat, actor and time and pages with a cursor without gaps", async () => {
    const t = await seed();
    const base = Date.parse("2026-10-01T00:00:00.000Z");
    const same = new Date(base + 5 * 60_000);
    for (let index = 0; index < 26; index++) {
      const kind = CHAT_AUDIT_ENTRY_KINDS[index % CHAT_AUDIT_ENTRY_KINDS.length]!;
      const occurredAt = index < 4 ? same : new Date(base + index * 60_000);
      await record(t, kind, occurredAt, { chatKey: index % 2 === 0 ? CHAT : GROUP, actorKind: index % 3 === 0 ? "agent" : "system" });
    }
    const owner = app(t.companyId, t.companyOwner);
    const path = "/api/chat-endpoints/" + t.endpointId + "/audit";
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const response = await request(owner).get(path).query({ limit: "10", ...(cursor ? { cursor } : {}) });
      expect(response.status).toBe(200);
      seen.push(...response.body.items.map((item: { id: string }) => item.id));
      cursor = response.body.nextCursor;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(26);
    expect(new Set(seen).size).toBe(26);
    const all = await listOpenwaAudit(db, { companyId: t.companyId, endpointId: t.endpointId, viewer: { type: "board", userId: t.companyOwner.userId, instanceAdmin: false }, limit: 100 });
    expect(all.items.map((item) => item.id)).toEqual(seen);
    const times = all.items.map((item) => Date.parse(item.occurredAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    const kinds = await request(owner).get(path).query({ kind: "message_sent,tool_called", limit: "100" });
    expect(kinds.body.items.length).toBeGreaterThan(0);
    expect(new Set(kinds.body.items.map((item: { kind: string }) => item.kind))).toEqual(new Set(["message_sent", "tool_called"]));

    const group = await request(owner).get(path).query({ chatKey: GROUP, actorKind: "agent", limit: "100" });
    expect(group.body.items.length).toBeGreaterThan(0);
    expect(group.body.items.every((item: { chatKey: string; actorKind: string }) => item.chatKey === GROUP && item.actorKind === "agent")).toBe(true);

    const window = await request(owner).get(path).query({ from: new Date(base + 10 * 60_000).toISOString(), to: new Date(base + 12 * 60_000).toISOString() });
    expect(window.body.items.map((item: { occurredAt: string }) => item.occurredAt)).toEqual([
      new Date(base + 12 * 60_000).toISOString(),
      new Date(base + 11 * 60_000).toISOString(),
      new Date(base + 10 * 60_000).toISOString(),
    ]);

    expect((await request(owner).get(path).query({ cursor: "invalid" })).status).toBe(400);
    expect((await request(owner).get(path).query({ kind: "not_a_kind" })).status).toBe(400);
    expect((await request(owner).get(path).query({ limit: "101" })).status).toBe(400);
    expect((await request(owner).get(path).query({ unknown: "x" })).status).toBe(400);
  });

  it("purges content after the endpoint retention and keeps metadata", async () => {
    const t = await seed({ auditContentRetentionDays: 2 });
    const occurredAt = new Date("2026-10-01T00:00:00.000Z");
    await record(t, "publication_suppressed", occurredAt, { text: "Reply held for the owner" });
    await recordOpenwaAudit(db, {
      companyId: t.companyId, endpointId: t.endpointId, kind: "session_health", actorKind: "system",
      metadata: { healthy: false }, occurredAt,
    });
    const [stored] = await db.select().from(chatAuditEntries).where(and(eq(chatAuditEntries.endpointId, t.endpointId), eq(chatAuditEntries.kind, "publication_suppressed")));
    expect(stored!.contentPurgeAt!.toISOString()).toBe(new Date(occurredAt.getTime() + 2 * DAY_MS).toISOString());

    expect(await purgeOpenwaAuditContent(db, { now: new Date(occurredAt.getTime() + 2 * DAY_MS - 1000) })).toEqual({ purged: 0, batches: 0 });
    const [kept] = await db.select().from(chatAuditEntries).where(eq(chatAuditEntries.id, stored!.id));
    expect(kept!.content).toEqual({ text: "Reply held for the owner" });

    expect((await purgeOpenwaAuditContent(db, { now: new Date(occurredAt.getTime() + 2 * DAY_MS) })).purged).toBe(1);
    const [purged] = await db.select().from(chatAuditEntries).where(eq(chatAuditEntries.id, stored!.id));
    expect(purged!.content).toBeNull();
    expect(purged!.metadata).toEqual(stored!.metadata);
    expect(purged!.contentPurgeAt).toEqual(stored!.contentPurgeAt);

    const page = await listOpenwaAudit(db, { companyId: t.companyId, endpointId: t.endpointId, viewer: { type: "board", userId: t.companyOwner.userId, instanceAdmin: false } });
    const views = new Map(page.items.map((item) => [item.kind, item]));
    expect(views.get("publication_suppressed")).toMatchObject({ content: null, contentPurged: true });
    expect(views.get("session_health")).toMatchObject({ content: null, contentPurged: false, metadata: { healthy: false } });
  });

  it("defaults retention to 90 days", async () => {
    const t = await seed();
    const occurredAt = new Date("2026-10-01T00:00:00.000Z");
    await record(t, "trigger_admitted", occurredAt);
    const [row] = await db.select().from(chatAuditEntries).where(eq(chatAuditEntries.endpointId, t.endpointId));
    expect(row!.contentPurgeAt!.getTime() - occurredAt.getTime()).toBe(90 * DAY_MS);
  });

  it("honours the purge batch size and batch cap", async () => {
    const t = await seed({ auditContentRetentionDays: 1 });
    const occurredAt = new Date("2020-01-01T00:00:00.000Z");
    for (let index = 0; index < 5; index++) await record(t, "message_sent", new Date(occurredAt.getTime() + index));
    const now = new Date("2020-02-01T00:00:00.000Z");
    expect(await purgeOpenwaAuditContent(db, { now, batchSize: 2, maxBatches: 1 })).toEqual({ purged: 2, batches: 1 });
    expect(await purgeOpenwaAuditContent(db, { now, batchSize: 2 })).toEqual({ purged: 3, batches: 2 });
    const rows = await db.select({ content: chatAuditEntries.content }).from(chatAuditEntries).where(eq(chatAuditEntries.endpointId, t.endpointId));
    expect(rows.every((row) => row.content === null)).toBe(true);
  });

  it("runs the scheduled purge once per interval unless the batch cap cut it short", async () => {
    const t = await seed({ auditContentRetentionDays: 1 });
    for (let index = 0; index < 3; index++) await record(t, "tool_called", new Date(Date.UTC(2020, 0, 1, 0, 0, index)));
    let now = new Date("2020-02-01T00:00:00.000Z");
    const scheduler = openwaAuditPurgeScheduler(db, { intervalMs: DAY_MS, batchSize: 2, maxBatches: 1, now: () => now });
    expect(await scheduler.runDue()).toEqual({ purged: 2, batches: 1 });
    expect(await scheduler.runDue()).toEqual({ purged: 1, batches: 1 });
    await record(t, "tool_called", new Date("2020-01-02T00:00:00.000Z"));
    expect(await scheduler.runDue()).toBeNull();
    now = new Date(now.getTime() + DAY_MS);
    expect(await scheduler.runDue()).toEqual({ purged: 1, batches: 1 });
  });

  it("redacts credentials and bounds content sizes", async () => {
    const t = await seed();
    await recordOpenwaAudit(db, {
      companyId: t.companyId, endpointId: t.endpointId, kind: "tool_called", actorKind: "agent",
      metadata: { operation: "openwa.sendText", apiKey: "wa-live-0123456789abcdef" },
      content: {
        args: { chatId: CHAT, apiKey: "wa-live-0123456789abcdef", text: "Authorization: Bearer sk-live-abcdefghijklmnopqrstuvwxyz0123456789", blob: "x".repeat(10_000) },
        resultSummary: "y".repeat(5_000),
        text: "z".repeat(40_000),
      },
    });
    const [row] = await db.select().from(chatAuditEntries).where(eq(chatAuditEntries.endpointId, t.endpointId));
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain("wa-live-0123456789abcdef");
    expect(serialized).not.toContain("sk-live-abcdefghijklmnopqrstuvwxyz0123456789");
    expect(row!.metadata).toMatchObject({ operation: "openwa.sendText", apiKey: REDACTED_EVENT_VALUE });
    const content = row!.content as Record<string, unknown>;
    const bytes = (value: unknown) => Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value));
    expect(bytes(content.args)).toBeLessThanOrEqual(OPENWA_AUDIT_ARG_LIMIT_BYTES);
    expect(bytes(content.resultSummary)).toBeLessThanOrEqual(OPENWA_AUDIT_RESULT_LIMIT_BYTES);
    expect(bytes(content)).toBeLessThanOrEqual(OPENWA_AUDIT_CONTENT_LIMIT_BYTES);
    expect(String(content.resultSummary)).toContain("[truncated 5000 bytes]");
  });

  it("records every layer-2 kind", async () => {
    const t = await seed();
    for (const kind of CHAT_AUDIT_ENTRY_KINDS) await record(t, kind, new Date());
    const rows = await db.select({ kind: chatAuditEntries.kind }).from(chatAuditEntries).where(eq(chatAuditEntries.endpointId, t.endpointId));
    expect(new Set(rows.map((row) => row.kind))).toEqual(new Set(CHAT_AUDIT_ENTRY_KINDS));
  });

  it("logs every layer-1 action as metadata-only activity with the right actor", async () => {
    const t = await seed();
    const principalId = randomUUID();
    for (const [index, action] of OPENWA_ACTIVITY_ACTIONS.entries()) {
      await logOpenwaActivity(db, {
        companyId: t.companyId,
        endpointId: t.endpointId,
        action,
        ...(index % 2 === 0 ? { actorUserId: t.companyOwner.userId } : { actorPrincipalId: principalId }),
        details: { changedKeys: ["replyPolicy"], count: index },
      });
    }
    const rows = await db.select().from(activityLog).where(and(eq(activityLog.companyId, t.companyId), eq(activityLog.entityId, t.endpointId)));
    expect(new Set(rows.map((row) => row.action))).toEqual(new Set(OPENWA_ACTIVITY_ACTIONS));
    for (const row of rows) {
      expect(row.entityType).toBe("chat_endpoint");
      expect(row.details).toMatchObject({ endpointId: t.endpointId, provider: "openwa", changedKeys: ["replyPolicy"] });
      if (row.actorType === "user") expect(row.actorId).toBe(t.companyOwner.userId);
      else expect(row).toMatchObject({ actorType: "system", actorId: "chat:" + principalId });
    }
  });
});
