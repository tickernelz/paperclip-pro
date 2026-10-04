import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  agents,
  authUsers,
  chatActions,
  chatAuditEntries,
  chatConversations,
  chatEndpointResources,
  chatEndpoints,
  chatOwnerApprovalRequests,
  chatOwnerGrants,
  companies,
  companyMemberships,
  companySecretBindings,
  createDb,
  heartbeatRuns,
  issues,
  toolConnections,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import type { OpenwaTriggerClass } from "@tickernelz/paperclip-pro-shared";
import { startEmbeddedPostgresTestDatabase } from "../helpers/embedded-postgres.js";
import { createLocalDiskStorageProvider } from "../../storage/local-disk-provider.js";
import { createStorageService } from "../../storage/service.js";
import { chatChannelService, type ChatChannelService } from "../../services/chat-channels.js";
import { ChatSdkRuntime } from "../../services/chat-sdk-runtime.js";
import { secretService } from "../../services/secrets.js";
import { instanceSettingsService } from "../../services/instance-settings.js";
import { recordOpenwaAudit } from "../../services/openwa/audit.js";
import { openwaThreadId } from "../../services/openwa/adapter.js";
import { openwaChatKey } from "../../services/openwa/outbound.js";
import { executeOpenwaTool, OpenwaToolError, type OpenwaToolBinding } from "../../services/openwa/tools.js";
import { HttpError } from "../../errors.js";
import { openwaToolRoutes } from "../../routes/openwa-tools.js";
import { chatChannelRoutes } from "../../routes/chat-channels.js";
import { errorHandler } from "../../middleware/index.js";
import { FAKE_OPENWA_KEY, FakeOpenwaGateway } from "./fake-gateway.js";

const SESSION_A = "61111111-2222-4333-8444-555555555555";
const SESSION_B = "62222222-3333-4444-8555-666666666666";
const PHONE_A = "628111000611";
const PHONE_B = "628111000622";
const MEMBER_A = "628222000611@c.us";
const MEMBER_B = "628222000622@c.us";
const INVITE_CODE = "HXk2Lw9QbZr7Ty4Nc1Vp0a";

async function until(predicate: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function refusal(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpError) return error;
    throw error;
  }
  throw new Error("expected a typed refusal");
}

describe.sequential("OpenWA company isolation and invite-link joins (embedded Postgres + fake gateway)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let root: string;
  let storage: ReturnType<typeof createStorageService>;
  const oldKey = process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
  const services: ChatChannelService[] = [];
  const gateways: FakeOpenwaGateway[] = [];
  const endpointIds: string[] = [];

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-openwa-isolation-");
    db = createDb(database.connectionString);
    root = await mkdtemp(path.join(tmpdir(), "openwa-isolation-"));
    process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = path.join(root, "master.key");
    storage = createStorageService(createLocalDiskStorageProvider(path.join(root, "storage")));
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

  function newService() {
    const service = chatChannelService(db, {
      runtime: new ChatSdkRuntime(),
      publicBaseUrl: "https://paperclip.example",
      heartbeat: { wakeup: vi.fn(async () => ({ accepted: true })) } as never,
      storage,
      scheduleDeferredWork: () => {},
      discordGatewayLeaseWaitMs: 200,
    });
    services.push(service);
    return service;
  }

  async function tenant(service: ChatChannelService, input: { label: string; sessionId: string; ownPhone: string; memberChat: string }) {
    const gateway = new FakeOpenwaGateway({ sessionId: input.sessionId, ownPhone: input.ownPhone });
    await gateway.start();
    gateways.push(gateway);
    const companyId = randomUUID();
    const agentId = randomUUID();
    const userId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "OpenWA " + input.label,
      issuePrefix: input.label + companyId.replaceAll("-", "").slice(0, 6).toUpperCase(),
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "OpenWA Agent " + input.label,
      role: "engineer",
      status: "idle",
      adapterType: "paperclip_runner",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(authUsers).values({ id: userId, name: "Owner " + input.label, email: userId + "@example.com", emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "owner" });
    const endpoint = await service.create(companyId, { provider: "openwa", assignedAgentId: agentId } as never, userId);
    endpointIds.push(endpoint.id);
    const secret = await secretService(db).create(
      companyId,
      { name: "openwa-key-" + endpoint.id.slice(0, 8), provider: "local_encrypted", managedMode: "paperclip_managed", value: FAKE_OPENWA_KEY },
      { userId },
    );
    const [row] = await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, endpoint.id));
    const ref = { secretId: secret.id, versionSelector: "latest" as const, configPath: "credentials.apiKey", required: true, label: "apiKey", projectionClass: "unclassified" as const };
    await db.update(toolConnections).set({ status: "active", enabled: true, credentialSecretRefs: [ref] }).where(eq(toolConnections.id, row!.connectionId));
    await db.insert(companySecretBindings).values({ companyId, targetType: "tool_connection", targetId: row!.connectionId, ...ref });
    await db
      .update(chatEndpoints)
      .set({
        status: "active",
        providerAccountId: gateway.baseUrl + "#" + input.sessionId,
        botExternalId: input.ownPhone,
        setup: { step: "complete", testStartedAt: new Date(Date.now() - 60_000).toISOString() },
      })
      .where(eq(chatEndpoints.id, endpoint.id));
    const threadId = openwaThreadId({ sessionId: input.sessionId, chatId: input.memberChat, isGroup: false });
    const [issue] = await db.insert(issues).values({ companyId, title: "WhatsApp " + input.label, status: "todo", assigneeAgentId: agentId }).returning();
    const [resource] = await db
      .insert(chatEndpointResources)
      .values({
        companyId,
        endpointId: endpoint.id,
        type: "direct_message",
        providerResourceId: threadId,
        label: input.memberChat,
        availability: "available",
        enabled: true,
        settings: {},
        metadata: { chatKey: openwaChatKey(input.memberChat) },
      })
      .returning();
    const [conversation] = await db
      .insert(chatConversations)
      .values({
        companyId,
        endpointId: endpoint.id,
        resourceId: resource!.id,
        issueId: issue!.id,
        externalConversationId: threadId,
        externalThreadId: threadId,
        externalLabel: input.memberChat,
        isDirectMessage: true,
      })
      .returning();
    return { gateway, companyId, agentId, userId, endpointId: endpoint.id, issueId: issue!.id, conversationId: conversation!.id, chatRef: threadId, chatId: input.memberChat };
  }

  type Tenant = Awaited<ReturnType<typeof tenant>>;

  async function live(service: ChatChannelService, tenants: Tenant[]) {
    expect((await service.reconcileProviderRuntimes()).local).toBe(tenants.length);
    for (const t of tenants) {
      await t.gateway.waitForSubscription();
      await until(async () => (await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, t.endpointId)))[0]!.status === "active");
    }
  }

  async function run(t: Tenant, input: { triggerClass: OpenwaTriggerClass; issueId?: string; endpointId?: string; chatKey?: string }): Promise<OpenwaToolBinding> {
    const runId = randomUUID();
    const profile = input.triggerClass === "owner" ? "full" : "read_only";
    const issueId = input.issueId ?? t.issueId;
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId: t.companyId,
      agentId: t.agentId,
      status: "running",
      startedAt: new Date(Date.now() - 30_000),
      contextSnapshot: {
        source: "chat:openwa",
        issueId,
        paperclipToolProfile: profile,
        openwa: { event: "message", triggerClass: input.triggerClass, deliveryIds: [] },
        paperclipOpenwa: {
          endpointId: input.endpointId ?? t.endpointId,
          chatKey: input.chatKey ?? openwaChatKey(t.chatId),
          triggerClass: input.triggerClass,
          profile,
          grantIds: [],
          requesterPrincipalId: null,
          approvalRequestId: null,
        },
      },
    });
    return { companyId: t.companyId, agentId: t.agentId, runId, issueId };
  }

  function boardApp(service: ChatChannelService, t: Tenant) {
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
    app.use("/api", chatChannelRoutes(db, { heartbeat: { wakeup: async () => undefined } as never, service }));
    app.use(errorHandler);
    return app;
  }

  function toolApp(t: Tenant, runId: string) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = { type: "agent", source: "agent_jwt", companyId: t.companyId, agentId: t.agentId, runId } as never;
      next();
    });
    app.use("/api", openwaToolRoutes(db));
    app.use(errorHandler);
    return app;
  }

  const attacks = (target: Tenant) =>
    [
      ["openwa_read_chat", {}],
      ["openwa_read_chat", { chat: target.chatRef, source: "live" }],
      ["openwa_find", { query: "Budi" }],
      ["openwa_find", { phone: "+628222000611" }],
      ["openwa_send", { text: "leak", idempotencyKey: randomUUID() }],
      ["openwa_send", { chat: target.chatRef, text: "leak", idempotencyKey: randomUUID() }],
      ["openwa_call", { operation: "ChatController_findAll", args: {} }],
      ["openwa_call", { operation: "MessageController_sendText", args: { chatId: target.chatId, text: "leak" }, idempotencyKey: randomUUID() }],
      ["openwa_call", { operation: "paperclip.audit.list", args: {} }],
    ] as const;

  it("AC18: another company's run cannot reach this endpoint's tools, and its board user cannot read approvals, audit, chats or owners", async () => {
    const service = newService();
    const a = await tenant(service, { label: "A", sessionId: SESSION_A, ownPhone: PHONE_A, memberChat: MEMBER_A });
    const b = await tenant(service, { label: "B", sessionId: SESSION_B, ownPhone: PHONE_B, memberChat: MEMBER_B });
    await live(service, [a, b]);
    const [approval] = await db
      .insert(chatOwnerApprovalRequests)
      .values({ companyId: a.companyId, endpointId: a.endpointId, originChatKey: openwaChatKey(MEMBER_A), categories: ["create_task"], scope: "one_action", summary: "buat tiket", proposedAction: "buat tiket" })
      .returning();
    await recordOpenwaAudit(db, {
      companyId: a.companyId,
      endpointId: a.endpointId,
      conversationId: a.conversationId,
      chatKey: openwaChatKey(MEMBER_A),
      kind: "message_sent",
      actorKind: "agent",
      metadata: { marker: "a-only" },
      content: { text: "rahasia perusahaan A" },
    });

    const own = await run(b, { triggerClass: "owner" });
    await expect(executeOpenwaTool(db, own, "openwa_read_chat", {})).resolves.toMatchObject({ chatRef: b.chatRef });
    const aRequestsBefore = a.gateway.requests.length;
    const aActionsBefore = await db.select({ id: chatActions.id }).from(chatActions).where(eq(chatActions.endpointId, a.endpointId));
    const aAuditBefore = await db.select({ id: chatAuditEntries.id }).from(chatAuditEntries).where(eq(chatAuditEntries.endpointId, a.endpointId));

    const foreignIssue = await run(b, { triggerClass: "owner", issueId: a.issueId });
    const foreignEndpoint = await run(b, { triggerClass: "owner", endpointId: a.endpointId, chatKey: openwaChatKey(MEMBER_A) });
    const borrowedCompany: OpenwaToolBinding = { ...own, companyId: a.companyId, issueId: a.issueId };
    const borrowedAgent: OpenwaToolBinding = { companyId: a.companyId, agentId: a.agentId, runId: own.runId, issueId: a.issueId };
    const forged = await run(b, { triggerClass: "owner", issueId: a.issueId, endpointId: a.endpointId, chatKey: openwaChatKey(MEMBER_A) });
    const stolenRun: OpenwaToolBinding = { companyId: a.companyId, agentId: a.agentId, runId: forged.runId, issueId: a.issueId };
    for (const binding of [foreignIssue, foreignEndpoint, forged, borrowedCompany, borrowedAgent, stolenRun]) {
      for (const [tool, args] of attacks(a)) {
        const error = await refusal(executeOpenwaTool(db, binding, tool, args));
        expect([403, 404], tool + " via " + JSON.stringify(binding)).toContain(error.status);
      }
    }
    const crossSession = await refusal(executeOpenwaTool(db, own, "openwa_read_chat", { chat: a.chatRef }));
    expect(crossSession).toBeInstanceOf(OpenwaToolError);
    expect((crossSession as OpenwaToolError).code).toBe("invalid_target");

    const viaHttp = toolApp(b, foreignIssue.runId);
    for (const [tool, args] of attacks(a)) {
      for (const companyId of [a.companyId, b.companyId]) {
        const response = await request(viaHttp).post("/api/companies/" + companyId + "/openwa/tasks/" + a.issueId + "/tools").send({ tool, arguments: args });
        expect([403, 404], tool + " over HTTP as company " + (companyId === a.companyId ? "A" : "B")).toContain(response.status);
        expect(JSON.stringify(response.body)).not.toContain("rahasia");
      }
    }

    expect(a.gateway.requests.slice(aRequestsBefore)).toEqual([]);
    expect(a.gateway.sends).toEqual([]);
    expect(await db.select({ id: chatActions.id }).from(chatActions).where(eq(chatActions.endpointId, a.endpointId))).toEqual(aActionsBefore);
    expect(await db.select({ id: chatAuditEntries.id }).from(chatAuditEntries).where(eq(chatAuditEntries.endpointId, a.endpointId))).toEqual(aAuditBefore);

    const foreignBoard = boardApp(service, b);
    const base = "/api/chat-endpoints/" + a.endpointId;
    const probes = [
      request(foreignBoard).get(base + "/openwa/approvals?status=pending"),
      request(foreignBoard).post(base + "/openwa/approvals/" + approval!.id + "/resolve").send({ decision: "approve" }),
      request(foreignBoard).get(base + "/audit"),
      request(foreignBoard).get(base + "/openwa/chats"),
      request(foreignBoard).put(base + "/openwa/chats").send({ chatId: MEMBER_A, settings: { activation: "on" } }),
      request(foreignBoard).get(base + "/openwa/owners"),
      request(foreignBoard).get(base + "/openwa/sender-rules"),
      request(foreignBoard).get(base + "/openwa/gateway-chats"),
      request(foreignBoard).get(base + "/openwa/health"),
      request(foreignBoard).patch(base + "/openwa/policy").send({ replyPolicy: "allowed" }),
    ];
    for (const response of await Promise.all(probes)) {
      expect(response.status, response.req.method + " " + response.req.path).toBe(404);
      expect(JSON.stringify(response.body)).not.toContain("rahasia");
      expect(JSON.stringify(response.body)).not.toContain("buat tiket");
    }
    const [unchanged] = await db.select().from(chatOwnerApprovalRequests).where(eq(chatOwnerApprovalRequests.id, approval!.id));
    expect(unchanged!.status).toBe("pending");
    expect(await db.select().from(chatOwnerGrants).where(eq(chatOwnerGrants.requestId, approval!.id))).toEqual([]);
    expect(a.gateway.requests.slice(aRequestsBefore)).toEqual([]);

    const ownBoard = boardApp(service, a);
    const listed = await request(ownBoard).get(base + "/openwa/approvals?status=pending");
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual([expect.objectContaining({ id: approval!.id })]);
    const audit = await request(ownBoard).get(base + "/audit");
    expect(audit.status).toBe(200);
    expect(audit.body.items).toEqual([expect.objectContaining({ kind: "message_sent", content: { text: "rahasia perusahaan A" } })]);
  }, 120_000);

  it("AC4: an invite-link join from an other run needs wa_admin approval and never reaches the gateway; an owner run dispatches it", async () => {
    const service = newService();
    const a = await tenant(service, { label: "J", sessionId: SESSION_A, ownPhone: PHONE_A, memberChat: MEMBER_A });
    const joinPath = "/api/sessions/" + SESSION_A + "/groups/join";
    a.gateway.overrides.push({ method: "POST", path: joinPath, status: 201, body: { groupId: "120363000000000611@g.us" } });
    await live(service, [a]);
    const joins = () => a.gateway.requests.filter((entry) => entry.method === "POST" && entry.path === joinPath).length;
    const call = (binding: OpenwaToolBinding) =>
      executeOpenwaTool(db, binding, "openwa_call", { operation: "GroupController_join", args: { inviteCode: INVITE_CODE }, idempotencyKey: randomUUID() });

    for (const triggerClass of ["other", "grant"] as const) {
      const denied = await refusal(call(await run(a, { triggerClass })));
      expect(denied).toBeInstanceOf(OpenwaToolError);
      expect((denied as OpenwaToolError).code).toBe("approval_required");
      expect(denied.status).toBe(403);
      expect(denied.details).toMatchObject({ code: "approval_required", category: "wa_admin" });
    }
    expect(joins()).toBe(0);
    const receipts = await db.select({ status: chatActions.status, result: chatActions.result }).from(chatActions).where(eq(chatActions.kind, "openwa_tool_write"));
    expect(receipts.every((receipt) => receipt.status === "received" && !receipt.result?.receipt)).toBe(true);

    const owner = await run(a, { triggerClass: "owner" });
    await expect(call(owner)).resolves.toMatchObject({ state: "delivered", operation: "GroupController_join", result: { groupId: "120363000000000611@g.us" } });
    expect(joins()).toBe(1);
  }, 120_000);
});
