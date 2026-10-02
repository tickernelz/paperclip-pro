import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlarmSmoke, Clock3, Coins, Inbox, KanbanSquare, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dashboardApi } from "@/api/dashboard";
import { routinesApi } from "@/api/routines";
import { queryKeys } from "@/lib/queryKeys";
import { relativeTime } from "@/lib/utils";
import { usePageVisibility } from "@/lib/page-visibility";
import type { OfficeObjectKind } from "@/lib/pixels-office/officeModel";
import type { TickerEntry } from "@/lib/pixels-office/live";
import { nextRoutineRun } from "./officeObjects";
import { UnassignedTray } from "./UnassignedTray";

const CLOCK_TICK_MS = 30_000;

interface OfficeHudProps {
  companyId: string;
  ticker: readonly TickerEntry[];
  canAssign: boolean;
  ambientEnabled: boolean;
  onToggleAmbient: (next: boolean) => void;
  onOpenObject: (object: OfficeObjectKind) => void;
}

function Chip({
  icon,
  label,
  value,
  tone,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone?: "alert";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        tone === "alert"
          ? "flex items-center gap-1.5 rounded-full border border-destructive/50 bg-destructive/10 px-3 py-1 text-xs text-foreground transition-colors hover:bg-destructive/20"
          : "flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground transition-colors hover:bg-accent/40"
      }
    >
      {icon}
      <span className="font-medium">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </button>
  );
}

export function OfficeHud({
  companyId,
  ticker,
  canAssign,
  ambientEnabled,
  onToggleAmbient,
  onOpenObject,
}: OfficeHudProps) {
  const visibility = usePageVisibility();
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    if (!visibility.visible) return;
    setClock(new Date());
    const timer = setInterval(() => setClock(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [visibility.visible]);

  const { data: summary } = useQuery({
    queryKey: queryKeys.dashboard(companyId),
    queryFn: () => dashboardApi.summary(companyId),
  });
  const { data: routines } = useQuery({
    queryKey: queryKeys.routines.list(companyId),
    queryFn: () => routinesApi.list(companyId),
  });

  const next = useMemo(() => nextRoutineRun(routines ?? []), [routines]);
  const latest = ticker.length > 0 ? ticker[ticker.length - 1] : null;
  const spend = summary ? (summary.costs.monthSpendCents / 100).toFixed(0) : "0";
  const budget = summary ? (summary.costs.monthBudgetCents / 100).toFixed(0) : "0";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Chip
          icon={<KanbanSquare className="size-3.5" aria-hidden />}
          value={String(summary?.agents.running ?? 0)}
          label="running"
          onClick={() => onOpenObject("kanban")}
        />
        <Chip
          icon={<KanbanSquare className="size-3.5" aria-hidden />}
          value={String(summary?.tasks.open ?? 0)}
          label="open"
          onClick={() => onOpenObject("kanban")}
        />
        <Chip
          icon={<AlarmSmoke className="size-3.5" aria-hidden />}
          value={String(summary?.tasks.blocked ?? 0)}
          label="blocked"
          tone={(summary?.tasks.blocked ?? 0) > 0 ? "alert" : undefined}
          onClick={() => onOpenObject("alarm")}
        />
        <Chip
          icon={<Inbox className="size-3.5" aria-hidden />}
          value={String(summary?.pendingApprovals ?? 0)}
          label="approvals"
          tone={(summary?.pendingApprovals ?? 0) > 0 ? "alert" : undefined}
          onClick={() => onOpenObject("mailbox")}
        />
        <Chip
          icon={<Coins className="size-3.5" aria-hidden />}
          value={`$${spend}/$${budget}`}
          label="this month"
          onClick={() => onOpenObject("coins")}
        />
        <Chip
          icon={<Clock3 className="size-3.5" aria-hidden />}
          value={clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          label={next ? `next ${relativeTime(new Date(next.atMs))}` : "no routine queued"}
          onClick={() => onOpenObject("clock")}
        />
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={ambientEnabled}
          aria-label={ambientEnabled ? "Mute office sound" : "Unmute office sound"}
          onClick={() => onToggleAmbient(!ambientEnabled)}
        >
          {ambientEnabled ? (
            <Volume2 className="size-4" aria-hidden />
          ) : (
            <VolumeX className="size-4" aria-hidden />
          )}
        </Button>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <UnassignedTray companyId={companyId} canAssign={canAssign} />
        <p
          aria-live="polite"
          className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground"
        >
          {latest ? `${latest.text} · ${relativeTime(new Date(latest.atMs))}` : "No activity yet."}
        </p>
      </div>
    </div>
  );
}
