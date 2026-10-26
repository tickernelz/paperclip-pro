import { ListTodo, Loader2 } from "lucide-react";
import { AgentTodoList, AgentTodoProgress } from "@/components/AgentTodoCard";
import { useIssueAgentTodo } from "@/hooks/useIssueAgentTodo";

export function TaskAgentTodoPanel({ issueId }: { issueId: string }) {
  const query = useIssueAgentTodo(issueId);
  if (query.isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Loading agent todo…
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="py-8 text-sm text-muted-foreground" role="alert">
        The agent todo could not be loaded. Refresh the task to try again.
      </div>
    );
  }
  const snapshot = query.data;
  if (!snapshot) {
    return (
      <div className="flex items-start gap-3 py-8 text-sm" role="status">
        <ListTodo className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-muted-foreground">No agent todo yet. It appears here once an agent plans its work with the todo tool.</p>
      </div>
    );
  }
  return (
    <article className="flex flex-col gap-4" aria-label="Agent todo" data-testid="task-agent-todo-panel">
      <header className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Agent todo</h2>
        <AgentTodoProgress snapshot={snapshot} />
      </header>
      <AgentTodoList snapshot={snapshot} />
    </article>
  );
}
