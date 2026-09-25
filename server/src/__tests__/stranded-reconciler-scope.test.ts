import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agentRuntimeState,
  agentWakeupRequests,
  agents,
  authUsers,
  companies,
  createDb,
  environmentLeases,
  environments,
  heartbeatRuns,
  issueComments,
  issueInboxArchives,
  issueRecoveryActions,
  issueRelations,
  issues,
} from "@tickernelz/paperclip-pro-db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { recoveryService } from "../services/recovery/service.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("stranded reconciler scope", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-stranded-scope-");
    db = createDb(tempDb.connectionString);
  }, 60_000);

  afterEach(async () => {
    await db.delete(issueRecoveryActions);
    await db.delete(issueComments);
    await db.delete(environmentLeases);
    await db.delete(activityLog);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(environments);
    await db.delete(issueInboxArchives);
    await db.delete(issueRelations);
    await db.delete(issues);
    await db.delete(agentRuntimeState);
    await db.delete(agents);
    await db.delete(companies);
    await db.delete(authUsers);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany(options?: { coderStatus?: string; issueStatus?: string }) {
    const companyId = randomUUID();
    const managerId = randomUUID();
    const coderId = randomUUID();
    const issueId = randomUUID();
    const prefix = `SC${companyId.replaceAll("-", "").slice(0, 6).toUpperCase()}`;
    await db.insert(companies).values({
      id: companyId,
      name: "Scope Co",
      issuePrefix: prefix,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values([
      {
        id: managerId,
        companyId,
        name: "CTO",
        role: "cto",
        status: "idle",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: coderId,
        companyId,
        name: "Coder",
        role: "engineer",
        status: options?.coderStatus ?? "idle",
        reportsTo: managerId,
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Ship the scope fix",
      status: options?.issueStatus ?? "todo",
      priority: "medium",
      assigneeAgentId: coderId,
      issueNumber: 1,
      identifier: `${prefix}-1`,
    });
    return { companyId, managerId, coderId, issueId, prefix };
  }

  async function seedBlocker(input: { companyId: string; prefix: string; blockedIssueId: string }) {
    const blockerId = randomUUID();
    await db.insert(issues).values({
      id: blockerId,
      companyId: input.companyId,
      title: "Blocking work",
      status: "todo",
      priority: "medium",
      issueNumber: 2,
      identifier: `${input.prefix}-2`,
    });
    await db.insert(issueRelations).values({
      companyId: input.companyId,
      issueId: blockerId,
      relatedIssueId: input.blockedIssueId,
      type: "blocks",
    });
    return blockerId;
  }

  async function seedRun(input: {
    companyId: string;
    agentId: string;
    issueId: string;
    status: string;
    errorCode: string | null;
    retryReason?: string;
    error?: string;
  }) {
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId: input.companyId,
      agentId: input.agentId,
      invocationSource: "manual",
      status: input.status,
      error: input.error ?? (input.errorCode ? `run ended: ${input.errorCode}` : null),
      errorCode: input.errorCode,
      resultJson: { executionRecovery: { kind: "bootstrap", providerWorkStarted: false } },
      startedAt: new Date("2026-09-25T06:20:00.000Z"),
      finishedAt: new Date("2026-09-25T06:25:00.000Z"),
      contextSnapshot: {
        issueId: input.issueId,
        ...(input.retryReason ? { retryReason: input.retryReason } : {}),
      },
    });
    return runId;
  }

  async function strandedEscalationRows(companyId: string) {
    const rows = await db.select().from(activityLog).where(eq(activityLog.companyId, companyId));
    return rows.filter(
      (row) =>
        (row.details as Record<string, unknown> | null)?.source ===
        "recovery.reconcile_stranded_assigned_issue",
    );
  }

  it("does not blocked-flip assigned work when the board pauses every agent", async () => {
    const { companyId, coderId, issueId } = await seedCompany({ coderStatus: "paused" });
    await seedRun({
      companyId,
      agentId: coderId,
      issueId,
      status: "cancelled",
      errorCode: "agent_paused",
      retryReason: "assignment_recovery",
    });
    const enqueueWakeup = vi.fn(async () => null);

    const result = await recoveryService(db, { enqueueWakeup }).reconcileStrandedAssignedIssues();

    expect(result.escalated).toBe(0);
    expect(result.assigneeNotSchedulableExempted).toBe(1);
    const [issue] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(issue?.status).toBe("todo");
    expect(await strandedEscalationRows(companyId)).toHaveLength(0);
    expect(await db.select().from(issueRecoveryActions)).toHaveLength(0);
    expect(enqueueWakeup).not.toHaveBeenCalled();
  });

  it("leaves a paused assignee's never-run todo issue schedulable", async () => {
    const { companyId, issueId } = await seedCompany({ coderStatus: "paused" });
    const enqueueWakeup = vi.fn(async () => null);

    const result = await recoveryService(db, { enqueueWakeup }).reconcileStrandedAssignedIssues();

    expect(result.escalated).toBe(0);
    expect(result.assigneeNotSchedulableExempted).toBe(1);
    const [issue] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(issue?.status).toBe("todo");
    expect(enqueueWakeup).not.toHaveBeenCalled();
  });

  it("dispatches the same issue once its assignee is resumed", async () => {
    const { companyId, coderId, issueId } = await seedCompany({ coderStatus: "paused" });
    const enqueueWakeup = vi.fn(async () => ({ id: randomUUID() }) as never);
    const recovery = recoveryService(db, { enqueueWakeup });

    expect((await recovery.reconcileStrandedAssignedIssues()).assignmentDispatched).toBe(0);

    await db.update(agents).set({ status: "idle" }).where(eq(agents.id, coderId));
    const resumed = await recovery.reconcileStrandedAssignedIssues();

    expect(resumed.assignmentDispatched).toBe(1);
    expect(resumed.escalated).toBe(0);
    expect(enqueueWakeup).toHaveBeenCalledTimes(1);
    const [issue] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(issue?.status).toBe("todo");
    expect(await strandedEscalationRows(companyId)).toHaveLength(0);
  });

  it("re-dispatches an invokable assignee whose last run was cancelled by the pause", async () => {
    const { companyId, coderId, issueId } = await seedCompany();
    const wakeRun = { id: randomUUID() };
    const pausedRunId = await seedRun({
      companyId,
      agentId: coderId,
      issueId,
      status: "cancelled",
      errorCode: "agent_paused",
      retryReason: "assignment_recovery",
    });
    const enqueueWakeup = vi.fn(async () => wakeRun as never);
    const scheduleRecoveryRetry = vi.fn(async () => wakeRun as never);

    const result = await recoveryService(db, {
      enqueueWakeup,
      scheduleRecoveryRetry,
    }).reconcileStrandedAssignedIssues();

    expect(result.escalated).toBe(0);
    expect(result.dispatchRequeued).toBe(1);
    expect(scheduleRecoveryRetry).toHaveBeenCalledWith(pausedRunId);
    const [issue] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(issue?.status).toBe("todo");
    expect(await strandedEscalationRows(companyId)).toHaveLength(0);
  });

  it("treats an issue with an unresolved blocker as waiting, not stranded", async () => {
    const { companyId, coderId, issueId, prefix } = await seedCompany({ issueStatus: "in_progress" });
    await seedBlocker({ companyId, prefix, blockedIssueId: issueId });
    await seedRun({
      companyId,
      agentId: coderId,
      issueId,
      status: "failed",
      errorCode: "issue_continuation_failed",
      retryReason: "issue_continuation_needed",
    });
    const enqueueWakeup = vi.fn(async () => null);

    const result = await recoveryService(db, { enqueueWakeup }).reconcileStrandedAssignedIssues();

    expect(result.escalated).toBe(0);
    const [issue] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(issue?.status).toBe("in_progress");
    expect(await strandedEscalationRows(companyId)).toHaveLength(0);
    expect(await db.select().from(issueRecoveryActions)).toHaveLength(0);
  });

  it("keeps a released dependency hold in todo when the assignee is paused", async () => {
    const { companyId, coderId, issueId } = await seedCompany({ coderStatus: "paused" });
    await seedRun({
      companyId,
      agentId: coderId,
      issueId,
      status: "cancelled",
      errorCode: "issue_dependencies_blocked",
      retryReason: "assignment_recovery",
    });
    const enqueueWakeup = vi.fn(async () => null);

    const result = await recoveryService(db, { enqueueWakeup }).reconcileStrandedAssignedIssues();

    expect(result.escalated).toBe(0);
    expect(result.assigneeNotSchedulableExempted).toBe(1);
    const [issue] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(issue?.status).toBe("todo");
    expect(issue?.blockedByIssueIds ?? []).toEqual([]);
    expect(await strandedEscalationRows(companyId)).toHaveLength(0);
  });

  it("leaves a stale-context setup failure for the user to retry instead of blocking it", async () => {
    const { companyId, coderId, issueId } = await seedCompany({ issueStatus: "in_progress" });
    await seedRun({
      companyId,
      agentId: coderId,
      issueId,
      status: "failed",
      errorCode: "setup_failed",
      error: "continuation_source_context_missing",
      retryReason: "issue_continuation_needed",
    });
    const enqueueWakeup = vi.fn(async () => null);

    const result = await recoveryService(db, { enqueueWakeup }).reconcileStrandedAssignedIssues();

    expect(result.escalated).toBe(0);
    const [issue] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(issue?.status).toBe("in_progress");
    expect(await strandedEscalationRows(companyId)).toHaveLength(0);
    expect(await db.select().from(issueRecoveryActions)).toHaveLength(0);
  });

  it("still escalates a repeatable setup failure once", async () => {
    const { companyId, coderId, issueId } = await seedCompany({ issueStatus: "in_progress" });
    await seedRun({
      companyId,
      agentId: coderId,
      issueId,
      status: "failed",
      errorCode: "setup_failed",
      error: "Low-trust execution requires isolated workspaces to be enabled.",
      retryReason: "issue_continuation_needed",
    });
    const enqueueWakeup = vi.fn(async () => null);

    const result = await recoveryService(db, { enqueueWakeup }).reconcileStrandedAssignedIssues();

    expect(result.escalated).toBe(1);
    expect(result.continuationRequeued).toBe(0);
    const [issue] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(issue?.status).toBe("blocked");
    expect(await strandedEscalationRows(companyId)).toHaveLength(1);
  });

  it("still escalates a genuinely stranded issue with an active assignee and no blockers", async () => {
    const { companyId, coderId, issueId } = await seedCompany({ issueStatus: "in_progress" });
    await seedRun({
      companyId,
      agentId: coderId,
      issueId,
      status: "failed",
      errorCode: "issue_continuation_failed",
      retryReason: "issue_continuation_needed",
    });
    const enqueueWakeup = vi.fn(async () => null);

    const result = await recoveryService(db, { enqueueWakeup }).reconcileStrandedAssignedIssues();

    expect(result.escalated).toBe(1);
    const [issue] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(issue?.status).toBe("blocked");
    expect(issue?.assigneeAgentId).toBe(coderId);
    const escalations = await strandedEscalationRows(companyId);
    expect(escalations).toHaveLength(1);
    expect((escalations[0]?.details as Record<string, unknown>).recoveryCause).toBe(
      "stranded_assigned_issue",
    );
  });
});
