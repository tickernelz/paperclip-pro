import { useMemo, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import type { SummarySlotIssueRef } from "@tickernelz/wardmote-shared";
import { AlertTriangle, ExternalLink, Loader2, MoreHorizontal, PauseCircle, RefreshCw, Wand2 } from "lucide-react";

import { MarkdownBody } from "@/components/MarkdownBody";
import { useSummaryDraftStream } from "@/components/useSummaryDraftStream";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createIssueDetailPath } from "@/lib/issueDetailBreadcrumb";
import { cn, relativeTime } from "@/lib/utils";
import {
  deriveStatusCardLifecycle,
  describeRefreshPolicy,
  STATUS_CARD_LIFECYCLE_PRESENTATION,
} from "@/lib/status-card-state";
import { formatCents, formatTokens } from "./format";
import type { StatusCardView } from "./types";

export interface StatusCardTileProps {
  card: StatusCardView;
  companyId: string | null | undefined;
  onOpen: () => void;
  onRefresh: () => void;
  onRecompile: () => void;
  onEditInterest: () => void;
  onOpenDebug: () => void;
  onArchive: () => void;
  refreshPending?: boolean;
  recompilePending?: boolean;
}

function StateDot({ className }: { className: string }) {
  return <span className={cn("mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full", className)} aria-hidden="true" />;
}

/** Stop a nested control's click from also triggering the card-open handler. */
function stopClick(handler: () => void) {
  return (event: MouseEvent) => {
    event.stopPropagation();
    handler();
  };
}

export function StatusCardTile({
  card,
  companyId,
  onOpen,
  onRefresh,
  onRecompile,
  onEditInterest,
  onOpenDebug,
  onArchive,
  refreshPending,
  recompilePending,
}: StatusCardTileProps) {
  const lifecycle = deriveStatusCardLifecycle(card);
  const presentation = STATUS_CARD_LIFECYCLE_PRESENTATION[lifecycle];
  // A setup run is actually in flight when the card is compiling AND has a
  // generation task. When it's null the first run stalled/died and the card
  // needs a manual re-kick — the only case where "Run now" is offered.
  const setupRunning = lifecycle === "compiling" && Boolean(card.generatingIssueId);

  // Stream the in-flight update into the delta banner (reuses the Summarizer
  // draft-stream machinery). Inert unless the card is actively updating.
  const generatingIssue = useMemo<SummarySlotIssueRef | null>(
    () =>
      lifecycle === "updating" && card.generatingIssueId
        ? { id: card.generatingIssueId, identifier: null, title: card.title ?? "Status update", status: "in_progress" }
        : null,
    [lifecycle, card.generatingIssueId, card.title],
  );
  const draftStream = useSummaryDraftStream(companyId, generatingIssue);

  const policyLabel = describeRefreshPolicy(card.refreshPolicy);
  const tokensLabel = formatTokens(card.todayTokens);
  const costLabel = formatCents(card.todayCostCents);
  const freshnessLabel = card.lastGeneratedAt ? relativeTime(card.lastGeneratedAt) : "no summary yet";
  const hasSummary = Boolean(card.summaryBody && card.summaryBody.trim().length > 0);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "group flex h-72 cursor-pointer flex-col rounded-lg border border-line bg-bg-2 text-ink transition-colors hover:border-ink-3/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
        presentation.dashedBorder && "border-dashed",
      )}
      data-testid="status-card-tile"
      data-lifecycle={lifecycle}
    >
      {/* Header */}
      <div className="flex items-start gap-2 px-4 pt-4">
        {lifecycle === "compiling" ? null : <StateDot className={presentation.dotClassName} />}
        <span
          className={cn(
            "line-clamp-1 min-w-0 flex-1 text-sm font-semibold",
            lifecycle === "compiling" && "text-ink-3",
          )}
          title={card.title ?? card.interestPrompt}
        >
          {card.title ?? "New card"}
        </span>
        <div onClick={(event) => event.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="-mr-1 -mt-1 h-7 w-7" aria-label="Card actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onOpen}>Open detail</DropdownMenuItem>
              <DropdownMenuItem onSelect={onRefresh} disabled={refreshPending || lifecycle === "updating"}>
                Refresh now
              </DropdownMenuItem>
              {(lifecycle === "compiling" && !setupRunning) || lifecycle === "error" ? (
                <DropdownMenuItem onSelect={onRecompile} disabled={recompilePending}>
                  Run now
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={onEditInterest}>Edit interest &amp; settings</DropdownMenuItem>
              <DropdownMenuItem onSelect={onOpenDebug}>Query debug</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onArchive} variant="destructive">
                Archive
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* State banner */}
      <div className="px-4 pt-2">
        {lifecycle === "compiling" ? (
          <div className="rounded-md bg-bg-3 px-3 py-2 text-xs text-ink" role="status" aria-live="polite">
            <div className="flex items-center gap-2">
              {setupRunning ? (
                // A live spinner (not a fading pulse) so the in-flight setup
                // reads as actual progress.
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-ink-3" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              )}
              <span>{setupRunning ? "Setting up your card…" : "Setup didn’t finish"}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-ink-3">“{card.interestPrompt}”</p>
            {setupRunning ? (
              // The setup run is live — link to the task instead of offering
              // "Run now", which would kick a duplicate run and race it.
              <Link
                to={`/issues/${card.generatingIssueId}`}
                onClick={(event) => event.stopPropagation()}
                className="mt-2 inline-flex items-center gap-1.5 font-medium text-ink underline-offset-2 hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                View setup task
              </Link>
            ) : (
              // The first run stalled (agent run died mid-setup) and the card
              // can sit here forever, so offer a manual re-kick.
              <button
                type="button"
                onClick={stopClick(onRecompile)}
                disabled={recompilePending}
                className="mt-2 inline-flex items-center gap-1.5 font-medium text-ink underline-offset-2 hover:underline disabled:opacity-60"
              >
                <Wand2 className={cn("h-3.5 w-3.5", recompilePending && "animate-pulse")} />
                {recompilePending ? "Starting…" : "Run now"}
              </button>
            )}
          </div>
        ) : null}

        {lifecycle === "updating" ? (
          <div className="rounded-md bg-bg-3 px-3 py-2 text-xs text-ink" role="status" aria-live="polite">
            <div className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-ink-3" />
              <span className="min-w-0 flex-1 truncate" title={draftStream.statusLine ?? undefined}>
                {draftStream.statusLine
                  ?? (card.pendingChangeCount > 0
                    ? `Integrating ${card.pendingChangeCount} ${card.pendingChangeCount === 1 ? "change" : "changes"}…`
                    : "Updating now…")}
              </span>
              {card.generatingIssueId ? (
                <Link
                  to={createIssueDetailPath(card.generatingIssueId)}
                  onClick={(event) => event.stopPropagation()}
                  className="inline-flex shrink-0 items-center gap-1 font-medium underline-offset-2 hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  View update task
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}

        {lifecycle === "stale" ? (
          <button
            type="button"
            onClick={stopClick(onRefresh)}
            disabled={refreshPending}
            className="flex w-full items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-1.5 text-left text-xs text-ink transition-colors hover:bg-amber-500/10 disabled:opacity-60"
          >
            <span>
              {card.pendingChangeCount} {card.pendingChangeCount === 1 ? "change" : "changes"} since last update
            </span>
            <span className="shrink-0 font-medium text-amber-700 dark:text-amber-400">Refresh</span>
          </button>
        ) : null}

        {lifecycle === "error" ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-bad/40 bg-bad/5 px-3 py-1.5 text-xs">
            <span className="flex items-center gap-1.5 text-bad">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Last update failed
            </span>
            <span className="flex shrink-0 items-center gap-3">
              <button type="button" onClick={stopClick(onRefresh)} disabled={refreshPending} className="font-medium text-bad hover:underline disabled:opacity-60">
                Retry
              </button>
              <button type="button" onClick={stopClick(onOpen)} className="text-ink-3 hover:underline">
                Details
              </button>
            </span>
          </div>
        ) : null}

        {lifecycle === "paused_budget" || lifecycle === "paused_hours" ? (
          <div className="flex items-center gap-2 rounded-md border border-orange-500/40 bg-orange-500/5 px-3 py-1.5 text-xs text-ink">
            <PauseCircle className="h-3.5 w-3.5 shrink-0 text-orange-500" />
            <span>
              {lifecycle === "paused_budget"
                ? "Daily token cap reached — auto-updates paused"
                : "Outside active hours — auto-updates paused"}
            </span>
          </div>
        ) : null}
      </div>

      {/* Summary body — kept visible for stale/error/updating/paused (never blank) */}
      <div className="min-h-0 flex-1 overflow-hidden px-4 pt-2">
        {lifecycle === "error" && card.summaryBody ? (
          <p className="mb-1 text-(length:--text-micro) text-ink-3">Showing last good summary:</p>
        ) : null}
        {hasSummary ? (
          <MarkdownBody className="text-xs leading-6 text-ink [&_p]:my-0.5">{card.summaryBody!}</MarkdownBody>
        ) : lifecycle === "compiling" ? (
          <p className="text-xs text-ink-3">
            You can add instructions and pick an update policy while this runs.
          </p>
        ) : lifecycle === "updating" && draftStream.draft ? (
          <MarkdownBody className="text-xs leading-6 text-ink [&_p]:my-0.5">{draftStream.draft}</MarkdownBody>
        ) : (
          <p className="text-xs text-ink-3">No summary yet.</p>
        )}
      </div>

      {/* Footer */}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-line px-4 py-2.5">
        <span className="truncate text-(length:--text-micro) text-ink-3">
          {lifecycle === "compiling" ? (
            "setting up · first summary pending"
          ) : (
            <>
              {freshnessLabel} · {policyLabel}
              {tokensLabel ? ` · ${tokensLabel}` : ""}
              {costLabel ? ` · ${costLabel}` : ""}
            </>
          )}
        </span>
        {/* Stale and error tiles already carry an inline Refresh/Retry action in
            their banner, so the footer icon is only shown for states that have
            no other refresh affordance (fresh + both paused states). */}
        {lifecycle === "fresh" || lifecycle === "paused_budget" || lifecycle === "paused_hours" ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={stopClick(onRefresh)}
            disabled={refreshPending}
            aria-label="Refresh card"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshPending && "animate-spin")} />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
