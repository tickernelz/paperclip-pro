import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  agents,
  agentWakeupRequests,
  authUsers,
  chatActions,
  chatConversations,
  chatDeliveries,
  chatEndpointResources,
  chatEndpoints,
  companies,
  companyMemberships,
  companySecretBindings,
  createDb,
  heartbeatRuns,
  issueThreadInteractions,
  issues,
  toolConnections,
  type Db,
} from "@tickernelz/wardmote-db";
import { startEmbeddedPostgresTestDatabase } from "../helpers/embedded-postgres.js";
import { createLocalDiskStorageProvider } from "../../storage/local-disk-provider.js";
import { createStorageService } from "../../storage/service.js";
import { chatChannelService, type ChatChannelService, type ChatChannelServiceOptions } from "../../services/chat-channels.js";
import { ChatSdkRuntime } from "../../services/chat-sdk-runtime.js";
import { instanceSettingsService } from "../../services/instance-settings.js";
import { issueService } from "../../services/issues.js";
import { issueThreadInteractionService } from "../../services/issue-thread-interactions.js";
import { secretService } from "../../services/secrets.js";
import { resolveOwnerRelayAuthority } from "../../services/owner-decision-relay.js";
import { applyOpenwaRunContext, resolveOpenwaRunContext } from "../../services/openwa/authority.js";
import { buildOpenwaRunGuidance } from "../../services/openwa/guidance.js";
import { OPENWA_PENDING_CARD_ACTION_KIND } from "../../services/openwa/card-routing.js";
import { executeOpenwaTool } from "../../services/openwa/tools.js";
import { FAKE_OPENWA_KEY, FakeOpenwaGateway } from "./fake-gateway.js";

const SESSION_ID = "53333333-2222-4333-8444-555555555555";
const OWN_PHONE = "628111000611";
const OWNER_PHONE = "628333000611";
const SECOND_PHONE = "628333000622";
const MEMBER_A = "628666000611";
const PROJECT = "120363000000000611@g.us";
const BOT_GROUP = "120363000000000612@g.us";
const jid = (phone: string) => phone + "@c.us";

type WakeupOptions = Parameters<ChatChannelServiceOptions["heartbeat"]["wakeup"]>[1];

async function until(predicate: () => boolean | Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("OpenWA pending cards follow the task's origin chat (embedded Postgres + fake gateway)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let scratch: string;
  const oldKey = process.env.WARDMOTE_SECRETS_MASTER_KEY_FILE;
  const services: ChatChannelService[] = [];
  const gateways: FakeOpenwaGateway[] = [];
  const endpointIds: string[] = [];

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("wardmote-openwa-card-routing-");
    db = createDb(database.connectionString);
    scratch = await mkdtemp(path.join(tmpdir(), "openwa-card-routing-"));
    process.env.WARDMOTE_SECRETS_MASTER_KEY_FILE = path.join(scratch, "master.key");
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
    if (oldKey === undefined) delete process.env.WARDMOTE_SECRETS_MASTER_KEY_FILE;
    else process.env.WARDMOTE_SECRETS_MASTER_KEY_FILE = oldKey;
  });

  async function linkUser(companyId: string, name: string) {
    const userId = randomUUID();
    await db.insert(authUsers).values({ id: userId, name, email: userId + "@example.com", emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "operator" });
    return userId;
  }

  async function setup() {
    const gateway = new FakeOpenwaGateway({ sessionId: SESSION_ID, ownPhone: OWN_PHONE });
    await gateway.start();
    gateways.push(gateway);
    gateway.groups.set(PROJECT, { id: PROJECT, name: "Tim DCM", participants: [{ id: jid(OWN_PHONE) }, { id: jid(OWNER_PHONE) }, { id: jid(MEMBER_A) }] });
    gateway.groups.set(BOT_GROUP, { id: BOT_GROUP, name: "[BOT] DCM Wardmote", participants: [{ id: jid(OWN_PHONE) }, { id: jid(OWNER_PHONE) }] });
    const companyId = randomUUID();
    const agentId = randomUUID();
    const arif = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "OpenWA card routing",
      issuePrefix: "K" + companyId.replaceAll("-", "").slice(0, 7).toUpperCase(),
      requireBoardApprovalForNewAgents: false,
    });
    for (const [id, name] of [[agentId, "Wira"], [arif, "Arif"]] as const)
      await db.insert(agents).values({ id, companyId, name, role: "engineer", status: "idle", adapterType: "wardmote_runner", adapterConfig: {}, runtimeConfig: {}, permissions: {} });
    const userId = await linkUser(companyId, "Owner");
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
      publicBaseUrl: "https://wardmote.example",
      heartbeat: { wakeup } as never,
      storage: createStorageService(createLocalDiskStorageProvider(path.join(scratch, "storage"))),
      scheduleDeferredWork: () => {},
      openwaBurstWindowMs: 0,
      discordGatewayLeaseTtlMs: 120_000,
      discordGatewayLeaseRenewalIntervalMs: 60_000,
      discordGatewayLeaseWaitMs: 200,
    });
    services.push(service);
    const endpoint = await service.create(companyId, { provider: "openwa", assignedAgentId: agentId } as never, userId);
    endpointIds.push(endpoint.id);
    const secret = await secretService(db).create(
      companyId,
      { name: "openwa-key-" + endpoint.id.slice(0, 8), provider: "local_encrypted", managedMode: "wardmote_managed", value: FAKE_OPENWA_KEY },
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
        policy: {},
        setup: { step: "complete", testStartedAt: new Date(Date.now() - 60_000).toISOString() },
      })
      .where(eq(chatEndpoints.id, endpoint.id));
    const added = await service.openwa.addOwner(endpoint.id, { e164: "+" + OWNER_PHONE, expiresInSeconds: 1_800 }, userId);
    const token = new URL(added.confirmationUrl!, "https://wardmote.example").searchParams.get("token")!;
    await service.confirmIdentityLink(token, userId);
    await service.openwa.addSenderRule(endpoint.id, { list: "allow", e164: "+" + MEMBER_A }, userId);
    expect((await service.reconcileProviderRuntimes()).local).toBe(1);
    await gateway.waitForFirstCatchUp();
    const t = { gateway, companyId, agentId, arif, userId, endpointId: endpoint.id, service, wakes };
    const before = service.openwaAdmissionStats.discoveries;
    const warmAt = Math.floor(Date.now() / 1000) - 600;
    for (const [chatId, author] of [[PROJECT, MEMBER_A], [BOT_GROUP, OWNER_PHONE]] as const)
      gateway.inbound({ chatId, author: jid(author), body: "warm up", timestamp: warmAt, store: false });
    await until(() => service.openwaAdmissionStats.discoveries >= before + 2);
    await until(async () => (await db.select().from(chatEndpointResources).where(and(eq(chatEndpointResources.endpointId, endpoint.id), eq(chatEndpointResources.type, "group_chat")))).length >= 2);
    return t;
  }

  type Setup = Awaited<ReturnType<typeof setup>>;

  async function deliveries(t: Setup) {
    return db
      .select()
      .from(chatDeliveries)
      .where(and(eq(chatDeliveries.companyId, t.companyId), eq(chatDeliveries.endpointId, t.endpointId)))
      .orderBy(asc(chatDeliveries.createdAt));
  }

  async function wakeFor(t: Setup, actionId: string) {
    await until(() => t.wakes.has(actionId));
    const [request] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, actionId));
    return { request: request!, wake: t.wakes.get(actionId)! };
  }

  async function admitted(t: Setup, input: Parameters<FakeOpenwaGateway["inbound"]>[0]) {
    const before = (await deliveries(t)).length;
    t.gateway.inbound(input);
    let swept = Date.now();
    await until(async () => {
      if (Date.now() - swept > 1_000) {
        swept = Date.now();
        await t.service.processPendingDeliveries();
      }
      const rows = await deliveries(t);
      return rows.length > before && rows.every((entry) => entry.state === "processed" || entry.state === "filtered");
    }, 30_000);
    const delivery = (await deliveries(t)).at(-1)!;
    expect(delivery.state).toBe("processed");
    const [action] = await db.select().from(chatActions).where(and(eq(chatActions.deliveryId, delivery.id), eq(chatActions.kind, "inbound_wakeup")));
    return { delivery, ...(await wakeFor(t, action!.id)) };
  }

  type Wake = Awaited<ReturnType<typeof wakeFor>>;

  async function runStart(t: Setup, wake: Wake) {
    const runId = randomUUID();
    const issueId = String(wake.wake.contextSnapshot!.issueId);
    const openwaPayload = (wake.request.payload as { openwa: { triggerClass: string } }).openwa;
    const contextSnapshot: Record<string, unknown> = { ...wake.wake.contextSnapshot, wardmoteOpenwa: { triggerClass: openwaPayload.triggerClass } };
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId: t.companyId,
      agentId: t.agentId,
      status: "running",
      wakeupRequestId: wake.request.id,
      startedAt: new Date(),
      contextSnapshot,
    });
    const openwa = await resolveOpenwaRunContext(db, { companyId: t.companyId, issueId, contextSnapshot, wakeupRequestId: wake.request.id, runId });
    expect(openwa).not.toBeNull();
    applyOpenwaRunContext(contextSnapshot, openwa);
    await db.update(heartbeatRuns).set({ contextSnapshot }).where(eq(heartbeatRuns.id, runId));
    return { runId, issueId, openwa: openwa!, contextSnapshot };
  }

  const mention = (chatId: string, phone: string, body: string) => ({ chatId, author: jid(phone), body: "@" + OWN_PHONE + " " + body, extra: { mentionedIds: [jid(OWN_PHONE)] } });

  async function ownerDm(t: Setup) {
    return runStart(t, await admitted(t, { chatId: jid(OWNER_PHONE), body: "halo" }));
  }

  async function chatConversation(t: Setup, chatKey: string) {
    const rows = await db.select().from(chatConversations).where(eq(chatConversations.endpointId, t.endpointId));
    const row = rows.find((entry) => entry.externalConversationId.endsWith(":" + chatKey));
    expect(row).toBeDefined();
    return row!;
  }

  async function delegate(t: Setup, run: { runId: string; issueId: string }, title: string) {
    return issueService(db).create(t.companyId, {
      title,
      status: "todo",
      parentId: run.issueId,
      assigneeAgentId: t.arif,
      createdByAgentId: t.agentId,
      actorRunId: run.runId,
    });
  }

  async function createCard(t: Setup, issueId: string, input: Record<string, unknown> = {}) {
    return issueThreadInteractionService(db).create(
      { id: issueId, companyId: t.companyId },
      { kind: "request_confirmation", payload: { version: 1, prompt: "Proceed?" }, resolverPolicy: "human_only", ...input } as never,
      { agentId: t.arif } as never,
    );
  }

  async function cardActions(t: Setup) {
    return db
      .select()
      .from(chatActions)
      .where(and(eq(chatActions.endpointId, t.endpointId), eq(chatActions.kind, OPENWA_PENDING_CARD_ACTION_KIND)))
      .orderBy(asc(chatActions.createdAt));
  }

  function routeOf(action: typeof chatActions.$inferSelect, cardId: string) {
    return ((action.payload.openwa as Record<string, unknown>).cardRoutes as Record<string, unknown>)[cardId];
  }

  async function routeProjectToBotGroup(t: Setup) {
    const ownerRun = await runStart(t, await admitted(t, mention(BOT_GROUP, OWNER_PHONE, "laporan grup Tim DCM ke grup ini ya")));
    await executeOpenwaTool(db, { companyId: t.companyId, agentId: t.agentId, runId: ownerRun.runId, issueId: ownerRun.issueId }, "openwa_endpoint_config", {
      chat: PROJECT,
      chatSettings: { ownerReportChat: BOT_GROUP },
    });
    return ownerRun;
  }

  async function ownerActivity(t: Setup, input: Parameters<FakeOpenwaGateway["inbound"]>[0]) {
    const before = { ...t.service.openwaAdmissionStats };
    const rows = (await deliveries(t)).length;
    t.gateway.inbound(input);
    await until(() => t.service.openwaAdmissionStats.ownerActivity > before.ownerActivity || t.service.openwaAdmissionStats.admitted > before.admitted);
    return { admitted: t.service.openwaAdmissionStats.admitted - before.admitted, lookups: t.service.openwaAdmissionStats.cardAnswerLookups - before.cardAnswerLookups, newDeliveries: (await deliveries(t)).length - rows };
  }

  it("(1, 4) sends a card on a subtask to the owner's private group the parent task was asked for in", async () => {
    const t = await setup();
    const dm = await ownerDm(t);
    const groupRun = await runStart(t, await admitted(t, mention(BOT_GROUP, OWNER_PHONE, "tolong buatkan task invoice")));
    const task = await delegate(t, groupRun, "Fix invoice 42");
    const subtask = await issueService(db).create(t.companyId, { title: "Check the tax rounding", status: "todo", parentId: task.id, assigneeAgentId: t.arif, createdByAgentId: t.arif });
    const card = await createCard(t, subtask.id);
    const [action, ...rest] = await cardActions(t);
    expect(rest).toEqual([]);
    const group = await chatConversation(t, BOT_GROUP);
    expect(action).toMatchObject({ conversationId: group.id, payload: { issueId: groupRun.issueId, chatKey: BOT_GROUP } });
    expect(action!.conversationId).not.toBe((await chatConversation(t, jid(OWNER_PHONE))).id);
    const [conversationIssue] = await db.select({ identifier: issues.identifier }).from(issues).where(eq(issues.id, groupRun.issueId));
    expect(routeOf(action!, card.id)).toEqual({
      route: "origin_group",
      viaOwnerReport: false,
      sentTo: { chat: "[BOT] DCM Wardmote", kind: "group" },
      origin: expect.objectContaining({ chat: "[BOT] DCM Wardmote", kind: "group", conversation: conversationIssue!.identifier, requester: "owner" }),
    });
    expect(JSON.stringify(routeOf(action!, card.id))).not.toContain(OWNER_PHONE);
    expect(dm.issueId).not.toBe(groupRun.issueId);
  }, 180_000);

  it("(4) withholds an origin_group card when the group gains another member before the wake", async () => {
    const t = await setup();
    const groupRun = await runStart(t, await admitted(t, mention(BOT_GROUP, OWNER_PHONE, "tolong buatkan task invoice")));
    await createCard(t, (await delegate(t, groupRun, "Fix invoice 42")).id);
    const [action] = await cardActions(t);
    expect(action!.conversationId).toBe((await chatConversation(t, BOT_GROUP)).id);
    await db
      .update(chatEndpointResources)
      .set({ metadata: sql`${chatEndpointResources.metadata} || ${JSON.stringify({ participants: [jid(OWN_PHONE), jid(OWNER_PHONE), jid(MEMBER_A)], participantCount: 3 })}::jsonb` })
      .where(and(eq(chatEndpointResources.endpointId, t.endpointId), sql`${chatEndpointResources.metadata}->>'chatKey' = ${BOT_GROUP}`));
    await db.update(chatActions).set({ result: { retryAt: new Date(Date.now() - 1000).toISOString() } }).where(eq(chatActions.id, action!.id));
    expect(await t.service.processPendingOpenwaPendingCards()).toBe(0);
    const [settled] = await cardActions(t);
    expect(settled).toMatchObject({ status: "processed", result: expect.objectContaining({ code: "openwa_pending_card_unreadable" }) });
    expect(t.wakes.has(action!.id)).toBe(false);
  }, 180_000);

  it("(2) sends a card from a crowded project group to that group's Report to owner via group, with its origin in the wake", async () => {
    const t = await setup();
    await ownerDm(t);
    await routeProjectToBotGroup(t);
    const projectRun = await runStart(t, await admitted(t, mention(PROJECT, OWNER_PHONE, "buatkan task rekap invoice")));
    const task = await delegate(t, projectRun, "Recap invoices");
    const card = await createCard(t, task.id);
    const [action, ...rest] = await cardActions(t);
    expect(rest).toEqual([]);
    expect(action!.conversationId).toBe((await chatConversation(t, BOT_GROUP)).id);
    expect(routeOf(action!, card.id)).toMatchObject({
      route: "owner_report",
      viaOwnerReport: true,
      sentTo: { chat: "[BOT] DCM Wardmote", kind: "group" },
      origin: { chat: "Tim DCM", kind: "group", requester: "owner" },
    });

    await db.update(chatActions).set({ result: { retryAt: new Date(Date.now() - 1000).toISOString() } }).where(eq(chatActions.id, action!.id));
    expect(await t.service.processPendingOpenwaPendingCards()).toBe(1);
    const wake = await wakeFor(t, action!.id);
    const issueId = String(wake.wake.contextSnapshot!.issueId);
    const runId = randomUUID();
    const contextSnapshot: Record<string, unknown> = { ...wake.wake.contextSnapshot };
    await db.insert(heartbeatRuns).values({ id: runId, companyId: t.companyId, agentId: t.agentId, status: "running", wakeupRequestId: wake.request.id, startedAt: new Date(), contextSnapshot });
    const openwa = await resolveOpenwaRunContext(db, { companyId: t.companyId, issueId, runId, contextSnapshot, wakeupRequestId: wake.request.id });
    const guidance = await buildOpenwaRunGuidance(db, { companyId: t.companyId, issueId, runId, wakeupRequestId: wake.request.id, openwa: openwa!, contextSnapshot });
    const cards = guidance!.wakeEvent.pendingCards ?? [];
    expect(cards.map((entry) => entry.interactionId)).toEqual([card.id]);
    expect(cards[0]!.route).toMatchObject({ route: "owner_report", viaOwnerReport: true, origin: { chat: "Tim DCM" } });
  }, 180_000);

  it("(3) sends a card asked for in the owner's DM back to that DM", async () => {
    const t = await setup();
    const dm = await ownerDm(t);
    await runStart(t, await admitted(t, mention(BOT_GROUP, OWNER_PHONE, "halo grup")));
    const task = await delegate(t, dm, "Book the venue");
    const card = await createCard(t, task.id);
    const [action] = await cardActions(t);
    expect(action!.conversationId).toBe((await chatConversation(t, jid(OWNER_PHONE))).id);
    expect(routeOf(action!, card.id)).toMatchObject({ route: "origin_dm", viaOwnerReport: false, sentTo: { chat: "Owner DM", kind: "dm" }, origin: { kind: "dm", chat: "WhatsApp DM" } });
  }, 180_000);

  it("(5) keeps a card from a crowded group without Report to owner via in the owner DM", async () => {
    const t = await setup();
    const dm = await ownerDm(t);
    const projectRun = await runStart(t, await admitted(t, mention(PROJECT, OWNER_PHONE, "buatkan task rekap")));
    const task = await delegate(t, projectRun, "Recap");
    const card = await createCard(t, task.id);
    const [action, ...rest] = await cardActions(t);
    expect(rest).toEqual([]);
    expect(action!.conversationId).toBe((await chatConversation(t, jid(OWNER_PHONE))).id);
    expect(action!.conversationId).not.toBe((await chatConversation(t, PROJECT)).id);
    expect(routeOf(action!, card.id)).toMatchObject({ route: "owner_dm", sentTo: { chat: "Owner DM", kind: "dm" }, origin: { chat: "Tim DCM", kind: "group" } });
    expect(dm.issueId).toBe(action!.payload.issueId);
  }, 180_000);

  it("(6) falls back to the DM when the Report to owner via group has no open conversation", async () => {
    const t = await setup();
    await ownerDm(t);
    await routeProjectToBotGroup(t);
    await db.update(chatConversations).set({ state: "completed" }).where(eq(chatConversations.id, (await chatConversation(t, BOT_GROUP)).id));
    const projectRun = await runStart(t, await admitted(t, mention(PROJECT, OWNER_PHONE, "buatkan task rekap")));
    const card = await createCard(t, (await delegate(t, projectRun, "Recap")).id);
    const [action] = await cardActions(t);
    expect(action!.conversationId).toBe((await chatConversation(t, jid(OWNER_PHONE))).id);
    expect(routeOf(action!, card.id)).toMatchObject({ route: "owner_dm", viaOwnerReport: false });
  }, 180_000);

  it("(6) treats a group whose participant list is unknown as crowded", async () => {
    const t = await setup();
    await ownerDm(t);
    const groupRun = await runStart(t, await admitted(t, mention(BOT_GROUP, OWNER_PHONE, "buatkan task")));
    await db
      .update(chatEndpointResources)
      .set({ metadata: sql`${chatEndpointResources.metadata} - 'participants'` })
      .where(and(eq(chatEndpointResources.endpointId, t.endpointId), sql`${chatEndpointResources.metadata}->>'chatKey' = ${BOT_GROUP}`));
    const card = await createCard(t, (await delegate(t, groupRun, "Task")).id);
    const [action] = await cardActions(t);
    expect(action!.conversationId).toBe((await chatConversation(t, jid(OWNER_PHONE))).id);
    expect(routeOf(action!, card.id)).toMatchObject({ route: "owner_dm" });
  }, 180_000);

  it("(addressee) sends a card addressed to an owner who is not in the group to that owner's DM", async () => {
    const t = await setup();
    const secondUser = await linkUser(t.companyId, "Second owner");
    const added = await t.service.openwa.addOwner(t.endpointId, { e164: "+" + SECOND_PHONE, expiresInSeconds: 1_800 }, t.userId);
    await t.service.confirmIdentityLink(new URL(added.confirmationUrl!, "https://wardmote.example").searchParams.get("token")!, secondUser);
    await runStart(t, await admitted(t, { chatId: jid(SECOND_PHONE), body: "halo" }));
    const groupRun = await runStart(t, await admitted(t, mention(BOT_GROUP, OWNER_PHONE, "buatkan task")));
    const card = await createCard(t, (await delegate(t, groupRun, "Task")).id, { addresseeUserId: secondUser });
    const [action, ...rest] = await cardActions(t);
    expect(rest).toEqual([]);
    expect(action!.conversationId).toBe((await chatConversation(t, jid(SECOND_PHONE))).id);
    expect(routeOf(action!, card.id)).toMatchObject({ route: "owner_dm" });
  }, 180_000);

  it("never sends a private task's card to the group when its owners cannot read it", async () => {
    const t = await setup();
    const groupRun = await runStart(t, await admitted(t, mention(BOT_GROUP, OWNER_PHONE, "buatkan task")));
    const id = randomUUID();
    await db.insert(issues).values({ id, companyId: t.companyId, title: "Secret", status: "in_progress", assigneeAgentId: t.arif, parentId: groupRun.issueId, visibility: "private", identifier: "K-" + id.replaceAll("-", "") });
    await createCard(t, id);
    expect(await cardActions(t)).toEqual([]);
  }, 180_000);

  it("(answer) the owner's plain yes in the group the card went to wakes an owner run that may relay it", async () => {
    const t = await setup();
    const groupRun = await runStart(t, await admitted(t, mention(BOT_GROUP, OWNER_PHONE, "buatkan task")));
    const before = await ownerActivity(t, { chatId: BOT_GROUP, author: jid(OWNER_PHONE), body: "ya lanjut" });
    expect(before).toMatchObject({ admitted: 0, lookups: 1, newDeliveries: 0 });
    const card = await createCard(t, (await delegate(t, groupRun, "Task")).id);
    expect((await cardActions(t))[0]!.conversationId).toBe((await chatConversation(t, BOT_GROUP)).id);
    const chatter = await ownerActivity(t, { chatId: BOT_GROUP, author: jid(OWNER_PHONE), body: "nanti aku cek dulu" });
    expect(chatter).toMatchObject({ admitted: 0, lookups: 0 });
    const reply = await admitted(t, { chatId: BOT_GROUP, author: jid(OWNER_PHONE), body: "ya lanjut" });
    const openwa = reply.delivery.normalizedEvent.openwa as Record<string, unknown>;
    expect(openwa).toMatchObject({ triggerClass: "owner", rules: ["owner_card_answer"] });
    const run = await runStart(t, reply);
    expect(run.issueId).toBe(groupRun.issueId);
    const authority = await resolveOwnerRelayAuthority(db, { companyId: t.companyId, agentId: t.agentId, runId: run.runId, ownerMessageRef: String(openwa.waMessageId) });
    expect(authority).toMatchObject({ channel: "whatsapp", ownerUserId: t.userId, ownerText: "ya lanjut" });
    await db.update(issueThreadInteractions).set({ status: "accepted" }).where(eq(issueThreadInteractions.id, card.id));
    const after = await ownerActivity(t, { chatId: BOT_GROUP, author: jid(OWNER_PHONE), body: "ya" });
    expect(after).toMatchObject({ admitted: 0, lookups: 1 });
  }, 180_000);
});
