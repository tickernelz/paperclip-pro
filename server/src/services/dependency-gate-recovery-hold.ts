import { and, eq, inArray, ne } from "drizzle-orm";
import {
  approvals,
  issueApprovals,
  issueRecoveryActions,
  issueRelations,
  issueThreadInteractions,
  issues,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import { persistActivity } from "./activity-log.js";
import {
  dependencyGateRecoveryHoldPredicate,
  executionBlockerPredicate,
} from "./execution-blocker.js";

export const DEPENDENCY_GATE_RELEASE_POLICY = "dependency_gate_release_v1";

const RELEASE_NOTE =
  "Dependency wait released because every blocker is done. No recorded work was replayed.";

export type DependencyGateRecoveryHoldRelease = {
  released: boolean;
  recoveryActionIds: string[];
  previousStatus: string | null;
  restoredStatus: string | null;
};

const NOT_RELEASED: DependencyGateRecoveryHoldRelease = {
  released: false,
  recoveryActionIds: [],
  previousStatus: null,
  restoredStatus: null,
};

/** Retires dependency-gate reconciliation holds once every blocker is done. */
export async function releaseDependencyGateRecoveryHold(
  db: Db,
  input: {
    companyId: string;
    issueId: string;
    now?: Date;
    runId?: string | null;
    actorId?: string;
  },
): Promise<DependencyGateRecoveryHoldRelease> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(issues)
      .where(and(eq(issues.companyId, input.companyId), eq(issues.id, input.issueId)))
      .for("update");
    if (!task || ["done", "cancelled"].includes(task.status)) return NOT_RELEASED;

    const holds = await tx
      .select()
      .from(issueRecoveryActions)
      .where(
        and(
          eq(issueRecoveryActions.companyId, input.companyId),
          eq(issueRecoveryActions.sourceIssueId, input.issueId),
          dependencyGateRecoveryHoldPredicate(),
        ),
      )
      .for("update");
    if (holds.length === 0) return NOT_RELEASED;

    const [unresolvedBlocker] = await tx
      .select({ id: issues.id })
      .from(issueRelations)
      .innerJoin(issues, eq(issueRelations.issueId, issues.id))
      .where(
        and(
          eq(issueRelations.companyId, input.companyId),
          eq(issueRelations.type, "blocks"),
          eq(issueRelations.relatedIssueId, input.issueId),
          ne(issues.status, "done"),
        ),
      )
      .limit(1);
    if (unresolvedBlocker) return NOT_RELEASED;

    for (const hold of holds) {
      const previousRecovery =
        typeof hold.evidence.automaticRecovery === "object" && hold.evidence.automaticRecovery !== null
          ? (hold.evidence.automaticRecovery as Record<string, unknown>)
          : {};
      await tx
        .update(issueRecoveryActions)
        .set({
          status: "resolved",
          outcome: "cancelled",
          resolvedAt: hold.resolvedAt ?? now,
          updatedAt: now,
          nextAction: RELEASE_NOTE,
          resolutionNote: RELEASE_NOTE,
          wakePolicy: null,
          monitorPolicy: null,
          evidence: {
            ...hold.evidence,
            automaticRecovery: {
              ...previousRecovery,
              policy: DEPENDENCY_GATE_RELEASE_POLICY,
              replay: "released",
              actionOutcome: "none",
              recordedAt: now.toISOString(),
            },
          },
        })
        .where(eq(issueRecoveryActions.id, hold.id));
    }

    let restoredStatus: string | null = null;
    if (task.status === "blocked" && !task.unblockDescriptor) {
      const [pendingInteraction] = await tx
        .select({ id: issueThreadInteractions.id })
        .from(issueThreadInteractions)
        .where(
          and(
            eq(issueThreadInteractions.companyId, input.companyId),
            eq(issueThreadInteractions.issueId, input.issueId),
            eq(issueThreadInteractions.status, "pending"),
          ),
        )
        .limit(1);
      const [pendingApproval] = await tx
        .select({ id: approvals.id })
        .from(issueApprovals)
        .innerJoin(
          approvals,
          and(eq(approvals.id, issueApprovals.approvalId), eq(approvals.companyId, input.companyId)),
        )
        .where(
          and(
            eq(issueApprovals.companyId, input.companyId),
            eq(issueApprovals.issueId, input.issueId),
            inArray(approvals.status, ["pending", "revision_requested"]),
          ),
        )
        .limit(1);
      const [otherHold] = await tx
        .select({ id: issueRecoveryActions.id })
        .from(issueRecoveryActions)
        .where(
          and(
            eq(issueRecoveryActions.companyId, input.companyId),
            eq(issueRecoveryActions.sourceIssueId, input.issueId),
            executionBlockerPredicate(),
          ),
        )
        .limit(1);
      if (!pendingInteraction && !pendingApproval && !otherHold) {
        await tx
          .update(issues)
          .set({ status: "todo", updatedAt: now })
          .where(and(eq(issues.id, task.id), eq(issues.status, "blocked")));
        restoredStatus = "todo";
      }
    }

    const recoveryActionIds = holds.map((hold) => hold.id);
    await persistActivity(tx as unknown as Db, {
      companyId: input.companyId,
      actorType: "system",
      actorId: input.actorId ?? "dependency-gate-release",
      action: "issue.dependency_recovery_hold_released",
      entityType: "issue",
      entityId: task.id,
      runId: input.runId ?? null,
      details: {
        recoveryActionIds,
        previousStatus: task.status,
        restoredStatus,
      },
    });

    return {
      released: true,
      recoveryActionIds,
      previousStatus: task.status,
      restoredStatus,
    };
  });
}
