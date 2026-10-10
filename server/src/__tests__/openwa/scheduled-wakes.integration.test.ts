import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  activityLog,
  agents,
  agentWakeupRequests,
  authUsers,
  chatActions,
  chatAuditEntries,
  chatConversations,
  chatDeliveries,
  chatEndpoints,
  chatOwnerApprovalRequests,
  chatOwnerGrants,
  chatScheduledWakes,
  companies,
  companyMemberships,
  companySecretBindings,
  createDb,
  issues,
  toolConnections,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import { startEmbeddedPostgresTestDatabase } from "../helpers/embedded-postgres.js";
import { chatChannelService, type ChatChannelService, type ChatChannelServiceOptions } from "../../services/chat-channels.js";
import { ChatSdkRuntime } from "../../services/chat-sdk-runtime.js";
import { secretService } from "../../services/secrets.js";
import type { OpenwaInboundContext, OpenwaInboundEvent } from "../../services/openwa/receiver.js";
import type { OpenwaPolicySnapshot } from "../../services/openwa/policy.js";
import {
  activeOpenwaScheduledWakes,
  cancelApprovalReminders,
  createDeadlineHeap,
  createOpenwaScheduledWakes,
  createOpenwaTimerHooks,
  OPENWA_SCHEDULED_WAKE_ACTION_KIND,
  scheduleApprovalReminders,
  type OpenwaAbsenceIntent,
  type OpenwaScheduledWakeClock,
  type OpenwaScheduledWakes,
} from "../../services/openwa/scheduled-wakes.js";
import { OpenwaApprovalAlreadyResolvedError, resolveOpenwaApproval } from "../../services/openwa/approvals.js";
import { FAKE_OPENWA_KEY, FakeOpenwaGateway } from "./fake-gateway.js";

const SESSION_ID = "31111111-2222-4333-8444-555555555555";
const OWN_PHONE = "628111000211";
const OWNER_PHONE = "628333000233";
const MEMBER_PHONE = "628666000266";
const OTHER_MEMBER_PHONE = "628777000277";
const QUERY_METHODS = new Set(["select", "selectDistinct", "insert", "update", "delete", "execute"]);
const jid = (phone: string) => phone + "@c.us";


async function until(predicate: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

class FakeClock implements OpenwaScheduledWakeClock {
  time = Date.now();
  sets = 0;
  private seq = 0;
  readonly timers = new Map<number, { at: number; fire: () => void }>();
  now() {
    return this.time;
  }
  setTimer(fire: () => void, delayMs: number) {
    this.sets++;
    const id = ++this.seq;
    this.timers.set(id, { at: this.time + delayMs, fire });
    return id;
  }
  clearTimer(handle: unknown) {
    this.timers.delete(handle as number);
  }
  advanceTo(at: number) {
    this.time = Math.max(this.time, at);
    for (const [id, timer] of [...this.timers]) {
      if (timer.at > this.time) continue;
      this.timers.delete(id);
      timer.fire();
    }
  }
  advance(ms: number) {
    this.advanceTo(this.time + ms);
  }
}

function countingDb(db: Db) {
  const counts = { queries: 0 };
  const proxy = new Proxy(db, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      if (typeof property === "string" && (QUERY_METHODS.has(property) || property === "transaction"))
        return (...args: unknown[]) => {
          counts.queries++;
          return value.apply(target, args);
        };
      return value.bind(target);
    },
  });
  return { db: proxy as Db, counts };
}

function inboundEvent(overrides: Partial<OpenwaInboundEvent> = {}): OpenwaInboundEvent {
  return {
    source: "live",
    event: "message.received",
    sessionId: SESSION_ID,
    waMessageId: "false_x_" + randomUUID(),
    rowUuid: null,
    dedupeKey: "openwa:" + SESSION_ID + ":" + randomUUID(),
    chatId: "120363000000000099@g.us",
    chatKey: "120363000000000099@g.us",
    chatKind: "group",
    from: "120363000000000099@g.us",
    author: jid(OWNER_PHONE),
    senderJid: jid(OWNER_PHONE),
    senderPhone: OWNER_PHONE,
    isLidSender: false,
    fromMe: false,
    phoneTyped: false,
    degraded: false,
    body: "hi",
    type: "chat",
    timestamp: Math.floor(Date.now() / 1000),
    mentionedIds: [],
    quoted: null,
    media: null,
    location: null,
    contact: null,
    raw: {},
    ...overrides,
  };
}

describe("OpenWA deadline heap and timer hooks", () => {
  it("pops deadlines in order with stable ties", () => {
    const heap = createDeadlineHeap<string>();
    for (const [deadline, value] of [[5, "e"], [1, "a"], [3, "c"], [1, "b"], [4, "d"]] as const) heap.push(deadline, value);
    const out: string[] = [];
    for (let item = heap.pop(); item; item = heap.pop()) out.push(item.value);
    expect(out).toEqual(["a", "b", "c", "d", "e"]);
  });

  function hookFixture(numberMode: "agent_number" | "owner_number") {
    const calls: Array<{ kind: string; chatKey: string; absence?: number }> = [];
    const wakes = {
      ownerActivity: async (chatKey: string) => {
        calls.push({ kind: "owner", chatKey });
        return "none" as const;
      },
      armAbsence: async (event: OpenwaInboundEvent, absence: number) => {
        calls.push({ kind: "arm", chatKey: event.chatKey, absence });
        return { outcome: "armed" as const, wakeId: randomUUID(), fireAt: new Date() };
      },
    } as unknown as OpenwaScheduledWakes;
    const snapshot = {
      policy: { numberMode, absenceSeconds: 120, senderPolicyMode: "all" },
      chats: new Map([["120363000000000099@g.us", { settings: { activation: "auto", absenceSeconds: 45 } }]]),
      deny: new Set([MEMBER_PHONE]),
      allow: new Set(),
    } as unknown as OpenwaPolicySnapshot;
    const hooks = createOpenwaTimerHooks({ lookup: () => wakes, policies: { peek: () => snapshot } });
    const ctx = { companyId: randomUUID(), endpointId: randomUUID() } as OpenwaInboundContext;
    return { calls, hooks, ctx };
  }

  it("counts only owner content as activity; reactions, edits and revokes never cancel", async () => {
    const { calls, hooks, ctx } = hookFixture("agent_number");
    for (const type of ["reaction", "revoked", "protocol", "e2e_notification", "unknown"]) await hooks.onOwnerActivity(inboundEvent().chatKey, inboundEvent({ type }), ctx);
    expect(calls).toEqual([]);
    for (const type of ["chat", "image", "sticker", "location", "vcard", "poll_creation"]) await hooks.onOwnerActivity(inboundEvent().chatKey, inboundEvent({ type }), ctx);
    expect(calls.map((call) => call.kind)).toEqual(["owner", "owner", "owner", "owner", "owner", "owner"]);
  });

  it("in owner_number mode only phone-typed owner activity cancels", async () => {
    const { calls, hooks, ctx } = hookFixture("owner_number");
    await hooks.onOwnerActivity(inboundEvent().chatKey, inboundEvent({ phoneTyped: false }), ctx);
    expect(calls).toEqual([]);
    await hooks.onOwnerActivity(inboundEvent().chatKey, inboundEvent({ phoneTyped: true }), ctx);
    expect(calls).toHaveLength(1);
  });

  it("arms with the per-chat absence override and never for denylisted senders", async () => {
    const { calls, hooks, ctx } = hookFixture("agent_number");
    await hooks.onAbsenceCandidate(inboundEvent({ senderJid: jid(MEMBER_PHONE), senderPhone: MEMBER_PHONE }), ctx);
    expect(calls).toEqual([]);
    await hooks.onAbsenceCandidate(inboundEvent({ senderJid: jid(OTHER_MEMBER_PHONE), senderPhone: OTHER_MEMBER_PHONE }), ctx);
    await hooks.onAbsenceCandidate(inboundEvent({ chatKey: "120363000000000098@g.us", senderJid: jid(OTHER_MEMBER_PHONE), senderPhone: OTHER_MEMBER_PHONE }), ctx);
    expect(calls.map((call) => call.absence)).toEqual([45, 120]);
  });
});

describe.sequential("OpenWA scheduled wakes (embedded Postgres + fake gateway)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let secrets: string;
  const oldKey = process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
  const services: ChatChannelService[] = [];
  const gateways: FakeOpenwaGateway[] = [];
  const schedulers: OpenwaScheduledWakes[] = [];
  const endpointIds: string[] = [];

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-openwa-scheduled-");
    db = createDb(database.connectionString);
    secrets = await mkdtemp(path.join(tmpdir(), "openwa-scheduled-secrets-"));
    process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = path.join(secrets, "master.key");
  }, 60_000);
  afterEach(async () => {
    await Promise.all(schedulers.splice(0).map((scheduler) => scheduler.stop()));
    await Promise.all(services.splice(0).map((service) => service.shutdown()));
    await Promise.all(gateways.splice(0).map((gateway) => gateway.close()));
    for (const id of endpointIds.splice(0)) await db.update(chatEndpoints).set({ status: "archived" }).where(eq(chatEndpoints.id, id));
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await database?.cleanup();
    if (secrets) await rm(secrets, { recursive: true, force: true });
    if (oldKey === undefined) delete process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
    else process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = oldKey;
  });

  type Wakeup = ChatChannelServiceOptions["heartbeat"]["wakeup"];

  function wakeupStub() {
    return vi.fn<Wakeup>(async (agentId, opts) => {
      const request = opts.durableChatRequest;
      if (!request) return { accepted: true } as never;
      await db.transaction(async (tx) => {
        await request.authorize(tx as unknown as Parameters<typeof request.authorize>[0]);
        await tx
          .insert(agentWakeupRequests)
          .values({
            id: request.id,
            companyId: request.companyId,
            agentId,
            source: opts.source ?? "assignment",
            triggerDetail: opts.triggerDetail,
            reason: opts.reason,
            payload: opts.payload,
            requestedByActorType: opts.requestedByActorType,
            requestedByActorId: opts.requestedByActorId,
            idempotencyKey: request.idempotencyKey,
            requestedAt: request.requestedAt,
            status: "queued",
          })
          .onConflictDoNothing();
      });
      return { accepted: true } as never;
    });
  }

  function makeService(counted: Db, wakeup: ReturnType<typeof wakeupStub>, clock?: OpenwaScheduledWakeClock) {
    const service = chatChannelService(counted, {
      runtime: new ChatSdkRuntime(),
      publicBaseUrl: "https://paperclip.example",
      heartbeat: { wakeup } as never,
      discordGatewayLeaseTtlMs: 120_000,
      discordGatewayLeaseRenewalIntervalMs: 60_000,
      discordGatewayLeaseWaitMs: 200,
      openwaBurstWindowMs: 0,
      ...(clock ? { openwaScheduledWakeClock: clock } : {}),
    });
    services.push(service);
    return service;
  }

  async function setup(options: { clock?: OpenwaScheduledWakeClock } = {}) {
    const gateway = new FakeOpenwaGateway({ sessionId: SESSION_ID, ownPhone: OWN_PHONE });
    await gateway.start();
    gateways.push(gateway);
    const companyId = randomUUID();
    const agentId = randomUUID();
    const userId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "OpenWA scheduled",
      issuePrefix: "S" + companyId.replaceAll("-", "").slice(0, 7).toUpperCase(),
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
    const counted = countingDb(db);
    const wakeup = wakeupStub();
    const service = makeService(counted.db, wakeup, options.clock);
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
      .where(eq(toolConnections.id, row.connectionId));
    await db.insert(companySecretBindings).values({
      companyId,
      secretId: secret.id,
      targetType: "tool_connection",
      targetId: row.connectionId,
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
    return { gateway, companyId, agentId, userId, endpointId: endpoint.id, service, counted, wakeup };
  }

  type Setup = Awaited<ReturnType<typeof setup>>;

  function handled(t: Pick<Setup, "service">) {
    const stats = t.service.openwaAdmissionStats;
    return stats.discarded + stats.ownerActivity + stats.filtered + stats.admitted;
  }

  async function send(t: Pick<Setup, "service" | "gateway">, input: Parameters<FakeOpenwaGateway["inbound"]>[0]) {
    const before = handled(t);
    const row = t.gateway.inbound({ store: false, ...input });
    await until(() => handled(t) > before);
    return row;
  }

  async function goLive(t: Pick<Setup, "service" | "gateway">, options: { discover?: boolean } = {}) {
    const result = await t.service.reconcileProviderRuntimes();
    expect(result.local).toBe(1);
    await t.gateway.waitForSubscription();
    if (options.discover === false) return;
    const groups = [...t.gateway.groups.keys()];
    const before = t.service.openwaAdmissionStats.discoveries;
    for (const chatId of groups) await send(t, { chatId, author: jid(MEMBER_PHONE), body: "warm up", timestamp: Math.floor(Date.now() / 1000) - 600 });
    await until(() => t.service.openwaAdmissionStats.discoveries >= before + groups.length);
  }

  function group(t: Setup, suffix: string) {
    const id = "1203630000000001" + suffix + "@g.us";
    t.gateway.groups.set(id, {
      id,
      name: "Group " + suffix,
      participants: [{ id: jid(OWN_PHONE) }, { id: jid(OWNER_PHONE) }, { id: jid(MEMBER_PHONE) }, { id: jid(OTHER_MEMBER_PHONE) }],
    });
    return id;
  }

  const mentionOwner = (chatId: string, author: string, timestamp: number, body = "@" + OWNER_PHONE + " are you there?") => ({
    chatId,
    author,
    body,
    timestamp,
    extra: { mentionedIds: [jid(OWNER_PHONE)] },
  });

  async function wakeRows(t: Pick<Setup, "companyId" | "endpointId">) {
    return db
      .select()
      .from(chatScheduledWakes)
      .where(and(eq(chatScheduledWakes.companyId, t.companyId), eq(chatScheduledWakes.endpointId, t.endpointId)))
      .orderBy(asc(chatScheduledWakes.createdAt), asc(chatScheduledWakes.fireAt));
  }

  async function deliveries(t: Pick<Setup, "companyId" | "endpointId">) {
    return db
      .select()
      .from(chatDeliveries)
      .where(and(eq(chatDeliveries.companyId, t.companyId), eq(chatDeliveries.endpointId, t.endpointId)))
      .orderBy(asc(chatDeliveries.receivedAt), asc(chatDeliveries.id));
  }

  async function inboundWakes(t: Pick<Setup, "companyId" | "endpointId">) {
    return db
      .select()
      .from(chatActions)
      .where(and(eq(chatActions.companyId, t.companyId), eq(chatActions.endpointId, t.endpointId), eq(chatActions.kind, "inbound_wakeup")));
  }

  async function settled(t: Pick<Setup, "service" | "companyId" | "endpointId">, count: number) {
    let swept = Date.now();
    await until(async () => {
      if (Date.now() - swept > 1_000) {
        swept = Date.now();
        await t.service.processPendingDeliveries();
      }
      const rows = await deliveries(t);
      return rows.length >= count && rows.every((row) => row.state === "processed" || row.state === "filtered" || row.state === "failed");
    });
    return deliveries(t);
  }

  it("arms owner_absent when a member replies to an owner's message, and once when the reply also mentions the owner", async () => {
    const t = await setup({ clock: new FakeClock() });
    const chat = group(t, "43");
    await goLive(t);
    const ts = Math.floor(Date.now() / 1000);
    const ownerMessageId = "false_" + chat + "_3EB0OWNERMSG01_" + jid(OWNER_PHONE);
    await send(t, { chatId: chat, author: jid(MEMBER_PHONE), body: "jadi gimana ini?", timestamp: ts, extra: { quotedMessage: { id: ownerMessageId, body: "nanti aku cek" } } });
    await send(t, { chatId: chat, author: jid(OTHER_MEMBER_PHONE), body: "@" + OWNER_PHONE + " tolong dijawab", timestamp: ts + 5, extra: { mentionedIds: [jid(OWNER_PHONE)], quotedMessage: { id: ownerMessageId, body: "nanti aku cek" } } });
    const rows = await wakeRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "owner_absent", state: "pending", chatKey: chat });
    expect(rows[0].fireAt.getTime()).toBe((ts + 120) * 1000);
    expect((rows[0].payload as { messages: unknown[] }).messages).toHaveLength(2);
    const memberMessageId = "false_" + chat + "_3EB0MEMBERMSG1_" + jid(MEMBER_PHONE);
    const other = group(t, "44");
    await send(t, { chatId: other, author: jid(OTHER_MEMBER_PHONE), body: "setuju", timestamp: ts, extra: { quotedMessage: { id: memberMessageId, body: "ayo meeting" } } });
    expect((await wakeRows(t)).filter((row) => row.chatKey === other)).toHaveLength(0);
  }, 120_000);

  it("never arms a wake for group chatter that does not mention an owner", async () => {
    const t = await setup({ clock: new FakeClock() });
    const chat = group(t, "42");
    await goLive(t);
    const ts = Math.floor(Date.now() / 1000);
    await send(t, { chatId: chat, author: jid(MEMBER_PHONE), body: "pagi semua", timestamp: ts });
    await send(t, { chatId: chat, author: jid(MEMBER_PHONE), body: "@" + OTHER_MEMBER_PHONE + " udah makan?", timestamp: ts + 1, extra: { mentionedIds: [jid(OTHER_MEMBER_PHONE)] } });
    await send(t, { chatId: chat, author: jid(OTHER_MEMBER_PHONE), body: "udah", timestamp: ts + 2 });
    expect(await wakeRows(t)).toHaveLength(0);
    expect(await deliveries(t)).toHaveLength(0);
  }, 120_000);

  it("arms owner_absent when a group mention names the owner by LID only", async () => {
    const t = await setup({ clock: new FakeClock() });
    const ownerLid = "105000000006444@lid";
    t.gateway.lids.set(OWNER_PHONE, ownerLid);
    const chat = group(t, "41");
    await goLive(t);
    const ts = Math.floor(Date.now() / 1000);
    await send(t, { chatId: chat, author: jid(MEMBER_PHONE), body: "@105000000006444 bisa cek ini?", timestamp: ts, extra: { mentionedIds: [ownerLid] } });
    const [armed] = await wakeRows(t);
    expect(armed).toMatchObject({ kind: "owner_absent", state: "pending", chatKey: chat });
  }, 120_000);

  it("owner silent 120 s wakes owner_absent with every attached message; fireAt never moves (AC8)", async () => {
    const clock = new FakeClock();
    const t = await setup({ clock });
    const chat = group(t, "01");
    await goLive(t);
    const ts = Math.floor(Date.now() / 1000);
    const fireAt = (ts + 120) * 1000;
    await send(t, mentionOwner(chat, jid(MEMBER_PHONE), ts));
    const [armed] = await wakeRows(t);
    expect(armed).toMatchObject({ kind: "owner_absent", state: "pending", chatKey: chat });
    expect(armed.fireAt.getTime()).toBe(fireAt);
    expect(clock.timers.size).toBe(1);

    await send(t, mentionOwner(chat, jid(OTHER_MEMBER_PHONE), ts + 30, "@" + OWNER_PHONE + " please"));
    await send(t, mentionOwner(chat, jid(OTHER_MEMBER_PHONE), ts + 90, "@" + OWNER_PHONE + " still waiting"));
    await send(t, { chatId: chat, author: jid(MEMBER_PHONE), body: "plain chatter", timestamp: ts + 40 });
    const rows = await wakeRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].fireAt.getTime()).toBe(fireAt);
    expect((rows[0].payload as { messages: unknown[] }).messages).toHaveLength(3);
    expect(clock.sets).toBe(1);
    expect(await deliveries(t)).toHaveLength(0);

    clock.advanceTo(fireAt - 1);
    expect((await wakeRows(t))[0].state).toBe("pending");
    clock.advanceTo(fireAt);
    const admitted = await settled(t, 3);
    expect((await wakeRows(t))[0].state).toBe("fired");
    expect(admitted.map((row) => [row.triggerClass, row.answerState, (row.normalizedEvent as { openwa: { event: string } }).openwa.event])).toEqual([
      ["other", "pending", "owner_absent"],
      ["other", "pending", "owner_absent"],
      ["other", "pending", "owner_absent"],
    ]);
    const wakes = await inboundWakes(t);
    expect(wakes).toHaveLength(1);
    expect((wakes[0].payload as { openwa: unknown }).openwa).toEqual({
      event: "owner_absent",
      triggerClass: "other",
      deliveryIds: admitted.map((row) => row.id),
    });
    await until(async () => (await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, wakes[0].id))).length === 1);
    const [receipt] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, wakes[0].id));
    expect((receipt.payload as { openwa: { event: string } }).openwa.event).toBe("owner_absent");
    const [intent] = await db.select().from(chatActions).where(and(eq(chatActions.endpointId, t.endpointId), eq(chatActions.kind, OPENWA_SCHEDULED_WAKE_ACTION_KIND)));
    expect(intent.status).toBe("processed");
  }, 120_000);

  async function conversationIssueId(t: Pick<Setup, "companyId" | "endpointId">) {
    const [row] = await db
      .select({ issueId: chatConversations.issueId })
      .from(chatConversations)
      .where(and(eq(chatConversations.companyId, t.companyId), eq(chatConversations.endpointId, t.endpointId)));
    return row!.issueId;
  }

  async function reopenActivities(issueId: string, wake: string) {
    return db
      .select({ actorType: activityLog.actorType, actorId: activityLog.actorId, details: activityLog.details })
      .from(activityLog)
      .where(and(eq(activityLog.entityId, issueId), eq(activityLog.action, "issue.updated"), sql`${activityLog.details}->>'wake' = ${wake}`));
  }

  it("moves an in_review conversation issue back to in_progress before an owner_absent wake", async () => {
    const clock = new FakeClock();
    const t = await setup({ clock });
    const chat = group(t, "05");
    await goLive(t);
    await send(t, {
      chatId: chat,
      author: jid(MEMBER_PHONE),
      body: "@" + OWN_PHONE + " halo",
      extra: { mentionedIds: [jid(OWN_PHONE)] },
    });
    await settled(t, 1);
    const issueId = await conversationIssueId(t);
    await db.update(issues).set({ status: "in_review" }).where(eq(issues.id, issueId));
    const ts = Math.floor(clock.now() / 1000);
    await send(t, mentionOwner(chat, jid(MEMBER_PHONE), ts));
    const [armed] = await wakeRows(t);
    expect(armed).toMatchObject({ kind: "owner_absent", state: "pending" });
    clock.advanceTo(armed.fireAt.getTime());
    await settled(t, 2);
    await until(async () => (await inboundWakes(t)).length === 2);
    const [issue] = await db.select({ status: issues.status }).from(issues).where(eq(issues.id, issueId));
    expect(issue!.status).toBe("in_progress");
    expect(await reopenActivities(issueId, "owner_absent")).toEqual([
      expect.objectContaining({
        actorType: "system",
        actorId: "chat:openwa",
        details: expect.objectContaining({ status: "in_progress", source: "chat:openwa", _previous: { status: "in_review" } }),
      }),
    ]);
  }, 120_000);

  it("owner message at 60 s cancels; an owner reaction or revoke alone does not (AC8)", async () => {
    const clock = new FakeClock();
    const t = await setup({ clock });
    const cancelled = group(t, "02");
    const reacted = group(t, "03");
    await goLive(t);
    const ts = Math.floor(Date.now() / 1000);
    await send(t, mentionOwner(cancelled, jid(MEMBER_PHONE), ts));
    await send(t, mentionOwner(reacted, jid(MEMBER_PHONE), ts));
    expect((await wakeRows(t)).map((row) => row.state)).toEqual(["pending", "pending"]);

    await send(t, { chatId: cancelled, author: jid(OWNER_PHONE), body: "on it", timestamp: ts + 60 });
    t.gateway.emit("message.reaction", { messageId: "x", chatId: reacted, from: jid(OWNER_PHONE), reaction: "+1", timestamp: ts + 60 });
    await send(t, { chatId: reacted, author: jid(OWNER_PHONE), body: "", timestamp: ts + 60, extra: { type: "reaction" } });
    await send(t, { chatId: reacted, author: jid(OWNER_PHONE), body: "", timestamp: ts + 61, extra: { type: "revoked" } });
    const states = Object.fromEntries((await wakeRows(t)).map((row) => [row.chatKey, row.state]));
    expect(states).toEqual({ [cancelled]: "cancelled", [reacted]: "pending" });
    expect(clock.timers.size).toBe(1);

    clock.advanceTo((ts + 121) * 1000);
    const admitted = await settled(t, 1);
    expect(admitted.map((row) => (row.normalizedEvent as { openwa: { chatKey: string } }).openwa.chatKey)).toEqual([reacted]);
    expect(await inboundWakes(t)).toHaveLength(1);
  }, 120_000);

  it("a message mentioning the owner and the agent wakes immediately and arms no timer (AC8)", async () => {
    const clock = new FakeClock();
    const t = await setup({ clock });
    const chat = group(t, "04");
    await goLive(t);
    await send(t, {
      chatId: chat,
      author: jid(MEMBER_PHONE),
      body: "@" + OWNER_PHONE + " @" + OWN_PHONE + " help",
      extra: { mentionedIds: [jid(OWNER_PHONE), jid(OWN_PHONE)] },
    });
    const [row] = await settled(t, 1);
    expect((row.normalizedEvent as { openwa: { event: string } }).openwa.event).toBe("message");
    expect(await wakeRows(t)).toHaveLength(0);
    expect(clock.timers.size).toBe(0);
  }, 120_000);

  it("is timer-driven: no queries between arm and fire, one timer per earliest deadline, zero queries without a pending timer", async () => {
    const clock = new FakeClock();
    const t = await setup({ clock });
    const timed = group(t, "05");
    const quiet = group(t, "06");
    const later = group(t, "07");
    await goLive(t);
    const ts = Math.floor(Date.now() / 1000);
    await send(t, mentionOwner(timed, jid(MEMBER_PHONE), ts));
    expect(clock.sets).toBe(1);
    await send(t, mentionOwner(later, jid(MEMBER_PHONE), ts + 50));
    expect(clock.sets).toBe(1);
    await t.service.openwa.putChat(t.endpointId, { chatId: quiet, settings: { activation: "auto", absenceSeconds: 30 } }, t.userId);
    await send(t, { chatId: quiet, author: jid(MEMBER_PHONE), body: "refresh policy", timestamp: ts });

    const queries = t.counted.counts.queries;
    for (let i = 0; i < 50; i++) {
      t.gateway.inbound({ store: false, chatId: quiet, author: jid(OWNER_PHONE), body: "owner chatter " + i, timestamp: ts + 1 });
      t.gateway.inbound({ store: false, chatId: quiet, author: jid(MEMBER_PHONE), body: "member chatter " + i, timestamp: ts + 1 });
    }
    const before = handled(t);
    await until(() => handled(t) >= before + 100);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(t.counted.counts.queries - queries).toBe(0);
    expect(clock.timers.size).toBe(1);
    expect(clock.sets).toBe(1);

    await send(t, mentionOwner(quiet, jid(MEMBER_PHONE), ts));
    expect(clock.sets).toBe(2);
    expect([...clock.timers.values()][0].at).toBe((ts + 30) * 1000);
    clock.advanceTo((ts + 30) * 1000);
    await settled(t, 1);
    await until(() => clock.timers.size === 1 && [...clock.timers.values()][0].at === (ts + 120) * 1000);
  }, 120_000);

  it("rebuilds after a restart and fires within 2 s of fireAt, including overdue rows on the rebuild pass (AC16)", async () => {
    const t = await setup();
    const soon = group(t, "08");
    const overdue = group(t, "09");
    await goLive(t);
    const now = Math.floor(Date.now() / 1000);
    await send(t, mentionOwner(soon, jid(MEMBER_PHONE), now - 115));
    await send(t, mentionOwner(overdue, jid(MEMBER_PHONE), now - 110));
    await t.service.shutdown();
    services.splice(services.indexOf(t.service), 1);
    await db.update(chatScheduledWakes).set({ fireAt: new Date(Date.now() - 5_000) }).where(eq(chatScheduledWakes.chatKey, overdue));
    const restarted = makeService(db, wakeupStub());
    const restartedAt = Date.now();
    await goLive({ service: restarted, gateway: t.gateway }, { discover: false });
    const rows = Object.fromEntries((await wakeRows(t)).map((row) => [row.chatKey, row]));
    expect(rows[soon].fireAt.getTime()).toBeGreaterThan(restartedAt);
    await until(async () => (await inboundWakes(t)).length === 2, 20_000);
    const wakes = await inboundWakes(t);
    const admitted = await deliveries(t);
    for (const chatKey of [soon, overdue]) {
      const delivery = admitted.find((row) => (row.normalizedEvent as { openwa: { chatKey: string } }).openwa.chatKey === chatKey)!;
      expect(wakes.find((action) => action.deliveryId === delivery.id)).toBeDefined();
      const due = Math.max(rows[chatKey].fireAt.getTime(), restartedAt);
      expect(delivery.createdAt.getTime() - due).toBeLessThan(2_000);
    }
  }, 120_000);

  it("fires exactly once when two lease holders overlap during failover", async () => {
    const t = await setup();
    const chat = group(t, "10");
    const [row] = await db
      .insert(chatScheduledWakes)
      .values({
        companyId: t.companyId,
        endpointId: t.endpointId,
        chatKey: chat,
        kind: "owner_absent",
        fireAt: new Date(Date.now() - 1_000),
        payload: { version: 1, messages: [{ ...inboundEvent({ chatKey: chat, chatId: chat }), raw: {} }], omitted: 0 },
      })
      .returning();
    const delivered: OpenwaAbsenceIntent[] = [];
    const make = () =>
      createOpenwaScheduledWakes({
        db,
        companyId: t.companyId,
        endpointId: t.endpointId,
        heartbeat: { wakeup: t.wakeup },
        deliverAbsence: async (intent) => {
          delivered.push(intent);
        },
      });
    const first = make();
    const second = make();
    schedulers.push(first, second);
    await Promise.all([first.start(), second.start()]);
    await until(async () => (await db.select().from(chatActions).where(eq(chatActions.providerActionId, "scheduled_wakeup:" + row.id))).some((action) => action.status === "processed"));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(first.stats.claimed + second.stats.claimed).toBe(1);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].wakeId).toBe(row.id);
    const [fired] = await db.select().from(chatScheduledWakes).where(eq(chatScheduledWakes.id, row.id));
    expect(fired.state).toBe("fired");
  }, 60_000);

  it("schedules, fires and cancels approval reminders through the exported API", async () => {
    const clock = new FakeClock();
    const t = await setup({ clock });
    await t.service.openwa.updatePolicy(t.endpointId, { approvals: { reminderMinutes: 1, maxReminders: 3 } }, t.userId);
    await goLive(t);
    await send(t, { chatId: jid(OWNER_PHONE), body: "start a conversation" });
    await settled(t, 1);
    const reminderCalls = () => t.wakeup.mock.calls.filter(([, opts]) => opts.idempotencyKey?.startsWith("openwa-scheduled-wake:"));
    const [request] = await db
      .insert(chatOwnerApprovalRequests)
      .values({
        companyId: t.companyId,
        endpointId: t.endpointId,
        originChatKey: jid(OWNER_PHONE),
        categories: ["create_task"],
        scope: "one_action",
        summary: "Create a task",
        proposedAction: "create",
      })
      .returning();
    const createdAt = new Date(clock.now());
    await scheduleApprovalReminders(db, { companyId: t.companyId, endpointId: t.endpointId, requestId: request.id, chatKey: jid(OWNER_PHONE), createdAt });
    await scheduleApprovalReminders(db, { companyId: t.companyId, endpointId: t.endpointId, requestId: request.id, chatKey: jid(OWNER_PHONE), createdAt });
    const reminders = (await wakeRows(t)).filter((row) => row.kind === "approval_reminder");
    expect(reminders.map((row) => [row.state, row.fireAt.getTime() - createdAt.getTime(), row.relatedId])).toEqual([
      ["pending", 60_000, request.id],
      ["pending", 120_000, request.id],
      ["pending", 180_000, request.id],
    ]);
    expect(activeOpenwaScheduledWakes(t.endpointId)?.pendingCount).toBe(4);

    clock.advance(60_000);
    await until(() => reminderCalls().length === 1);
    const [, opts] = reminderCalls()[0];
    expect(opts.payload?.openwa).toEqual({ event: "approval_pending", triggerClass: "other", deliveryIds: [], approvalRequestId: request.id });
    expect(opts.contextSnapshot?.openwa).toEqual(opts.payload?.openwa);
    expect(opts.idempotencyKey).toBe("openwa-scheduled-wake:" + reminders[0].id);
    await until(async () => (await db.select().from(chatOwnerApprovalRequests).where(eq(chatOwnerApprovalRequests.id, request.id)))[0].reminderCount === 1);
    await until(async () =>
      (await db.select().from(chatAuditEntries).where(eq(chatAuditEntries.endpointId, t.endpointId))).some((entry) => entry.kind === "approval_reminded"),
    );

    await cancelApprovalReminders(db, { companyId: t.companyId, endpointId: t.endpointId, requestId: request.id });
    expect((await wakeRows(t)).filter((row) => row.kind === "approval_reminder").map((row) => row.state)).toEqual(["fired", "cancelled", "cancelled"]);
    expect(activeOpenwaScheduledWakes(t.endpointId)?.pendingCount).toBe(0);
    clock.advance(180_000);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(reminderCalls()).toHaveLength(1);
  }, 120_000);

  it("moves a blocked conversation issue back to in_progress before an approval reminder wake", async () => {
    const clock = new FakeClock();
    const t = await setup({ clock });
    await t.service.openwa.updatePolicy(t.endpointId, { approvals: { reminderMinutes: 1, maxReminders: 1 } }, t.userId);
    await goLive(t);
    await send(t, { chatId: jid(OWNER_PHONE), body: "start a conversation" });
    await settled(t, 1);
    const issueId = await conversationIssueId(t);
    await db.update(issues).set({ status: "blocked" }).where(eq(issues.id, issueId));
    const [request] = await db
      .insert(chatOwnerApprovalRequests)
      .values({
        companyId: t.companyId,
        endpointId: t.endpointId,
        originChatKey: jid(OWNER_PHONE),
        categories: ["create_task"],
        scope: "one_action",
        summary: "Create a task",
        proposedAction: "create",
      })
      .returning();
    let statusAtWake: string | null = null;
    const wakeup = t.wakeup.getMockImplementation()!;
    t.wakeup.mockImplementation(async (agentId, opts) => {
      if (opts.idempotencyKey?.startsWith("openwa-scheduled-wake:")) {
        const [row] = await db.select({ status: issues.status }).from(issues).where(eq(issues.id, issueId));
        statusAtWake = row!.status;
      }
      return wakeup(agentId, opts);
    });
    await scheduleApprovalReminders(db, { companyId: t.companyId, endpointId: t.endpointId, requestId: request.id, chatKey: jid(OWNER_PHONE), createdAt: new Date(clock.now()) });
    clock.advance(60_000);
    await until(() => statusAtWake !== null);
    expect(statusAtWake).toBe("in_progress");
    expect(await reopenActivities(issueId, "approval_pending")).toEqual([
      expect.objectContaining({
        actorType: "system",
        details: expect.objectContaining({ status: "in_progress", source: "chat:openwa", _previous: { status: "blocked" } }),
      }),
    ]);
  }, 120_000);

  it("skips a reminder whose request was resolved without being cancelled", async () => {
    const clock = new FakeClock();
    const t = await setup({ clock });
    await t.service.openwa.updatePolicy(t.endpointId, { approvals: { reminderMinutes: 1, maxReminders: 1 } }, t.userId);
    await goLive(t);
    const [request] = await db
      .insert(chatOwnerApprovalRequests)
      .values({
        companyId: t.companyId,
        endpointId: t.endpointId,
        originChatKey: jid(OWNER_PHONE),
        categories: ["create_task"],
        scope: "one_action",
        summary: "Create a task",
        proposedAction: "create",
        status: "approved",
      })
      .returning();
    await scheduleApprovalReminders(db, { companyId: t.companyId, endpointId: t.endpointId, requestId: request.id, chatKey: jid(OWNER_PHONE), createdAt: new Date(clock.now()) });
    clock.advance(60_000);
    await until(async () =>
      (await db.select().from(chatActions).where(and(eq(chatActions.endpointId, t.endpointId), eq(chatActions.kind, OPENWA_SCHEDULED_WAKE_ACTION_KIND)))).some((action) => action.status === "skipped"),
    );
    expect(t.wakeup).not.toHaveBeenCalled();
  }, 60_000);

  async function requestRow(requestId: string) {
    const [row] = await db.select().from(chatOwnerApprovalRequests).where(eq(chatOwnerApprovalRequests.id, requestId));
    return row!;
  }

  it("expires a pending request after its lifetime: reminders stop, one approval_expired wake, never a grant", async () => {
    const clock = new FakeClock();
    const t = await setup({ clock });
    await t.service.openwa.updatePolicy(t.endpointId, { approvals: { reminderMinutes: 50, maxReminders: 3 } }, t.userId);
    await goLive(t);
    await send(t, { chatId: jid(OWNER_PHONE), body: "start a conversation" });
    await settled(t, 1);
    const createdAt = new Date(clock.now());
    const [request] = await db
      .insert(chatOwnerApprovalRequests)
      .values({
        companyId: t.companyId,
        endpointId: t.endpointId,
        originChatKey: jid(OWNER_PHONE),
        categories: ["create_task"],
        scope: "one_action",
        summary: "Create a task",
        proposedAction: "create",
        createdAt,
      })
      .returning();
    await scheduleApprovalReminders(db, { companyId: t.companyId, endpointId: t.endpointId, requestId: request.id, chatKey: jid(OWNER_PHONE), createdAt });
    const requestWakes = async () => (await wakeRows(t)).filter((row) => row.relatedId === request.id);
    expect((await requestWakes()).map((row) => [row.kind, row.state, row.fireAt.getTime() - createdAt.getTime()])).toEqual([
      ["approval_reminder", "pending", 50 * 60_000],
      ["approval_reminder", "pending", 100 * 60_000],
      ["approval_reminder", "pending", 150 * 60_000],
      ["approval_expiry", "pending", 24 * 3_600_000],
    ]);
    await t.service.openwa.updatePolicy(t.endpointId, { approvals: { pendingTtlHours: 1 } }, t.userId);
    const expiry = (await requestWakes()).find((row) => row.kind === "approval_expiry")!;
    expect(expiry.fireAt.getTime() - createdAt.getTime()).toBe(3_600_000);
    const callsWith = (prefix: string) => t.wakeup.mock.calls.filter(([, opts]) => opts.idempotencyKey?.startsWith(prefix));

    clock.advance(51 * 60_000);
    await until(() => callsWith("openwa-scheduled-wake:").length === 1);
    expect((await requestRow(request.id)).status).toBe("pending");

    clock.advance(10 * 60_000);
    await until(() => callsWith("openwa-approval-expired:").length === 1);
    expect(await requestRow(request.id)).toMatchObject({ status: "expired", resolvedVia: null, resolvedByUserId: null });
    expect((await requestWakes()).map((row) => row.kind + ":" + row.state)).toEqual([
      "approval_reminder:fired",
      "approval_expiry:fired",
      "approval_reminder:cancelled",
      "approval_reminder:cancelled",
    ]);
    const [agentId, opts] = callsWith("openwa-approval-expired:")[0];
    expect(agentId).toBe(t.agentId);
    expect(opts.reason).toBe("OpenWA approval request expired");
    expect(opts.payload?.openwa).toEqual({ event: "approval_expired", triggerClass: "other", deliveryIds: [], approvalRequestId: request.id });
    expect(opts.contextSnapshot?.openwa).toEqual(opts.payload?.openwa);
    const expiredAudit = () => db.select().from(chatAuditEntries).where(and(eq(chatAuditEntries.endpointId, t.endpointId), eq(chatAuditEntries.kind, "approval_expired")));
    expect(await expiredAudit()).toEqual([
      expect.objectContaining({ actorKind: "system", chatKey: jid(OWNER_PHONE), metadata: expect.objectContaining({ requestId: request.id, pendingTtlHours: 1, reminderCount: 1 }) }),
    ]);
    const activity = await db.select().from(activityLog).where(and(eq(activityLog.companyId, t.companyId), eq(activityLog.action, "openwa.approval_expired")));
    expect(activity).toEqual([expect.objectContaining({ entityId: t.endpointId, details: expect.objectContaining({ requestId: request.id, pendingTtlHours: 1 }) })]);

    clock.advance(6 * 3_600_000);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(callsWith("openwa-scheduled-wake:")).toHaveLength(1);
    expect(callsWith("openwa-approval-expired:")).toHaveLength(1);
    expect(await expiredAudit()).toHaveLength(1);
    await expect(
      resolveOpenwaApproval(db, { companyId: t.companyId, endpointId: t.endpointId, requestId: request.id, decision: "approve", via: "paperclip", owner: { userId: t.userId } }),
    ).rejects.toBeInstanceOf(OpenwaApprovalAlreadyResolvedError);
    expect(await db.select().from(chatOwnerGrants).where(eq(chatOwnerGrants.requestId, request.id))).toEqual([]);
    expect((await requestRow(request.id)).status).toBe("expired");
  }, 120_000);

  it("stops a request's reminders when an owner writes in its chat after it was created, not in another chat", async () => {
    const clock = new FakeClock();
    const t = await setup({ clock });
    await t.service.openwa.updatePolicy(t.endpointId, { approvals: { reminderMinutes: 30, maxReminders: 2 } }, t.userId);
    await goLive(t, { discover: false });
    const scheduler = activeOpenwaScheduledWakes(t.endpointId)!;
    const here = "120363000000000501@g.us";
    const elsewhere = "120363000000000502@g.us";
    const third = "120363000000000503@g.us";
    const createdAt = new Date(clock.now());
    const make = async (chatKey: string) => {
      const [request] = await db
        .insert(chatOwnerApprovalRequests)
        .values({
          companyId: t.companyId,
          endpointId: t.endpointId,
          originChatKey: chatKey,
          categories: ["reply"],
          scope: "one_action",
          summary: "Reply here",
          proposedAction: "reply",
          createdAt,
        })
        .returning();
      await scheduleApprovalReminders(db, { companyId: t.companyId, endpointId: t.endpointId, requestId: request.id, chatKey, createdAt });
      return request;
    };
    const a = await make(here);
    const b = await make(elsewhere);
    const states = async (requestId: string) => (await wakeRows(t)).filter((row) => row.relatedId === requestId).map((row) => row.kind + ":" + row.state);
    const allPending = ["approval_reminder:pending", "approval_reminder:pending", "approval_expiry:pending"];
    const seconds = Math.floor(createdAt.getTime() / 1000);

    await scheduler.ownerActivity(here, inboundEvent({ chatId: here, chatKey: here, from: here, timestamp: seconds - 60 }));
    expect(await states(a.id)).toEqual(allPending);
    await scheduler.ownerActivity(third, inboundEvent({ chatId: third, chatKey: third, from: third, timestamp: seconds + 5 }));
    expect(await states(a.id)).toEqual(allPending);
    expect(await states(b.id)).toEqual(allPending);

    await scheduler.ownerActivity(here, inboundEvent({ chatId: here, chatKey: here, from: here, timestamp: seconds + 5 }));
    expect(await states(a.id)).toEqual(["approval_reminder:cancelled", "approval_reminder:cancelled", "approval_expiry:pending"]);
    expect(await states(b.id)).toEqual(allPending);
    expect((await requestRow(a.id)).status).toBe("pending");
    expect((await requestRow(b.id)).status).toBe("pending");

    clock.advance(31 * 60_000);
    await until(async () => (await states(b.id))[0] === "approval_reminder:fired");
    expect(await states(a.id)).toEqual(["approval_reminder:cancelled", "approval_reminder:cancelled", "approval_expiry:pending"]);
  }, 120_000);
});
