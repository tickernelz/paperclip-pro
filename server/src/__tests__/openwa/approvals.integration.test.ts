import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import supertest from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  agents,
  agentWakeupRequests,
  authUsers,
  chatActions,
  chatAuditEntries,
  chatDeliveries,
  chatEndpoints,
  chatOutboundMessages,
  chatOwnerApprovalBubbles,
  chatOwnerApprovalRequests,
  chatOwnerGrants,
  chatPublications,
  chatScheduledWakes,
  companies,
  companyMemberships,
  companySecretBindings,
  createDb,
  heartbeatRuns,
  issueComments,
  issueThreadInteractions,
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
import { applyOpenwaRunContext, assertOpenwaRunMay, resolveOpenwaRunContext, restoreOpenwaGrant, type OpenwaRunContext } from "../../services/openwa/authority.js";
import { accessService } from "../../services/access.js";
import { openwaBodyHash } from "../../services/openwa/outbound.js";
import { executeOpenwaTool, type OpenwaToolBinding } from "../../services/openwa/tools.js";
import { issueRoutes } from "../../routes/issues.js";
import { chatChannelRoutes } from "../../routes/chat-channels.js";
import { errorHandler } from "../../middleware/index.js";
import { FAKE_OPENWA_KEY, FakeOpenwaGateway } from "./fake-gateway.js";

const SESSION_ID = "41111111-2222-4333-8444-555555555555";
const OWN_PHONE = "628111000411";
const OWNER_PHONE = "628333000411";
const OWNER2_PHONE = "628333000412";
const MEMBER_A = "628666000411";
const MEMBER_B = "628666000412";
const GROUP = "120363000000000411@g.us";
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

function codeOf(error: HttpError): unknown {
  return (error.details as Record<string, unknown> | undefined)?.code;
}

describe.sequential("OpenWA owner approvals and grants (embedded Postgres + fake gateway)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let scratch: string;
  const oldKey = process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
  const services: ChatChannelService[] = [];
  const gateways: FakeOpenwaGateway[] = [];
  const endpointIds: string[] = [];

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-openwa-approvals-");
    db = createDb(database.connectionString);
    scratch = await mkdtemp(path.join(tmpdir(), "openwa-approvals-"));
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

  async function reminderStates(requestId: string) {
    const rows = await db
      .select({ kind: chatScheduledWakes.kind, state: chatScheduledWakes.state })
      .from(chatScheduledWakes)
      .where(eq(chatScheduledWakes.relatedId, requestId));
    return rows.map((row) => row.kind + ":" + row.state);
  }

  async function linkUser(companyId: string, name: string) {
    const userId = randomUUID();
    await db.insert(authUsers).values({ id: userId, name, email: userId + "@example.com", emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "operator" });
    return userId;
  }

  async function setup(input: { policy?: Record<string, unknown>; owners?: string[] } = {}) {
    const gateway = new FakeOpenwaGateway({ sessionId: SESSION_ID, ownPhone: OWN_PHONE });
    await gateway.start();
    gateways.push(gateway);
    const companyId = randomUUID();
    const agentId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "OpenWA approvals",
      issuePrefix: "A" + companyId.replaceAll("-", "").slice(0, 7).toUpperCase(),
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
        policy: input.policy ?? {},
        setup: { step: "complete", testStartedAt: new Date(Date.now() - 60_000).toISOString() },
      })
      .where(eq(chatEndpoints.id, endpoint.id));
    const ownerUsers: Record<string, string> = {};
    for (const [index, phone] of (input.owners ?? [OWNER_PHONE]).entries()) {
      const ownerUserId = index === 0 ? userId : await linkUser(companyId, "Owner " + index);
      const added = await service.openwa.addOwner(endpoint.id, { e164: "+" + phone, expiresInSeconds: 1_800 }, userId);
      const token = new URL(added.confirmationUrl!, "https://paperclip.example").searchParams.get("token")!;
      await service.confirmIdentityLink(token, ownerUserId);
      ownerUsers[phone] = ownerUserId;
    }
    for (const phone of [MEMBER_A, MEMBER_B]) await service.openwa.addSenderRule(endpoint.id, { list: "allow", e164: "+" + phone }, userId);
    expect((await service.reconcileProviderRuntimes()).local).toBe(1);
    await gateway.waitForSubscription();
    return { gateway, companyId, agentId, userId, ownerUsers, endpointId: endpoint.id, service, wakes, wakeup };
  }

  type Setup = Awaited<ReturnType<typeof setup>>;

  async function deliveries(t: Setup) {
    return db
      .select()
      .from(chatDeliveries)
      .where(and(eq(chatDeliveries.companyId, t.companyId), eq(chatDeliveries.endpointId, t.endpointId)))
      .orderBy(asc(chatDeliveries.createdAt));
  }

  async function admitted(t: Setup, input: Parameters<FakeOpenwaGateway["inbound"]>[0]) {
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
    const delivery = (await deliveries(t)).at(-1)!;
    expect(delivery.state).toBe("processed");
    const [action] = await db
      .select()
      .from(chatActions)
      .where(and(eq(chatActions.deliveryId, delivery.id), eq(chatActions.kind, "inbound_wakeup")));
    await until(() => t.wakes.has(action!.id));
    const [wakeRequest] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, action!.id));
    return { row, delivery, action: action!, request: wakeRequest!, wake: t.wakes.get(action!.id)! };
  }

  type Wake = { request: typeof agentWakeupRequests.$inferSelect; wake: WakeupOptions };

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
    const resolveInput = { companyId: t.companyId, issueId, contextSnapshot, wakeupRequestId: wake.request.id, runId };
    const openwa = await resolveOpenwaRunContext(db, resolveInput);
    expect(openwa).not.toBeNull();
    applyOpenwaRunContext(contextSnapshot, openwa);
    await db.update(heartbeatRuns).set({ contextSnapshot }).where(eq(heartbeatRuns.id, runId));
    const binding: OpenwaToolBinding = { companyId: t.companyId, agentId: t.agentId, runId, issueId };
    return { runId, issueId, openwa: openwa!, binding, run: { id: runId, companyId: t.companyId, contextSnapshot } };
  }

  function key() {
    return randomUUID();
  }

  async function requestApproval(
    binding: OpenwaToolBinding,
    input: { categories?: string[]; scope?: "one_action" | "requester"; message?: string } = {},
  ) {
    return executeOpenwaTool(db, binding, "openwa_request_approval", {
      categories: input.categories ?? ["create_task"],
      scope: input.scope ?? "one_action",
      summary: "Create a follow-up task for the invoice bug",
      proposedAction: "Create a child issue that fixes invoice 42",
      messageToOwners: input.message ?? "Member asks to create a task for invoice 42. Approve?",
      idempotencyKey: key(),
    }) as Promise<{ requestId: string; bubbles: Array<{ messageId: string | null; state: string }> }>;
  }

  async function approvalWake(t: Setup, requestId: string) {
    const [action] = await db
      .select()
      .from(chatActions)
      .where(and(eq(chatActions.endpointId, t.endpointId), eq(chatActions.providerActionId, "openwa-approval-resolved:" + requestId)));
    expect(action).toBeDefined();
    await until(() => t.wakes.has(action!.id));
    const [wakeRequest] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, action!.id));
    return { action: action!, request: wakeRequest!, wake: t.wakes.get(action!.id)! };
  }

  async function resolvedComment(action: { payload: unknown }) {
    const commentId = (action.payload as { commentId?: string }).commentId;
    expect(commentId).toBeTruthy();
    const [comment] = await db.select({ body: issueComments.body }).from(issueComments).where(eq(issueComments.id, commentId!));
    return comment!.body;
  }

  function boardActor(companyId: string, userId: string) {
    return {
      type: "board",
      source: "session",
      userId,
      companyIds: [companyId],
      memberships: [{ companyId, status: "active", membershipRole: "operator" }],
      isInstanceAdmin: false,
    };
  }

  function boardApp(companyId: string, userId: string) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { actor: unknown }).actor = boardActor(companyId, userId);
      next();
    });
    app.use("/api", issueRoutes(db, {} as never, {}));
    app.use(errorHandler);
    return app;
  }

  function channelApp(t: Setup, userId: string) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { actor: unknown }).actor = boardActor(t.companyId, userId);
      next();
    });
    app.use("/api", chatChannelRoutes(db, { heartbeat: { wakeup: async () => undefined } as never, service: t.service }));
    app.use(errorHandler);
    return app;
  }

  async function grantsOf(requestId: string) {
    return db.select().from(chatOwnerGrants).where(eq(chatOwnerGrants.requestId, requestId));
  }

  async function requestRow(requestId: string) {
    const [row] = await db.select().from(chatOwnerApprovalRequests).where(eq(chatOwnerApprovalRequests.id, requestId));
    return row!;
  }

  async function bubbleIds(requestId: string) {
    const rows = await db.select().from(chatOwnerApprovalBubbles).where(eq(chatOwnerApprovalBubbles.requestId, requestId));
    const sends = rows.length
      ? await db.select().from(chatOutboundMessages).where(inArray(chatOutboundMessages.id, rows.map((row) => row.outboundMessageId)))
      : [];
    return rows.map((row) => sends.find((send) => send.id === row.outboundMessageId)!.providerMessageId!);
  }

  it("AC6: WhatsApp approval end to end with every negative control", async () => {
    const t = await setup();
    const memberWake = await admitted(t, { chatId: jid(MEMBER_A), body: "tolong buatkan task untuk invoice 42" });
    expect(memberWake.delivery).toMatchObject({ triggerClass: "other", principalRole: "allowed" });
    const memberRun = await runStart(t, memberWake);
    expect(memberRun.openwa).toMatchObject({ triggerClass: "other", profile: "read_only", grantIds: [] });
    await expect(assertOpenwaRunMay(db, memberRun.run, "create_task")).rejects.toMatchObject({ status: 403 });

    const created = await requestApproval(memberRun.binding);
    const request = await requestRow(created.requestId);
    expect(request).toMatchObject({
      status: "pending",
      originChatKey: jid(MEMBER_A),
      requestedByPrincipalId: memberWake.delivery.principalId,
      requestedInRunId: memberRun.runId,
      categories: ["create_task"],
      scope: "one_action",
    });
    const [interaction] = await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.id, request.interactionId!));
    expect(interaction).toMatchObject({
      issueId: memberRun.issueId,
      kind: "request_confirmation",
      status: "pending",
      continuationPolicy: "none",
      effectiveResolverPolicy: "chat_endpoint_owner",
      payload: expect.objectContaining({ openwaApprovalRequestId: request.id }),
    });
    expect(await db.select().from(chatPublications).where(sql`${chatPublications.payload}->>'interactionId' = ${interaction!.id}`)).toEqual([]);
    const scheduled = await reminderStates(request.id);
    expect(scheduled.length).toBeGreaterThan(0);
    expect(new Set(scheduled)).toEqual(new Set(["approval_reminder:pending"]));
    const ownerSend = t.gateway.sends.find((send) => send.chatId === jid(OWNER_PHONE))!;
    expect(ownerSend.text).toContain("Member asks to create a task for invoice 42");
    const [bubbleId] = await bubbleIds(request.id);
    expect(bubbleId).toBe(ownerSend.messageId);
    expect(created.bubbles).toEqual([expect.objectContaining({ state: "sent", messageId: bubbleId })]);

    const memberQuote = await admitted(t, { chatId: jid(MEMBER_A), body: "boleh kan?", extra: { quotedMessage: { id: bubbleId, body: ownerSend.text } } });
    expect(memberQuote.request.payload).toMatchObject({ openwa: { event: "message", triggerClass: "other" } });
    expect((memberQuote.request.payload as { openwa: Record<string, unknown> }).openwa.approvalRequestId).toBeUndefined();

    const ownerPlain = await admitted(t, { chatId: jid(OWNER_PHONE), body: "boleh" });
    expect(ownerPlain.request.payload).toMatchObject({ openwa: { event: "message", triggerClass: "owner" } });
    const ownerPlainRun = await runStart(t, ownerPlain);
    expect(ownerPlainRun.openwa.triggerClass).toBe("owner");
    const plainDenied = await failure(executeOpenwaTool(db, ownerPlainRun.binding, "openwa_approval_resolve", { requestId: request.id, decision: "approve" }));
    expect(codeOf(plainDenied)).toBe("approval_not_authorized");
    const memberDenied = await failure(executeOpenwaTool(db, memberRun.binding, "openwa_approval_resolve", { requestId: request.id, decision: "approve" }));
    expect(codeOf(memberDenied)).toBe("approval_not_authorized");

    const ownerText = "boleh, tapi jangan sebut harga";
    const reply = await admitted(t, { chatId: jid(OWNER_PHONE), body: ownerText, extra: { quotedMessage: { id: bubbleId, body: ownerSend.text } } });
    expect(reply.delivery).toMatchObject({ triggerClass: "owner", principalRole: "owner" });
    expect(reply.request.payload).toMatchObject({
      openwa: { event: "approval_reply", triggerClass: "owner", deliveryIds: [reply.delivery.id], approvalRequestId: request.id, requestStatus: "pending" },
    });
    expect(reply.wake.allowRunCoalescing).toBe(false);
    const replyRun = await runStart(t, reply);
    expect(replyRun.openwa).toMatchObject({ triggerClass: "owner", profile: "full" });

    const clarify = await executeOpenwaTool(db, replyRun.binding, "openwa_approval_resolve", { requestId: request.id, decision: "clarify" });
    expect(clarify).toMatchObject({ status: "pending" });
    expect((await requestRow(request.id)).status).toBe("pending");

    const resolved = (await executeOpenwaTool(db, replyRun.binding, "openwa_approval_resolve", {
      requestId: request.id,
      decision: "approve",
      conditions: "Do not mention prices",
    })) as { status: string; grantIds: string[] };
    expect(resolved.status).toBe("approved");
    expect(await requestRow(request.id)).toMatchObject({
      status: "approved",
      resolvedVia: "whatsapp",
      resolvedByUserId: t.ownerUsers[OWNER_PHONE],
      ownerText,
      agentConditions: "Do not mention prices",
    });
    const grants = await grantsOf(request.id);
    expect(grants).toEqual([
      expect.objectContaining({
        id: resolved.grantIds[0],
        category: "create_task",
        scope: "one_action",
        status: "live",
        originChatKey: jid(MEMBER_A),
        requesterPrincipalId: memberWake.delivery.principalId,
        approvedVia: "whatsapp",
        approvedByUserId: t.ownerUsers[OWNER_PHONE],
      }),
    ]);
    expect((await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.id, interaction!.id)))[0]!.status).toBe("accepted");
    expect(await reminderStates(request.id)).toEqual(scheduled.map(() => "approval_reminder:cancelled"));

    const grantWake = await approvalWake(t, request.id);
    expect(grantWake.request.payload).toMatchObject({ openwa: { event: "approval_resolved", triggerClass: "grant", deliveryIds: [], approvalRequestId: request.id } });
    expect(await resolvedComment(grantWake.action)).toContain("Owner note: " + ownerText);
    expect(grantWake.wake.contextSnapshot).toMatchObject({ issueId: memberRun.issueId });
    expect(grantWake.wake.allowRunCoalescing).toBe(false);
    const grantRun = await runStart(t, grantWake, {
      grantIds: grants.map((grant) => grant.id),
      requesterPrincipalId: request.requestedByPrincipalId,
      approvalRequestId: request.id,
    });
    expect(grantRun.openwa).toMatchObject({ triggerClass: "grant", profile: "read_only", grantIds: [grants[0]!.id] });
    expect(await assertOpenwaRunMay(db, grantRun.run, "create_task")).toBe(grants[0]!.id);
    await expect(assertOpenwaRunMay(db, grantRun.run, "create_task")).rejects.toMatchObject({ status: 403 });
    const informed = await executeOpenwaTool(db, grantRun.binding, "openwa_send", { text: "Task sudah dibuat", idempotencyKey: key() });
    expect(informed).toMatchObject({ state: "delivered" });
    expect(t.gateway.sends.at(-1)).toMatchObject({ chatId: jid(MEMBER_A), text: "Task sudah dibuat" });

    const deliveriesBefore = (await deliveries(t)).length;
    t.gateway.emit("message.received", {
      id: reply.row.waMessageId,
      chatId: jid(OWNER_PHONE),
      from: jid(OWNER_PHONE),
      to: jid(OWN_PHONE),
      body: ownerText,
      type: "text",
      timestamp: reply.row.timestamp,
      fromMe: false,
      isGroup: false,
      kind: "individual",
      quotedMessage: { id: bubbleId, body: ownerSend.text },
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await t.service.processPendingDeliveries();
    expect((await deliveries(t)).length).toBe(deliveriesBefore);

    const late = await admitted(t, { chatId: jid(OWNER_PHONE), body: "ok setuju juga", extra: { quotedMessage: { id: bubbleId, body: ownerSend.text } } });
    expect(late.request.payload).toMatchObject({ openwa: { event: "approval_reply", approvalRequestId: request.id, requestStatus: "resolved" } });
    const lateRun = await runStart(t, late);
    const again = await failure(executeOpenwaTool(db, lateRun.binding, "openwa_approval_resolve", { requestId: request.id, decision: "approve" }));
    expect(codeOf(again)).toBe("already_resolved");
    expect(await grantsOf(request.id)).toHaveLength(1);
    const audit = await db.select().from(chatAuditEntries).where(eq(chatAuditEntries.endpointId, t.endpointId));
    expect(audit.map((entry) => entry.kind)).toEqual(expect.arrayContaining(["approval_requested", "approval_resolved"]));
  }, 120_000);

  it("AC6: quoting another request's bubble resolves only that request", async () => {
    const t = await setup();
    const wakeA = await admitted(t, { chatId: jid(MEMBER_A), body: "minta akses pertama" });
    const runA = await runStart(t, wakeA);
    const first = await requestApproval(runA.binding, { message: "First request" });
    const second = await requestApproval(runA.binding, { categories: ["external_tools"], message: "Second request" });
    const [secondBubble] = await bubbleIds(second.requestId);
    const reply = await admitted(t, { chatId: jid(OWNER_PHONE), body: "yang kedua boleh", extra: { quotedMessage: { id: secondBubble, body: "Second request" } } });
    expect(reply.request.payload).toMatchObject({ openwa: { event: "approval_reply", approvalRequestId: second.requestId } });
    const replyRun = await runStart(t, reply);
    const wrong = await failure(executeOpenwaTool(db, replyRun.binding, "openwa_approval_resolve", { requestId: first.requestId, decision: "approve" }));
    expect(codeOf(wrong)).toBe("approval_not_authorized");
    await executeOpenwaTool(db, replyRun.binding, "openwa_approval_resolve", { requestId: second.requestId, decision: "reject" });
    expect((await requestRow(first.requestId)).status).toBe("pending");
    expect((await requestRow(second.requestId)).status).toBe("rejected");
    expect(await grantsOf(second.requestId)).toEqual([]);
    const rejectedWake = await approvalWake(t, second.requestId);
    expect(rejectedWake.request.payload).toMatchObject({ openwa: { event: "approval_resolved", triggerClass: "other", approvalRequestId: second.requestId } });
    const rejectedRun = await runStart(t, rejectedWake);
    expect(rejectedRun.openwa).toMatchObject({ triggerClass: "other", profile: "read_only", grantIds: [] });
  }, 120_000);

  it("AC6/AC7: requester grants stay with their requester, Paperclip resolves through the generic route, owner loss revokes", async () => {
    const t = await setup();
    t.gateway.groups.set(GROUP, { id: GROUP, name: "Tim Finance", participants: [{ id: jid(OWNER_PHONE) }, { id: jid(MEMBER_A) }, { id: jid(MEMBER_B) }] });
    const mention = (phone: string, body: string) => ({ chatId: GROUP, author: jid(phone), body: "@" + OWN_PHONE + " " + body, extra: { mentionedIds: [jid(OWN_PHONE)] } });
    const wakeA = await admitted(t, mention(MEMBER_A, "tolong kirim email ke vendor"));
    const runA = await runStart(t, wakeA, { requesterPrincipalId: wakeA.delivery.principalId });
    const created = await requestApproval(runA.binding, { categories: ["external_tools"], scope: "requester" });
    const request = await requestRow(created.requestId);

    const outsider = await linkUser(t.companyId, "Board member");
    const denied = await supertest(boardApp(t.companyId, outsider)).post("/api/issues/" + runA.issueId + "/interactions/" + request.interactionId + "/accept").send({});
    expect(denied.status).toBe(403);
    const deniedDirect = await supertest(channelApp(t, outsider)).post("/api/chat-endpoints/" + t.endpointId + "/openwa/approvals/" + request.id + "/resolve").send({ decision: "approve" });
    expect(deniedDirect.status).toBe(403);
    expect((await requestRow(request.id)).status).toBe("pending");

    const listed = await supertest(channelApp(t, t.userId)).get("/api/chat-endpoints/" + t.endpointId + "/openwa/approvals?status=pending");
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual([expect.objectContaining({ id: request.id, canResolve: true, status: "pending" })]);
    expect(listed.body[0].requester).toContain(MEMBER_A.slice(-4));
    expect(listed.body[0].requester).not.toContain(MEMBER_A);

    const accepted = await supertest(boardApp(t.companyId, t.userId)).post("/api/issues/" + runA.issueId + "/interactions/" + request.interactionId + "/accept").send({});
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ status: "accepted" });
    expect(await requestRow(request.id)).toMatchObject({ status: "approved", resolvedVia: "paperclip", resolvedByUserId: t.userId });
    const grants = await grantsOf(request.id);
    expect(grants).toEqual([expect.objectContaining({ category: "external_tools", scope: "requester", approvedVia: "paperclip", requesterPrincipalId: wakeA.delivery.principalId, originChatKey: GROUP })]);
    await approvalWake(t, request.id);

    const wakeB = await admitted(t, mention(MEMBER_B, "kirim juga email saya"));
    const runB = await runStart(t, wakeB, { requesterPrincipalId: wakeB.delivery.principalId });
    expect(runB.openwa.grantIds).toEqual([]);
    await expect(assertOpenwaRunMay(db, runB.run, "external_tools")).rejects.toMatchObject({ status: 403 });
    const wakeA2 = await admitted(t, mention(MEMBER_A, "satu email lagi"));
    const runA2 = await runStart(t, wakeA2, { requesterPrincipalId: wakeA2.delivery.principalId });
    expect(runA2.openwa.grantIds).toEqual([grants[0]!.id]);
    expect(await assertOpenwaRunMay(db, runA2.run, "external_tools")).toBeNull();

    const [owner] = await t.service.openwa.listOwners(t.endpointId);
    await t.service.openwa.removeOwner(t.endpointId, owner!.id, t.userId);
    expect((await grantsOf(request.id))[0]!.status).toBe("revoked");
    await expect(assertOpenwaRunMay(db, runA2.run, "external_tools")).rejects.toMatchObject({ status: 403 });
  }, 120_000);

  it("AC7: a Paperclip rejection reason reaches the agent's approval_resolved comment", async () => {
    const t = await setup();
    const wakeA = await admitted(t, { chatId: jid(MEMBER_A), body: "minta izin" });
    const runA = await runStart(t, wakeA);
    const created = await requestApproval(runA.binding);
    const reason = "Jangan dulu, tunggu hari Senin";
    const resolved = await supertest(channelApp(t, t.userId))
      .post("/api/chat-endpoints/" + t.endpointId + "/openwa/approvals/" + created.requestId + "/resolve")
      .send({ decision: "reject", reason });
    expect(resolved.status).toBe(200);
    expect(resolved.body).toMatchObject({ status: "rejected", grantIds: [] });
    const wake = await approvalWake(t, created.requestId);
    expect(wake.request.payload).toMatchObject({ openwa: { event: "approval_resolved", triggerClass: "other" } });
    const body = await resolvedComment(wake.action);
    expect(body).toContain("rejected the approval request via Paperclip");
    expect(body).toContain("Owner note: " + reason);
  }, 120_000);

  it("AC7: simultaneous WhatsApp and Paperclip resolution yields exactly one winner", async () => {
    const t = await setup();
    const wakeA = await admitted(t, { chatId: jid(MEMBER_A), body: "minta izin" });
    const runA = await runStart(t, wakeA);
    const created = await requestApproval(runA.binding);
    const request = await requestRow(created.requestId);
    const [bubbleId] = await bubbleIds(request.id);
    const reply = await admitted(t, { chatId: jid(OWNER_PHONE), body: "setuju", extra: { quotedMessage: { id: bubbleId, body: "x" } } });
    const replyRun = await runStart(t, reply);
    const results = await Promise.allSettled([
      executeOpenwaTool(db, replyRun.binding, "openwa_approval_resolve", { requestId: request.id, decision: "approve" }),
      supertest(boardApp(t.companyId, t.userId))
        .post("/api/issues/" + runA.issueId + "/interactions/" + request.interactionId + "/reject")
        .send({ reason: "tidak" })
        .then((response) => {
          if (response.status !== 200) throw new HttpError(response.status, "ui", response.body);
          return response.body;
        }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(loser.reason).toBeInstanceOf(HttpError);
    expect((loser.reason as HttpError).status).toBe(409);
    const row = await requestRow(request.id);
    expect(["approved", "rejected"]).toContain(row.status);
    expect(await grantsOf(request.id)).toHaveLength(row.status === "approved" ? 1 : 0);
    const wakeActions = await db.select().from(chatActions).where(eq(chatActions.providerActionId, "openwa-approval-resolved:" + request.id));
    expect(wakeActions).toHaveLength(1);
  }, 120_000);

  it("AC15: owner_number self-chat approval and replies from a chat that is not enabled", async () => {
    const t = await setup({ policy: { numberMode: "owner_number" }, owners: [OWN_PHONE, OWNER2_PHONE] });
    await t.service.openwa.putChat(t.endpointId, { chatId: jid(MEMBER_A), settings: { activation: "on", triggers: { directMessage: true } } }, t.userId);
    const wakeA = await admitted(t, { chatId: jid(MEMBER_A), body: "bisa bantu buat task?" });
    const runA = await runStart(t, wakeA);
    const created = await requestApproval(runA.binding);
    const request = await requestRow(created.requestId);
    expect(new Set(t.gateway.sends.slice(-2).map((send) => send.chatId))).toEqual(new Set([jid(OWN_PHONE), jid(OWNER2_PHONE)]));
    const bubbles = await bubbleIds(request.id);
    const selfBubble = bubbles.find((id) => id.includes(jid(OWN_PHONE)))!;
    const otherBubble = bubbles.find((id) => id.includes(jid(OWNER2_PHONE)))!;

    const statsBefore = t.service.openwaAdmissionStats.ownerActivity + t.service.openwaAdmissionStats.discarded;
    const deliveriesBefore = (await deliveries(t)).length;
    t.gateway.inbound({ chatId: jid(OWNER2_PHONE), body: "halo" });
    await until(() => t.service.openwaAdmissionStats.ownerActivity + t.service.openwaAdmissionStats.discarded > statsBefore);
    expect((await deliveries(t)).length).toBe(deliveriesBefore);

    const fromOther = await admitted(t, { chatId: jid(OWNER2_PHONE), body: "tunggu dulu", extra: { quotedMessage: { id: otherBubble, body: "x" } } });
    expect(fromOther.request.payload).toMatchObject({ openwa: { event: "approval_reply", triggerClass: "owner", approvalRequestId: request.id } });

    const selfReply = await admitted(t, { chatId: jid(OWN_PHONE), fromMe: true, body: "oke boleh", extra: { quotedMessage: { id: selfBubble, body: "x" } } });
    expect(selfReply.request.payload).toMatchObject({ openwa: { event: "approval_reply", triggerClass: "owner", approvalRequestId: request.id, requestStatus: "pending" } });
    const selfRun = await runStart(t, selfReply);
    const resolved = (await executeOpenwaTool(db, selfRun.binding, "openwa_approval_resolve", { requestId: request.id, decision: "approve" })) as { status: string };
    expect(resolved.status).toBe("approved");
    expect(await requestRow(request.id)).toMatchObject({ status: "approved", resolvedVia: "whatsapp", resolvedByUserId: t.ownerUsers[OWN_PHONE], ownerText: "oke boleh" });
    expect(await grantsOf(request.id)).toHaveLength(1);
  }, 120_000);

  it("rejects approval requests from owner-class runs", async () => {
    const t = await setup();
    const ownerWake = await admitted(t, { chatId: jid(OWNER_PHONE), body: "halo" });
    const ownerRun = await runStart(t, ownerWake);
    const ownerDenied = await failure(requestApproval(ownerRun.binding));
    expect(codeOf(ownerDenied)).toBe("approval_not_needed");
  }, 120_000);

  it("keeps a consumed grant revoked when its approver stops being an owner", async () => {
    const t = await setup();
    const wakeA = await admitted(t, { chatId: jid(MEMBER_A), body: "buat task" });
    const runA = await runStart(t, wakeA);
    const created = await requestApproval(runA.binding);
    const resolved = await supertest(channelApp(t, t.userId))
      .post("/api/chat-endpoints/" + t.endpointId + "/openwa/approvals/" + created.requestId + "/resolve")
      .send({ decision: "approve" });
    expect(resolved.status).toBe(200);
    const [grant] = await grantsOf(created.requestId);
    const request = await requestRow(created.requestId);
    const grantRun = await runStart(t, await approvalWake(t, created.requestId), {
      grantIds: [grant!.id],
      requesterPrincipalId: request.requestedByPrincipalId,
      approvalRequestId: request.id,
    });
    expect(await assertOpenwaRunMay(db, grantRun.run, "create_task")).toBe(grant!.id);
    expect((await grantsOf(created.requestId))[0]).toMatchObject({ status: "consumed", consumedByRunId: grantRun.runId });

    const [owner] = await t.service.openwa.listOwners(t.endpointId);
    await t.service.openwa.removeOwner(t.endpointId, owner!.id, t.userId);
    expect((await grantsOf(created.requestId))[0]!.status).toBe("revoked");
    await restoreOpenwaGrant(db, { companyId: t.companyId, runId: grantRun.runId, grantId: grant!.id });
    expect((await grantsOf(created.requestId))[0]!.status).toBe("revoked");
    await expect(assertOpenwaRunMay(db, grantRun.run, "create_task")).rejects.toMatchObject({ status: 403 });
  }, 120_000);

  it("sanitizes credential-shaped text in the approval bubble before it is sent or recorded", async () => {
    const t = await setup();
    const wakeA = await admitted(t, { chatId: jid(MEMBER_A), body: "tolong buatkan akses" });
    const runA = await runStart(t, wakeA);
    const token = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
    const created = await requestApproval(runA.binding, { message: "Member wants access; they pasted " + token + " in the chat. Approve?" });
    const [bubbleId] = await bubbleIds(created.requestId);
    const sent = t.gateway.sends.find((send) => send.messageId === bubbleId)!;
    expect(sent.chatId).toBe(jid(OWNER_PHONE));
    expect(sent.text).toContain("Approve?");
    expect(sent.text).not.toContain(token);
    const outbound = await db
      .select()
      .from(chatOutboundMessages)
      .where(and(eq(chatOutboundMessages.endpointId, t.endpointId), eq(chatOutboundMessages.providerMessageId, bubbleId!)));
    expect(outbound).toHaveLength(1);
    expect(JSON.stringify(outbound)).not.toContain(token);
    expect(outbound[0]!.bodyHash).toBe(openwaBodyHash(sent.text));
    expect(JSON.stringify(await requestRow(created.requestId))).not.toContain(token);

    const empty = await failure(requestApproval(runA.binding, { message: "<thinking>secret plan</thinking>" }));
    expect(codeOf(empty)).toBe("gateway_error");
  }, 120_000);

  it("revokes an owner's grants when company membership demotes them to viewer", async () => {
    const t = await setup();
    const wakeA = await admitted(t, { chatId: jid(MEMBER_A), body: "kirim email" });
    const runA = await runStart(t, wakeA, { requesterPrincipalId: wakeA.delivery.principalId });
    const created = await requestApproval(runA.binding, { categories: ["external_tools"], scope: "requester" });
    const resolved = await supertest(channelApp(t, t.userId))
      .post("/api/chat-endpoints/" + t.endpointId + "/openwa/approvals/" + created.requestId + "/resolve")
      .send({ decision: "approve" });
    expect(resolved.status).toBe(200);
    const [grant] = await grantsOf(created.requestId);
    expect(grant).toMatchObject({ status: "live", scope: "requester", approvedByUserId: t.userId });
    const wakeA2 = await admitted(t, { chatId: jid(MEMBER_A), body: "satu lagi" });
    const runA2 = await runStart(t, wakeA2, { requesterPrincipalId: wakeA2.delivery.principalId });
    expect(runA2.openwa.grantIds).toEqual([grant!.id]);

    const access = accessService(db);
    const [membership] = await db
      .select()
      .from(companyMemberships)
      .where(and(eq(companyMemberships.companyId, t.companyId), eq(companyMemberships.principalId, t.userId)));
    await access.updateMember(t.companyId, membership!.id, { membershipRole: "admin" });
    expect((await grantsOf(created.requestId))[0]!.status).toBe("live");
    expect(await assertOpenwaRunMay(db, runA2.run, "external_tools")).toBeNull();

    await access.updateMember(t.companyId, membership!.id, { membershipRole: "viewer" });
    expect((await grantsOf(created.requestId))[0]!.status).toBe("revoked");
    await expect(assertOpenwaRunMay(db, runA2.run, "external_tools")).rejects.toMatchObject({ status: 403 });
    const wakeA3 = await admitted(t, { chatId: jid(MEMBER_A), body: "lagi" });
    expect((await runStart(t, wakeA3, { requesterPrincipalId: wakeA3.delivery.principalId })).openwa.grantIds).toEqual([]);
  }, 120_000);
});
