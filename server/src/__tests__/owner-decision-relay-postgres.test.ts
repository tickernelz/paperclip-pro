import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  heartbeatRuns,
  issueComments,
  issueThreadInteractionOwnerRelays,
  issueThreadInteractions,
  issues,
  toolApplications,
  toolConnections,
} from "@tickernelz/paperclip-pro-db";
import { errorHandler } from "../middleware/index.js";
import { attentionRoutes } from "../routes/attention.js";
import { issueRoutes } from "../routes/issues.js";
import { OPENWA_RUN_CONTEXT_KEY } from "../services/openwa/authority.js";
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
});
