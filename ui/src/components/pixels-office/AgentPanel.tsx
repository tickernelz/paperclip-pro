import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, Pause, Play, Zap } from "lucide-react";
import type { Agent, PixelsOfficeAgent } from "@tickernelz/paperclip-pro-shared";
import { Link } from "@/lib/router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { agentsApi } from "@/api/agents";
import { attentionApi } from "@/api/attention";
import { accessApi } from "@/api/access";
import { queryKeys } from "@/lib/queryKeys";
import { relativeTime } from "@/lib/utils";
import { canBoardAssignIssues } from "@/lib/pixels-office/live";
import type { AgentVisual } from "@/lib/pixels-office/officeModel";
import { AttentionInteractionResolver } from "@/components/AttentionInteractionResolver";
import { OfficePanelShell } from "./OfficePanelShell";

const STATUS_LABELS: Record<AgentVisual["status"], string> = {
  running: "Running",
  queued: "Queued",
  idle: "Idle",
  paused: "Paused",
  error: "Error",
  pending_approval: "Waiting on a person",
  awaiting_board: "Waiting on the board",
  budget_paused: "Budget stop",
};

const STATUS_TONE: Record<AgentVisual["status"], "default" | "secondary" | "outline" | "destructive"> = {
  running: "default",
  queued: "secondary",
  idle: "outline",
  paused: "secondary",
  error: "destructive",
  pending_approval: "secondary",
  awaiting_board: "secondary",
  budget_paused: "destructive",
};

interface AgentPanelProps {
  companyId: string;
  agent: PixelsOfficeAgent;
  visual: AgentVisual | null;
  onClose: () => void;
}

export function AgentPanel({ companyId, agent, visual, onClose }: AgentPanelProps) {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: boardAccess } = useQuery({
    queryKey: queryKeys.access.currentBoardAccess,
    queryFn: () => accessApi.getCurrentBoardAccess(),
    retry: false,
  });
  const canAct = canBoardAssignIssues(companyId, boardAccess);

  const { data: attention } = useQuery({
    queryKey: queryKeys.attention(companyId),
    queryFn: () => attentionApi.list(companyId, { limit: 50 }),
    enabled: agent.pendingInteractionCount > 0 || agent.awaitingBoardCount > 0,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
  });

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const entry of agents ?? []) map.set(entry.id, entry);
    return map;
  }, [agents]);

  const pendingInteractions = useMemo(
    () =>
      (attention?.items ?? []).filter(
        (item) =>
          item.sourceKind === "issue_thread_interaction" &&
          (item.resolverAudience?.createdByAgentId === agent.id ||
            item.resolverAudience?.addresseeAgentId === agent.id),
      ),
    [attention, agent.id],
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.pixelsOffice.snapshot(companyId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.attention(companyId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) });
  };

  const action = useMutation<unknown, Error, "wake" | "pause" | "resume">({
    mutationFn: (kind) => {
      if (kind === "pause") return agentsApi.pause(agent.id, companyId);
      if (kind === "resume") return agentsApi.resume(agent.id, companyId);
      return agentsApi.wakeup(agent.id, { source: "on_demand", triggerDetail: "manual" }, companyId);
    },
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (cause: unknown) => {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    },
  });

  const status = visual?.status ?? "idle";
  const activity = visual?.activity ?? null;
  const paused = agent.status === "paused";

  return (
    <OfficePanelShell
      title={agent.name}
      subtitle={agent.title ?? agent.role}
      onClose={onClose}
      headerExtra={<Badge variant={STATUS_TONE[status]}>{STATUS_LABELS[status]}</Badge>}
    >
      <ScrollArea className="h-full">
        <div className="space-y-4 p-4">
          {activity?.message ? (
            <div className="rounded-md border border-border bg-muted/40 p-3">
              <p className="text-sm text-foreground">{activity.message}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {activity.updatedAtMs > 0
                  ? relativeTime(new Date(activity.updatedAtMs))
                  : "No timestamp"}
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {canAct ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={action.isPending}
                  onClick={() => action.mutate("wake")}
                >
                  {action.isPending && action.variables === "wake" ? (
                    <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
                  ) : (
                    <Zap className="size-4" aria-hidden />
                  )}
                  Wake
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={action.isPending}
                  onClick={() => action.mutate(paused ? "resume" : "pause")}
                >
                  {paused ? (
                    <Play className="size-4" aria-hidden />
                  ) : (
                    <Pause className="size-4" aria-hidden />
                  )}
                  {paused ? "Resume" : "Pause"}
                </Button>
              </>
            ) : null}
            <Button size="sm" variant="ghost" asChild>
              <Link to={`/agents/${agent.id}`}>
                <ExternalLink className="size-4" aria-hidden />
                Agent page
              </Link>
            </Button>
          </div>

          {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-(--tracking-eyebrow) text-muted-foreground">
              Tasks · {agent.activeTaskCount} active / {agent.queuedTaskCount} queued
            </h3>
            {agent.tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No open tasks.</p>
            ) : (
              <ul className="space-y-1">
                {agent.tasks.map((task) => (
                  <li key={task.issueId}>
                    <Link
                      to={`/issues/${task.identifier}`}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/40"
                    >
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {task.identifier}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-foreground">{task.title}</span>
                      {task.runStatus ? (
                        <Badge variant="secondary">{task.runStatus}</Badge>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {pendingInteractions.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-(--tracking-eyebrow) text-muted-foreground">
                Waiting on a decision
              </h3>
              {pendingInteractions.map((item) => (
                <AttentionInteractionResolver
                  key={item.id}
                  companyId={companyId}
                  issueId={item.relatedIssue?.id ?? item.subject.id}
                  interactionId={item.subject.id}
                  agentMap={agentMap}
                  onResolved={invalidate}
                />
              ))}
            </section>
          ) : null}
        </div>
      </ScrollArea>
    </OfficePanelShell>
  );
}
