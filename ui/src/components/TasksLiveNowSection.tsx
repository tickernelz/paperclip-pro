import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { useQueries } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import type { Issue } from "@tickernelz/paperclip-pro-shared";
import type { LiveRunForIssue } from "../api/heartbeats";
import { issuesApi } from "../api/issues";
import { useSecondTick } from "../hooks/useSecondTick";
import { isLiveIssueRun } from "../lib/liveIssueIds";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import { AgentAvatar } from "./AgentAvatar";
import { LiveRunDot } from "./IssueColumns";
import { findIssuesScrollContainer } from "./IssuesList";
import { LiveNowCard } from "./live-now/LiveNowCard";
import {
  LIVE_NOW_HEALTH_POSE,
  classifyLiveNowHealth,
  countLiveNowHealth,
  mostSevereSignal,
  type LiveNowHealth,
  type LiveNowHealthCounts,
  type LiveNowHealthSignal,
} from "./live-now/live-now-health";

const MAX_VISIBLE_ANCESTORS = 3;
const ISSUE_DETAIL_STALE_TIME_MS = 30_000;
const LIVE_NOW_WIDE_CARD_LIMIT = 6;
const MAX_STRIP_AVATARS = 5;
const MOBILE_STRIP_AVATARS = 2;

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

/** Collapsible board of tasks with a run in progress, pinned above the Tasks list. */
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

  const now = Date.now();
  useSecondTick(entries.length > 0 && !collapsed);
  const [showAll, setShowAll] = useState(false);
  const listId = useId();

  const cards = entries
    .map((entry) => {
      const issue = loadedById.get(entry.issueId) ?? detailById.get(entry.issueId) ?? null;
      const signal = mostSevereSignal(entry.runs.map((run) => classifyLiveNowHealth(run, now)));
      return { entry, issue, signal, identifier: issue?.identifier ?? entry.issueId.slice(0, 8) };
    })
    .sort((a, b) => Number(b.signal.health === "stalled") - Number(a.signal.health === "stalled"));
  const counts = countLiveNowHealth(cards.map((card) => card.signal.health));
  const hiddenOnWide = showAll ? 0 : Math.max(0, cards.length - LIVE_NOW_WIDE_CARD_LIMIT);
  const announcement = useHealthAnnouncement(
    cards.map((card) => `${card.identifier}\t${card.signal.health}`).join("\n"),
  );

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    writeCollapsed(companyId, next);
  };

  return (
    <div ref={rootRef} data-slot="tasks-live-now">
      {cards.length > 0 ? (
        <section aria-label="Live now" className="pb-4">
          <button
            type="button"
            className={cn(
              "flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border py-1.5 pl-1.5 pr-3 text-left outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring",
              collapsed ? "border-border bg-card" : "border-transparent",
            )}
            aria-expanded={!collapsed}
            aria-controls={collapsed ? undefined : listId}
            onClick={toggle}
          >
            <span className="inline-flex w-4 shrink-0 items-center justify-center">
              <ChevronRight
                className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", !collapsed && "rotate-90")}
              />
            </span>
            <LiveRunDot />
            <span className="shrink-0 text-sm font-semibold uppercase tracking-wide">Live now</span>
            <span data-slot="tasks-live-now-count" className="text-xs tabular-nums text-muted-foreground">
              {cards.length}
            </span>
            {collapsed ? <LiveNowAvatarStrip cards={cards} /> : null}
            <LiveNowHealthSummary counts={counts} />
          </button>
          {collapsed ? null : (
            <>
              <ul
                id={listId}
                className="scrollbar-none mt-2 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:overflow-visible sm:pb-0 xl:grid-cols-3"
              >
                {cards.map(({ entry, issue }, index) => {
                  const { ancestors, complete } = resolveLiveNowParentPath(
                    issue,
                    loadedById,
                    detailById.get(entry.issueId)?.ancestors ?? null,
                  );
                  const visibleAncestors = ancestors.slice(-MAX_VISIBLE_ANCESTORS);
                  return (
                    <LiveNowCard
                      key={entry.issueId}
                      companyId={companyId}
                      entry={entry}
                      issue={issue}
                      loadFailed={failedIds.has(entry.issueId)}
                      ancestors={visibleAncestors}
                      truncatedAncestors={!complete || ancestors.length > visibleAncestors.length}
                      issueLinkState={issueLinkState}
                      now={now}
                      hiddenOnWide={index >= cards.length - hiddenOnWide}
                    />
                  );
                })}
              </ul>
              {cards.length > LIVE_NOW_WIDE_CARD_LIMIT ? (
                <button
                  type="button"
                  className="mt-2 hidden rounded-md px-2 py-1 text-xs text-muted-foreground outline-none hover:bg-accent/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
                  aria-controls={listId}
                  onClick={() => setShowAll((value) => !value)}
                >
                  {showAll ? "Show fewer" : `Show ${hiddenOnWide} more`}
                </button>
              ) : null}
            </>
          )}
          <p role="status" aria-live="polite" className="sr-only" data-slot="tasks-live-now-announcer">
            {announcement}
          </p>
        </section>
      ) : null}
    </div>
  );
}

type LiveNowCardModel = {
  entry: LiveNowEntry;
  identifier: string;
  signal: LiveNowHealthSignal;
};

function useHealthAnnouncement(healthKey: string): string {
  const previousRef = useRef<Map<string, LiveNowHealth> | null>(null);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    const next = new Map<string, LiveNowHealth>();
    for (const line of healthKey ? healthKey.split("\n") : []) {
      const [identifier, health] = line.split("\t") as [string, LiveNowHealth];
      next.set(identifier, health);
    }
    const previous = previousRef.current;
    previousRef.current = next;
    if (!previous) return;
    const changes: string[] = [];
    for (const [identifier, health] of next) {
      const before = previous.get(identifier);
      if (!before || before === health) continue;
      if (health === "stalled" || health === "quiet") changes.push(`${identifier} is ${health}`);
      else if (before === "stalled" || before === "quiet") changes.push(`${identifier} is working again`);
    }
    if (changes.length > 0) setAnnouncement(changes.join(". "));
  }, [healthKey]);
  return announcement;
}

function LiveNowHealthSummary({ counts }: { counts: LiveNowHealthCounts }) {
  const parts = [
    { health: "stalled", count: counts.stalled, text: "stalled" },
    { health: "quiet", count: counts.quiet, text: "quiet" },
    { health: "active", count: counts.working, text: "working" },
  ].filter((part) => part.count > 0);
  const label = parts.map((part) => `${part.count} ${part.text}`).join(", ");
  return (
    <span data-slot="tasks-live-now-summary" className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground sm:gap-3">
      <span className="sr-only">{label}</span>
      {parts.map((part) => (
        <span
          key={part.health}
          aria-hidden="true"
          data-live-health={part.health}
          className={cn("items-center gap-1.5 tabular-nums", part.health === "active" ? "hidden sm:inline-flex" : "inline-flex")}
        >
          <span aria-hidden="true" className="live-now-health-dot size-1.5 rounded-full" />
          {part.count} {part.text}
        </span>
      ))}
    </span>
  );
}

function LiveNowAvatarStrip({ cards }: { cards: readonly LiveNowCardModel[] }) {
  const agents = new Map<string, { run: LiveRunForIssue; health: LiveNowHealth }>();
  for (const card of cards) {
    for (const run of card.entry.runs) {
      if (!agents.has(run.agentId)) agents.set(run.agentId, { run, health: card.signal.health });
    }
  }
  const all = [...agents.values()];
  const shown = all.slice(0, MAX_STRIP_AVATARS);
  const extra = all.length - shown.length;
  const mobileExtra = all.length - Math.min(all.length, MOBILE_STRIP_AVATARS);
  return (
    <span data-slot="tasks-live-now-avatars" className="flex shrink-0 items-center pl-1">
      {shown.map(({ run, health }, index) => (
        <span
          key={run.agentId}
          title={run.agentName}
          className={cn(
            "-ml-1.5 inline-flex rounded-full bg-card ring-2 ring-card first:ml-0",
            index >= MOBILE_STRIP_AVATARS && "hidden sm:inline-flex",
          )}
        >
          <AgentAvatar
            agent={{ id: run.agentId, name: run.agentName, appearance: run.agentAppearance }}
            size={24}
            pose={LIVE_NOW_HEALTH_POSE[health]}
          />
        </span>
      ))}
      {mobileExtra > 0 ? (
        <span aria-hidden="true" className="ml-1 text-xs tabular-nums text-muted-foreground sm:hidden">+{mobileExtra}</span>
      ) : null}
      {extra > 0 ? (
        <span aria-hidden="true" className="ml-1 hidden text-xs tabular-nums text-muted-foreground sm:inline">+{extra}</span>
      ) : null}
      <span className="sr-only">{all.map(({ run }) => run.agentName).join(", ")}</span>
    </span>
  );
}
