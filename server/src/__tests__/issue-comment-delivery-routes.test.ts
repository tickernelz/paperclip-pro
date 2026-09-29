import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  environmentLeases,
  agentWakeupRequests,
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
import {
  adapterExecutionControls,
  createAdapterExecutionControl,
} from "../services/adapter-execution-control.js";
import { errorHandler } from "../middleware/index.js";
import { instanceSettingsRoutes } from "../routes/instance-settings.js";
import { issueRoutes } from "../routes/issues.js";
import { NativeSessionSteeringError } from "../services/native-runtime/native-session-executor.js";
import type * as Services from "../services/index.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const steerNativeSessionMock = vi.hoisted(() => vi.fn());
const steeringState = vi.hoisted(() => ({
  real: null as null | ((runId: string) => Promise<unknown>),
  mock: vi.fn(),
}));
vi.mock("../services/native-runtime/native-session-executor.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/native-runtime/native-session-executor.js")>();
  steerNativeSessionMock.mockImplementation(actual.steerNativeSession);
  steeringState.real = actual.getNativeSessionSteeringState;
  steeringState.mock.mockImplementation(actual.getNativeSessionSteeringState);
  return {
    ...actual,
    steerNativeSession: steerNativeSessionMock,
    getNativeSessionSteeringState: steeringState.mock,
  };
});

type ServicesModule = typeof Services;
const runLookup = vi.hoisted(() => ({ fail: false }));
vi.mock("../services/index.js", async (importOriginal) => {
  const actual = await importOriginal<ServicesModule>();
  return {
    ...actual,
    heartbeatService: (...args: Parameters<ServicesModule["heartbeatService"]>) => {
      const service = actual.heartbeatService(...args);
      return {
        ...service,
        getRun: (...runArgs: Parameters<typeof service.getRun>) => {
          if (runLookup.fail) throw new Error("run lookup unavailable");
          return service.getRun(...runArgs);
        },
      };
    },
  };
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
    runLookup.fail = false;
    steeringState.mock.mockReset();
    if (steeringState.real) steeringState.mock.mockImplementation(steeringState.real);
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

  it("steers a chat message into the running turn and drops its follow-up wake", async () => {
    const seeded = await seedActiveRun({ conversation: true });
    await seedDispatchIdentity(seeded);
    await setDefaultDelivery("steer", { enableAgentChat: true });
    steerNativeSessionMock.mockResolvedValue({ turnId: "turn-chat" });
    keepRunAlive(seeded.runId);

    const posted = await request(app(seeded.companyId))
      .post(`/api/issues/${seeded.issueId}/comments`)
      .send({ body: "Steer the chat", clientRequestId: randomUUID() })
      .expect(201);

    expect(posted.body).toMatchObject({ deliveredAs: "steered" });
    expect(steerNativeSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ runId: seeded.runId, message: "Steer the chat" }),
    );
    const pendingWakes = await db
      .select({ status: agentWakeupRequests.status })
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.idempotencyKey, `conversation-comment:${posted.body.id}`));
    expect(pendingWakes.map((wake) => wake.status)).not.toContain("deferred_issue_execution");
  });

  it("queues a /new chat reset instead of steering it as text", async () => {
    const seeded = await seedActiveRun({ conversation: true });
    await seedDispatchIdentity(seeded);
    await setDefaultDelivery("steer", { enableAgentChat: true });
    steerNativeSessionMock.mockResolvedValue({ turnId: "turn-chat" });
    keepRunAlive(seeded.runId);

    const posted = await request(app(seeded.companyId))
      .post(`/api/issues/${seeded.issueId}/comments`)
      .send({ body: "/new", clientRequestId: randomUUID() })
      .expect(201);

    expect(posted.body).toMatchObject({
      deliveredAs: "queued",
      steeringUnavailable: "conversation_order",
    });
    expect(steerNativeSessionMock).not.toHaveBeenCalled();
  });

  it("keeps a later chat message behind an earlier one that is still queued", async () => {
    const seeded = await seedActiveRun({ conversation: true });
    await seedDispatchIdentity(seeded);
    await setDefaultDelivery("steer", { enableAgentChat: true });
    keepRunAlive(seeded.runId);
    const client = app(seeded.companyId);

    const first = await request(client)
      .post(`/api/issues/${seeded.issueId}/comments`)
      .send({ body: "First, answer this", clientRequestId: randomUUID(), deliver: "queue" })
      .expect(201);
    expect(first.body.deliveredAs).toBe("queued");
    steerNativeSessionMock.mockResolvedValue({ turnId: "turn-chat" });

    const second = await request(client)
      .post(`/api/issues/${seeded.issueId}/comments`)
      .send({ body: "Then this", clientRequestId: randomUUID() })
      .expect(201);

    expect(second.body).toMatchObject({
      deliveredAs: "queued",
      steeringUnavailable: "conversation_order",
    });
    expect(steerNativeSessionMock).not.toHaveBeenCalled();
  });

  it("offers steering in the chat queue and delivers it when the Steer action is used", async () => {
    const seeded = await seedActiveRun({ conversation: true });
    await seedDispatchIdentity(seeded);
    await setDefaultDelivery("steer", { enableAgentChat: true });
    keepRunAlive(seeded.runId);
    steeringState.mock.mockResolvedValue({ disposition: "available", activeTurnId: "turn-chat" });
    steerNativeSessionMock.mockResolvedValue({ turnId: "turn-chat" });
    const client = app(seeded.companyId);

    const posted = await request(client)
      .post(`/api/issues/${seeded.issueId}/comments`)
      .send({ body: "Queue me", clientRequestId: randomUUID(), deliver: "queue" })
      .expect(201);
    const queue = await request(client)
      .get(`/api/issues/${seeded.issueId}/queued-comments`)
      .expect(200);
    expect(queue.body.steeringDisposition).toBe("available");

    const steered = await request(client)
      .post(`/api/issues/${seeded.issueId}/queued-comments/${posted.body.id}/steer`)
      .send({ queueId: queue.body.queueId, targetRunId: seeded.runId, revision: queue.body.revision });
    expect(steered.status).toBe(200);
    expect(steerNativeSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ runId: seeded.runId, message: "Queue me" }),
    );
  });

  it("refuses the Steer action for a queued /new chat reset", async () => {
    const seeded = await seedActiveRun({ conversation: true });
    await seedDispatchIdentity(seeded);
    await setDefaultDelivery("steer", { enableAgentChat: true });
    keepRunAlive(seeded.runId);
    steeringState.mock.mockResolvedValue({ disposition: "available", activeTurnId: "turn-chat" });
    steerNativeSessionMock.mockResolvedValue({ turnId: "turn-chat" });
    const client = app(seeded.companyId);

    const posted = await request(client)
      .post(`/api/issues/${seeded.issueId}/comments`)
      .send({ body: "/new", clientRequestId: randomUUID() })
      .expect(201);
    const queue = await request(client)
      .get(`/api/issues/${seeded.issueId}/queued-comments`)
      .expect(200);
    const steered = await request(client)
      .post(`/api/issues/${seeded.issueId}/queued-comments/${posted.body.id}/steer`)
      .send({ queueId: queue.body.queueId, targetRunId: seeded.runId, revision: queue.body.revision });

    expect(steered.status).toBe(409);
    expect(steered.body.details).toMatchObject({ code: "conversation_order" });
    expect(steerNativeSessionMock).not.toHaveBeenCalled();
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

  it("keeps a message queued for the next turn when the steered turn already ended", async () => {
    const seeded = await seedActiveRun();
    await seedDispatchIdentity(seeded);
    keepRunAlive(seeded.runId);
    steerNativeSessionMock.mockRejectedValue(
      new NativeSessionSteeringError("steering_stale_turn", "The target turn is no longer active."),
    );
    const client = app(seeded.companyId);

    const posted = await request(client)
      .post(`/api/issues/${seeded.issueId}/comments`)
      .send({ body: "Arrived as the turn finished" })
      .expect(201);

    expect(posted.body).toMatchObject({ deliveredAs: "queued", steeringUnavailable: "steering_failed" });
    const queue = await request(client)
      .get(`/api/issues/${seeded.issueId}/queued-comments`)
      .expect(200);
    expect(queue.body.entries.map((entry: { comment: { id: string } }) => entry.comment.id)).toContain(
      posted.body.id,
    );
  });

  it("names no_active_run when an explicit steer finds nothing running", async () => {
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
      .send({ body: "Nobody is running", deliver: "steer" })
      .expect(201);

    expect(posted.body).toMatchObject({
      deliveredAs: "queued",
      steeringUnavailable: "no_active_run",
    });
    expect(steerNativeSessionMock).not.toHaveBeenCalled();
  });

  it("reports no downgrade when the default steer finds nothing running and the message starts a turn", async () => {
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
      steeringUnavailable: "not_requested",
    });
    expect(steerNativeSessionMock).not.toHaveBeenCalled();
  });

  it("names steering_failed when resolving the steering target breaks", async () => {
    const seeded = await seedActiveRun();
    await seedDispatchIdentity(seeded);
    keepRunAlive(seeded.runId);
    runLookup.fail = true;

    const posted = await request(app(seeded.companyId))
      .post(`/api/issues/${seeded.issueId}/comments`)
      .send({ body: "Lookup breaks" })
      .expect(201);

    expect(posted.body).toMatchObject({
      deliveredAs: "queued",
      steeringUnavailable: "steering_failed",
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

  it.each([
    { lease: "local", handedOff: true },
    { lease: "ssh", handedOff: false },
  ])("hands an issue to its review stage from the assignee's own live run on a $lease lease", async ({ lease, handedOff }) => {
    const seeded = await seedActiveRun({ legacy: true });
    keepRunAlive(seeded.runId);
    await db.insert(environmentLeases).values({
      companyId: seeded.companyId,
      heartbeatRunId: seeded.runId,
      issueId: seeded.issueId,
      provider: lease,
    });
    const control = createAdapterExecutionControl();
    control.controller.signal.addEventListener("abort", () => {
      void db
        .update(heartbeatRuns)
        .set({ status: "cancelled", finishedAt: new Date() })
        .where(eq(heartbeatRuns.id, seeded.runId))
        .then(() => control.finish());
    });
    adapterExecutionControls.set(seeded.runId, control);
    const reviewerId = randomUUID();
    await db.insert(agents).values({
      id: reviewerId,
      companyId: seeded.companyId,
      name: "Delivery Reviewer",
      role: "engineer",
      status: "idle",
      adapterType: "claude_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db
      .update(issues)
      .set({ checkoutRunId: seeded.runId })
      .where(eq(issues.id, seeded.issueId));
    const agentApp = app(seeded.companyId, { agentId: seeded.agentId, runId: seeded.runId });

    await request(app(seeded.companyId))
      .patch(`/api/issues/${seeded.issueId}`)
      .send({
        executionPolicy: {
          mode: "normal",
          commentRequired: true,
          stages: [{ type: "review", participants: [{ type: "agent", agentId: reviewerId }] }],
        },
      })
      .expect(200);

    const handoff = await request(agentApp)
      .patch(`/api/issues/${seeded.issueId}`)
      .send({ status: "in_review", comment: "Ready for review" });

    const [issue] = await db.select().from(issues).where(eq(issues.id, seeded.issueId));
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    if (handedOff) {
      expect(handoff.status, JSON.stringify(handoff.body)).toBe(200);
      expect(issue).toMatchObject({ status: "in_review", assigneeAgentId: reviewerId });
      expect(run?.resultJson).toMatchObject({
        executionCancellation: { state: "acknowledged", proof: "local_process_terminated" },
      });
    } else {
      expect(handoff.status).toBe(409);
      expect(issue).toMatchObject({ status: "in_progress", assigneeAgentId: seeded.agentId });
      expect(JSON.stringify(run?.resultJson ?? {})).not.toContain("local_process_terminated");
    }
    adapterExecutionControls.delete(seeded.runId);
  });
});
