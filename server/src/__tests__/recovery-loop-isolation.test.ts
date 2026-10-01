import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agentWakeupRequests,
  agents,
  companies,
  createDb,
  heartbeatRunEvents,
  heartbeatRuns,
  issueComments,
  issueRecoveryActions,
  issueRelations,
  issues,
} from "@tickernelz/paperclip-pro-db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import type * as PauseHoldGuardModule from "../services/recovery/pause-hold-guard.js";
import type * as ActivityLogModule from "../services/activity-log.js";

const failures = vi.hoisted(() => ({
  pauseHoldIssueIds: new Set<string>(),
  activityEntityIds: new Set<string>(),
}));

vi.mock("../services/recovery/pause-hold-guard.js", async (importOriginal) => {
  const actual = await importOriginal<typeof PauseHoldGuardModule>();
  return {
    ...actual,
    isAutomaticRecoverySuppressedByPauseHold: async (
      ...args: Parameters<typeof actual.isAutomaticRecoverySuppressedByPauseHold>
    ) => {
      if (failures.pauseHoldIssueIds.has(args[2])) throw new Error("pause-hold lookup failed for this issue");
      return actual.isAutomaticRecoverySuppressedByPauseHold(...args);
    },
  };
});

vi.mock("../services/activity-log.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ActivityLogModule>();
  return {
    ...actual,
    logActivity: async (...args: Parameters<typeof actual.logActivity>) => {
      if (failures.activityEntityIds.has(args[1].entityId)) throw new Error("activity write failed for this issue");
      return actual.logActivity(...args);
    },
  };
});

import { recoveryService } from "../services/recovery/service.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("recovery loop per-candidate isolation", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-recovery-loop-isolation-");
    db = createDb(tempDb.connectionString);
  }, 60_000);

  afterEach(async () => {
    failures.pauseHoldIssueIds.clear();
    failures.activityEntityIds.clear();
    await db.delete(issueRecoveryActions);
    await db.delete(issueComments);
    await db.delete(activityLog);
    await db.delete(issueRelations);
    await db.delete(issues);
    await db.delete(heartbeatRunEvents);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  let issueNumber = 0;

  async function seedCompany() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const prefix = `LI${companyId.replaceAll("-", "").slice(0, 6).toUpperCase()}`;
    await db.insert(companies).values({
      id: companyId,
      name: "Isolation Co",
      issuePrefix: prefix,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Coder",
      role: "engineer",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    return { companyId, agentId, prefix };
  }

  async function seedIssue(
    company: { companyId: string; prefix: string },
    values: Partial<typeof issues.$inferInsert> = {},
  ) {
    const id = randomUUID();
    issueNumber += 1;
    await db.insert(issues).values({
      id,
      companyId: company.companyId,
      title: `Issue ${issueNumber}`,
      status: "todo",
      priority: "medium",
      issueNumber,
      identifier: `${company.prefix}-${issueNumber}`,
      ...values,
    });
    return id;
  }

  async function seedBlocks(companyId: string, blockerId: string, blockedId: string) {
    await db.insert(issueRelations).values({
      companyId,
      issueId: blockerId,
      relatedIssueId: blockedId,
      type: "blocks",
    });
  }

  function failingWakeup(failingIssueId: string, error: Error = new Error("wake rejected for this issue")) {
    return vi.fn(async (_agentId: string, input: { payload?: Record<string, unknown> | null }) => {
      if (input.payload?.issueId === failingIssueId) throw error;
      return { id: randomUUID() } as never;
    });
  }

  it("dispatches the healthy stranded candidate after another candidate's dispatch throws", async () => {
    const company = await seedCompany();
    const failingIssueId = await seedIssue(company, { assigneeAgentId: company.agentId });
    const healthyIssueId = await seedIssue(company, { assigneeAgentId: company.agentId });
    const enqueueWakeup = failingWakeup(failingIssueId);

    const result = await recoveryService(db, { enqueueWakeup }).reconcileStrandedAssignedIssues();

    expect(result.errored).toBe(1);
    expect(result.assignmentDispatched).toBe(1);
    expect(result.issueIds).toEqual([healthyIssueId]);
    expect(enqueueWakeup).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["postgres.js connection code", Object.assign(new Error("write CONNECTION_CLOSED db:5432"), { code: "CONNECTION_CLOSED" })],
    [
      "wrapped admin-shutdown SQLSTATE",
      new Error("Failed query: select 1", { cause: Object.assign(new Error("terminating connection"), { code: "57P01" }) }),
    ],
    [
      "wrapped aborted-transaction SQLSTATE",
      new Error("Failed query: select 1", { cause: Object.assign(new Error("current transaction is aborted"), { code: "25P02" }) }),
    ],
    [
      "wrapped socket timeout",
      new Error("Failed query: select 1", { cause: Object.assign(new Error("connect ETIMEDOUT 10.0.0.5:5432"), { code: "ETIMEDOUT" }) }),
    ],
  ])("aborts the whole stranded sweep on a %s", async (_label, error) => {
    const company = await seedCompany();
    const failingIssueId = await seedIssue(company, { assigneeAgentId: company.agentId });
    await seedIssue(company, { assigneeAgentId: company.agentId });

    await expect(
      recoveryService(db, { enqueueWakeup: failingWakeup(failingIssueId, error) }).reconcileStrandedAssignedIssues(),
    ).rejects.toBe(error);
  });

  it("resolves the healthy active recovery action after another action's source update hits a blocker cycle", async () => {
    const company = await seedCompany();
    const cycleSourceId = await seedIssue(company, { status: "in_progress" });
    const middleId = await seedIssue(company);
    const childId = await seedIssue(company, { parentId: cycleSourceId });
    await seedBlocks(company.companyId, cycleSourceId, middleId);
    await seedBlocks(company.companyId, middleId, childId);
    const doneSourceId = await seedIssue(company, { status: "done" });
    const actionValues = (sourceIssueId: string) => ({
      companyId: company.companyId,
      sourceIssueId,
      kind: "stranded_assigned_issue",
      status: "active",
      ownerType: "board",
      cause: "stranded_assigned_issue",
      fingerprint: `isolation:${sourceIssueId}`,
      nextAction: "Board review",
    });
    await db.insert(issueRecoveryActions).values([actionValues(cycleSourceId), actionValues(doneSourceId)]);

    const result = await recoveryService(db, { enqueueWakeup: vi.fn(async () => null) }).reconcileStrandedAssignedIssues();

    expect(result.errored).toBe(1);
    const actions = await db
      .select({ sourceIssueId: issueRecoveryActions.sourceIssueId, status: issueRecoveryActions.status })
      .from(issueRecoveryActions);
    expect(Object.fromEntries(actions.map((row) => [row.sourceIssueId, row.status]))).toEqual({
      [cycleSourceId]: "active",
      [doneSourceId]: "resolved",
    });
    const [cycleSource] = await db.select().from(issues).where(eq(issues.id, cycleSourceId));
    expect(cycleSource?.status).toBe("in_progress");
  });

  it("assigns the healthy orphan blocker after another blocker's creator wake throws", async () => {
    const company = await seedCompany();
    const failingBlockerId = await seedIssue(company, { createdByAgentId: company.agentId });
    const healthyBlockerId = await seedIssue(company, { createdByAgentId: company.agentId });
    await seedBlocks(company.companyId, failingBlockerId, await seedIssue(company));
    await seedBlocks(company.companyId, healthyBlockerId, await seedIssue(company));

    const result = await recoveryService(db, {
      enqueueWakeup: failingWakeup(failingBlockerId),
    }).reconcileStrandedAssignedIssues();

    expect(result.errored).toBe(1);
    expect(result.orphanBlockersAssigned).toBe(1);
    expect(result.issueIds).toEqual([healthyBlockerId]);
  });

  it("heals the healthy resolved-dependency candidate after another candidate's pause-hold lookup throws", async () => {
    const company = await seedCompany();
    const seedResolvedDependent = async () => {
      const dependentId = await seedIssue(company, {
        status: "blocked",
        assigneeAgentId: company.agentId,
        blockedTransitionAt: new Date("2026-10-01T03:00:00.000Z"),
      });
      await seedBlocks(company.companyId, await seedIssue(company, { status: "done" }), dependentId);
      return dependentId;
    };
    const failingDependentId = await seedResolvedDependent();
    const healthyDependentId = await seedResolvedDependent();
    failures.pauseHoldIssueIds.add(failingDependentId);
    const enqueueWakeup = vi.fn(async () => ({ id: randomUUID() }) as never);

    const result = await recoveryService(db, { enqueueWakeup }).reconcileResolvedDependencyWakeBackstop();

    expect(result.checked).toBe(2);
    expect(result.errored).toBe(1);
    expect(result.healed).toBe(1);
    expect(result.issueIds).toEqual([healthyDependentId]);
  });

  async function seedLockedRun(company: { companyId: string; agentId: string; prefix: string }, status: string) {
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId: company.companyId,
      agentId: company.agentId,
      status,
      invocationSource: "manual",
      startedAt: new Date(),
      ...(status === "running" ? { processPid: 2_000_000_000 } : { finishedAt: new Date() }),
    });
    const issueId = await seedIssue(company, {
      status: "in_progress",
      assigneeAgentId: company.agentId,
      checkoutRunId: runId,
      executionRunId: runId,
      executionLockedAt: new Date(),
    });
    return { runId, issueId };
  }

  it("terminalizes the healthy orphaned run after another run's terminal write throws", async () => {
    const company = await seedCompany();
    const failing = await seedLockedRun(company, "running");
    const healthy = await seedLockedRun(company, "running");

    const result = await recoveryService(db, {
      enqueueWakeup: vi.fn(async () => null),
      beforeOrphanedRunTerminalWrite: async (runId) => {
        if (runId === failing.runId) throw new Error("terminal write refused for this run");
      },
    }).sweepStaleIssueLocks();

    expect(result).toEqual({
      cleared: 1,
      issueIds: [healthy.issueId],
      errored: 1,
      terminalizedRunIds: [healthy.runId],
    });
    const runs = await db
      .select({ id: heartbeatRuns.id, status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(inArray(heartbeatRuns.id, [failing.runId, healthy.runId]));
    expect(Object.fromEntries(runs.map((row) => [row.id, row.status]))).toEqual({
      [failing.runId]: "running",
      [healthy.runId]: "interrupted",
    });
  });

  it("clears the healthy stale lock after another issue's audit write throws", async () => {
    const company = await seedCompany();
    const failing = await seedLockedRun(company, "failed");
    const healthy = await seedLockedRun(company, "failed");
    failures.activityEntityIds.add(failing.issueId);

    const result = await recoveryService(db, { enqueueWakeup: vi.fn(async () => null) }).sweepStaleIssueLocks();

    expect(result.errored).toBe(1);
    expect(result.cleared).toBe(2);
    expect([...result.issueIds].sort()).toEqual([failing.issueId, healthy.issueId].sort());
    const audits = await db
      .select({ entityId: activityLog.entityId })
      .from(activityLog)
      .where(eq(activityLog.action, "issue.stale_lock_cleared"));
    expect(audits).toEqual([{ entityId: healthy.issueId }]);
  });
});
