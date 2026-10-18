import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  environmentLeases,
  heartbeatRunEvents,
  heartbeatRuns,
  issues,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import { agentExecutionsHaveStopped } from "./agent-execution-stop.js";
import { canRetryStoppedRun } from "./cancelled-native-startup.js";
import { legacyControllerBootId } from "./legacy-controller-lease.js";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("agent execution stop proof", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let companyId: string;
  let liveProcess: ChildProcess;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-agent-execution-stop-");
    db = createDb(database.connectionString);
    companyId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Stop proof", issuePrefix: `S${companyId.slice(0, 7)}` });
    liveProcess = spawn(process.execPath, ["-e", "setTimeout(() => {}, 120000)"], { detached: true, stdio: "ignore" });
    await new Promise<void>((resolve, reject) => {
      liveProcess.once("spawn", () => resolve());
      liveProcess.once("error", reject);
    });
  }, 90_000);

  afterAll(async () => {
    if (liveProcess?.pid) {
      try { process.kill(-liveProcess.pid, "SIGKILL"); } catch {}
      try { process.kill(liveProcess.pid, "SIGKILL"); } catch {}
    }
    await database?.cleanup();
  });

  async function agent() {
    const [row] = await db.insert(agents).values({ companyId, name: `Agent ${randomUUID().slice(0, 8)}`, status: "running" }).returning();
    return row!.id;
  }

  async function cancelledRun(agentId: string, overrides: Partial<typeof heartbeatRuns.$inferInsert> = {}) {
    const [row] = await db.insert(heartbeatRuns).values({
      companyId,
      agentId,
      status: "cancelled",
      invocationSource: "on_demand",
      runtimeMode: "legacy",
      executionStage: "preparing",
      startedAt: new Date(Date.now() - 120_000),
      finishedAt: new Date(Date.now() - 119_000),
      controllerBootId: randomUUID(),
      controllerLeaseExpiresAt: new Date(Date.now() - 60_000),
      runnerProfileJson: { adapterDispatch: { adapterType: "omp_local" } },
      resultJson: { stopReason: "cancelled", startupCancellation: { requestedAt: new Date().toISOString(), beforeNativeSelection: false } },
      ...overrides,
    }).returning();
    return row!;
  }

  const stopped = (agentId: string) => agentExecutionsHaveStopped(db, [agentId]);

  it("counts a cancelled legacy run that never reached dispatch for any adapter type", async () => {
    for (const adapterType of ["omp_local", "hermes_gateway", "process", null]) {
      const owner = await agent();
      await cancelledRun(owner, { runnerProfileJson: adapterType ? { adapterDispatch: { adapterType } } : null });
      expect(await stopped(owner)).toBe(true);
    }
  });

  it("counts the stale continuation cancellation that recorded no acknowledgement", async () => {
    const owner = await agent();
    await cancelledRun(owner, {
      errorCode: "continuation_task_ownership_changed",
      resultJson: {
        stopReason: "cancelled",
        timeoutFired: false,
        timeoutSource: "default",
        cancellation: { reason: "continuation_task_ownership_changed", source: "control_plane", expected: true },
        startupCancellation: { requestedAt: new Date().toISOString(), beforeNativeSelection: false },
      },
    });
    expect(await stopped(owner)).toBe(true);
  });

  it("keeps a cancelled run with a live process or process group stop-blocked", async () => {
    const withPid = await agent();
    await cancelledRun(withPid, { processPid: liveProcess.pid });
    expect(await stopped(withPid)).toBe(false);
    const withGroup = await agent();
    await cancelledRun(withGroup, { processGroupId: liveProcess.pid });
    expect(await stopped(withGroup)).toBe(false);
    const reusedPid = await agent();
    await cancelledRun(reusedPid, { processPid: liveProcess.pid, processStartedAt: new Date(Date.now() - 600_000) });
    expect(await stopped(reusedPid)).toBe(true);
  });

  it("keeps a cancelled run with process start evidence stop-blocked", async () => {
    for (const eventType of ["native.process_start_requested", "native.process_identity_recorded", "adapter.invoke"]) {
      const owner = await agent();
      const run = await cancelledRun(owner);
      await db.insert(heartbeatRunEvents).values({
        companyId, runId: run.id, agentId: owner, seq: 1, eventType, stream: "system", level: "info",
        message: "recorded", payload: { adapterType: "omp_local" },
      });
      expect(await stopped(owner)).toBe(false);
    }
  });

  it("requires the pre-dispatch stage marker of the claiming controller", async () => {
    const dispatching = await agent();
    await cancelledRun(dispatching, { executionStage: "dispatching" });
    expect(await stopped(dispatching)).toBe(false);
    const resolved = await agent();
    await cancelledRun(resolved, { runtimeModeResolvedAt: new Date(Date.now() - 118_000) });
    expect(await stopped(resolved)).toBe(false);
    const unclaimed = await agent();
    await cancelledRun(unclaimed, { controllerBootId: null });
    expect(await stopped(unclaimed)).toBe(false);
  });

  it("counts a pre-dispatch repair suppression that never invoked an adapter", async () => {
    const suppressed = await agent();
    await cancelledRun(suppressed, {
      executionStage: "dispatching", errorCode: "legacy_disposition_repair_suppressed",
      runtimeModeResolvedAt: new Date(Date.now() - 118_000),
      resultJson: { cancellation: { reason: "Execution stopped without a recorded cancellation request: Disposition repair suppressed: recorded_disposition" } },
    });
    expect(await stopped(suppressed)).toBe(true);
    const invoked = await agent();
    const invokedRun = await cancelledRun(invoked, {
      executionStage: "dispatching", errorCode: "legacy_disposition_repair_suppressed",
      runtimeModeResolvedAt: new Date(Date.now() - 118_000),
      resultJson: { cancellation: { reason: "Execution stopped without a recorded cancellation request" } },
    });
    await db.insert(heartbeatRunEvents).values({
      companyId, runId: invokedRun.id, agentId: invoked, seq: 1, eventType: "adapter.invoke",
      stream: "system", level: "info", message: "recorded", payload: { adapterType: "omp_local" },
    });
    expect(await stopped(invoked)).toBe(false);
    const unrelated = await agent();
    await cancelledRun(unrelated, { executionStage: "dispatching", runtimeModeResolvedAt: new Date(Date.now() - 118_000) });
    expect(await stopped(unrelated)).toBe(false);
  });

  it("requires the claiming controller lease to expire", async () => {
    const owner = await agent();
    await cancelledRun(owner, { controllerLeaseExpiresAt: new Date(Date.now() + 60_000) });
    expect(await stopped(owner)).toBe(false);
    const sameBoot = await agent();
    await cancelledRun(sameBoot, { controllerBootId: legacyControllerBootId });
    expect(await stopped(sameBoot)).toBe(false);
  });

  it("keeps an unreleased environment lease stop-blocked until cleanup", async () => {
    const owner = await agent();
    const run = await cancelledRun(owner);
    const [lease] = await db.insert(environmentLeases).values({
      companyId, heartbeatRunId: run.id, status: "active", provider: "local",
    }).returning();
    expect(await stopped(owner)).toBe(false);
    await db.update(environmentLeases).set({ status: "released", releasedAt: new Date() }).where(eq(environmentLeases.id, lease.id));
    expect(await stopped(owner)).toBe(true);
  });

  it("counts a queued legacy run cancelled before any controller claimed it", async () => {
    for (const errorCode of ["issue_dependencies_blocked", "issue_terminal_status"]) {
      const owner = await agent();
      await cancelledRun(owner, {
        errorCode, startedAt: null, controllerBootId: null, controllerLeaseExpiresAt: null, executionStage: null,
        runnerProfileJson: { adapterDispatch: { adapterType: "omp_local" } },
        resultJson: { stopReason: errorCode, effectiveTimeoutSec: 0, timeoutConfigured: false, timeoutFired: false },
      });
      expect(await stopped(owner)).toBe(true);
    }
    const admittedWhileQueued = await agent();
    await cancelledRun(admittedWhileQueued, {
      errorCode: "issue_dependencies_blocked", startedAt: null, executionStage: "preparing",
      resultJson: { stopReason: "issue_dependencies_blocked" },
    });
    expect(await stopped(admittedWhileQueued)).toBe(true);
    const started = await agent();
    await cancelledRun(started, {
      errorCode: "issue_dependencies_blocked", controllerBootId: null, controllerLeaseExpiresAt: null, executionStage: null,
      resultJson: { stopReason: "issue_dependencies_blocked" },
    });
    expect(await stopped(started)).toBe(false);
    const withNativeIssue = await agent();
    const [issue] = await db.insert(issues).values({ companyId, title: "Queued with native binding" }).returning();
    await cancelledRun(withNativeIssue, {
      errorCode: "issue_dependencies_blocked", controllerBootId: null, controllerLeaseExpiresAt: null,
      executionStage: null, nativeIssueId: issue!.id, runnerProfileJson: { adapterDispatch: { adapterType: "omp_local" } },
      resultJson: { stopReason: "issue_dependencies_blocked" },
    });
    expect(await stopped(withNativeIssue)).toBe(false);
  });

  it("still recognizes a pre-dispatch review wait", async () => {
    const waiting = await agent();
    await cancelledRun(waiting, {
      errorCode: "issue_continuation_waiting_on_review",
      startedAt: null, controllerBootId: null, controllerLeaseExpiresAt: null, executionStage: null,
      resultJson: { stopReason: "issue_continuation_waiting_on_review", timeoutSource: "stale_queued_run_gate" },
    });
    expect(await stopped(waiting)).toBe(true);
  });

  it("refuses a settled plan-less webhook run that left no dispatch trace", async () => {
    const webhook = await agent();
    const noReceipt = await cancelledRun(webhook, {
      executionStage: "settled", controllerLeaseExpiresAt: null, errorCode: "cancelled_by_operator",
      runnerProfileJson: { adapterDispatch: { adapterType: "http" } },
      resultJson: { stopReason: "cancelled" },
    });
    expect(await stopped(webhook)).toBe(true);
    expect(await canRetryStoppedRun(db, noReceipt)).toBe(false);
    const settledReceipt = await agent();
    const withReceipt = await cancelledRun(settledReceipt, {
      executionStage: "settled", controllerLeaseExpiresAt: null, errorCode: "cancelled_by_operator",
      runnerProfileJson: { adapterDispatch: { adapterType: "http" } },
      resultJson: { stopReason: "cancelled", startupPreparationSettledAt: new Date().toISOString() },
    });
    expect(await canRetryStoppedRun(db, withReceipt)).toBe(true);
  });

  it("counts a settled legacy cancellation that left no process identity for a conversation adapter", async () => {
    const settled = await agent();
    await cancelledRun(settled, {
      executionStage: "settled", controllerLeaseExpiresAt: null,
      runnerProfileJson: { adapterDispatch: { adapterType: "omp_local" } },
      resultJson: { stopReason: "cancelled", startupPreparationSettledAt: new Date().toISOString() },
    });
    expect(await stopped(settled)).toBe(true);
    const renewing = await agent();
    await cancelledRun(renewing, {
      executionStage: "settled", controllerLeaseExpiresAt: new Date(Date.now() + 60_000),
      runnerProfileJson: { adapterDispatch: { adapterType: "omp_local" } },
      resultJson: { stopReason: "cancelled", startupPreparationSettledAt: new Date().toISOString() },
    });
    expect(await stopped(renewing)).toBe(false);
    const invoked = await agent();
    const invokedRun = await cancelledRun(invoked, {
      executionStage: "settled", controllerLeaseExpiresAt: null,
      runnerProfileJson: { adapterDispatch: { adapterType: "omp_local" } },
      resultJson: { stopReason: "cancelled", startupPreparationSettledAt: new Date().toISOString() },
    });
    await db.insert(heartbeatRunEvents).values({
      companyId, runId: invokedRun.id, agentId: invoked, seq: 1, eventType: "turn.started",
      stream: "system", level: "info", message: "recorded", payload: {},
    });
    expect(await stopped(invoked)).toBe(false);
  });
});

