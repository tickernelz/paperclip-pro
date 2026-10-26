import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  heartbeatRunEvents,
  heartbeatRuns,
  issues,
} from "@tickernelz/paperclip-pro-db";
import { AGENT_TODO_EVENT_TYPE, type AgentTodoPayload } from "@tickernelz/paperclip-pro-shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { activityRoutes } from "../routes/activity.js";
import { redactEventPayload } from "../redaction.js";
import { getLatestAgentTodoSnapshot } from "../services/heartbeat-run-events.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

function todoPayload(op: string, current: string, status: "pending" | "in_progress" | "completed"): AgentTodoPayload {
  return {
    version: 1,
    source: "omp",
    op,
    toolCallId: `call-${op}`,
    phases: [
      {
        name: "Context",
        tasks: [
          { content: "Read issue, related issues, memory, skills", status: "completed" },
          { content: current, status },
        ],
      },
    ],
    counts: {
      total: 2,
      completed: status === "completed" ? 2 : 1,
      inProgress: status === "in_progress" ? 1 : 0,
      pending: status === "pending" ? 1 : 0,
      blocked: 0,
      dropped: 0,
    },
  };
}

describeEmbeddedPostgres("GET /issues/:issueId/agent-todo", { concurrent: false }, () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const previousPrivacyMode = process.env.PAPERCLIP_ISSUE_PRIVACY_MODE;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-agent-todo-routes-");
    db = createDb(tempDb.connectionString);
    process.env.PAPERCLIP_ISSUE_PRIVACY_MODE = "enforce";
  }, 120_000);

  afterEach(async () => {
    await db.delete(heartbeatRunEvents);
    await db.delete(heartbeatRuns);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    if (previousPrivacyMode === undefined) delete process.env.PAPERCLIP_ISSUE_PRIVACY_MODE;
    else process.env.PAPERCLIP_ISSUE_PRIVACY_MODE = previousPrivacyMode;
    await tempDb?.cleanup();
  });

  async function seedCompany(prefix: string) {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const otherAgentId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: `Todo ${prefix}`,
      issuePrefix: prefix,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values([agentId, otherAgentId].map((id, index) => ({
      id,
      companyId,
      name: index === 0 ? "Owner" : "Other",
      role: "engineer",
      adapterType: "omp_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    })));
    return { companyId, agentId, otherAgentId };
  }

  async function seedIssue(companyId: string, agentId: string, identifier: string, extra: Partial<typeof issues.$inferInsert> = {}) {
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      identifier,
      title: `Issue ${identifier}`,
      status: "in_progress",
      assigneeAgentId: agentId,
      ...extra,
    });
    return issueId;
  }

  async function seedRun(companyId: string, agentId: string, issueId: string, status: string) {
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      scopeKind: "issue",
      issueId,
      invocationSource: "assignment",
      status,
    });
    return runId;
  }

  async function appendEvent(companyId: string, agentId: string, runId: string, seq: number, eventType: string, payload: Record<string, unknown> | null) {
    await db.insert(heartbeatRunEvents).values({
      companyId,
      runId,
      agentId,
      seq,
      eventType,
      stream: "system",
      level: "info",
      message: eventType,
      payload,
    });
  }

  function createAgentApp(companyId: string, agentId: string) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = { type: "agent", agentId, companyId, source: "agent_jwt" };
      next();
    });
    app.use("/api", activityRoutes(db));
    app.use(errorHandler);
    return app;
  }

  it("returns the newest todo across runs of the issue with that run's status", async () => {
    const { companyId, agentId } = await seedCompany("TDA");
    const issueId = await seedIssue(companyId, agentId, "TDA-1");
    const otherIssueId = await seedIssue(companyId, agentId, "TDA-2");
    const firstRunId = await seedRun(companyId, agentId, issueId, "succeeded");
    const secondRunId = await seedRun(companyId, agentId, issueId, "running");
    const otherRunId = await seedRun(companyId, agentId, otherIssueId, "running");

    await appendEvent(companyId, agentId, firstRunId, 1, AGENT_TODO_EVENT_TYPE, todoPayload("init", "First run task", "in_progress"));
    await appendEvent(companyId, agentId, firstRunId, 2, AGENT_TODO_EVENT_TYPE, todoPayload("done", "First run task", "completed"));
    await appendEvent(companyId, agentId, secondRunId, 1, AGENT_TODO_EVENT_TYPE, todoPayload("start", "Second run task", "in_progress"));
    await appendEvent(companyId, agentId, secondRunId, 2, "omp.tool", { toolName: "bash" });
    await appendEvent(companyId, agentId, otherRunId, 1, AGENT_TODO_EVENT_TYPE, todoPayload("init", "Other issue task", "pending"));

    const response = await request(createAgentApp(companyId, agentId)).get(`/api/issues/${issueId}/agent-todo`);

    expect(response.status).toBe(200);
    expect(response.body.snapshot).toMatchObject({
      ...todoPayload("start", "Second run task", "in_progress"),
      runId: secondRunId,
      agentId,
      issueId,
      seq: 1,
      runStatus: "running",
    });
    expect(Number.isNaN(Date.parse(response.body.snapshot.createdAt))).toBe(false);

    const byIdentifier = await request(createAgentApp(companyId, agentId)).get("/api/issues/TDA-1/agent-todo");
    expect(byIdentifier.body.snapshot.runId).toBe(secondRunId);

    const other = await request(createAgentApp(companyId, agentId)).get(`/api/issues/${otherIssueId}/agent-todo`);
    expect(other.body.snapshot).toMatchObject({ runId: otherRunId, issueId: otherIssueId, runStatus: "running" });
    expect(other.body.snapshot.phases[0].tasks[1].content).toBe("Other issue task");
  });

  it("returns null when the issue has no todo events or the newest payload is invalid", async () => {
    const { companyId, agentId } = await seedCompany("TDB");
    const issueId = await seedIssue(companyId, agentId, "TDB-1");
    const runId = await seedRun(companyId, agentId, issueId, "running");
    await appendEvent(companyId, agentId, runId, 1, "omp.tool", { toolName: "todo" });
    const app = createAgentApp(companyId, agentId);

    const empty = await request(app).get(`/api/issues/${issueId}/agent-todo`);
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ snapshot: null });

    await appendEvent(companyId, agentId, runId, 2, AGENT_TODO_EVENT_TYPE, { version: 2, phases: "broken" });
    expect(await getLatestAgentTodoSnapshot(db, { companyId, issueId })).toBeNull();
  });

  it("returns 404 for another company's issue and matches the runs route for unreadable private issues", async () => {
    const home = await seedCompany("TDC");
    const foreign = await seedCompany("TDD");
    const foreignIssueId = await seedIssue(foreign.companyId, foreign.agentId, "TDD-1");
    const foreignRunId = await seedRun(foreign.companyId, foreign.agentId, foreignIssueId, "running");
    await appendEvent(foreign.companyId, foreign.agentId, foreignRunId, 1, AGENT_TODO_EVENT_TYPE, todoPayload("init", "Foreign task", "in_progress"));

    const crossCompany = await request(createAgentApp(home.companyId, home.agentId)).get(`/api/issues/${foreignIssueId}/agent-todo`);
    expect(crossCompany.status).toBe(404);
    expect(JSON.stringify(crossCompany.body)).not.toContain("Foreign task");

    const privateIssueId = await seedIssue(home.companyId, home.agentId, "TDC-1", { visibility: "private" });
    await db.update(issues).set({ privacyRootIssueId: privateIssueId }).where(eq(issues.id, privateIssueId));
    const privateRunId = await seedRun(home.companyId, home.agentId, privateIssueId, "running");
    await appendEvent(home.companyId, home.agentId, privateRunId, 1, AGENT_TODO_EVENT_TYPE, todoPayload("init", "Private task", "in_progress"));

    const outsider = createAgentApp(home.companyId, home.otherAgentId);
    const todo = await request(outsider).get(`/api/issues/${privateIssueId}/agent-todo`);
    const runs = await request(outsider).get(`/api/issues/${privateIssueId}/runs`);
    expect(todo.status).toBe(403);
    expect(todo.status).toBe(runs.status);
    expect(JSON.stringify(todo.body)).not.toContain("Private task");

    const owner = await request(createAgentApp(home.companyId, home.agentId)).get(`/api/issues/${privateIssueId}/agent-todo`);
    expect(owner.status).toBe(200);
    expect(owner.body.snapshot.phases[0].tasks[1].content).toBe("Private task");
  });

  it("keeps ordinary task text intact through event payload redaction", () => {
    const payload = todoPayload("start", "Run related tests and comment gate", "in_progress");
    expect(redactEventPayload(payload)).toEqual(payload);
  });
});
