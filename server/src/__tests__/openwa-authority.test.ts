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
  chatConversations,
  chatEndpoints,
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
  assertOpenwaRunMay,
  isOpenwaConversationIssue,
  openwaReadOnlyRestDecision,
  openwaRunSuppressesMentionWakes,
  resolveOpenwaRunContext,
  type OpenwaRunContext,
} from "../services/openwa/authority.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
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

  it("checks work products against the run's own issue", () => {
    const path = "/api/work-products/33333333-3333-4333-8333-333333333333";
    expect(openwaReadOnlyRestDecision({ method: "PATCH", path, ownIssueId: own })).toMatchObject({ allowed: "workProduct" });
    expect(openwaReadOnlyRestDecision({ method: "PATCH", path, ownIssueId: own, workProductIssueId: own })).toEqual({ allowed: true });
    expect(openwaReadOnlyRestDecision({ method: "PATCH", path, ownIssueId: own, workProductIssueId: other }))
      .toEqual({ allowed: false, category: "external_tools" });
  });

  it("suppresses mention wakes only for read_only run contexts", () => {
    expect(openwaRunSuppressesMentionWakes({ contextSnapshot: { paperclipToolProfile: "read_only" } })).toBe(true);
    expect(openwaRunSuppressesMentionWakes({ contextSnapshot: { paperclipToolProfile: "full" } })).toBe(false);
    expect(openwaRunSuppressesMentionWakes({ contextSnapshot: {} })).toBe(false);
    expect(openwaRunSuppressesMentionWakes(null)).toBe(false);
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
  input: { category: "create_task" | "external_tools"; scope?: "one_action" | "requester"; chatKey?: string; expiresAt?: Date; status?: "live" | "revoked" },
) {
  const [approval] = await db.insert(chatOwnerApprovalRequests).values({
    companyId: seed.companyId, endpointId: seed.endpointId, originChatKey: input.chatKey ?? CHAT_KEY,
    categories: [input.category], scope: input.scope ?? "one_action", summary: "Create a task", proposedAction: "create",
    status: "approved",
  }).returning();
  const [grant] = await db.insert(chatOwnerGrants).values({
    companyId: seed.companyId, endpointId: seed.endpointId, requestId: approval!.id,
    originChatKey: input.chatKey ?? CHAT_KEY, category: input.category, scope: input.scope ?? "one_action",
    status: input.status ?? "live", approvedVia: "paperclip", approvedByUserId: BOARD_USER,
    expiresAt: input.expiresAt ?? new Date(Date.now() + 3_600_000),
  }).returning();
  return { grantId: grant!.id, requestId: approval!.id };
}

function openwaContext(seed: Seed, input: Partial<OpenwaRunContext>): OpenwaRunContext {
  return {
    endpointId: seed.endpointId, chatKey: CHAT_KEY, triggerClass: "other", profile: "read_only",
    grantIds: [], requesterPrincipalId: null, approvalRequestId: null, ...input,
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
  input: { actorType: "user" | "agent" | "system"; actorId?: string | null; openwaClass?: string },
) {
  const [wake] = await db.insert(agentWakeupRequests).values({
    companyId: seed.companyId, agentId: seed.agentId, source: "automation", reason: "test",
    payload: input.openwaClass ? { openwa: { triggerClass: input.openwaClass, deliveryIds: [] } } : {},
    requestedByActorType: input.actorType, requestedByActorId: input.actorId ?? null,
  }).returning();
  return wake!.id;
}

describeEmbeddedPostgres("OpenWA run authority", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const previousSecret = process.env.PAPERCLIP_AGENT_JWT_SECRET;
  const previousInstance = process.env.PAPERCLIP_INSTANCE_ID;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-openwa-authority-");
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
    it("is read_only without OpenWA context for agent, system, retry or missing wakes", async () => {
      const seed = await seedCompany(db);
      for (const wakeupRequestId of [
        await seedWake(db, seed, { actorType: "agent", actorId: seed.agentId }),
        await seedWake(db, seed, { actorType: "system" }),
        null,
      ]) {
        await expect(resolveOpenwaRunContext(db, {
          companyId: seed.companyId, issueId: seed.issueId, contextSnapshot: { issueId: seed.issueId }, wakeupRequestId,
        })).resolves.toEqual(openwaContext(seed, {}));
      }
    });

    it("is full for a human board user wake and for a verified owner trigger", async () => {
      const seed = await seedCompany(db);
      const board = await seedWake(db, seed, { actorType: "user", actorId: BOARD_USER });
      await expect(resolveOpenwaRunContext(db, {
        companyId: seed.companyId, issueId: seed.issueId, contextSnapshot: {}, wakeupRequestId: board,
      })).resolves.toEqual(openwaContext(seed, { profile: "full" }));
      const owner = await seedWake(db, seed, { actorType: "system", openwaClass: "owner" });
      await expect(resolveOpenwaRunContext(db, {
        companyId: seed.companyId, issueId: seed.issueId, wakeupRequestId: owner,
        contextSnapshot: { paperclipOpenwa: { triggerClass: "owner", requesterPrincipalId: null } },
      })).resolves.toEqual(openwaContext(seed, { triggerClass: "owner", profile: "full" }));
    });

    it("never trusts a context class that the wake request did not record", async () => {
      const seed = await seedCompany(db);
      const plain = await seedWake(db, seed, { actorType: "system" });
      await expect(resolveOpenwaRunContext(db, {
        companyId: seed.companyId, issueId: seed.issueId, wakeupRequestId: plain,
        contextSnapshot: { paperclipOpenwa: { triggerClass: "owner", profile: "full" }, paperclipToolProfile: "full" },
      })).resolves.toMatchObject({ triggerClass: "other", profile: "read_only" });
      const other = await seedWake(db, seed, { actorType: "user", actorId: BOARD_USER, openwaClass: "other" });
      await expect(resolveOpenwaRunContext(db, {
        companyId: seed.companyId, issueId: seed.issueId, wakeupRequestId: other,
        contextSnapshot: { paperclipOpenwa: { triggerClass: "owner" } },
      })).resolves.toMatchObject({ triggerClass: "other", profile: "read_only" });
    });

    it("resolves only live, unexpired, same-chat grants of the run's company", async () => {
      const seed = await seedCompany(db);
      const foreign = await seedCompany(db);
      const live = await seedGrant(db, seed, { category: "create_task" });
      const expired = await seedGrant(db, seed, { category: "create_task", expiresAt: new Date(Date.now() - 1_000) });
      const revoked = await seedGrant(db, seed, { category: "create_task", status: "revoked" });
      const otherChat = await seedGrant(db, seed, { category: "create_task", chatKey: "628999@c.us" });
      const foreignGrant = await seedGrant(db, foreign, { category: "create_task" });
      const wake = await seedWake(db, seed, { actorType: "system", openwaClass: "grant" });
      const resolved = await resolveOpenwaRunContext(db, {
        companyId: seed.companyId, issueId: seed.issueId, wakeupRequestId: wake,
        contextSnapshot: { paperclipOpenwa: {
          triggerClass: "grant", approvalRequestId: live.requestId,
          grantIds: [live.grantId, expired.grantId, revoked.grantId, otherChat.grantId, foreignGrant.grantId],
        } },
      });
      expect(resolved).toEqual(openwaContext(seed, {
        triggerClass: "grant", profile: "read_only", grantIds: [live.grantId], approvalRequestId: live.requestId,
      }));
    });

    it("leaves runs on non-OpenWA issues untouched and scopes the binding by company", async () => {
      const seed = await seedCompany(db);
      const telegram = await seedCompany(db, { openwa: false });
      const plainIssue = await seedPlainIssue(db, seed);
      await expect(resolveOpenwaRunContext(db, {
        companyId: seed.companyId, issueId: plainIssue, contextSnapshot: {}, wakeupRequestId: null,
      })).resolves.toBeNull();
      await expect(resolveOpenwaRunContext(db, {
        companyId: telegram.companyId, issueId: telegram.issueId, contextSnapshot: {}, wakeupRequestId: null,
      })).resolves.toBeNull();
      await expect(resolveOpenwaRunContext(db, {
        companyId: telegram.companyId, issueId: seed.issueId, contextSnapshot: {}, wakeupRequestId: null,
      })).resolves.toBeNull();
      await expect(isOpenwaConversationIssue(db, telegram.companyId, seed.issueId)).resolves.toBe(false);
      await expect(isOpenwaConversationIssue(db, seed.companyId, seed.issueId)).resolves.toBe(true);
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
      await expect(assertOpenwaRunMay(db, target, "create_task", { consume: false })).resolves.toBeNull();

      const requester = await seedGrant(db, seed, { category: "external_tools", scope: "requester" });
      const reusable = await seedRun(db, seed, { profile: "read_only", openwa: openwaContext(seed, { triggerClass: "grant", grantIds: [requester.grantId] }) });
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await expect(assertOpenwaRunMay(db, { id: reusable.runId, companyId: seed.companyId, contextSnapshot: reusable.contextSnapshot }, "external_tools")).resolves.toBeNull();
      }
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
    function app() {
      const server = express();
      server.use(express.json());
      server.use(actorMiddleware(db, { deploymentMode: "authenticated", resolveSession: async () => null }));
      server.all("/api/{*rest}", (req, res) => res.status(req.method === "POST" ? 201 : 200).json({ reached: true, actor: req.actor.type }));
      server.use(errorHandler);
      return server;
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
  });
});
