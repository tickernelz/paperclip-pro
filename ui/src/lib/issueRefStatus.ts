import type { QueryClient } from "@tanstack/react-query";
import {
  ISSUE_REFS_MAX,
  isUuidLike,
  normalizeIssueIdentifier,
  type IssueRef,
} from "@tickernelz/paperclip-pro-shared";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";

export const ISSUE_REF_STALE_TIME_MS = 5 * 60_000;
export const ISSUE_REF_BATCH_WINDOW_MS = 30;
export const ISSUE_REF_NEAR_VIEWPORT_MARGIN = "200px";

const ISSUE_REF_STATUS_ACTIONS = new Set([
  "issue.updated",
  "issue.checked_out",
  "issue.released",
  "issue.admin_force_release",
  "issue.reassigned",
  "issue.status_decision_recorded",
  "issue.stalled_review_decided",
  "issue.execution_recovery_settled",
  "issue.tree_cancel_status_updated",
  "issue.tree_restore_status_updated",
]);

type CachedIssueRef = { ref: IssueRef; updatedAt: number };
type Waiter = { resolve: (ref: IssueRef | null) => void; reject: (error: unknown) => void };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Canonical cache/request form of a mention target: upper-case identifier or lower-case UUID. */
export function normalizeIssueRef(value: string): string | null {
  const identifier = normalizeIssueIdentifier(value);
  if (identifier) return identifier;
  const trimmed = value.trim();
  return isUuidLike(trimmed) ? trimmed.toLowerCase() : null;
}

function matchesIssueRef(issue: { id: string; identifier?: string | null }, ref: string): boolean {
  return issue.id.toLowerCase() === ref || issue.identifier?.toUpperCase() === ref;
}

function toIssueRef(value: unknown): IssueRef | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const status = readString(value.status);
  if (!id || !status) return null;
  const identifier = readString(value.identifier);
  return {
    id,
    identifier,
    title: typeof value.title === "string" ? value.title : (identifier ?? id),
    status: status as IssueRef["status"],
  };
}

function issueListRows(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (isRecord(data) && Array.isArray(data.pages)) {
    return data.pages.flatMap((page) => (Array.isArray(page) ? page : []));
  }
  return [];
}

/** Newest already-loaded detail or list row for a ref, so a warm cache never requests it again. */
export function readCachedIssueRef(
  queryClient: QueryClient,
  companyId: string,
  ref: string,
): CachedIssueRef | undefined {
  let best: CachedIssueRef | undefined;
  const consider = (value: unknown, updatedAt: number) => {
    const candidate = toIssueRef(value);
    if (!candidate || !matchesIssueRef(candidate, ref)) return;
    if (isRecord(value) && typeof value.companyId === "string" && value.companyId !== companyId) return;
    if (!best || updatedAt > best.updatedAt) best = { ref: candidate, updatedAt };
  };
  const cache = queryClient.getQueryCache();
  for (const query of cache.findAll({ queryKey: ["issues", "detail"] })) {
    consider(query.state.data, query.state.dataUpdatedAt);
  }
  for (const query of cache.findAll({ queryKey: queryKeys.issues.list(companyId) })) {
    for (const row of issueListRows(query.state.data)) consider(row, query.state.dataUpdatedAt);
  }
  return best;
}

function createIssueRefBatcher() {
  const pending = new Map<string, Map<string, Waiter[]>>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const settle = (waiters: Map<string, Waiter[]>, refs: string[], rows: IssueRef[]) => {
    const byRef = new Map<string, IssueRef>();
    for (const row of rows) {
      byRef.set(row.id.toLowerCase(), row);
      if (row.identifier) byRef.set(row.identifier.toUpperCase(), row);
    }
    for (const ref of refs) {
      for (const waiter of waiters.get(ref) ?? []) waiter.resolve(byRef.get(ref) ?? null);
    }
  };

  const flush = () => {
    timer = null;
    const batches = Array.from(pending);
    pending.clear();
    for (const [companyId, waiters] of batches) {
      const refs = Array.from(waiters.keys());
      for (let start = 0; start < refs.length; start += ISSUE_REFS_MAX) {
        const chunk = refs.slice(start, start + ISSUE_REFS_MAX);
        issuesApi.refs(companyId, chunk).then(
          (rows) => settle(waiters, chunk, rows),
          (error: unknown) => {
            for (const ref of chunk) {
              for (const waiter of waiters.get(ref) ?? []) waiter.reject(error);
            }
          },
        );
      }
    }
  };

  return (companyId: string, ref: string) =>
    new Promise<IssueRef | null>((resolve, reject) => {
      let waiters = pending.get(companyId);
      if (!waiters) {
        waiters = new Map();
        pending.set(companyId, waiters);
      }
      const list = waiters.get(ref);
      if (list) list.push({ resolve, reject });
      else waiters.set(ref, [{ resolve, reject }]);
      timer ??= setTimeout(flush, ISSUE_REF_BATCH_WINDOW_MS);
    });
}

const batchers = new WeakMap<QueryClient, ReturnType<typeof createIssueRefBatcher>>();

/** Loads one ref through the per-client batcher that coalesces refs requested within the batch window. */
export function loadIssueRef(queryClient: QueryClient, companyId: string, ref: string) {
  let load = batchers.get(queryClient);
  if (!load) {
    load = createIssueRefBatcher();
    batchers.set(queryClient, load);
  }
  return load(companyId, ref);
}

function readIssueRefPatch(details: Record<string, unknown> | null): Partial<Pick<IssueRef, "status" | "title">> {
  const changes = isRecord(details?.changes) ? details.changes : null;
  const patch: Partial<Pick<IssueRef, "status" | "title">> = {};
  for (const field of ["status", "title"] as const) {
    const change = changes?.[field];
    if (!isRecord(change) || change.updated === true || typeof change.to !== "string") continue;
    if (field === "status") patch.status = change.to as IssueRef["status"];
    else patch.title = change.to;
  }
  return patch;
}

/** Keeps mention status current from an issue activity event: patch from the payload, else refetch only the affected active refs. */
export function applyIssueRefActivity(
  queryClient: Pick<QueryClient, "getQueryCache" | "setQueryData" | "invalidateQueries">,
  companyId: string,
  payload: Record<string, unknown>,
) {
  if (payload.entityType !== "issue") return;
  const entityId = readString(payload.entityId);
  if (!entityId) return;
  const details = isRecord(payload.details) ? payload.details : null;
  const keys = new Set(
    [entityId, readString(details?.identifier), readString(details?.issueIdentifier)]
      .flatMap((value) => (value ? [normalizeIssueRef(value)] : []))
      .filter((value): value is string => value !== null),
  );
  if (keys.size === 0) return;
  const queries = queryClient
    .getQueryCache()
    .findAll({ queryKey: queryKeys.issues.refs(companyId) })
    .filter((query) => {
      const data = query.state.data as IssueRef | null | undefined;
      if (keys.has(String(query.queryKey[3]))) return true;
      return !!data && Array.from(keys).some((key) => matchesIssueRef(data, key));
    });
  if (queries.length === 0) return;
  const patch = readIssueRefPatch(details);
  if (Object.keys(patch).length > 0) {
    for (const query of queries) {
      const data = query.state.data as IssueRef | null | undefined;
      if (data) queryClient.setQueryData<IssueRef>(query.queryKey, { ...data, ...patch });
    }
    return;
  }
  const action = readString(payload.action);
  if (!action || !ISSUE_REF_STATUS_ACTIONS.has(action)) return;
  for (const query of queries) {
    void queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true, refetchType: "active" });
  }
}

type NearViewportRegistry = {
  ctor: typeof IntersectionObserver;
  observer: IntersectionObserver;
  callbacks: Map<Element, () => void>;
};

let nearViewportRegistry: NearViewportRegistry | null = null;

function getNearViewportRegistry(ctor: typeof IntersectionObserver): NearViewportRegistry {
  if (nearViewportRegistry?.ctor === ctor) return nearViewportRegistry;
  const callbacks = new Map<Element, () => void>();
  const observer = new ctor(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const callback = callbacks.get(entry.target);
        if (!callback) continue;
        callbacks.delete(entry.target);
        observer.unobserve(entry.target);
        callback();
      }
    },
    { rootMargin: ISSUE_REF_NEAR_VIEWPORT_MARGIN },
  );
  nearViewportRegistry = { ctor, observer, callbacks };
  return nearViewportRegistry;
}

/** Calls onNear once the element comes within the shared observer's margin of the viewport; returns the unsubscribe. */
export function observeNearViewport(element: Element, onNear: () => void): () => void {
  const ctor = globalThis.IntersectionObserver;
  if (typeof ctor !== "function") {
    onNear();
    return () => undefined;
  }
  const registry = getNearViewportRegistry(ctor);
  registry.callbacks.set(element, onNear);
  registry.observer.observe(element);
  return () => {
    if (registry.callbacks.get(element) !== onNear) return;
    registry.callbacks.delete(element);
    registry.observer.unobserve(element);
  };
}
