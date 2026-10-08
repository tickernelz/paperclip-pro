import type { InfiniteData, Query, QueryClient } from "@tanstack/react-query";
import type { Issue } from "@tickernelz/paperclip-pro-shared";
import { queryKeys } from "./queryKeys";

export const LARGE_ISSUE_LIST_ROW_COUNT = 100;
export const ISSUE_LIST_LIVE_REFRESH_INTERVAL_MS = 30_000;

const PATCHABLE_ISSUE_FIELDS = [
  "status",
  "priority",
  "title",
  "assigneeAgentId",
  "assigneeUserId",
  "projectId",
  "parentId",
] as const;

const LOCAL_INBOX_ACTIONS = new Set([
  "issue.read_marked",
  "issue.read_unmarked",
  "issue.inbox_archived",
  "issue.inbox_unarchived",
]);

type IssueRow = Pick<Issue, "id"> & Partial<Issue>;
type IssueListPatch = Partial<Pick<Issue, (typeof PATCHABLE_ISSUE_FIELDS)[number] | "lastActivityAt">>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInfiniteIssueData(data: unknown): data is InfiniteData<IssueRow[]> {
  return isRecord(data) && Array.isArray(data.pages);
}

function issueListRowCount(data: unknown): number {
  if (Array.isArray(data)) return data.length;
  if (isInfiniteIssueData(data)) {
    return data.pages.reduce((total, page) => total + (Array.isArray(page) ? page.length : 0), 0);
  }
  return 0;
}

export function isLargeIssueListQuery(query: Query): boolean {
  const data = query.state.data;
  return isInfiniteIssueData(data) || issueListRowCount(data) >= LARGE_ISSUE_LIST_ROW_COUNT;
}

export function readIssueListPatchFromActivity(
  action: string | null,
  details: Record<string, unknown> | null,
  occurredAt: string | null,
): IssueListPatch {
  const patch: Record<string, unknown> = {};
  const changes = isRecord(details?.changes) ? details.changes : null;
  if (action === "issue.updated" && changes) {
    for (const field of PATCHABLE_ISSUE_FIELDS) {
      const change = changes[field];
      if (!isRecord(change) || change.updated === true || !("to" in change)) continue;
      patch[field] = change.to;
    }
  }
  if (occurredAt && action && !LOCAL_INBOX_ACTIONS.has(action) && !Number.isNaN(Date.parse(occurredAt))) {
    patch.lastActivityAt = occurredAt;
  }
  return patch as IssueListPatch;
}

function patchIssueRow(row: IssueRow, patch: IssueListPatch): IssueRow {
  let next: IssueRow | null = null;
  for (const [field, value] of Object.entries(patch)) {
    if (field === "lastActivityAt") {
      const current = row.lastActivityAt ? new Date(row.lastActivityAt).getTime() : 0;
      if (new Date(value as string).getTime() <= current) continue;
    } else if (!(field in row) || (row as Record<string, unknown>)[field] === value) {
      continue;
    }
    next ??= { ...row };
    (next as Record<string, unknown>)[field] = value;
  }
  return next ?? row;
}

function patchIssueRows(rows: IssueRow[], issueId: string, patch: IssueListPatch): IssueRow[] {
  const index = rows.findIndex((row) => row?.id === issueId);
  if (index < 0) return rows;
  const patched = patchIssueRow(rows[index]!, patch);
  if (patched === rows[index]) return rows;
  const next = rows.slice();
  next[index] = patched;
  return next;
}

function patchIssueListData(data: unknown, issueId: string, patch: IssueListPatch): unknown {
  if (Array.isArray(data)) return patchIssueRows(data as IssueRow[], issueId, patch);
  if (!isInfiniteIssueData(data)) return data;
  let changed = false;
  const pages = data.pages.map((page) => {
    if (!Array.isArray(page)) return page;
    const next = patchIssueRows(page, issueId, patch);
    if (next !== page) changed = true;
    return next;
  });
  return changed ? { ...data, pages } : data;
}

export function patchIssueInListCaches(
  queryClient: Pick<QueryClient, "getQueriesData" | "setQueryData">,
  companyId: string,
  issueId: string,
  patch: IssueListPatch,
): number {
  if (Object.keys(patch).length === 0) return 0;
  let patchedQueries = 0;
  for (const [queryKey, data] of queryClient.getQueriesData({ queryKey: queryKeys.issues.list(companyId) })) {
    const next = patchIssueListData(data, issueId, patch);
    if (next === data) continue;
    queryClient.setQueryData(queryKey, next);
    patchedQueries += 1;
  }
  return patchedQueries;
}

export function invalidateIssueListsForActivity(
  queryClient: Pick<QueryClient, "invalidateQueries" | "getQueryCache">,
  companyId: string,
) {
  for (const query of queryClient.getQueryCache().findAll({ queryKey: queryKeys.issues.list(companyId) })) {
    void queryClient.invalidateQueries({
      queryKey: query.queryKey,
      exact: true,
      ...(isLargeIssueListQuery(query) ? { refetchType: "none" as const } : {}),
    });
  }
}

export function refreshInvalidatedLiveLists(
  queryClient: Pick<QueryClient, "refetchQueries">,
  companyId: string,
) {
  const predicate = (query: Query) => query.state.isInvalidated;
  return Promise.all([
    queryClient.refetchQueries({ queryKey: queryKeys.issues.list(companyId), type: "active", predicate }),
    queryClient.refetchQueries({ queryKey: queryKeys.heartbeats(companyId), type: "active", predicate }),
  ]);
}
