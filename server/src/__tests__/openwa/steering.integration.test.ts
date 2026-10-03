import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  agents,
  agentWakeupRequests,
  authUsers,
  chatActions,
  chatConversations,
  chatDeliveries,
  chatEndpoints,
  companies,
  companyMemberships,
  companySecretBindings,
  createDb,
  heartbeatRuns,
  runIdentityContexts,
  toolConnections,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import { registerAdapterSteerTarget } from "@tickernelz/paperclip-pro-adapter-utils/adapter-steer-registry";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../helpers/embedded-postgres.js";
import { registerServerAdapter, unregisterServerAdapter } from "../../adapters/index.ts";
import { agentRoutes } from "../../routes/agents.ts";
import { issueRoutes } from "../../routes/issues.ts";
import { errorHandler } from "../../middleware/index.ts";
import { chatChannelService, type ChatChannelService } from "../../services/chat-channels.ts";
import { ChatSdkRuntime } from "../../services/chat-sdk-runtime.ts";
import { heartbeatService } from "../../services/heartbeat.ts";
import { secretService } from "../../services/secrets.ts";
import { OPENWA_HANDOFF_ACTION_KIND } from "../../services/openwa/tools.ts";
import { OPENWA_FOLLOWUP_WAKE_ACTION_KIND, OPENWA_STEERED_OWNER_ACTION_KIND, scheduleOpenwaFollowupForRun } from "../../services/openwa/followups.ts";
import { recordOpenwaLateTranscript, takeOpenwaLateTranscripts } from "../../services/openwa/late-transcripts.ts";
import { steerOpenwaLateTranscript } from "../../services/openwa/steering.ts";
import type { OpenwaScheduledWakeClock } from "../../services/openwa/scheduled-wakes.ts";
import { FAKE_OPENWA_KEY, FakeOpenwaGateway } from "./fake-gateway.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;
const ADAPTER_TYPE = "openwa_steering_capture";
const SESSION_ID = "31111111-2222-4333-8444-555555555555";
const OWN_PHONE = "628111000777";
const OWNER_PHONE = "628333000777";
const MEMBER_PHONE = "628444000777";
const GROUP = "120363000000000777@g.us";
const jid = (phone: string) => phone + "@c.us";

async function until<T>(probe: () => Promise<T | null | undefined | false>, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("condition not reached");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

class ManualClock implements OpenwaScheduledWakeClock {
  time = Date.now();
  private seq = 0;
  readonly timers = new Map<number, { at: number; fire: () => void }>();
  now() {
    return this.time;
  }
  setTimer(fire: () => void, delayMs: number) {
    const id = ++this.seq;
    this.timers.set(id, { at: this.time + delayMs, fire });
    return id;
  }
  clearTimer(handle: unknown) {
    this.timers.delete(handle as number);
  }
  advance(ms: number) {
    this.time += ms;
    for (const [id, timer] of [...this.timers]) {
      if (timer.at > this.time) continue;
      this.timers.delete(id);
      timer.fire();
    }
  }
}

describeEmbeddedPostgres("OpenWA wake classes, steering and follow-up owner runs", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let scratch: string;
  const previous = { home: process.env.PAPERCLIP_HOME, api: process.env.PAPERCLIP_API_URL, key: process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE };
  const captured = new Map<string, Record<string, unknown>>();
  const steered = new Map<string, string[]>();
  const holds = new Map<string, () => void>();
  const adapterMode = { steer: true, hold: true };
  const services: ChatChannelService[] = [];
  const gateways: FakeOpenwaGateway[] = [];
  const endpointIds: string[] = [];

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-openwa-steering-");
    db = createDb(database.connectionString);
    scratch = await mkdtemp(path.join(os.tmpdir(), "openwa-steering-"));
    process.env.PAPERCLIP_HOME = scratch;
    process.env.PAPERCLIP_API_URL = "http://127.0.0.1:3100/api";
    process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = path.join(scratch, "master.key");
    registerServerAdapter({
      type: ADAPTER_TYPE,
      supportsLocalAgentJwt: true,
      execute: async (ctx) => {
        captured.set(ctx.runId, { ...ctx.context });
        const unregister = adapterMode.steer
          ? registerAdapterSteerTarget(ctx.runId, {
              capabilities: async () => ({ steering: true }),
              snapshot: async () => ({ activeTurnId: "turn:" + ctx.runId }),
              steer: async (input) => {
                steered.set(ctx.runId, [...(steered.get(ctx.runId) ?? []), input.message.text]);
              },
            })
          : () => undefined;
        try {
          if (adapterMode.hold) await new Promise<void>((resolve) => holds.set(ctx.runId, resolve));
        } finally {
          unregister();
        }
        return { exitCode: 0, signal: null, timedOut: false, label: "Steering capture" };
      },
      testEnvironment: async () => ({ adapterType: ADAPTER_TYPE, status: "pass", checks: [], testedAt: new Date().toISOString() }),
    });
  }, 60_000);

  afterEach(async () => {
    adapterMode.hold = false;
    for (const release of holds.values()) release();
    holds.clear();
    await db.update(agentWakeupRequests).set({ status: "cancelled", finishedAt: new Date() })
      .where(sql`${agentWakeupRequests.status} in ('queued', 'deferred_issue_execution')`);
    await until(async () => {
      for (const release of holds.values()) release();
      const live = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(sql`${heartbeatRuns.status} in ('queued', 'running')`);
      return live.length === 0;
    });
    await Promise.all(services.splice(0).map((service) => service.shutdown()));
    await Promise.all(gateways.splice(0).map((gateway) => gateway.close()));
    for (const id of endpointIds.splice(0)) await db.update(chatEndpoints).set({ status: "archived" }).where(eq(chatEndpoints.id, id));
    captured.clear();
    steered.clear();
    adapterMode.steer = true;
    adapterMode.hold = true;
  });

  afterAll(async () => {
    unregisterServerAdapter(ADAPTER_TYPE);
    await database?.cleanup();
    if (scratch) await rm(scratch, { recursive: true, force: true });
    for (const [key, value] of [["PAPERCLIP_HOME", previous.home], ["PAPERCLIP_API_URL", previous.api], ["PAPERCLIP_SECRETS_MASTER_KEY_FILE", previous.key]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function setup(options: { scheduledClock?: OpenwaScheduledWakeClock; nudgeClock?: OpenwaScheduledWakeClock } = {}) {
    const gateway = new FakeOpenwaGateway({ sessionId: SESSION_ID, ownPhone: OWN_PHONE });
    await gateway.start();
    gateways.push(gateway);
    gateway.groups.set(GROUP, { id: GROUP, name: "Ops", participants: [{ id: jid(OWN_PHONE) }, { id: jid(OWNER_PHONE) }, { id: jid(MEMBER_PHONE) }] });
    const companyId = randomUUID();
    const agentId = randomUUID();
    const userId = randomUUID();
    await db.insert(companies).values({
      id: companyId, name: "OpenWA steering", issuePrefix: "T" + companyId.replaceAll("-", "").slice(0, 7).toUpperCase(),
      requireBoardApprovalForNewAgents: false, defaultResponsibleUserId: userId,
    });
    await db.insert(agents).values({
      id: agentId, companyId, name: "OpenWA Agent", role: "engineer", status: "idle",
      adapterType: ADAPTER_TYPE, adapterConfig: {}, runtimeConfig: { heartbeat: { maxConcurrentRuns: 1 } }, permissions: {},
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
      ...(options.scheduledClock ? { openwaScheduledWakeClock: options.scheduledClock } : {}),
      ...(options.nudgeClock ? { openwaNudgeClock: options.nudgeClock } : {}),
    });
    services.push(service);
    issueRoutes(db, {} as never, { steeringRetry: { delaysMs: [], budgetMs: 5_000, minAttemptMs: 2_000 } });
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
    const added = await service.openwa.addOwner(endpoint.id, { e164: "+" + OWNER_PHONE, expiresInSeconds: 1_800 }, userId);
    const token = new URL(added.confirmationUrl!, "https://paperclip.example").searchParams.get("token")!;
    await service.confirmIdentityLink(token, userId);
    await service.openwa.addSenderRule(endpoint.id, { list: "allow", e164: "+" + MEMBER_PHONE }, userId);
    await service.reconcileProviderRuntimes();
    await gateway.waitForSubscription();
    return { gateway, companyId, agentId, userId, endpointId: endpoint.id, service, heartbeat };
  }

  type Setup = Awaited<ReturnType<typeof setup>>;

  const mention = (author: string, text: string) => ({
    chatId: GROUP,
    author: jid(author),
    body: "@" + OWN_PHONE + " " + text,
    extra: { mentionedIds: [jid(OWN_PHONE)] },
  });

  async function admit(t: Setup, input: Parameters<FakeOpenwaGateway["inbound"]>[0]) {
    const row = t.gateway.inbound(input);
    return until(async () => {
      await t.service.processPendingDeliveries();
      const [delivery] = await db.select().from(chatDeliveries).where(and(
        eq(chatDeliveries.endpointId, t.endpointId),
        sql`${chatDeliveries.normalizedEvent} -> 'openwa' ->> 'waMessageId' = ${row.waMessageId}`,
      ));
      if (!delivery || delivery.state !== "processed") return null;
      const [action] = await db.select().from(chatActions).where(and(eq(chatActions.deliveryId, delivery.id), eq(chatActions.kind, "inbound_wakeup")));
      if (!action || !["processed", "failed"].includes(action.status)) return null;
      const [wake] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, action.id));
      return wake ? { row, delivery, action, wake } : null;
    });
  }

  async function runningRun(t: Setup, wakeupRequestId: string) {
    return until(async () => {
      const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, t.companyId), eq(heartbeatRuns.wakeupRequestId, wakeupRequestId)));
      return run && run.status === "running" && holds.has(run.id) ? run : null;
    });
  }

  async function finishedRun(t: Setup, wakeupRequestId: string) {
    return until(async () => {
      const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, t.companyId), eq(heartbeatRuns.wakeupRequestId, wakeupRequestId)));
      return run && !["queued", "running"].includes(run.status) && captured.has(run.id) ? run : null;
    });
  }

  function release(runId: string) {
    holds.get(runId)?.();
    holds.delete(runId);
  }

  async function wakeRow(id: string) {
    const [row] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, id));
    return row!;
  }

  async function runContext(runId: string) {
    const [row] = await db.select({ contextSnapshot: heartbeatRuns.contextSnapshot }).from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
    return (row?.contextSnapshot ?? {}) as Record<string, unknown>;
  }

  it("queues a member trigger and an unclassified wake behind an owner run, steers an owner message into a member read_only run and follows up with an owner run (AC9)", async () => {
    const t = await setup();
    const ownerFirst = await admit(t, mention(OWNER_PHONE, "please fix the invoice export"));
    const ownerRun = await runningRun(t, ownerFirst.action.id);
    expect((await runContext(ownerRun.id)).paperclipOpenwa).toMatchObject({ triggerClass: "owner", profile: "full" });

    const member = await admit(t, mention(MEMBER_PHONE, "why does error X happen?"));
    expect(member.delivery.triggerClass).toBe("other");
    expect((await wakeRow(member.action.id)).status).toBe("deferred_issue_execution");

    const [conversation] = await db.select().from(chatConversations).where(eq(chatConversations.endpointId, t.endpointId));
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = { type: "agent", agentId: t.agentId, companyId: t.companyId, source: "agent_jwt" } as Express.Request["actor"];
      next();
    });
    app.use("/api", agentRoutes(db));
    app.use(errorHandler);
    const forged = await request(app).post("/api/agents/" + t.agentId + "/wakeup").send({
      source: "on_demand", reason: "forged class claim",
      payload: { issueId: conversation!.issueId, openwa: { triggerClass: "owner", event: "message", deliveryIds: [] } },
    });
    expect(forged.status).toBe(202);
    const forgedWake = await until(async () => {
      const rows = await db.select().from(agentWakeupRequests).where(and(
        eq(agentWakeupRequests.companyId, t.companyId),
        eq(agentWakeupRequests.source, "on_demand"),
        eq(agentWakeupRequests.requestedByActorType, "agent"),
      ));
      return rows[0] ?? null;
    });
    expect(forgedWake.status).not.toBe("coalesced");
    expect(forgedWake.runId).not.toBe(ownerRun.id);
    expect(steered.get(ownerRun.id)).toBeUndefined();

    release(ownerRun.id);
    const memberRun = await runningRun(t, member.action.id);
    expect((await runContext(memberRun.id)).paperclipOpenwa).toMatchObject({ triggerClass: "other", profile: "read_only" });

    const ownerLate = await admit(t, mention(OWNER_PHONE, "also deploy the fix to staging"));
    expect(ownerLate.delivery.triggerClass).toBe("owner");
    const steeredText = await until(async () => steered.get(memberRun.id)?.[0] ?? null);
    expect(steeredText).toContain("endpoint owner");
    expect(steeredText).toContain("stays read_only");
    expect(steeredText).toContain("also deploy the fix to staging");
    expect((await wakeRow(ownerLate.action.id)).status).toBe("cancelled");
    const [memberAfter] = await db.select({ responsibleUserId: heartbeatRuns.responsibleUserId, activeIdentityContextId: heartbeatRuns.activeIdentityContextId })
      .from(heartbeatRuns).where(eq(heartbeatRuns.id, memberRun.id));
    expect(memberAfter).toEqual({ responsibleUserId: memberRun.responsibleUserId, activeIdentityContextId: memberRun.activeIdentityContextId });
    expect(await db.select({ id: runIdentityContexts.id }).from(runIdentityContexts).where(and(eq(runIdentityContexts.runId, memberRun.id), eq(runIdentityContexts.cause, "steering")))).toEqual([]);
    const memberContext = await runContext(memberRun.id);
    expect(memberContext.paperclipOpenwa).toMatchObject({ triggerClass: "other", profile: "read_only" });
    expect(memberContext.paperclipToolProfile).toBe("read_only");
    expect((memberContext.openwa as { deliveryIds: string[] }).deliveryIds).toContain(ownerLate.delivery.id);
    const [recorded] = await db.select().from(chatActions).where(and(eq(chatActions.endpointId, t.endpointId), eq(chatActions.kind, OPENWA_STEERED_OWNER_ACTION_KIND)));
    expect(recorded!.payload).toMatchObject({ runId: memberRun.id, triggerIds: [ownerLate.delivery.id] });

    adapterMode.hold = false;
    release(memberRun.id);
    const followup = await until(async () => {
      const [row] = await db.select().from(chatActions).where(and(eq(chatActions.endpointId, t.endpointId), eq(chatActions.kind, OPENWA_FOLLOWUP_WAKE_ACTION_KIND)));
      return row ?? null;
    });
    expect(followup.payload).toMatchObject({ sourceRunId: memberRun.id, openwa: { triggerClass: "owner", deliveryIds: [ownerLate.delivery.id] } });
    const followupRun = await finishedRun(t, followup.id);
    expect(captured.get(followupRun.id)!.paperclipOpenwa).toMatchObject({ triggerClass: "owner", profile: "full" });
    const followups = await db.select().from(chatActions).where(and(eq(chatActions.endpointId, t.endpointId), eq(chatActions.kind, OPENWA_FOLLOWUP_WAKE_ACTION_KIND)));
    expect(followups).toHaveLength(1);
  }, 180_000);

  it("steers an owner follow-up into a live steer target, never sends nudges to WhatsApp, and queues without steering or in queue mode (AC2)", async () => {
    const nudgeClock = new ManualClock();
    const t = await setup({ nudgeClock });
    const first = await admit(t, { chatId: jid(OWNER_PHONE), body: "fix the invoice export" });
    const ownerRun = await runningRun(t, first.action.id);
    const second = await admit(t, { chatId: jid(OWNER_PHONE), body: "and add a test for it" });
    const text = await until(async () => steered.get(ownerRun.id)?.[0] ?? null);
    expect(text).toContain("and add a test for it");
    expect(text).not.toContain("stays read_only");
    expect((await wakeRow(second.action.id)).status).toBe("cancelled");

    await until(async () => nudgeClock.timers.size === 1);
    nudgeClock.advance(60_000);
    const nudge = await until(async () => steered.get(ownerRun.id)?.find((entry) => entry.includes("progress reminder")) ?? null);
    expect(nudge).toContain("not sent to WhatsApp");
    expect(t.gateway.sends).toEqual([]);

    await db.update(chatEndpoints).set({ inflightMode: "queue" }).where(eq(chatEndpoints.id, t.endpointId));
    const queuedByMode = await admit(t, { chatId: jid(OWNER_PHONE), body: "queue mode message" });
    expect((await wakeRow(queuedByMode.action.id)).status).toBe("deferred_issue_execution");
    expect(steered.get(ownerRun.id)!.some((entry) => entry.includes("queue mode message"))).toBe(false);
    await db.update(chatEndpoints).set({ inflightMode: "steer" }).where(eq(chatEndpoints.id, t.endpointId));

    adapterMode.steer = false;
    release(ownerRun.id);
    const queuedRun = await runningRun(t, queuedByMode.action.id);
    const third = await admit(t, { chatId: jid(OWNER_PHONE), body: "non steering adapter message" });
    expect((await wakeRow(third.action.id)).status).toBe("deferred_issue_execution");
    adapterMode.hold = false;
    release(queuedRun.id);
    const nextRun = await finishedRun(t, third.action.id);
    expect(captured.get(nextRun.id)!.paperclipOpenwa).toMatchObject({ triggerClass: "owner", profile: "full" });
  }, 180_000);

  it("steers late owner activity into the running owner_absent run marked owner_now_active", async () => {
    const scheduledClock = new ManualClock();
    const t = await setup({ scheduledClock });
    await admit(t, mention(MEMBER_PHONE, "warm up the group"));
    adapterMode.hold = true;
    const runs = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(eq(heartbeatRuns.companyId, t.companyId));
    for (const run of runs) release(run.id);
    await until(async () => {
      const active = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.companyId, t.companyId), sql`${heartbeatRuns.status} in ('queued', 'running')`));
      for (const run of active) release(run.id);
      return active.length === 0;
    });
    const ts = Math.floor(scheduledClock.now() / 1000);
    t.gateway.inbound({ chatId: GROUP, author: jid(MEMBER_PHONE), body: "@" + OWNER_PHONE + " are you there?", timestamp: ts, extra: { mentionedIds: [jid(OWNER_PHONE)] } });
    await until(async () => scheduledClock.timers.size > 0);
    scheduledClock.advance(121_000);
    const absentAction = await until(async () => {
      await t.service.processPendingDeliveries();
      const rows = await db.select().from(chatActions).where(and(eq(chatActions.endpointId, t.endpointId), eq(chatActions.kind, "inbound_wakeup")));
      return rows.find((row) => (row.payload.openwa as { event?: string } | undefined)?.event === "owner_absent") ?? null;
    });
    const absentRun = await runningRun(t, absentAction.id);
    expect((await runContext(absentRun.id)).paperclipOpenwa).toMatchObject({ event: "owner_absent", triggerClass: "other" });

    t.gateway.inbound({ chatId: GROUP, author: jid(OWNER_PHONE), body: "I'm here, I will handle it", timestamp: ts + 125 });
    const text = await until(async () => {
      await t.service.processPendingDeliveries();
      return steered.get(absentRun.id)?.[0] ?? null;
    });
    expect(text).toContain("owner_now_active");
    expect(text).toContain("I'm here, I will handle it");
    const [late] = await db.select().from(chatDeliveries).where(and(
      eq(chatDeliveries.endpointId, t.endpointId),
      sql`${chatDeliveries.normalizedEvent} -> 'openwa' ->> 'ownerNowActive' = 'true'`,
    ));
    expect(late).toMatchObject({ triggerClass: "owner", principalRole: "owner" });
    expect((await runContext(absentRun.id)).paperclipOpenwa).toMatchObject({ profile: "read_only" });
  }, 180_000);

  it("steers a late transcript into the active run and falls back to the next wake without steering", async () => {
    const t = await setup();
    const first = await admit(t, { chatId: jid(OWNER_PHONE), body: "voice note follows" });
    const run = await runningRun(t, first.action.id);
    const ready = (attachmentId: string) => ({
      companyId: t.companyId, endpointId: t.endpointId, issueId: first.wake.payload!.issueId as string,
      waMessageId: "wa-" + attachmentId, deliveryId: first.delivery.id, attachmentId,
      transcriptStatus: "done" as const, transcript: "tolong cek invoice " + attachmentId,
    });
    const steeredEvent = await recordOpenwaLateTranscript(db, ready(randomUUID()) as never);
    expect(steeredEvent).not.toBeNull();
    await expect(steerOpenwaLateTranscript(db, steeredEvent!)).resolves.toBe(true);
    expect(steered.get(run.id)![0]).toContain(steeredEvent!.transcript.transcript);
    expect(steered.get(run.id)![0]).toContain("not sent to WhatsApp");

    const fallbackEvent = await recordOpenwaLateTranscript(db, ready(randomUUID()) as never);
    const noTargetRun = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: noTargetRun, companyId: t.companyId, agentId: t.agentId, status: "running", invocationSource: "on_demand",
      triggerDetail: "manual", startedAt: new Date(), contextSnapshot: {},
    });
    await expect(steerOpenwaLateTranscript(db, { ...fallbackEvent!, runId: noTargetRun })).resolves.toBe(false);
    await db.update(heartbeatRuns).set({ status: "cancelled", finishedAt: new Date() }).where(eq(heartbeatRuns.id, noTargetRun));
    const nextWake = await takeOpenwaLateTranscripts(db, {
      companyId: t.companyId, endpointId: t.endpointId, conversationId: fallbackEvent!.conversationId, runId: randomUUID(),
    });
    expect(nextWake.map((item) => item.attachmentId)).toEqual([fallbackEvent!.transcript.attachmentId]);
    expect(t.gateway.sends).toEqual([]);
  }, 120_000);

  it("runs exactly one follow-up owner run for a handoff, also after a restart", async () => {
    const t = await setup();
    const owner = await admit(t, { chatId: jid(OWNER_PHONE), body: "rotate the API keys" });
    const sourceRun = await runningRun(t, owner.action.id);
    await db.update(chatDeliveries).set({ answerState: "handed_off" }).where(eq(chatDeliveries.id, owner.delivery.id));
    await db.insert(chatActions).values({
      companyId: t.companyId, endpointId: t.endpointId, conversationId: owner.action.conversationId,
      kind: OPENWA_HANDOFF_ACTION_KIND, providerActionId: "openwa-handoff:" + sourceRun.id + ":test", status: "received",
      payload: { version: 1, runId: sourceRun.id, issueId: owner.wake.payload!.issueId, chatKey: jid(OWNER_PHONE), triggerIds: [owner.delivery.id], note: "needs the production key vault" },
    });
    await services.splice(services.indexOf(t.service), 1)[0]!.shutdown();
    adapterMode.hold = false;
    release(sourceRun.id);
    await finishedRun(t, owner.action.id);
    const [stillReceived] = await db.select().from(chatActions).where(and(eq(chatActions.endpointId, t.endpointId), eq(chatActions.kind, OPENWA_HANDOFF_ACTION_KIND)));
    expect(stillReceived!.status).toBe("received");

    const beforeRestart = createDb(database.connectionString);
    const staged = await scheduleOpenwaFollowupForRun(beforeRestart, { companyId: t.companyId, runId: sourceRun.id });
    expect(staged).toHaveLength(1);
    const [queued] = await db.select().from(chatActions).where(eq(chatActions.id, staged[0]!));
    expect(queued!.status).toBe("queued");
    expect(await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, staged[0]!))).toHaveLength(0);
    await expect(scheduleOpenwaFollowupForRun(beforeRestart, { companyId: t.companyId, runId: sourceRun.id })).resolves.toEqual([]);

    const restarted = chatChannelService(db, {
      runtime: new ChatSdkRuntime(),
      publicBaseUrl: "https://paperclip.example",
      heartbeat: t.heartbeat as never,
      discordGatewayLeaseTtlMs: 120_000,
      discordGatewayLeaseRenewalIntervalMs: 60_000,
      discordGatewayLeaseWaitMs: 200,
    });
    services.push(restarted);
    t.service = restarted;
    await restarted.processPendingDeliveries();
    const followupRun = await finishedRun(t, staged[0]!);
    expect(captured.get(followupRun.id)!.paperclipOpenwa).toMatchObject({ triggerClass: "owner", profile: "full" });
    const [comment] = await db.execute<{ body: string }>(sql`select body from issue_comments where id = ${(queued!.payload as { commentId: string }).commentId}::uuid`);
    expect(comment!.body).toContain("needs the production key vault");

    await t.service.processPendingDeliveries();
    await scheduleOpenwaFollowupForRun(db, { companyId: t.companyId, runId: sourceRun.id });
    const runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.wakeupRequestId, staged[0]!));
    expect(runs).toHaveLength(1);
    const followups = await db.select().from(chatActions).where(and(eq(chatActions.endpointId, t.endpointId), eq(chatActions.kind, OPENWA_FOLLOWUP_WAKE_ACTION_KIND)));
    expect(followups).toHaveLength(1);
    const [handoff] = await db.select().from(chatActions).where(and(eq(chatActions.endpointId, t.endpointId), eq(chatActions.kind, OPENWA_HANDOFF_ACTION_KIND)));
    expect(handoff!.status).toBe("processed");
  }, 120_000);
});
