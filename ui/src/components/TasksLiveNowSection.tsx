import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { useQueries } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import type { Issue } from "@tickernelz/paperclip-pro-shared";
import { Link } from "@/lib/router";
import type { LiveRunForIssue } from "../api/heartbeats";
import { issuesApi } from "../api/issues";
import { useSecondTick } from "../hooks/useSecondTick";
import {
  createIssueDetailPath,
  rememberIssueDetailLocationState,
  withIssueDetailHeaderSeed,
} from "../lib/issueDetailBreadcrumb";
import { isLiveIssueRun } from "../lib/liveIssueIds";
import { queryKeys } from "../lib/queryKeys";
import { cn, formatDurationMs } from "../lib/utils";
import { AgentIdentity } from "./AgentIdentity";
import { LiveRunDot } from "./IssueColumns";
import { findIssuesScrollContainer } from "./IssuesList";

const MAX_VISIBLE_ANCESTORS = 3;
const ISSUE_DETAIL_STALE_TIME_MS = 30_000;

export interface LiveNowEntry {
  issueId: string;
  runs: LiveRunForIssue[];
  latestStartAt: string;
  earliestStartedAt: string | null;
}

export interface LiveNowAncestor {
  id: string;
  identifier: string | null;
  title: string;
}

type LiveNowIssueNode = Pick<Issue, "id" | "identifier" | "title" | "parentId">;

function runStartAt(run: LiveRunForIssue): string {
  return run.startedAt ?? run.createdAt;
}

function timestampMs(value: string): number {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

/** Groups live runs into one entry per task, most recently started first. */
export function buildLiveNowEntries(
  liveRuns: readonly LiveRunForIssue[] | null | undefined,
  issueStatusById: ReadonlyMap<string, string>,
): LiveNowEntry[] {
  const runsByIssueId = new Map<string, LiveRunForIssue[]>();
  for (const run of liveRuns ?? []) {
    if (!run.issueId || !isLiveIssueRun(run, issueStatusById.get(run.issueId))) continue;
    const runs = runsByIssueId.get(run.issueId);
    if (runs) runs.push(run);
    else runsByIssueId.set(run.issueId, [run]);
  }
  const entries: LiveNowEntry[] = [];
  for (const [issueId, runs] of runsByIssueId) {
    runs.sort((a, b) => timestampMs(runStartAt(b)) - timestampMs(runStartAt(a)));
    const started = runs.filter((run) => run.startedAt !== null);
    entries.push({
      issueId,
      runs,
      latestStartAt: runStartAt(runs[0]!),
      earliestStartedAt: started.length > 0 ? started[started.length - 1]!.startedAt : null,
    });
  }
  return entries.sort((a, b) => timestampMs(b.latestStartAt) - timestampMs(a.latestStartAt));
}

/** Resolves a task's ancestors root-first from loaded tasks, falling back to the detail ancestors. */
export function resolveLiveNowParentPath(
  issue: Pick<Issue, "parentId"> | null | undefined,
  loadedById: ReadonlyMap<string, LiveNowIssueNode>,
  detailAncestors?: readonly LiveNowAncestor[] | null,
): { ancestors: LiveNowAncestor[]; complete: boolean } {
  const chain: LiveNowAncestor[] = [];
  const seen = new Set<string>();
  let parentId = issue?.parentId ?? null;
  let missing = false;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = loadedById.get(parentId);
    if (!parent) {
      missing = true;
      break;
    }
    chain.push({ id: parent.id, identifier: parent.identifier ?? null, title: parent.title });
    parentId = parent.parentId ?? null;
  }
  if (!missing) return { ancestors: chain.reverse(), complete: true };
  if (detailAncestors) {
    return {
      ancestors: [...detailAncestors].reverse().map(({ id, identifier, title }) => ({ id, identifier, title })),
      complete: true,
    };
  }
  return { ancestors: chain.reverse(), complete: false };
}

/** Storage key holding whether the Live now section is collapsed for a company. */
export function liveNowCollapsedStorageKey(companyId: string): string {
  return `paperclip:tasks-live-now:collapsed:${companyId}`;
}

function readCollapsed(companyId: string): boolean {
  try {
    return window.localStorage.getItem(liveNowCollapsedStorageKey(companyId)) === "true";
  } catch {
    return false;
  }
}

function writeCollapsed(companyId: string, collapsed: boolean): void {
  try {
    if (collapsed) window.localStorage.setItem(liveNowCollapsedStorageKey(companyId), "true");
    else window.localStorage.removeItem(liveNowCollapsedStorageKey(companyId));
  } catch {
    return;
  }
}

/** Keeps rows below the element still when it resizes while scrolled out of view above. */
export function useAboveViewportResizeCompensation(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const container = findIssuesScrollContainer(element);
    const scrollTarget: HTMLElement | Window = container ?? window;
    const bottomBelowViewportTop = () =>
      element.getBoundingClientRect().bottom - (container ? container.getBoundingClientRect().top : 0);
    let lastBottom = bottomBelowViewportTop();
    const syncBottom = () => {
      lastBottom = bottomBelowViewportTop();
    };
    const observer = new ResizeObserver(() => {
      const bottom = bottomBelowViewportTop();
      const shift = bottom - lastBottom;
      if (shift !== 0 && lastBottom <= 0) {
        if (container) container.scrollTop += shift;
        else window.scrollBy(0, shift);
        syncBottom();
        return;
      }
      lastBottom = bottom;
    });
    scrollTarget.addEventListener("scroll", syncBottom, { passive: true });
    observer.observe(element);
    return () => {
      observer.disconnect();
      scrollTarget.removeEventListener("scroll", syncBottom);
    };
  }, [ref]);
}

interface TasksLiveNowSectionProps {
  companyId: string;
  liveRuns: readonly LiveRunForIssue[] | null | undefined;
  issues: readonly Issue[];
  issueLinkState?: unknown;
}

/** Collapsible list of tasks with a run in progress, pinned above the Tasks list. */
export function TasksLiveNowSection({ companyId, liveRuns, issues, issueLinkState }: TasksLiveNowSectionProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  useAboveViewportResizeCompensation(rootRef);
  const [collapsed, setCollapsed] = useState(() => readCollapsed(companyId));

  const loadedById = useMemo(() => new Map(issues.map((issue) => [issue.id, issue])), [issues]);

  const detailIssueIds = useMemo(() => {
    const ids = new Set<string>();
    for (const run of liveRuns ?? []) {
      if (!run.issueId || ids.has(run.issueId) || !isLiveIssueRun(run)) continue;
      const loaded = loadedById.get(run.issueId);
      if (!loaded || !resolveLiveNowParentPath(loaded, loadedById).complete) ids.add(run.issueId);
    }
    return [...ids];
  }, [liveRuns, loadedById]);

  const detailQueries = useQueries({
    queries: detailIssueIds.map((issueId) => ({
      queryKey: queryKeys.issues.detail(issueId),
      queryFn: () => issuesApi.get(issueId),
      staleTime: ISSUE_DETAIL_STALE_TIME_MS,
      retry: false,
    })),
  });

  const { detailById, failedIds } = useMemo(() => {
    const details = new Map<string, Issue>();
    const failed = new Set<string>();
    detailQueries.forEach((query, index) => {
      const issueId = detailIssueIds[index]!;
      if (query.data) details.set(issueId, query.data);
      else if (query.isError) failed.add(issueId);
    });
    return { detailById: details, failedIds: failed };
  }, [detailIssueIds, detailQueries]);

  const entries = useMemo(() => {
    const statusById = new Map<string, string>();
    for (const run of liveRuns ?? []) {
      if (!run.issueId) continue;
      const status = loadedById.get(run.issueId)?.status ?? detailById.get(run.issueId)?.status;
      if (status) statusById.set(run.issueId, status);
    }
    return buildLiveNowEntries(liveRuns, statusById);
  }, [detailById, liveRuns, loadedById]);

  useSecondTick(entries.length > 0 && !collapsed);
  const now = Date.now();

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    writeCollapsed(companyId, next);
  };

  return (
    <div ref={rootRef} data-slot="tasks-live-now">
      {entries.length > 0 ? (
        <section aria-label="Live now" className="pb-4">
          <div className="rounded-lg border border-border">
            <button
              type="button"
              className="flex w-full min-w-0 items-center gap-2 py-1.5 pl-1 pr-3 text-left"
              aria-expanded={!collapsed}
              onClick={toggle}
            >
              <span className="inline-flex w-4 shrink-0 items-center justify-center">
                <ChevronRight
                  className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", !collapsed && "rotate-90")}
                />
              </span>
              <LiveRunDot />
              <span className="truncate text-sm font-semibold uppercase tracking-wide">Live now</span>
              <span data-slot="tasks-live-now-count" className="text-xs tabular-nums text-muted-foreground">
                {entries.length}
              </span>
            </button>
            {collapsed ? null : (
              <ul className="space-y-0.5 px-1 pb-1">
                {entries.map((entry) => (
                  <LiveNowRow
                    key={entry.issueId}
                    entry={entry}
                    issue={loadedById.get(entry.issueId) ?? detailById.get(entry.issueId) ?? null}
                    loadFailed={failedIds.has(entry.issueId)}
                    loadedById={loadedById}
                    detailAncestors={detailById.get(entry.issueId)?.ancestors ?? null}
                    issueLinkState={issueLinkState}
                    now={now}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function LiveNowRow({
  entry,
  issue,
  loadFailed,
  loadedById,
  detailAncestors,
  issueLinkState,
  now,
}: {
  entry: LiveNowEntry;
  issue: Issue | null;
  loadFailed: boolean;
  loadedById: ReadonlyMap<string, LiveNowIssueNode>;
  detailAncestors: readonly LiveNowAncestor[] | null;
  issueLinkState?: unknown;
  now: number;
}) {
  const pathId = issue?.identifier ?? entry.issueId;
  const identifier = issue?.identifier ?? entry.issueId.slice(0, 8);
  const title = issue?.title ?? (loadFailed ? "Task unavailable" : "Loading task…");
  const detailState = issue ? withIssueDetailHeaderSeed(issueLinkState, issue) : undefined;
  const { ancestors, complete } = resolveLiveNowParentPath(issue, loadedById, detailAncestors);
  const visibleAncestors = ancestors.slice(-MAX_VISIBLE_ANCESTORS);
  const truncatedAncestors = !complete || ancestors.length > visibleAncestors.length;
  const agents = [...new Map(entry.runs.map((run) => [run.agentId, run])).values()];
  const statusRun = entry.runs.find((run) => run.currentStatusMessage || run.currentToolName);
  const statusText = statusRun?.currentStatusMessage || statusRun?.currentToolName || null;
  const elapsed = entry.earliestStartedAt
    ? formatDurationMs(Math.max(0, now - new Date(entry.earliestStartedAt).getTime()))
    : "Queued";
  const agentList = (
    <span className="flex min-w-0 items-center gap-2">
      {agents.map((run) => (
        <AgentIdentity
          key={run.agentId}
          agent={{ id: run.agentId, name: run.agentName, appearance: run.agentAppearance }}
          size="sm"
          className="text-muted-foreground"
        />
      ))}
    </span>
  );

  return (
    <li data-live-now-issue-id={entry.issueId} className="rounded-lg px-2 py-1.5 hover:bg-accent/50">
      <div className="flex min-w-0 items-center gap-2">
        <LiveRunDot />
        <Link
          to={createIssueDetailPath(pathId)}
          state={detailState}
          issuePrefetch={issue}
          disableIssueQuicklook
          onClickCapture={detailState ? () => rememberIssueDetailLocationState(pathId, detailState) : undefined}
          className="flex min-w-0 flex-1 items-baseline gap-1.5 text-sm text-foreground no-underline hover:underline"
        >
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{identifier}</span>
          <span className="truncate">{title}</span>
        </Link>
        <span className="hidden shrink-0 sm:flex">{agentList}</span>
        <time
          dateTime={entry.earliestStartedAt ?? entry.latestStartAt}
          className="shrink-0 text-xs tabular-nums text-muted-foreground"
        >
          {elapsed}
        </time>
      </div>
      {visibleAncestors.length > 0 || truncatedAncestors || statusText ? (
        <div className="mt-0.5 flex min-w-0 items-center gap-2 pl-4 text-xs text-muted-foreground">
          {visibleAncestors.length > 0 || truncatedAncestors ? (
            <nav
              aria-label="Parent tasks"
              data-slot="tasks-live-now-path"
              className="flex min-w-0 shrink items-center gap-1 overflow-hidden whitespace-nowrap"
            >
              {truncatedAncestors ? <span aria-hidden="true">… ›</span> : null}
              {visibleAncestors.map((ancestor, index) => (
                <span key={ancestor.id} className="flex min-w-0 items-center gap-1">
                  {index > 0 ? <span aria-hidden="true">›</span> : null}
                  <Link
                    to={createIssueDetailPath(ancestor.identifier ?? ancestor.id)}
                    title={ancestor.title}
                    className="truncate font-mono text-muted-foreground no-underline hover:text-foreground hover:underline"
                  >
                    {ancestor.identifier ?? ancestor.id.slice(0, 8)}
                  </Link>
                </span>
              ))}
            </nav>
          ) : null}
          {statusText ? (
            <span data-slot="tasks-live-now-status" className="hidden min-w-0 flex-1 truncate sm:block sm:text-right">
              {statusText}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="mt-0.5 flex min-w-0 items-center gap-2 pl-4 text-xs text-muted-foreground sm:hidden">
        <span className="shrink-0">{agentList}</span>
        {statusText ? <span className="min-w-0 flex-1 truncate">{statusText}</span> : null}
      </div>
    </li>
  );
}
