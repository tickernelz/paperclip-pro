import { maskOpenwaPhoneNumber } from "@tickernelz/paperclip-pro-shared";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  activityLog,
  agents,
  agentWakeupRequests,
  assets,
  authUsers,
  chatActions,
  chatAuditEntries,
  chatConversations,
  chatDeliveries,
  chatEndpoints,
  chatOutboundMessages,
  chatOwnerApprovalRequests,
  chatOwnerGrants,
  companies,
  companyMemberships,
  companySecretBindings,
  createDb,
  heartbeatRuns,
  issueAttachments,
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
import { heartbeatService, mergeCoalescedContextSnapshot } from "../../services/heartbeat.ts";
import { secretService } from "../../services/secrets.ts";
import { OPENWA_HANDOFF_ACTION_KIND } from "../../services/openwa/tools.ts";
import { openwaNudgeWaiting } from "../../services/openwa/nudges.ts";
import {
  OPENWA_FOLLOWUP_WAKE_ACTION_KIND,
  OPENWA_RUN_RETRY_DELAY_MS,
  OPENWA_RUN_RETRY_WAKE_ACTION_KIND,
  OPENWA_STEERED_OWNER_ACTION_KIND,
  processPendingOpenwaRunRetries,
  scheduleOpenwaFollowupForRun,
  scheduleOpenwaRunRetryForRun,
} from "../../services/openwa/followups.ts";
import { recordOpenwaLateTranscript, takeOpenwaLateTranscripts } from "../../services/openwa/late-transcripts.ts";
import { registerOpenwaCommentSteering, steerOpenwaLateTranscript } from "../../services/openwa/steering.ts";
import { resolveChatRunPresentationAuthorizationReason } from "../../services/chat-run-publications.ts";
import { OPENWA_APPROVAL_WAKE_ACTION_KIND } from "../../services/openwa/approvals.ts";
import { createAdmissionTransactionScope, createWakeAdmissionWriter } from "../../modules/wake-queue/adapters/postgres.ts";
import { issueService } from "../../services/issues.ts";
import type { OpenwaScheduledWakeClock } from "../../services/openwa/scheduled-wakes.ts";
import { createLocalDiskStorageProvider } from "../../storage/local-disk-provider.js";
import { createStorageService } from "../../storage/service.js";
import { FAKE_OPENWA_KEY, FakeOpenwaGateway } from "./fake-gateway.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;
const ADAPTER_TYPE = "openwa_steering_capture";
const SESSION_ID = "31111111-2222-4333-8444-555555555555";
const OWN_PHONE = "628111000777";
const OWNER_PHONE = "628333000777";
const MEMBER_PHONE = "628444000777";
const OTHER_MEMBER_PHONE = "628555000777";
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
  const adapterMode = { steer: true, lateSteer: false, hold: true, failures: 0 };
  const lateSteerTargets = new Map<string, () => void>();
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
      supportsLiveSteering: true,
      execute: async (ctx) => {
        captured.set(ctx.runId, { ...ctx.context });
        let unregister = () => undefined as void;
        const register = () => {
          unregister = registerAdapterSteerTarget(ctx.runId, {
            capabilities: async () => ({ steering: true }),
            snapshot: async () => ({ activeTurnId: "turn:" + ctx.runId }),
            steer: async (input) => {
              steered.set(ctx.runId, [...(steered.get(ctx.runId) ?? []), input.message.text]);
            },
          });
        };
        if (adapterMode.lateSteer) lateSteerTargets.set(ctx.runId, register);
        else if (adapterMode.steer) register();
        try {
          if (adapterMode.hold) await new Promise<void>((resolve) => holds.set(ctx.runId, resolve));
        } finally {
          unregister();
        }
        if (adapterMode.failures > 0) {
          adapterMode.failures -= 1;
          return {
            exitCode: 1,
            signal: null,
            timedOut: false,
            errorMessage: "upstream 400: provider database query failed",
            resultJson: { conversationContinuation: "continue_conversation_v1" },
            label: "Steering capture",
          };
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
    adapterMode.lateSteer = false;
    adapterMode.failures = 0;
    lateSteerTargets.clear();
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

  async function setup(options: { scheduledClock?: OpenwaScheduledWakeClock; nudgeClock?: OpenwaScheduledWakeClock; burstClock?: OpenwaScheduledWakeClock; storage?: boolean } = {}) {
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
      openwaBurstWindowMs: 0,
      ...(options.burstClock ? { openwaBurstWindowMs: undefined, openwaBurstClock: options.burstClock } : {}),
      ...(options.scheduledClock ? { openwaScheduledWakeClock: options.scheduledClock } : {}),
      ...(options.nudgeClock ? { openwaNudgeClock: options.nudgeClock } : {}),
      ...(options.storage ? { storage: createStorageService(createLocalDiskStorageProvider(path.join(scratch, "storage-" + companyId))) } : {}),
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

  it("gives alternating member and owner group mentions their own class runs without steering, and an owner run answers the owner triggers", async () => {
    const t = await setup();
    registerOpenwaCommentSteering(db, async () => ({ deliveredAs: "queued", reason: "test" }))();
    const first = await admit(t, mention(OWNER_PHONE, "start the invoice export"));
    const firstRun = await runningRun(t, first.action.id);

    const memberA = await admit(t, mention(MEMBER_PHONE, "member question one"));
    const ownerB = await admit(t, mention(OWNER_PHONE, "owner request two"));
    const memberC = await admit(t, mention(MEMBER_PHONE, "member question three"));
    const ownerD = await admit(t, mention(OWNER_PHONE, "owner request four"));
    const memberE = await admit(t, mention(MEMBER_PHONE, "member question five"));
    expect([memberA, memberC, memberE].map((entry) => entry.delivery.triggerClass)).toEqual(["other", "other", "other"]);
    expect([ownerB, ownerD].map((entry) => entry.delivery.triggerClass)).toEqual(["owner", "owner"]);
    expect(steered.size).toBe(0);

    const actionClass = async (wakeId: string) => {
      const [row] = await db.select({ payload: chatActions.payload }).from(chatActions).where(eq(chatActions.id, wakeId));
      return ((row?.payload as { openwa?: { triggerClass?: string } } | undefined)?.openwa?.triggerClass) ?? null;
    };
    const carrier = async (wakeId: string) => {
      const row = await wakeRow(wakeId);
      if (row.status !== "coalesced") return row.id;
      return String((row.payload as Record<string, unknown>).coalescedIntoWakeupRequestId);
    };
    const queuedFor = async (entries: Array<{ action: { id: string } }>) => Promise.all(entries.map((entry) => carrier(entry.action.id)));
    const memberCarriers = await queuedFor([memberA, memberC, memberE]);
    const ownerCarriers = await queuedFor([ownerB, ownerD]);
    expect(new Set(memberCarriers).size).toBe(1);
    expect(new Set(ownerCarriers).size).toBe(1);
    const memberWake = memberCarriers[0]!;
    const ownerWake = ownerCarriers[0]!;
    expect(memberWake).not.toBe(ownerWake);
    expect([await actionClass(memberWake), await actionClass(ownerWake)]).toEqual(["other", "owner"]);
    expect([(await wakeRow(memberWake)).status, (await wakeRow(ownerWake)).status]).toEqual(["deferred_issue_execution", "deferred_issue_execution"]);

    release(firstRun.id);
    const memberRun = await runningRun(t, memberWake);
    expect((await runContext(memberRun.id)).paperclipOpenwa).toMatchObject({ triggerClass: "other", profile: "read_only" });

    const ownerF = await admit(t, mention(OWNER_PHONE, "owner request six"));
    const memberG = await admit(t, mention(MEMBER_PHONE, "member question seven"));
    expect(await carrier(ownerF.action.id)).toBe(ownerWake);
    const memberLaterWake = await carrier(memberG.action.id);
    expect(memberLaterWake).not.toBe(ownerWake);
    expect(memberLaterWake).not.toBe(memberWake);
    expect(await actionClass(memberLaterWake)).toBe("other");

    release(memberRun.id);
    const ownerRun = await runningRun(t, ownerWake);
    expect((await runContext(ownerRun.id)).paperclipOpenwa).toMatchObject({ triggerClass: "owner", profile: "full" });
    const issueId = String(ownerB.wake.payload!.issueId);
    const authorizationReason = await resolveChatRunPresentationAuthorizationReason(db, { companyId: t.companyId, issueId, runId: ownerRun.id });
    await issueService(db).addComment(issueId, "Owner work is done.", { agentId: t.agentId, runId: ownerRun.id }, { authorizationReason });
    adapterMode.hold = false;
    release(ownerRun.id);
    await finishedRun(t, ownerWake);
    const ownerIds = [first, ownerB, ownerD, ownerF].map((entry) => entry.delivery.id);
    const memberIds = [memberA, memberC, memberE, memberG].map((entry) => entry.delivery.id);
    const answerStates = async (ids: string[]) => {
      const rows = await db.select({ id: chatDeliveries.id, answerState: chatDeliveries.answerState }).from(chatDeliveries).where(eq(chatDeliveries.endpointId, t.endpointId));
      return ids.map((id) => rows.find((row) => row.id === id)?.answerState ?? null);
    };
    await until(async () => {
      await t.service.processPendingPublications(25);
      return (await answerStates(ownerIds)).every((state) => state === "answered");
    });
    expect(t.gateway.sends).toEqual([expect.objectContaining({ chatId: GROUP, quotedMessageId: first.row.waMessageId, text: expect.stringContaining("Owner work is done.") })]);
    expect(await answerStates(memberIds)).toEqual(["pending", "pending", "pending", "pending"]);

    const memberLaterRun = await finishedRun(t, memberLaterWake);
    expect(captured.get(memberLaterRun.id)!.paperclipOpenwa).toMatchObject({ triggerClass: "other", profile: "read_only" });
    const runs = await db.select({ wakeupRequestId: heartbeatRuns.wakeupRequestId, contextSnapshot: heartbeatRuns.contextSnapshot })
      .from(heartbeatRuns).where(eq(heartbeatRuns.companyId, t.companyId)).orderBy(asc(heartbeatRuns.createdAt));
    expect(runs.map((run) => [run.wakeupRequestId, (run.contextSnapshot as { paperclipOpenwa?: { triggerClass?: string } }).paperclipOpenwa?.triggerClass])).toEqual([
      [first.action.id, "owner"],
      [memberWake, "other"],
      [ownerWake, "owner"],
      [memberLaterWake, "other"],
    ]);
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

  it("steers an owner burst message into the starting run once its adapter registers a steer target, exactly once", async () => {
    adapterMode.lateSteer = true;
    const t = await setup({ nudgeClock: new ManualClock() });
    const first = await admit(t, { chatId: jid(OWNER_PHONE), body: "look at this screenshot" });
    const ownerRun = await runningRun(t, first.action.id);
    const second = await admit(t, { chatId: jid(OWNER_PHONE), body: "and this second screenshot too" });
    expect((await wakeRow(second.action.id)).status).toBe("deferred_issue_execution");
    expect(steered.get(ownerRun.id)).toBeUndefined();

    lateSteerTargets.get(ownerRun.id)!();
    const text = await until(async () => steered.get(ownerRun.id)?.find((entry) => entry.includes("and this second screenshot too")) ?? null);
    expect(text).toContain("WhatsApp message from an endpoint owner");
    expect((await wakeRow(second.action.id)).status).toBe("cancelled");
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(steered.get(ownerRun.id)!.filter((entry) => entry.includes("and this second screenshot too"))).toHaveLength(1);
    const steeredActivity = await db.select().from(activityLog)
      .where(and(eq(activityLog.companyId, t.companyId), eq(activityLog.action, "issue.queued_comment_steered")));
    expect(steeredActivity).toHaveLength(1);
    expect(steeredActivity[0]).toMatchObject({ actorType: "system", actorId: "openwa:steer", details: expect.objectContaining({ targetRunId: ownerRun.id }) });
    expect(((await runContext(ownerRun.id)).paperclipOpenwa as { deliveryIds: string[] }).deliveryIds).toContain(second.delivery.id);
  }, 180_000);

  async function steerOwnerBurst(count: number, runSteerable: "late" | "already") {
    adapterMode.lateSteer = runSteerable === "late";
    const t = await setup({ nudgeClock: new ManualClock() });
    const bodies = Array.from({ length: count }, (_, index) => `burst part ${index + 1} of ${count}`);
    const admitted: Array<Awaited<ReturnType<typeof admit>>> = [];
    admitted.push(await admit(t, { chatId: jid(OWNER_PHONE), body: bodies[0]! }));
    if (runSteerable === "already") await runningRun(t, admitted[0]!.action.id);
    for (const body of bodies.slice(1)) admitted.push(await admit(t, { chatId: jid(OWNER_PHONE), body }));
    const ownerRun = await runningRun(t, admitted[0]!.action.id);
    if (runSteerable === "late") lateSteerTargets.get(ownerRun.id)!();

    const later = admitted.slice(1);
    const entries = await until(async () => {
      const texts = steered.get(ownerRun.id) ?? [];
      return later.every((entry) => texts.some((text) => text.includes(entry.row.body))) ? texts : null;
    });
    expect(entries).toHaveLength(later.length);
    later.forEach((entry, index) => {
      expect(entries[index]).toContain(entry.row.body);
      expect(entries[index]).toContain(entry.row.waMessageId);
      for (const other of admitted.filter((candidate) => candidate !== entry)) expect(entries[index]).not.toContain(other.row.waMessageId);
    });
    await until(async () => {
      const deliveryIds = ((await runContext(ownerRun.id)).paperclipOpenwa as { deliveryIds: string[] }).deliveryIds;
      return admitted.every((entry) => deliveryIds.includes(entry.delivery.id)) ? deliveryIds : null;
    });

    adapterMode.hold = false;
    release(ownerRun.id);
    await finishedRun(t, admitted[0]!.action.id);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const runs = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(eq(heartbeatRuns.agentId, t.agentId));
    expect(runs.map((run) => run.id)).toEqual([ownerRun.id]);
    const pendingWakes = await db.select({ id: agentWakeupRequests.id, status: agentWakeupRequests.status }).from(agentWakeupRequests)
      .where(and(eq(agentWakeupRequests.agentId, t.agentId), sql`${agentWakeupRequests.status} in ('queued', 'deferred_issue_execution', 'claimed')`));
    expect(pendingWakes).toEqual([]);
    for (const entry of later) expect(["cancelled", "coalesced"]).toContain((await wakeRow(entry.action.id)).status);
    const steeredActivity = await db.select().from(activityLog)
      .where(and(eq(activityLog.companyId, t.companyId), eq(activityLog.action, "issue.queued_comment_steered")));
    expect(steeredActivity).toHaveLength(later.length);
  }

  it("steers both later messages of a three-message owner burst into the run that starts after the first, in order, with one run", async () => {
    await steerOwnerBurst(3, "late");
  }, 180_000);

  it("steers both later messages of a three-message owner burst into an already steerable run, in order, with one run", async () => {
    await steerOwnerBurst(3, "already");
  }, 180_000);

  it("steers every later message of a four-message owner burst into the starting run, in order, with one run", async () => {
    await steerOwnerBurst(4, "late");
  }, 180_000);

  it("answers a three-message owner burst in one run carrying all three deliveries and steers a message sent after the run started", async () => {
    const burstClock = new ManualClock();
    burstClock.time = Date.now() + 3_600_000;
    const t = await setup({ nudgeClock: new ManualClock(), burstClock });
    const sent = ["first part", "second part", "third part"].map((body, index) => {
      if (index) burstClock.advance(300);
      return t.gateway.inbound({ chatId: jid(OWNER_PHONE), body });
    });
    const actions = await until(async () => {
      await t.service.processPendingDeliveries();
      const rows = await db.select().from(chatActions).where(and(eq(chatActions.companyId, t.companyId), eq(chatActions.kind, "inbound_wakeup"))).orderBy(asc(chatActions.createdAt));
      const codes = rows.map((row) => (row.result as { code?: string } | null)?.code);
      return rows.length === 3 && codes[0] === "openwa_burst_held" && codes.slice(1).every((code) => code === "openwa_burst_folded") ? rows : null;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, t.agentId))).toEqual([]);
    burstClock.advance(3_000);
    const ownerRun = await runningRun(t, actions[0]!.id);
    const deliveries = await db.select().from(chatDeliveries).where(eq(chatDeliveries.endpointId, t.endpointId)).orderBy(asc(chatDeliveries.createdAt));
    expect(deliveries.map((row) => (row.normalizedEvent as { openwa: { waMessageId: string } }).openwa.waMessageId)).toEqual(sent.map((row) => row.waMessageId));
    expect((captured.get(ownerRun.id)!.paperclipOpenwa as { deliveryIds: string[] }).deliveryIds).toEqual(deliveries.map((row) => row.id));

    const late = await admit(t, { chatId: jid(OWNER_PHONE), body: "one more thing" });
    const text = await until(async () => steered.get(ownerRun.id)?.find((entry) => entry.includes("one more thing")) ?? null);
    expect(text).toContain(late.row.waMessageId);
    adapterMode.hold = false;
    release(ownerRun.id);
    await finishedRun(t, actions[0]!.id);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect((await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(eq(heartbeatRuns.agentId, t.agentId))).map((run) => run.id)).toEqual([ownerRun.id]);
  }, 180_000);

  it("keeps an owner burst message queued for the next run when the starting run never becomes steerable", async () => {
    adapterMode.lateSteer = true;
    const t = await setup({ nudgeClock: new ManualClock() });
    const first = await admit(t, { chatId: jid(OWNER_PHONE), body: "look at this screenshot" });
    const ownerRun = await runningRun(t, first.action.id);
    const second = await admit(t, { chatId: jid(OWNER_PHONE), body: "and this second screenshot too" });
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(steered.get(ownerRun.id)).toBeUndefined();
    expect((await wakeRow(second.action.id)).status).toBe("deferred_issue_execution");

    adapterMode.hold = false;
    release(ownerRun.id);
    const nextRun = await finishedRun(t, second.action.id);
    expect(nextRun.id).not.toBe(ownerRun.id);
    expect((captured.get(nextRun.id)!.paperclipOpenwa as { deliveryIds: string[] }).deliveryIds).toContain(second.delivery.id);
    expect(steered.get(ownerRun.id)).toBeUndefined();
    const steeredActivity = await db.select().from(activityLog)
      .where(and(eq(activityLog.companyId, t.companyId), eq(activityLog.action, "issue.queued_comment_steered")));
    expect(steeredActivity).toEqual([]);
  }, 180_000);

  it("skips the progress nudge when a later send to the chat already acknowledged the run's triggers", async () => {
    const nudgeClock = new ManualClock();
    const t = await setup({ nudgeClock });
    const first = await admit(t, { chatId: jid(OWNER_PHONE), body: "fix the invoice export" });
    const ownerRun = await runningRun(t, first.action.id);
    const chatKey = ((await runContext(ownerRun.id)).paperclipOpenwa as { chatKey: string }).chatKey;
    const waiting = openwaNudgeWaiting(db);
    expect(await waiting(ownerRun.id, chatKey)).toBe(true);
    await db.insert(chatOutboundMessages).values({
      companyId: t.companyId, endpointId: t.endpointId, chatKey, source: "tool", runId: null,
      state: "sent", bodyHash: "ack", clientNonce: randomUUID(), sentAt: new Date(Date.now() + 1_000),
    });
    expect(await waiting(ownerRun.id, chatKey)).toBe(false);
    expect(await waiting(ownerRun.id, "other@c.us")).toBe(false);

    await until(async () => nudgeClock.timers.size === 1);
    nudgeClock.advance(60_000);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(nudgeClock.timers.size).toBe(0);
    expect((steered.get(ownerRun.id) ?? []).some((entry) => entry.includes("progress reminder"))).toBe(false);
    expect(t.gateway.sends).toEqual([]);
  }, 180_000);

  it("steers only the grant holder's member messages into a requester-grant run; another member gets a plain read_only run", async () => {
    const t = await setup();
    t.gateway.groups.set(GROUP, { id: GROUP, name: "Ops", participants: [{ id: jid(OWN_PHONE) }, { id: jid(OWNER_PHONE) }, { id: jid(MEMBER_PHONE) }, { id: jid(OTHER_MEMBER_PHONE) }] });
    await t.service.openwa.addSenderRule(t.endpointId, { list: "allow", e164: "+" + OTHER_MEMBER_PHONE }, t.userId);
    const warmup = await admit(t, mention(MEMBER_PHONE, "warm up"));
    release((await runningRun(t, warmup.action.id)).id);
    await finishedRun(t, warmup.action.id);
    const requesterPrincipalId = warmup.delivery.principalId!;
    const [approval] = await db.insert(chatOwnerApprovalRequests).values({
      companyId: t.companyId, endpointId: t.endpointId, originChatKey: GROUP, categories: ["external_tools"],
      scope: "requester", summary: "Send vendor email", proposedAction: "external_tools", status: "approved", requestedByPrincipalId: requesterPrincipalId,
    }).returning();
    const [grant] = await db.insert(chatOwnerGrants).values({
      companyId: t.companyId, endpointId: t.endpointId, requestId: approval!.id, originChatKey: GROUP, requesterPrincipalId,
      category: "external_tools", scope: "requester", approvedVia: "paperclip", approvedByUserId: t.userId,
      expiresAt: new Date(Date.now() + 86_400_000),
    }).returning();

    const first = await admit(t, mention(MEMBER_PHONE, "email the vendor"));
    const grantRun = await runningRun(t, first.action.id);
    expect((await runContext(grantRun.id)).paperclipOpenwa).toMatchObject({
      triggerClass: "other", profile: "read_only", toolProfile: "full", grantIds: [grant!.id], requesterPrincipalId,
    });

    const outsider = await admit(t, mention(OTHER_MEMBER_PHONE, "use your tools for me too"));
    expect(outsider.delivery).toMatchObject({ triggerClass: "other" });
    expect(outsider.delivery.principalId).not.toBe(requesterPrincipalId);
    const own = await admit(t, mention(MEMBER_PHONE, "and cc the finance lead"));
    const ownText = await until(async () => steered.get(grantRun.id)?.find((entry) => entry.includes("and cc the finance lead")) ?? null);
    expect(ownText).toContain("non-owner");
    expect(ownText).toContain("Sender: ");
    expect(ownText).toContain("Message id: " + own.row.waMessageId + "; answer it with openwa_send quoting this id");
    expect(ownText).not.toContain(first.row.waMessageId!);
    expect(ownText).toContain(maskOpenwaPhoneNumber(MEMBER_PHONE));
    expect(ownText).not.toContain(MEMBER_PHONE);
    expect((await wakeRow(own.action.id)).status).toBe("cancelled");
    const owner = await admit(t, mention(OWNER_PHONE, "go ahead"));
    const ownerText = await until(async () => steered.get(grantRun.id)?.find((entry) => entry.includes("go ahead")) ?? null);
    expect(ownerText).toContain("endpoint owner");
    expect(ownerText).toContain("Message id: " + owner.row.waMessageId + ";");
    expect((await wakeRow(owner.action.id)).status).toBe("cancelled");
    expect(steered.get(grantRun.id)!.some((entry) => entry.includes("use your tools for me too"))).toBe(false);
    expect((await wakeRow(outsider.action.id)).status).toBe("deferred_issue_execution");
    expect((await runContext(grantRun.id)).paperclipOpenwa).toMatchObject({ grantIds: [grant!.id], requesterPrincipalId });

    adapterMode.hold = false;
    release(grantRun.id);
    const outsiderRun = await finishedRun(t, outsider.action.id);
    expect(outsiderRun.id).not.toBe(grantRun.id);
    const outsiderContext = captured.get(outsiderRun.id)!;
    expect(outsiderContext.paperclipOpenwa).toMatchObject({ triggerClass: "other", profile: "read_only", toolProfile: "read_only", grantIds: [], requesterPrincipalId: outsider.delivery.principalId });
    expect(outsiderContext.paperclipToolProfile).toBe("read_only");
    expect((outsiderContext.paperclipOpenwa as { deliveryIds: string[] }).deliveryIds).toEqual([outsider.delivery.id]);
  }, 180_000);

  it("steers every attachment type into the running member run as wake-format items, stored as issue attachments or with the get_media hint", async () => {
    const t = await setup({ storage: true });
    t.gateway.groups.set(GROUP, { id: GROUP, name: "Ops", participants: [{ id: jid(OWN_PHONE) }, { id: jid(OWNER_PHONE) }, { id: jid(MEMBER_PHONE) }, { id: jid(OTHER_MEMBER_PHONE) }] });
    await t.service.openwa.addSenderRule(t.endpointId, { list: "allow", e164: "+" + OTHER_MEMBER_PHONE }, t.userId);
    const first = await admit(t, mention(MEMBER_PHONE, "cek laporan ini"));
    const memberRun = await runningRun(t, first.action.id);
    expect((await runContext(memberRun.id)).paperclipOpenwa).toMatchObject({ triggerClass: "other", profile: "read_only" });

    const attached = async (text: string, extra: Record<string, unknown>, file?: { body: Buffer; contentType: string; filename?: string }, sender = MEMBER_PHONE) => {
      const waMessageId = t.gateway.nextWaMessageId(false, GROUP);
      if (file) t.gateway.setMedia(GROUP, waMessageId, file);
      const admitted = await admit(t, { ...mention(sender, text), waMessageId, extra: { mentionedIds: [jid(OWN_PHONE)], ...extra } });
      const frame = await until(async () => steered.get(memberRun.id)?.find((entry) => entry.includes(text)) ?? null);
      expect((await wakeRow(admitted.action.id)).status).toBe("cancelled");
      expect(frame).toContain("Read every file before you answer");
      expect(frame).toContain("call openwa_get_media with its messageId");
      const [entry, ...rest] = JSON.parse(frame.slice(frame.lastIndexOf("\n") + 1)) as Array<Record<string, unknown> & { messageId: string; media: Array<Record<string, unknown>> }>;
      expect(rest).toEqual([]);
      expect(entry!.messageId).toBe(waMessageId);
      return { waMessageId, entry: entry! };
    };
    const attachmentFor = async (filename: string) => {
      const [row] = await db.select({ id: issueAttachments.id, contentType: assets.contentType, byteSize: assets.byteSize })
        .from(issueAttachments).innerJoin(assets, eq(assets.id, issueAttachments.assetId))
        .where(and(eq(issueAttachments.companyId, t.companyId), eq(assets.originalFilename, filename)));
      return row!;
    };

    const pdf = Buffer.from("%PDF-1.4\nsteered report\n%%EOF\n");
    const pdfName = "Laporan Kebocoran Akses User.pdf";
    const pdfMessage = await attached("ini pdf nya", { type: "document", media: { mimetype: "application/pdf", filename: pdfName, sizeBytes: pdf.length, omitted: true } }, { body: pdf, contentType: "application/pdf", filename: pdfName });
    const pdfRow = await attachmentFor(pdfName);
    expect(pdfRow).toMatchObject({ contentType: "application/pdf", byteSize: pdf.length });
    expect(pdfMessage.entry.media).toEqual([{ kind: "document", attachmentId: pdfRow.id, filename: pdfName, mime: "application/pdf", size: pdf.length, localPath: expect.stringMatching(/\.pdf$/) }]);

    const bat = Buffer.from("@echo off\r\nshutdown /s\r\n");
    const batMessage = await attached("ini script nya", { type: "document", media: { filename: "run.bat", sizeBytes: bat.length, omitted: true } }, { body: bat, contentType: "application/octet-stream", filename: "run.bat" });
    const batRow = await attachmentFor("run.bat");
    expect(batRow.byteSize).toBe(bat.length);
    expect(batMessage.entry.media).toEqual([{ kind: "document", attachmentId: batRow.id, filename: "run.bat", mime: batRow.contentType, size: bat.length, localPath: expect.stringMatching(/\.bat$/) }]);

    const voice = Buffer.from("OggS steered voice note");
    const voiceMessage = await attached("ini voice nya", { type: "ptt", media: { mimetype: "audio/ogg; codecs=opus", sizeBytes: voice.length, omitted: true } }, { body: voice, contentType: "audio/ogg" });
    expect(voiceMessage.entry.media).toEqual([{ kind: "voice", attachmentId: expect.any(String), filename: expect.stringMatching(/^voice-[0-9a-f]{10}\./), mime: "audio/ogg", size: voice.length, localPath: expect.any(String) }]);

    const image = Buffer.from("\x89PNG\r\n\x1a\nsteered image");
    const imageMessage = await attached("ini fotonya", { type: "image", media: { mimetype: "image/png", sizeBytes: image.length, omitted: true } }, { body: image, contentType: "image/png" });
    expect(imageMessage.entry.media).toEqual([expect.objectContaining({ kind: "image", attachmentId: expect.any(String), mime: "image/png", size: image.length, localPath: expect.any(String) })]);

    const lost = await attached("ini file kedua", { type: "document", media: { filename: "kedua.xyz", sizeBytes: 64, omitted: true } }, undefined, OTHER_MEMBER_PHONE);
    expect(lost.entry.media).toEqual([{ kind: "document", unavailable: "unavailable", filename: "kedua.xyz", mime: "application/octet-stream", size: 64 }]);

    const huge = await attached("ini zip besar", { type: "document", media: { mimetype: "application/zip", filename: "dump.zip", sizeBytes: 1024 * 1024 * 1024, omitted: true } }, undefined, OTHER_MEMBER_PHONE);
    expect(huge.entry.media).toEqual([{ kind: "document", unavailable: "too_large", limitBytes: expect.any(Number), filename: "dump.zip", mime: "application/zip", size: 1024 * 1024 * 1024 }]);
    expect(t.gateway.mediaRequests(huge.waMessageId)).toBe(0);

    const vcard = ["BEGIN:VCARD", "VERSION:3.0", "FN:Ada Lovelace", "TEL;TYPE=CELL:+62 812-3456-789", "END:VCARD"].join("\n");
    const contact = await attached("ini kontaknya", { type: "vcard", vCards: [vcard] }, undefined, OTHER_MEMBER_PHONE);
    expect(contact.entry).toEqual({ messageId: contact.waMessageId, media: [], contact: { name: "Ada Lovelace", phones: [maskOpenwaPhoneNumber("628123456789")] } });

    const place = await attached("ini lokasinya", { type: "location", location: { latitude: -6.2088, longitude: 106.8456, description: "Monas" } }, undefined, OTHER_MEMBER_PHONE);
    expect(place.entry).toEqual({ messageId: place.waMessageId, media: [], location: { lat: -6.2088, lon: 106.8456, name: "Monas" } });

    expect(steered.get(memberRun.id)!.filter((entry) => entry.includes("Read every file before you answer"))).toHaveLength(8);
  }, 240_000);

  async function grantAfterMerge(mode: "deferred" | "queued" | "solo") {
    const t = await setup();
    adapterMode.steer = false;
    t.gateway.groups.set(GROUP, { id: GROUP, name: "Ops", participants: [{ id: jid(OWN_PHONE) }, { id: jid(OWNER_PHONE) }, { id: jid(MEMBER_PHONE) }, { id: jid(OTHER_MEMBER_PHONE) }] });
    await t.service.openwa.addSenderRule(t.endpointId, { list: "allow", e164: "+" + OTHER_MEMBER_PHONE }, t.userId);
    const first = await admit(t, mention(MEMBER_PHONE, "please email the vendor"));
    const r1 = await runningRun(t, first.action.id);
    const requesterPrincipalId = first.delivery.principalId!;
    const [approval] = await db.insert(chatOwnerApprovalRequests).values({
      companyId: t.companyId, endpointId: t.endpointId, originChatKey: GROUP, categories: ["external_tools"],
      scope: "requester", summary: "Send vendor email", proposedAction: "external_tools", status: "pending", requestedByPrincipalId: requesterPrincipalId,
    }).returning();
    const followup = await admit(t, mention(MEMBER_PHONE, "the vendor is acme"));
    expect((await wakeRow(followup.action.id)).status).toBe("deferred_issue_execution");
    let blockerId: string | null = null;
    let queuedRunId: string | null = null;
    if (mode === "queued") {
      blockerId = randomUUID();
      await db.insert(heartbeatRuns).values({
        id: blockerId, companyId: t.companyId, agentId: t.agentId, status: "running", invocationSource: "on_demand",
        triggerDetail: "manual", startedAt: new Date(), contextSnapshot: {},
      });
      release(r1.id);
      queuedRunId = await until(async () => {
        const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, t.companyId), eq(heartbeatRuns.wakeupRequestId, followup.action.id)));
        return run?.status === "queued" ? run.id : null;
      });
    }
    let outsiderDeliveryId: string | null = null;
    if (mode !== "solo") {
      const outsider = await admit(t, mention(OTHER_MEMBER_PHONE, "use your tools for me too"));
      outsiderDeliveryId = outsider.delivery.id;
      expect(outsider.delivery.principalId).not.toBe(requesterPrincipalId);
      const outsiderWake = await wakeRow(outsider.action.id);
      expect(outsiderWake.status).toBe("deferred_issue_execution");
      expect(outsiderWake.requestedByActorId).toBe(outsider.delivery.principalId);
      const { _paperclipWakeContext: outsiderContext, ...outsiderPayload } = outsiderWake.payload as Record<string, unknown>;
      const incoming = {
        agentId: t.agentId, source: outsiderWake.source, triggerDetail: outsiderWake.triggerDetail,
        requestedByActorType: outsiderWake.requestedByActorType, requestedByActorId: outsiderWake.requestedByActorId, idempotencyKey: outsiderWake.idempotencyKey,
      };
      const writer = createWakeAdmissionWriter();
      await db.transaction(async (tx) => {
        await tx.delete(agentWakeupRequests).where(eq(agentWakeupRequests.id, outsiderWake.id));
        const scope = createAdmissionTransactionScope(t.companyId, tx as unknown as Db);
        if (mode === "deferred") {
          const deferred = await wakeRow(followup.action.id);
          const deferredPayload = deferred.payload as Record<string, unknown>;
          await writer.mergeIntoExistingDeferredWake(scope, {
            companyId: t.companyId,
            existingDeferredWakeId: deferred.id,
            mergedPayload: {
              ...deferredPayload, ...outsiderPayload,
              _paperclipWakeContext: mergeCoalescedContextSnapshot(deferredPayload._paperclipWakeContext, outsiderContext as Record<string, unknown>, { preserveExistingInteractionContinuation: true }),
            },
            nextCoalescedCount: (deferred.coalescedCount ?? 0) + 1,
            coalescedReceipt: {
              id: outsiderWake.id, requestedAt: outsiderWake.requestedAt, ...incoming, reason: outsiderWake.reason,
              payload: { ...outsiderPayload, coalescedIntoWakeupRequestId: deferred.id }, runId: null,
            },
          });
        } else {
          await writer.coalesceIntoActiveExecutionRun(scope, {
            companyId: t.companyId,
            activeExecutionRunId: queuedRunId!,
            mergedContextSnapshot: mergeCoalescedContextSnapshot(await runContext(queuedRunId!), outsiderContext as Record<string, unknown>, { preserveExistingInteractionContinuation: true }),
            durableReceipt: { id: outsiderWake.id, requestedAt: outsiderWake.requestedAt },
            ...incoming,
            payload: outsiderPayload,
          });
        }
      });
      expect(await wakeRow(outsiderWake.id)).toMatchObject({ status: "coalesced", runId: mode === "queued" ? queuedRunId : null });
    }
    const resolved = await t.service.openwaApprovals.resolve(t.endpointId, approval!.id, { decision: "approve", userId: t.userId });
    expect(resolved.status).toBe("approved");
    const [grant] = await db.select().from(chatOwnerGrants).where(eq(chatOwnerGrants.requestId, approval!.id));
    expect(grant).toMatchObject({ scope: "requester", category: "external_tools", status: "live", requesterPrincipalId });
    const approvalWake = await until(async () => {
      const [row] = await db.select().from(chatActions).where(and(eq(chatActions.endpointId, t.endpointId), eq(chatActions.kind, OPENWA_APPROVAL_WAKE_ACTION_KIND)));
      return row ? await wakeRow(row.id) : null;
    });
    expect(approvalWake.status).toBe("deferred_issue_execution");
    if (mode === "queued") {
      await db.update(heartbeatRuns).set({ status: "succeeded", finishedAt: new Date() }).where(eq(heartbeatRuns.id, blockerId!));
      await t.heartbeat.resumeQueuedRuns();
    } else {
      release(r1.id);
    }
    const promoted = await runningRun(t, followup.action.id);
    if (queuedRunId) expect(promoted.id).toBe(queuedRunId);
    const promotedContext = await runContext(promoted.id);
    return { t, promoted, promotedContext, grant: grant!, requesterPrincipalId, outsiderDeliveryId, approvalWakeId: approvalWake.id };
  }

  it("gives a deferred wake that another member merged into no requester grant approved before it started (D36)", async () => {
    const { t, promoted, promotedContext, grant, requesterPrincipalId, outsiderDeliveryId, approvalWakeId } = await grantAfterMerge("deferred");
    expect((promotedContext.openwa as { deliveryIds: string[] }).deliveryIds).toContain(outsiderDeliveryId);
    expect(promotedContext.paperclipOpenwa).toMatchObject({ triggerClass: "other", profile: "read_only", toolProfile: "read_only", grantIds: [], requesterPrincipalId: null });
    expect((promotedContext.paperclipOpenwa as { grantIds: string[] }).grantIds).not.toContain(grant.id);
    expect(promotedContext.paperclipToolProfile).toBe("read_only");
    adapterMode.hold = false;
    release(promoted.id);
    const grantRun = await finishedRun(t, approvalWakeId);
    expect(captured.get(grantRun.id)!.paperclipOpenwa).toMatchObject({ triggerClass: "grant", event: "approval_resolved", grantIds: [grant.id], requesterPrincipalId, toolProfile: "full" });
  }, 180_000);

  it("gives a queued run that another member coalesced into no requester grant approved before it started (D36)", async () => {
    const { promotedContext, grant, outsiderDeliveryId } = await grantAfterMerge("queued");
    expect((promotedContext.openwa as { deliveryIds: string[] }).deliveryIds).toContain(outsiderDeliveryId);
    expect(promotedContext.paperclipOpenwa).toMatchObject({ triggerClass: "other", profile: "read_only", toolProfile: "read_only", grantIds: [], requesterPrincipalId: null });
    expect((promotedContext.paperclipOpenwa as { grantIds: string[] }).grantIds).not.toContain(grant.id);
    expect(promotedContext.paperclipToolProfile).toBe("read_only");
  }, 180_000);

  it("gives the requester's own deferred wake its requester grant approved before it started", async () => {
    const { promotedContext, grant, requesterPrincipalId } = await grantAfterMerge("solo");
    expect(promotedContext.paperclipOpenwa).toMatchObject({ triggerClass: "other", profile: "read_only", toolProfile: "full", grantIds: [grant.id], requesterPrincipalId });
    expect(promotedContext.paperclipToolProfile).toBe("full");
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
      openwaBurstWindowMs: 0,
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
  it("retries a failed run's still-pending triggers once after a delay, then audits a second failure without another retry", async () => {
    const t = await setup();
    adapterMode.hold = false;
    adapterMode.failures = 2;
    const owner = await admit(t, { chatId: jid(OWNER_PHONE), body: "summarise today's invoices" });
    const failed = await finishedRun(t, owner.action.id);
    expect(failed.status).toBe("failed");
    const retryActions = () =>
      db.select().from(chatActions).where(and(eq(chatActions.endpointId, t.endpointId), eq(chatActions.kind, OPENWA_RUN_RETRY_WAKE_ACTION_KIND)));
    const [retry] = await until(async () => {
      const rows = await retryActions();
      return rows.length ? rows : null;
    });
    expect(retry!).toMatchObject({ status: "queued", payload: { sourceRunId: failed.id, openwa: { triggerClass: "owner", deliveryIds: [owner.delivery.id] } } });
    const notBefore = Date.parse(String(retry!.payload.notBefore));
    expect(notBefore - retry!.createdAt.getTime()).toBeGreaterThanOrEqual(OPENWA_RUN_RETRY_DELAY_MS - 1_000);
    await expect(scheduleOpenwaRunRetryForRun(db, { companyId: t.companyId, runId: failed.id })).resolves.toBeNull();
    expect(await processPendingOpenwaRunRetries(db, 25, new Date(notBefore - 1_000))).toBe(0);
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.wakeupRequestId, retry!.id))).toHaveLength(0);
    expect(await processPendingOpenwaRunRetries(db, 25, new Date(notBefore + 1_000))).toBe(1);
    const retried = await finishedRun(t, retry!.id);
    expect(retried.status).toBe("failed");
    expect(captured.get(retried.id)!.paperclipOpenwa).toMatchObject({ triggerClass: "owner", deliveryIds: [owner.delivery.id] });
    const audit = await until(async () => {
      const rows = await db.select().from(chatAuditEntries).where(and(eq(chatAuditEntries.endpointId, t.endpointId), eq(chatAuditEntries.kind, "run_failed")));
      return rows.length ? rows : null;
    });
    await expect(scheduleOpenwaRunRetryForRun(db, { companyId: t.companyId, runId: retried.id })).resolves.toBeNull();
    await expect(scheduleOpenwaRunRetryForRun(db, { companyId: t.companyId, runId: failed.id })).resolves.toBeNull();
    expect(await processPendingOpenwaRunRetries(db, 25, new Date(notBefore + 600_000))).toBe(0);
    expect(await retryActions()).toHaveLength(1);
    const audits = await db.select().from(chatAuditEntries).where(and(eq(chatAuditEntries.endpointId, t.endpointId), eq(chatAuditEntries.kind, "run_failed")));
    expect(audits).toHaveLength(1);
    expect(audit[0]).toMatchObject({ runId: retried.id, actorKind: "system", metadata: { reason: "retry_failed", firstFailedRunId: failed.id, triggerIds: [owner.delivery.id] } });
    const [delivery] = await db.select({ answerState: chatDeliveries.answerState }).from(chatDeliveries).where(eq(chatDeliveries.id, owner.delivery.id));
    expect(delivery!.answerState).toBe("pending");
  }, 120_000);

  it("schedules no run retry when the failed run's triggers were already answered", async () => {
    const t = await setup();
    adapterMode.failures = 1;
    const owner = await admit(t, { chatId: jid(OWNER_PHONE), body: "thanks" });
    const running = await runningRun(t, owner.action.id);
    await db.update(chatDeliveries).set({ answerState: "answered" }).where(eq(chatDeliveries.id, owner.delivery.id));
    release(running.id);
    const failed = await finishedRun(t, owner.action.id);
    expect(failed.status).toBe("failed");
    await expect(scheduleOpenwaRunRetryForRun(db, { companyId: t.companyId, runId: failed.id })).resolves.toBeNull();
    expect(await db.select().from(chatActions).where(and(eq(chatActions.endpointId, t.endpointId), eq(chatActions.kind, OPENWA_RUN_RETRY_WAKE_ACTION_KIND)))).toHaveLength(0);
  }, 120_000);
  async function runRetryActions(t: Setup) {
    return db.select().from(chatActions).where(and(eq(chatActions.endpointId, t.endpointId), eq(chatActions.kind, OPENWA_RUN_RETRY_WAKE_ACTION_KIND)));
  }

  async function runFailedAudits(t: Setup) {
    return db.select().from(chatAuditEntries).where(and(eq(chatAuditEntries.endpointId, t.endpointId), eq(chatAuditEntries.kind, "run_failed")));
  }

  it("does not dispatch a staged run retry once heartbeat scheduled its own retry for the issue", async () => {
    const t = await setup();
    adapterMode.hold = false;
    adapterMode.failures = 1;
    const owner = await admit(t, { chatId: jid(OWNER_PHONE), body: "export the ledger" });
    const failed = await finishedRun(t, owner.action.id);
    const [retry] = await until(async () => {
      const rows = await runRetryActions(t);
      return rows.length ? rows : null;
    });
    await db.insert(heartbeatRuns).values({
      companyId: t.companyId,
      agentId: t.agentId,
      status: "scheduled_retry",
      retryOfRunId: null,
      scheduledRetryAt: new Date(Date.now() + 3_600_000),
      scheduledRetryAttempt: 1,
      scheduledRetryReason: "transient_failure",
      contextSnapshot: { issueId: String(failed.contextSnapshot?.issueId) },
    });
    const notBefore = Date.parse(String(retry!.payload.notBefore));
    expect(await processPendingOpenwaRunRetries(db, 25, new Date(notBefore + 1_000))).toBe(1);
    const [settled] = await runRetryActions(t);
    expect(settled).toMatchObject({ status: "processed", result: { code: "openwa_run_retry_not_needed" } });
    expect(await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, retry!.id))).toHaveLength(0);
  }, 120_000);

  it("audits instead of retrying when the failed run left a send to the chat uncertain", async () => {
    const t = await setup();
    adapterMode.failures = 1;
    const owner = await admit(t, { chatId: jid(OWNER_PHONE), body: "send the report" });
    const running = await runningRun(t, owner.action.id);
    await db.insert(chatOutboundMessages).values({
      companyId: t.companyId,
      endpointId: t.endpointId,
      chatKey: jid(OWNER_PHONE),
      source: "tool",
      runId: running.id,
      state: "uncertain",
      bodyHash: "h",
      clientNonce: randomUUID(),
    });
    release(running.id);
    const failed = await finishedRun(t, owner.action.id);
    expect(failed.status).toBe("failed");
    const audits = await until(async () => {
      const rows = await runFailedAudits(t);
      return rows.length ? rows : null;
    });
    expect(audits[0]).toMatchObject({ runId: failed.id, metadata: { reason: "send_uncertain", triggerIds: [owner.delivery.id] } });
    await expect(scheduleOpenwaRunRetryForRun(db, { companyId: t.companyId, runId: failed.id })).resolves.toBeNull();
    expect(await runRetryActions(t)).toHaveLength(0);
    expect(await runFailedAudits(t)).toHaveLength(1);
  }, 120_000);

  it("audits instead of retrying a failed approval_reply run", async () => {
    const t = await setup();
    adapterMode.failures = 1;
    const owner = await admit(t, { chatId: jid(OWNER_PHONE), body: "yes approve it" });
    const running = await runningRun(t, owner.action.id);
    await db.update(heartbeatRuns).set({
      contextSnapshot: sql`jsonb_set(${heartbeatRuns.contextSnapshot}, '{paperclipOpenwa,event}', '"approval_reply"'::jsonb)`,
    }).where(eq(heartbeatRuns.id, running.id));
    release(running.id);
    const failed = await finishedRun(t, owner.action.id);
    expect(failed.status).toBe("failed");
    const audits = await until(async () => {
      const rows = await runFailedAudits(t);
      return rows.length ? rows : null;
    });
    expect(audits[0]).toMatchObject({ runId: failed.id, metadata: { reason: "approval_event", event: "approval_reply" } });
    expect(await runRetryActions(t)).toHaveLength(0);
  }, 120_000);
});
