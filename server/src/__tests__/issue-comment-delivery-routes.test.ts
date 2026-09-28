import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agents,
  companies,
  companyMemberships,
  createDb,
  heartbeatRuns,
  instanceSettings,
  issueComments,
  issues,
  runIdentityContexts,
} from "@tickernelz/paperclip-pro-db";
import { runningProcesses } from "../adapters/index.js";
import { errorHandler } from "../middleware/index.js";
import { instanceSettingsRoutes } from "../routes/instance-settings.js";
import { issueRoutes } from "../routes/issues.js";
import { NativeSessionSteeringError } from "../services/native-runtime/native-session-executor.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const steerNativeSessionMock = vi.hoisted(() => vi.fn());
vi.mock("../services/native-runtime/native-session-executor.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/native-runtime/native-session-executor.js")>();
  steerNativeSessionMock.mockImplementation(actual.steerNativeSession);
  return { ...actual, steerNativeSession: steerNativeSessionMock };
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe.sequential : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping message-delivery route tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

interface SeededActiveRun {
  companyId: string;
  agentId: string;
  issueId: string;
  runId: string;
}

describeEmbeddedPostgres("issue comment message delivery", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-delivery-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  const testProcesses = new Map<string, ChildProcess>();

  afterEach(async () => {
    for (const [id, child] of testProcesses) {
      runningProcesses.delete(id);
      child.kill();
    }
    testProcesses.clear();
    steerNativeSessionMock.mockReset();
    // Best-effort cleanup. The heartbeat keeps working on this database after
    // a response is sent, and a truncate can deadlock against it under CI
    // load. Every case owns a uniquely prefixed company, so a row that
    // outlives this cleanup cannot reach the next case.
    await db.execute(sql`TRUNCATE TABLE companies CASCADE`).catch(() => undefined);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  function app(
    companyId: string,
    actor: { userId?: string; agentId?: string; runId?: string } = {},
  ) {
    const agentActor = actor.agentId
      ? { agentId: actor.agentId, runId: actor.runId }
      : null;
    const testApp = express();
    testApp.use(express.json());
    testApp.use((req, _res, next) => {
      (req as unknown as { actor: unknown }).actor = {
        type: agentActor ? "agent" : "board",
        ...(agentActor ? { ...agentActor, companyId } : {}),
        source: "session",
        userId: actor.userId ?? "delivery-owner",
        companyIds: [companyId],
        memberships: [{ companyId, status: "active", membershipRole: "operator" }],
        isInstanceAdmin: true,
      };
      next();
    });
    testApp.use("/api", instanceSettingsRoutes(db));
    testApp.use("/api", issueRoutes(db, {} as never, {}));
    testApp.use(errorHandler);
    return testApp;
  }

  async function setDefaultDelivery(
    value: "steer" | "queue",
    experimental: Record<string, unknown> = {},
  ) {
    await db
      .insert(instanceSettings)
      .values({
        singletonKey: "default",
        general: { defaultMessageDelivery: value },
        experimental,
      })
      .onConflictDoUpdate({
        target: instanceSettings.singletonKey,
        set: {
          general: { defaultMessageDelivery: value },
          experimental,
          updatedAt: new Date(),
        },
      });
  }

  async function seedActiveRun(
    options: { legacy?: boolean; conversation?: boolean } = {},
  ): Promise<SeededActiveRun> {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const runId = randomUUID();
    // The prefix carries a per-test suffix so a company row that outlives
    // this file's TRUNCATE (the heartbeat keeps working after the response)
    // can never block the next test's insert.
    await db.insert(companies).values({
      id: companyId,
      name: "Delivery Test Company",
      issuePrefix: `DLV-${companyId.slice(0, 8).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: "delivery-owner",
      status: "active",
      membershipRole: "operator",
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Delivery Runner",
      role: "engineer",
      status: "idle",
      adapterType: options.legacy ? "claude_local" : "paperclip_runner",
      adapterConfig: {},
      runtimeConfig: options.legacy
        ? { heartbeat: { maxConcurrentRuns: 1 } }
        : {},
      permissions: {},
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "assignment",
      triggerDetail: "delivery route test",
      status: "running",
      runtimeMode: options.legacy ? "legacy" : "native",
      startedAt: new Date("2026-08-22T15:00:00.000Z"),
      contextSnapshot: { issueId },
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      identifier: `DLV-${companyId.slice(0, 8).toUpperCase()}-1`,
      title: "Message delivery",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
      executionRunId: runId,
      ...(options.conversation
        ? {
            conversationAgentId: agentId,
            conversationUserId: "delivery-owner",
            conversationState: "active" as const,
          }
        : {}),
    });
    return { companyId, agentId, issueId, runId };
  }

  async function seedAgentAuthoredRun(seeded: SeededActiveRun) {
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId: seeded.companyId,
      agentId: seeded.agentId,
      invocationSource: "assignment",
      triggerDetail: "agent delivery test",
      status: "running",
      runtimeMode: "native",
      startedAt: new Date("2026-08-22T15:10:00.000Z"),
      contextSnapshot: { issueId: seeded.issueId },
    });
    return runId;
  }

  async function seedDispatchIdentity(seeded: SeededActiveRun) {
    const [identity] = await db
      .insert(runIdentityContexts)
      .values({
        companyId: seeded.companyId,
        runId: seeded.runId,
        revision: 1,
        cause: "dispatch",
        correlationId: "dispatch",
        status: "accepted",
        acceptedAt: new Date("2026-08-22T15:00:00.000Z"),
      })
      .returning();
    await db
      .update(heartbeatRuns)
      .set({ activeIdentityContextId: identity!.id })
      .where(eq(heartbeatRuns.id, seeded.runId));
  }

  function keepRunAlive(runId: string) {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    testProcesses.set(runId, child);
    runningProcesses.set(runId, { child, graceSec: 1, processGroupId: null });
  }

  it("steers a board comment during an active run with no extra click", async () => {
    const seeded = await seedActiveRun();
    await seedDispatchIdentity(seeded);
    steerNativeSessionMock.mockResolvedValue({ turnId: "turn-delivery" });
    keepRunAlive(seeded.runId);

    const posted = await request(app(seeded.companyId))
      .post(`/api/issues/${seeded.issueId}/comments`)
      .send({ body: "Use the parser we discussed" })
      .expect(201);

    expect(posted.body).toMatchObject({ deliveredAs: "steered" });
    expect(posted.body.steeringUnavailable).toBeUndefined();
    expect(steerNativeSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: seeded.runId,
        message: "Use the parser we discussed",
      }),
    );
    expect(
      await db.select().from(issueComments).where(eq(issueComments.id, posted.body.id)),
    ).toHaveLength(1);
    const steered = await db
      .select({ details: activityLog.details })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.action, "issue.queued_comment_steered"),
          eq(activityLog.entityId, seeded.issueId),
        ),
      );
    expect(steered).toHaveLength(1);
    expect(steered[0]?.details).toMatchObject({
      commentId: posted.body.id,
      targetRunId: seeded.runId,
      turnId: "turn-delivery",
      duplicate: false,
    });
  });

  it("keeps the same board comment queued when deliver is queue", async () => {
    const seeded = await seedActiveRun();
    await seedDispatchIdentity(seeded);
    steerNativeSessionMock.mockResolvedValue({ turnId: "turn-delivery" });
    keepRunAlive(seeded.runId);

    const posted = await request(app(seeded.companyId))
      .post(`/api/issues/${seeded.issueId}/comments`)
      .send({ body: "Hold this for later", deliver: "queue" })
      .expect(201);

    expect(posted.body).toMatchObject({
      deliveredAs: "queued",
      steeringUnavailable: "not_requested",
    });
    expect(steerNativeSessionMock).not.toHaveBeenCalled();
    expect(
      await db.select().from(issueComments).where(eq(issueComments.id, posted.body.id)),
    ).toHaveLength(1);
  });

  it("flips the default at runtime with no deploy and no restart", async () => {
    const seeded = await seedActiveRun();
    await seedDispatchIdentity(seeded);
    steerNativeSessionMock.mockResolvedValue({ turnId: "turn-delivery" });
    keepRunAlive(seeded.runId);
    const client = app(seeded.companyId);

    const steeredFirst = await request(client)
      .post(`/api/issues/${seeded.issueId}/comments`)
      .send({ body: "First message" })
      .expect(201);
    expect(steeredFirst.body.deliveredAs).toBe("steered");

    const general = await request(client)
      .get("/api/instance/settings/general")
      .expect(200);
    expect(general.body.defaultMessageDelivery).toBe("steer");
    await request(client)
      .patch("/api/instance/settings/general")
      .send({ defaultMessageDelivery: "queue" })
      .expect(200);

    const queuedAfterFlip = await request(client)
      .post(`/api/issues/${seeded.issueId}/comments`)
      .send({ body: "Second message" })
      .expect(201);
    expect(queuedAfterFlip.body).toMatchObject({
      deliveredAs: "queued",
      steeringUnavailable: "not_requested",
    });

    await request(client)
      .patch("/api/instance/settings/general")
      .send({ defaultMessageDelivery: "steer" })
      .expect(200);
    const steeredAgain = await request(client)
      .post(`/api/issues/${seeded.issueId}/comments`)
      .send({ body: "Third message" })
      .expect(201);
    expect(steeredAgain.body.deliveredAs).toBe("steered");
  });

  it("still accepts an agent comment with no explicit mode after the default flips to steering", async () => {
    const seeded = await seedActiveRun();
    await seedDispatchIdentity(seeded);
    keepRunAlive(seeded.runId);
    await setDefaultDelivery("steer");
    const agentRunId = await seedAgentAuthoredRun(seeded);

    const posted = await request(
      app(seeded.companyId, { agentId: seeded.agentId, runId: agentRunId }),
    )
      .post(`/api/issues/${seeded.issueId}/comments`)
      .send({ body: "Status update from the run" })
      .expect(201);

    expect(posted.body).toMatchObject({
      deliveredAs: "queued",
      steeringUnavailable: "board_only",
    });
    expect(steerNativeSessionMock).not.toHaveBeenCalled();
  });

  it("queues an agent steer request with the reason instead of failing it", async () => {
    const seeded = await seedActiveRun();
    await seedDispatchIdentity(seeded);
    keepRunAlive(seeded.runId);
    await setDefaultDelivery("steer");
    const agentRunId = await seedAgentAuthoredRun(seeded);

    const posted = await request(
      app(seeded.companyId, { agentId: seeded.agentId, runId: agentRunId }),
    )
      .post(`/api/issues/${seeded.issueId}/comments`)
      .send({ body: "Please steer now", deliver: "steer" })
      .expect(201);

    expect(posted.body).toMatchObject({
      deliveredAs: "queued",
      steeringUnavailable: "board_only",
    });
    expect(steerNativeSessionMock).not.toHaveBeenCalled();
  });

  it("degrades a board steer to queue and names the legacy protocol", async () => {
    const seeded = await seedActiveRun({ legacy: true });
    await seedDispatchIdentity(seeded);
    keepRunAlive(seeded.runId);

    const posted = await request(app(seeded.companyId))
      .post(`/api/issues/${seeded.issueId}/comments`)
      .send({ body: "Steer me" })
      .expect(201);

    expect(posted.body).toMatchObject({
      deliveredAs: "queued",
      steeringUnavailable: "legacy_protocol",
    });
    expect(steerNativeSessionMock).not.toHaveBeenCalled();
    expect(
      await db.select().from(issueComments).where(eq(issueComments.id, posted.body.id)),
    ).toHaveLength(1);
  });

  it("queues a plain conversation message without claiming a steer was downgraded", async () => {
    const seeded = await seedActiveRun({ conversation: true });
    await setDefaultDelivery("steer", { enableAgentChat: true });
    keepRunAlive(seeded.runId);

    const posted = await request(app(seeded.companyId))
      .post(`/api/issues/${seeded.issueId}/comments`)
      .send({ body: "Steer the chat", clientRequestId: randomUUID() })
      .expect(201);

    expect(posted.body).toMatchObject({
      deliveredAs: "queued",
      steeringUnavailable: "not_requested",
    });
  });

  it("names the conversation issue when an explicit steer is downgraded", async () => {
    const seeded = await seedActiveRun({ conversation: true });
    await setDefaultDelivery("steer", { enableAgentChat: true });
    keepRunAlive(seeded.runId);

    const posted = await request(app(seeded.companyId))
      .post(`/api/issues/${seeded.issueId}/comments`)
      .send({ body: "Steer the chat", deliver: "steer", clientRequestId: randomUUID() })
      .expect(201);

    expect(posted.body).toMatchObject({
      deliveredAs: "queued",
      steeringUnavailable: "conversation_issue",
    });
  });

  it("degrades a board steer to queue and names the failed attempt when the runner rejects it", async () => {
    const seeded = await seedActiveRun();
    await seedDispatchIdentity(seeded);
    keepRunAlive(seeded.runId);
    steerNativeSessionMock.mockRejectedValue(
      new NativeSessionSteeringError(
        "steering_rejected",
        "The runner refused the injection.",
      ),
    );

    const posted = await request(app(seeded.companyId))
      .post(`/api/issues/${seeded.issueId}/comments`)
      .send({ body: "Steer me anyway" })
      .expect(201);

    expect(posted.body).toMatchObject({
      deliveredAs: "queued",
      steeringUnavailable: "steering_failed",
    });
    expect(
      await db.select().from(issueComments).where(eq(issueComments.id, posted.body.id)),
    ).toHaveLength(1);
  });

  it("degrades to no_active_run when nothing is running to steer", async () => {
    const seeded = await seedActiveRun();
    await db
      .update(heartbeatRuns)
      .set({ status: "succeeded", finishedAt: new Date() })
      .where(eq(heartbeatRuns.id, seeded.runId));
    await db
      .update(issues)
      .set({ executionRunId: null })
      .where(eq(issues.id, seeded.issueId));

    const posted = await request(app(seeded.companyId))
      .post(`/api/issues/${seeded.issueId}/comments`)
      .send({ body: "Nobody is running" })
      .expect(201);

    expect(posted.body).toMatchObject({
      deliveredAs: "queued",
      steeringUnavailable: "no_active_run",
    });
    expect(steerNativeSessionMock).not.toHaveBeenCalled();
  });

  it("carries the same disposition on a reassign-and-comment issue update", async () => {
    const seeded = await seedActiveRun();
    await seedDispatchIdentity(seeded);
    steerNativeSessionMock.mockResolvedValue({ turnId: "turn-patch" });
    keepRunAlive(seeded.runId);

    const updated = await request(app(seeded.companyId))
      .patch(`/api/issues/${seeded.issueId}`)
      .send({ comment: "Steer through the update path", assigneeAgentId: seeded.agentId })
      .expect(200);

    expect(updated.body.comment).toMatchObject({ deliveredAs: "steered" });
    expect(updated.body.comment.steeringUnavailable).toBeUndefined();
    expect(steerNativeSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Steer through the update path" }),
    );
  });

  it("rejects an unknown delivery mode instead of guessing one", async () => {
    const seeded = await seedActiveRun();

    await request(app(seeded.companyId))
      .post(`/api/issues/${seeded.issueId}/comments`)
      .send({ body: "Bad mode", deliver: "shout" })
      .expect(400);
  });

  it("leaves a stored acknowledgement durable when the same steer is replayed", async () => {
    const seeded = await seedActiveRun();
    await seedDispatchIdentity(seeded);
    steerNativeSessionMock.mockResolvedValue({ turnId: "turn-replay" });
    keepRunAlive(seeded.runId);
    const client = app(seeded.companyId);

    const posted = await request(client)
      .post(`/api/issues/${seeded.issueId}/comments`)
      .send({ body: "Deliver exactly once" })
      .expect(201);
    expect(posted.body.deliveredAs).toBe("steered");
    const callsAfterFirst = steerNativeSessionMock.mock.calls.length;

    const queue = await request(client)
      .get(`/api/issues/${seeded.issueId}/queued-comments`)
      .expect(200);
    expect(queue.body.entries.map((entry: { comment: { id: string } }) => entry.comment.id))
      .not.toContain(posted.body.id);

    const run = await db
      .select({ resultJson: heartbeatRuns.resultJson })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, seeded.runId))
      .then((rows) => rows[0]);
    const acknowledgements = (run?.resultJson as Record<string, Record<string, unknown>> | null)
      ?.queuedSteeringAcknowledgements as Record<string, unknown> | undefined;
    expect(acknowledgements?.[posted.body.id]).toMatchObject({
      status: "acknowledged",
      turnId: "turn-replay",
    });
    expect(steerNativeSessionMock.mock.calls).toHaveLength(callsAfterFirst);
    const identities = await db
      .select()
      .from(runIdentityContexts)
      .where(eq(runIdentityContexts.messageId, posted.body.id));
    expect(identities).toHaveLength(1);
    expect(identities[0].status).toBe("accepted");
  });
});
