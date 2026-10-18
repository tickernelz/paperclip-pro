import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agentWakeupRequests,
  agents,
  approvals,
  authUsers,
  budgetIncidents,
  budgetPolicies,
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
  heartbeatRunEvents,
  heartbeatRuns,
  inboxDismissals,
  invites,
  issueComments,
  issueRecoveryActions,
  issueThreadInteractionOwnerRelays,
  issueThreadInteractions,
  issues,
  joinRequests,
  toolApplications,
  toolConnections,
} from "@tickernelz/paperclip-pro-db";
import { errorHandler } from "../middleware/index.js";
import { attentionRoutes } from "../routes/attention.js";
import { issueRoutes } from "../routes/issues.js";
import { OPENWA_RUN_CONTEXT_KEY } from "../services/openwa/authority.js";
import { ROUTABLE_BLOCKED_ROLLOUT_AT } from "../services/routable-blocked.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres owner relay tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

const OWNER_DIGITS = "628999000111";
const MEMBER_DIGITS = "628666000222";
const GROUP = "120363000000000777@g.us";
const SESSION = "relay-session";
const PLAN_PROMPT = "Setujui plan sembunyikan badge Hashy & lanjut implementasi?";

describeEmbeddedPostgres("owner-relayed decisions (routes + postgres)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-owner-relay-");
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
    testApp.use("/api", attentionRoutes(db));
    testApp.use(errorHandler);
    return testApp;
  }

  let prefixSequence = 0;

  async function seedCompany() {
    prefixSequence += 1;
    const prefix = "Z" + String.fromCharCode(65 + (prefixSequence % 26)) + randomUUID().replace(/[^a-f]/g, "").slice(0, 2).toUpperCase() + prefixSequence;
    const companyId = randomUUID();
    const wiraId = randomUUID();
    const nadiaId = randomUUID();
    const ownerUserId = "zhafron-" + companyId;
    const now = new Date();
    await db.insert(companies).values({ id: companyId, name: "HMX", issuePrefix: prefix, requireBoardApprovalForNewAgents: false });
    await db.insert(agents).values([
      { id: wiraId, companyId, name: "Wira", role: "engineer", status: "idle", adapterType: "codex_local", adapterConfig: {}, runtimeConfig: {}, permissions: {} },
      { id: nadiaId, companyId, name: "Nadia", role: "engineer", status: "idle", adapterType: "codex_local", adapterConfig: {}, runtimeConfig: {}, permissions: {} },
    ]);
    await db.insert(authUsers).values({ id: ownerUserId, name: "Zhafron", email: ownerUserId + "@example.test", createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: ownerUserId, status: "active", membershipRole: "owner" });

    const conversationIssueId = randomUUID();
    await db.insert(issues).values({
      id: conversationIssueId, companyId, identifier: prefix + "-1", title: "[BOT] HMX Paperclip", status: "in_progress",
      priority: "medium", assigneeAgentId: wiraId,
    });

    const endpointId = randomUUID();
    const applicationId = randomUUID();
    const connectionId = randomUUID();
    await db.insert(toolApplications).values({ id: applicationId, companyId, applicationKey: "chat:openwa:" + endpointId, name: "OpenWA", type: "chat", status: "active" });
    await db.insert(toolConnections).values({
      id: connectionId, companyId, applicationId, name: "OpenWA", uid: "chat-openwa-" + endpointId,
      connectionPurpose: "channel", transport: "chat_sdk", status: "active", enabled: true,
    });
    await db.insert(chatEndpoints).values({
      id: endpointId, companyId, connectionId, provider: "openwa", publicId: randomUUID(), assignedAgentId: wiraId,
      status: "active", providerAccountId: "http://gw#" + SESSION + "-" + endpointId, policy: {},
    });
    const [ownerPrincipal] = await db.insert(chatExternalPrincipals).values({
      companyId, provider: "openwa", providerAccountId: "acct-" + endpointId, externalId: OWNER_DIGITS + "@c.us", displayName: "Zhafron WA",
    }).returning();
    const [link] = await db.insert(chatIdentityLinks).values({
      companyId, endpointId, principalId: ownerPrincipal!.id, paperclipUserId: ownerUserId, status: "linked",
    }).returning();
    await db.insert(chatEndpointOwners).values({ companyId, endpointId, identityLinkId: link!.id, addedByUserId: ownerUserId });
    const [memberPrincipal] = await db.insert(chatExternalPrincipals).values({
      companyId, provider: "openwa", providerAccountId: "acct-" + endpointId, externalId: MEMBER_DIGITS + "@c.us", displayName: "Budi",
    }).returning();
    const providerResourceId = "openwa:" + SESSION + ":" + GROUP;
    const [resource] = await db.insert(chatEndpointResources).values({
      companyId, endpointId, type: "group_chat", providerResourceId, label: "[BOT] HMX Paperclip", enabled: true,
      metadata: { chatKey: GROUP }, settings: { activation: "on" },
    }).returning();
    const [conversation] = await db.insert(chatConversations).values({
      companyId, endpointId, issueId: conversationIssueId, resourceId: resource!.id, externalConversationId: providerResourceId,
      externalThreadId: providerResourceId, externalLabel: "[BOT] HMX Paperclip", state: "active", isDirectMessage: false,
    }).returning();
    return {
      prefix, companyId, wiraId, nadiaId, ownerUserId, conversationIssueId, endpointId,
      conversationId: conversation!.id, ownerPrincipalId: ownerPrincipal!.id, memberPrincipalId: memberPrincipal!.id,
    };
  }

  type Seed = Awaited<ReturnType<typeof seedCompany>>;

  async function seedPlanCard(seed: Seed, issueNumber: number, options: { visibility?: "open" | "private" } = {}) {
    const issueId = randomUUID();
    const identifier = seed.prefix + "-" + issueNumber;
    await db.insert(issues).values({
      id: issueId, companyId: seed.companyId, identifier, title: "Sembunyikan badge Hashy", status: "in_review",
      priority: "medium", assigneeAgentId: seed.nadiaId, visibility: options.visibility ?? "open",
    });
    const [card] = await db.insert(issueThreadInteractions).values({
      companyId: seed.companyId,
      issueId,
      kind: "request_confirmation",
      status: "pending",
      continuationPolicy: "wake_assignee",
      requestedResolverPolicy: "human_only",
      effectiveResolverPolicy: "human_only",
      resolverPolicyProvenance: "explicit",
      createdByAgentId: seed.nadiaId,
      title: "Plan approval",
      payload: { version: 1, prompt: PLAN_PROMPT, acceptLabel: "Setuju, implementasi", rejectLabel: "Tolak" } as never,
      createdAt: new Date(Date.now() - 60_000),
    }).returning({ id: issueThreadInteractions.id });
    return { issueId, identifier, interactionId: card!.id };
  }

  async function seedDelivery(seed: Seed, input: { text: string; owner: boolean }) {
    const waMessageId = "false_" + GROUP + "_" + randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase();
    const triggerClass = input.owner ? "owner" : "other";
    const role = input.owner ? "owner" : "allowed";
    const [row] = await db.insert(chatDeliveries).values({
      companyId: seed.companyId, endpointId: seed.endpointId, conversationId: seed.conversationId,
      principalId: input.owner ? seed.ownerPrincipalId : seed.memberPrincipalId,
      providerEventId: waMessageId, deduplicationKey: "openwa:" + SESSION + ":" + waMessageId, eventKind: "group_message",
      normalizedEvent: {
        message: { providerMessageId: waMessageId, text: input.text },
        openwa: { chatKey: GROUP, chatId: GROUP, chatKind: "group", waMessageId, triggerClass, principalRole: role },
      },
      state: "processed", triggerClass, principalRole: role, answerState: "pending", receivedAt: new Date(),
    }).returning();
    return { deliveryId: row!.id, waMessageId };
  }

  async function seedOpenwaRun(seed: Seed, input: { triggerClass: "owner" | "other"; deliveryIds: string[]; principalId: string }) {
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId, companyId: seed.companyId, agentId: seed.wiraId, invocationSource: "assignment", triggerDetail: "system", status: "running",
      contextSnapshot: {
        issueId: seed.conversationIssueId,
        taskId: seed.conversationIssueId,
        source: "chat:openwa",
        [OPENWA_RUN_CONTEXT_KEY]: {
          endpointId: seed.endpointId, chatKey: GROUP, triggerClass: input.triggerClass, profile: input.triggerClass === "owner" ? "full" : "read_only",
          event: "message", grantIds: [], deliveryIds: input.deliveryIds, runAllowedCategories: [], grantedCategories: [],
          requesterPrincipalId: input.principalId, approvalRequestId: null, triggerPrincipalId: input.principalId,
        },
      },
    });
    return runId;
  }

  async function ownerRun(seed: Seed, text: string) {
    const message = await seedDelivery(seed, { text, owner: true });
    const runId = await seedOpenwaRun(seed, { triggerClass: "owner", deliveryIds: [message.deliveryId], principalId: seed.ownerPrincipalId });
    return { runId, ...message };
  }

  function wira(seed: Seed, runId: string) {
    return app({ type: "agent", source: "agent_jwt", companyId: seed.companyId, agentId: seed.wiraId, runId });
  }

  async function card(interactionId: string) {
    const [row] = await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.id, interactionId));
    return row!;
  }

  it("relays the owner's WhatsApp approval of a human-only plan card through the board path and wakes the requester", async () => {
    const seed = await seedCompany();
    const plan = await seedPlanCard(seed, 1524);
    const run = await ownerRun(seed, "Wira, lanjut aja sesuai plan");

    const blocked = await request(wira(seed, run.runId))
      .post(`/api/issues/${plan.issueId}/interactions/${plan.interactionId}/accept`)
      .send({});
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("interaction_human_only");
    expect(blocked.body.details.remediation).toContain("paperclipAnswerDecisionForOwner");

    const res = await request(wira(seed, run.runId))
      .post(`/api/issues/${plan.issueId}/interactions/${plan.interactionId}/answer-for-owner`)
      .send({ ownerMessageRef: run.waMessageId, decision: "approve" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      id: plan.interactionId,
      status: "accepted",
      resolvedByUserId: seed.ownerUserId,
      resolvedByAgentId: null,
      resolutionRelay: {
        channel: "whatsapp",
        ownerUserId: seed.ownerUserId,
        relayedByAgentId: seed.wiraId,
        runId: run.runId,
        ownerMessageRef: run.waMessageId,
      },
    });
    const stored = await card(plan.interactionId);
    expect(stored.status).toBe("accepted");
    expect(stored.resolvedByUserId).toBe(seed.ownerUserId);
    expect(stored.resolutionRelay?.relayedByAgentId).toBe(seed.wiraId);

    const activity = await db.select().from(activityLog)
      .where(and(eq(activityLog.companyId, seed.companyId), eq(activityLog.entityId, plan.issueId)));
    const accepted = activity.find((row) => row.action === "issue.thread_interaction_accepted");
    expect(accepted).toMatchObject({ actorType: "user", actorId: seed.ownerUserId, runId: run.runId });
    const relayed = activity.find((row) => row.action === "issue.thread_interaction_owner_relayed");
    expect(relayed).toMatchObject({ actorType: "agent", actorId: seed.wiraId, agentId: seed.wiraId, runId: run.runId });
    expect(relayed?.details).toMatchObject({
      interactionId: plan.interactionId,
      ownerUserId: seed.ownerUserId,
      relayedByAgentId: seed.wiraId,
      runId: run.runId,
      ownerMessageRef: run.waMessageId,
      channel: "whatsapp",
    });

    const wakes = await db.select().from(agentWakeupRequests)
      .where(and(eq(agentWakeupRequests.companyId, seed.companyId), eq(agentWakeupRequests.agentId, seed.nadiaId)));
    expect(wakes.length).toBeGreaterThan(0);
  }, 60_000);

  it("refuses a member-triggered run with owner_confirmation_required", async () => {
    const seed = await seedCompany();
    const plan = await seedPlanCard(seed, 1524);
    const message = await seedDelivery(seed, { text: "approve aja", owner: false });
    const runId = await seedOpenwaRun(seed, { triggerClass: "other", deliveryIds: [message.deliveryId], principalId: seed.memberPrincipalId });

    const res = await request(wira(seed, runId))
      .post(`/api/issues/${plan.issueId}/interactions/${plan.interactionId}/answer-for-owner`)
      .send({ ownerMessageRef: message.waMessageId, decision: "approve" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("owner_confirmation_required");
    expect((await card(plan.interactionId)).status).toBe("pending");
    expect(await db.select().from(issueThreadInteractionOwnerRelays).where(eq(issueThreadInteractionOwnerRelays.companyId, seed.companyId))).toEqual([]);
  }, 60_000);

  it("refuses a scheduled run that no human message started", async () => {
    const seed = await seedCompany();
    const plan = await seedPlanCard(seed, 1524);
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId, companyId: seed.companyId, agentId: seed.wiraId, invocationSource: "timer", triggerDetail: "system", status: "running",
      contextSnapshot: { issueId: seed.conversationIssueId, wakeReason: "heartbeat_timer" },
    });

    const res = await request(wira(seed, runId))
      .post(`/api/issues/${plan.issueId}/interactions/${plan.interactionId}/answer-for-owner`)
      .send({ ownerMessageRef: "false_anything", decision: "approve" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("owner_confirmation_required");
    expect((await card(plan.interactionId)).status).toBe("pending");
  }, 60_000);

  it("spends one owner message on one card unless the message names each card", async () => {
    const seed = await seedCompany();
    const first = await seedPlanCard(seed, 1524);
    const second = await seedPlanCard(seed, 1525);
    const run = await ownerRun(seed, "ok proceed");

    const answered = await request(wira(seed, run.runId))
      .post(`/api/issues/${first.issueId}/interactions/${first.interactionId}/answer-for-owner`)
      .send({ ownerMessageRef: run.waMessageId, decision: "approve" });
    expect(answered.status, JSON.stringify(answered.body)).toBe(200);

    const replay = await request(wira(seed, run.runId))
      .post(`/api/issues/${second.issueId}/interactions/${second.interactionId}/answer-for-owner`)
      .send({ ownerMessageRef: run.waMessageId, decision: "approve" });
    expect(replay.status).toBe(403);
    expect(replay.body.code).toBe("owner_confirmation_required");
    expect(replay.body.error).toContain("already answered");
    expect((await card(second.interactionId)).status).toBe("pending");

    const listed = await seedPlanCard(seed, 1526);
    const listedToo = await seedPlanCard(seed, 1527);
    const both = await ownerRun(seed, `approve ${listed.identifier} dan ${listedToo.identifier}`);
    for (const target of [listed, listedToo]) {
      const res = await request(wira(seed, both.runId))
        .post(`/api/issues/${target.issueId}/interactions/${target.interactionId}/answer-for-owner`)
        .send({ ownerMessageRef: both.waMessageId, decision: "approve" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
    const unnamed = await request(wira(seed, both.runId))
      .post(`/api/issues/${second.issueId}/interactions/${second.interactionId}/answer-for-owner`)
      .send({ ownerMessageRef: both.waMessageId, decision: "approve" });
    expect(unnamed.status).toBe(403);
    expect(unnamed.body.code).toBe("owner_confirmation_required");
  }, 90_000);

  it("returns 409 for a card that is already resolved", async () => {
    const seed = await seedCompany();
    const plan = await seedPlanCard(seed, 1524);
    await db.update(issueThreadInteractions)
      .set({ status: "accepted", resolvedByUserId: seed.ownerUserId, resolvedAt: new Date(), result: { version: 1, outcome: "accepted" } as never })
      .where(eq(issueThreadInteractions.id, plan.interactionId));
    const run = await ownerRun(seed, "lanjut");

    const res = await request(wira(seed, run.runId))
      .post(`/api/issues/${plan.issueId}/interactions/${plan.interactionId}/answer-for-owner`)
      .send({ ownerMessageRef: run.waMessageId, decision: "approve" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("interaction_already_resolved");
  }, 60_000);

  it("relays a board user's own comment that woke the run", async () => {
    const seed = await seedCompany();
    const plan = await seedPlanCard(seed, 1524);
    const [comment] = await db.insert(issueComments).values({
      companyId: seed.companyId, issueId: seed.conversationIssueId, authorType: "user", authorUserId: seed.ownerUserId,
      body: "Tolak dulu, badge Hashy tetap tampil",
    }).returning();
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId, companyId: seed.companyId, agentId: seed.wiraId, invocationSource: "automation", triggerDetail: "system", status: "running",
      contextSnapshot: { issueId: seed.conversationIssueId, wakeReason: "issue_commented", wakeCommentId: comment!.id, wakeCommentIds: [comment!.id] },
    });

    const res = await request(wira(seed, runId))
      .post(`/api/issues/${plan.issueId}/interactions/${plan.interactionId}/answer-for-owner`)
      .send({ ownerMessageRef: comment!.id, decision: "reject", reason: "Badge Hashy tetap tampil" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      status: "rejected",
      resolvedByUserId: seed.ownerUserId,
      resolutionRelay: { channel: "paperclip", ownerMessageRef: comment!.id, relayedByAgentId: seed.wiraId },
    });
  }, 60_000);

  it("lists the pending human-only plan card and hides issues the agent cannot read", async () => {
    const seed = await seedCompany();
    const plan = await seedPlanCard(seed, 1524);
    const hidden = await seedPlanCard(seed, 1600, { visibility: "private" });
    const runId = await seedOpenwaRun(seed, { triggerClass: "owner", deliveryIds: [], principalId: seed.ownerPrincipalId });

    const res = await request(wira(seed, runId)).get(`/api/companies/${seed.companyId}/pending-decisions`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const ids = res.body.items.map((item: { id: string }) => item.id);
    expect(ids).toContain(plan.interactionId);
    expect(ids).not.toContain(hidden.interactionId);
    expect(res.body.items.find((item: { id: string }) => item.id === plan.interactionId)).toMatchObject({
      source: "interaction",
      kind: "request_confirmation",
      issueId: plan.issueId,
      issueIdentifier: plan.identifier,
      prompt: PLAN_PROMPT,
      options: [
        { id: "approve", label: "Setuju, implementasi" },
        { id: "reject", label: "Tolak" },
      ],
      humanOnly: true,
      requestedByAgentId: seed.nadiaId,
      requestedByAgentName: "Nadia",
      relayable: true,
      relayBlockedReason: null,
    });
  }, 60_000);

  const DESK_KINDS = [
    "approval",
    "issue_thread_interaction",
    "join_request",
    "recovery_action",
    "blocker_attention",
    "review",
    "failed_run",
    "budget_alert",
    "agent_error_alert",
  ];

  async function seedDesk(seed: Seed) {
    const plan = await seedPlanCard(seed, 1524);
    const [approval] = await db.insert(approvals).values({
      companyId: seed.companyId, type: "hire_agent", status: "pending", payload: { title: "Hire Designer" },
    }).returning({ id: approvals.id });
    const inviteId = randomUUID();
    await db.insert(invites).values({ id: inviteId, companyId: seed.companyId, tokenHash: "hash-" + inviteId, allowedJoinTypes: "both", expiresAt: new Date(Date.now() + 86_400_000) });
    await db.insert(joinRequests).values({
      inviteId, companyId: seed.companyId, requestType: "human", status: "pending_approval", requestIp: "127.0.0.1", requestEmailSnapshot: "new@paperclip.test",
    });
    const recoveryIssueId = randomUUID();
    const reviewIssueId = randomUUID();
    const blockedIssueId = randomUUID();
    await db.insert(issues).values([
      { id: recoveryIssueId, companyId: seed.companyId, identifier: seed.prefix + "-2001", title: "Needs recovery", status: "in_progress", priority: "medium", assigneeAgentId: seed.nadiaId },
      {
        id: reviewIssueId, companyId: seed.companyId, identifier: seed.prefix + "-2002", title: "Human review", status: "in_review", priority: "medium",
        executionState: {
          status: "pending", currentStageId: null, currentStageIndex: null, currentStageType: "review", currentParticipant: { type: "user", userId: seed.ownerUserId },
          returnAssignee: null, reviewRequest: null, completedStageIds: [], lastDecisionId: null, lastDecisionOutcome: null, monitor: null,
        } as never,
      },
      {
        id: blockedIssueId, companyId: seed.companyId, identifier: seed.prefix + "-2003", title: "Needs the board", status: "blocked", priority: "medium",
        unblockDescriptor: { owner: "board", action: "Approve the exception" } as never, blockedTransitionAt: new Date(ROUTABLE_BLOCKED_ROLLOUT_AT.getTime() + 60_000),
      },
    ]);
    await db.insert(issueRecoveryActions).values({
      companyId: seed.companyId, sourceIssueId: recoveryIssueId, kind: "missing_disposition", status: "escalated", ownerType: "board", cause: "missing_disposition",
      fingerprint: "human-recovery", evidence: {}, nextAction: "Choose the final disposition.",
    });
    await db.insert(agents).values({
      companyId: seed.companyId, name: "Broken Agent", role: "engineer", status: "error", errorReason: "adapter config missing",
      adapterType: "codex_local", adapterConfig: {}, runtimeConfig: {}, permissions: {},
    });
    const failedRunId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: failedRunId, companyId: seed.companyId, agentId: seed.nadiaId, invocationSource: "automation", status: "failed", error: "adapter failed", errorCode: "adapter_failed",
      contextSnapshot: { issueId: reviewIssueId }, scheduledRetryAttempt: 4, scheduledRetryReason: "transient_failure", finishedAt: new Date(),
    });
    await db.insert(heartbeatRunEvents).values({
      companyId: seed.companyId, runId: failedRunId, agentId: seed.nadiaId, seq: 1, eventType: "lifecycle",
      message: "Bounded retry exhausted after 4 scheduled attempts; no further automatic retry will be queued",
      payload: { retryReason: "transient_failure", maxAttempts: 4 },
    });
    const [policy] = await db.insert(budgetPolicies).values({
      companyId: seed.companyId, scopeType: "agent", scopeId: seed.nadiaId, metric: "billed_cents", windowKind: "calendar_month_utc", amount: 100,
    }).returning({ id: budgetPolicies.id });
    await db.insert(budgetIncidents).values({
      companyId: seed.companyId, policyId: policy!.id, scopeType: "agent", scopeId: seed.nadiaId, metric: "billed_cents", windowKind: "calendar_month_utc",
      windowStart: new Date("2026-10-01T00:00:00.000Z"), windowEnd: new Date("2026-11-01T00:00:00.000Z"), thresholdType: "hard", amountLimit: 100, amountObserved: 100, status: "open",
    });
    return { plan, approvalId: approval!.id, reviewIssueId };
  }

  function ownerAgent(seed: Seed, runId: string | undefined, extra: Record<string, unknown> = {}) {
    const onBehalfOfUserId = "onBehalfOfUserId" in extra ? extra.onBehalfOfUserId : seed.ownerUserId;
    const onBehalfOfMemberships = onBehalfOfUserId === seed.ownerUserId
      ? [{ companyId: seed.companyId, status: "active", membershipRole: "owner" }]
      : [];
    return app({ type: "agent", source: "agent_jwt", companyId: seed.companyId, agentId: seed.wiraId, runId, onBehalfOfUserId, onBehalfOfMemberships, ...extra });
  }

  function boardOwner(seed: Seed) {
    return app({ type: "board", source: "session", userId: seed.ownerUserId, companyIds: [seed.companyId], isInstanceAdmin: false });
  }

  async function plainRun(seed: Seed, contextSnapshot: Record<string, unknown> = {}) {
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId, companyId: seed.companyId, agentId: seed.wiraId, invocationSource: "automation", triggerDetail: "system", status: "running", contextSnapshot,
    });
    return runId;
  }

  const deskUrl = (seed: Seed, query = "") => `/api/companies/${seed.companyId}/pending-decisions?scope=desk${query}`;

  it("lets an owner run read every source kind with the same counts and order as the Decisions page", async () => {
    const seed = await seedCompany();
    const desk = await seedDesk(seed);
    const runId = await seedOpenwaRun(seed, { triggerClass: "owner", deliveryIds: [], principalId: seed.ownerPrincipalId });

    const res = await request(ownerAgent(seed, runId)).get(deskUrl(seed));
    const page = await request(boardOwner(seed)).get(`/api/companies/${seed.companyId}/attention`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(page.status, JSON.stringify(page.body)).toBe(200);
    expect(res.body.scope).toBe("desk");
    expect(new Set(res.body.items.map((item: { sourceKind: string }) => item.sourceKind))).toEqual(new Set(DESK_KINDS));
    expect(res.body.totalCount).toBe(page.body.totalCount);
    expect(res.body.countsBySourceKind).toEqual(page.body.countsBySourceKind);
    expect(res.body.items.map((item: { id: string }) => item.id)).toEqual(page.body.items.map((item: { subject: { id: string } }) => item.subject.id));
    const byKind = (kind: string) => res.body.items.find((item: { sourceKind: string }) => item.sourceKind === kind);
    expect(byKind("issue_thread_interaction")).toMatchObject({
      id: desk.plan.interactionId, issueIdentifier: desk.plan.identifier, relayable: true, relayBlockedReason: null, open: true,
    });
    expect(byKind("approval")).toMatchObject({ id: desk.approvalId, relayable: false, relayBlockedReason: expect.stringContaining("Board approvals") });
    expect(byKind("recovery_action")).toMatchObject({
      issueIdentifier: seed.prefix + "-2001", relayable: false, relayBlockedReason: expect.stringContaining("paperclipContinueIssueForOwner"),
    });
    expect(byKind("review")).toMatchObject({ issueIdentifier: seed.prefix + "-2002", relayable: false });
    for (const item of res.body.items) {
      expect(item.entryRule).toBeTruthy();
      expect(item.exitRule).toBeTruthy();
      expect(item.whyNow).toBeTruthy();
      expect(item.ageSeconds).toBeGreaterThanOrEqual(0);
      if (!item.relayable) expect(item.relayBlockedReason).toBeTruthy();
    }
  }, 60_000);

  it("marks the default list partial and counts what it leaves out for an owner run only", async () => {
    const seed = await seedCompany();
    await seedDesk(seed);
    const ownerRunId = await seedOpenwaRun(seed, { triggerClass: "owner", deliveryIds: [], principalId: seed.ownerPrincipalId });
    const memberRunId = await seedOpenwaRun(seed, { triggerClass: "other", deliveryIds: [], principalId: seed.memberPrincipalId });
    const url = `/api/companies/${seed.companyId}/pending-decisions`;

    const owner = await request(ownerAgent(seed, ownerRunId)).get(url);
    const desk = await request(ownerAgent(seed, ownerRunId)).get(deskUrl(seed));
    const member = await request(ownerAgent(seed, memberRunId)).get(url);

    expect(owner.status, JSON.stringify(owner.body)).toBe(200);
    expect(owner.body).toMatchObject({ scope: "relay", partial: true, note: expect.stringContaining("scope=desk") });
    expect(owner.body.omittedCount).toBe(desk.body.totalCount - owner.body.items.length);
    expect(owner.body.omittedCount).toBeGreaterThan(0);
    expect(member.status, JSON.stringify(member.body)).toBe(200);
    expect(member.body).toMatchObject({ scope: "relay", partial: true, omittedCount: null });
    expect(member.body.items.map((item: { id: string }) => item.id)).toEqual(owner.body.items.map((item: { id: string }) => item.id));
  }, 60_000);

  it("refuses the desk to every run that is not the owner's, while the relay list stays as it was", async () => {
    const seed = await seedCompany();
    await seedDesk(seed);
    const ownerRunId = await seedOpenwaRun(seed, { triggerClass: "owner", deliveryIds: [], principalId: seed.ownerPrincipalId });
    const memberRunId = await seedOpenwaRun(seed, { triggerClass: "other", deliveryIds: [], principalId: seed.memberPrincipalId });
    const forbidden = (res: request.Response, reason: string) => {
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body.details ?? res.body).toMatchObject({ code: "decisions_desk_forbidden", reason });
    };

    forbidden(await request(ownerAgent(seed, memberRunId)).get(deskUrl(seed)), "not_owner_run");
    forbidden(await request(ownerAgent(seed, ownerRunId, { onBehalfOfUserId: null })).get(deskUrl(seed)), "owner_context_required");
    forbidden(await request(ownerAgent(seed, undefined)).get(deskUrl(seed)), "run_required");
    forbidden(await request(ownerAgent(seed, ownerRunId, { agentId: seed.nadiaId })).get(deskUrl(seed)), "run_not_active");
    forbidden(await request(ownerAgent(seed, await plainRun(seed))).get(deskUrl(seed)), "not_owner_run");
    forbidden(
      await request(ownerAgent(seed, await plainRun(seed), { agentRole: "ceo", agentStatus: "idle", onBehalfOfUserId: "stranger-" + randomUUID() })).get(deskUrl(seed)),
      "owner_not_member",
    );
    expect((await request(ownerAgent(seed, ownerRunId)).get(deskUrl(seed))).status).toBe(200);
  }, 60_000);

  it("admits a plain run only when the owner's own comment woke it or the agent is a CEO", async () => {
    const seed = await seedCompany();
    await seedDesk(seed);
    const [questionIssue] = await db.insert(issues).values({
      companyId: seed.companyId, identifier: seed.prefix + "-3001", title: "Owner question", status: "in_progress", priority: "medium", assigneeAgentId: seed.wiraId,
    }).returning({ id: issues.id });
    const [comment] = await db.insert(issueComments).values({
      companyId: seed.companyId, issueId: questionIssue!.id, authorType: "user", authorUserId: seed.ownerUserId, body: "Apa yang menunggu saya?",
    }).returning();
    const [agentComment] = await db.insert(issueComments).values({
      companyId: seed.companyId, issueId: questionIssue!.id, authorType: "agent", authorAgentId: seed.nadiaId, body: "Apa yang menunggu saya?",
    }).returning();
    const woken = await plainRun(seed, { issueId: questionIssue!.id, wakeReason: "issue_commented", wakeCommentId: comment!.id, wakeCommentIds: [comment!.id] });
    const wokenByAgent = await plainRun(seed, { issueId: questionIssue!.id, wakeReason: "issue_commented", wakeCommentId: agentComment!.id, wakeCommentIds: [agentComment!.id] });
    const idle = await plainRun(seed, { issueId: questionIssue!.id });

    expect((await request(ownerAgent(seed, woken)).get(deskUrl(seed))).status).toBe(200);
    expect((await request(ownerAgent(seed, wokenByAgent)).get(deskUrl(seed))).status).toBe(403);
    expect((await request(ownerAgent(seed, idle)).get(deskUrl(seed))).status).toBe(403);
    expect((await request(ownerAgent(seed, idle, { agentRole: "ceo", agentStatus: "idle" })).get(deskUrl(seed))).status).toBe(200);
  }, 60_000);

  it("keeps the desk inside the issues the agent can read and inside its own company", async () => {
    const seed = await seedCompany();
    const visible = await seedPlanCard(seed, 1524);
    const hidden = await seedPlanCard(seed, 1600, { visibility: "private" });
    const runId = await seedOpenwaRun(seed, { triggerClass: "owner", deliveryIds: [], principalId: seed.ownerPrincipalId });

    const res = await request(ownerAgent(seed, runId)).get(deskUrl(seed));
    const ids = res.body.items.map((item: { id: string }) => item.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(ids).toContain(visible.interactionId);
    expect(ids).not.toContain(hidden.interactionId);

    const other = await seedCompany();
    const crossRes = await request(ownerAgent(seed, runId)).get(`/api/companies/${other.companyId}/pending-decisions?scope=desk`);
    expect(crossRes.status).toBe(403);
  }, 60_000);

  it("pages and filters the desk like the Decisions page", async () => {
    const seed = await seedCompany();
    const desk = await seedDesk(seed);
    const runId = await seedOpenwaRun(seed, { triggerClass: "owner", deliveryIds: [], principalId: seed.ownerPrincipalId });
    const agent = ownerAgent(seed, runId);

    const first = await request(agent).get(deskUrl(seed, "&limit=4"));
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.items).toHaveLength(4);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await request(agent).get(deskUrl(seed, "&limit=100&cursor=" + encodeURIComponent(first.body.nextCursor)));
    const everything = await request(agent).get(deskUrl(seed, "&limit=100"));
    expect([...first.body.items, ...second.body.items].map((item: { id: string }) => item.id)).toEqual(everything.body.items.map((item: { id: string }) => item.id));
    expect(first.body.totalCount).toBe(everything.body.totalCount);

    await db.insert(inboxDismissals).values({ companyId: seed.companyId, userId: seed.ownerUserId, itemKey: "attention:approval:" + desk.approvalId });
    const hiddenDismissed = await request(agent).get(deskUrl(seed, "&limit=100"));
    const shownDismissed = await request(agent).get(deskUrl(seed, "&limit=100&includeDismissed=true"));
    expect(hiddenDismissed.body.items.map((item: { id: string }) => item.id)).not.toContain(desk.approvalId);
    expect(shownDismissed.body.items.find((item: { id: string }) => item.id === desk.approvalId)).toMatchObject({ open: false });
    expect(hiddenDismissed.body.totalCount).toBe(everything.body.totalCount - 1);

    expect((await request(agent).get(deskUrl(seed, "&sort=bogus"))).status).toBe(400);
    expect((await request(agent).get(`/api/companies/${seed.companyId}/pending-decisions?scope=bogus`)).status).toBe(400);
  }, 60_000);
});
