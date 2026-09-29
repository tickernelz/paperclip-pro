import { randomUUID } from "node:crypto";
import express from "express";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issues,
} from "@tickernelz/paperclip-pro-db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/index.js";

const support = await getEmbeddedPostgresTestSupport();
const describePostgres = support.supported ? describe : describe.skip;

interface GuardFixture {
  issueId: string;
  executorRunId: string;
  peerRunId: string;
}

describePostgres("agent review handoff and reassign guards", () => {
  let db: ReturnType<typeof createDb>;
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  const companyId = randomUUID();
  const executorId = randomUUID();
  const reviewerId = randomUUID();
  const peerId = randomUUID();
  let issueNumber = 0;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-handoff-guard-");
    db = createDb(database.connectionString);
    await db.insert(companies).values({
      id: companyId,
      name: "Guard Co",
      issuePrefix: "GRD",
      defaultResponsibleUserId: "board-user",
    });
    await db.insert(agents).values([
      { id: executorId, companyId, name: "Executor", role: "engineer", status: "idle", adapterType: "codex_local" },
      { id: reviewerId, companyId, name: "Reviewer", role: "engineer", status: "idle", adapterType: "codex_local" },
      { id: peerId, companyId, name: "Peer", role: "engineer", status: "idle", adapterType: "codex_local" },
    ]);
  }, 60_000);

  afterAll(async () => {
    await database?.cleanup();
  });

  async function seed(overrides: Record<string, unknown> = {}): Promise<GuardFixture> {
    issueNumber += 1;
    const issueId = randomUUID();
    const executorRunId = randomUUID();
    const peerRunId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Guarded work",
      identifier: `GRD-${issueNumber}`,
      issueNumber,
      status: "in_progress",
      assigneeAgentId: executorId,
      createdByUserId: "board-user",
      ...overrides,
    });
    await db.insert(heartbeatRuns).values([
      { id: executorRunId, companyId, agentId: executorId, status: "running", contextSnapshot: { issueId } },
      { id: peerRunId, companyId, agentId: peerId, status: "running", contextSnapshot: { issueId } },
    ]);
    return { issueId, executorRunId, peerRunId };
  }

  function app(actor: { agentId?: string; runId?: string } = {}) {
    const testApp = express();
    testApp.use(express.json());
    testApp.use((req, _res, next) => {
      (req as unknown as { actor: unknown }).actor = actor.agentId
        ? {
            type: "agent",
            agentId: actor.agentId,
            runId: actor.runId,
            companyId,
            source: "session",
            userId: "board-user",
            companyIds: [companyId],
            memberships: [{ companyId, status: "active", membershipRole: "operator" }],
            isInstanceAdmin: true,
          }
        : {
            type: "board",
            userId: "board-user",
            source: "local_implicit",
            companyIds: [companyId],
            memberships: [{ companyId, status: "active", membershipRole: "operator" }],
            isInstanceAdmin: true,
          };
      next();
    });
    testApp.use("/api", issueRoutes(db, {} as never));
    testApp.use(errorHandler);
    return testApp;
  }

  function stagePolicy(type: "review" | "approval", participantAgentId: string, stageId?: string) {
    return {
      mode: "normal",
      commentRequired: true,
      stages: [
        {
          ...(stageId ? { id: stageId } : {}),
          type,
          participants: [{ type: "agent", agentId: participantAgentId }],
        },
      ],
    };
  }

  it("rejects a handoff through approval stages the agent authored in an earlier update", async () => {
    const { issueId, executorRunId } = await seed();
    const executorApp = app({ agentId: executorId, runId: executorRunId });
    const armed = await request(executorApp)
      .patch(`/api/issues/${issueId}`)
      .send({ executionPolicy: stagePolicy("approval", reviewerId) });
    expect(armed.status, JSON.stringify(armed.body)).toBe(200);
    const logged = await db
      .select({ action: activityLog.action })
      .from(activityLog)
      .where(eq(activityLog.entityId, issueId));
    expect(logged.map((row) => row.action)).toContain("issue.approvers_updated");

    const handoff = await request(app({ agentId: executorId, runId: executorRunId }))
      .patch(`/api/issues/${issueId}`)
      .send({ status: "in_review" });

    expect(handoff.status, JSON.stringify(handoff.body)).toBe(422);
    expect(handoff.body.details).toMatchObject({ code: "agent_review_handoff_requires_subtask" });
    const [row] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(row?.assigneeAgentId).toBe(executorId);
  });

  it("starts the handoff when the board authored the approval stage", async () => {
    const { issueId, executorRunId } = await seed();
    await request(app())
      .patch(`/api/issues/${issueId}`)
      .send({ executionPolicy: stagePolicy("approval", reviewerId) })
      .expect(200);

    const handoff = await request(app({ agentId: executorId, runId: executorRunId }))
      .patch(`/api/issues/${issueId}`)
      .send({ status: "in_review" });

    expect(handoff.status, JSON.stringify(handoff.body)).toBe(200);
    const [row] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(row?.assigneeAgentId).toBe(reviewerId);
    expect(row?.status).toBe("in_review");
  });

  it("treats stages carried by an agent-created issue as agent-authored", async () => {
    const { issueId, executorRunId } = await seed({
      createdByAgentId: executorId,
      executionPolicy: stagePolicy("review", reviewerId),
    });

    const handoff = await request(app({ agentId: executorId, runId: executorRunId }))
      .patch(`/api/issues/${issueId}`)
      .send({ status: "in_review" });

    expect(handoff.status, JSON.stringify(handoff.body)).toBe(422);
    expect(handoff.body.details).toMatchObject({ code: "agent_review_handoff_requires_subtask" });
  });

  it("rejects re-pointing an in-flight stage at a reviewer chosen in the same update", async () => {
    const stageId = randomUUID();
    const { issueId, executorRunId } = await seed({
      executionPolicy: stagePolicy("review", reviewerId, stageId),
      executionState: {
        status: "changes_requested",
        currentStageId: stageId,
        currentStageIndex: 0,
        currentStageType: "review",
        currentParticipant: { type: "agent", agentId: reviewerId },
        returnAssignee: { type: "agent", agentId: executorId },
        completedStageIds: [],
        lastDecisionId: null,
        lastDecisionOutcome: "changes_requested",
        changesRequestedCount: 1,
      },
    });

    const handoff = await request(app({ agentId: executorId, runId: executorRunId }))
      .patch(`/api/issues/${issueId}`)
      .send({
        status: "in_review",
        executionPolicy: stagePolicy("review", peerId, stageId),
      });

    expect(handoff.status, JSON.stringify(handoff.body)).toBe(422);
    expect(handoff.body.details).toMatchObject({ code: "agent_review_handoff_requires_subtask" });
    const [row] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(row?.assigneeAgentId).toBe(executorId);
  });

  it("rejects an agent clearing the assignee of its own task", async () => {
    const { issueId, executorRunId } = await seed();
    const cleared = await request(app({ agentId: executorId, runId: executorRunId }))
      .patch(`/api/issues/${issueId}`)
      .send({ assigneeAgentId: null });

    expect(cleared.status, JSON.stringify(cleared.body)).toBe(422);
    expect(cleared.body.details).toMatchObject({ code: "agent_reassign_requires_subtask" });
    const [row] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(row?.assigneeAgentId).toBe(executorId);
  });

  it("keeps release working but blocks the releasing agent from handing the issue on", async () => {
    const { issueId, executorRunId } = await seed();
    const released = await request(app({ agentId: executorId, runId: executorRunId }))
      .post(`/api/issues/${issueId}/release`)
      .send({});
    expect(released.status, JSON.stringify(released.body)).toBe(200);
    const [afterRelease] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(afterRelease?.assigneeAgentId).toBeNull();

    const handoff = await request(app({ agentId: executorId, runId: executorRunId }))
      .patch(`/api/issues/${issueId}`)
      .send({ assigneeAgentId: reviewerId });
    expect(handoff.status, JSON.stringify(handoff.body)).toBe(422);
    expect(handoff.body.details).toMatchObject({ code: "agent_reassign_requires_subtask" });

    const retaken = await request(app({ agentId: executorId, runId: executorRunId }))
      .patch(`/api/issues/${issueId}`)
      .send({ assigneeAgentId: executorId });
    expect(retaken.status, JSON.stringify(retaken.body)).toBe(200);
  });

  it("lets an agent that did not release the issue assign it", async () => {
    const { issueId, executorRunId, peerRunId } = await seed();
    await request(app({ agentId: executorId, runId: executorRunId }))
      .post(`/api/issues/${issueId}/release`)
      .send({})
      .expect(200);

    const assigned = await request(app({ agentId: peerId, runId: peerRunId }))
      .patch(`/api/issues/${issueId}`)
      .send({ assigneeAgentId: reviewerId });

    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);
    const [row] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(row?.assigneeAgentId).toBe(reviewerId);
  });

  it("stops refusing the releaser once the board reassigns and clears the issue again", async () => {
    const { issueId, executorRunId } = await seed();
    await request(app({ agentId: executorId, runId: executorRunId }))
      .post(`/api/issues/${issueId}/release`)
      .send({})
      .expect(200);

    const refused = await request(app({ agentId: executorId, runId: executorRunId }))
      .patch(`/api/issues/${issueId}`)
      .send({ assigneeAgentId: reviewerId });
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);

    await request(app())
      .patch(`/api/issues/${issueId}`)
      .send({ assigneeAgentId: peerId })
      .expect(200);
    await request(app())
      .patch(`/api/issues/${issueId}`)
      .send({ assigneeAgentId: null })
      .expect(200);

    const allowed = await request(app({ agentId: executorId, runId: executorRunId }))
      .patch(`/api/issues/${issueId}`)
      .send({ assigneeAgentId: reviewerId });
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
  });

  it("does not treat echoing the board's stages back unchanged as agent authoring", async () => {
    const { issueId, executorRunId } = await seed();
    await request(app())
      .patch(`/api/issues/${issueId}`)
      .send({ executionPolicy: stagePolicy("review", reviewerId) })
      .expect(200);

    const handoff = await request(app({ agentId: executorId, runId: executorRunId }))
      .patch(`/api/issues/${issueId}`)
      .send({ status: "in_review", executionPolicy: stagePolicy("review", reviewerId) });

    expect(handoff.status, JSON.stringify(handoff.body)).toBe(200);
    const [row] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(row?.assigneeAgentId).toBe(reviewerId);
  });
});
