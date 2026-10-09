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
  chatCompletionDeliveries,
  chatConversations,
  chatEndpointResources,
  chatEndpoints,
  chatTaskHandoffs,
  companies,
  companyMemberships,
  companySecretBindings,
  createDb,
  heartbeatRuns,
  issueComments,
  issues,
  toolConnections,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import { startEmbeddedPostgresTestDatabase } from "../helpers/embedded-postgres.js";
import { createLocalDiskStorageProvider } from "../../storage/local-disk-provider.js";
import { createStorageService } from "../../storage/service.js";
import { chatChannelService, type ChatChannelService } from "../../services/chat-channels.js";
import { ChatSdkRuntime } from "../../services/chat-sdk-runtime.js";
import { secretService } from "../../services/secrets.js";
import { instanceSettingsService } from "../../services/instance-settings.js";
import { issueService } from "../../services/issues.js";
import { chatCompletionDeliveryService, prepareChatCompletionTurn } from "../../services/chat-completion-delivery.js";
import { applyOpenwaRunContext, resolveOpenwaRunContext } from "../../services/openwa/authority.js";
import { buildOpenwaRunGuidance } from "../../services/openwa/guidance.js";
import { openwaThreadId } from "../../services/openwa/adapter.js";
import { openwaChatKey } from "../../services/openwa/outbound.js";
import { executeOpenwaTool, OpenwaToolError } from "../../services/openwa/tools.js";
import { FAKE_OPENWA_KEY, FakeOpenwaGateway } from "./fake-gateway.js";

const SESSION_ID = "44444444-5555-4666-8777-888888888888";
const OWN_PHONE = "628111000777";
const OWNER_DM = "628999000111@c.us";

async function until(predicate: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe.sequential("OpenWA delegated task reports (embedded Postgres + fake gateway)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let root: string;
  let storage: ReturnType<typeof createStorageService>;
  const oldKey = process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
  const services: ChatChannelService[] = [];
  const gateways: FakeOpenwaGateway[] = [];
  const endpointIds: string[] = [];

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-openwa-completion-");
    db = createDb(database.connectionString);
    root = await mkdtemp(path.join(tmpdir(), "openwa-completion-"));
    process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = path.join(root, "master.key");
    storage = createStorageService(createLocalDiskStorageProvider(path.join(root, "storage")));
    await instanceSettingsService(db).updateExperimental({ enableChatConnectors: true, enableAgentChat: false });
  }, 60_000);
  afterEach(async () => {
    await Promise.all(services.splice(0).map((service) => service.shutdown()));
    await Promise.all(gateways.splice(0).map((gateway) => gateway.close()));
    for (const id of endpointIds.splice(0)) await db.update(chatEndpoints).set({ status: "archived" }).where(eq(chatEndpoints.id, id));
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await database?.cleanup();
    if (root) await rm(root, { recursive: true, force: true });
    if (oldKey === undefined) delete process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
    else process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = oldKey;
  });

  async function agent(companyId: string, name: string) {
    const id = randomUUID();
    await db.insert(agents).values({ id, companyId, name, role: "engineer", status: "idle", adapterType: "paperclip_runner", adapterConfig: {}, runtimeConfig: {}, permissions: {} });
    return id;
  }

  async function setup(policy: Record<string, unknown> = {}) {
    const gateway = new FakeOpenwaGateway({ sessionId: SESSION_ID, ownPhone: OWN_PHONE });
    await gateway.start();
    gateways.push(gateway);
    const companyId = randomUUID();
    const userId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "OpenWA completion",
      issuePrefix: "C" + companyId.replaceAll("-", "").slice(0, 7).toUpperCase(),
      requireBoardApprovalForNewAgents: false,
    });
    const wira = await agent(companyId, "Wira");
    const arif = await agent(companyId, "Arif");
    const lead = await agent(companyId, "Lead");
    await db.insert(authUsers).values({ id: userId, name: "Operator", email: userId + "@example.com", emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "operator" });
    const service = chatChannelService(db, {
      runtime: new ChatSdkRuntime(),
      publicBaseUrl: "https://paperclip.example",
      heartbeat: { wakeup: vi.fn(async () => ({ accepted: true })) } as never,
      storage,
      scheduleDeferredWork: () => {},
      discordGatewayLeaseWaitMs: 200,
    });
    services.push(service);
    const endpoint = await service.create(companyId, { provider: "openwa", assignedAgentId: wira } as never, userId);
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
        policy,
        setup: { step: "complete", testStartedAt: new Date(Date.now() - 60_000).toISOString() },
      })
      .where(eq(chatEndpoints.id, endpoint.id));
    expect((await service.reconcileProviderRuntimes()).local).toBe(1);
    await gateway.waitForSubscription();
    await until(async () => (await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, endpoint.id)))[0]!.status === "active");

    const threadId = openwaThreadId({ sessionId: SESSION_ID, chatId: OWNER_DM, isGroup: false });
    const [conversationIssue] = await db
      .insert(issues)
      .values({ companyId, title: "WhatsApp owner", status: "in_progress", assigneeAgentId: wira })
      .returning();
    const [resource] = await db
      .insert(chatEndpointResources)
      .values({
        companyId,
        endpointId: endpoint.id,
        type: "direct_message",
        providerResourceId: threadId,
        label: OWNER_DM,
        availability: "available",
        enabled: true,
        settings: {},
        metadata: { chatKey: openwaChatKey(OWNER_DM) },
      })
      .returning();
    await db.insert(chatConversations).values({
      companyId,
      endpointId: endpoint.id,
      resourceId: resource!.id,
      issueId: conversationIssue!.id,
      externalConversationId: threadId,
      externalThreadId: threadId,
      externalLabel: OWNER_DM,
      isDirectMessage: true,
    });
    const conversationId = conversationIssue!.id;

    const wiraRunId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: wiraRunId,
      companyId,
      agentId: wira,
      status: "running",
      startedAt: new Date(Date.now() - 30_000),
      contextSnapshot: { source: "chat:openwa", issueId: conversationId },
    });

    const wakeup = vi.fn(async (agentId: string, options: any) => {
      const [wake] = await db
        .insert(agentWakeupRequests)
        .values({ companyId, agentId, source: "automation", status: "queued", reason: options.reason, idempotencyKey: options.idempotencyKey, payload: options.payload })
        .returning();
      const [run] = await db
        .insert(heartbeatRuns)
        .values({ companyId, agentId, status: "queued", wakeupRequestId: wake!.id, contextSnapshot: options.contextSnapshot })
        .returning();
      await db.update(agentWakeupRequests).set({ runId: run!.id }).where(eq(agentWakeupRequests.id, wake!.id));
      return run!;
    });
    const deliveries = chatCompletionDeliveryService(db, { wakeup } as never);
    const svc = issueService(db);

    async function delegate(title: string, input: { parentId?: string | null; assignee?: string; runId?: string } = {}) {
      return svc.create(companyId, {
        title,
        status: "todo",
        parentId: input.parentId === undefined ? conversationId : input.parentId,
        assigneeAgentId: input.assignee ?? arif,
        createdByAgentId: wira,
        actorRunId: input.runId ?? wiraRunId,
      });
    }
    async function rows() {
      return db
        .select()
        .from(chatCompletionDeliveries)
        .where(eq(chatCompletionDeliveries.companyId, companyId))
        .orderBy(asc(chatCompletionDeliveries.createdAt), asc(chatCompletionDeliveries.id));
    }
    async function makeDue() {
      await db.update(chatCompletionDeliveries).set({ nextAttemptAt: new Date(0) }).where(eq(chatCompletionDeliveries.companyId, companyId));
    }
    async function wakeRuns() {
      return Promise.all(
        wakeup.mock.results.map(async (result) => (await result.value) as typeof heartbeatRuns.$inferSelect),
      );
    }
    async function startTurn(run: typeof heartbeatRuns.$inferSelect) {
      const prepared = await prepareChatCompletionTurn(db, run);
      const context: Record<string, unknown> = { ...prepared.contextSnapshot };
      const openwa = await resolveOpenwaRunContext(db, {
        companyId,
        issueId: conversationId,
        runId: run.id,
        contextSnapshot: context,
        wakeupRequestId: run.wakeupRequestId,
      });
      applyOpenwaRunContext(context, openwa);
      await db.update(heartbeatRuns).set({ status: "running", startedAt: new Date(), contextSnapshot: context }).where(eq(heartbeatRuns.id, run.id));
      const guidance = openwa
        ? await buildOpenwaRunGuidance(db, { companyId, issueId: conversationId, runId: run.id, wakeupRequestId: run.wakeupRequestId, openwa, contextSnapshot: context })
        : null;
      return { runId: run.id, openwa, guidance, context };
    }
    async function send(runId: string, text: string, extra: Record<string, unknown> = {}) {
      return executeOpenwaTool(db, { companyId, agentId: wira, runId, issueId: conversationId }, "openwa_send", { text, idempotencyKey: randomUUID(), ...extra });
    }
    async function finishRun(runId: string, status: "succeeded" | "failed" = "succeeded") {
      await db.update(heartbeatRuns).set({ status, finishedAt: new Date() }).where(eq(heartbeatRuns.id, runId));
    }
    return { gateway, companyId, wira, arif, lead, conversationId, wiraRunId, wakeup, deliveries, svc, delegate, rows, makeDue, wakeRuns, startTurn, send, finishRun };
  }

  it("(a) reports one finished task while its sibling stays open, with exactly one WhatsApp message", async () => {
    const t = await setup();
    const first = await t.delegate("Draft the supplier contract");
    const second = await t.delegate("Collect the invoices");
    await t.svc.update(first.id, { status: "done" });
    await db.insert(issueComments).values({ companyId: t.companyId, issueId: first.id, authorAgentId: t.arif, body: "Contract drafted and attached to the task." });

    await t.deliveries.sweepPending();
    expect(t.wakeup).not.toHaveBeenCalled();
    await t.makeDue();
    await t.deliveries.sweepPending();
    expect(t.wakeup).toHaveBeenCalledOnce();
    expect(t.wakeup.mock.calls[0]![0]).toBe(t.wira);
    expect(t.wakeup.mock.calls[0]![1].contextSnapshot).toMatchObject({ issueId: t.conversationId, wakeReason: "chat_task_completed" });

    const [run] = await t.wakeRuns();
    const turn = await t.startTurn(run!);
    expect(turn.openwa).toMatchObject({ event: "task_completion", triggerClass: "other", profile: "read_only" });
    const tasks = turn.guidance!.wakeEvent.completedTasks!;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ identifier: first.identifier, title: "Draft the supplier contract", status: "done", assignee: "Arif" });
    expect(tasks[0]!.url).toContain("/issues/" + first.identifier);
    expect(tasks[0]!.latestComment).toContain("Contract drafted");
    expect(turn.guidance!.markdown).toContain("task_completion");
    expect(turn.guidance!.markdown).not.toContain(second.identifier!);

    const sent = await t.send(turn.runId, "Selesai: " + first.identifier + " oleh Arif " + tasks[0]!.url);
    expect(sent).toMatchObject({ state: "delivered", answeredTriggerIds: [] });
    const again = await t.send(turn.runId, "Laporan lagi").catch((error) => error);
    expect(again).toBeInstanceOf(OpenwaToolError);
    expect((again as OpenwaToolError).code).toBe("completion_already_reported");
    expect(t.gateway.sends).toHaveLength(1);
    expect(t.gateway.sends[0]!.text).toContain(first.identifier!);
    expect(t.gateway.sends[0]!.quotedMessageId).toBeUndefined();

    await t.finishRun(turn.runId);
    await t.makeDue();
    await t.deliveries.sweepPending();
    expect(t.wakeup).toHaveBeenCalledOnce();
    expect((await t.rows()).map((row) => row.status)).toEqual(["delivered"]);
  }, 60_000);

  it("(a, negative control) records nothing for a task whose creating run is not on an OpenWA conversation", async () => {
    const t = await setup();
    const [plain] = await db.insert(issues).values({ companyId: t.companyId, title: "Plain issue", status: "in_progress", assigneeAgentId: t.wira }).returning();
    const plainRunId = randomUUID();
    await db.insert(heartbeatRuns).values({ id: plainRunId, companyId: t.companyId, agentId: t.wira, status: "running", contextSnapshot: { issueId: plain!.id } });
    const task = await t.delegate("Unrelated work", { parentId: plain!.id, runId: plainRunId });
    expect(await db.select().from(chatTaskHandoffs).where(eq(chatTaskHandoffs.taskId, task.id))).toEqual([]);
    await t.svc.update(task.id, { status: "done" });
    await t.makeDue();
    await t.deliveries.sweepPending();
    expect(await t.rows()).toEqual([]);
    expect(t.wakeup).not.toHaveBeenCalled();
    expect(t.gateway.sends).toHaveLength(0);
  }, 60_000);

  it("(b) a task Wira files under another project's parent reports back to the WhatsApp conversation", async () => {
    const t = await setup();
    const [parent] = await db.insert(issues).values({ companyId: t.companyId, title: "Other project parent", status: "in_progress", assigneeAgentId: t.lead }).returning();
    const task = await t.delegate("Fix the other project", { parentId: parent!.id });
    expect(await db.select().from(chatTaskHandoffs).where(eq(chatTaskHandoffs.taskId, task.id))).toMatchObject([
      { conversationId: t.conversationId, agentId: t.wira, channel: "openwa" },
    ]);
    await t.svc.update(task.id, { status: "done" });
    expect(await t.svc.getWakeableParentAfterChildCompletion(parent!.id)).toMatchObject({ id: parent!.id, assigneeAgentId: t.lead });
    await t.makeDue();
    await t.deliveries.sweepPending();
    expect(t.wakeup).toHaveBeenCalledOnce();
    expect(t.wakeup.mock.calls[0]![0]).toBe(t.wira);
    expect(t.wakeup.mock.calls[0]![1].contextSnapshot.issueId).toBe(t.conversationId);
    const [run] = await t.wakeRuns();
    const turn = await t.startTurn(run!);
    expect(turn.guidance!.wakeEvent.completedTasks!.map((task) => task.identifier)).toEqual([task.identifier]);
  }, 60_000);

  it("(b) a reassignment by Wira's conversation run records the handoff", async () => {
    const t = await setup();
    const [existing] = await db.insert(issues).values({ companyId: t.companyId, title: "Existing task", status: "todo", assigneeAgentId: t.wira }).returning();
    await t.svc.update(existing!.id, { assigneeAgentId: t.arif, actorAgentId: t.wira, actorRunId: t.wiraRunId });
    expect(await db.select().from(chatTaskHandoffs).where(eq(chatTaskHandoffs.taskId, existing!.id))).toMatchObject([
      { conversationId: t.conversationId, agentId: t.wira, channel: "openwa" },
    ]);
  }, 60_000);

  it("(c) cancelled and blocked each report once; a repeated block without an unblock does not", async () => {
    const t = await setup();
    const cancelled = await t.delegate("Book the venue");
    const blocked = await t.delegate("Ship the release");
    const blocker = await t.delegate("Approve the budget", { assignee: t.lead });
    const extraBlocker = await t.delegate("Sign the vendor form", { assignee: t.lead });

    await t.svc.update(cancelled.id, { status: "cancelled" });
    await t.makeDue();
    await t.deliveries.sweepPending();
    expect(t.wakeup).toHaveBeenCalledTimes(1);
    let turn = await t.startTurn((await t.wakeRuns())[0]!);
    expect(turn.guidance!.wakeEvent.completedTasks).toMatchObject([{ identifier: cancelled.identifier, status: "cancelled" }]);
    expect(turn.guidance!.markdown).toMatch(/cancelled/);
    await t.send(turn.runId, cancelled.identifier + " dibatalkan. Lanjut atau cara lain?");
    await t.finishRun(turn.runId);

    await t.svc.update(blocked.id, { status: "blocked", blockedByIssueIds: [blocker.id] });
    await t.makeDue();
    await t.deliveries.sweepPending();
    expect(t.wakeup).toHaveBeenCalledTimes(2);
    turn = await t.startTurn((await t.wakeRuns())[1]!);
    const report = turn.guidance!.wakeEvent.completedTasks!;
    expect(report).toMatchObject([{ identifier: blocked.identifier, status: "blocked" }]);
    expect(report[0]!.blockedBy).toMatchObject([{ identifier: blocker.identifier, title: "Approve the budget" }]);
    await t.send(turn.runId, blocked.identifier + " terblokir oleh " + blocker.identifier);
    await t.finishRun(turn.runId);

    await t.svc.update(blocked.id, { status: "blocked", blockedByIssueIds: [blocker.id, extraBlocker.id] });
    await t.makeDue();
    await t.deliveries.sweepPending();
    expect(t.wakeup).toHaveBeenCalledTimes(2);
    expect((await t.rows()).map((row) => row.status)).toEqual(["delivered", "delivered"]);
    expect(t.gateway.sends).toHaveLength(2);

    await t.svc.update(blocked.id, { status: "todo", blockedByIssueIds: [] });
    await t.svc.update(blocked.id, { status: "blocked", blockedByIssueIds: [blocker.id] });
    expect((await t.rows()).map((row) => row.status)).toEqual(["delivered", "delivered", "pending"]);
  }, 60_000);

  it("(d) two tasks finishing inside the window share one wake and one message", async () => {
    const t = await setup();
    const first = await t.delegate("Translate the brochure");
    const second = await t.delegate("Print the brochure");
    await t.svc.update(first.id, { status: "done" });
    await t.deliveries.sweepPending();
    await t.svc.update(second.id, { status: "done" });
    await t.deliveries.sweepPending();
    expect(t.wakeup).not.toHaveBeenCalled();
    await t.makeDue();
    await t.deliveries.sweepPending();
    expect(t.wakeup).toHaveBeenCalledOnce();
    const turn = await t.startTurn((await t.wakeRuns())[0]!);
    expect(turn.guidance!.wakeEvent.completedTasks!.map((task) => task.identifier).sort()).toEqual([first.identifier, second.identifier].sort());
    await t.send(turn.runId, first.identifier + " dan " + second.identifier + " selesai");
    await t.finishRun(turn.runId);
    await t.makeDue();
    await t.deliveries.sweepPending();
    expect(t.wakeup).toHaveBeenCalledOnce();
    expect(t.gateway.sends).toHaveLength(1);
    expect((await t.rows()).map((row) => row.status)).toEqual(["delivered", "delivered"]);
  }, 60_000);

  it("(e) a retried completion turn never sends a duplicate", async () => {
    const t = await setup();
    const task = await t.delegate("Renew the domain");
    await t.svc.update(task.id, { status: "done" });
    await t.makeDue();
    await t.deliveries.sweepPending();
    const first = await t.startTurn((await t.wakeRuns())[0]!);
    await t.send(first.runId, task.identifier + " selesai");
    await t.finishRun(first.runId, "failed");
    await t.makeDue();
    await t.deliveries.sweepPending();
    expect(t.wakeup).toHaveBeenCalledOnce();
    expect(t.gateway.sends).toHaveLength(1);

    const other = await t.delegate("Renew the certificate");
    await t.svc.update(other.id, { status: "done" });
    await t.makeDue();
    await t.deliveries.sweepPending();
    expect(t.wakeup).toHaveBeenCalledTimes(2);
    const silent = await t.startTurn((await t.wakeRuns())[1]!);
    await t.finishRun(silent.runId, "failed");
    await t.makeDue();
    await t.deliveries.sweepPending();
    expect(t.wakeup).toHaveBeenCalledTimes(3);
    const retry = await t.startTurn((await t.wakeRuns())[2]!);
    expect(retry.guidance!.wakeEvent.completedTasks!.map((row) => row.identifier)).toEqual([other.identifier]);
    await t.send(retry.runId, other.identifier + " selesai");
    const stale = await t.send(silent.runId, "late").catch((error) => error);
    expect(stale).toBeInstanceOf(Error);
    expect(t.gateway.sends).toHaveLength(2);
  }, 60_000);

  it("(g) the children-completed wake defers to the completion report for OpenWA conversation parents", async () => {
    const t = await setup();
    const only = await t.delegate("Only child");
    await t.svc.update(only.id, { status: "done" });
    expect(await t.svc.getWakeableParentAfterChildCompletion(t.conversationId)).toBeNull();
    await t.makeDue();
    await t.deliveries.sweepPending();
    expect(t.wakeup).toHaveBeenCalledOnce();

    const [boardChild] = await db
      .insert(issues)
      .values({ companyId: t.companyId, title: "Filed on the board", status: "done", parentId: t.conversationId, assigneeAgentId: t.arif })
      .returning();
    expect(boardChild).toBeTruthy();
    expect(await t.svc.getWakeableParentAfterChildCompletion(t.conversationId)).toMatchObject({ id: t.conversationId });
  }, 60_000);

  it("keeps the rest of the conversation untouched: no answered triggers and no published final output", async () => {
    const t = await setup({ replyPolicy: "ask_owner" });
    const task = await t.delegate("Check the stock");
    await t.svc.update(task.id, { status: "done" });
    await t.makeDue();
    await t.deliveries.sweepPending();
    const turn = await t.startTurn((await t.wakeRuns())[0]!);
    expect(turn.guidance!.wakeEvent.policy.replyAllowed).toBe(true);
    const cross = await t.send(turn.runId, "elsewhere", { chat: "+628777000555" }).catch((error) => error);
    expect((cross as OpenwaToolError).code).toBe("completion_report_origin_only");
    await t.send(turn.runId, task.identifier + " selesai");
    expect(t.gateway.sends).toHaveLength(1);
    const [handoff] = await db.select().from(chatTaskHandoffs).where(and(eq(chatTaskHandoffs.taskId, task.id), eq(chatTaskHandoffs.companyId, t.companyId)));
    expect(handoff).toMatchObject({ channel: "openwa" });
  }, 60_000);
});
