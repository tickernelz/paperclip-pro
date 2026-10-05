import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import {
  activityLog,
  agents,
  agentWakeupRequests,
  authUsers,
  chatActions,
  chatDeliveries,
  chatEndpoints,
  companies,
  companyMemberships,
  createDb,
  heartbeatRuns,
  principalPermissionGrants,
  toolConnections,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import { startEmbeddedPostgresTestDatabase } from "../helpers/embedded-postgres.js";
import { createLocalDiskStorageProvider } from "../../storage/local-disk-provider.js";
import { createStorageService } from "../../storage/service.js";
import { chatChannelService, type ChatChannelService, type ChatChannelServiceOptions } from "../../services/chat-channels.js";
import { ChatSdkRuntime } from "../../services/chat-sdk-runtime.js";
import { resolveChatRunPresentationAuthorizationReason } from "../../services/chat-run-publications.js";
import { instanceSettingsService } from "../../services/instance-settings.js";
import { secretService } from "../../services/secrets.js";
import { issueService } from "../../services/issues.js";
import { applyOpenwaRunContext, resolveOpenwaRunContext } from "../../services/openwa/authority.js";
import { OPENWA_WAKE_CONTEXT_KEY, buildOpenwaRunGuidance, type OpenwaWakeEvent } from "../../services/openwa/guidance.js";
import { executeOpenwaTool } from "../../services/openwa/tools.js";
import { chatChannelRoutes } from "../../routes/chat-channels.js";
import { errorHandler } from "../../middleware/index.js";
import { FAKE_OPENWA_ADMIN_KEY, FAKE_OPENWA_KEY, FakeOpenwaGateway } from "./fake-gateway.js";

const SESSION_ID = "51111111-2222-4333-8444-555555555555";
const OWN_PHONE = "628111000517";
const OWNER_PHONE = "628333000517";
const MEMBER_PHONE = "628666000517";

const jid = (phone: string) => phone + "@c.us";

type WakeupOptions = Parameters<ChatChannelServiceOptions["heartbeat"]["wakeup"]>[1];

async function until(predicate: () => boolean | Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe.sequential("OpenWA activation through the owner test DM (embedded Postgres + fake gateway)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let scratch: string;
  const oldKey = process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
  const services: ChatChannelService[] = [];
  const gateways: FakeOpenwaGateway[] = [];
  const endpointIds: string[] = [];

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-openwa-activation-");
    db = createDb(database.connectionString);
    scratch = await mkdtemp(path.join(tmpdir(), "openwa-activation-"));
    process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = path.join(scratch, "master.key");
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
    if (scratch) await rm(scratch, { recursive: true, force: true });
    if (oldKey === undefined) delete process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
    else process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = oldKey;
  });

  async function setup() {
    const gateway = new FakeOpenwaGateway({ sessionId: SESSION_ID, ownPhone: OWN_PHONE });
    gateway.overrides.push({
      method: "GET",
      path: "/api/sessions",
      status: 200,
      body: [{ id: SESSION_ID, name: "ops", status: "ready", phone: OWN_PHONE, pushName: "Ops Desk", engineLoaded: true }],
    });
    await gateway.start();
    gateways.push(gateway);
    const companyId = randomUUID();
    const agentId = randomUUID();
    const userId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "OpenWA activation",
      issuePrefix: "A" + companyId.replaceAll("-", "").slice(0, 7).toUpperCase(),
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "OpenWA Agent",
      role: "engineer",
      status: "idle",
      adapterType: "claude_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(authUsers).values({ id: userId, name: "Owner", email: userId + "@example.com", emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "operator" });
    await db.insert(principalPermissionGrants).values({
      companyId,
      principalType: "user",
      principalId: userId,
      permissionKey: "tools:manage_connections",
      grantedByUserId: userId,
    });
    const wakes = new Map<string, WakeupOptions>();
    const wakeup = vi.fn<ChatChannelServiceOptions["heartbeat"]["wakeup"]>(async (wakeAgentId, opts) => {
      const durable = opts.durableChatRequest;
      if (!durable) return { accepted: true } as never;
      await db.transaction(async (tx) => {
        await durable.authorize(tx as unknown as Parameters<typeof durable.authorize>[0]);
        await tx
          .insert(agentWakeupRequests)
          .values({
            id: durable.id,
            companyId: durable.companyId,
            agentId: wakeAgentId,
            source: opts.source ?? "assignment",
            triggerDetail: opts.triggerDetail,
            reason: opts.reason,
            payload: opts.payload,
            requestedByActorType: opts.requestedByActorType,
            requestedByActorId: opts.requestedByActorId,
            idempotencyKey: durable.idempotencyKey,
            requestedAt: durable.requestedAt,
            status: "queued",
          })
          .onConflictDoNothing();
      });
      wakes.set(durable.id, opts);
      return { accepted: true } as never;
    });
    const service = chatChannelService(db, {
      runtime: new ChatSdkRuntime(),
      publicBaseUrl: "https://paperclip.example",
      heartbeat: { wakeup } as never,
      storage: createStorageService(createLocalDiskStorageProvider(path.join(scratch, "storage"))),
      scheduleDeferredWork: () => {},
      discordGatewayLeaseTtlMs: 120_000,
      discordGatewayLeaseRenewalIntervalMs: 60_000,
      discordGatewayLeaseWaitMs: 200,
    });
    services.push(service);
    const endpoint = await service.create(companyId, { provider: "openwa", assignedAgentId: agentId } as never, userId);
    endpointIds.push(endpoint.id);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = {
        type: "board",
        source: "session",
        userId,
        isInstanceAdmin: false,
        companyIds: [companyId],
        memberships: [{ companyId, status: "active", membershipRole: "operator" }],
      } as never;
      next();
    });
    app.use("/api", chatChannelRoutes(db, { heartbeat: { wakeup: async () => undefined } as never, service }));
    app.use(errorHandler);
    return { gateway, companyId, agentId, userId, endpointId: endpoint.id, service, wakes, wakeup, app };
  }

  type Setup = Awaited<ReturnType<typeof setup>>;

  async function deliveries(t: Setup) {
    return db
      .select()
      .from(chatDeliveries)
      .where(and(eq(chatDeliveries.companyId, t.companyId), eq(chatDeliveries.endpointId, t.endpointId)))
      .orderBy(asc(chatDeliveries.createdAt));
  }

  async function settled(t: Setup, input: Parameters<FakeOpenwaGateway["inbound"]>[0]) {
    const before = (await deliveries(t)).length;
    const row = t.gateway.inbound(input);
    let swept = Date.now();
    await until(async () => {
      if (Date.now() - swept > 1_000) {
        swept = Date.now();
        await t.service.processPendingDeliveries();
      }
      const rows = await deliveries(t);
      return rows.length > before && rows.every((entry) => entry.state === "processed" || entry.state === "filtered");
    }, 30_000);
    return { row, delivery: (await deliveries(t)).at(-1)! };
  }

  async function endpointRow(t: Setup) {
    const [row] = await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, t.endpointId));
    return row!;
  }

  it("AC1: configure, attest, owner test DM answered by the agent, then verifying becomes active; a non-owner DM never wakes or activates", async () => {
    const t = await setup();
    const configured = await request(t.app)
      .post("/api/chat-endpoints/" + t.endpointId + "/setup")
      .send({
        action: "configure",
        credentials: { apiKey: FAKE_OPENWA_KEY },
        openwa: { baseUrl: t.gateway.baseUrl, sessionId: SESSION_ID, numberMode: "agent_number", attestations: { pacing: true, soleClient: true } },
      });
    expect(configured.status).toBe(200);
    expect(configured.body).toMatchObject({ status: "verifying", setup: { step: "test" } });

    const added = await t.service.openwa.addOwner(t.endpointId, { e164: "+" + OWNER_PHONE, expiresInSeconds: 1_800 }, t.userId);
    const token = new URL(added.confirmationUrl!, "https://paperclip.example").searchParams.get("token")!;
    await t.service.confirmIdentityLink(token, t.userId);
    await t.service.openwa.addSenderRule(t.endpointId, { list: "allow", e164: "+" + MEMBER_PHONE }, t.userId);

    await t.service.reconcileProviderRuntimes();
    await t.gateway.waitForSubscription();

    const early = await request(t.app).post("/api/chat-endpoints/" + t.endpointId + "/test").send({});
    expect(early.status).toBe(409);
    expect(early.body.details).toMatchObject({ code: "chat_test_message_missing" });

    const member = await settled(t, { chatId: jid(MEMBER_PHONE), body: "halo, ini tes" });
    expect(member.delivery).toMatchObject({ state: "filtered", redactedError: "Only an endpoint owner can send the OpenWA setup test message" });
    const memberWake = await db
      .select({ id: chatActions.id })
      .from(chatActions)
      .where(and(eq(chatActions.deliveryId, member.delivery.id), eq(chatActions.kind, "inbound_wakeup")));
    expect(memberWake).toEqual([]);
    expect(t.wakeup).not.toHaveBeenCalled();
    const afterMember = await request(t.app).post("/api/chat-endpoints/" + t.endpointId + "/test").send({});
    expect(afterMember.status).toBe(409);
    expect((await endpointRow(t)).status).toBe("verifying");

    const owner = await settled(t, { chatId: jid(OWNER_PHONE), body: "tes koneksi" });
    expect(owner.delivery).toMatchObject({ state: "processed", triggerClass: "owner", principalRole: "owner" });
    const [action] = await db
      .select()
      .from(chatActions)
      .where(and(eq(chatActions.deliveryId, owner.delivery.id), eq(chatActions.kind, "inbound_wakeup")));
    await until(() => t.wakes.has(action!.id));
    const wake = t.wakes.get(action!.id)!;
    const [wakeRequest] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, action!.id));

    const pending = await request(t.app).post("/api/chat-endpoints/" + t.endpointId + "/test").send({});
    expect(pending.status).toBe(409);
    expect(pending.body.details).toMatchObject({ code: "chat_test_round_trip_incomplete" });

    const runId = randomUUID();
    const issueId = String(wake.contextSnapshot!.issueId);
    const contextSnapshot: Record<string, unknown> = { ...wake.contextSnapshot };
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId: t.companyId,
      agentId: t.agentId,
      status: "running",
      wakeupRequestId: wakeRequest!.id,
      startedAt: new Date(),
      contextSnapshot,
    });
    const openwa = await resolveOpenwaRunContext(db, { companyId: t.companyId, issueId, contextSnapshot, wakeupRequestId: wakeRequest!.id, runId });
    expect(openwa).toMatchObject({ endpointId: t.endpointId, triggerClass: "owner", profile: "full" });
    applyOpenwaRunContext(contextSnapshot, openwa);
    const guidance = await buildOpenwaRunGuidance(db, { companyId: t.companyId, issueId, runId, wakeupRequestId: wakeRequest!.id, openwa: openwa!, contextSnapshot });
    contextSnapshot[OPENWA_WAKE_CONTEXT_KEY] = guidance!.wakeEvent;
    expect((guidance!.wakeEvent as OpenwaWakeEvent).messages.map((message) => message.text)).toEqual(["tes koneksi"]);
    await db.update(heartbeatRuns).set({ contextSnapshot }).where(eq(heartbeatRuns.id, runId));

    const authorizationReason = await resolveChatRunPresentationAuthorizationReason(db, { companyId: t.companyId, issueId, runId });
    await issueService(db).addComment(issueId, "Koneksi **berhasil**.", { agentId: t.agentId, runId }, { authorizationReason });
    await db.update(heartbeatRuns).set({ status: "succeeded", finishedAt: new Date() }).where(eq(heartbeatRuns.id, runId));
    await t.service.processPendingPublications(25);
    expect(t.gateway.sends).toEqual([expect.objectContaining({ chatId: jid(OWNER_PHONE), text: "Koneksi *berhasil*." })]);
    expect(t.gateway.sends.some((send) => send.chatId === jid(MEMBER_PHONE))).toBe(false);

    const activated = await request(t.app).post("/api/chat-endpoints/" + t.endpointId + "/test").send({});
    expect(activated.status).toBe(200);
    expect(activated.body).toMatchObject({ status: "active", activatedAt: expect.any(String), setup: { step: "complete" } });
    expect(await endpointRow(t)).toMatchObject({ status: "active", setup: expect.objectContaining({ step: "complete" }) });
  }, 120_000);

  it("AC1: completes setup when the agent answers the owner test DM with openwa_send instead of a final comment", async () => {
    const t = await setup();
    await request(t.app)
      .post("/api/chat-endpoints/" + t.endpointId + "/setup")
      .send({
        action: "configure",
        credentials: { apiKey: FAKE_OPENWA_KEY },
        openwa: { baseUrl: t.gateway.baseUrl, sessionId: SESSION_ID, numberMode: "agent_number", attestations: { pacing: true, soleClient: true } },
      })
      .expect(200);
    const added = await t.service.openwa.addOwner(t.endpointId, { e164: "+" + OWNER_PHONE, expiresInSeconds: 1_800 }, t.userId);
    await t.service.confirmIdentityLink(new URL(added.confirmationUrl!, "https://paperclip.example").searchParams.get("token")!, t.userId);
    await t.service.reconcileProviderRuntimes();
    await t.gateway.waitForSubscription();

    const owner = await settled(t, { chatId: jid(OWNER_PHONE), body: "halo, tes koneksi" });
    const [action] = await db
      .select()
      .from(chatActions)
      .where(and(eq(chatActions.deliveryId, owner.delivery.id), eq(chatActions.kind, "inbound_wakeup")));
    await until(() => t.wakes.has(action!.id));
    const wake = t.wakes.get(action!.id)!;
    const issueId = String(wake.contextSnapshot!.issueId);
    const runId = randomUUID();
    const contextSnapshot: Record<string, unknown> = { ...wake.contextSnapshot };
    await db.insert(heartbeatRuns).values({
      id: runId, companyId: t.companyId, agentId: t.agentId, status: "running", wakeupRequestId: action!.id, startedAt: new Date(), contextSnapshot,
    });
    const openwa = await resolveOpenwaRunContext(db, { companyId: t.companyId, issueId, contextSnapshot, wakeupRequestId: action!.id, runId });
    applyOpenwaRunContext(contextSnapshot, openwa);
    await db.update(heartbeatRuns).set({ contextSnapshot }).where(eq(heartbeatRuns.id, runId));
    const binding = { companyId: t.companyId, agentId: t.agentId, runId, issueId };

    await expect(executeOpenwaTool(db, binding, "openwa_send", { text: "Halo, koneksi berhasil.", idempotencyKey: randomUUID() })).resolves.toMatchObject({ state: "delivered" });
    const whileRunning = await request(t.app).post("/api/chat-endpoints/" + t.endpointId + "/test").send({});
    expect(whileRunning.status).toBe(409);
    expect(whileRunning.body.details).toMatchObject({ code: "chat_test_round_trip_incomplete" });

    await db.update(heartbeatRuns).set({ status: "succeeded", finishedAt: new Date() }).where(eq(heartbeatRuns.id, runId));
    await t.service.processPendingPublications(25);
    expect(t.gateway.sends).toEqual([expect.objectContaining({ chatId: jid(OWNER_PHONE), text: "Halo, koneksi berhasil." })]);
    const activated = await request(t.app).post("/api/chat-endpoints/" + t.endpointId + "/test").send({});
    expect(activated.status).toBe(200);
    expect(activated.body).toMatchObject({ status: "active", setup: { step: "complete" } });
  }, 120_000);

  async function activeEndpoint(t: Setup) {
    await request(t.app)
      .post("/api/chat-endpoints/" + t.endpointId + "/setup")
      .send({
        action: "configure",
        credentials: { apiKey: FAKE_OPENWA_KEY },
        openwa: { baseUrl: t.gateway.baseUrl, sessionId: SESSION_ID, numberMode: "agent_number", attestations: { pacing: true, soleClient: true } },
      })
      .expect(200);
    const activatedAt = new Date(Date.now() - 60_000).toISOString();
    const configured = await endpointRow(t);
    await db
      .update(chatEndpoints)
      .set({ status: "active", healthMessage: "Connected", setup: { ...configured.setup, step: "complete", activatedAt } })
      .where(eq(chatEndpoints.id, t.endpointId));
    return { activatedAt, testStartedAt: (configured.setup as { testStartedAt?: string }).testStartedAt };
  }

  async function reconnectActivity(t: Setup) {
    return db
      .select({ action: activityLog.action, details: activityLog.details })
      .from(activityLog)
      .where(and(eq(activityLog.companyId, t.companyId), eq(activityLog.action, "chat_endpoint.reconnected")));
  }

  it("keeps an active endpoint active when a reconnect only adds the admin key, so members are still admitted", async () => {
    const t = await setup();
    const { activatedAt, testStartedAt } = await activeEndpoint(t);
    await t.service.openwa.addSenderRule(t.endpointId, { list: "allow", e164: "+" + MEMBER_PHONE }, t.userId);
    const before = await endpointRow(t);

    const reconnected = await request(t.app)
      .post("/api/chat-endpoints/" + t.endpointId + "/setup")
      .send({ action: "reconnect", credentials: { adminApiKey: FAKE_OPENWA_ADMIN_KEY } });
    expect(reconnected.status).toBe(200);
    expect(reconnected.body).toMatchObject({ status: "active", setup: { step: "complete" } });
    expect(JSON.stringify(reconnected.body)).not.toContain(FAKE_OPENWA_ADMIN_KEY);
    const after = await endpointRow(t);
    expect(after).toMatchObject({ status: "active", healthMessage: "Connected", providerAccountId: before.providerAccountId, botExternalId: before.botExternalId });
    expect(after.setup).toMatchObject({ step: "complete", activatedAt, testStartedAt });
    expect((after.setup as { runtimeGeneration?: number }).runtimeGeneration).toBe(((before.setup as { runtimeGeneration?: number }).runtimeGeneration ?? 0) + 1);
    const [connection] = await db.select().from(toolConnections).where(eq(toolConnections.id, after.connectionId));
    expect(connection!.credentialSecretRefs.map((ref) => ref.configPath).sort()).toEqual(["credentials.adminApiKey", "credentials.apiKey"]);
    const adminRef = connection!.credentialSecretRefs.find((ref) => ref.configPath === "credentials.adminApiKey")!;
    expect(await secretService(db).resolveSecretValue(t.companyId, adminRef.secretId, "latest")).toBe(FAKE_OPENWA_ADMIN_KEY);
    const activity = await reconnectActivity(t);
    expect(activity).toEqual([{ action: "chat_endpoint.reconnected", details: { endpointId: t.endpointId, provider: "openwa" } }]);
    expect(JSON.stringify(activity)).not.toContain(FAKE_OPENWA_ADMIN_KEY);

    await t.service.reconcileProviderRuntimes();
    await t.gateway.waitForSubscription();
    const member = await settled(t, { chatId: jid(MEMBER_PHONE), body: "halo, masih aktif?" });
    expect(member.delivery).toMatchObject({ state: "processed", principalRole: "allowed" });
    const memberWake = await db
      .select({ id: chatActions.id })
      .from(chatActions)
      .where(and(eq(chatActions.deliveryId, member.delivery.id), eq(chatActions.kind, "inbound_wakeup")));
    expect(memberWake).toHaveLength(1);
  }, 120_000);

  it("still sends an active endpoint back to verifying when a reconnect changes the operator key, and refuses a session change", async () => {
    const t = await setup();
    await activeEndpoint(t);

    const otherSession = await request(t.app)
      .post("/api/chat-endpoints/" + t.endpointId + "/setup")
      .send({
        action: "reconnect",
        credentials: { adminApiKey: FAKE_OPENWA_ADMIN_KEY },
        openwa: { baseUrl: t.gateway.baseUrl, sessionId: "61111111-2222-4333-8444-555555555555", numberMode: "agent_number", attestations: { pacing: true, soleClient: true } },
      });
    expect(otherSession.status).toBe(409);
    expect(otherSession.body.details).toMatchObject({ code: "chat_bot_identity_changed" });
    expect((await endpointRow(t)).status).toBe("active");

    const reconnected = await request(t.app)
      .post("/api/chat-endpoints/" + t.endpointId + "/setup")
      .send({ action: "reconnect", credentials: { apiKey: FAKE_OPENWA_ADMIN_KEY, adminApiKey: FAKE_OPENWA_ADMIN_KEY } });
    expect(reconnected.status).toBe(200);
    expect(reconnected.body).toMatchObject({ status: "verifying", healthMessage: "Waiting for a test conversation", setup: { step: "test" } });
    expect((await endpointRow(t)).setup).toMatchObject({ step: "test" });
    expect(await reconnectActivity(t)).toHaveLength(1);
  }, 120_000);
});
