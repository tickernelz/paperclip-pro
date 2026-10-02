import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { HeartbeatRun } from "@tickernelz/paperclip-pro-shared";
import { Link } from "@/lib/router";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { attentionApi } from "@/api/attention";
import { budgetsApi } from "@/api/budgets";
import { dashboardApi } from "@/api/dashboard";
import { heartbeatsApi } from "@/api/heartbeats";
import { pipelinesApi } from "@/api/pipelines";
import { routinesApi } from "@/api/routines";
import { queryKeys } from "@/lib/queryKeys";
import { relativeTime } from "@/lib/utils";
import type { OfficeObjectKind } from "@/lib/pixels-office/officeModel";
import { OFFICE_OBJECT_LABELS, nextRoutineRun } from "./officeObjects";
import { OfficePanelShell } from "./OfficePanelShell";

const FAILED_RUN_STATUSES: Record<string, true> = { failed: true, timed_out: true };

interface ObjectPanelProps {
  companyId: string;
  object: OfficeObjectKind;
  onClose: () => void;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

function KanbanBody({ companyId }: { companyId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.pipelines.list(companyId),
    queryFn: () => pipelinesApi.list(companyId),
  });
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading pipelines…</p>;
  const pipelines = (data ?? []).filter((pipeline) => !pipeline.archivedAt);
  if (pipelines.length === 0) {
    return <p className="text-sm text-muted-foreground">No pipelines yet.</p>;
  }
  return (
    <ul className="space-y-2">
      {pipelines.map((pipeline) => (
        <li key={pipeline.id} className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <Link to={`/pipelines/${pipeline.id}`} className="truncate text-sm font-medium text-foreground hover:underline">
              {pipeline.name}
            </Link>
            <Badge variant="outline">{pipeline.stageCount} stages</Badge>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {pipeline.openCaseCount} open
            {typeof pipeline.inMotionCount === "number" ? ` · ${pipeline.inMotionCount} in motion` : ""}
            {typeof pipeline.attentionCount === "number" ? ` · ${pipeline.attentionCount} need attention` : ""}
          </div>
        </li>
      ))}
    </ul>
  );
}

function MailboxBody({ companyId }: { companyId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.attention(companyId),
    queryFn: () => attentionApi.list(companyId, { limit: 20 }),
  });
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading decisions…</p>;
  const items = data?.items ?? [];
  if (items.length === 0) return <p className="text-sm text-muted-foreground">Nothing is waiting.</p>;
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.id} className="rounded-md border border-border p-3">
          <div className="flex items-start justify-between gap-2">
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">
              {item.subject.title ?? item.whyNow}
            </span>
            <Badge variant={item.severity === "critical" ? "destructive" : "secondary"}>
              {item.severity}
            </Badge>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span>{item.sourceKind.replaceAll("_", " ")}</span>
            <span>·</span>
            <span>{relativeTime(item.activityAt)}</span>
            {item.relatedIssue?.identifier ? (
              <Link to={`/issues/${item.relatedIssue.identifier}`} className="font-mono hover:underline">
                {item.relatedIssue.identifier}
              </Link>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function ClockBody({ companyId }: { companyId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.routines.list(companyId),
    queryFn: () => routinesApi.list(companyId),
  });
  const routines = data ?? [];
  const next = useMemo(() => nextRoutineRun(routines), [routines]);
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading routines…</p>;
  return (
    <div className="space-y-3">
      <Row label="Local time" value={new Date().toLocaleTimeString()} />
      {next ? (
        <div className="rounded-md border border-border p-3">
          <p className="text-xs uppercase tracking-(--tracking-eyebrow) text-muted-foreground">Next run</p>
          <Link to={`/routines/${next.routineId}`} className="text-sm font-medium text-foreground hover:underline">
            {next.routineName}
          </Link>
          <p className="text-xs text-muted-foreground">{relativeTime(new Date(next.atMs))}</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No scheduled routine run.</p>
      )}
      <ul className="space-y-1">
        {routines.slice(0, 12).map((routine) => (
          <li key={routine.id} className="flex items-center justify-between gap-2 text-sm">
            <Link to={`/routines/${routine.id}`} className="min-w-0 truncate text-foreground hover:underline">
              {routine.title}
            </Link>
            <span className="shrink-0 text-xs text-muted-foreground">
              {routine.lastRun ? relativeTime(routine.lastRun.createdAt) : "never run"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CoinsBody({ companyId }: { companyId: string }) {
  const { data: summary } = useQuery({
    queryKey: queryKeys.dashboard(companyId),
    queryFn: () => dashboardApi.summary(companyId),
  });
  const { data: budgets } = useQuery({
    queryKey: queryKeys.budgets.overview(companyId),
    queryFn: () => budgetsApi.overview(companyId),
  });
  if (!summary) return <p className="text-sm text-muted-foreground">Loading costs…</p>;
  return (
    <div className="space-y-3">
      <Row label="Spent this month" value={formatCents(summary.costs.monthSpendCents)} />
      <Row label="Budget" value={formatCents(summary.costs.monthBudgetCents)} />
      <Row label="Utilisation" value={`${summary.costs.monthUtilizationPercent}%`} />
      <Row label="Active budget incidents" value={String(summary.budgets.activeIncidents)} />
      <Row label="Paused by budget" value={`${summary.budgets.pausedAgents} agents · ${summary.budgets.pausedProjects} projects`} />
      {budgets ? (
        <Link to="/budgets" className="block text-sm text-primary hover:underline">
          Budget settings
        </Link>
      ) : null}
    </div>
  );
}

function AlarmBody({ companyId }: { companyId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.heartbeats(companyId),
    queryFn: () => heartbeatsApi.list(companyId, undefined, 50, { summary: true }),
  });
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading runs…</p>;
  const failed = (data ?? []).filter((run: HeartbeatRun) => FAILED_RUN_STATUSES[run.status]).slice(0, 10);
  if (failed.length === 0) return <p className="text-sm text-muted-foreground">No recent failures.</p>;
  return (
    <ul className="space-y-2">
      {failed.map((run) => (
        <li key={run.id} className="rounded-md border border-border p-3">
          <Link
            to={`/agents/${run.agentId}/runs/${run.id}`}
            className="flex items-center justify-between gap-2 text-sm text-foreground hover:underline"
          >
            <span className="min-w-0 truncate font-mono">{run.agentId.slice(0, 8)}</span>
            <Badge variant="destructive">{run.status}</Badge>
          </Link>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {run.error ?? run.errorCode ?? "No error text"}
            {run.finishedAt ? ` · ${relativeTime(run.finishedAt)}` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function ObjectPanel({ companyId, object, onClose }: ObjectPanelProps) {
  return (
    <OfficePanelShell title={OFFICE_OBJECT_LABELS[object]} onClose={onClose}>
      <ScrollArea className="h-full">
        <div className="p-4">
          {object === "kanban" ? <KanbanBody companyId={companyId} /> : null}
          {object === "mailbox" ? <MailboxBody companyId={companyId} /> : null}
          {object === "clock" ? <ClockBody companyId={companyId} /> : null}
          {object === "coins" ? <CoinsBody companyId={companyId} /> : null}
          {object === "alarm" ? <AlarmBody companyId={companyId} /> : null}
        </div>
      </ScrollArea>
    </OfficePanelShell>
  );
}
