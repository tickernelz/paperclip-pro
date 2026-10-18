import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import {
  agentWakeupRequests,
  agents,
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
  issueComments,
  issueThreadInteractions,
  issues,
  toolConnections,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import { startEmbeddedPostgresTestDatabase } from "../helpers/embedded-postgres.js";
import { chatChannelService, type ChatChannelService, type ChatChannelServiceOptions } from "../../services/chat-channels.js";
import { ChatSdkRuntime } from "../../services/chat-sdk-runtime.js";
import { instanceSettingsService } from "../../services/instance-settings.js";
import { issueThreadInteractionService } from "../../services/issue-thread-interactions.js";
import { secretService } from "../../services/secrets.js";
import { resolveOpenwaRunContext } from "../../services/openwa/authority.js";
import { buildOpenwaRunGuidance } from "../../services/openwa/guidance.js";
import { OPENWA_PENDING_CARD_ACTION_KIND } from "../../services/openwa/pending-cards.js";
import { FAKE_OPENWA_KEY, FakeOpenwaGateway } from "./fake-gateway.js";

const SESSION_ID = "52222222-3333-4444-8555-666666666666";
const OWN_PHONE = "628111000522";
const OWNER_PHONE = "628333000522";
const OWNER_LID = "105000000999444@lid";
const jid = (phone: string) => phone + "@c.us";

type WakeupOptions = Parameters<ChatChannelServiceOptions["heartbeat"]["wakeup"]>[1];

async function until(predicate: () => boolean | Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("OpenWA pending_card wakes (embedded Postgres + fake gateway)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let scratch: string;
  const oldKey = process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
  const services: ChatChannelService[] = [];
  const gateways: FakeOpenwaGateway[] = [];
  const endpointIds: string[] = [];

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-openwa-pending-card-");
    db = createDb(database.connectionString);
    scratch = await mkdtemp(path.join(tmpdir(), "openwa-pending-card-"));
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
      name: "OpenWA pending card",
      issuePrefix: "P" + companyId.replaceAll("-", "").slice(0, 7).toUpperCase(),
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

  async function deliverInbound(t: Setup, input: { chatId: string; body: string; from?: string; senderPhone?: string }) {
    const before = await db.select({ id: chatDeliveries.id }).from(chatDeliveries).where(eq(chatDeliveries.endpointId, t.endpointId));
    t.gateway.inbound({
      chatId: input.chatId,
      body: input.body,
      ...(input.from ? { from: input.from } : {}),
      ...(input.senderPhone ? { extra: { senderPhone: input.senderPhone } } : {}),
    });
    let swept = Date.now();
    await until(async () => {
      if (Date.now() - swept > 1_000) {
        swept = Date.now();
        await t.service.processPendingDeliveries();
      }
      const rows = await db.select().from(chatDeliveries).where(eq(chatDeliveries.endpointId, t.endpointId));
      return rows.length > before.length && rows.every((entry) => entry.state === "processed");
    }, 30_000);
  }

  async function ownerConversation(t: Setup) {
    t.gateway.lids.set(OWNER_PHONE, OWNER_LID);
    await deliverInbound(t, { chatId: OWNER_LID, from: OWNER_LID, senderPhone: OWNER_PHONE, body: "halo" });
    const rows = await db.select().from(chatConversations).where(eq(chatConversations.endpointId, t.endpointId));
    console.log("CONVERSATIONS", JSON.stringify(rows.map((r) => ({ id: r.id, ext: r.externalConversationId, issue: r.issueId }))));
    const conversation = rows.find((row) => row.externalConversationId.endsWith(OWNER_LID));
    expect(conversation).toBeDefined();
    return { conversationId: conversation!.id, issueId: conversation!.issueId };
  }

  async function taskIssue(t: Setup, title: string) {
    const id = randomUUID();
    await db.insert(issues).values({ id, companyId: t.companyId, title, status: "in_progress", assigneeAgentId: t.agentId, identifier: "P-" + id.slice(0, 4) });
    return id;
  }

  async function createCard(t: Setup, issueId: string, input: Record<string, unknown>, actor = { agentId: t.agentId } as Record<string, string>) {
    return issueThreadInteractionService(db).create(
      { id: issueId, companyId: t.companyId },
      { kind: "request_confirmation", payload: { version: 1, prompt: "Proceed?" }, resolverPolicy: "human_only", ...input } as never,
      actor as never,
    );
  }

  async function cardActions(t: Setup) {
    return db
      .select()
      .from(chatActions)
      .where(and(eq(chatActions.endpointId, t.endpointId), eq(chatActions.kind, OPENWA_PENDING_CARD_ACTION_KIND)))
      .orderBy(asc(chatActions.createdAt));
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

  it("stages one owner-chat wake for a human-only card and carries it into the run's guidance", async () => {
    const t = await setup();
    const owner = await ownerConversation(t);
    const card = await createCard(t, owner.issueId);
    expect(card.status).toBe("pending");

    const staged = await cardActions(t);
    expect(staged).toHaveLength(1);
    expect(staged[0]).toMatchObject({ conversationId: owner.conversationId, status: "received" });
    expect(staged[0]!.payload).toMatchObject({ issueId: owner.issueId, agentId: t.agentId, interactionId: card.id, openwa: { event: "pending_card", triggerClass: "other", pendingCardIds: [card.id] } });
    const comments = await db.select().from(issueComments).where(and(eq(issueComments.issueId, owner.issueId), eq(issueComments.authorType, "system")));
    expect(comments.some((comment) => comment.body.includes(card.id.slice(0, 8)))).toBe(true);

    expect(await t.service.processPendingOpenwaPendingCards()).toBe(1);
    const wake = await wakeFor(t, staged[0]!.id);
    expect(wake.request.payload).toMatchObject({ issueId: owner.issueId, openwa: { event: "pending_card", triggerClass: "other", pendingCardIds: [card.id] } });
    expect(wake.wake.allowRunCoalescing).toBe(false);

    const run = await runContext(t, wake);
    expect(run.openwa).toMatchObject({ triggerClass: "other", profile: "read_only", event: "pending_card" });
    const cards = run.guidance.wakeEvent.pendingCards ?? [];
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ interactionId: card.id, kind: "request_confirmation", prompt: "Proceed?" });
    expect(cards[0]!.options.map((option) => option.id)).toEqual(["approve", "reject"]);
    expect(run.guidance.markdown).toContain("`pending_card`");
    expect(run.guidance.markdown).toContain("Proceed?");
    expect(run.guidance.markdown).toContain("Replying in this chat: allowed for this run.");

    expect(await t.service.processPendingOpenwaPendingCards()).toBe(0);
    expect((await cardActions(t))[0]!.status).toBe("processed");
  }, 180_000);

  it("reaches the owner through a card created on a plain task, and drops a card resolved before the wake", async () => {
    const t = await setup();
    const owner = await ownerConversation(t);
    const issueId = await taskIssue(t, "Ship the widget");
    const card = await createCard(t, issueId);
    const [staged] = await cardActions(t);
    expect(staged).toMatchObject({ conversationId: owner.conversationId, status: "received" });

    await db.update(issueThreadInteractions).set({ status: "resolved" }).where(eq(issueThreadInteractions.id, card.id));
    expect(await t.service.processPendingOpenwaPendingCards()).toBe(0);
    const [settled] = await cardActions(t);
    expect(settled!.status).toBe("processed");
    expect((settled!.result as Record<string, unknown>).code).toBe("openwa_pending_card_resolved");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(t.wakes.has(staged!.id)).toBe(false);
  }, 180_000);

  it("stays out of cards an owner cannot answer from chat", async () => {
    const t = await setup();
    await ownerConversation(t);
    const issueId = await taskIssue(t, "Governed work");
    await createCard(t, issueId, {
      payload: {
        version: 1,
        prompt: "Run it?",
        toolAction: {
          version: 1,
          actionRequestId: randomUUID(),
          invocationId: randomUUID(),
          toolName: "bash",
          toolDisplayName: "Bash",
          connectionId: null,
          applicationId: null,
          appDisplayName: null,
          risk: "write",
          previewMarkdown: "rm -rf /tmp/x",
          argumentsSummaryJson: "{}",
          argumentsHash: "abc",
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        },
      },
    });
    await createCard(t, issueId, { payload: { version: 1, prompt: "Wipe it?", destructive: true } });
    await createCard(t, issueId, { resolverPolicy: "anyone" });
    await createCard(t, issueId, { kind: "ask_user_questions", payload: { version: 1, title: "Pick one", questions: [{ id: "q1", prompt: "Which?", selectionMode: "single", options: [{ id: "a", label: "A" }] }] } }, {} as Record<string, string>);
    expect(await cardActions(t)).toEqual([]);
  }, 180_000);
});
