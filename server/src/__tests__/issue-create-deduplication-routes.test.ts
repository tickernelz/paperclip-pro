import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issueCreateIdempotencyKeys,
  issues,
} from "@tickernelz/paperclip-pro-db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { actorMiddleware } from "../middleware/auth.js";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";
import {
  ISSUE_CREATE_IDEMPOTENCY_KEY_RETENTION_DAYS,
  issueService,
} from "../services/issues.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres issue create deduplication route tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

describeEmbeddedPostgres("issue create deduplication routes", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-issue-create-deduplication-routes-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(issueCreateIdempotencyKeys);
    await db.delete(issues);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  function createApp(actor?: Record<string, unknown>) {
    const app = express();
    app.use(express.json());
    if (actor) {
      app.use((req, _res, next) => {
        Object.assign(req, { actor });
        next();
      });
    } else {
      app.use(actorMiddleware(db, { deploymentMode: "local_trusted" }));
    }
    app.use("/api", issueRoutes(db, {} as any));
    app.use(errorHandler);
    return app;
  }

  async function seedAgentRun(companyId: string, contextSnapshot: Record<string, unknown>) {
    const agentId = randomUUID();
    const runId = randomUUID();
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Working agent",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      status: "running",
      contextSnapshot,
    });
    return {
      agentId,
      runId,
      actor: { type: "agent", agentId, companyId, runId, source: "agent_jwt" },
    };
  }

  async function seedCompany() {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `D${companyId.replace(/-/g, "").slice(0, 5).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    return companyId;
  }

  async function seedParent(companyId: string) {
    const [parent] = await db.insert(issues).values({
      companyId,
      title: "Parent issue",
      status: "todo",
      priority: "medium",
    }).returning();
    return parent;
  }

  it("replays the existing issue for the same company idempotency key", async () => {
    const companyId = await seedCompany();
    const parent = await seedParent(companyId);
    const app = createApp();

    const first = await request(app)
      .post(`/api/companies/${companyId}/issues`)
      .send({ parentId: parent.id, title: "Prepare release", idempotencyKey: "run-1:prepare-release" })
      .expect(201);
    const replay = await request(app)
      .post(`/api/companies/${companyId}/issues`)
      .send({
        parentId: parent.id,
        title: "Different retry payload",
        idempotencyKey: "run-1:prepare-release",
        allowDuplicate: true,
      })
      .expect(200);

    expect(replay.body).toMatchObject({
      id: first.body.id,
      title: "Prepare release",
      deduplicated: true,
      deduplicationReason: "idempotency_key",
    });
    expect(await db.select().from(issueCreateIdempotencyKeys)).toHaveLength(1);
  });

  it("expires old idempotency keys before replay lookup", async () => {
    const companyId = await seedCompany();
    const parent = await seedParent(companyId);
    const app = createApp();
    const oldIssueId = randomUUID();
    const idempotencyKey = "run-1:expired-retry";
    const expiredCreatedAt = new Date(
      Date.now() - (ISSUE_CREATE_IDEMPOTENCY_KEY_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000,
    );
    await db.insert(issues).values({
      id: oldIssueId,
      companyId,
      parentId: parent.id,
      title: "Expired retry target",
      status: "todo",
      priority: "medium",
    });
    await db.insert(issueCreateIdempotencyKeys).values({
      companyId,
      idempotencyKey,
      issueId: oldIssueId,
      createdAt: expiredCreatedAt,
    });

    const recreated = await request(app)
      .post(`/api/companies/${companyId}/issues`)
      .send({ parentId: parent.id, title: "Expired retry creates new work", idempotencyKey })
      .expect(201);

    const rows = await db.select().from(issueCreateIdempotencyKeys);
    expect(recreated.body.id).not.toBe(oldIssueId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      companyId,
      idempotencyKey,
      issueId: recreated.body.id,
    });
  });

  it("returns a recent open sibling whose normalized title matches", async () => {
    const companyId = await seedCompany();
    const parent = await seedParent(companyId);
    const app = createApp();

    const first = await request(app)
      .post(`/api/companies/${companyId}/issues`)
      .send({ parentId: parent.id, title: "Create   a single PR" })
      .expect(201);
    const duplicate = await request(app)
      .post(`/api/companies/${companyId}/issues`)
      .send({ parentId: parent.id, title: "  create a SINGLE pr  " })
      .expect(200);

    expect(duplicate.body).toMatchObject({
      id: first.body.id,
      deduplicated: true,
      deduplicationReason: "recent_open_title",
    });
  });

  it("serializes keyed and title-only creates for the same issue", async () => {
    const companyId = await seedCompany();
    const parent = await seedParent(companyId);
    const app = createApp();

    const [keyed, titleOnly] = await Promise.all([
      request(app)
        .post(`/api/companies/${companyId}/issues`)
        .send({ parentId: parent.id, title: "Coordinate launch", idempotencyKey: "run-2:coordinate-launch" }),
      request(app)
        .post(`/api/companies/${companyId}/issues`)
        .send({ parentId: parent.id, title: "Coordinate launch" }),
    ]);

    expect([keyed.status, titleOnly.status].sort()).toEqual([200, 201]);
    expect(keyed.body.id).toBe(titleOnly.body.id);
    expect([keyed, titleOnly].find((response) => response.status === 200)?.body).toMatchObject({
      deduplicated: true,
      deduplicationReason: "recent_open_title",
    });
    expect(await db.select().from(issues).where(eq(issues.parentId, parent.id))).toHaveLength(1);
    expect(await db.select().from(issueCreateIdempotencyKeys)).toEqual([
      expect.objectContaining({ issueId: keyed.body.id, idempotencyKey: "run-2:coordinate-launch" }),
    ]);

    const replay = await request(app)
      .post(`/api/companies/${companyId}/issues`)
      .send({ parentId: parent.id, title: "Different title", idempotencyKey: "run-2:coordinate-launch" })
      .expect(200);
    expect(replay.body).toMatchObject({
      id: keyed.body.id,
      deduplicated: true,
      deduplicationReason: "idempotency_key",
    });
  });

  it("allows an explicit duplicate create", async () => {
    const companyId = await seedCompany();
    const parent = await seedParent(companyId);
    const app = createApp();

    const first = await request(app)
      .post(`/api/companies/${companyId}/issues`)
      .send({ parentId: parent.id, title: "Investigate incident" })
      .expect(201);
    const duplicate = await request(app)
      .post(`/api/companies/${companyId}/issues`)
      .send({ parentId: parent.id, title: "Investigate incident", allowDuplicate: true })
      .expect(201);

    expect(duplicate.body.id).not.toBe(first.body.id);
  });

  it("does not apply the route soft guard to internal service creates", async () => {
    const companyId = await seedCompany();
    const parent = await seedParent(companyId);
    const svc = issueService(db);

    const first = await svc.create(companyId, {
      parentId: parent.id,
      title: "System-generated follow-up",
      status: "todo",
      priority: "medium",
    });
    const second = await svc.create(companyId, {
      parentId: parent.id,
      title: "System-generated follow-up",
      status: "todo",
      priority: "medium",
    });

    expect(second.id).not.toBe(first.id);
  });

  it("does not let closed or older issues block a recreate", async () => {
    const companyId = await seedCompany();
    const parent = await seedParent(companyId);
    const app = createApp();
    const oldIssueId = randomUUID();
    const closedIssueId = randomUUID();
    await db.insert(issues).values([
      {
        id: oldIssueId,
        companyId,
        parentId: parent.id,
        title: "Retry old work",
        status: "todo",
        priority: "medium",
        createdAt: new Date(Date.now() - 49 * 60 * 60 * 1000),
      },
      {
        id: closedIssueId,
        companyId,
        parentId: parent.id,
        title: "Retry closed work",
        status: "done",
        priority: "medium",
      },
    ]);

    const recreatedOld = await request(app)
      .post(`/api/companies/${companyId}/issues`)
      .send({ parentId: parent.id, title: "Retry old work" })
      .expect(201);
    const recreatedClosed = await request(app)
      .post(`/api/companies/${companyId}/issues`)
      .send({ parentId: parent.id, title: "Retry closed work" })
      .expect(201);

    expect(recreatedOld.body.id).not.toBe(oldIssueId);
    expect(recreatedClosed.body.id).not.toBe(closedIssueId);
  });

  it("stores the request run header on manual creates", async () => {
    const companyId = await seedCompany();
    const parent = await seedParent(companyId);
    const app = createApp();
    const runId = randomUUID();
    const agentId = randomUUID();
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Creating agent",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      status: "running",
    });

    const response = await request(app)
      .post(`/api/companies/${companyId}/issues`)
      .set("X-Paperclip-Run-Id", runId)
      .send({ parentId: parent.id, title: "Attributed create" })
      .expect(201);
    const [created] = await db.select().from(issues).where(eq(issues.id, response.body.id));

    expect(created.originKind).toBe("manual");
    expect(created.originRunId).toBe(runId);
  });

  describe("parent_missing warning", () => {
    async function seedWorkingIssue(companyId: string, overrides: Partial<typeof issues.$inferInsert> = {}) {
      const [issue] = await db.insert(issues).values({
        companyId,
        title: "Working issue",
        status: "in_progress",
        priority: "medium",
        identifier: "PAR-7",
        issueNumber: 7,
        ...overrides,
      }).returning();
      return issue;
    }

    it("warns an agent that creates a parentless issue while its run works on another issue", async () => {
      const companyId = await seedCompany();
      const working = await seedWorkingIssue(companyId);
      const { actor } = await seedAgentRun(companyId, { issueId: working.id });

      const response = await request(createApp(actor))
        .post(`/api/companies/${companyId}/issues`)
        .send({ title: "Deploy the fix" })
        .expect(201);

      expect(response.body.parentId).toBeNull();
      expect(response.body.warnings).toEqual([
        expect.objectContaining({
          code: "parent_missing",
          suggestedParentIssueId: working.id,
          suggestedParentIdentifier: "PAR-7",
          message: expect.stringContaining("paperclipCreateChildIssue"),
        }),
      ]);
    });

    it("reads the working issue from a taskId run context and keeps the warning on a deduplicated replay", async () => {
      const companyId = await seedCompany();
      const working = await seedWorkingIssue(companyId);
      const { actor } = await seedAgentRun(companyId, { taskId: working.id });
      const app = createApp(actor);

      const first = await request(app)
        .post(`/api/companies/${companyId}/issues`)
        .send({ title: "Review the change", idempotencyKey: "run:review" })
        .expect(201);
      const replay = await request(app)
        .post(`/api/companies/${companyId}/issues`)
        .send({ title: "Review the change", idempotencyKey: "run:review" })
        .expect(200);

      expect(first.body.warnings?.[0]).toMatchObject({ code: "parent_missing", suggestedParentIssueId: working.id });
      expect(replay.body).toMatchObject({ id: first.body.id, deduplicated: true });
      expect(replay.body.warnings?.[0]).toMatchObject({ code: "parent_missing", suggestedParentIssueId: working.id });
    });

    it("does not warn when a title dedup returns a parentless issue someone else created", async () => {
      const companyId = await seedCompany();
      const working = await seedWorkingIssue(companyId);
      const other = await seedAgentRun(companyId, {});
      const [boardIssue] = await db.insert(issues).values({
        companyId,
        title: "Rotate the staging certificate",
        status: "todo",
        priority: "medium",
        createdByUserId: "board-user",
      }).returning();
      const [otherAgentIssue] = await db.insert(issues).values({
        companyId,
        title: "Audit the billing export",
        status: "todo",
        priority: "medium",
        createdByAgentId: other.agentId,
        originRunId: other.runId,
      }).returning();
      const { actor } = await seedAgentRun(companyId, { issueId: working.id });
      const app = createApp(actor);

      const boardReplay = await request(app)
        .post(`/api/companies/${companyId}/issues`)
        .send({ title: "rotate the staging  certificate" })
        .expect(200);
      const otherAgentReplay = await request(app)
        .post(`/api/companies/${companyId}/issues`)
        .send({ title: "Audit the billing export" })
        .expect(200);

      expect(boardReplay.body).toMatchObject({ id: boardIssue.id, deduplicationReason: "recent_open_title" });
      expect(boardReplay.body).not.toHaveProperty("warnings");
      expect(otherAgentReplay.body).toMatchObject({ id: otherAgentIssue.id, deduplicationReason: "recent_open_title" });
      expect(otherAgentReplay.body).not.toHaveProperty("warnings");
    });

    it("does not warn a deliberate sibling that inherits the working issue workspace", async () => {
      const companyId = await seedCompany();
      const working = await seedWorkingIssue(companyId);
      const { actor } = await seedAgentRun(companyId, { issueId: working.id });

      const response = await request(createApp(actor))
        .post(`/api/companies/${companyId}/issues`)
        .send({ title: "Sibling follow-up", inheritExecutionWorkspaceFromIssueId: working.id })
        .expect(201);

      expect(response.body.parentId).toBeNull();
      expect(response.body).not.toHaveProperty("warnings");
    });

    it("does not warn when the agent sets parentId", async () => {
      const companyId = await seedCompany();
      const working = await seedWorkingIssue(companyId);
      const { actor } = await seedAgentRun(companyId, { issueId: working.id });

      const response = await request(createApp(actor))
        .post(`/api/companies/${companyId}/issues`)
        .send({ title: "Deploy the fix", parentId: working.id })
        .expect(201);

      expect(response.body.parentId).toBe(working.id);
      expect(response.body).not.toHaveProperty("warnings");
    });

    it("does not warn a run without issue context", async () => {
      const companyId = await seedCompany();
      const { actor } = await seedAgentRun(companyId, {});

      const response = await request(createApp(actor))
        .post(`/api/companies/${companyId}/issues`)
        .send({ title: "Independent work" })
        .expect(201);

      expect(response.body).not.toHaveProperty("warnings");
    });

    it("does not warn a conversation handoff", async () => {
      const companyId = await seedCompany();
      const { agentId, runId } = await seedAgentRun(companyId, {});
      const conversation = await seedWorkingIssue(companyId, {
        conversationAgentId: agentId,
        conversationUserId: "board-user",
        conversationState: "waiting",
        assigneeAgentId: agentId,
        status: "in_review",
      });
      await db.update(heartbeatRuns)
        .set({ contextSnapshot: { issueId: conversation.id } })
        .where(eq(heartbeatRuns.id, runId));

      const response = await request(createApp({ type: "agent", agentId, companyId, runId, source: "agent_jwt" }))
        .post(`/api/companies/${companyId}/issues`)
        .send({ title: "Execute the handed-off plan" })
        .expect(201);

      expect(response.body.parentId).toBeNull();
      expect(response.body).not.toHaveProperty("warnings");
    });

    it("does not warn a board user even when the request names a run", async () => {
      const companyId = await seedCompany();
      const working = await seedWorkingIssue(companyId);
      const { runId } = await seedAgentRun(companyId, { issueId: working.id });

      const response = await request(createApp())
        .post(`/api/companies/${companyId}/issues`)
        .set("X-Paperclip-Run-Id", runId)
        .send({ title: "Board-created work" })
        .expect(201);

      expect(response.body).not.toHaveProperty("warnings");
    });

    it("does not warn on child creation", async () => {
      const companyId = await seedCompany();
      const { agentId, runId, actor } = await seedAgentRun(companyId, {});
      const working = await seedWorkingIssue(companyId, { assigneeAgentId: agentId });
      await db.update(heartbeatRuns)
        .set({ contextSnapshot: { issueId: working.id } })
        .where(eq(heartbeatRuns.id, runId));

      const response = await request(createApp(actor))
        .post(`/api/issues/${working.id}/children`)
        .send({ title: "Child follow-up" })
        .expect(201);

      expect(response.body.parentId).toBe(working.id);
      expect(response.body).not.toHaveProperty("warnings");
    });
  });
});
