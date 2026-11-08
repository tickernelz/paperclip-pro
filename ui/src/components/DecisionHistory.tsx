import { useInfiniteQuery } from "@tanstack/react-query";
import { DECISION_HISTORY_SOURCE_KINDS } from "@tickernelz/paperclip-pro-shared";
import type {
  Agent,
  AttentionSourceKind,
  ResolvedDecisionEntry,
  ResolvedDecisionSourceKind,
  ResolvedDecisionStatus,
} from "@tickernelz/paperclip-pro-shared";
import { Link } from "@/lib/router";
import { decisionQueuesApi } from "../api/decisionQueues";
import type { AttentionActivityBounds, AttentionFilterOptions } from "../lib/attention";
import { sourceMeta } from "../lib/attention";
import { queryKeys } from "../lib/queryKeys";
import { timeAgo } from "../lib/timeAgo";
import { Curtain } from "./DecisionShelf";
import { Button } from "./ui/button";

const HISTORY_KINDS = new Set<AttentionSourceKind>(DECISION_HISTORY_SOURCE_KINDS);

const SECTION_COPY: Record<ResolvedDecisionStatus, { label: string; empty: string; filtered: string }> = {
  decided: {
    label: "Decided",
    empty: "Nothing decided yet. Answered questions, confirmations, and approvals land here.",
    filtered: "Nothing decided matches these filters. Clear them to see the full history.",
  },
  expired: {
    label: "Expired",
    empty: "Nothing expired. Requests that lapse or are withdrawn before a decision land here.",
    filtered: "Nothing expired matches these filters. Clear them to see the full history.",
  },
};

/** History kinds selected by the toolbar filter; null when the filter excludes every history kind. */
export function historySourceKinds(selected: AttentionSourceKind[]): ResolvedDecisionSourceKind[] | null | undefined {
  if (selected.length === 0) return undefined;
  const kinds = selected.filter((kind): kind is ResolvedDecisionSourceKind => HISTORY_KINDS.has(kind));
  return kinds.length > 0 ? kinds : null;
}

export function withHistorySourceKinds(options: AttentionFilterOptions): AttentionFilterOptions {
  const kinds = new Set<AttentionSourceKind>([...options.sourceKinds, ...DECISION_HISTORY_SOURCE_KINDS]);
  return {
    ...options,
    sourceKinds: [...kinds].sort((a, b) => sourceMeta(a).label.localeCompare(sourceMeta(b).label)),
  };
}

export function deciderName(entry: ResolvedDecisionEntry, agentMap: Map<string, Agent>) {
  if (entry.decidedBy.name) return entry.decidedBy.name;
  if (entry.decidedBy.type === "agent") {
    return (entry.decidedBy.agentId ? agentMap.get(entry.decidedBy.agentId)?.name : null) ?? "An agent";
  }
  return entry.decidedBy.type === "user" ? "A board member" : "System";
}

export function DecisionHistoryRow({ entry, agentMap }: { entry: ResolvedDecisionEntry; agentMap: Map<string, Agent> }) {
  return (
    <li className="space-y-1 rounded-lg border border-line px-3 py-2" data-decision-history-row={entry.outcome}>
      <div className="flex items-start justify-between gap-3">
        {entry.href ? (
          <Link to={entry.href} className="min-w-0 text-sm font-medium text-ink hover:underline">
            {entry.title}
          </Link>
        ) : (
          <span className="min-w-0 text-sm font-medium text-ink">{entry.title}</span>
        )}
        <time
          dateTime={entry.decidedAt}
          title={new Date(entry.decidedAt).toLocaleString()}
          className="shrink-0 text-xs tabular-nums text-ink-3"
        >
          {timeAgo(entry.decidedAt)}
        </time>
      </div>
      <p className="flex flex-wrap gap-x-1.5 text-xs text-ink-3">
        <span>{entry.kindLabel}</span>
        <span aria-hidden>·</span>
        <span>{deciderName(entry, agentMap)}</span>
        {entry.issue?.identifier && (
          <>
            <span aria-hidden>·</span>
            <span>{entry.issue.identifier}</span>
          </>
        )}
      </p>
      {entry.result && <p className="break-words text-xs text-ink-2">{entry.result}</p>}
    </li>
  );
}

function HistorySection({
  companyId,
  status,
  queueKey,
  sourceKinds,
  bounds,
  filtered,
  agentMap,
  open,
  onToggle,
}: {
  companyId: string;
  status: ResolvedDecisionStatus;
  queueKey: string | null;
  sourceKinds: ResolvedDecisionSourceKind[] | null | undefined;
  bounds: AttentionActivityBounds;
  filtered: boolean;
  agentMap: Map<string, Agent>;
  open: boolean;
  onToggle: () => void;
}) {
  const excluded = sourceKinds === null;
  const history = useInfiniteQuery({
    queryKey: queryKeys.decisionHistory(companyId, {
      status,
      queueKey,
      sourceKinds: sourceKinds ?? [],
      activitySince: bounds.activitySince ?? null,
      activityUntil: bounds.activityUntil ?? null,
    }),
    queryFn: ({ pageParam }) => decisionQueuesApi.history(companyId, {
      status,
      queue: queueKey,
      sourceKinds: sourceKinds ?? undefined,
      ...bounds,
      cursor: pageParam,
    }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled: open && !excluded,
    refetchOnWindowFocus: false,
  });
  const copy = SECTION_COPY[status];
  const entries = history.data?.pages.flatMap((page) => page.items) ?? [];
  const total = excluded ? 0 : history.data?.pages[0]?.totalCount ?? undefined;
  return (
    <Curtain label={copy.label} count={total} open={open} onToggle={onToggle}>
      {history.isLoading ? (
        <p className="text-xs text-ink-3">Loading {copy.label.toLowerCase()} decisions…</p>
      ) : history.error ? (
        <p className="text-xs text-bad">{(history.error as Error).message}</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-ink-3">{filtered || excluded ? copy.filtered : copy.empty}</p>
      ) : (
        <div className="space-y-2">
          <ul className="space-y-2">
            {entries.map((entry) => (
              <DecisionHistoryRow key={entry.id} entry={entry} agentMap={agentMap} />
            ))}
          </ul>
          {history.hasNextPage && (
            <Button
              variant="secondary"
              size="sm"
              disabled={history.isFetchingNextPage}
              onClick={() => void history.fetchNextPage()}
            >
              {history.isFetchingNextPage ? "Loading…" : "Load older"}
            </Button>
          )}
        </div>
      )}
    </Curtain>
  );
}

export function DecisionHistorySections({
  companyId,
  queueKey = null,
  selectedSourceKinds,
  bounds,
  agentMap,
  decidedOpen,
  expiredOpen,
  onToggleDecided,
  onToggleExpired,
}: {
  companyId: string;
  queueKey?: string | null;
  selectedSourceKinds: AttentionSourceKind[];
  bounds: AttentionActivityBounds;
  agentMap: Map<string, Agent>;
  decidedOpen: boolean;
  expiredOpen: boolean;
  onToggleDecided: () => void;
  onToggleExpired: () => void;
}) {
  const sourceKinds = historySourceKinds(selectedSourceKinds);
  const filtered = selectedSourceKinds.length > 0 || Boolean(bounds.activitySince || bounds.activityUntil);
  const shared = { companyId, queueKey, sourceKinds, bounds, filtered, agentMap };
  return (
    <div className="space-y-4" id="decision-history">
      <HistorySection {...shared} status="decided" open={decidedOpen} onToggle={onToggleDecided} />
      <HistorySection {...shared} status="expired" open={expiredOpen} onToggle={onToggleExpired} />
    </div>
  );
}
