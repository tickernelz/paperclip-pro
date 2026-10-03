import { createHash, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  agentApiKeys,
  agentWakeupRequests,
  agents,
  authUsers,
  chatActions,
  chatConversations,
  chatDeliveries,
  chatEndpointOwners,
  chatEndpoints,
  chatExternalPrincipals,
  chatIdentityLinks,
  chatOwnerApprovalRequests,
  chatOwnerGrants,
  companies,
  companyMemberships,
  createDb,
  heartbeatRuns,
  issues,
  toolApplications,
  toolConnections,
  toolPolicies,
} from "@tickernelz/paperclip-pro-db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { actorMiddleware } from "../middleware/auth.js";
import { errorHandler } from "../middleware/error-handler.js";
import { createLocalAgentJwt } from "../agent-auth-jwt.js";
import { createRuntimeToolsToken } from "../runtime-tools-token.js";
import { runtimeConnectionIntentRoutes } from "../routes/connection-intents.js";
import { connectionIntentService } from "../services/connection-intents.js";
import { projectToolContext } from "../services/project-tool-context.js";
import { PaperclipRunnerToolAuthority } from "../services/native-runtime/paperclip-runner-tool-authority.js";
import { createToolGatewayService } from "../services/tool-gateway.js";
import {
  OpenwaApprovalRequiredError,
  applyOpenwaRunContext,
  assertOpenwaRunMay,
  isOpenwaConversationIssue,
  openwaAllowedCategories,
  openwaGrantScope,
  openwaHostGitHubAllowed,
  openwaReadOnlyRestDecision,
  openwaRunSuppressesMentionWakes,
  resolveOpenwaRunContext,
  type OpenwaRunContext,
} from "../services/openwa/authority.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
let databaseUrl = "";

function loggedDb() {
  const queries: string[] = [];
  const db = createDb(databaseUrl);
  const session = (db as unknown as { session: { logger: unknown; options: { logger?: unknown } } }).session;
  session.logger = { logQuery: (query: string) => { queries.push(query); } };
  session.options.logger = session.logger;
  return { queries, db };
}
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;
const BOARD_USER = "openwa-board";
const CHAT_KEY = "628111222333@c.us";

type Seed = Awaited<ReturnType<typeof seedCompany>>;

describe("openwaReadOnlyRestDecision", () => {
  const own = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";
  it.each([
    ["GET", `/api/companies/c/issues`, undefined],
    ["HEAD", `/api/issues/${other}`, undefined],
    ["OPTIONS", `/api/companies/c/projects`, undefined],
    ["POST", `/api/issues/${own}/comments`, { body: "hi" }],
    ["POST", `/api/companies/c/issues/${own}/attachments`, undefined],
    ["POST", `/api/issues/${own}/work-products`, {}],
    ["PUT", `/api/issues/${own}/documents/plan`, {}],
    ["POST", `/api/issues/${own}/checkout`, {}],
    ["POST", `/api/issues/${own}/release`, {}],
    ["PATCH", `/api/issues/${own}`, { status: "done", comment: "Finished" }],
    ["POST", "/api/mcp/paperclip", {}],
    ["POST", "/api/tool-gateway/tools/call", {}],
    ["POST", "/api/companies/c/email/send", {}],
    ["POST", `/api/companies/c/openwa/tasks/${own}/tools`, {}],
  ])("allows %s %s", (method, path, body) => {
    expect(openwaReadOnlyRestDecision({ method, path, ownIssueId: own, body })).toEqual({ allowed: true });
  });

  it.each([
    ["POST", "/api/companies/c/issues", {}, "create_task"],
    ["POST", `/api/issues/${own}/children`, {}, "create_task"],
    ["POST", "/api/companies/c/projects", {}, "create_task"],
    ["PATCH", `/api/issues/${own}`, { assigneeAgentId: other }, "create_task"],
    ["PATCH", `/api/issues/${other}`, { assigneeUserId: "u" }, "create_task"],
    ["PATCH", `/api/issues/${own}`, { title: "renamed" }, "external_tools"],
    ["POST", `/api/issues/${other}/comments`, { body: "hi" }, "external_tools"],
    ["PUT", `/api/issues/${other}/documents/plan`, {}, "external_tools"],
    ["DELETE", `/api/issues/${own}`, undefined, "external_tools"],
    ["POST", "/api/agents/me/secret-proposals", {}, "external_tools"],
    ["POST", "/api/companies/c/routines", {}, "external_tools"],
  ])("denies %s %s", (method, path, body, category) => {
    expect(openwaReadOnlyRestDecision({ method, path, ownIssueId: own, body })).toEqual({ allowed: false, category });
  });

  it("matches paths case-insensitively like the Express router", () => {
    const upperOwn = own.toUpperCase();
    for (const [method, path, body] of [
      ["POST", "/API/Companies/c/ISSUES", {}],
      ["POST", `/Api/issues/${own}/children`, {}],
      ["POST", `/API/ISSUES/${upperOwn}/CHILDREN/`, {}],
      ["PATCH", `/API/Issues/${upperOwn}`, { assigneeAgentId: other }],
    ] as const) {
      expect(openwaReadOnlyRestDecision({ method, path, ownIssueId: own, body })).toEqual({ allowed: false, category: "create_task" });
    }
    expect(openwaReadOnlyRestDecision({ method: "POST", path: `/API/Issues/${upperOwn}/Comments`, ownIssueId: own, body: {} }))
      .toEqual({ allowed: true });
    expect(openwaReadOnlyRestDecision({ method: "POST", path: `/Api/Issues/${own}/Comments`, ownIssueId: upperOwn, body: {} }))
      .toEqual({ allowed: true });
    expect(openwaReadOnlyRestDecision({ method: "POST", path: `/API/Issues/${other}/Comments`, ownIssueId: own, body: {} }))
      .toEqual({ allowed: false, category: "external_tools" });
    expect(openwaReadOnlyRestDecision({ method: "POST", path: "/API/Companies/c/Routines", ownIssueId: own, body: {} }))
      .toEqual({ allowed: false, category: "external_tools" });
  });

  it("checks work products against the run's own issue", () => {
    const path = "/api/work-products/33333333-3333-4333-8333-333333333333";
    expect(openwaReadOnlyRestDecision({ method: "PATCH", path, ownIssueId: own })).toMatchObject({ allowed: "workProduct" });
    expect(openwaReadOnlyRestDecision({ method: "PATCH", path, ownIssueId: own, workProductIssueId: own })).toEqual({ allowed: true });
    expect(openwaReadOnlyRestDecision({ method: "PATCH", path, ownIssueId: own, workProductIssueId: other }))
      .toEqual({ allowed: false, category: "external_tools" });
  });

  it("allows the dispatcher routes whose inner seams decide", () => {
    for (const [method, path] of [
      ["POST", "/api/plugins/tools/execute"],
      ["POST", `/api/companies/c/slack/tasks/${own}/tools`],
      ["PUT", "/api/companies/c/slack/endpoints/e/search"],
      ["POST", "/api/mcp/project-tools"],
    ] as const) {
      expect(openwaReadOnlyRestDecision({ method, path, ownIssueId: own, body: {} })).toEqual({ allowed: true });
    }
  });
});

describe("openwaAllowedCategories", () => {
  const approvals = { createTask: true, externalTools: true, crossChatSend: true, waAdmin: true, gatewayAdmin: true, reminderMinutes: 30, maxReminders: 3, grantTtlHours: 24 };
  it("allows a category in read_only when its approval toggle is off", () => {
    expect(openwaAllowedCategories({ approvals }, "read_only", [], "read")).toEqual({
      allowed: [], approvalRequired: ["create_task", "external_tools", "cross_chat_send", "wa_admin", "gateway_admin"], unavailable: [],
    });
    expect(openwaAllowedCategories({ approvals: { ...approvals, createTask: false } }, "read_only", ["external_tools"], "off")).toEqual({
      allowed: ["create_task", "external_tools"], approvalRequired: ["cross_chat_send", "wa_admin"], unavailable: ["gateway_admin"],
    });
  });
});

async function seedCompany(db: ReturnType<typeof createDb>, opts: { openwa?: boolean } = {}) {
  const companyId = randomUUID();
  const agentId = randomUUID();
  const issueId = randomUUID();
  const endpointId = randomUUID();
  const prefix = `W${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
  await db.insert(companies).values({ id: companyId, name: "OpenWA authority", issuePrefix: prefix, issueCounter: 1 });
  await db.insert(companyMemberships).values({
    companyId, principalId: BOARD_USER, principalType: "user", status: "active", membershipRole: "owner",
  });
  await db.insert(agents).values({
    id: agentId, companyId, name: "OpenWA agent", role: "engineer", status: "idle",
    adapterType: "paperclip_runner", adapterConfig: {}, runtimeConfig: {}, permissions: {},
  });
  await db.insert(issues).values({
    id: issueId, companyId, issueNumber: 1, identifier: `${prefix}-1`, title: "WhatsApp chat",
    status: "in_progress", workMode: "standard", assigneeAgentId: agentId, responsibleUserId: BOARD_USER,
  });
  const applicationId = randomUUID();
  const connectionId = randomUUID();
  await db.insert(toolApplications).values({
    id: applicationId, companyId, applicationKey: `chat:openwa:${endpointId}`, name: "OpenWA", type: "chat", status: "active",
  });
  await db.insert(toolConnections).values({
    id: connectionId, companyId, applicationId, name: "OpenWA channel", uid: `chat-openwa-${endpointId}`,
    connectionPurpose: "channel", transport: "chat_sdk", status: "active", enabled: true,
  });
  await db.insert(chatEndpoints).values({
    id: endpointId, companyId, connectionId, provider: opts.openwa === false ? "telegram" : "openwa",
    publicId: randomUUID(), assignedAgentId: agentId, status: "active",
  });
  await db.insert(chatConversations).values({
    companyId, endpointId, issueId,
    externalConversationId: `openwa:session-1:${CHAT_KEY}`,
    externalThreadId: `openwa:session-1:${CHAT_KEY}`,
    externalLabel: "Member", state: "active", isDirectMessage: true,
  });
  return { companyId, agentId, issueId, endpointId };
}

async function seedPlainIssue(db: ReturnType<typeof createDb>, seed: Seed) {
  const issueId = randomUUID();
  await db.insert(issues).values({
    id: issueId, companyId: seed.companyId, title: "Plain task", status: "in_progress", assigneeAgentId: seed.agentId,
  });
  return issueId;
}

async function seedGrant(
  db: ReturnType<typeof createDb>,
  seed: Seed,
  input: {
    category: "create_task" | "external_tools"; scope?: "one_action" | "requester"; chatKey?: string; expiresAt?: Date;
    status?: "live" | "revoked"; requesterPrincipalId?: string; requestStatus?: "approved" | "pending" | "rejected";
  },
) {
  const [approval] = await db.insert(chatOwnerApprovalRequests).values({
    companyId: seed.companyId, endpointId: seed.endpointId, originChatKey: input.chatKey ?? CHAT_KEY,
    requestedByPrincipalId: input.requesterPrincipalId ?? null,
    categories: [input.category], scope: input.scope ?? "one_action", summary: "Create a task", proposedAction: "create",
    status: input.requestStatus ?? "approved",
  }).returning();
  const [grant] = await db.insert(chatOwnerGrants).values({
    companyId: seed.companyId, endpointId: seed.endpointId, requestId: approval!.id,
    originChatKey: input.chatKey ?? CHAT_KEY, category: input.category, scope: input.scope ?? "one_action",
    requesterPrincipalId: input.requesterPrincipalId ?? null,
    status: input.status ?? "live", approvedVia: "paperclip", approvedByUserId: BOARD_USER,
    expiresAt: input.expiresAt ?? new Date(Date.now() + 3_600_000),
  }).returning();
  return { grantId: grant!.id, requestId: approval!.id };
}

function openwaContext(seed: Seed, input: Partial<OpenwaRunContext>): OpenwaRunContext {
  const profile = input.profile ?? "read_only";
  return {
    endpointId: seed.endpointId, chatKey: CHAT_KEY, triggerClass: "other", profile,
    toolProfile: profile, event: null, grantIds: [], deliveryIds: [],
    runAllowedCategories: profile === "full" ? ["create_task", "external_tools", "cross_chat_send", "wa_admin"] : [],
    grantedCategories: [], requesterPrincipalId: null, approvalRequestId: null, ...input,
  };
}

async function seedRun(
  db: ReturnType<typeof createDb>,
  seed: Seed,
  input: { issueId?: string; profile?: "full" | "read_only" | null; openwa?: OpenwaRunContext | null; native?: boolean },
) {
  const runId = randomUUID();
  const issueId = input.issueId ?? seed.issueId;
  const contextSnapshot: Record<string, unknown> = { issueId, taskId: issueId };
  if (input.profile) contextSnapshot.paperclipToolProfile = input.profile;
  if (input.openwa) contextSnapshot.paperclipOpenwa = input.openwa;
  await db.insert(heartbeatRuns).values({
    id: runId, companyId: seed.companyId, agentId: seed.agentId, status: "running",
    invocationSource: "assignment", triggerDetail: "system", responsibleUserId: BOARD_USER,
    contextSnapshot, ...(input.native ? { runtimeMode: "native", nativeIssueId: issueId } : {}),
  });
  await db.update(issues).set({ executionRunId: runId }).where(eq(issues.id, issueId));
  return { runId, contextSnapshot };
}

async function seedWake(
  db: ReturnType<typeof createDb>,
  seed: Seed,
  input: {
    actorType: "user" | "agent" | "system"; actorId?: string | null; openwaClass?: string; deliveryIds?: string[];
    idempotencyKey?: string;
  },
) {
  const [wake] = await db.insert(agentWakeupRequests).values({
    companyId: seed.companyId, agentId: seed.agentId, source: "automation", reason: "test",
    payload: input.openwaClass ? { openwa: { triggerClass: input.openwaClass, deliveryIds: input.deliveryIds ?? [] } } : {},
    requestedByActorType: input.actorType, requestedByActorId: input.actorId ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
  }).returning();
  return wake!.id;
}

async function seedWakeAction(
  db: ReturnType<typeof createDb>,
  seed: Seed,
  input: { openwa: Record<string, unknown> | null; conversationId?: string | null },
) {
  const [conversation] = await db.select({ id: chatConversations.id }).from(chatConversations)
    .where(eq(chatConversations.issueId, seed.issueId));
  const [action] = await db.insert(chatActions).values({
    companyId: seed.companyId, endpointId: seed.endpointId,
    conversationId: input.conversationId === undefined ? conversation!.id : input.conversationId,
    kind: "inbound_wakeup", providerActionId: "wake:" + randomUUID(), status: "issued",
    payload: input.openwa ? { version: 1, openwa: input.openwa } : { version: 1 },
  }).returning();
  await db.insert(agentWakeupRequests).values({
    id: action!.id, companyId: seed.companyId, agentId: seed.agentId, source: "assignment", reason: "chat",
    payload: input.openwa ? { openwa: input.openwa } : {}, requestedByActorType: "system", requestedByActorId: null,
  }).onConflictDoNothing();
  return action!.id;
}

async function seedPrincipal(db: ReturnType<typeof createDb>, seed: Seed, externalId: string, opts: { owner?: boolean } = {}) {
  const [principal] = await db.insert(chatExternalPrincipals).values({
    companyId: seed.companyId, provider: "openwa", providerAccountId: "acct-" + seed.endpointId, externalId,
  }).returning();
  if (!opts.owner) return { principalId: principal!.id, linkId: null as string | null };
  const [link] = await db.insert(chatIdentityLinks).values({
    companyId: seed.companyId, endpointId: seed.endpointId, principalId: principal!.id, paperclipUserId: BOARD_USER, status: "linked",
  }).returning();
  await db.insert(chatEndpointOwners).values({ companyId: seed.companyId, endpointId: seed.endpointId, identityLinkId: link!.id });
  return { principalId: principal!.id, linkId: link!.id };
}

async function seedDelivery(
  db: ReturnType<typeof createDb>,
  seed: Seed,
  input: { principalId: string; triggerClass: "owner" | "other"; chatKey?: string },
) {
  const id = randomUUID();
  await db.insert(chatDeliveries).values({
    id, companyId: seed.companyId, endpointId: seed.endpointId, principalId: input.principalId,
    providerEventId: "evt-" + id, deduplicationKey: "openwa:test:" + id, eventKind: "direct_message",
    normalizedEvent: { openwa: { chatKey: input.chatKey ?? CHAT_KEY } }, state: "processed",
    triggerClass: input.triggerClass, principalRole: input.triggerClass === "owner" ? "owner" : "allowed", answerState: "pending",
  });
  return id;
}

describeEmbeddedPostgres("OpenWA run authority", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const previousSecret = process.env.PAPERCLIP_AGENT_JWT_SECRET;
  const previousInstance = process.env.PAPERCLIP_INSTANCE_ID;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-openwa-authority-");
    databaseUrl = tempDb.connectionString;
    db = createDb(tempDb.connectionString);
    await db.insert(authUsers).values({
      id: BOARD_USER, name: "Board", email: "board@openwa.test", emailVerified: true, createdAt: new Date(), updatedAt: new Date(),
    });
  }, 60_000);

  beforeEach(() => {
    process.env.PAPERCLIP_AGENT_JWT_SECRET = "openwa-authority-secret";
    delete process.env.PAPERCLIP_INSTANCE_ID;
  });

  afterEach(() => {
    if (previousSecret === undefined) delete process.env.PAPERCLIP_AGENT_JWT_SECRET;
    else process.env.PAPERCLIP_AGENT_JWT_SECRET = previousSecret;
    if (previousInstance === undefined) delete process.env.PAPERCLIP_INSTANCE_ID;
    else process.env.PAPERCLIP_INSTANCE_ID = previousInstance;
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  describe("profile resolution at run start", () => {
    const resolve = (seed: Seed, wakeupRequestId: string | null, contextSnapshot: Record<string, unknown> = {}, runId = randomUUID()) =>
      resolveOpenwaRunContext(db, { companyId: seed.companyId, issueId: seed.issueId, runId, contextSnapshot, wakeupRequestId });

    it("is read_only without a server-written wake record for agent, system, retry or missing wakes", async () => {
      const seed = await seedCompany(db);
      for (const wakeupRequestId of [
        await seedWake(db, seed, { actorType: "agent", actorId: seed.agentId }),
        await seedWake(db, seed, { actorType: "system" }),
        null,
      ]) {
        await expect(resolve(seed, wakeupRequestId, { issueId: seed.issueId })).resolves.toEqual(openwaContext(seed, {}));
      }
    });

    it("is full only for a board user wake without chat provenance", async () => {
      const seed = await seedCompany(db);
      const board = await seedWake(db, seed, { actorType: "user", actorId: BOARD_USER });
      await expect(resolve(seed, board)).resolves.toEqual(openwaContext(seed, { profile: "full" }));
      await expect(resolve(seed, board, { source: "chat:openwa" })).resolves.toMatchObject({ profile: "read_only" });
      await expect(resolve(seed, board, { chatFailedRunRetry: { version: 1 } })).resolves.toMatchObject({ profile: "read_only" });
      const inbound = await seedWake(db, seed, { actorType: "user", actorId: BOARD_USER, idempotencyKey: "chat-inbound:" + randomUUID() });
      await expect(resolve(seed, inbound)).resolves.toMatchObject({ profile: "read_only" });
      const action = await seedWakeAction(db, seed, { openwa: null });
      await db.update(agentWakeupRequests).set({ requestedByActorType: "user", requestedByActorId: BOARD_USER }).where(eq(agentWakeupRequests.id, action));
      await expect(resolve(seed, action)).resolves.toMatchObject({ profile: "read_only" });
    });

    it("derives owner only from admitted owner deliveries whose principal is still an owner", async () => {
      const seed = await seedCompany(db);
      const owner = await seedPrincipal(db, seed, "628999000111@c.us", { owner: true });
      const member = await seedPrincipal(db, seed, CHAT_KEY);
      const ownerDelivery = await seedDelivery(db, seed, { principalId: owner.principalId, triggerClass: "owner" });
      const memberDelivery = await seedDelivery(db, seed, { principalId: member.principalId, triggerClass: "other" });
      const ownerWake = await seedWakeAction(db, seed, { openwa: { event: "message", triggerClass: "owner", deliveryIds: [ownerDelivery] } });
      await expect(resolve(seed, ownerWake)).resolves.toEqual(openwaContext(seed, { triggerClass: "owner", profile: "full", event: "message", deliveryIds: [ownerDelivery] }));
      const mixed = await seedWakeAction(db, seed, { openwa: { event: "message", triggerClass: "owner", deliveryIds: [ownerDelivery, memberDelivery] } });
      const mixedContext = await resolve(seed, mixed);
      expect(mixedContext).toMatchObject({ triggerClass: "other", profile: "read_only", requesterPrincipalId: null });
      expect(mixedContext!.deliveryIds.sort()).toEqual([ownerDelivery, memberDelivery].sort());
      await db.update(chatIdentityLinks).set({ status: "revoked" }).where(eq(chatIdentityLinks.id, owner.linkId));
      await expect(resolve(seed, ownerWake)).resolves.toMatchObject({ triggerClass: "other", profile: "read_only" });
    });

    it("never trusts class claims in the wake payload or the copied context", async () => {
      const seed = await seedCompany(db);
      const owner = await seedPrincipal(db, seed, "628999000111@c.us", { owner: true });
      const ownerDelivery = await seedDelivery(db, seed, { principalId: owner.principalId, triggerClass: "owner" });
      const forged = await seedWake(db, seed, { actorType: "agent", actorId: seed.agentId, openwaClass: "owner", deliveryIds: [ownerDelivery] });
      await expect(resolve(seed, forged, {
        openwa: { triggerClass: "owner", deliveryIds: [ownerDelivery] },
        paperclipOpenwa: { triggerClass: "owner", profile: "full" },
        paperclipToolProfile: "full",
      })).resolves.toMatchObject({ triggerClass: "other", profile: "read_only", toolProfile: "read_only" });
      const otherConversation = await seedWakeAction(db, seed, {
        openwa: { event: "message", triggerClass: "owner", deliveryIds: [ownerDelivery] }, conversationId: null,
      });
      await expect(resolve(seed, otherConversation)).resolves.toMatchObject({ triggerClass: "other", profile: "read_only" });
    });

    it("resolves a grant run from an approved request with live grants of this chat and company", async () => {
      const seed = await seedCompany(db);
      const foreign = await seedCompany(db);
      const requester = await seedPrincipal(db, seed, CHAT_KEY);
      const live = await seedGrant(db, seed, { category: "create_task", requesterPrincipalId: requester.principalId });
      const expired = await seedGrant(db, seed, { category: "create_task", expiresAt: new Date(Date.now() - 1_000) });
      const otherChat = await seedGrant(db, seed, { category: "create_task", chatKey: "628999@c.us" });
      const foreignGrant = await seedGrant(db, foreign, { category: "create_task" });
      const wake = await seedWakeAction(db, seed, { openwa: { event: "approval_resolved", triggerClass: "grant", deliveryIds: [], approvalRequestId: live.requestId } });
      await expect(resolve(seed, wake, {
        paperclipOpenwa: { grantIds: [expired.grantId, otherChat.grantId, foreignGrant.grantId] },
      })).resolves.toEqual(openwaContext(seed, {
        triggerClass: "grant", event: "approval_resolved", grantIds: [live.grantId], approvalRequestId: live.requestId,
        requesterPrincipalId: requester.principalId,
      }));
      for (const request of [expired, otherChat]) {
        const stale = await seedWakeAction(db, seed, { openwa: { event: "approval_resolved", deliveryIds: [], approvalRequestId: request.requestId } });
        await expect(resolve(seed, stale)).resolves.toMatchObject({ triggerClass: "other", grantIds: [] });
      }
      const pending = await seedGrant(db, seed, { category: "create_task", requestStatus: "pending" });
      const unapproved = await seedWakeAction(db, seed, { openwa: { event: "approval_resolved", deliveryIds: [], approvalRequestId: pending.requestId } });
      await expect(resolve(seed, unapproved)).resolves.toMatchObject({ triggerClass: "other", grantIds: [] });
    });

    it("consumes a one_action external_tools grant at grant-run start and gives the run the full tool profile", async () => {
      const seed = await seedCompany(db);
      const grant = await seedGrant(db, seed, { category: "external_tools" });
      const run = await seedRun(db, seed, {});
      const wake = await seedWakeAction(db, seed, { openwa: { event: "approval_resolved", deliveryIds: [], approvalRequestId: grant.requestId } });
      const resolved = await resolve(seed, wake, {}, run.runId);
      expect(resolved).toMatchObject({ triggerClass: "grant", profile: "read_only", toolProfile: "full", grantedCategories: ["external_tools"], runAllowedCategories: ["external_tools"] });
      const [row] = await db.select().from(chatOwnerGrants).where(eq(chatOwnerGrants.id, grant.grantId));
      expect(row).toMatchObject({ status: "consumed", consumedByRunId: run.runId });
      await expect(resolve(seed, wake, {}, run.runId)).resolves.toMatchObject({ toolProfile: "full" });
      await expect(resolve(seed, wake, {}, (await seedRun(db, seed, {})).runId)).resolves.toMatchObject({ triggerClass: "other", toolProfile: "read_only" });
      const context: Record<string, unknown> = {};
      applyOpenwaRunContext(context, resolved);
      expect(context.paperclipToolProfile).toBe("full");
      await expect(assertOpenwaRunMay(db, { id: run.runId, companyId: seed.companyId, contextSnapshot: context }, "external_tools")).resolves.toBeNull();
      await expect(assertOpenwaRunMay(db, { id: run.runId, companyId: seed.companyId, contextSnapshot: context }, "create_task"))
        .rejects.toBeInstanceOf(OpenwaApprovalRequiredError);
    });

    it("gives an other run its single requester's live requester-scope grants and the full tool profile when externalTools approval is off", async () => {
      const seed = await seedCompany(db);
      const member = await seedPrincipal(db, seed, CHAT_KEY);
      const delivery = await seedDelivery(db, seed, { principalId: member.principalId, triggerClass: "other" });
      const reusable = await seedGrant(db, seed, { category: "create_task", scope: "requester", requesterPrincipalId: member.principalId });
      const someoneElse = await seedGrant(db, seed, { category: "create_task", scope: "requester", requesterPrincipalId: (await seedPrincipal(db, seed, "628777@c.us")).principalId });
      const wake = await seedWakeAction(db, seed, { openwa: { event: "message", triggerClass: "other", deliveryIds: [delivery] } });
      const resolved = await resolve(seed, wake);
      expect(resolved).toMatchObject({ triggerClass: "other", requesterPrincipalId: member.principalId, grantIds: [reusable.grantId], toolProfile: "read_only" });
      expect(resolved!.grantIds).not.toContain(someoneElse.grantId);
      await db.update(chatEndpoints).set({ policy: { approvals: { externalTools: false } } }).where(eq(chatEndpoints.id, seed.endpointId));
      await expect(resolve(seed, wake)).resolves.toMatchObject({ profile: "read_only", toolProfile: "full", runAllowedCategories: ["external_tools"] });
    });

    it("leaves runs on non-OpenWA issues untouched and scopes the binding by company", async () => {
      const seed = await seedCompany(db);
      const telegram = await seedCompany(db, { openwa: false });
      const plainIssue = await seedPlainIssue(db, seed);
      const runId = randomUUID();
      await expect(resolveOpenwaRunContext(db, {
        companyId: seed.companyId, issueId: plainIssue, runId, contextSnapshot: {}, wakeupRequestId: null,
      })).resolves.toBeNull();
      await expect(resolveOpenwaRunContext(db, {
        companyId: telegram.companyId, issueId: telegram.issueId, runId, contextSnapshot: {}, wakeupRequestId: null,
      })).resolves.toBeNull();
      await expect(resolveOpenwaRunContext(db, {
        companyId: telegram.companyId, issueId: seed.issueId, runId, contextSnapshot: {}, wakeupRequestId: null,
      })).resolves.toBeNull();
      await expect(isOpenwaConversationIssue(db, telegram.companyId, seed.issueId)).resolves.toBe(false);
      await expect(isOpenwaConversationIssue(db, seed.companyId, seed.issueId)).resolves.toBe(true);
      const context: Record<string, unknown> = { paperclipOpenwa: { triggerClass: "owner" } };
      applyOpenwaRunContext(context, null);
      expect(context).toEqual({ paperclipToolProfile: "full" });
    });

    it("suppresses mention wakes fail-closed by run profile", async () => {
      const seed = await seedCompany(db);
      const unmarked = await seedRun(db, seed, {});
      await expect(openwaRunSuppressesMentionWakes(db, { id: unmarked.runId, companyId: seed.companyId, contextSnapshot: unmarked.contextSnapshot })).resolves.toBe(true);
      const plain = await seedRun(db, seed, { issueId: await seedPlainIssue(db, seed) });
      await expect(openwaRunSuppressesMentionWakes(db, { id: plain.runId, companyId: seed.companyId, contextSnapshot: plain.contextSnapshot })).resolves.toBe(false);
      const owner = await seedRun(db, seed, { profile: "full", openwa: openwaContext(seed, { triggerClass: "owner", profile: "full" }) });
      await expect(openwaRunSuppressesMentionWakes(db, { id: owner.runId, companyId: seed.companyId, contextSnapshot: owner.contextSnapshot })).resolves.toBe(false);
      const toolFull = await seedRun(db, seed, { profile: "full", openwa: openwaContext(seed, { toolProfile: "full" }) });
      await expect(openwaRunSuppressesMentionWakes(db, { id: toolFull.runId, companyId: seed.companyId, contextSnapshot: toolFull.contextSnapshot })).resolves.toBe(true);
    });
  });

  describe("assertOpenwaRunMay", () => {
    it("allows full runs and denies read_only runs with a typed category", async () => {
      const seed = await seedCompany(db);
      const full = await seedRun(db, seed, { profile: "full", openwa: openwaContext(seed, { triggerClass: "owner", profile: "full" }) });
      await expect(assertOpenwaRunMay(db, { id: full.runId, companyId: seed.companyId, contextSnapshot: full.contextSnapshot }, "create_task")).resolves.toBeNull();
      const readOnly = await seedRun(db, seed, { profile: "read_only", openwa: openwaContext(seed, {}) });
      const error = await assertOpenwaRunMay(db, { id: readOnly.runId, companyId: seed.companyId, contextSnapshot: readOnly.contextSnapshot }, "external_tools").catch((err) => err);
      expect(error).toBeInstanceOf(OpenwaApprovalRequiredError);
      expect(error).toMatchObject({ status: 403, details: { code: "openwa_approval_required", category: "external_tools" } });
    });

    it("fails closed for a run on an OpenWA issue whose context has no profile", async () => {
      const seed = await seedCompany(db);
      const run = await seedRun(db, seed, {});
      await expect(assertOpenwaRunMay(db, { id: run.runId, companyId: seed.companyId, contextSnapshot: run.contextSnapshot }, "create_task"))
        .rejects.toBeInstanceOf(OpenwaApprovalRequiredError);
      const plain = await seedRun(db, seed, { issueId: await seedPlainIssue(db, seed) });
      await expect(assertOpenwaRunMay(db, { id: plain.runId, companyId: seed.companyId, contextSnapshot: plain.contextSnapshot }, "create_task"))
        .resolves.toBeNull();
    });

    it("consumes a one_action grant exactly once under concurrency and keeps requester grants", async () => {
      const seed = await seedCompany(db);
      const once = await seedGrant(db, seed, { category: "create_task" });
      const run = await seedRun(db, seed, { profile: "read_only", openwa: openwaContext(seed, { triggerClass: "grant", grantIds: [once.grantId] }) });
      const target = { id: run.runId, companyId: seed.companyId, contextSnapshot: run.contextSnapshot };
      await expect(assertOpenwaRunMay(db, target, "external_tools")).rejects.toBeInstanceOf(OpenwaApprovalRequiredError);
      const outcomes = await Promise.allSettled([1, 2, 3, 4].map(() => assertOpenwaRunMay(db, target, "create_task")));
      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.status === "rejected" && outcome.reason instanceof OpenwaApprovalRequiredError)).toHaveLength(3);
      const [row] = await db.select().from(chatOwnerGrants).where(eq(chatOwnerGrants.id, once.grantId));
      expect(row).toMatchObject({ status: "consumed", consumedByRunId: run.runId });
      await expect(assertOpenwaRunMay(db, target, "create_task", { consume: false })).rejects.toBeInstanceOf(OpenwaApprovalRequiredError);
      await expect(openwaGrantScope({ companyId: seed.companyId, runId: run.runId, grantId: once.grantId }, () =>
        assertOpenwaRunMay(db, target, "create_task", { consume: false }))).resolves.toBeNull();
      await expect(openwaGrantScope({ companyId: seed.companyId, runId: run.runId }, () =>
        assertOpenwaRunMay(db, target, "create_task"))).rejects.toBeInstanceOf(OpenwaApprovalRequiredError);

      const requester = await seedGrant(db, seed, { category: "external_tools", scope: "requester" });
      const reusable = await seedRun(db, seed, { profile: "read_only", openwa: openwaContext(seed, { triggerClass: "grant", grantIds: [requester.grantId] }) });
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await expect(assertOpenwaRunMay(db, { id: reusable.runId, companyId: seed.companyId, contextSnapshot: reusable.contextSnapshot }, "external_tools")).resolves.toBeNull();
      }
    });

    it("allows a category whose approval toggle is off in read_only and narrows when it is turned back on", async () => {
      const seed = await seedCompany(db);
      await db.update(chatEndpoints).set({ policy: { approvals: { createTask: false } } }).where(eq(chatEndpoints.id, seed.endpointId));
      const run = await seedRun(db, seed, { profile: "read_only", openwa: openwaContext(seed, { runAllowedCategories: ["create_task"] }) });
      const target = { id: run.runId, companyId: seed.companyId, contextSnapshot: run.contextSnapshot };
      await expect(assertOpenwaRunMay(db, target, "create_task")).resolves.toBeNull();
      await expect(assertOpenwaRunMay(db, target, "external_tools")).rejects.toBeInstanceOf(OpenwaApprovalRequiredError);
      await db.update(chatEndpoints).set({ policy: {} }).where(eq(chatEndpoints.id, seed.endpointId));
      await expect(assertOpenwaRunMay(db, target, "create_task")).rejects.toBeInstanceOf(OpenwaApprovalRequiredError);
    });

    it("never lets another company's run read or consume this endpoint's grants", async () => {
      const seed = await seedCompany(db);
      const foreign = await seedCompany(db);
      const grant = await seedGrant(db, seed, { category: "create_task" });
      const foreignRun = await seedRun(db, foreign, {
        profile: "read_only",
        openwa: { ...openwaContext(seed, { triggerClass: "grant", grantIds: [grant.grantId] }) },
      });
      await expect(assertOpenwaRunMay(db, { id: foreignRun.runId, companyId: foreign.companyId, contextSnapshot: foreignRun.contextSnapshot }, "create_task"))
        .rejects.toBeInstanceOf(OpenwaApprovalRequiredError);
      const [row] = await db.select().from(chatOwnerGrants).where(eq(chatOwnerGrants.id, grant.grantId));
      expect(row).toMatchObject({ status: "live", consumedByRunId: null });
    });
  });

  describe("JWT REST seam", () => {
    function app(
      handler: express.RequestHandler = (req, res) => { res.status(req.method === "POST" ? 201 : 200).json({ reached: true, actor: req.actor.type }); },
      database: ReturnType<typeof createDb> = db,
    ) {
      const server = express();
      server.use(express.json());
      server.use(actorMiddleware(database, { deploymentMode: "authenticated", resolveSession: async () => null }));
      server.all("/api/{*rest}", handler);
      server.use(errorHandler);
      return server;
    }
    async function grantStatus(grantId: string) {
      const [row] = await db.select({ status: chatOwnerGrants.status }).from(chatOwnerGrants).where(eq(chatOwnerGrants.id, grantId));
      return row!.status;
    }
    function jwt(seed: Seed, runId: string) {
      return createLocalAgentJwt(seed.agentId, seed.companyId, "process", runId, BOARD_USER)!;
    }

    it("denies read_only mutations outside the allowlist and allows the run's own lifecycle writes", async () => {
      const seed = await seedCompany(db);
      const run = await seedRun(db, seed, { profile: "read_only", openwa: openwaContext(seed, {}) });
      const token = jwt(seed, run.runId);
      const create = await request(app()).post(`/api/companies/${seed.companyId}/issues`).set("Authorization", `Bearer ${token}`).send({ title: "x" });
      expect(create.status).toBe(403);
      expect(create.body).toMatchObject({ code: "openwa_approval_required", details: { category: "create_task" } });
      const secret = await request(app()).post("/api/agents/me/secret-proposals").set("Authorization", `Bearer ${token}`).send({});
      expect(secret.status).toBe(403);
      expect(secret.body).toMatchObject({ code: "openwa_approval_required", details: { category: "external_tools" } });
      const comment = await request(app()).post(`/api/issues/${seed.issueId}/comments`).set("Authorization", `Bearer ${token}`).send({ body: "hi" });
      expect(comment.status).toBe(201);
      const read = await request(app()).get(`/api/companies/${seed.companyId}/issues`).set("Authorization", `Bearer ${token}`);
      expect(read.status).toBe(200);
    });

    it("allows full runs and runs on non-OpenWA issues", async () => {
      const seed = await seedCompany(db);
      const full = await seedRun(db, seed, { profile: "full", openwa: openwaContext(seed, { triggerClass: "owner", profile: "full" }) });
      const fullRes = await request(app()).post(`/api/companies/${seed.companyId}/issues`).set("Authorization", `Bearer ${jwt(seed, full.runId)}`).send({ title: "x" });
      expect(fullRes.status).toBe(201);
      const plain = await seedRun(db, seed, { issueId: await seedPlainIssue(db, seed) });
      const plainRes = await request(app()).post(`/api/companies/${seed.companyId}/issues`).set("Authorization", `Bearer ${jwt(seed, plain.runId)}`).send({ title: "x" });
      expect(plainRes.status).toBe(201);
    });

    it("fails closed for an OpenWA conversation run without OpenWA context", async () => {
      const seed = await seedCompany(db);
      const run = await seedRun(db, seed, {});
      const res = await request(app()).post(`/api/companies/${seed.companyId}/issues`).set("Authorization", `Bearer ${jwt(seed, run.runId)}`).send({ title: "x" });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: "openwa_approval_required", details: { category: "create_task" } });
    });

    it("lets a grant run with a live one_action create_task grant create exactly one issue", async () => {
      const seed = await seedCompany(db);
      const grant = await seedGrant(db, seed, { category: "create_task" });
      const run = await seedRun(db, seed, { profile: "read_only", openwa: openwaContext(seed, { triggerClass: "grant", grantIds: [grant.grantId] }) });
      const token = jwt(seed, run.runId);
      const first = await request(app()).post(`/api/companies/${seed.companyId}/issues`).set("Authorization", `Bearer ${token}`).send({ title: "child" });
      expect(first.status).toBe(201);
      const second = await request(app()).post(`/api/companies/${seed.companyId}/issues`).set("Authorization", `Bearer ${token}`).send({ title: "child 2" });
      expect(second.status).toBe(403);
      expect(second.body).toMatchObject({ code: "openwa_approval_required", details: { category: "create_task" } });
    });

    it("lets read_only runs reach dispatcher routes whose inner seams decide", async () => {
      const seed = await seedCompany(db);
      const run = await seedRun(db, seed, { profile: "read_only", openwa: openwaContext(seed, {}) });
      const token = jwt(seed, run.runId);
      for (const [method, path] of [
        ["post", "/api/plugins/tools/execute"],
        ["post", `/api/companies/${seed.companyId}/slack/tasks/${seed.issueId}/tools`],
        ["put", `/api/companies/${seed.companyId}/slack/endpoints/${randomUUID()}/search`],
        ["post", "/api/mcp/project-tools"],
      ] as const) {
        const res = await request(app())[method](path).set("Authorization", `Bearer ${token}`).send({});
        expect({ path, status: res.status }).toEqual({ path, status: method === "post" ? 201 : 200 });
      }
    });

    it("consumes one grant per request even when an inner seam re-checks the same category", async () => {
      const seed = await seedCompany(db);
      const first = await seedGrant(db, seed, { category: "create_task" });
      const second = await seedGrant(db, seed, { category: "create_task" });
      const run = await seedRun(db, seed, { profile: "read_only", openwa: openwaContext(seed, { triggerClass: "grant", grantIds: [first.grantId, second.grantId] }) });
      const target = { id: run.runId, companyId: seed.companyId, contextSnapshot: run.contextSnapshot };
      const inner = app(async (_req, res) => {
        await assertOpenwaRunMay(db, target, "create_task");
        res.status(201).json({ created: true });
      });
      const res = await request(inner).post(`/api/companies/${seed.companyId}/issues`).set("Authorization", `Bearer ${jwt(seed, run.runId)}`).send({ title: "x" });
      expect(res.status).toBe(201);
      const statuses = [await grantStatus(first.grantId), await grantStatus(second.grantId)].sort();
      expect(statuses).toEqual(["consumed", "live"]);
    });

    it("restores a consumed grant only when the request is rejected before its effect", async () => {
      const seed = await seedCompany(db);
      for (const [status, expected] of [[422, "live"], [403, "live"], [500, "consumed"], [201, "consumed"]] as const) {
        const grant = await seedGrant(db, seed, { category: "create_task" });
        const run = await seedRun(db, seed, { profile: "read_only", openwa: openwaContext(seed, { triggerClass: "grant", grantIds: [grant.grantId] }) });
        const res = await request(app((_req, res) => { res.status(status).json({}); }))
          .post(`/api/companies/${seed.companyId}/issues`).set("Authorization", `Bearer ${jwt(seed, run.runId)}`).send({ title: "x" });
        expect(res.status).toBe(status);
        expect({ status, grant: await grantStatus(grant.grantId) }).toEqual({ status, grant: expected });
      }
    });

    it("adds no database query to the JWT path of a non-OpenWA run", async () => {
      const seed = await seedCompany(db);
      const plainIssue = await seedPlainIssue(db, seed);
      const marked = await seedRun(db, seed, { issueId: plainIssue, profile: "full" });
      const unmarked = await seedRun(db, seed, { issueId: await seedPlainIssue(db, seed) });
      const counted = loggedDb();
      const server = app(undefined, counted.db);
      const measure = async (runId: string, method: "get" | "post") => {
        const before = counted.queries.length;
        const res = await request(server)[method](`/api/companies/${seed.companyId}/routines`).set("Authorization", `Bearer ${jwt(seed, runId)}`).send({});
        expect(res.status).toBeLessThan(300);
        return counted.queries.slice(before);
      };
      await measure(marked.runId, "get");
      const read = await measure(marked.runId, "get");
      const write = await measure(marked.runId, "post");
      expect(write).toEqual(read);
      const legacy = await measure(unmarked.runId, "post");
      expect(legacy.length).toBe(read.length + 1);
      expect(legacy.some((query) => query.includes('"chat_conversations"'))).toBe(true);
    });
  });

  describe("persistent agent key seam", () => {
    function app() {
      const server = express();
      server.use(express.json());
      server.use(actorMiddleware(db, { deploymentMode: "authenticated", resolveSession: async () => null }));
      server.all("/api/{*rest}", (req, res) => res.json({ reached: true, actor: req.actor.type }));
      server.use(errorHandler);
      return server;
    }
    async function key(seed: Seed) {
      const token = `pcp_${randomUUID()}`;
      await db.insert(agentApiKeys).values({
        agentId: seed.agentId, companyId: seed.companyId, name: "persistent",
        keyHash: createHash("sha256").update(token).digest("hex"), responsibleUserId: BOARD_USER,
      });
      return token;
    }

    it("denies every non-safe method for an agent bound to a live OpenWA endpoint", async () => {
      const seed = await seedCompany(db);
      const token = await key(seed);
      for (const method of ["post", "patch", "put", "delete"] as const) {
        const res = await request(app())[method](`/api/issues/${seed.issueId}/comments`).set("Authorization", `Bearer ${token}`).send({});
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ code: "openwa_agent_key_read_only" });
      }
      const read = await request(app()).get(`/api/issues/${seed.issueId}`).set("Authorization", `Bearer ${token}`);
      expect(read.status).toBe(200);
    });

    it("never caches an unbound answer: a key turns read-only as soon as its agent gets an endpoint", async () => {
      const seed = await seedCompany(db);
      await db.update(chatEndpoints).set({ status: "archived" }).where(eq(chatEndpoints.id, seed.endpointId));
      const token = await key(seed);
      const before = await request(app()).post("/api/x").set("Authorization", `Bearer ${token}`).send({});
      expect(before.status).toBe(200);
      await db.update(chatEndpoints).set({ status: "active" }).where(eq(chatEndpoints.id, seed.endpointId));
      const after = await request(app()).post("/api/x").set("Authorization", `Bearer ${token}`).send({});
      expect(after.status).toBe(403);
      expect(after.body).toMatchObject({ code: "openwa_agent_key_read_only" });
    });

    it("allows keys of agents without a live OpenWA endpoint, including other companies", async () => {
      const telegram = await seedCompany(db, { openwa: false });
      const res = await request(app()).post(`/api/issues/${telegram.issueId}/comments`).set("Authorization", `Bearer ${await key(telegram)}`).send({});
      expect(res.status).toBe(200);
      const archived = await seedCompany(db);
      await db.update(chatEndpoints).set({ status: "archived" }).where(eq(chatEndpoints.id, archived.endpointId));
      const archivedRes = await request(app()).post("/api/x").set("Authorization", `Bearer ${await key(archived)}`).send({});
      expect(archivedRes.status).toBe(200);
    });
  });

  describe("GitHub credential export and connection_request seam", () => {
    function app() {
      const server = express();
      server.use(express.json());
      server.use(runtimeConnectionIntentRoutes(db));
      server.use(errorHandler);
      return server;
    }

    it("denies GitHub credential export in a read_only run and reaches the resolver in a full run", async () => {
      const seed = await seedCompany(db);
      const readOnly = await seedRun(db, seed, { profile: "read_only", openwa: openwaContext(seed, {}) });
      const denied = await request(app()).post("/runtime-tools/github/credentials").set(
        "x-paperclip-github-capability",
        createRuntimeToolsToken({ agentId: seed.agentId, companyId: seed.companyId, runId: readOnly.runId, responsibleUserId: BOARD_USER, scope: "github_credentials" })!.token,
      ).send({});
      expect(denied.status).toBe(403);
      expect(denied.body).toMatchObject({ code: "openwa_approval_required", details: { category: "external_tools" } });
      const full = await seedRun(db, seed, { profile: "full", openwa: openwaContext(seed, { triggerClass: "owner", profile: "full" }) });
      const reached = await request(app()).post("/runtime-tools/github/credentials").set(
        "x-paperclip-github-capability",
        createRuntimeToolsToken({ agentId: seed.agentId, companyId: seed.companyId, runId: full.runId, responsibleUserId: BOARD_USER, scope: "github_credentials" })!.token,
      ).send({});
      expect(reached.body.code).not.toBe("openwa_approval_required");
      expect(reached.body.error).toBe("This run predates managed GitHub credentials");
    });

    it("denies connection_request in a read_only run and passes the gate in a full run", async () => {
      const seed = await seedCompany(db);
      const service = connectionIntentService(db);
      const readOnly = await seedRun(db, seed, { profile: "read_only", openwa: openwaContext(seed, {}) });
      const claims = (runId: string) => ({ sub: seed.agentId, company_id: seed.companyId, run_id: runId, responsible_user_id: BOARD_USER });
      await expect(service.request(claims(readOnly.runId), "github")).rejects.toMatchObject({
        details: { code: "openwa_approval_required", category: "external_tools" },
      });
      const full = await seedRun(db, seed, { profile: "full", openwa: openwaContext(seed, { triggerClass: "owner", profile: "full" }) });
      const outcome = await service.request(claims(full.runId), "github").catch((err) => err);
      expect(outcome).not.toBeInstanceOf(OpenwaApprovalRequiredError);
    });
  });

  describe("native runner tool seam", () => {
    function authority(seed: Seed, runId: string) {
      return new PaperclipRunnerToolAuthority(db, {
        companyId: seed.companyId, agentId: seed.agentId, issueId: seed.issueId, runId, workMode: "standard",
        enqueueWakeup: async () => null,
      });
    }
    const createTask = (key: string) => ({ tool: "create_task", callId: key, arguments: { idempotencyKey: key, title: `Child ${key}` } });

    it("denies create_task and reassign_task in a read_only run and allows create_task in a full run", async () => {
      const seed = await seedCompany(db);
      const readOnly = await seedRun(db, seed, { profile: "read_only", openwa: openwaContext(seed, {}), native: true });
      await expect(authority(seed, readOnly.runId).execute(createTask("ro-1"))).rejects.toMatchObject({
        details: { code: "openwa_approval_required", category: "create_task" },
      });
      await expect(authority(seed, readOnly.runId).execute({
        tool: "reassign_task", callId: "ro-reassign",
        arguments: { idempotencyKey: "ro-reassign", taskId: randomUUID(), assigneeActorId: seed.agentId, expectedAssigneeActorId: null, expectedStatusVersion: 0, reason: "move" },
      })).rejects.toMatchObject({ details: { code: "openwa_approval_required", category: "create_task" } });
      const full = await seedRun(db, seed, { profile: "full", openwa: openwaContext(seed, { triggerClass: "owner", profile: "full" }), native: true });
      await expect(authority(seed, full.runId).execute(createTask("full-1"))).resolves.toMatchObject({
        disposition: "applied", task: { parentId: seed.issueId },
      });
    });

    it("consumes a reassign_task grant in the prepare phase and restores it when the commit phase fails", async () => {
      const seed = await seedCompany(db);
      const grant = await seedGrant(db, seed, { category: "create_task" });
      const run = await seedRun(db, seed, { profile: "read_only", openwa: openwaContext(seed, { triggerClass: "grant", grantIds: [grant.grantId] }), native: true });
      const otherAgentId = randomUUID();
      await db.insert(agents).values({
        id: otherAgentId, companyId: seed.companyId, name: "Other agent", role: "engineer", status: "idle",
        adapterType: "paperclip_runner", adapterConfig: {}, runtimeConfig: {}, permissions: {},
      });
      const targetId = randomUUID();
      const otherRunId = randomUUID();
      await db.insert(heartbeatRuns).values({
        id: otherRunId, companyId: seed.companyId, agentId: otherAgentId, status: "running",
        invocationSource: "assignment", triggerDetail: "system", contextSnapshot: { issueId: targetId },
      });
      await db.insert(issues).values({
        id: targetId, companyId: seed.companyId, title: "Target", status: "todo", assigneeAgentId: otherAgentId,
        executionRunId: otherRunId, responsibleUserId: BOARD_USER,
      });
      const stops: string[] = [];
      const tool = new PaperclipRunnerToolAuthority(db, {
        companyId: seed.companyId, agentId: seed.agentId, issueId: seed.issueId, runId: run.runId, workMode: "standard",
        enqueueWakeup: async () => null,
        stopTaskForReassignment: async () => {
          const [row] = await db.select({ status: chatOwnerGrants.status }).from(chatOwnerGrants).where(eq(chatOwnerGrants.id, grant.grantId));
          stops.push(row!.status);
          throw new Error("stop failed");
        },
      });
      await expect(tool.execute({
        tool: "reassign_task", callId: "grant-reassign",
        arguments: { idempotencyKey: "grant-reassign", taskId: targetId, assigneeActorId: seed.agentId, expectedAssigneeActorId: otherAgentId, expectedStatusVersion: 0, reason: "move" },
      })).rejects.toThrow("stop failed");
      expect(stops).toEqual(["consumed"]);
      const [row] = await db.select({ status: chatOwnerGrants.status, consumedByRunId: chatOwnerGrants.consumedByRunId }).from(chatOwnerGrants).where(eq(chatOwnerGrants.id, grant.grantId));
      expect(row).toEqual({ status: "live", consumedByRunId: null });
    });

    it("lets a one_action create_task grant create exactly one child task", async () => {
      const seed = await seedCompany(db);
      const grant = await seedGrant(db, seed, { category: "create_task" });
      const run = await seedRun(db, seed, { profile: "read_only", openwa: openwaContext(seed, { triggerClass: "grant", grantIds: [grant.grantId] }), native: true });
      await expect(authority(seed, run.runId).execute(createTask("grant-1"))).resolves.toMatchObject({ disposition: "applied" });
      await expect(authority(seed, run.runId).execute(createTask("grant-1"))).resolves.toMatchObject({ disposition: "applied" });
      await expect(authority(seed, run.runId).execute(createTask("grant-2"))).rejects.toMatchObject({
        details: { code: "openwa_approval_required", category: "create_task" },
      });
      const children = await db.select().from(issues).where(and(eq(issues.companyId, seed.companyId), eq(issues.parentId, seed.issueId)));
      expect(children).toHaveLength(1);
    });
  });

  describe("project tool write seam", () => {
    const actor = (seed: Seed, runId: string) => ({
      type: "agent" as const, source: "agent_jwt" as const, agentId: seed.agentId, companyId: seed.companyId, runId,
    });

    it("denies project creation context in a read_only run and allows it in a full run", async () => {
      const seed = await seedCompany(db);
      const readOnly = await seedRun(db, seed, { profile: "read_only", openwa: openwaContext(seed, {}) });
      await expect(projectToolContext(db, actor(seed, readOnly.runId), true)).rejects.toMatchObject({
        details: { code: "openwa_approval_required", category: "create_task" },
      });
      await expect(projectToolContext(db, actor(seed, readOnly.runId), false)).resolves.toMatchObject({ issue: { id: seed.issueId } });
      const full = await seedRun(db, seed, { profile: "full", openwa: openwaContext(seed, { triggerClass: "owner", profile: "full" }) });
      await expect(projectToolContext(db, actor(seed, full.runId), true)).resolves.toMatchObject({ issue: { id: seed.issueId } });
    });
  });

  describe("tool gateway policy seam", () => {
    async function gatewayFor(seed: Seed, runId: string) {
      await db.insert(toolPolicies).values({
        companyId: seed.companyId, name: "Review note writes", policyType: "require_approval",
        selectors: { toolName: "mcp-remote-fixture:update_note" },
      });
      const gateway = createToolGatewayService(db, { toolActionSigningSecret: "openwa-authority-signing" });
      const session = await gateway.createSession({ companyId: seed.companyId, agentId: seed.agentId, runId });
      return { gateway, session };
    }

    it("denies write tools in a read_only run with openwa_approval_required", async () => {
      const seed = await seedCompany(db);
      const run = await seedRun(db, seed, { profile: "read_only", openwa: openwaContext(seed, {}) });
      const { gateway, session } = await gatewayFor(seed, run.runId);
      await expect(gateway.executeTool({
        sessionToken: session.token, tool: "mcp-remote-fixture:update_note", parameters: { noteId: "n1", body: "x" },
      })).rejects.toMatchObject({ status: 403, reasonCode: "openwa_approval_required", details: { category: "external_tools" } });
    });

    it("keeps the normal policy decision in a full run", async () => {
      const seed = await seedCompany(db);
      const run = await seedRun(db, seed, { profile: "full", openwa: openwaContext(seed, { triggerClass: "owner", profile: "full" }) });
      const { gateway, session } = await gatewayFor(seed, run.runId);
      await expect(gateway.executeTool({
        sessionToken: session.token, tool: "mcp-remote-fixture:update_note", parameters: { noteId: "n1", body: "x" },
      })).rejects.toMatchObject({ reasonCode: "approval_required" });
    });

    it("adds no heartbeat_runs read per write-tool call for a non-OpenWA run", async () => {
      const seed = await seedCompany(db);
      const run = await seedRun(db, seed, { issueId: await seedPlainIssue(db, seed), profile: "full" });
      await db.insert(toolPolicies).values({
        companyId: seed.companyId, name: "Review note writes", policyType: "require_approval",
        selectors: { toolName: "mcp-remote-fixture:update_note" },
      });
      const counted = loggedDb();
      const gateway = createToolGatewayService(counted.db, { toolActionSigningSecret: "openwa-authority-signing" });
      const session = await gateway.createSession({ companyId: seed.companyId, agentId: seed.agentId, runId: run.runId });
      const call = async (tool: string, parameters: Record<string, unknown>) => {
        const before = counted.queries.length;
        await gateway.executeTool({ sessionToken: session.token, tool, parameters }).catch(() => null);
        return counted.queries.slice(before).filter((query) =>
          query.includes("'paperclipOpenwa'") || query.includes('"chat_owner_grants"') || query.includes('"chat_conversations"."is_direct_message", "chat_endpoints"')).length;
      };
      await call("mcp-remote-fixture:echo", { message: "warm" });
      const read = await call("mcp-remote-fixture:echo", { message: "read" });
      const write = await call("mcp-remote-fixture:update_note", { noteId: "n1", body: "x" });
      expect(read).toBe(1);
      expect(write).toBe(read);
    });
  });

  describe("host GitHub credentials at run start", () => {
    it("keeps host credentials only for full tool profiles", () => {
      const seed = { endpointId: randomUUID() } as Seed;
      expect(openwaHostGitHubAllowed(null)).toBe(true);
      expect(openwaHostGitHubAllowed(openwaContext(seed, { triggerClass: "owner", profile: "full" }))).toBe(true);
      expect(openwaHostGitHubAllowed(openwaContext(seed, {}))).toBe(false);
      expect(openwaHostGitHubAllowed(openwaContext(seed, { toolProfile: "full" }))).toBe(true);
    });
  });
});
