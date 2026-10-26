import { ListTodo } from "lucide-react";
import { AgentTodoFocusLine } from "@/components/AgentTodoCard";
import { useIssueAgentTodo } from "@/hooks/useIssueAgentTodo";
import { cn } from "@/lib/utils";

/** One compact line with the live run's current todo and its progress; renders nothing without a todo from one of those runs. */
export function LiveNowTodoLine({
  issueId,
  runIds,
  className = "mx-3 mt-1.5",
}: {
  issueId: string;
  runIds: readonly string[];
  className?: string;
}) {
  const { data: snapshot } = useIssueAgentTodo(issueId);
  if (!snapshot || !runIds.includes(snapshot.runId)) return null;
  return (
    <div
      data-slot="tasks-live-now-todo"
      className={cn("flex h-5 min-w-0 items-center gap-1.5 text-xs text-muted-foreground", className)}
      role="group"
      aria-label="Agent todo"
    >
      <ListTodo aria-hidden className="size-3.5 shrink-0" />
      <AgentTodoFocusLine snapshot={snapshot} className="flex-1 text-xs text-foreground" />
      <span className="shrink-0 font-medium tabular-nums">{`${snapshot.counts.completed}/${snapshot.counts.total}`}</span>
    </div>
  );
}
