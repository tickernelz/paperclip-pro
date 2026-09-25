import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agentWakeupRequests,
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issueComments,
  issueThreadInteractions,
  issues,
} from "@tickernelz/paperclip-pro-db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../__tests__/helpers/embedded-postgres.js";
import {
  buildExecutionContinuation,
  currentContinuationOrigins,
} from "./execution-continuation.js";
import { withQueuedCommentIdsInWakePayload } from "./issue-queued-comment-queue.js";

const support = await getEmbeddedPostgresTestSupport();

(support.supported ? describe : describe.skip)("queued comment continuation origins", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-queued-origin-");
    db = createDb(database.connectionString);
  }, 60_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(issueThreadInteractions);
    await db.delete(agentWakeupRequests);
    await db.delete(issueComments);
    await db.delete(issues);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await database?.cleanup();
  });

  async function fixture() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const activeRunId = randomUUID();
    const deliveredCommentId = randomUUID();
    const queuedCommentId = randomUUID();
    const queueWakeId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Queued origin fixture",
      issuePrefix: `QOR${companyId.slice(0, 8)}`,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Executor",
      role: "engineer",
      adapterType: "paperclip_runner",
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Ship the interaction",
      status: "in_progress",
      assigneeAgentId: agentId,
    });
    await db.insert(issueComments).values([
      {
        id: deliveredCommentId,
        companyId,
        issueId,
        authorType: "user",
        authorUserId: "local-board",
        body: "Delivered direction.",
        createdAt: new Date("2026-09-25T06:50:00.000Z"),
      },
      {
        id: queuedCommentId,
        companyId,
        issueId,
        authorType: "user",
        authorUserId: "local-board",
        body: "Queued direction that never reached the session.",
        createdAt: new Date("2026-09-25T06:54:43.000Z"),
      },
    ]);
    await db.insert(heartbeatRuns).values({
      id: activeRunId,
      companyId,
      agentId,
      status: "succeeded",
      contextSnapshot: { issueId, commentId: deliveredCommentId },
    });
    await db.insert(agentWakeupRequests).values({
      id: queueWakeId,
      companyId,
      agentId,
      source: "assignment",
      reason: "issue_comment",
      status: "queued",
      payload: withQueuedCommentIdsInWakePayload({ issueId }, [queuedCommentId]),
    });
    return {
      companyId,
      agentId,
      issueId,
      activeRunId,
      deliveredCommentId,
      queuedCommentId,
      queueWakeId,
    };
  }

  async function seedInteraction(input: {
    companyId: string;
    issueId: string;
    sourceRunId: string;
    originCommentIds: string[];
  }) {
    const interactionId = randomUUID();
    await db.insert(issueThreadInteractions).values({
      id: interactionId,
      companyId: input.companyId,
      issueId: input.issueId,
      kind: "request_confirmation",
      status: "rejected",
      sourceRunId: input.sourceRunId,
      originCommentIds: input.originCommentIds,
      resolvedByUserId: "local-board",
      resolvedAt: new Date("2026-09-25T06:56:34.000Z"),
      payload: { version: 1, prompt: "Proceed?" },
      result: { version: 1, outcome: "rejected" },
    });
    return interactionId;
  }

  async function discardQueuedComment(input: {
    companyId: string;
    issueId: string;
    commentId: string;
  }) {
    await db.delete(issueComments).where(eq(issueComments.id, input.commentId));
    await db.insert(activityLog).values({
      companyId: input.companyId,
      actorType: "user",
      actorId: "local-board",
      action: "issue.queued_comment_discarded",
      entityType: "issue",
      entityId: input.issueId,
      details: { commentId: input.commentId, queueId: randomUUID() },
    });
  }

  it("keeps an undelivered queued comment out of newly captured interaction origins", async () => {
    const f = await fixture();

    const origins = await currentContinuationOrigins(db, f.companyId, f.issueId, {
      commentId: f.deliveredCommentId,
    });

    expect(origins).toEqual([f.deliveredCommentId]);
    expect(origins).not.toContain(f.queuedCommentId);
  });

  it("records the queued comment as an origin once its wake is no longer pending", async () => {
    const f = await fixture();
    await db
      .update(agentWakeupRequests)
      .set({ status: "succeeded" })
      .where(eq(agentWakeupRequests.id, f.queueWakeId));

    expect(
      await currentContinuationOrigins(db, f.companyId, f.issueId, {
        commentId: f.deliveredCommentId,
      }),
    ).toEqual([f.deliveredCommentId, f.queuedCommentId]);
  });

  it("dispatches the rejection continuation after the queued origin was discarded", async () => {
    const f = await fixture();
    const interactionId = await seedInteraction({
      companyId: f.companyId,
      issueId: f.issueId,
      sourceRunId: f.activeRunId,
      originCommentIds: [f.deliveredCommentId, f.queuedCommentId],
    });
    await discardQueuedComment({
      companyId: f.companyId,
      issueId: f.issueId,
      commentId: f.queuedCommentId,
    });

    const envelope = await buildExecutionContinuation({
      db,
      companyId: f.companyId,
      issueId: f.issueId,
      agentId: f.agentId,
      context: {
        interactionId,
        wakeReason: "issue_execution_promoted",
        source: "issue.interaction.reject",
      },
      summary: null,
      exposeLowTrustRaw: false,
    });

    expect(envelope.originCommentIds).toEqual([f.deliveredCommentId]);
    expect(envelope.messages.map((row) => row.id)).toEqual([f.deliveredCommentId]);
    expect(envelope.trigger.interactionId).toBe(interactionId);
  });

  it("still fails closed when an origin is missing without a discard record", async () => {
    const f = await fixture();
    const missingCommentId = randomUUID();
    const interactionId = await seedInteraction({
      companyId: f.companyId,
      issueId: f.issueId,
      sourceRunId: f.activeRunId,
      originCommentIds: [f.deliveredCommentId, missingCommentId],
    });

    await expect(
      buildExecutionContinuation({
        db,
        companyId: f.companyId,
        issueId: f.issueId,
        agentId: f.agentId,
        context: { interactionId, wakeReason: "issue_execution_promoted" },
        summary: null,
        exposeLowTrustRaw: false,
      }),
    ).rejects.toThrow("continuation_source_context_missing");
  });

  it("still fails closed when a discard record belongs to another task", async () => {
    const f = await fixture();
    const interactionId = await seedInteraction({
      companyId: f.companyId,
      issueId: f.issueId,
      sourceRunId: f.activeRunId,
      originCommentIds: [f.deliveredCommentId, f.queuedCommentId],
    });
    const otherIssueId = randomUUID();
    await db.insert(issues).values({
      id: otherIssueId,
      companyId: f.companyId,
      title: "Another task",
      status: "todo",
      assigneeAgentId: f.agentId,
    });
    await db.delete(issueComments).where(eq(issueComments.id, f.queuedCommentId));
    await db.insert(activityLog).values({
      companyId: f.companyId,
      actorType: "user",
      actorId: "local-board",
      action: "issue.queued_comment_discarded",
      entityType: "issue",
      entityId: otherIssueId,
      details: { commentId: f.queuedCommentId },
    });

    await expect(
      buildExecutionContinuation({
        db,
        companyId: f.companyId,
        issueId: f.issueId,
        agentId: f.agentId,
        context: { interactionId, wakeReason: "issue_execution_promoted" },
        summary: null,
        exposeLowTrustRaw: false,
      }),
    ).rejects.toThrow("continuation_source_context_missing");
  });
});
