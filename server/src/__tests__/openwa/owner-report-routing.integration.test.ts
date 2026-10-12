import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  agents,
  agentWakeupRequests,
  authUsers,
  chatActions,
  chatAuditEntries,
  chatDeliveries,
  chatEndpointResources,
  chatEndpoints,
  chatOutboundMessages,
  chatOwnerApprovalBubbles,
  chatOwnerApprovalRequests,
  chatScheduledWakes,
  companies,
  companyMemberships,
  companySecretBindings,
  createDb,
  heartbeatRuns,
  toolConnections,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import { startEmbeddedPostgresTestDatabase } from "../helpers/embedded-postgres.js";
import { createLocalDiskStorageProvider } from "../../storage/local-disk-provider.js";
import { createStorageService } from "../../storage/service.js";
import { chatChannelService, type ChatChannelService, type ChatChannelServiceOptions } from "../../services/chat-channels.js";
import { ChatSdkRuntime } from "../../services/chat-sdk-runtime.js";
import { instanceSettingsService } from "../../services/instance-settings.js";
import { secretService } from "../../services/secrets.js";
import { HttpError } from "../../errors.js";
import { applyOpenwaRunContext, assertOpenwaRunMay, resolveOpenwaRunContext, type OpenwaRunContext } from "../../services/openwa/authority.js";
import { buildOpenwaRunGuidance } from "../../services/openwa/guidance.js";
import type { OpenwaScheduledWakeClock } from "../../services/openwa/scheduled-wakes.js";
import { executeOpenwaTool, type OpenwaToolBinding } from "../../services/openwa/tools.js";
import { FAKE_OPENWA_KEY, FakeOpenwaGateway } from "./fake-gateway.js";

const SESSION_ID = "51111111-2222-4333-8444-555555555555";
const OWN_PHONE = "628111000511";
const OWNER_PHONE = "628333000511";
const MEMBER_A = "628666000511";
const PROJECT = "120363000000000511@g.us";
const BOT_GROUP = "120363000000000512@g.us";
const NO_OWNER = "120363000000000513@g.us";
const jid = (phone: string) => phone + "@c.us";

type WakeupOptions = Parameters<ChatChannelServiceOptions["heartbeat"]["wakeup"]>[1];

async function until(predicate: () => boolean | Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function failure(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpError) return error;
    throw error;
  }
  throw new Error("expected an HTTP error");
}

class FakeClock implements OpenwaScheduledWakeClock {
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
  advanceTo(at: number) {
    this.time = Math.max(this.time, at);
    for (const [id, timer] of [...this.timers]) {
      if (timer.at > this.time) continue;
      this.timers.delete(id);
      timer.fire();
    }
  }
}

describe("OpenWA owner report routing (embedded Postgres + fake gateway)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let scratch: string;
  const oldKey = process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
  const services: ChatChannelService[] = [];
  const gateways: FakeOpenwaGateway[] = [];
  const endpointIds: string[] = [];

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-openwa-owner-report-");
    db = createDb(database.connectionString);
    scratch = await mkdtemp(path.join(tmpdir(), "openwa-owner-report-"));
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

  async function linkUser(companyId: string, name: string) {
    const userId = randomUUID();
    await db.insert(authUsers).values({ id: userId, name, email: userId + "@example.com", emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "operator" });
    return userId;
  }

  async function setup() {
    const clock = new FakeClock();
    const gateway = new FakeOpenwaGateway({ sessionId: SESSION_ID, ownPhone: OWN_PHONE });
    await gateway.start();
    gateways.push(gateway);
    gateway.groups.set(PROJECT, { id: PROJECT, name: "Tim DCM", participants: [{ id: jid(OWN_PHONE) }, { id: jid(OWNER_PHONE) }, { id: jid(MEMBER_A) }] });
    gateway.groups.set(BOT_GROUP, { id: BOT_GROUP, name: "[BOT] DCM Paperclip", participants: [{ id: jid(OWN_PHONE) }, { id: jid(OWNER_PHONE) }] });
    gateway.groups.set(NO_OWNER, { id: NO_OWNER, name: "Vendor chat", participants: [{ id: jid(OWN_PHONE) }, { id: jid(MEMBER_A) }] });
    const companyId = randomUUID();
    const agentId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "OpenWA owner reports",
      issuePrefix: "R" + companyId.replaceAll("-", "").slice(0, 7).toUpperCase(),
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Wira",
      role: "engineer",
      status: "idle",
      adapterType: "paperclip_runner",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
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
      publicBaseUrl: "https://paperclip.example",
      heartbeat: { wakeup } as never,
      storage: createStorageService(createLocalDiskStorageProvider(path.join(scratch, "storage"))),
      scheduleDeferredWork: () => {},
      openwaBurstWindowMs: 0,
      openwaScheduledWakeClock: clock,
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
        policy: {},
        setup: { step: "complete", testStartedAt: new Date(Date.now() - 60_000).toISOString() },
      })
      .where(eq(chatEndpoints.id, endpoint.id));
    const added = await service.openwa.addOwner(endpoint.id, { e164: "+" + OWNER_PHONE, expiresInSeconds: 1_800 }, userId);
    const token = new URL(added.confirmationUrl!, "https://paperclip.example").searchParams.get("token")!;
    await service.confirmIdentityLink(token, userId);
    await service.openwa.addSenderRule(endpoint.id, { list: "allow", e164: "+" + MEMBER_A }, userId);
    expect((await service.reconcileProviderRuntimes()).local).toBe(1);
    await gateway.waitForSubscription();
    const t = { gateway, clock, companyId, agentId, userId, endpointId: endpoint.id, service, wakes };
    const before = service.openwaAdmissionStats.discoveries;
    const warmAt = Math.floor(Date.now() / 1000) - 600;
    for (const [chatId, author] of [[PROJECT, MEMBER_A], [BOT_GROUP, OWNER_PHONE], [NO_OWNER, MEMBER_A]] as const)
      gateway.inbound({ chatId, author: jid(author), body: "warm up", timestamp: warmAt, store: false });
    await until(() => service.openwaAdmissionStats.discoveries >= before + 3);
    await until(async () => (await resources(t)).length >= 3);
    return t;
  }

  type Setup = Awaited<ReturnType<typeof setup>>;

  async function resources(t: Pick<Setup, "endpointId">) {
    return db.select().from(chatEndpointResources).where(and(eq(chatEndpointResources.endpointId, t.endpointId), eq(chatEndpointResources.type, "group_chat")));
  }

  async function deliveries(t: Setup) {
    return db
      .select()
      .from(chatDeliveries)
      .where(and(eq(chatDeliveries.companyId, t.companyId), eq(chatDeliveries.endpointId, t.endpointId)))
      .orderBy(asc(chatDeliveries.createdAt));
  }

  async function wakeFor(t: Setup, deliveryId: string) {
    const [action] = await db
      .select()
      .from(chatActions)
      .where(and(eq(chatActions.deliveryId, deliveryId), eq(chatActions.kind, "inbound_wakeup")));
    await until(() => t.wakes.has(action!.id));
    const [request] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, action!.id));
    return { delivery: deliveryId, request: request!, wake: t.wakes.get(action!.id)! };
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
    return wakeFor(t, delivery.id);
  }

  type Wake = Awaited<ReturnType<typeof wakeFor>>;

  async function runStart(t: Setup, wake: Wake, authority: Partial<Pick<OpenwaRunContext, "grantIds" | "requesterPrincipalId" | "approvalRequestId">> = {}) {
    const runId = randomUUID();
    const issueId = String(wake.wake.contextSnapshot!.issueId);
    const openwaPayload = (wake.request.payload as { openwa: { triggerClass: string } }).openwa;
    const contextSnapshot: Record<string, unknown> = {
      ...wake.wake.contextSnapshot,
      paperclipOpenwa: { triggerClass: openwaPayload.triggerClass, ...authority },
    };
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
    const binding: OpenwaToolBinding = { companyId: t.companyId, agentId: t.agentId, runId, issueId };
    return { runId, issueId, openwa: openwa!, binding, run: { id: runId, companyId: t.companyId, contextSnapshot }, wakeupRequestId: wake.request.id };
  }

  const mention = (chatId: string, phone: string, body: string) => ({ chatId, author: jid(phone), body: "@" + OWN_PHONE + " " + body, extra: { mentionedIds: [jid(OWN_PHONE)] } });

  async function requestApproval(binding: OpenwaToolBinding, input: { categories?: string[]; message?: string } = {}) {
    return executeOpenwaTool(db, binding, "openwa_request_approval", {
      categories: input.categories ?? ["create_task"],
      scope: "one_action",
      summary: "Create a task for the DCM invoice bug",
      proposedAction: "Create a child issue that fixes invoice 42",
      messageToOwners: input.message ?? "Member asks to create a task for invoice 42. Approve?",
      idempotencyKey: randomUUID(),
    }) as Promise<{ requestId: string; bubbles: Array<{ chatRef: string; messageId: string | null; state: string }> }>;
  }

  async function bubbleChats(requestId: string) {
    const rows = await db.select().from(chatOwnerApprovalBubbles).where(eq(chatOwnerApprovalBubbles.requestId, requestId));
    if (!rows.length) return [];
    const sends = await db.select().from(chatOutboundMessages).where(inArray(chatOutboundMessages.id, rows.map((row) => row.outboundMessageId)));
    return sends.map((send) => ({ chatKey: send.chatKey, messageId: send.providerMessageId! }));
  }

  async function fallbackAudits(t: Setup) {
    return db
      .select()
      .from(chatAuditEntries)
      .where(and(eq(chatAuditEntries.endpointId, t.endpointId), eq(chatAuditEntries.kind, "owner_report_fallback")));
  }

  async function routeProjectToBotGroup(t: Setup) {
    const ownerWake = await admitted(t, mention(BOT_GROUP, OWNER_PHONE, "laporan grup Tim DCM ke grup ini ya"));
    const ownerRun = await runStart(t, ownerWake);
    expect(ownerRun.openwa.triggerClass).toBe("owner");
    const result = (await executeOpenwaTool(db, ownerRun.binding, "openwa_endpoint_config", {
      chat: PROJECT,
      chatSettings: { ownerReportChat: BOT_GROUP },
    })) as { chat: { settings: { ownerReportChatKey?: string }; ownerReportChat: { label: string | null } | null } };
    expect(result.chat.settings.ownerReportChatKey).toBe(BOT_GROUP);
    expect(result.chat.ownerReportChat).toMatchObject({ label: "[BOT] DCM Paperclip" });
    return ownerRun;
  }

  it("(a, b) routes a project group's approval bubble to its owner report group and resolves it from the owner's reply there", async () => {
    const t = await setup();
    await routeProjectToBotGroup(t);
    const memberWake = await admitted(t, mention(PROJECT, MEMBER_A, "tolong buatkan task untuk invoice 42"));
    const memberRun = await runStart(t, memberWake);
    expect(memberRun.openwa).toMatchObject({ triggerClass: "other", profile: "read_only" });
    const guidance = await buildOpenwaRunGuidance(db, {
      companyId: t.companyId,
      issueId: memberRun.issueId,
      runId: memberRun.runId,
      wakeupRequestId: memberRun.wakeupRequestId,
      openwa: memberRun.openwa,
      contextSnapshot: memberRun.run.contextSnapshot,
    });
    expect(guidance!.markdown).toContain("Owner reports for this chat go to the group \"[BOT] DCM Paperclip\"");
    expect(guidance!.markdown).toContain("Never ask for owner approval by writing in a group");

    const sendsBefore = t.gateway.sends.length;
    const created = await requestApproval(memberRun.binding);
    const newSends = t.gateway.sends.slice(sendsBefore);
    expect(newSends.map((send) => send.chatId)).toEqual([BOT_GROUP]);
    expect(newSends[0]!.text).toContain("Member asks to create a task for invoice 42");
    expect(t.gateway.sends.some((send) => send.chatId === jid(OWNER_PHONE))).toBe(false);
    const [bubble] = await bubbleChats(created.requestId);
    expect(bubble).toEqual({ chatKey: BOT_GROUP, messageId: newSends[0]!.messageId });
    expect(created.bubbles).toEqual([expect.objectContaining({ state: "sent", chatRef: "openwa:" + SESSION_ID + ":" + BOT_GROUP })]);

    const reply = await admitted(t, { chatId: BOT_GROUP, author: jid(OWNER_PHONE), body: "ok", extra: { quotedMessage: { id: bubble!.messageId, body: newSends[0]!.text } } });
    expect(reply.request.payload).toMatchObject({ openwa: { event: "approval_reply", triggerClass: "owner", approvalRequestId: created.requestId, requestStatus: "pending" } });
    const replyRun = await runStart(t, reply);
    const resolved = (await executeOpenwaTool(db, replyRun.binding, "openwa_approval_resolve", { requestId: created.requestId, decision: "approve" })) as {
      status: string;
      grantIds: string[];
    };
    expect(resolved.status).toBe("approved");
    const [request] = await db.select().from(chatOwnerApprovalRequests).where(eq(chatOwnerApprovalRequests.id, created.requestId));
    expect(request).toMatchObject({ status: "approved", resolvedVia: "whatsapp", originChatKey: PROJECT, ownerText: "ok" });

    const [grantAction] = await db
      .select()
      .from(chatActions)
      .where(and(eq(chatActions.endpointId, t.endpointId), eq(chatActions.providerActionId, "openwa-approval-resolved:" + created.requestId)));
    await until(() => t.wakes.has(grantAction!.id));
    const [grantRequest] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, grantAction!.id));
    const grantWake = { delivery: "", request: grantRequest!, wake: t.wakes.get(grantAction!.id)! };
    expect(grantWake.wake.contextSnapshot).toMatchObject({ issueId: memberRun.issueId });
    const grantRun = await runStart(t, grantWake, { grantIds: resolved.grantIds, requesterPrincipalId: request!.requestedByPrincipalId, approvalRequestId: created.requestId });
    expect(await assertOpenwaRunMay(db, grantRun.run, "create_task")).toBe(resolved.grantIds[0]);
    await executeOpenwaTool(db, grantRun.binding, "openwa_send", { text: "Task sudah dibuat", idempotencyKey: randomUUID() });
    expect(t.gateway.sends.at(-1)).toMatchObject({ chatId: PROJECT, text: "Task sudah dibuat" });

    const second = await requestApproval((await runStart(t, memberWake)).binding, { categories: ["external_tools"], message: "Second request" });
    expect(t.gateway.sends.at(-1)!.chatId).toBe(BOT_GROUP);
    const unquoted = await admitted(t, { chatId: BOT_GROUP, author: jid(OWNER_PHONE), body: "ya boleh" });
    expect(unquoted.request.payload).toMatchObject({ openwa: { event: "approval_reply", triggerClass: "owner", approvalRequestId: second.requestId } });
    const unquotedRun = await runStart(t, unquoted);
    await executeOpenwaTool(db, unquotedRun.binding, "openwa_approval_resolve", { requestId: second.requestId, decision: "approve" });
    expect((await db.select().from(chatOwnerApprovalRequests).where(eq(chatOwnerApprovalRequests.id, second.requestId)))[0]!.status).toBe("approved");

    const chatter = await admitted(t, mention(BOT_GROUP, OWNER_PHONE, "ok cek server"));
    expect(chatter.request.payload).toMatchObject({ openwa: { event: "message", triggerClass: "owner" } });
    expect(await fallbackAudits(t)).toEqual([]);
  }, 180_000);

  it("(c) sends an owner_absent question from the project group to the owner report group", async () => {
    const t = await setup();
    await routeProjectToBotGroup(t);
    const ts = Math.floor(t.clock.now() / 1000);
    t.gateway.inbound({ chatId: PROJECT, author: jid(MEMBER_A), body: "@" + OWNER_PHONE + " invoice 42 boleh direvisi?", timestamp: ts, extra: { mentionedIds: [jid(OWNER_PHONE)] } });
    await until(async () => (await db.select().from(chatScheduledWakes).where(and(eq(chatScheduledWakes.endpointId, t.endpointId), eq(chatScheduledWakes.kind, "owner_absent")))).length === 1);
    const [armed] = await db.select().from(chatScheduledWakes).where(and(eq(chatScheduledWakes.endpointId, t.endpointId), eq(chatScheduledWakes.kind, "owner_absent")));
    expect(armed).toMatchObject({ chatKey: PROJECT, state: "pending" });
    t.clock.advanceTo(armed!.fireAt.getTime());
    let delivery: typeof chatDeliveries.$inferSelect | undefined;
    let swept = Date.now();
    await until(async () => {
      if (Date.now() - swept > 1_000) {
        swept = Date.now();
        await t.service.processPendingDeliveries();
      }
      delivery = (await deliveries(t)).find(
        (row) => row.state === "processed" && (row.normalizedEvent as { openwa?: { event?: string } }).openwa?.event === "owner_absent",
      );
      return Boolean(delivery);
    }, 30_000);
    const absentWake = await wakeFor(t, delivery!.id);
    expect(absentWake.request.payload).toMatchObject({ openwa: { event: "owner_absent", triggerClass: "other" } });
    const absentRun = await runStart(t, absentWake);
    const sendsBefore = t.gateway.sends.length;
    const asked = await requestApproval(absentRun.binding, { categories: ["reply"], message: "Member asks whether invoice 42 may be revised. Suggested reply: yes. Approve?" });
    expect(t.gateway.sends.slice(sendsBefore).map((send) => send.chatId)).toEqual([BOT_GROUP]);
    expect((await bubbleChats(asked.requestId)).map((bubble) => bubble.chatKey)).toEqual([BOT_GROUP]);
  }, 180_000);

  it("routes an owner run's openwa_send to an owner's number to the owner report group", async () => {
    const t = await setup();
    await routeProjectToBotGroup(t);
    const ownerWake = await admitted(t, mention(PROJECT, OWNER_PHONE, "kabari aku kalau sudah beres"));
    const ownerRun = await runStart(t, ownerWake);
    const sent = (await executeOpenwaTool(db, ownerRun.binding, "openwa_send", { chat: "+" + OWNER_PHONE, text: "Laporan: invoice 42 beres", idempotencyKey: randomUUID() })) as {
      chatRef: string;
      ownerReportChat?: boolean;
    };
    expect(sent).toMatchObject({ chatRef: "openwa:" + SESSION_ID + ":" + BOT_GROUP, ownerReportChat: true });
    expect(t.gateway.sends.at(-1)).toMatchObject({ chatId: BOT_GROUP, text: "Laporan: invoice 42 beres" });
    expect(t.gateway.sends.some((send) => send.chatId === jid(OWNER_PHONE))).toBe(false);
  }, 180_000);

  it("(e) keeps today's direct-chat bubble and owner sends for a chat without an owner report group", async () => {
    const t = await setup();
    const memberWake = await admitted(t, mention(PROJECT, MEMBER_A, "tolong buatkan task untuk invoice 42"));
    const memberRun = await runStart(t, memberWake);
    const sendsBefore = t.gateway.sends.length;
    const created = await requestApproval(memberRun.binding);
    expect(t.gateway.sends.slice(sendsBefore).map((send) => send.chatId)).toEqual([jid(OWNER_PHONE)]);
    expect((await bubbleChats(created.requestId)).map((bubble) => bubble.chatKey)).toEqual([jid(OWNER_PHONE)]);
    const ownerRun = await runStart(t, await admitted(t, mention(PROJECT, OWNER_PHONE, "laporkan ke aku")));
    await executeOpenwaTool(db, ownerRun.binding, "openwa_send", { chat: "+" + OWNER_PHONE, text: "Laporan langsung", idempotencyKey: randomUUID() });
    expect(t.gateway.sends.at(-1)).toMatchObject({ chatId: jid(OWNER_PHONE), text: "Laporan langsung" });
    const stats = t.service.openwaAdmissionStats;
    const [activityBefore, repliesBefore, deliveriesBefore] = [stats.ownerActivity + stats.discarded, stats.approvalReplies, (await deliveries(t)).length];
    t.gateway.inbound({ chatId: BOT_GROUP, author: jid(OWNER_PHONE), body: "ok" });
    await until(() => stats.ownerActivity + stats.discarded > activityBefore);
    expect(stats.approvalReplies).toBe(repliesBefore);
    expect((await deliveries(t)).length).toBe(deliveriesBefore);
    expect(await fallbackAudits(t)).toEqual([]);
  }, 180_000);

  it("(f) refuses an owner report group without an owner, the chat itself or a direct chat at save", async () => {
    const t = await setup();
    const noOwner = await failure(
      t.service.openwa.putChat(t.endpointId, { chatId: PROJECT, settings: { activation: "auto", ownerReportChatKey: NO_OWNER } }, t.userId),
    );
    expect(noOwner.status).toBe(422);
    expect(noOwner.message).toContain("No owner is a member of that group");
    expect(noOwner.details).toMatchObject({ code: "openwa_owner_report_chat_invalid", reason: "owner_absent" });
    const self = await failure(t.service.openwa.putChat(t.endpointId, { chatId: PROJECT, settings: { activation: "auto", ownerReportChatKey: PROJECT } }, t.userId));
    expect(self.details).toMatchObject({ reason: "self" });
    const unknown = await failure(
      t.service.openwa.putChat(t.endpointId, { chatId: PROJECT, settings: { activation: "auto", ownerReportChatKey: "120363000000000599@g.us" } }, t.userId),
    );
    expect(unknown.details).toMatchObject({ reason: "missing" });
    const ownerRun = await runStart(t, await admitted(t, mention(BOT_GROUP, OWNER_PHONE, "laporan grup Tim DCM ke Vendor chat")));
    const viaTool = await failure(executeOpenwaTool(db, ownerRun.binding, "openwa_endpoint_config", { chat: PROJECT, chatSettings: { ownerReportChat: NO_OWNER } }));
    expect(viaTool.status).toBe(400);
    expect(viaTool.details).toMatchObject({ code: "openwa_owner_report_chat_invalid", reason: "owner_absent" });
    expect(viaTool.message).toContain("No owner is a member of that group");
    const direct = await failure(executeOpenwaTool(db, ownerRun.binding, "openwa_endpoint_config", { chat: PROJECT, chatSettings: { ownerReportChat: "+" + OWNER_PHONE } }));
    expect((direct.details as { code?: string }).code).toBe("invalid_arguments");
    const project = (await resources(t)).find((row) => row.label === "Tim DCM")!;
    expect((project.settings as { ownerReportChatKey?: string }).ownerReportChatKey).toBeUndefined();
    const saved = await t.service.openwa.putChat(t.endpointId, { chatId: PROJECT, settings: { activation: "auto", ownerReportChatKey: BOT_GROUP } }, t.userId);
    expect(saved.settings.ownerReportChatKey).toBe(BOT_GROUP);
  }, 180_000);

  it("(g) falls back to the owner's direct chat with an audit row when the owner report group is no longer usable", async () => {
    const t = await setup();
    await routeProjectToBotGroup(t);
    await db
      .update(chatEndpointResources)
      .set({ availability: "unavailable", enabled: false })
      .where(and(eq(chatEndpointResources.endpointId, t.endpointId), eq(chatEndpointResources.label, "[BOT] DCM Paperclip")));
    const memberRun = await runStart(t, await admitted(t, mention(PROJECT, MEMBER_A, "tolong buatkan task untuk invoice 42")));
    const sendsBefore = t.gateway.sends.length;
    const created = await requestApproval(memberRun.binding);
    expect(t.gateway.sends.slice(sendsBefore).map((send) => send.chatId)).toEqual([jid(OWNER_PHONE)]);
    expect((await bubbleChats(created.requestId)).map((bubble) => bubble.chatKey)).toEqual([jid(OWNER_PHONE)]);
    const audits = await fallbackAudits(t);
    expect(audits).toEqual([
      expect.objectContaining({
        chatKey: PROJECT,
        actorKind: "system",
        runId: memberRun.runId,
        metadata: expect.objectContaining({ destinationChatKey: BOT_GROUP, reason: "unavailable", source: "approval" }),
      }),
    ]);
  }, 180_000);
});
