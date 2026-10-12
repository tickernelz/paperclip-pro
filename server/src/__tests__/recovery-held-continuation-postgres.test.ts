import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agentWakeupRequests,
  agents,
  authUsers,
  chatConversations,
  chatDeliveries,
  chatEndpointOwners,
  chatEndpointResources,
  chatEndpoints,
  chatExternalPrincipals,
  chatIdentityLinks,
  companies,
  companyMemberships,
  createDb,
  environmentLeases,
  environments,
  heartbeatRuns,
  issueComments,
  issueRecoveryActions,
  issues,
  toolApplications,
  toolConnections,
} from "@tickernelz/paperclip-pro-db";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";
import { boardAuthService } from "../services/board-auth.js";
import { getExecutionBlocker } from "../services/execution-blocker.js";
import { buildExecutionContinuation } from "../services/execution-continuation.js";
import { heartbeatService } from "../services/heartbeat.js";
import { OPENWA_RUN_CONTEXT_KEY } from "../services/openwa/authority.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = support.supported ? describe : describe.skip;

const OWNER_DIGITS = "628999000333";
const MEMBER_DIGITS = "628666000444";
const GROUP = "120363000000000888@g.us";
const SESSION = "recovery-session";
const STOPPED_AT = new Date(Date.now() - 30 * 60_000);

describeEmbeddedPostgres("continuing a recovery-held issue (routes + postgres)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-recovery-continue-");
    db = createDb(tempDb.connectionString);
  }, 60_000);

  afterAll(async () => {
    await db.$client.end();
    await tempDb?.cleanup();
  });

  function app(actor: Record<string, unknown>) {
    const testApp = express();
    testApp.use(express.json());
    testApp.use((req, _res, next) => {
      (req as any).actor = actor;
      next();
    });
    testApp.use("/api", issueRoutes(db, {} as any, {}));
    testApp.use(errorHandler);
    return testApp;
  }

  let sequence = 0;
  let localEnvironment: Promise<string> | null = null;
  const localEnvironmentId = () => localEnvironment ??= db.select({ id: environments.id }).from(environments)
    .where(eq(environments.driver, "local")).then(rows => rows[0]!.id);

  async function seed() {
    sequence += 1;
    const prefix = "R" + String.fromCharCode(65 + (sequence % 26)) + randomUUID().replace(/[^a-f]/g, "").slice(0, 2).toUpperCase() + sequence;
    const companyId = randomUUID();
    const arifId = randomUUID();
    const wiraId = randomUUID();
    const ownerUserId = "owner-" + companyId;
    const now = new Date();
    await db.insert(companies).values({ id: companyId, name: "Apollo", issuePrefix: prefix, requireBoardApprovalForNewAgents: false });
    await db.insert(agents).values([
      { id: arifId, companyId, name: "Arif", role: "engineer", status: "idle", adapterType: "omp_local", adapterConfig: {},
        runtimeConfig: { heartbeat: { maxConcurrentRuns: 1 } }, permissions: {} },
      { id: wiraId, companyId, name: "Wira", role: "engineer", status: "idle", adapterType: "omp_local", adapterConfig: {}, runtimeConfig: {}, permissions: {} },
    ]);
    await db.insert(authUsers).values({ id: ownerUserId, name: "Owner", email: ownerUserId + "@example.test", createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: ownerUserId, status: "active", membershipRole: "owner" });

    const issueId = randomUUID();
    await db.insert(issues).values({ id: issueId, companyId, identifier: prefix + "-1511", title: "Ship the deploy helper", status: "blocked",
      priority: "medium", assigneeAgentId: arifId });
    const sourceRunId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: sourceRunId, companyId, agentId: arifId, invocationSource: "assignment", triggerDetail: "system",
      status: "cancelled", runtimeMode: "legacy", errorCode: "cancelled", error: "OMP exited with code 130.", exitCode: 130,
      processPid: 999_999_991, processGroupId: 999_999_991, startedAt: new Date(STOPPED_AT.getTime() - 37 * 60_000), finishedAt: STOPPED_AT,
      contextSnapshot: { issueId, taskId: issueId, wakeReason: "issue_assigned" },
      runnerProfileJson: { adapterDispatch: { adapterType: "omp_local" } },
      resultJson: { cancellation: { source: "unknown", expected: false, initiator: { type: "system" },
        reason: "Execution stopped without a recorded cancellation request: OMP exited with code 130.", recordedAt: STOPPED_AT.toISOString() } },
    });
    const environmentId = await localEnvironmentId();
    await db.insert(environmentLeases).values({ companyId, environmentId, heartbeatRunId: sourceRunId, issueId,
      provider: "local", status: "expired", leasePolicy: "ephemeral", releasedAt: STOPPED_AT });
    const [action] = await db.insert(issueRecoveryActions).values({
      companyId, sourceIssueId: issueId, kind: "active_run_watchdog", cause: "legacy_execution_requires_reconciliation",
      fingerprint: "legacy-execution:" + sourceRunId, status: "resolved", outcome: "blocked", ownerType: "board", returnOwnerAgentId: arifId,
      attemptCount: 1, maxAttempts: 3, resolvedAt: STOPPED_AT,
      nextAction: "Automatic recovery stopped. Recorded work is preserved; actions with unverified outcomes will not be repeated.",
      evidence: { runId: sourceRunId, attempt: 1, adapterRecovery: "unsupported_or_unknown", originalFailureCode: "cancelled",
        automaticRecovery: { runId: sourceRunId, policy: "preserve_without_replay_v1", replay: "blocked", actionOutcome: "unknown", recordedAt: STOPPED_AT.toISOString() } },
    }).returning();
    await db.insert(heartbeatRuns).values({ companyId, agentId: arifId, status: "running", runtimeMode: "legacy", contextSnapshot: {} });

    const endpointId = randomUUID();
    const applicationId = randomUUID();
    const connectionId = randomUUID();
    const conversationIssueId = randomUUID();
    await db.insert(issues).values({ id: conversationIssueId, companyId, identifier: prefix + "-1", title: "[BOT] Apollo", status: "in_progress",
      priority: "medium", assigneeAgentId: wiraId });
    await db.insert(toolApplications).values({ id: applicationId, companyId, applicationKey: "chat:openwa:" + endpointId, name: "OpenWA", type: "chat", status: "active" });
    await db.insert(toolConnections).values({ id: connectionId, companyId, applicationId, name: "OpenWA", uid: "chat-openwa-" + endpointId,
      connectionPurpose: "channel", transport: "chat_sdk", status: "active", enabled: true });
    await db.insert(chatEndpoints).values({ id: endpointId, companyId, connectionId, provider: "openwa", publicId: randomUUID(), assignedAgentId: wiraId,
      status: "active", providerAccountId: "http://gw#" + SESSION + "-" + endpointId, policy: {} });
    const [ownerPrincipal] = await db.insert(chatExternalPrincipals).values({ companyId, provider: "openwa", providerAccountId: "acct-" + endpointId,
      externalId: OWNER_DIGITS + "@c.us", displayName: "Owner WA" }).returning();
    const [link] = await db.insert(chatIdentityLinks).values({ companyId, endpointId, principalId: ownerPrincipal!.id, paperclipUserId: ownerUserId, status: "linked" }).returning();
    await db.insert(chatEndpointOwners).values({ companyId, endpointId, identityLinkId: link!.id, addedByUserId: ownerUserId });
    const [memberPrincipal] = await db.insert(chatExternalPrincipals).values({ companyId, provider: "openwa", providerAccountId: "acct-" + endpointId,
      externalId: MEMBER_DIGITS + "@c.us", displayName: "Member" }).returning();
    const providerResourceId = "openwa:" + SESSION + ":" + GROUP;
    const [resource] = await db.insert(chatEndpointResources).values({ companyId, endpointId, type: "group_chat", providerResourceId, label: "[BOT] Apollo",
      enabled: true, metadata: { chatKey: GROUP }, settings: { activation: "on" } }).returning();
    const [conversation] = await db.insert(chatConversations).values({ companyId, endpointId, issueId: conversationIssueId, resourceId: resource!.id,
      externalConversationId: providerResourceId, externalThreadId: providerResourceId, externalLabel: "[BOT] Apollo", state: "active", isDirectMessage: false }).returning();
    return { prefix, companyId, arifId, wiraId, ownerUserId, issueId, sourceRunId, actionId: action!.id, endpointId, conversationIssueId,
      conversationId: conversation!.id, ownerPrincipalId: ownerPrincipal!.id, memberPrincipalId: memberPrincipal!.id };
  }
  type Seed = Awaited<ReturnType<typeof seed>>;

  async function relayRun(seed: Seed, input: { text: string; owner: boolean; receivedAt?: Date }) {
    const waMessageId = "false_" + GROUP + "_" + randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase();
    const triggerClass = input.owner ? "owner" : "other";
    const role = input.owner ? "owner" : "allowed";
    const principalId = input.owner ? seed.ownerPrincipalId : seed.memberPrincipalId;
    const [delivery] = await db.insert(chatDeliveries).values({
      companyId: seed.companyId, endpointId: seed.endpointId, conversationId: seed.conversationId, principalId,
      providerEventId: waMessageId, deduplicationKey: "openwa:" + SESSION + ":" + waMessageId, eventKind: "group_message",
      normalizedEvent: { message: { providerMessageId: waMessageId, text: input.text },
        openwa: { chatKey: GROUP, chatId: GROUP, chatKind: "group", waMessageId, triggerClass, principalRole: role } },
      state: "processed", triggerClass, principalRole: role, answerState: "pending", receivedAt: input.receivedAt ?? new Date(),
    }).returning();
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({ id: runId, companyId: seed.companyId, agentId: seed.wiraId, invocationSource: "assignment",
      triggerDetail: "system", status: "running", contextSnapshot: { issueId: seed.conversationIssueId, taskId: seed.conversationIssueId, source: "chat:openwa",
        [OPENWA_RUN_CONTEXT_KEY]: { endpointId: seed.endpointId, chatKey: GROUP, triggerClass, profile: input.owner ? "full" : "read_only",
          event: "message", grantIds: [], deliveryIds: [delivery!.id], runAllowedCategories: [], grantedCategories: [],
          requesterPrincipalId: principalId, approvalRequestId: null, triggerPrincipalId: principalId } } });
    return { runId, waMessageId };
  }

  async function owner(seed: Seed) {
    const access = await boardAuthService(db).resolveBoardAccess(seed.ownerUserId);
    return app({ type: "board", userId: seed.ownerUserId, userName: "Owner", userEmail: null, companyIds: access.companyIds,
      memberships: access.memberships, isInstanceAdmin: access.isInstanceAdmin, source: "session" });
  }

  const wira = (seed: Seed, runId: string) =>
    app({ type: "agent", source: "agent_jwt", companyId: seed.companyId, agentId: seed.wiraId, runId });

  const successor = (seed: Seed) => db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, seed.companyId),
    eq(heartbeatRuns.agentId, seed.arifId))).then(rows => rows.find(run => run.contextSnapshot?.explicitUserContinuation) ?? null);

  const action = (seed: Seed) => db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.id, seed.actionId)).then(rows => rows[0]!);

  it("a board user's own message on a recovery-held issue resolves the hold and starts a run with that message", async () => {
    const s = await seed();
    expect(await getExecutionBlocker(db, s.companyId, s.issueId)).toMatchObject({ recoveryActionId: s.actionId });
    const res = await request(await owner(s)).post("/api/issues/" + s.issueId + "/comments").send({ body: "Lanjutkan, aku sudah cek run-nya." });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    await vi.waitFor(async () => { expect(await successor(s)).not.toBeNull(); }, { timeout: 15_000 });
    const run = (await successor(s))!;
    expect(run.contextSnapshot).toMatchObject({ wakeCommentId: res.body.id, previousRunId: s.sourceRunId,
      explicitUserContinuation: { previousRunId: s.sourceRunId, commentId: res.body.id } });
    expect(await getExecutionBlocker(db, s.companyId, s.issueId)).toBeNull();
    expect(await action(s)).toMatchObject({ status: "resolved", outcome: "restored" });
    expect((await action(s)).evidence).toMatchObject({ explicitUserContinuation: { actorId: s.ownerUserId, commentId: res.body.id, runId: run.id },
      automaticRecovery: { actionOutcome: "unknown", replay: "explicit_user_continuation" } });
    const continuation = await buildExecutionContinuation({ db, companyId: s.companyId, issueId: s.issueId, agentId: s.arifId,
      runId: run.id, context: run.contextSnapshot!, summary: null, exposeLowTrustRaw: false });
    expect(continuation.objective).toBe("Lanjutkan, aku sudah cek run-nya.");
    expect(JSON.stringify(continuation.recoveryOutcomes)).toContain("actions with unverified outcomes will not be repeated");
  }, 60_000);

  it("a plain agent comment that the owner did not verify stays queued behind the hold", async () => {
    const s = await seed();
    const relay = await relayRun(s, { text: "kenapa masih blocked?", owner: false });
    const res = await request(wira(s, relay.runId)).post("/api/issues/" + s.issueId + "/comments").send({ body: "Zhafron asked to continue this task." });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    await vi.waitFor(async () => {
      const receipts = await db.select().from(agentWakeupRequests).where(and(eq(agentWakeupRequests.companyId, s.companyId), eq(agentWakeupRequests.agentId, s.arifId)));
      expect(receipts.find(row => row.status === "deferred_issue_execution")?.payload).toMatchObject({ executionWait: { reason: "execution_recovery" } });
    }, { timeout: 15_000 });
    expect(await successor(s)).toBeNull();
    expect(await getExecutionBlocker(db, s.companyId, s.issueId)).toMatchObject({ recoveryActionId: s.actionId });
    expect((await action(s)).evidence.explicitUserContinuation).toBeUndefined();
  }, 60_000);

  it("an owner-verified WhatsApp relay continues the issue as the owner and records the relay", async () => {
    const s = await seed();
    const relay = await relayRun(s, { text: "Wira, lanjutin ZHA-1511 ya, run-nya sudah aku cek", owner: true });
    const res = await request(wira(s, relay.runId)).post("/api/issues/" + s.issueId + "/continue-for-owner").send({ ownerMessageRef: relay.waMessageId });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ relay: { channel: "whatsapp", ownerUserId: s.ownerUserId, relayedByAgentId: s.wiraId,
      runId: relay.runId, ownerMessageRef: relay.waMessageId } });
    const [comment] = await db.select().from(issueComments).where(eq(issueComments.id, res.body.comment.id));
    expect(comment).toMatchObject({ authorType: "user", authorUserId: s.ownerUserId, authorAgentId: null, createdByRunId: null,
      body: "Wira, lanjutin ZHA-1511 ya, run-nya sudah aku cek" });
    await vi.waitFor(async () => { expect(await successor(s)).not.toBeNull(); }, { timeout: 15_000 });
    const run = (await successor(s))!;
    expect(run.contextSnapshot).toMatchObject({ explicitUserContinuation: { previousRunId: s.sourceRunId, commentId: comment!.id } });
    expect(await getExecutionBlocker(db, s.companyId, s.issueId)).toBeNull();
    expect(await action(s)).toMatchObject({ status: "resolved", outcome: "restored" });
    expect((await action(s)).evidence).toMatchObject({ explicitUserContinuation: { actorId: s.ownerUserId, commentId: comment!.id,
      ownerRelay: { channel: "whatsapp", relayedByAgentId: s.wiraId, runId: relay.runId, ownerMessageRef: relay.waMessageId } } });
    const activity = await db.select().from(activityLog).where(and(eq(activityLog.companyId, s.companyId), eq(activityLog.entityId, s.issueId)));
    expect(activity.find(row => row.action === "issue.execution_recovery_owner_relayed")).toMatchObject({ actorType: "agent", actorId: s.wiraId,
      runId: relay.runId, details: { ownerUserId: s.ownerUserId, ownerMessageRef: relay.waMessageId, channel: "whatsapp", commentId: comment!.id } });
  }, 60_000);

  it.each(["member", "predates_stop", "not_held"] as const)("refuses an unverified continuation relay: %s", async kind => {
    const s = await seed();
    if (kind === "not_held") await db.update(issueRecoveryActions).set({ evidence: { runId: s.sourceRunId } }).where(eq(issueRecoveryActions.id, s.actionId));
    const relay = await relayRun(s, { text: "lanjut", owner: kind !== "member",
      ...(kind === "predates_stop" ? { receivedAt: new Date(STOPPED_AT.getTime() - 60_000) } : {}) });
    const res = await request(wira(s, relay.runId)).post("/api/issues/" + s.issueId + "/continue-for-owner").send({ ownerMessageRef: relay.waMessageId });
    expect(res.status).toBe(kind === "not_held" ? 409 : 403);
    expect(res.body.code).toBe(kind === "not_held" ? "execution_recovery_not_held" : "owner_confirmation_required");
    expect(await db.select().from(issueComments).where(eq(issueComments.issueId, s.issueId))).toEqual([]);
    expect(await successor(s)).toBeNull();
  }, 60_000);

  it("a recovery hold with no new message stays held", async () => {
    const s = await seed();
    const wake = await heartbeatService(db).wakeup(s.arifId, { source: "automation", triggerDetail: "system", reason: "issue_blockers_resolved",
      requestedByActorType: "system", requestedByActorId: "issue_graph_liveness_backstop",
      payload: { issueId: s.issueId }, contextSnapshot: { issueId: s.issueId, wakeReason: "issue_blockers_resolved" } });
    expect(wake).toBeNull();
    expect(await successor(s)).toBeNull();
    expect(await getExecutionBlocker(db, s.companyId, s.issueId)).toMatchObject({ recoveryActionId: s.actionId });
    expect((await action(s)).evidence.explicitUserContinuation).toBeUndefined();
  }, 60_000);
});
