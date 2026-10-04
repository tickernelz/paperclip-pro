import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import {
  agents,
  agentWakeupRequests,
  authUsers,
  chatActions,
  chatAuditEntries,
  chatDeliveries,
  chatEndpoints,
  companies,
  companyMemberships,
  companySecretBindings,
  createDb,
  heartbeatRuns,
  toolConnections,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import { startEmbeddedPostgresTestDatabase } from "../helpers/embedded-postgres.js";
import { chatChannelService, type ChatChannelService, type ChatChannelServiceOptions } from "../../services/chat-channels.js";
import { ChatSdkRuntime } from "../../services/chat-sdk-runtime.js";
import { instanceSettingsService } from "../../services/instance-settings.js";
import { secretService } from "../../services/secrets.js";
import { resolveOpenwaRunContext } from "../../services/openwa/authority.js";
import { buildOpenwaRunGuidance } from "../../services/openwa/guidance.js";
import { OPENWA_SESSION_HEALTH_WAKE_ACTION_KIND } from "../../services/openwa/session-health.js";
import { FAKE_OPENWA_KEY, FakeOpenwaGateway } from "./fake-gateway.js";

const SESSION_ID = "51111111-2222-4333-8444-555555555555";
const OWN_PHONE = "628111000511";
const OWNER_PHONE = "628333000511";
const jid = (phone: string) => phone + "@c.us";

type WakeupOptions = Parameters<ChatChannelServiceOptions["heartbeat"]["wakeup"]>[1];

async function until(predicate: () => boolean | Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe.sequential("OpenWA session_health wakes (embedded Postgres + fake gateway)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let scratch: string;
  const oldKey = process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
  const services: ChatChannelService[] = [];
  const gateways: FakeOpenwaGateway[] = [];
  const endpointIds: string[] = [];

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-openwa-health-");
    db = createDb(database.connectionString);
    scratch = await mkdtemp(path.join(tmpdir(), "openwa-health-"));
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
    await gateway.start();
    gateways.push(gateway);
    const companyId = randomUUID();
    const agentId = randomUUID();
    const userId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "OpenWA health",
      issuePrefix: "H" + companyId.replaceAll("-", "").slice(0, 7).toUpperCase(),
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
    await db.insert(authUsers).values({ id: userId, name: "Owner", email: userId + "@example.com", emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "operator" });
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
      scheduleDeferredWork: () => {},
      discordGatewayLeaseTtlMs: 120_000,
      discordGatewayLeaseRenewalIntervalMs: 60_000,
      discordGatewayLeaseWaitMs: 200,
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
    await db
      .update(toolConnections)
      .set({
        status: "active",
        enabled: true,
        credentialSecretRefs: [
          { secretId: secret.id, versionSelector: "latest", configPath: "credentials.apiKey", required: true, label: "apiKey", projectionClass: "unclassified" },
        ],
      })
      .where(eq(toolConnections.id, row!.connectionId));
    await db.insert(companySecretBindings).values({
      companyId,
      secretId: secret.id,
      targetType: "tool_connection",
      targetId: row!.connectionId,
      configPath: "credentials.apiKey",
      versionSelector: "latest",
      required: true,
      label: "apiKey",
      projectionClass: "unclassified",
    });
    await db
      .update(chatEndpoints)
      .set({
        status: "active",
        providerAccountId: gateway.baseUrl + "#" + SESSION_ID,
        botExternalId: OWN_PHONE,
        setup: { step: "complete", testStartedAt: new Date(Date.now() - 60_000).toISOString() },
      })
      .where(eq(chatEndpoints.id, endpoint.id));
    const added = await service.openwa.addOwner(endpoint.id, { e164: "+" + OWNER_PHONE, expiresInSeconds: 1_800 }, userId);
    const token = new URL(added.confirmationUrl!, "https://paperclip.example").searchParams.get("token")!;
    await service.confirmIdentityLink(token, userId);
    expect((await service.reconcileProviderRuntimes()).local).toBe(1);
    await gateway.waitForSubscription();
    return { gateway, companyId, agentId, userId, endpointId: endpoint.id, service, wakes, wakeup };
  }

  type Setup = Awaited<ReturnType<typeof setup>>;

  async function ownerConversation(t: Setup) {
    const before = await db.select({ id: chatDeliveries.id }).from(chatDeliveries).where(eq(chatDeliveries.endpointId, t.endpointId));
    t.gateway.inbound({ chatId: jid(OWNER_PHONE), body: "halo" });
    let swept = Date.now();
    await until(async () => {
      if (Date.now() - swept > 1_000) {
        swept = Date.now();
        await t.service.processPendingDeliveries();
      }
      const rows = await db.select().from(chatDeliveries).where(eq(chatDeliveries.endpointId, t.endpointId));
      return rows.length > before.length && rows.every((entry) => entry.state === "processed");
    }, 30_000);
    const [delivery] = await db
      .select()
      .from(chatDeliveries)
      .where(eq(chatDeliveries.endpointId, t.endpointId))
      .orderBy(asc(chatDeliveries.createdAt));
    const [inbound] = await db
      .select()
      .from(chatActions)
      .where(and(eq(chatActions.deliveryId, delivery!.id), eq(chatActions.kind, "inbound_wakeup")));
    await until(() => t.wakes.has(inbound!.id));
    return { conversationId: inbound!.conversationId!, issueId: String(t.wakes.get(inbound!.id)!.contextSnapshot!.issueId) };
  }

  async function healthActions(t: Setup) {
    return db
      .select()
      .from(chatActions)
      .where(and(eq(chatActions.endpointId, t.endpointId), eq(chatActions.kind, OPENWA_SESSION_HEALTH_WAKE_ACTION_KIND)))
      .orderBy(asc(chatActions.createdAt));
  }

  async function healthAudits(t: Setup) {
    return db
      .select()
      .from(chatAuditEntries)
      .where(and(eq(chatAuditEntries.endpointId, t.endpointId), eq(chatAuditEntries.kind, "session_health")))
      .orderBy(asc(chatAuditEntries.occurredAt));
  }

  async function endpointStatus(t: Setup) {
    return (await db.select({ status: chatEndpoints.status }).from(chatEndpoints).where(eq(chatEndpoints.id, t.endpointId)))[0]!.status;
  }

  async function wakeFor(t: Setup, actionId: string) {
    await until(() => t.wakes.has(actionId));
    const [request] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, actionId));
    return { request: request!, wake: t.wakes.get(actionId)! };
  }

  async function runContext(t: Setup, wake: Awaited<ReturnType<typeof wakeFor>>) {
    const runId = randomUUID();
    const issueId = String(wake.wake.contextSnapshot!.issueId);
    const contextSnapshot: Record<string, unknown> = { ...wake.wake.contextSnapshot };
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId: t.companyId,
      agentId: t.agentId,
      status: "running",
      wakeupRequestId: wake.request.id,
      startedAt: new Date(),
      contextSnapshot,
    });
    const openwa = await resolveOpenwaRunContext(db, { companyId: t.companyId, issueId, runId, contextSnapshot, wakeupRequestId: wake.request.id });
    expect(openwa).not.toBeNull();
    const guidance = await buildOpenwaRunGuidance(db, {
      companyId: t.companyId,
      issueId,
      runId,
      wakeupRequestId: wake.request.id,
      openwa: openwa!,
      contextSnapshot,
    });
    return { openwa: openwa!, guidance: guidance! };
  }

  it("wakes the owner conversation once per health transition with class other/read_only", async () => {
    const t = await setup();
    const owner = await ownerConversation(t);
    const baseWakes = t.wakeup.mock.calls.length;

    t.gateway.emit("session.status", { sessionId: SESSION_ID, status: "disconnected" });
    await until(async () => (await endpointStatus(t)) === "attention");
    await until(async () => (await healthActions(t)).length === 1);
    const [down] = await healthActions(t);
    expect(down).toMatchObject({ conversationId: owner.conversationId });
    const downWake = await wakeFor(t, down!.id);
    expect(downWake.request.payload).toMatchObject({
      issueId: owner.issueId,
      openwa: { event: "session_health", triggerClass: "other", deliveryIds: [], sessionHealth: { kind: "status", healthy: false, status: "disconnected" } },
    });
    expect(downWake.wake.contextSnapshot).toMatchObject({ issueId: owner.issueId, source: "chat:openwa" });
    expect(downWake.wake.allowRunCoalescing).toBe(false);
    const downRun = await runContext(t, downWake);
    expect(downRun.openwa).toMatchObject({ triggerClass: "other", profile: "read_only", event: "session_health" });
    expect(downRun.guidance.wakeEvent).toMatchObject({
      event: "session_health",
      triggerClass: "other",
      profile: "read_only",
      sessionHealth: { kind: "status", healthy: false, status: "disconnected", restriction: null },
    });
    expect(downRun.guidance.markdown).toContain("The WhatsApp session health changed.");

    t.gateway.emit("session.status", { sessionId: SESSION_ID, status: "disconnected" });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(await healthActions(t)).toHaveLength(1);
    expect(t.wakeup.mock.calls.length).toBe(baseWakes + 1);

    t.gateway.emit("session.status", { sessionId: SESSION_ID, status: "ready" });
    await until(async () => (await endpointStatus(t)) === "active");
    await until(async () => (await healthActions(t)).length === 2);
    const up = (await healthActions(t))[1]!;
    const upWake = await wakeFor(t, up.id);
    expect(upWake.request.payload).toMatchObject({
      openwa: { event: "session_health", triggerClass: "other", sessionHealth: { kind: "status", healthy: true, status: "ready" } },
    });
    expect((await runContext(t, upWake)).openwa).toMatchObject({ triggerClass: "other", profile: "read_only" });

    t.gateway.emit("session.status", { sessionId: SESSION_ID, status: "ready" });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(await healthActions(t)).toHaveLength(2);
    expect(t.wakeup.mock.calls.length).toBe(baseWakes + 2);

    t.gateway.emit("session.restriction", { sessionId: SESSION_ID, active: true, kind: "temporary", code: "463", expiresAt: "2026-10-05T00:00:00.000Z" });
    await until(async () => (await healthActions(t)).length === 3);
    const restrictedWake = await wakeFor(t, (await healthActions(t))[2]!.id);
    const restrictedRun = await runContext(t, restrictedWake);
    expect(restrictedRun.guidance.wakeEvent.sessionHealth).toEqual({
      kind: "restriction",
      healthy: false,
      status: null,
      restriction: { active: true, kind: "temporary", expiresAt: "2026-10-05T00:00:00.000Z" },
    });
    const audits = await healthAudits(t);
    expect(audits).toHaveLength(3);
    expect(audits.map((entry) => (entry.metadata as Record<string, unknown>).wakeActionId)).toEqual((await healthActions(t)).map((action) => action.id));
  }, 120_000);

  it("skips the wake and records why when no owner conversation exists", async () => {
    const t = await setup();
    const baseWakes = t.wakeup.mock.calls.length;
    t.gateway.emit("session.status", { sessionId: SESSION_ID, status: "disconnected" });
    await until(async () => (await endpointStatus(t)) === "attention");
    await until(async () => (await healthAudits(t)).length === 1);
    const [audit] = await healthAudits(t);
    expect(audit!.metadata).toMatchObject({ healthy: false, status: "disconnected", wakeSkipped: "no_owner_conversation" });
    expect(await healthActions(t)).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(t.wakeup.mock.calls.length).toBe(baseWakes);
  }, 120_000);
});
