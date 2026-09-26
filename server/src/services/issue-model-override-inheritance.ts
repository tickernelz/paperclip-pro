import { and, eq, inArray } from "drizzle-orm";
import { issues, type Db } from "@tickernelz/paperclip-pro-db";
import type {
  IssueRunModelOverridePropagation,
  IssueRunModelOverrideSubtaskScope,
} from "@tickernelz/paperclip-pro-shared";
import {
  hasExplicitIssueRunModelOverride,
  writeIssueRunModelOverride,
  type IssueRunModelOverrideValues,
} from "./issue-run-model-override.js";

export const ISSUE_MODEL_OVERRIDE_SUBTREE_MAX_DEPTH = 10;
export const ISSUE_MODEL_OVERRIDE_SUBTREE_MAX_ISSUES = 500;

/** Rewrites the override on descendants that do not own one, bounded and cycle-safe. */
export async function applyIssueRunModelOverrideToSubtree(
  db: Db,
  input: {
    companyId: string;
    rootIssueId: string;
    values: IssueRunModelOverrideValues;
    subtaskScope: IssueRunModelOverrideSubtaskScope;
  },
): Promise<IssueRunModelOverridePropagation> {
  const result: IssueRunModelOverridePropagation = {
    applied: 0,
    skipped: 0,
    visited: 0,
    limitReached: false,
  };
  const visited = new Set<string>([input.rootIssueId]);
  let frontier = [input.rootIssueId];
  for (let depth = 0; depth < ISSUE_MODEL_OVERRIDE_SUBTREE_MAX_DEPTH; depth += 1) {
    if (frontier.length === 0) break;
    const children = await db
      .select({
        id: issues.id,
        assigneeAdapterOverrides: issues.assigneeAdapterOverrides,
      })
      .from(issues)
      .where(
        and(
          eq(issues.companyId, input.companyId),
          inArray(issues.parentId, frontier),
        ),
      );
    const next: string[] = [];
    for (const child of children) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      if (result.visited >= ISSUE_MODEL_OVERRIDE_SUBTREE_MAX_ISSUES) {
        result.limitReached = true;
        return result;
      }
      result.visited += 1;
      if (hasExplicitIssueRunModelOverride(child.assigneeAdapterOverrides)) {
        result.skipped += 1;
        continue;
      }
      const nextOverrides = writeIssueRunModelOverride(
        child.assigneeAdapterOverrides,
        input.values,
        {
          inheritToSubtasks: true,
          subtaskScope: input.subtaskScope,
          inherited: true,
          sourceIssueId: input.rootIssueId,
        },
      );
      await db
        .update(issues)
        .set({ assigneeAdapterOverrides: nextOverrides, updatedAt: new Date() })
        .where(and(eq(issues.id, child.id), eq(issues.companyId, input.companyId)));
      result.applied += 1;
      next.push(child.id);
    }
    if (next.length === 0) break;
    frontier = next;
    if (depth === ISSUE_MODEL_OVERRIDE_SUBTREE_MAX_DEPTH - 1) {
      const deeper = await db
        .select({ id: issues.id })
        .from(issues)
        .where(
          and(eq(issues.companyId, input.companyId), inArray(issues.parentId, next)),
        )
        .limit(1);
      if (deeper.length > 0) result.limitReached = true;
    }
  }
  return result;
}
