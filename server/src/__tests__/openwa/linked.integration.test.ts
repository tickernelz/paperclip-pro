import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, like } from "drizzle-orm";
import {
  activityLog,
  agents,
  authUsers,
  chatAuditEntries,
  chatConversations,
  chatEndpointResources,
  chatEndpoints,
  chatOpenwaLinkedSessions,
  companies,
  companyMemberships,
  companySecretBindings,
  companySecrets,
  createDb,
  heartbeatRuns,
  issues,
  toolConnections,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import type { OpenwaTriggerClass } from "@tickernelz/paperclip-pro-shared";
import { startEmbeddedPostgresTestDatabase } from "../helpers/embedded-postgres.js";
import { chatChannelService, type ChatChannelService } from "../../services/chat-channels.js";
import { ChatSdkRuntime } from "../../services/chat-sdk-runtime.js";
import { secretService } from "../../services/secrets.js";
import { instanceSettingsService } from "../../services/instance-settings.js";
import { openwaThreadId } from "../../services/openwa/adapter.js";
import { openwaChatKey } from "../../services/openwa/outbound.js";
import { executeOpenwaTool, OpenwaToolError } from "../../services/openwa/tools.js";
import { chatChannelRoutes } from "../../routes/chat-channels.js";
import { errorHandler } from "../../middleware/index.js";
import { logger } from "../../middleware/logger.js";
import { FAKE_OPENWA_ADMIN_KEY, FAKE_OPENWA_KEY, FakeOpenwaGateway } from "./fake-gateway.js";

const SESSION_ID = "55555555-6666-4777-8888-999999999999";
const LINKED_SESSION_ID = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const OWN_PHONE = "628111000777";
const LINKED_PHONE = "628999000123";
const OWNER_DM = "628222000777@c.us";
const FRIEND_DM = "628333000444@c.us";
const FAMILY_GROUP = "120363000000000777@g.us";
const SECRET_CHAT = "628444000555@c.us";

async function until(predicate: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function rejection(promise: Promise<unknown>): Promise<OpenwaToolError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OpenwaToolError) return error;
    throw error;
  }
  throw new Error("expected an OpenWA tool error");
}

describe.sequential("OpenWA linked read-only numbers (embedded Postgres + fake gateway)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let root: string;
  const oldKey = process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
  const services: ChatChannelService[] = [];
  const gateways: FakeOpenwaGateway[] = [];
  const endpointIds: string[] = [];

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-openwa-linked-");
    db = createDb(database.connectionString);
    root = await mkdtemp(path.join(tmpdir(), "openwa-linked-"));
    process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = path.join(root, "master.key");
    await instanceSettingsService(db).updateExperimental({ enableChatConnectors: true });
  }, 60_000);
  afterEach(async () => {
    await Promise.all(services.splice(0).map((service) => service.shutdown()));
    await Promise.all(gateways.splice(0).map((gateway) => gateway.close()));
    for (const id of endpointIds.splice(0)) await db.update(chatEndpoints).set({ status: "archived" }).where(eq(chatEndpoints.id, id));
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await database?.cleanup();
    if (root) await rm(root, { recursive: true, force: true });
    if (oldKey === undefined) delete process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
    else process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = oldKey;
  });

  async function setup(input: { adminKey?: boolean } = {}) {
    const gateway = new FakeOpenwaGateway({ sessionId: SESSION_ID, ownPhone: OWN_PHONE });
    await gateway.start();
    gateways.push(gateway);
    const linkedSession = gateway.addLinkedSession({ id: LINKED_SESSION_ID, phone: LINKED_PHONE, pushName: "Zhafron" });
    linkedSession.chats.push({ id: FRIEND_DM, name: "Friend" }, { id: FAMILY_GROUP, name: "Family" }, { id: SECRET_CHAT, name: "Private" });
    const companyId = randomUUID();
    const agentId = randomUUID();
    const userId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "OpenWA linked",
      issuePrefix: "L" + companyId.replaceAll("-", "").slice(0, 7).toUpperCase(),
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "OpenWA Agent",
      role: "engineer",
      status: "idle",
      adapterType: "paperclip_runner",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(authUsers).values({ id: userId, name: "Board", email: userId + "@example.com", emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "owner" });
    const service = chatChannelService(db, {
      runtime: new ChatSdkRuntime(),
      publicBaseUrl: "https://paperclip.example",
      heartbeat: { wakeup: vi.fn(async () => ({ accepted: true })) } as never,
      scheduleDeferredWork: () => {},
      discordGatewayLeaseWaitMs: 200,
    });
    services.push(service);
    const endpoint = await service.create(companyId, { provider: "openwa", assignedAgentId: agentId } as never, userId);
    endpointIds.push(endpoint.id);
    const [row] = await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, endpoint.id));
    const keys: Array<[string, string]> = [["apiKey", FAKE_OPENWA_KEY], ...(input.adminKey === false ? [] : ([["adminApiKey", FAKE_OPENWA_ADMIN_KEY]] as Array<[string, string]>))];
    const refs = [];
    for (const [label, value] of keys) {
      const secret = await secretService(db).create(
        companyId,
        { name: "openwa-" + label + "-" + endpoint.id.slice(0, 8), provider: "local_encrypted", managedMode: "paperclip_managed", value },
        { userId },
      );
      const ref = { secretId: secret.id, versionSelector: "latest" as const, configPath: "credentials." + label, required: label === "apiKey", label, projectionClass: "unclassified" as const };
      refs.push(ref);
      await db.insert(companySecretBindings).values({ companyId, targetType: "tool_connection", targetId: row!.connectionId, ...ref });
    }
    await db.update(toolConnections).set({ status: "active", enabled: true, credentialSecretRefs: refs }).where(eq(toolConnections.id, row!.connectionId));
    await db
      .update(chatEndpoints)
      .set({
        status: "active",
        providerAccountId: gateway.baseUrl + "#" + SESSION_ID,
        botExternalId: OWN_PHONE,
        policy: {},
        setup: { step: "complete", testStartedAt: new Date(Date.now() - 60_000).toISOString() },
      })
      .where(eq(chatEndpoints.id, endpoint.id));
    expect((await service.reconcileProviderRuntimes()).local).toBe(1);
    await gateway.waitForSubscription();
    await until(async () => (await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, endpoint.id)))[0]!.status === "active");
    return { gateway, linkedSession, companyId, agentId, userId, endpointId: endpoint.id, service };
  }

  type Fixture = Awaited<ReturnType<typeof setup>>;

  function boardApp(t: Fixture) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = {
        type: "board",
        source: "session",
        userId: t.userId,
        isInstanceAdmin: false,
        companyIds: [t.companyId],
        memberships: [{ companyId: t.companyId, status: "active", membershipRole: "owner" }],
      } as never;
      next();
    });
    app.use("/api", chatChannelRoutes(db, { heartbeat: { wakeup: async () => undefined } as never, service: t.service }));
    app.use(errorHandler);
    return app;
  }

  async function conversation(t: Fixture, chatId: string) {
    const threadId = openwaThreadId({ sessionId: SESSION_ID, chatId, isGroup: false });
    const [issue] = await db.insert(issues).values({ companyId: t.companyId, title: "WhatsApp " + chatId, status: "todo", assigneeAgentId: t.agentId }).returning();
    const [resource] = await db
      .insert(chatEndpointResources)
      .values({
        companyId: t.companyId,
        endpointId: t.endpointId,
        type: "direct_message",
        providerResourceId: threadId,
        label: chatId,
        availability: "available",
        enabled: true,
        settings: {},
        metadata: { chatKey: openwaChatKey(chatId) },
      })
      .returning();
    const [row] = await db
      .insert(chatConversations)
      .values({
        companyId: t.companyId,
        endpointId: t.endpointId,
        resourceId: resource!.id,
        issueId: issue!.id,
        externalConversationId: threadId,
        externalThreadId: threadId,
        externalLabel: chatId,
        isDirectMessage: true,
      })
      .returning();
    return { ...row!, chatId };
  }

  async function run(t: Fixture, c: Awaited<ReturnType<typeof conversation>>, triggerClass: OpenwaTriggerClass) {
    const runId = randomUUID();
    const profile = triggerClass === "owner" ? "full" : "read_only";
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId: t.companyId,
      agentId: t.agentId,
      status: "running",
      startedAt: new Date(Date.now() - 30_000),
      contextSnapshot: {
        source: "chat:openwa",
        issueId: c.issueId,
        paperclipToolProfile: profile,
        openwa: { event: "message", triggerClass, deliveryIds: [] },
        paperclipOpenwa: {
          endpointId: t.endpointId,
          chatKey: openwaChatKey(c.chatId),
          triggerClass,
          profile,
          grantIds: [],
          requesterPrincipalId: null,
          approvalRequestId: null,
          triggerPrincipalId: null,
        },
      },
    });
    return { companyId: t.companyId, agentId: t.agentId, runId, issueId: c.issueId };
  }

  async function linkWithChats(t: Fixture) {
    const app = boardApp(t);
    const base = "/api/chat-endpoints/" + t.endpointId + "/openwa/linked-sessions";
    const linked = await request(app).post(base).send({ sessionId: LINKED_SESSION_ID, label: "Zhafron pribadi" });
    expect(linked.status).toBe(201);
    const chats = await request(app)
      .put(base + "/" + linked.body.id + "/chats")
      .send({ chats: [{ chatId: FRIEND_DM, label: "Friend", isGroup: false }, { chatId: FAMILY_GROUP, label: "Family", isGroup: true }] });
    expect(chats.status).toBe(200);
    return { app, base, linkedId: linked.body.id as string, responses: [linked, chats] };
  }

  function scopedKeys(t: Fixture) {
    return [...t.gateway.apiKeys.values()];
  }

  function leaksKey(t: Fixture, value: unknown): boolean {
    const text = JSON.stringify(value);
    return scopedKeys(t).some((key) => text.includes(key.apiKey)) || text.includes(FAKE_OPENWA_ADMIN_KEY) || text.includes(FAKE_OPENWA_KEY);
  }

  it("links a number with a viewer key scoped to its session, stored as a managed secret and never returned", async () => {
    const t = await setup();
    const app = boardApp(t);
    const base = "/api/chat-endpoints/" + t.endpointId + "/openwa";
    const linkable = await request(app).get(base + "/linkable-sessions");
    expect(linkable.status).toBe(200);
    expect(linkable.body).toEqual([{ sessionId: LINKED_SESSION_ID, name: expect.any(String), status: "ready", phoneMasked: "+62xxx...0123", pushName: "Zhafron" }]);

    const linked = await request(app).post(base + "/linked-sessions").send({ sessionId: LINKED_SESSION_ID, label: "Zhafron pribadi" });
    expect(linked.status).toBe(201);
    expect(linked.body).toMatchObject({ sessionId: LINKED_SESSION_ID, label: "Zhafron pribadi", phoneMasked: "+62xxx...0123", status: "active", allowedChats: [] });
    expect(Object.keys(linked.body)).not.toEqual(expect.arrayContaining(["secretId"]));
    expect(Object.keys(linked.body)).not.toContain("gatewayKeyId");

    const keys = scopedKeys(t);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ role: "viewer", allowedSessions: [LINKED_SESSION_ID], name: "paperclip-linked-" + linked.body.id.slice(0, 8), active: true });
    expect(t.gateway.requests.find((entry) => entry.method === "POST" && entry.path === "/api/auth/api-keys")?.key).toBe("admin");

    const [row] = await db.select().from(chatOpenwaLinkedSessions).where(eq(chatOpenwaLinkedSessions.id, linked.body.id));
    expect(row).toMatchObject({ companyId: t.companyId, endpointId: t.endpointId, sessionId: LINKED_SESSION_ID, gatewayKeyId: keys[0]!.id, createdByUserId: t.userId });
    const [secret] = await db.select().from(companySecrets).where(eq(companySecrets.id, row!.secretId));
    expect(secret).toMatchObject({ companyId: t.companyId, managedMode: "paperclip_managed", provider: "local_encrypted", status: "active" });
    expect(await secretService(db).resolveSecretValue(t.companyId, row!.secretId, "latest")).toBe(keys[0]!.apiKey);

    const listed = await request(app).get(base + "/linked-sessions");
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(1);
    expect((await request(app).get(base + "/linkable-sessions")).body).toEqual([]);
    for (const response of [linkable, linked, listed]) expect(leaksKey(t, response.body)).toBe(false);

    const duplicate = await request(app).post(base + "/linked-sessions").send({ sessionId: LINKED_SESSION_ID, label: "Again" });
    expect(duplicate.status).toBe(409);
    expect(scopedKeys(t)).toHaveLength(1);
  });

  it("refuses to link the agent's own session", async () => {
    const t = await setup();
    const response = await request(boardApp(t)).post("/api/chat-endpoints/" + t.endpointId + "/openwa/linked-sessions").send({ sessionId: SESSION_ID, label: "Agent" });
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: "openwa_linked_is_agent_session" });
    expect(scopedKeys(t)).toHaveLength(0);
    expect(await db.select().from(chatOpenwaLinkedSessions).where(eq(chatOpenwaLinkedSessions.endpointId, t.endpointId))).toHaveLength(0);
  });

  it("fails 422 openwa_admin_key_required when the endpoint has no admin key", async () => {
    const t = await setup({ adminKey: false });
    const app = boardApp(t);
    const response = await request(app).post("/api/chat-endpoints/" + t.endpointId + "/openwa/linked-sessions").send({ sessionId: LINKED_SESSION_ID, label: "Zhafron" });
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: "openwa_admin_key_required" });
    expect(response.body.error).toMatch(/admin API key/);
    expect((await request(app).get("/api/chat-endpoints/" + t.endpointId + "/openwa/linkable-sessions")).status).toBe(422);
    expect(scopedKeys(t)).toHaveLength(0);
  });

  it("lets an owner run list and read an allowed chat through the viewer key, audited without content", async () => {
    const t = await setup();
    const { linkedId, responses } = await linkWithChats(t);
    t.gateway.linkedMessage(LINKED_SESSION_ID, { chatId: FRIEND_DM, body: "see you at eight" });
    t.gateway.linkedMessage(LINKED_SESSION_ID, { chatId: FRIEND_DM, body: "ok", fromMe: true });
    t.gateway.linkedMessage(LINKED_SESSION_ID, { chatId: SECRET_CHAT, body: "not for the agent" });
    const c = await conversation(t, OWNER_DM);
    const binding = await run(t, c, "owner");

    const listed = await executeOpenwaTool(db, binding, "openwa_linked_list", {});
    expect(listed).toEqual({
      linked: [
        {
          linkedRef: linkedId,
          label: "Zhafron pribadi",
          phoneMasked: "+62xxx...0123",
          status: "active",
          chats: [
            { chatRef: "openwa:" + LINKED_SESSION_ID + ":" + FRIEND_DM, label: "Friend", isGroup: false },
            { chatRef: "openwa:" + LINKED_SESSION_ID + ":" + FAMILY_GROUP, label: "Family", isGroup: true },
          ],
        },
      ],
    });

    const before = t.gateway.requests.length;
    const read = await executeOpenwaTool(db, binding, "openwa_linked_read", { linkedRef: linkedId, chat: "openwa:" + LINKED_SESSION_ID + ":" + FRIEND_DM, limit: 10 });
    expect(read).toMatchObject({ linkedRef: linkedId, chatRef: "openwa:" + LINKED_SESSION_ID + ":" + FRIEND_DM, label: "Friend", nextCursor: null });
    const messages = read.messages as Array<Record<string, unknown>>;
    expect(messages.map((message) => [message.fromMe, message.text])).toEqual([[true, "ok"], [false, "see you at eight"]]);
    expect(messages[1]!.sender).toMatchObject({ phone: "+62xxx...0444" });
    const gatewayCalls = t.gateway.requests.slice(before);
    expect(gatewayCalls.map((entry) => [entry.method, entry.path, entry.key])).toEqual([
      ["GET", "/api/sessions/" + LINKED_SESSION_ID + "/messages/" + encodeURIComponent(FRIEND_DM) + "/history", "scoped"],
    ]);
    expect(t.gateway.sends).toHaveLength(0);

    const bare = await executeOpenwaTool(db, binding, "openwa_linked_read", { linkedRef: linkedId, chat: FAMILY_GROUP });
    expect(bare).toMatchObject({ chatRef: "openwa:" + LINKED_SESSION_ID + ":" + FAMILY_GROUP, messages: [] });

    const audits = await db
      .select()
      .from(chatAuditEntries)
      .where(and(eq(chatAuditEntries.endpointId, t.endpointId), eq(chatAuditEntries.kind, "linked_read")));
    expect(audits).toHaveLength(2);
    expect(audits.find((entry) => entry.chatKey === FRIEND_DM)).toMatchObject({
      actorKind: "agent",
      actorRef: t.agentId,
      runId: binding.runId,
      content: null,
      metadata: { tool: "openwa_linked_read", linkedSessionId: linkedId, count: 2 },
    });
    const toolCalls = await db
      .select()
      .from(chatAuditEntries)
      .where(and(eq(chatAuditEntries.endpointId, t.endpointId), eq(chatAuditEntries.kind, "tool_called")));
    expect(toolCalls.map((entry) => (entry.metadata as { tool: string }).tool).sort()).toEqual(["openwa_linked_list", "openwa_linked_read", "openwa_linked_read"]);
    const stored = JSON.stringify([audits, toolCalls]);
    expect(stored).not.toContain("see you at eight");
    expect(stored).not.toContain("not for the agent");

    const activity = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.companyId, t.companyId), like(activityLog.action, "openwa.linked_session_%")));
    expect(activity.map((entry) => entry.action).sort()).toEqual(["openwa.linked_session_added", "openwa.linked_session_chats_changed"]);
    expect(activity.find((entry) => entry.action === "openwa.linked_session_chats_changed")?.details).toMatchObject({ linkedSessionId: linkedId, chatCount: 2, added: 2, removed: 0 });
    for (const value of [listed, read, bare, audits, toolCalls, activity, ...responses.map((response) => response.body)]) expect(leaksKey(t, value)).toBe(false);
  });

  it("refuses linked tools in runs that are not owner-triggered", async () => {
    const t = await setup();
    const { linkedId } = await linkWithChats(t);
    const c = await conversation(t, OWNER_DM);
    for (const triggerClass of ["allowed", "other"] as const) {
      const binding = await run(t, c, triggerClass);
      const before = t.gateway.requests.length;
      expect(await rejection(executeOpenwaTool(db, binding, "openwa_linked_list", {}))).toMatchObject({ status: 403, code: "owner_only" });
      expect(await rejection(executeOpenwaTool(db, binding, "openwa_linked_read", { linkedRef: linkedId, chat: FRIEND_DM }))).toMatchObject({ status: 403, code: "owner_only" });
      expect(t.gateway.requests.slice(before)).toEqual([]);
    }
    expect(await db.select().from(chatAuditEntries).where(and(eq(chatAuditEntries.endpointId, t.endpointId), eq(chatAuditEntries.kind, "linked_read")))).toHaveLength(0);
  });

  it("refuses chats outside the board allowlist without touching the gateway", async () => {
    const t = await setup();
    const { linkedId } = await linkWithChats(t);
    t.gateway.linkedMessage(LINKED_SESSION_ID, { chatId: SECRET_CHAT, body: "not for the agent" });
    const c = await conversation(t, OWNER_DM);
    const binding = await run(t, c, "owner");
    const before = t.gateway.requests.length;
    for (const chat of [SECRET_CHAT, "openwa:" + LINKED_SESSION_ID + ":" + SECRET_CHAT, "openwa:" + SESSION_ID + ":" + FRIEND_DM]) {
      expect(await rejection(executeOpenwaTool(db, binding, "openwa_linked_read", { linkedRef: linkedId, chat }))).toMatchObject({ status: 403, code: "linked_chat_not_allowed" });
    }
    expect(await rejection(executeOpenwaTool(db, binding, "openwa_linked_read", { linkedRef: randomUUID(), chat: FRIEND_DM }))).toMatchObject({
      status: 404,
      code: "linked_session_unavailable",
    });
    expect(t.gateway.requests.slice(before)).toEqual([]);
  });

  it("keeps a viewer key from sending even if it leaks: the gateway refuses writes", async () => {
    const t = await setup();
    await linkWithChats(t);
    const key = scopedKeys(t)[0]!;
    const response = await fetch(t.gateway.baseUrl + "/api/sessions/" + LINKED_SESSION_ID + "/messages/send-text", {
      method: "POST",
      headers: { "X-API-Key": key.apiKey, "content-type": "application/json" },
      body: JSON.stringify({ chatId: FRIEND_DM, text: "hi" }),
    });
    expect(response.status).toBe(403);
    const other = await fetch(t.gateway.baseUrl + "/api/sessions/" + SESSION_ID + "/chats", { headers: { "X-API-Key": key.apiKey } });
    expect(other.status).toBe(403);
  });

  it("lists a linked number's chats for the picker with names only and marks allowed ones", async () => {
    const t = await setup();
    const { app, base, linkedId } = await linkWithChats(t);
    t.gateway.linkedMessage(LINKED_SESSION_ID, { chatId: FRIEND_DM, body: "message body never shown" });
    const response = await request(app).get(base + "/" + linkedId + "/gateway-chats");
    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { chatId: FRIEND_DM, isGroup: false, name: "Friend", allowed: true },
      { chatId: FAMILY_GROUP, isGroup: true, name: "Family", allowed: true },
      { chatId: SECRET_CHAT, isGroup: false, name: "Private", allowed: false },
    ]);
    expect(JSON.stringify(response.body)).not.toContain("message body never shown");
    expect(leaksKey(t, response.body)).toBe(false);
  });

  it("unlink revokes the gateway key, deletes the secret, and later reads fail", async () => {
    const t = await setup();
    const { app, base, linkedId } = await linkWithChats(t);
    const [row] = await db.select().from(chatOpenwaLinkedSessions).where(eq(chatOpenwaLinkedSessions.id, linkedId));
    const c = await conversation(t, OWNER_DM);
    const binding = await run(t, c, "owner");
    await executeOpenwaTool(db, binding, "openwa_linked_read", { linkedRef: linkedId, chat: FRIEND_DM });

    const removed = await request(app).delete(base + "/" + linkedId);
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ revoked: true });
    const key = scopedKeys(t)[0]!;
    expect(key.active).toBe(false);
    expect(t.gateway.requests.find((entry) => entry.method === "POST" && entry.path === "/api/auth/api-keys/" + key.id + "/revoke")?.key).toBe("admin");
    expect(await db.select().from(chatOpenwaLinkedSessions).where(eq(chatOpenwaLinkedSessions.id, linkedId))).toHaveLength(0);
    expect(await db.select().from(companySecrets).where(eq(companySecrets.id, row!.secretId))).toHaveLength(0);

    expect(await rejection(executeOpenwaTool(db, binding, "openwa_linked_read", { linkedRef: linkedId, chat: FRIEND_DM }))).toMatchObject({
      status: 404,
      code: "linked_session_unavailable",
    });
    expect(await executeOpenwaTool(db, binding, "openwa_linked_list", {})).toEqual({ linked: [] });
    const direct = await fetch(t.gateway.baseUrl + "/api/sessions/" + LINKED_SESSION_ID + "/messages/" + FRIEND_DM + "/history", { headers: { "X-API-Key": key.apiKey } });
    expect(direct.status).toBe(401);

    const activity = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.companyId, t.companyId), eq(activityLog.action, "openwa.linked_session_removed")));
    expect(activity).toHaveLength(1);
    expect(activity[0]!.details).toMatchObject({ linkedSessionId: linkedId, endpointId: t.endpointId, provider: "openwa" });
    expect(leaksKey(t, activity)).toBe(false);
    expect((await request(app).delete(base + "/" + linkedId)).status).toBe(404);
  });

  it("removing the endpoint revokes every linked key, deletes the rows and their secrets", async () => {
    const t = await setup();
    const { linkedId } = await linkWithChats(t);
    const [row] = await db.select().from(chatOpenwaLinkedSessions).where(eq(chatOpenwaLinkedSessions.id, linkedId));
    const key = scopedKeys(t)[0]!;

    await t.service.configure(t.endpointId, { action: "remove" }, t.userId);

    expect(await db.select().from(chatOpenwaLinkedSessions).where(eq(chatOpenwaLinkedSessions.endpointId, t.endpointId))).toHaveLength(0);
    expect(await db.select().from(companySecrets).where(eq(companySecrets.id, row!.secretId))).toHaveLength(0);
    expect(key.active).toBe(false);
    expect(t.gateway.requests.find((entry) => entry.method === "POST" && entry.path === "/api/auth/api-keys/" + key.id + "/revoke")?.key).toBe("admin");
    const activity = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.companyId, t.companyId), eq(activityLog.action, "openwa.linked_session_removed")));
    expect(activity).toHaveLength(1);
    expect(activity[0]!.details).toMatchObject({ linkedSessionId: linkedId, reason: "endpoint_removed", revoked: true });
    expect(leaksKey(t, activity)).toBe(false);
  });

  it("unlink still removes the row and secret when the gateway cannot revoke, and warns with the key name", async () => {
    const t = await setup();
    const c = await conversation(t, OWNER_DM);
    const binding = await run(t, c, "owner");
    const [endpointRow] = await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, t.endpointId));

    const failing = await linkWithChats(t);
    const failingKey = scopedKeys(t).find((key) => key.active)!;
    const override = { method: "POST", path: "/api/auth/api-keys/" + failingKey.id + "/revoke", status: 503, body: { message: "down" } };
    t.gateway.overrides.push(override);
    const brokenAdmin = await revokeFailureCase(t, failing.app, failing.base, failing.linkedId);
    t.gateway.overrides.splice(t.gateway.overrides.indexOf(override), 1);
    expect(failingKey.active).toBe(true);
    expect(brokenAdmin.activity).toMatchObject({ linkedSessionId: failing.linkedId, reason: "unlinked", revoked: false });

    const missing = await linkWithChats(t);
    const missingKey = scopedKeys(t).find((key) => key.active && key.id !== failingKey.id)!;
    const [connection] = await db.select().from(toolConnections).where(eq(toolConnections.id, endpointRow!.connectionId));
    await db
      .update(toolConnections)
      .set({ credentialSecretRefs: connection!.credentialSecretRefs.filter((ref) => ref.label !== "adminApiKey") })
      .where(eq(toolConnections.id, endpointRow!.connectionId));
    const before = t.gateway.requests.length;
    await revokeFailureCase(t, missing.app, missing.base, missing.linkedId);
    expect(t.gateway.requests.slice(before).some((entry) => entry.path.endsWith("/revoke"))).toBe(false);
    expect(missingKey.active).toBe(true);

    for (const linkedId of [failing.linkedId, missing.linkedId]) {
      expect(await rejection(executeOpenwaTool(db, binding, "openwa_linked_read", { linkedRef: linkedId, chat: FRIEND_DM }))).toMatchObject({
        code: "linked_session_unavailable",
      });
    }
  });

  async function revokeFailureCase(t: Fixture, app: express.Express, base: string, linkedId: string) {
    const [row] = await db.select().from(chatOpenwaLinkedSessions).where(eq(chatOpenwaLinkedSessions.id, linkedId));
    const warn = vi.spyOn(logger, "warn");
    const response = await request(app).delete(base + "/" + linkedId);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ revoked: false, warning: expect.stringContaining('"paperclip-linked-' + linkedId.slice(0, 8) + '"') });
    expect(response.body.warning).toMatch(/OpenWA dashboard/);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ linkedSessionId: linkedId, gatewayKeyName: "paperclip-linked-" + linkedId.slice(0, 8) }), expect.stringContaining("OpenWA dashboard"));
    warn.mockRestore();
    expect(await db.select().from(chatOpenwaLinkedSessions).where(eq(chatOpenwaLinkedSessions.id, linkedId))).toHaveLength(0);
    expect(await db.select().from(companySecrets).where(eq(companySecrets.id, row!.secretId))).toHaveLength(0);
    expect(leaksKey(t, response.body)).toBe(false);
    const activity = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.companyId, t.companyId), eq(activityLog.action, "openwa.linked_session_removed")));
    return { activity: activity.find((entry) => (entry.details as { linkedSessionId?: string } | null)?.linkedSessionId === linkedId)?.details };
  }

  it("revokes a created key when the gateway returns an id without the key", async () => {
    const t = await setup();
    t.gateway.overrides.push({ method: "POST", path: "/api/auth/api-keys", status: 201, body: { id: "orphan-key-id", name: "paperclip-linked-x", role: "viewer" } });
    const response = await request(boardApp(t)).post("/api/chat-endpoints/" + t.endpointId + "/openwa/linked-sessions").send({ sessionId: LINKED_SESSION_ID, label: "Zhafron" });
    expect(response.status).toBe(502);
    expect(response.body).toMatchObject({ code: "openwa_invalid_response" });
    expect(t.gateway.requests.find((entry) => entry.method === "POST" && entry.path === "/api/auth/api-keys/orphan-key-id/revoke")?.key).toBe("admin");
    expect(await db.select().from(chatOpenwaLinkedSessions).where(eq(chatOpenwaLinkedSessions.endpointId, t.endpointId))).toHaveLength(0);
  });

  it("marks a linked number unavailable when the gateway stops accepting its key", async () => {
    const t = await setup();
    const { linkedId } = await linkWithChats(t);
    scopedKeys(t)[0]!.active = false;
    const c = await conversation(t, OWNER_DM);
    const binding = await run(t, c, "owner");
    expect(await rejection(executeOpenwaTool(db, binding, "openwa_linked_read", { linkedRef: linkedId, chat: FRIEND_DM }))).toMatchObject({
      status: 409,
      code: "linked_session_unavailable",
    });
    expect((await db.select().from(chatOpenwaLinkedSessions).where(eq(chatOpenwaLinkedSessions.id, linkedId)))[0]!.status).toBe("unavailable");
  });
});
