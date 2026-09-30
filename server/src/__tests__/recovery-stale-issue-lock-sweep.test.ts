import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agents,
  agentTaskSessions,
  agentWakeupRequests,
  companies,
  createDb,
  environmentLeases,
  heartbeatRunEvents,
  heartbeatRuns,
  issueComments,
  issueRelations,
  issues,
  nativeRunFinalizations,
} from "@tickernelz/paperclip-pro-db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const mockTelemetryClient = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("../telemetry.ts", () => ({ getTelemetryClient: () => mockTelemetryClient }));

import { heartbeatService } from "../services/heartbeat.ts";
import { recoveryService } from "../services/recovery/service.ts";
import { instanceSettingsService } from "../services/instance-settings.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres stale-lock sweeper tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

describeEmbeddedPostgres("recovery sweepStaleIssueLocks", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-stale-lock-sweep-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    mockTelemetryClient.track.mockClear();
    await db.delete(nativeRunFinalizations);
    await db.delete(issueComments);
    await db.delete(issueRelations);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(agentTaskSessions);
    await db.delete(environmentLeases);
    await db.delete(heartbeatRunEvents);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seed() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const failedRunId = randomUUID();
    const runningRunId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Coder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(heartbeatRuns).values([
      {
        id: failedRunId,
        companyId,
        agentId,
        status: "failed",
        invocationSource: "manual",
        finishedAt: new Date(),
      },
      {
        id: runningRunId,
        companyId,
        agentId,
        status: "running",
        invocationSource: "manual",
        startedAt: new Date(),
      },
    ]);

    return { companyId, agentId, failedRunId, runningRunId };
  }

  it("clears lock columns when checkoutRunId points at a terminal heartbeat run", async () => {
    const { companyId, agentId, failedRunId } = await seed();
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Stale lock — terminal checkoutRunId",
      // Status off in_progress + checkoutRunId still set → exactly the recurrence shape.
      status: "todo",
      priority: "high",
      assigneeAgentId: agentId,
      checkoutRunId: failedRunId,
      executionRunId: null,
    });

    const heartbeat = heartbeatService(db);
    const result = await heartbeat.sweepStaleIssueLocks();

    expect(result.cleared).toBe(1);
    expect(result.issueIds).toEqual([issueId]);

    const row = await db
      .select({
        checkoutRunId: issues.checkoutRunId,
        executionRunId: issues.executionRunId,
        executionLockedAt: issues.executionLockedAt,
      })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0]);
    expect(row).toEqual({ checkoutRunId: null, executionRunId: null, executionLockedAt: null });

    const audit = await db
      .select({ action: activityLog.action, details: activityLog.details })
      .from(activityLog)
      .where(eq(activityLog.action, "issue.stale_lock_cleared"))
      .then((rows) => rows[0]);
    expect(audit?.action).toBe("issue.stale_lock_cleared");
    expect((audit?.details as { clearedCheckoutRunId?: string } | null)?.clearedCheckoutRunId).toBe(
      failedRunId,
    );
  });

  it("does not clear locks while the referenced run is still running", async () => {
    const { companyId, agentId, runningRunId } = await seed();
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Live lock — must be preserved",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: agentId,
      checkoutRunId: runningRunId,
      executionRunId: runningRunId,
      executionLockedAt: new Date(),
    });

    const heartbeat = heartbeatService(db);
    const result = await heartbeat.sweepStaleIssueLocks();

    expect(result.cleared).toBe(0);
    const row = await db
      .select({
        checkoutRunId: issues.checkoutRunId,
        executionRunId: issues.executionRunId,
      })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0]);
    expect(row).toEqual({ checkoutRunId: runningRunId, executionRunId: runningRunId });
  });

  it("does not terminalize a session-goal control run solely because its issue is done", async () => {
    const { companyId, agentId, runningRunId } = await seed();
    const issueId = randomUUID();
    await db
      .update(heartbeatRuns)
      .set({
        contextSnapshot: {
          issueId,
          resumeIntent: true,
          goalControlRequestId: randomUUID(),
          runnerGoalControl: { action: "clear" },
        },
      })
      .where(eq(heartbeatRuns.id, runningRunId));
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Completed goal awaiting clear",
      status: "done",
      priority: "high",
      assigneeAgentId: agentId,
      checkoutRunId: runningRunId,
      executionRunId: runningRunId,
      executionLockedAt: new Date(),
    });

    const result = await heartbeatService(db).sweepStaleIssueLocks();

    expect(result.terminalizedRunIds).toEqual([]);
    expect(result.cleared).toBe(0);
    await expect(
      db
        .select({ status: heartbeatRuns.status })
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, runningRunId))
        .then((rows) => rows[0]?.status),
    ).resolves.toBe("running");
  });

  it("does not clear when checkoutRunId is terminal but executionRunId is still running", async () => {
    const { companyId, agentId, failedRunId, runningRunId } = await seed();
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Mixed lock — preserve",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: agentId,
      checkoutRunId: failedRunId,
      executionRunId: runningRunId,
      executionLockedAt: new Date(),
    });

    const heartbeat = heartbeatService(db);
    const result = await heartbeat.sweepStaleIssueLocks();

    expect(result.cleared).toBe(0);
    const row = await db
      .select({
        checkoutRunId: issues.checkoutRunId,
        executionRunId: issues.executionRunId,
      })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0]);
    expect(row).toEqual({ checkoutRunId: failedRunId, executionRunId: runningRunId });
  });

  it("is idempotent — second pass finds nothing to clear", async () => {
    const { companyId, agentId, failedRunId } = await seed();
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Idempotency",
      status: "todo",
      priority: "high",
      assigneeAgentId: agentId,
      checkoutRunId: failedRunId,
      executionRunId: null,
    });

    const heartbeat = heartbeatService(db);
    const first = await heartbeat.sweepStaleIssueLocks();
    const second = await heartbeat.sweepStaleIssueLocks();
    expect(first.cleared).toBe(1);
    expect(second.cleared).toBe(0);
  });

  it("terminalizes an orphaned running run whose process is gone, then clears the lock", async () => {
    const { companyId, agentId, runningRunId } = await seed();
    // The run recorded a pid, but the process and its sandbox are gone. A pid
    // this large never maps to a live process, so isPidAlive returns false.
    // The issue is not terminal, so only the process-death authority applies.
    await db
      .update(heartbeatRuns)
      .set({ processPid: 2_000_000_000 })
      .where(eq(heartbeatRuns.id, runningRunId));
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Orphaned running run — terminalize then clear",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: agentId,
      checkoutRunId: runningRunId,
      executionRunId: runningRunId,
      executionLockedAt: new Date(),
    });

    const heartbeat = heartbeatService(db);
    const result = await heartbeat.sweepStaleIssueLocks();

    expect(result.terminalizedRunIds).toEqual([runningRunId]);
    expect(result.cleared).toBe(1);

    const run = await db
      .select({ status: heartbeatRuns.status, errorCode: heartbeatRuns.errorCode })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runningRunId))
      .then((rows) => rows[0]);
    // Process died, outcome unknown, so the backstop uses "interrupted".
    expect(run?.status).toBe("interrupted");
    expect(run?.errorCode).toBe("orphaned_running_run");

    const lock = await db
      .select({ checkoutRunId: issues.checkoutRunId, executionRunId: issues.executionRunId })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0]);
    expect(lock).toEqual({ checkoutRunId: null, executionRunId: null });

    const event = await db
      .select({ message: heartbeatRunEvents.message })
      .from(heartbeatRunEvents)
      .where(eq(heartbeatRunEvents.runId, runningRunId))
      .then((rows) => rows[0]);
    expect(event?.message).toContain("process and sandbox gone");

    // The recovery sweep's own terminal write must emit exactly one
    // agent.task_run event for the run it just terminalized. The write
    // never awaits the emission, so wait for it here instead of asserting
    // it fired synchronously.
    await vi.waitFor(() => {
      expect(mockTelemetryClient.track).toHaveBeenCalledTimes(1);
    });
    expect(mockTelemetryClient.track).toHaveBeenCalledWith(
      "agent.task_run",
      expect.objectContaining({ agent_id: agentId, state: "interrupted" }),
    );
  });

  it.each(["in_progress", "done"])("preserves a live legacy controller lease when the issue is %s", async (status) => {
    const { companyId, agentId, runningRunId } = await seed();
    await db.update(heartbeatRuns).set({
      runtimeMode: "legacy", processPid: 2_000_000_000,
      controllerBootId: randomUUID(),
      controllerLeaseExpiresAt: new Date(Date.now() + 60_000),
    }).where(eq(heartbeatRuns.id, runningRunId));
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId, companyId, title: "Remote controller still owns the run", status,
      assigneeAgentId: agentId, executionRunId: runningRunId, checkoutRunId: runningRunId,
    });
    const result = await recoveryService(db, { enqueueWakeup: vi.fn() }).sweepStaleIssueLocks();
    expect(result).toEqual({ cleared: 0, issueIds: [], terminalizedRunIds: [] });
    expect(await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runningRunId))).toEqual([{ status: "running" }]);
    expect(await db.select({ executionRunId: issues.executionRunId }).from(issues)
      .where(eq(issues.id, issueId))).toEqual([{ executionRunId: runningRunId }]);
  });

  it.each(["renew", "replace", "claim"])("fences a legacy controller %s between the orphan check and terminal write", async (change) => {
    const { companyId, agentId, runningRunId } = await seed();
    const bootId = randomUUID();
    await db.update(heartbeatRuns).set({
      runtimeMode: "legacy", processPid: 2_000_000_000,
      controllerBootId: change === "claim" ? null : bootId,
      controllerLeaseExpiresAt: new Date(Date.now() - 60_000),
    }).where(eq(heartbeatRuns.id, runningRunId));
    await db.insert(issues).values({
      id: randomUUID(), companyId, title: "Controller changed during sweep", status: "in_progress",
      assigneeAgentId: agentId, executionRunId: runningRunId, checkoutRunId: runningRunId,
    });
    const result = await recoveryService(db, {
      enqueueWakeup: vi.fn(),
      beforeOrphanedRunTerminalWrite: async () => {
        await db.update(heartbeatRuns).set({
          controllerBootId: change === "renew" ? bootId : randomUUID(),
          // A replacement invalidates the old snapshot even if its lease expires.
          controllerLeaseExpiresAt: new Date(Date.now() + (change === "replace" ? -30_000 : 60_000)),
        }).where(eq(heartbeatRuns.id, runningRunId));
      },
    }).sweepStaleIssueLocks();
    expect(result).toEqual({ cleared: 0, issueIds: [], terminalizedRunIds: [] });
    expect(await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runningRunId))).toEqual([{ status: "running" }]);
    expect(mockTelemetryClient.track).not.toHaveBeenCalled();
  });

  it("preserves a process-less native run while same-run resumption owns its retry", async () => {
    const { companyId, agentId, runningRunId } = await seed();
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Native same-run retry remains live",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: agentId,
      checkoutRunId: runningRunId,
      executionRunId: runningRunId,
      executionLockedAt: new Date(),
    });
    await db
      .update(heartbeatRuns)
      .set({
        runtimeMode: "native",
        nativeIssueId: issueId,
        nativePhase: "retryable_failure",
        processPid: 2_000_000_000,
      })
      .where(eq(heartbeatRuns.id, runningRunId));
    await db.insert(nativeRunFinalizations).values({
      runId: runningRunId,
      companyId,
      issueId,
      phase: "retryable_failure",
      attempt: 1,
      nextAttemptAt: new Date(Date.now() + 30_000),
    });

    const result = await heartbeatService(db).sweepStaleIssueLocks();

    expect(result).toEqual({ cleared: 0, issueIds: [], terminalizedRunIds: [] });
    await expect(db.select({ status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runningRunId)))
      .resolves.toEqual([{ status: "running" }]);
    await expect(db.select({
      checkoutRunId: issues.checkoutRunId,
      executionRunId: issues.executionRunId,
    }).from(issues).where(eq(issues.id, issueId)))
      .resolves.toEqual([{ checkoutRunId: runningRunId, executionRunId: runningRunId }]);
  });

  it("preserves a process-less run while its in-process execution is still finalizing", async () => {
    const { companyId, agentId, runningRunId } = await seed();
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Native finalization remains live",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: agentId,
      checkoutRunId: runningRunId,
      executionRunId: runningRunId,
      executionLockedAt: new Date(),
    });
    await db
      .update(heartbeatRuns)
      .set({
        runtimeMode: "native",
        processPid: 2_000_000_000,
      })
      .where(eq(heartbeatRuns.id, runningRunId));

    const result = await recoveryService(db, {
      enqueueWakeup: vi.fn(),
      liveRunExecutions: new Set([runningRunId]),
    }).sweepStaleIssueLocks();

    expect(result).toEqual({
      cleared: 0,
      issueIds: [],
      terminalizedRunIds: [],
    });
    await expect(db.select({ status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runningRunId)))
      .resolves.toEqual([{ status: "running" }]);
    await expect(db.select({
      checkoutRunId: issues.checkoutRunId,
      executionRunId: issues.executionRunId,
    }).from(issues).where(eq(issues.id, issueId)))
      .resolves.toEqual([{ checkoutRunId: runningRunId, executionRunId: runningRunId }]);
  });

  it("terminalizes a running run whose issue is terminal, even while the process stays alive (reuse-lease path)", async () => {
    // Reuse Lease ON stops the sandbox but keeps the server process alive, so
    // the in-memory handle and the recorded pid can both persist. The
    // process-death authority misses this case. The issue-terminal authority
    // catches it: the issue reached "done" while the run row stayed "running".
    const { companyId, agentId, runningRunId } = await seed();
    // process.pid is the live test process, so isPidAlive returns true.
    await db
      .update(heartbeatRuns)
      .set({ processPid: process.pid })
      .where(eq(heartbeatRuns.id, runningRunId));
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Reused sandbox stopped — issue done, run still running",
      status: "done",
      priority: "high",
      assigneeAgentId: agentId,
      checkoutRunId: runningRunId,
      executionRunId: runningRunId,
      executionLockedAt: new Date(),
    });

    const heartbeat = heartbeatService(db);
    const result = await heartbeat.sweepStaleIssueLocks();

    expect(result.terminalizedRunIds).toEqual([runningRunId]);
    expect(result.cleared).toBe(1);

    const run = await db
      .select({ status: heartbeatRuns.status, errorCode: heartbeatRuns.errorCode })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runningRunId))
      .then((rows) => rows[0]);
    // The issue is "done", so the terminal run status is "succeeded". A
    // succeeded run carries no error code.
    expect(run?.status).toBe("succeeded");
    expect(run?.errorCode).toBeNull();

    const lock = await db
      .select({ checkoutRunId: issues.checkoutRunId, executionRunId: issues.executionRunId })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0]);
    expect(lock).toEqual({ checkoutRunId: null, executionRunId: null });

    const event = await db
      .select({ message: heartbeatRunEvents.message })
      .from(heartbeatRunEvents)
      .where(eq(heartbeatRunEvents.runId, runningRunId))
      .then((rows) => rows[0]);
    expect(event?.message).toContain("issue reached a terminal status");

    // The terminal write never awaits the telemetry emission, so wait for
    // it here instead of asserting it fired synchronously.
    await vi.waitFor(() => {
      expect(mockTelemetryClient.track).toHaveBeenCalledTimes(1);
    });
    expect(mockTelemetryClient.track).toHaveBeenCalledWith(
      "agent.task_run",
      expect.objectContaining({ agent_id: agentId, state: "succeeded" }),
    );
  });

  it("terminalizes a running run to cancelled when its issue is cancelled (reuse-lease path)", async () => {
    const { companyId, agentId, runningRunId } = await seed();
    await db
      .update(heartbeatRuns)
      .set({ processPid: process.pid })
      .where(eq(heartbeatRuns.id, runningRunId));
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Reused sandbox stopped — issue cancelled, run still running",
      status: "cancelled",
      priority: "high",
      assigneeAgentId: agentId,
      checkoutRunId: runningRunId,
      executionRunId: runningRunId,
      executionLockedAt: new Date(),
    });

    const heartbeat = heartbeatService(db);
    const result = await heartbeat.sweepStaleIssueLocks();

    expect(result.terminalizedRunIds).toEqual([runningRunId]);

    const runStatus = await db
      .select({ status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runningRunId))
      .then((rows) => rows[0]?.status);
    expect(runStatus).toBe("cancelled");

    // The terminal write never awaits the telemetry emission, so wait for
    // it here instead of asserting it fired synchronously.
    await vi.waitFor(() => {
      expect(mockTelemetryClient.track).toHaveBeenCalledTimes(1);
    });
    expect(mockTelemetryClient.track).toHaveBeenCalledWith(
      "agent.task_run",
      expect.objectContaining({ agent_id: agentId, state: "cancelled" }),
    );
  });

  it("does not terminalize a running run whose process is alive and whose issue is not terminal", async () => {
    const { companyId, agentId, runningRunId } = await seed();
    // process.pid is the live test process, so isPidAlive returns true.
    await db
      .update(heartbeatRuns)
      .set({ processPid: process.pid })
      .where(eq(heartbeatRuns.id, runningRunId));
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Live run — preserve",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: agentId,
      checkoutRunId: runningRunId,
      executionRunId: runningRunId,
      executionLockedAt: new Date(),
    });

    const heartbeat = heartbeatService(db);
    const result = await heartbeat.sweepStaleIssueLocks();

    expect(result.terminalizedRunIds).toEqual([]);
    expect(result.cleared).toBe(0);

    const runStatus = await db
      .select({ status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runningRunId))
      .then((rows) => rows[0]?.status);
    expect(runStatus).toBe("running");

    // No terminal write happened, so no telemetry event fires.
    expect(mockTelemetryClient.track).not.toHaveBeenCalled();
  });

  it("does not terminalize or clear issue locks when an ownership hold arrives after the sweep snapshot", async () => {
    const { companyId, agentId, runningRunId } = await seed();
    const issueId = randomUUID();
    await db
      .update(heartbeatRuns)
      .set({
        runtimeMode: "native",
        nativeIssueId: issueId,
        processPid: process.pid,
      })
      .where(eq(heartbeatRuns.id, runningRunId));
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Ownership hold races stale issue-lock recovery",
      status: "done",
      priority: "high",
      assigneeAgentId: agentId,
      checkoutRunId: runningRunId,
      executionRunId: runningRunId,
      executionLockedAt: new Date(),
    });

    let releaseTerminalWrite!: () => void;
    const terminalWriteReleased = new Promise<void>((resolve) => {
      releaseTerminalWrite = resolve;
    });
    let terminalWriteReached!: () => void;
    const atTerminalWrite = new Promise<void>((resolve) => {
      terminalWriteReached = resolve;
    });
    const sweep = recoveryService(db, {
      enqueueWakeup: vi.fn(),
      beforeOrphanedRunTerminalWrite: async (runId) => {
        if (runId !== runningRunId) return;
        terminalWriteReached();
        await terminalWriteReleased;
      },
    }).sweepStaleIssueLocks();

    try {
      await atTerminalWrite;
      await db
        .update(heartbeatRuns)
        .set({
          nativePhase: "terminal_failure",
          errorCode: "native_execution_ownership_unverified",
        })
        .where(eq(heartbeatRuns.id, runningRunId));
    } finally {
      releaseTerminalWrite();
    }

    await expect(sweep).resolves.toEqual({
      cleared: 0,
      issueIds: [],
      terminalizedRunIds: [],
    });
    await expect(
      db
        .select({
          status: heartbeatRuns.status,
          nativePhase: heartbeatRuns.nativePhase,
          errorCode: heartbeatRuns.errorCode,
        })
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, runningRunId)),
    ).resolves.toEqual([
      {
        status: "running",
        nativePhase: "terminal_failure",
        errorCode: "native_execution_ownership_unverified",
      },
    ]);
    await expect(
      db
        .select({
          checkoutRunId: issues.checkoutRunId,
          executionRunId: issues.executionRunId,
        })
        .from(issues)
        .where(eq(issues.id, issueId)),
    ).resolves.toEqual([
      {
        checkoutRunId: runningRunId,
        executionRunId: runningRunId,
      },
    ]);
    expect(mockTelemetryClient.track).not.toHaveBeenCalled();
  });

  it("does not terminalize a live run that a terminal issue and an active issue both reference", async () => {
    // A stale lock on a terminal issue and the real lock on an active issue can
    // point at the same running run. The terminal reference alone must not
    // terminalize the run, because the run is still live for the active issue.
    const { companyId, agentId, runningRunId } = await seed();
    // process.pid is the live test process, so isPidAlive returns true.
    await db
      .update(heartbeatRuns)
      .set({ processPid: process.pid })
      .where(eq(heartbeatRuns.id, runningRunId));

    const terminalIssueId = randomUUID();
    const activeIssueId = randomUUID();
    await db.insert(issues).values([
      {
        id: terminalIssueId,
        companyId,
        title: "Terminal issue holds a stale lock on the shared run",
        status: "done",
        priority: "high",
        assigneeAgentId: agentId,
        checkoutRunId: runningRunId,
        executionRunId: null,
      },
      {
        id: activeIssueId,
        companyId,
        title: "Active issue owns the live shared run",
        status: "in_progress",
        priority: "high",
        assigneeAgentId: agentId,
        checkoutRunId: runningRunId,
        executionRunId: runningRunId,
        executionLockedAt: new Date(),
      },
    ]);

    const heartbeat = heartbeatService(db);
    const result = await heartbeat.sweepStaleIssueLocks();

    // The run stays live, so the sweep terminalizes nothing and clears nothing.
    expect(result.terminalizedRunIds).toEqual([]);
    expect(result.cleared).toBe(0);

    const runStatus = await db
      .select({ status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runningRunId))
      .then((rows) => rows[0]?.status);
    expect(runStatus).toBe("running");

    const activeLock = await db
      .select({ checkoutRunId: issues.checkoutRunId, executionRunId: issues.executionRunId })
      .from(issues)
      .where(eq(issues.id, activeIssueId))
      .then((rows) => rows[0]);
    expect(activeLock).toEqual({ checkoutRunId: runningRunId, executionRunId: runningRunId });
  });

  it("does not terminalize a shared live run when its context snapshot names the terminal issue", async () => {
    // The run context snapshot names the terminal issue. The context-snapshot
    // fallback in terminalizeOrphanedRunningRun could read that terminal status
    // and terminalize the run. An active issue still owns the run, so the sweep
    // must suppress the fallback and keep the run live.
    const { companyId, agentId, runningRunId } = await seed();
    // process.pid is the live test process, so isPidAlive returns true.
    await db
      .update(heartbeatRuns)
      .set({ processPid: process.pid })
      .where(eq(heartbeatRuns.id, runningRunId));

    const terminalIssueId = randomUUID();
    const activeIssueId = randomUUID();
    // The run context snapshot names the terminal issue. This is the path the
    // shared-run guard must still block.
    await db
      .update(heartbeatRuns)
      .set({ contextSnapshot: { issueId: terminalIssueId } })
      .where(eq(heartbeatRuns.id, runningRunId));
    await db.insert(issues).values([
      {
        id: terminalIssueId,
        companyId,
        title: "Terminal issue named in the run context snapshot",
        status: "done",
        priority: "high",
        assigneeAgentId: agentId,
        checkoutRunId: runningRunId,
        executionRunId: null,
      },
      {
        id: activeIssueId,
        companyId,
        title: "Active issue owns the live shared run",
        status: "in_progress",
        priority: "high",
        assigneeAgentId: agentId,
        checkoutRunId: runningRunId,
        executionRunId: runningRunId,
        executionLockedAt: new Date(),
      },
    ]);

    const heartbeat = heartbeatService(db);
    const result = await heartbeat.sweepStaleIssueLocks();

    // The run stays live, so the sweep terminalizes nothing and clears nothing.
    expect(result.terminalizedRunIds).toEqual([]);
    expect(result.cleared).toBe(0);

    const runStatus = await db
      .select({ status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runningRunId))
      .then((rows) => rows[0]?.status);
    expect(runStatus).toBe("running");

    const activeLock = await db
      .select({ checkoutRunId: issues.checkoutRunId, executionRunId: issues.executionRunId })
      .from(issues)
      .where(eq(issues.id, activeIssueId))
      .then((rows) => rows[0]);
    expect(activeLock).toEqual({ checkoutRunId: runningRunId, executionRunId: runningRunId });
  });

  it("still clears the lock when the audit write fails after terminalization", async () => {
    const { companyId, agentId, runningRunId } = await seed();
    // The run recorded a pid that never maps to a live process, so the sweep
    // decides to terminalize it. The issue is not terminal, so the
    // process-death authority drives the terminalization here.
    await db
      .update(heartbeatRuns)
      .set({ processPid: 2_000_000_000 })
      .where(eq(heartbeatRuns.id, runningRunId));
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Audit write fails — still clear the lock",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: agentId,
      checkoutRunId: runningRunId,
      executionRunId: runningRunId,
      executionLockedAt: new Date(),
    });

    // Make only the audit-event insert fail. The run update commits the
    // terminal status first, so the audit write is best-effort. The sweep must
    // catch the failure and still clear the lock.
    const transactionSpy = vi
      .spyOn(db, "transaction")
      .mockRejectedValueOnce(new Error("simulated audit write failure"));

    try {
      const heartbeat = heartbeatService(db);
      const result = await heartbeat.sweepStaleIssueLocks();

      expect(result.terminalizedRunIds).toEqual([runningRunId]);
      expect(result.cleared).toBe(1);
    } finally {
      transactionSpy.mockRestore();
    }

    // The run reached its terminal status even though the audit write failed.
    const runStatus = await db
      .select({ status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runningRunId))
      .then((rows) => rows[0]?.status);
    expect(runStatus).toBe("interrupted");

    // The sweep cleared the lock in the same pass.
    const lock = await db
      .select({ checkoutRunId: issues.checkoutRunId, executionRunId: issues.executionRunId })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0]);
    expect(lock).toEqual({ checkoutRunId: null, executionRunId: null });

    // The audit write failed, so no run event exists for this run.
    const events = await db
      .select({ id: heartbeatRunEvents.id })
      .from(heartbeatRunEvents)
      .where(eq(heartbeatRunEvents.runId, runningRunId));
    expect(events).toEqual([]);
  });

  describe("process-gone continuation", () => {
    async function seedOrphanedOmpRun(input: {
      issueStatus?: string;
      assignee?: "run_agent" | "other_agent";
      resultJson?: Record<string, unknown>;
      runtimeMode?: "legacy" | "native";
      scheduledRetryAttempt?: number;
      conversation?: boolean;
      taskSession?: boolean;
    } = {}) {
      const { companyId, agentId, runningRunId } = await seed();
      await db.update(agents).set({ adapterType: "omp_local" }).where(eq(agents.id, agentId));
      const otherAgentId = randomUUID();
      await db.insert(agents).values({
        id: otherAgentId, companyId, name: "Reviewer", role: "engineer", status: "active",
        adapterType: "omp_local", adapterConfig: {}, runtimeConfig: {}, permissions: {},
      });
      const issueId = randomUUID();
      const firstCommentId = randomUUID();
      const deferredCommentId = randomUUID();
      await db.insert(issues).values({
        id: issueId, companyId, title: "Process gone mid-turn",
        status: input.issueStatus ?? "in_progress", priority: "high",
        assigneeAgentId: input.assignee === "other_agent" ? otherAgentId : agentId,
        checkoutRunId: runningRunId, executionRunId: runningRunId, executionLockedAt: new Date(),
        ...(input.conversation
          ? { conversationAgentId: agentId, conversationUserId: "board", conversationState: "active" }
          : {}),
      });
      await db.update(heartbeatRuns).set({
        runtimeMode: input.runtimeMode ?? "legacy",
        processPid: 2_000_000_000,
        resultJson: input.resultJson ?? null,
        scheduledRetryAttempt: input.scheduledRetryAttempt ?? 0,
        scheduledRetryReason: input.scheduledRetryAttempt ? "transient_failure" : null,
        responsibleUserId: "board",
        sessionIdBefore: "omp-session-1",
        sessionIdAfter: null,
        runnerProfileJson: { adapterDispatch: { adapterType: "omp_local" } },
        contextSnapshot: {
          issueId, taskId: issueId, taskKey: issueId, wakeReason: "issue_commented",
          wakeCommentIds: [firstCommentId], wakeCommentId: firstCommentId, commentId: firstCommentId,
        },
      }).where(eq(heartbeatRuns.id, runningRunId));
      if (input.taskSession !== false) {
        await db.insert(agentTaskSessions).values({
          companyId, agentId, adapterType: "omp_local", taskKey: issueId,
          sessionParamsJson: { sessionId: "omp-session-1", cwd: "/tmp" }, sessionDisplayId: "omp-session-1",
          lastRunId: null,
        });
      }
      const deferredWakeId = randomUUID();
      await db.insert(agentWakeupRequests).values({
        id: deferredWakeId, companyId, agentId, source: "automation", triggerDetail: "system",
        reason: "issue_execution_deferred", status: "deferred_issue_execution",
        requestedByActorType: "user", requestedByActorId: "board",
        payload: {
          issueId, commentId: deferredCommentId, mutation: "comment",
          _paperclipWakeContext: {
            issueId, wakeReason: "issue_commented", wakeCommentId: deferredCommentId,
            wakeCommentIds: [deferredCommentId],
          },
        },
      });
      return { companyId, agentId, runningRunId, issueId, firstCommentId, deferredCommentId, deferredWakeId };
    }

    async function successorsOf(runId: string) {
      return db.select().from(heartbeatRuns).where(eq(heartbeatRuns.retryOfRunId, runId));
    }

    async function makeDue(runId: string) {
      await db.update(heartbeatRuns).set({ scheduledRetryAt: new Date(Date.now() - 1_000) })
        .where(eq(heartbeatRuns.id, runId));
    }

    it("queues one same-session continuation and delivers deferred comments when it is promoted", async () => {
      const f = await seedOrphanedOmpRun();

      const heartbeat = heartbeatService(db);
      const result = await heartbeat.sweepStaleIssueLocks();
      expect(result.terminalizedRunIds).toEqual([f.runningRunId]);
      await heartbeat.sweepStaleIssueLocks();

      const [source] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.runningRunId));
      expect(source).toMatchObject({ status: "interrupted", errorCode: "orphaned_running_run" });
      const successors = await successorsOf(f.runningRunId);
      expect(successors).toHaveLength(1);
      const [successor] = successors;
      expect(successor).toMatchObject({
        agentId: f.agentId,
        status: "scheduled_retry",
        scheduledRetryReason: "transient_failure",
        scheduledRetryAttempt: 1,
        sessionIdBefore: "omp-session-1",
      });
      expect(successor.contextSnapshot).toMatchObject({
        issueId: f.issueId,
        taskKey: f.issueId,
        retryOfRunId: f.runningRunId,
        wakeReason: "process_lost_retry",
        originalWakeReason: "issue_commented",
        resumeFromRunId: f.runningRunId,
        resumeSessionDisplayId: "omp-session-1",
        resumeSessionParams: { sessionId: "omp-session-1", cwd: "/tmp" },
        wakeCommentIds: [f.firstCommentId],
      });
      const [pendingWake] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, f.deferredWakeId));
      expect(pendingWake).toMatchObject({ status: "deferred_issue_execution", runId: null });
      const [issue] = await db.select().from(issues).where(eq(issues.id, f.issueId));
      expect(issue).toMatchObject({ executionRunId: successor.id, checkoutRunId: null });

      await makeDue(successor.id);
      expect(await heartbeat.promoteDueScheduledRetries()).toMatchObject({ promoted: 1 });

      const [promoted] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, successor.id));
      expect(promoted.status).toBe("queued");
      expect(promoted.contextSnapshot).toMatchObject({
        wakeCommentIds: [f.firstCommentId, f.deferredCommentId],
        wakeCommentId: f.deferredCommentId,
      });
      const [adoptedWake] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, f.deferredWakeId));
      expect(adoptedWake).toMatchObject({ status: "coalesced", runId: successor.id });
    });

    it("keeps deferred comments deliverable when the continuation is cancelled before it starts", async () => {
      const f = await seedOrphanedOmpRun();
      const heartbeat = heartbeatService(db);
      await heartbeat.sweepStaleIssueLocks();
      const [successor] = await successorsOf(f.runningRunId);
      const blockerId = randomUUID();
      await db.insert(issues).values({
        id: blockerId, companyId: f.companyId, title: "Blocker", status: "todo", priority: "high",
      });
      await db.insert(issueRelations).values({
        companyId: f.companyId, issueId: blockerId, relatedIssueId: f.issueId, type: "blocks",
      });

      await makeDue(successor.id);
      await heartbeat.promoteDueScheduledRetries();

      const [cancelled] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, successor.id));
      expect(cancelled).toMatchObject({ status: "cancelled", errorCode: "issue_dependencies_blocked" });
      const [wake] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, f.deferredWakeId));
      expect(wake).toMatchObject({ status: "deferred_issue_execution", runId: null });
      const [issue] = await db.select().from(issues).where(eq(issues.id, f.issueId));
      expect(issue.executionRunId).toBeNull();
    });

    it("resumes the interrupted run's session when it never recorded session_id_after and no task session remains", async () => {
      const f = await seedOrphanedOmpRun({ taskSession: false });

      await heartbeatService(db).sweepStaleIssueLocks();

      const [successor] = await successorsOf(f.runningRunId);
      expect(successor.sessionIdBefore).toBe("omp-session-1");
      expect(successor.contextSnapshot).toMatchObject({
        resumeFromRunId: f.runningRunId,
        resumeSessionDisplayId: "omp-session-1",
        resumeSessionParams: { sessionId: "omp-session-1" },
      });
    });

    it("leaves a conversation issue to its own recovery through the sweep and the stranded reconciler", async () => {
      await instanceSettingsService(db).updateExperimental({ enableAgentChat: true });
      try {
        const f = await seedOrphanedOmpRun({ conversation: true });
        const heartbeat = heartbeatService(db);
        await heartbeat.sweepStaleIssueLocks();
        const [source] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.runningRunId));
        expect(source.resultJson?.conversationContinuation).toBeUndefined();

        await heartbeat.reconcileStrandedAssignedIssues();

        expect(await successorsOf(f.runningRunId)).toEqual([]);
      } finally {
        await instanceSettingsService(db).updateExperimental({ enableAgentChat: false });
      }
    });

    it.each([
      ["done issue", { issueStatus: "done" }],
      ["cancelled issue", { issueStatus: "cancelled" }],
      ["reassigned issue", { assignee: "other_agent" as const }],
      ["operator-cancelled run", { resultJson: { executionCancellation: { state: "requested" } } }],
      ["native run", { runtimeMode: "native" as const }],
      ["conversation issue", { conversation: true }],
    ])("queues no continuation for a %s", async (_label, input) => {
      const f = await seedOrphanedOmpRun(input);

      await heartbeatService(db).sweepStaleIssueLocks();

      expect(await successorsOf(f.runningRunId)).toEqual([]);
      const [wake] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, f.deferredWakeId));
      expect(wake?.runId ?? null).toBeNull();
    });

    it("stops after the shared bounded retry budget is spent", async () => {
      const f = await seedOrphanedOmpRun({ scheduledRetryAttempt: 2 });

      const heartbeat = heartbeatService(db);
      const result = await heartbeat.sweepStaleIssueLocks();

      expect(result.terminalizedRunIds).toEqual([f.runningRunId]);
      expect(await successorsOf(f.runningRunId)).toEqual([]);
    });

    it("caps a crash-looping chain at two consecutive continuations", async () => {
      const f = await seedOrphanedOmpRun();
      const heartbeat = heartbeatService(db);
      const chain = [f.runningRunId];
      for (let crash = 0; crash < 3; crash += 1) {
        await heartbeat.sweepStaleIssueLocks();
        const [next] = await successorsOf(chain.at(-1)!);
        if (!next) break;
        chain.push(next.id);
        await db.update(heartbeatRuns).set({
          status: "running", startedAt: new Date(), processPid: 2_000_000_000,
          runnerProfileJson: { adapterDispatch: { adapterType: "omp_local" } },
        }).where(eq(heartbeatRuns.id, next.id));
        await db.update(issues).set({ checkoutRunId: next.id }).where(eq(issues.id, f.issueId));
      }

      expect(chain).toHaveLength(3);
      const runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.companyId));
      expect(runs.filter((run) => run.status === "interrupted").map((run) => run.id).sort()).toEqual([...chain].sort());
      expect(runs.filter((run) => ["queued", "scheduled_retry", "running"].includes(run.status))).toEqual([]);
    });
  });
});
