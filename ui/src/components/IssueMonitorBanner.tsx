import { useCallback, useId, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Clock, X } from "lucide-react";
import type { Issue, IssueWorkProduct } from "@tickernelz/wardmote-shared";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { InlineBanner } from "@/components/InlineBanner";
import { IssuePullRequestLinks } from "@/components/IssuePullRequestLinks";
import { getIssuePullRequests, pullRequestNeedsReview } from "@/lib/issue-pull-requests";
import { brandBanner } from "@/lib/status-colors";
import { cn } from "@/lib/utils";
import {
  deriveMonitorState,
  formatMonitorAbsolute,
  formatMonitorEta,
  useMonitorCountdown,
  type DerivedMonitorState,
  type MonitorDisplayState,
} from "@/lib/issue-monitor";

/** Matches the `Date | string` inputs accepted by the issue-monitor helpers. */
type MonitorDate = Date | string;

/**
 * States in which the waiting-monitor surfaces (top banner + composer strip)
 * are shown. `cleared` and `none` hide both surfaces entirely — see
 * wireframe 04 (PAP-14557).
 */
const WAITING_STATES: readonly MonitorDisplayState[] = [
  "scheduled",
  "retrying",
  "due-now",
  "overdue",
];

export function isWaitingMonitorState(state: MonitorDisplayState): boolean {
  return WAITING_STATES.includes(state);
}

export function hasVisibleMonitorSurface(issue: Issue): boolean {
  const derived = deriveMonitorState(issue);
  return isWaitingMonitorState(derived.state) && derived.nextCheckAt !== null;
}

export interface MonitorSurfaceCopy {
  /** Prominent lead for the top banner, e.g. "Waiting on monitor — resumes in 2h 12m". */
  bannerTitle: string;
  /** Prominent lead for the composer strip, e.g. "Resumes in 2h 12m". */
  stripTitle: string;
  /** Muted detail line for the banner (absolute time carries a "(your time)" hint). */
  bannerMeta: string[];
  /** Muted detail line for the composer strip. */
  stripMeta: string[];
  /** One-line lead for the minimized card; always carries the next-check time when there is one. */
  collapsedTitle: string;
  /** `warning` (amber) once overdue, `info` (blue) while still on schedule. */
  tone: "info" | "warning";
  workspaceWait?: boolean;
  pullRequestReview?: boolean;
  scheduledRetry?: boolean;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

/**
 * Pure copy builder shared by the banner and the composer strip so both
 * surfaces render one consistent copy system (see wireframe 04). Kept free of
 * hooks/`Date.now()` so it is deterministic under test.
 */
export function buildMonitorSurfaceCopy(
  derived: DerivedMonitorState,
  now: MonitorDate,
  scheduledRetryReason?: string | null,
  pendingPullRequestReviews = 0,
): MonitorSurfaceCopy | null {
  if (!isWaitingMonitorState(derived.state) || !derived.nextCheckAt) return null;

  if (derived.source === "scheduled-retry" && scheduledRetryReason === "workspace_busy") {
    return {
      bannerTitle: "Waiting for workspace",
      stripTitle: "Waiting for workspace",
      bannerMeta: ["Another task is using this workspace. Work starts automatically when it is available."],
      stripMeta: ["Work starts automatically when the workspace is available."],
      collapsedTitle: "Waiting for workspace",
      tone: "info",
      workspaceWait: true,
    };
  }

  const eta = formatMonitorEta(derived.nextCheckAt, now); // "in 2h 12m" | "due now" | "overdue by 18m"
  const absolute = formatMonitorAbsolute(derived.nextCheckAt, {}, now); // local time, e.g. "Today, 4:08 PM"
  if (derived.source === "monitor" && derived.serviceName?.toLowerCase() === "github" && pendingPullRequestReviews > 0) {
    return {
      bannerTitle: "Pull request review requested",
      stripTitle: "Pull request review requested",
      bannerMeta: [`Next check ${eta} · ${absolute} (your time)`],
      stripMeta: [`Next check ${eta} · ${absolute}`],
      collapsedTitle: `PR review · next check ${eta}`,
      tone: derived.state === "overdue" ? "warning" : "info",
      pullRequestReview: true,
    };
  }

  const isScheduledRetryOnly = derived.source === "scheduled-retry";

  let bannerTitle: string;
  let stripTitle: string;
  let statusHint: string | null = null;
  switch (derived.state) {
    case "scheduled":
    case "retrying":
      bannerTitle = isScheduledRetryOnly ? `Agent resumes ${eta}` : `Waiting on monitor — resumes ${eta}`;
      stripTitle = `Resumes ${eta}`;
      break;
    case "due-now":
      bannerTitle = isScheduledRetryOnly ? "Agent retry due now" : "Waiting on monitor — due now";
      stripTitle = "Due now";
      statusHint = "Checking momentarily…";
      break;
    case "overdue":
    default:
      bannerTitle = isScheduledRetryOnly ? `Agent retry ${eta}` : `Waiting on monitor — ${eta}`;
      stripTitle = capitalize(eta);
      statusHint = "Fires on next tick";
      break;
  }

  const attemptLabel = derived.attemptCount >= 1 ? `Attempt ${derived.attemptCount}` : null;
  const serviceLabel = derived.serviceName ? `Watching: ${derived.serviceName}` : null;

  const bannerMeta = [statusHint, `${absolute} (your time)`, attemptLabel, serviceLabel].filter(
    (piece): piece is string => Boolean(piece),
  );
  const stripMeta = [statusHint, absolute, attemptLabel, serviceLabel].filter(
    (piece): piece is string => Boolean(piece),
  );

  return {
    bannerTitle,
    stripTitle,
    bannerMeta,
    stripMeta,
    collapsedTitle: stripTitle,
    tone: derived.state === "overdue" ? "warning" : "info",
    scheduledRetry: isScheduledRetryOnly,
  };
}

function useMonitorSurfaceCopy(issue: Issue, pendingPullRequestReviews: number): MonitorSurfaceCopy | null {
  // `nextCheckAt` is stable for a given issue; derive once to seed the ticking
  // countdown cadence, then re-derive against the live clock so the surfaces
  // roll scheduled → due → overdue on their own.
  const nextCheckAt = useMemo(() => deriveMonitorState(issue).nextCheckAt, [issue]);
  const now = useMonitorCountdown(nextCheckAt);
  return useMemo(() => buildMonitorSurfaceCopy(deriveMonitorState(issue, now), now, issue.scheduledRetry?.scheduledRetryReason, pendingPullRequestReviews), [issue, now, pendingPullRequestReviews]);
}

const COLLAPSE_EVENT = "wardmote:issue-monitor-collapsed";

function collapseStorageKey(issueId: string): string {
  return `wardmote:issue-monitor-collapsed:${issueId}`;
}

function readStoredCollapse(issueId: string): boolean | null {
  try {
    const value = window.localStorage.getItem(collapseStorageKey(issueId));
    return value === null ? null : value === "1";
  } catch {
    return null;
  }
}

function subscribeStoredCollapse(listener: () => void): () => void {
  window.addEventListener(COLLAPSE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(COLLAPSE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

/** Per-task minimized state shared by the banner and the composer strip, remembered in localStorage. */
function useMonitorCollapsed(issueId: string | undefined, defaultCollapsed: boolean): [boolean, () => void] {
  const stored = useSyncExternalStore(
    subscribeStoredCollapse,
    () => (issueId ? readStoredCollapse(issueId) : null),
    () => null,
  );
  const [local, setLocal] = useState<boolean | null>(null);
  const collapsed = (issueId ? stored : local) ?? defaultCollapsed;
  const toggle = useCallback(() => {
    const next = !collapsed;
    if (!issueId) {
      setLocal(next);
      return;
    }
    try {
      window.localStorage.setItem(collapseStorageKey(issueId), next ? "1" : "0");
    } catch {
      setLocal(next);
    }
    window.dispatchEvent(new Event(COLLAPSE_EVENT));
  }, [collapsed, issueId]);
  return [collapsed, toggle];
}

function CollapseToggleButton({
  collapsed,
  onToggle,
  controlsId,
}: {
  collapsed: boolean;
  onToggle: () => void;
  controlsId: string;
}) {
  const label = collapsed ? "Expand monitor details" : "Minimize monitor details";
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="shrink-0"
      aria-expanded={!collapsed}
      aria-controls={collapsed ? undefined : controlsId}
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      {collapsed ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronUp className="h-4 w-4" aria-hidden="true" />}
    </Button>
  );
}

function CheckNowButton({
  onCheckNow,
  checkingNow,
  reviewRequested = false,
  retry = false,
  compact = false,
}: {
  onCheckNow: () => void;
  checkingNow: boolean;
  reviewRequested?: boolean;
  retry?: boolean;
  compact?: boolean;
}) {
  const idleLabel = retry ? "Retry now" : reviewRequested ? "Check status" : "Check now";
  return (
    <Button
      type="button"
      variant="secondary"
      size={compact ? "xs" : "sm"}
      className={cn("shrink-0 shadow-none", compact && "h-7")}
      onClick={onCheckNow}
      disabled={checkingNow}
      data-testid={retry ? "issue-wait-retry-now" : undefined}
    >
      {checkingNow ? (retry ? "Retrying…" : "Checking…") : idleLabel}
    </Button>
  );
}

function WaitActionButton({
  copy,
  onCheckNow,
  checkingNow,
  onRetryNow,
  retryingNow,
  compact = false,
}: {
  copy: MonitorSurfaceCopy;
  onCheckNow: (() => void) | null;
  checkingNow: boolean;
  onRetryNow: (() => void) | null;
  retryingNow: boolean;
  compact?: boolean;
}) {
  if (copy.workspaceWait) return null;
  if (copy.scheduledRetry) {
    return onRetryNow ? <CheckNowButton onCheckNow={onRetryNow} checkingNow={retryingNow} retry compact={compact} /> : null;
  }
  return onCheckNow ? <CheckNowButton onCheckNow={onCheckNow} checkingNow={checkingNow} reviewRequested={copy.pullRequestReview} compact={compact} /> : null;
}

function CancelMonitorButton({ onCancel }: { onCancel: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = async () => {
    setPending(true);
    setError(null);
    try {
      await onCancel();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to cancel the monitor. Try again.");
    } finally {
      setPending(false);
    }
  };
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!pending) { setOpen(next); setError(null); } }}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" className="shrink-0" aria-label="Cancel monitor" title="Cancel monitor">
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel monitor?</AlertDialogTitle>
          <AlertDialogDescription>This removes the scheduled monitor check. The agent will no longer resume from this monitor. You can send a message to continue the task.</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <p role="alert" className="text-sm text-bad">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Keep monitor</AlertDialogCancel>
          <Button type="button" variant="danger" disabled={pending} onClick={() => void cancel()}>{pending ? "Cancelling…" : "Cancel monitor"}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export interface IssueMonitorSurfaceProps {
  issue: Issue;
  onCheckNow?: (() => void) | null;
  checkingNow?: boolean;
  onRetryNow?: (() => void) | null;
  retryingNow?: boolean;
  retryError?: string | null;
  workProducts?: IssueWorkProduct[] | null;
  checkError?: string | null;
  onCancelMonitor?: (() => Promise<unknown>) | null;
  /** Initial minimized state until the reader toggles the card for this task. */
  defaultCollapsed?: boolean;
}

function CollapsedMonitorRow({
  copy,
  meta,
  action,
  toggle,
  trailing,
  actionError,
  className,
  testId,
}: {
  copy: MonitorSurfaceCopy;
  meta: string[];
  action: ReactNode;
  toggle: ReactNode;
  trailing?: ReactNode;
  actionError?: string | null;
  className?: string;
  testId: string;
}) {
  return (
    <div role="note" data-testid={testId} data-collapsed="" className={cn("rounded-lg border py-1 pl-3 pr-1", className)}>
      <div className="flex min-w-0 items-center gap-2">
        <Clock className="h-4 w-4 shrink-0 opacity-80" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={[copy.collapsedTitle, ...meta].join(" · ")}>
          {copy.collapsedTitle}
        </span>
        {action}
        {toggle}
        {trailing}
      </div>
      {actionError ? <p role="alert" className="pb-1 text-sm text-bad">{actionError}</p> : null}
    </div>
  );
}

/**
 * Pinned banner rendered between the issue title and description while a
 * monitor is waiting. Replaces the description-area "Monitor scheduled" card
 * for the waiting state (PAP-14557 decision 1) — the two never render at once.
 */
export function IssueMonitorBanner({
  issue,
  onCheckNow = null,
  checkingNow = false,
  onRetryNow = null,
  retryingNow = false,
  retryError,
  workProducts,
  checkError,
  onCancelMonitor,
  defaultCollapsed = false,
}: IssueMonitorSurfaceProps) {
  const detailsId = useId();
  const reviews = getIssuePullRequests(workProducts).filter(pullRequestNeedsReview);
  const copy = useMonitorSurfaceCopy(issue, reviews.length);
  const [collapsed, toggleCollapsed] = useMonitorCollapsed(issue.id, defaultCollapsed);
  if (!copy) return null;
  const actionError = copy.scheduledRetry ? retryError : checkError;

  const canCancel = onCancelMonitor && deriveMonitorState(issue).source === "monitor";
  const toggle = <CollapseToggleButton collapsed={collapsed} onToggle={toggleCollapsed} controlsId={detailsId} />;
  const cancel = canCancel ? <CancelMonitorButton key={issue.id} onCancel={onCancelMonitor} /> : null;

  if (collapsed) {
    return (
      <CollapsedMonitorRow
        testId="issue-monitor-banner"
        copy={copy}
        meta={copy.bannerMeta}
        className={cn("my-3", brandBanner[copy.tone])}
        action={<WaitActionButton copy={copy} onCheckNow={onCheckNow} checkingNow={checkingNow} onRetryNow={onRetryNow} retryingNow={retryingNow} compact />}
        toggle={toggle}
        trailing={cancel}
        actionError={actionError}
      />
    );
  }

  return (
    <div data-testid="issue-monitor-banner" className="my-3">
      <InlineBanner
        tone={copy.tone}
        icon={Clock}
        title={copy.bannerTitle}
        className={cn("relative", canCancel ? "pr-22" : "pr-12")}
        actions={<WaitActionButton copy={copy} onCheckNow={onCheckNow} checkingNow={checkingNow} onRetryNow={onRetryNow} retryingNow={retryingNow} />}
      >
        <div className="absolute right-2 top-2 flex items-center">
          {toggle}
          {cancel}
        </div>
        <div id={detailsId} className="flex flex-col gap-2">
          {copy.pullRequestReview ? <IssuePullRequestLinks products={reviews} /> : null}
          <span>{copy.bannerMeta.join("  ·  ")}</span>
          {actionError ? <p role="alert">{actionError}</p> : null}
        </div>
      </InlineBanner>
    </div>
  );
}

/**
 * Slim, inline (not sticky) strip anchored directly above the reply composer.
 * Mirrors the banner's monitor state and reminds the reader that replying wakes
 * the agent early (PAP-14557 decisions 2 + wireframe 02).
 */
export function IssueMonitorComposerStrip({
  issue,
  onCheckNow = null,
  checkingNow = false,
  onRetryNow = null,
  retryingNow = false,
  retryError,
  workProducts,
  checkError,
  className,
  defaultCollapsed = false,
}: IssueMonitorSurfaceProps & { className?: string }) {
  const detailsId = useId();
  const reviews = getIssuePullRequests(workProducts).filter(pullRequestNeedsReview);
  const copy = useMonitorSurfaceCopy(issue, reviews.length);
  const [collapsed, toggleCollapsed] = useMonitorCollapsed(issue.id, defaultCollapsed);
  if (!copy) return null;
  const actionError = copy.scheduledRetry ? retryError : checkError;
  const toggle = <CollapseToggleButton collapsed={collapsed} onToggle={toggleCollapsed} controlsId={detailsId} />;

  if (collapsed) {
    return (
      <CollapsedMonitorRow
        testId="issue-monitor-composer-strip"
        copy={copy}
        meta={copy.stripMeta}
        className={cn("border-line bg-[color-mix(in_oklab,var(--bg-3)_30%,var(--bg))] text-ink", className)}
        action={<WaitActionButton copy={copy} onCheckNow={onCheckNow} checkingNow={checkingNow} onRetryNow={onRetryNow} retryingNow={retryingNow} compact />}
        toggle={toggle}
        actionError={actionError}
      />
    );
  }

  return (
    <div
      role="note"
      data-testid="issue-monitor-composer-strip"
      className={cn("relative max-h-[40dvh] overflow-y-auto rounded-lg border border-line bg-[color-mix(in_oklab,var(--bg-3)_30%,var(--bg))] py-2 pl-3 pr-11", className)}
    >
      <div className="absolute right-1 top-1">{toggle}</div>
      <div id={detailsId}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-2">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
            <div className="flex min-w-0 flex-col gap-2">
              <div className="text-sm font-medium text-ink">{copy.stripTitle}</div>
              {copy.pullRequestReview ? <IssuePullRequestLinks products={reviews} /> : null}
              <div className="text-xs text-ink-3">{copy.stripMeta.join(" · ")}</div>
            </div>
          </div>
          <WaitActionButton copy={copy} onCheckNow={onCheckNow} checkingNow={checkingNow} onRetryNow={onRetryNow} retryingNow={retryingNow} />
        </div>
        <p className="mt-1.5 text-xs text-ink-3">
          {copy.pullRequestReview
            ? "Review on GitHub, then check status to have the agent verify the result."
            : copy.workspaceWait
            ? "You can keep sending instructions while the agent waits."
            : "Sending a reply wakes the agent now — before the scheduled check."}
        </p>
        {actionError ? <p role="alert" className="text-sm text-bad">{actionError}</p> : null}
      </div>
    </div>
  );
}
