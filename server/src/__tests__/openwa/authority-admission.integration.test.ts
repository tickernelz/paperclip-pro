import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import {
  agents,
  agentWakeupRequests,
  authUsers,
  chatActions,
  chatConversations,
  chatEndpoints,
  companies,
  companyMemberships,
  companySecretBindings,
  createDb,
  heartbeatRuns,
  issueCreateIdempotencyKeys,
  issues,
  toolConnections,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../helpers/embedded-postgres.js";
import { registerServerAdapter, unregisterServerAdapter } from "../../adapters/index.ts";
import { agentRoutes } from "../../routes/agents.ts";
import { errorHandler } from "../../middleware/index.ts";
import { chatChannelService, type ChatChannelService } from "../../services/chat-channels.ts";
import { ChatSdkRuntime } from "../../services/chat-sdk-runtime.ts";
import { heartbeatService } from "../../services/heartbeat.ts";
import { secretService } from "../../services/secrets.ts";
import { resolveOpenwaRunContext } from "../../services/openwa/authority.ts";
import { FAKE_OPENWA_KEY, FakeOpenwaGateway } from "./fake-gateway.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;
const ADAPTER_TYPE = "openwa_authority_capture";
const SESSION_ID = "31111111-2222-4333-8444-555555555555";
const OWN_PHONE = "628111000222";
const OWNER_PHONE = "628333000444";
const MEMBER_PHONE = "628444000555";
const jid = (phone: string) => phone + "@c.us";

async function until<T>(probe: () => Promise<T | null | undefined | false>, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("condition not reached");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describeEmbeddedPostgres("OpenWA run authority through the real admission path", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let scratch: string;
  const previous = {
    home: process.env.PAPERCLIP_HOME, api: process.env.PAPERCLIP_API_URL, key: process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE, gh: process.env.GH_TOKEN,
  };
  const captured = new Map<string, Record<string, unknown>>();
  const services: ChatChannelService[] = [];
  const gateways: FakeOpenwaGateway[] = [];
  const endpointIds: string[] = [];

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-openwa-authority-admission-");
    db = createDb(database.connectionString);
    scratch = await mkdtemp(path.join(os.tmpdir(), "openwa-authority-admission-"));
    process.env.PAPERCLIP_HOME = scratch;
    process.env.PAPERCLIP_API_URL = "http://127.0.0.1:3100/api";
    process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = path.join(scratch, "master.key");
    process.env.GH_TOKEN = "host-github-token";
    registerServerAdapter({
      type: ADAPTER_TYPE,
      supportsLocalAgentJwt: true,
      execute: async (ctx) => {
        captured.set(ctx.runId, { ...ctx.context, capturedEnv: { ...(ctx.config.env as Record<string, unknown> | undefined) } });
        return { exitCode: 0, signal: null, timedOut: false, label: "Captured context" };
      },
      testEnvironment: async () => ({ adapterType: ADAPTER_TYPE, status: "pass", checks: [], testedAt: new Date().toISOString() }),
    });
  }, 60_000);

  afterEach(async () => {
    await Promise.all(services.splice(0).map((service) => service.shutdown()));
    await Promise.all(gateways.splice(0).map((gateway) => gateway.close()));
    for (const id of endpointIds.splice(0)) await db.update(chatEndpoints).set({ status: "archived" }).where(eq(chatEndpoints.id, id));
    captured.clear();
  });

  afterAll(async () => {
    unregisterServerAdapter(ADAPTER_TYPE);
    await database?.cleanup();
    if (scratch) await rm(scratch, { recursive: true, force: true });
    for (const [key, value] of [["PAPERCLIP_HOME", previous.home], ["PAPERCLIP_API_URL", previous.api], ["PAPERCLIP_SECRETS_MASTER_KEY_FILE", previous.key], ["GH_TOKEN", previous.gh]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function setup() {
    const gateway = new FakeOpenwaGateway({ sessionId: SESSION_ID, ownPhone: OWN_PHONE });
    await gateway.start();
    gateways.push(gateway);
    const companyId = randomUUID();
    const agentId = randomUUID();
    const userId = randomUUID();
    await db.insert(companies).values({
      id: companyId, name: "OpenWA authority", issuePrefix: "Z" + companyId.replaceAll("-", "").slice(0, 7).toUpperCase(),
      requireBoardApprovalForNewAgents: false, defaultResponsibleUserId: userId,
    });
    await db.insert(agents).values({
      id: agentId, companyId, name: "OpenWA Agent", role: "engineer", status: "idle",
      adapterType: ADAPTER_TYPE, adapterConfig: {}, runtimeConfig: {}, permissions: {},
    });
    await db.insert(authUsers).values({ id: userId, name: "Owner", email: userId + "@example.com", emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "owner" });
    const heartbeat = heartbeatService(db);
    const service = chatChannelService(db, {
      runtime: new ChatSdkRuntime(),
      publicBaseUrl: "https://paperclip.example",
      heartbeat: heartbeat as never,
      discordGatewayLeaseTtlMs: 120_000,
      discordGatewayLeaseRenewalIntervalMs: 60_000,
      discordGatewayLeaseWaitMs: 200,
      openwaBurstWindowMs: 0,
    });
    services.push(service);
    const endpoint = await service.create(companyId, { provider: "openwa", assignedAgentId: agentId } as never, userId);
    endpointIds.push(endpoint.id);
    const secret = await secretService(db).create(
      companyId,
      { name: "openwa-key-" + endpoint.id.slice(0, 8), provider: "local_encrypted", managedMode: "paperclip_managed", value: FAKE_OPENWA_KEY },
      { userId },
    );
    const [row] = await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, endpoint.id));
    await db.update(toolConnections).set({
      status: "active", enabled: true,
      credentialSecretRefs: [{ secretId: secret.id, versionSelector: "latest", configPath: "credentials.apiKey", required: true, label: "apiKey", projectionClass: "unclassified" }],
    }).where(eq(toolConnections.id, row!.connectionId));
    await db.insert(companySecretBindings).values({
      companyId, secretId: secret.id, targetType: "tool_connection", targetId: row!.connectionId, configPath: "credentials.apiKey",
      versionSelector: "latest", required: true, label: "apiKey", projectionClass: "unclassified",
    });
    await db.update(chatEndpoints).set({
      status: "active", providerAccountId: gateway.baseUrl + "#" + SESSION_ID, botExternalId: OWN_PHONE,
      setup: { step: "complete", testStartedAt: new Date(Date.now() - 60_000).toISOString() },
    }).where(eq(chatEndpoints.id, endpoint.id));
    return { gateway, companyId, agentId, userId, endpointId: endpoint.id, service, heartbeat };
  }

  type Setup = Awaited<ReturnType<typeof setup>>;

  async function addOwner(t: Setup, phone: string) {
    const added = await t.service.openwa.addOwner(t.endpointId, { e164: "+" + phone, expiresInSeconds: 1_800 }, t.userId);
    const token = new URL(added.confirmationUrl!, "https://paperclip.example").searchParams.get("token")!;
    await t.service.confirmIdentityLink(token, t.userId);
    return added.owner!;
  }

  async function goLive(t: Setup) {
    await t.service.reconcileProviderRuntimes();
    await t.gateway.waitForSubscription();
  }

  async function wakeCount(t: Setup) {
    return (await db.select({ id: chatActions.id }).from(chatActions)
      .where(and(eq(chatActions.companyId, t.companyId), eq(chatActions.kind, "inbound_wakeup")))).length;
  }

  async function runFor(t: Setup, chatId: string, after: number) {
    const action = await until(async () => {
      await t.service.processPendingDeliveries();
      const rows = await db.select().from(chatActions)
        .where(and(eq(chatActions.companyId, t.companyId), eq(chatActions.kind, "inbound_wakeup")))
        .orderBy(asc(chatActions.createdAt));
      return rows.length > after ? rows[after] : null;
    });
    const [conversation] = await db.select().from(chatConversations).where(eq(chatConversations.id, action.conversationId!));
    expect(conversation!.externalConversationId).toContain(chatId);
    return finishedContext(t, action.id);
  }

  async function finishedContext(t: Setup, wakeupRequestId: string) {
    const runId = await until(async () => {
      const [wake] = await db.select({ runId: agentWakeupRequests.runId }).from(agentWakeupRequests).where(eq(agentWakeupRequests.id, wakeupRequestId));
      return wake?.runId ?? null;
    });
    await until(async () => {
      const run = await t.heartbeat.getRun(runId);
      return run && !["queued", "running"].includes(run.status) ? run : null;
    });
    const [row] = await db.select({ contextSnapshot: heartbeatRuns.contextSnapshot }).from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
    return { runId, context: captured.get(runId) ?? {}, persisted: (row?.contextSnapshot ?? {}) as Record<string, unknown> };
  }

  it("resolves owner DMs to full and allowlisted member DMs to read_only from server records", async () => {
    const t = await setup();
    await addOwner(t, OWNER_PHONE);
    await t.service.openwa.addSenderRule(t.endpointId, { list: "allow", e164: "+" + MEMBER_PHONE }, t.userId);
    await goLive(t);

    t.gateway.inbound({ chatId: jid(OWNER_PHONE), body: "please fix the invoice export" });
    const owner = await runFor(t, jid(OWNER_PHONE), 0);
    expect(owner.context.paperclipOpenwa).toMatchObject({ triggerClass: "owner", profile: "full", toolProfile: "full", event: "message" });
    expect(owner.context.paperclipToolProfile).toBe("full");
    expect(owner.persisted.paperclipOpenwa).toMatchObject({ triggerClass: "owner", profile: "full" });

    t.gateway.inbound({ chatId: jid(MEMBER_PHONE), body: "why does error X happen?" });
    const member = await runFor(t, jid(MEMBER_PHONE), 1);
    expect(member.context.paperclipOpenwa).toMatchObject({ triggerClass: "other", profile: "read_only", toolProfile: "read_only", event: "message" });
    expect(member.context.paperclipToolProfile).toBe("read_only");
    expect(await wakeCount(t)).toBe(2);
    const ownerEnv = owner.context.capturedEnv as Record<string, string>;
    const memberEnv = member.context.capturedEnv as Record<string, string>;
    expect({ token: ownerEnv.GH_TOKEN, mode: ownerEnv.PAPERCLIP_GITHUB_AUTH_MODE }).toEqual({ token: "host-github-token", mode: "host" });
    expect({ token: memberEnv.GH_TOKEN ?? "", mode: memberEnv.PAPERCLIP_GITHUB_AUTH_MODE }).toEqual({ token: "", mode: "managed" });
    expect(memberEnv.PAPERCLIP_GITHUB_HOST_HOME).toBeUndefined();
    expect(memberEnv.PAPERCLIP_RUNNER_NETWORK_ACCESS).toBe(ownerEnv.PAPERCLIP_RUNNER_NETWORK_ACCESS);
  }, 120_000);

  it("keeps a member run read_only when its conversation binds an issue cached as non-OpenWA", async () => {
    const t = await setup();
    await t.service.openwa.addSenderRule(t.endpointId, { list: "allow", e164: "+" + MEMBER_PHONE }, t.userId);
    await goLive(t);
    const issueId = randomUUID();
    await db.insert(issues).values({ id: issueId, companyId: t.companyId, title: "Earlier task", status: "todo", assigneeAgentId: t.agentId });
    await db.insert(issueCreateIdempotencyKeys).values({
      companyId: t.companyId, issueId, idempotencyKey: `chat:${t.endpointId}:openwa:${SESSION_ID}:${jid(MEMBER_PHONE)}:1`,
    });
    await expect(resolveOpenwaRunContext(db, {
      companyId: t.companyId, issueId, runId: randomUUID(), contextSnapshot: {}, wakeupRequestId: null,
    })).resolves.toBeNull();
    t.gateway.inbound({ chatId: jid(MEMBER_PHONE), body: "why does error X happen?" });
    const member = await runFor(t, jid(MEMBER_PHONE), 0);
    const [conversation] = await db.select({ issueId: chatConversations.issueId }).from(chatConversations).where(eq(chatConversations.endpointId, t.endpointId));
    expect(conversation!.issueId).toBe(issueId);
    expect(member.context.paperclipToolProfile).toBe("read_only");
    expect(member.context.paperclipOpenwa).toMatchObject({ triggerClass: "other", profile: "read_only" });
  }, 120_000);

  it("keeps a forged agent wakeup claiming the owner class read_only on the OpenWA issue", async () => {
    const t = await setup();
    await t.service.openwa.addSenderRule(t.endpointId, { list: "allow", e164: "+" + MEMBER_PHONE }, t.userId);
    await goLive(t);
    t.gateway.inbound({ chatId: jid(MEMBER_PHONE), body: "hello" });
    await runFor(t, jid(MEMBER_PHONE), 0);
    const [conversation] = await db.select().from(chatConversations).where(eq(chatConversations.endpointId, t.endpointId));
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = { type: "agent", agentId: t.agentId, companyId: t.companyId, source: "agent_jwt" } as Express.Request["actor"];
      next();
    });
    app.use("/api", agentRoutes(db));
    app.use(errorHandler);
    const forged = { triggerClass: "owner", event: "message", deliveryIds: [] };
    const res = await request(app).post("/api/agents/" + t.agentId + "/wakeup").send({
      source: "on_demand", reason: "forged",
      payload: { issueId: conversation!.issueId, openwa: forged, paperclipOpenwa: { triggerClass: "owner", profile: "full" }, paperclipToolProfile: "full" },
    });
    expect(res.status).toBe(202);
    const run = await finishedContext(t, (await db.select({ id: heartbeatRuns.wakeupRequestId }).from(heartbeatRuns).where(eq(heartbeatRuns.id, res.body.id)))[0]!.id!);
    expect(run.context.paperclipOpenwa).toMatchObject({ triggerClass: "other", profile: "read_only" });
    expect(run.context.paperclipToolProfile).toBe("read_only");
  }, 120_000);

  it("drops to read_only when the owner link is revoked between admission and run start", async () => {
    const t = await setup();
    const owner = await addOwner(t, OWNER_PHONE);
    await t.service.openwa.addSenderRule(t.endpointId, { list: "allow", e164: "+" + OWNER_PHONE }, t.userId);
    await goLive(t);
    await db.update(agents).set({ runtimeConfig: { heartbeat: { maxConcurrentRuns: 1 } } }).where(eq(agents.id, t.agentId));
    const blockerId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: blockerId, companyId: t.companyId, agentId: t.agentId, status: "running", invocationSource: "on_demand",
      triggerDetail: "manual", contextSnapshot: {},
    });
    t.gateway.inbound({ chatId: jid(OWNER_PHONE), body: "owner request" });
    const queued = await until(async () => {
      await t.service.processPendingDeliveries();
      const [action] = await db.select({ id: chatActions.id }).from(chatActions)
        .where(and(eq(chatActions.companyId, t.companyId), eq(chatActions.kind, "inbound_wakeup")));
      if (!action) return null;
      const [wake] = await db.select({ runId: agentWakeupRequests.runId }).from(agentWakeupRequests).where(eq(agentWakeupRequests.id, action.id));
      return wake?.runId ? { actionId: action.id, runId: wake.runId } : null;
    });
    const [pending] = await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns).where(eq(heartbeatRuns.id, queued.runId));
    expect(pending!.status).toBe("queued");
    await t.service.revokeLink(t.endpointId, owner.principalId);
    await db.update(heartbeatRuns).set({ status: "succeeded", finishedAt: new Date() }).where(eq(heartbeatRuns.id, blockerId));
    await t.heartbeat.resumeQueuedRuns();
    const run = await finishedContext(t, queued.actionId);
    expect(run.context.paperclipOpenwa).toMatchObject({ triggerClass: "other", profile: "read_only", toolProfile: "read_only" });
    expect(run.context.paperclipToolProfile).toBe("read_only");
  }, 120_000);
});
