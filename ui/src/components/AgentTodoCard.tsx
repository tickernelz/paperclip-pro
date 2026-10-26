import { useContext, useId, useState } from "react";
import { ChevronDown, ChevronRight, ListTodo, PanelRightOpen } from "lucide-react";
import type {
  AgentTodoPhase,
  AgentTodoSnapshot,
  AgentTodoStatus,
  AgentTodoTask,
} from "@tickernelz/paperclip-pro-shared";
import { StatusIcon } from "@/components/task-chat/TaskChatProtocolCard";
import { Button } from "@/components/ui/button";
import { AgentTodoPanelContext } from "@/context/AgentTodoPanelContext";
import { useIssueAgentTodo } from "@/hooks/useIssueAgentTodo";
import { timeAgo } from "@/lib/timeAgo";
import { cn } from "@/lib/utils";

const LIVE_RUN_STATUSES = new Set(["running", "queued"]);

const STATUS_LABEL: Record<AgentTodoStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
  blocked: "Blocked",
  dropped: "Dropped",
};

const STATUS_ICON: Record<AgentTodoStatus, string> = {
  pending: "queued",
  in_progress: "in_progress",
  completed: "completed",
  blocked: "blocked",
  dropped: "dropped",
};

function isSettled(task: AgentTodoTask) {
  return task.status === "completed" || task.status === "dropped";
}

/** True while the snapshot's run can still change the list. */
export function isAgentTodoRunLive(snapshot: Pick<AgentTodoSnapshot, "runStatus">) {
  return LIVE_RUN_STATUSES.has(snapshot.runStatus);
}

function AgentTodoTaskRow({ task }: { task: AgentTodoTask }) {
  const settledTone = task.status === "dropped" ? "text-muted-foreground/70 line-through" : "text-muted-foreground line-through";
  return (
    <li
      className={cn(
        "flex items-start gap-2 rounded-sm px-1.5 py-1 text-sm",
        task.status === "in_progress" && "bg-muted font-medium text-foreground",
      )}
      data-status={task.status}
      aria-current={task.status === "in_progress" ? "step" : undefined}
    >
      <StatusIcon
        status={STATUS_ICON[task.status]}
        className={cn("mt-0.5 shrink-0", task.status === "dropped" && "opacity-60")}
      />
      <div className="min-w-0 flex-1">
        <span className="sr-only">{`${STATUS_LABEL[task.status]}: `}</span>
        <span className={cn("break-words", isSettled(task) && settledTone)}>{task.content}</span>
        {task.status === "blocked" && task.blocker ? (
          <p className="mt-0.5 text-xs text-destructive">{`Blocked: ${task.blocker}`}</p>
        ) : null}
      </div>
    </li>
  );
}

function AgentTodoPhaseSection({ phase, index }: { phase: AgentTodoPhase; index: number }) {
  const listId = useId();
  const settled = phase.tasks.length > 0 && phase.tasks.every(isSettled);
  const [expanded, setExpanded] = useState(!settled);
  const done = phase.tasks.filter((task) => task.status === "completed").length;
  const name = phase.name.trim() || `Phase ${index + 1}`;
  return (
    <section className="flex flex-col gap-1">
      <button
        type="button"
        className="flex min-w-0 items-center gap-1.5 rounded-sm text-left text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? <ChevronDown aria-hidden className="size-3.5 shrink-0" /> : <ChevronRight aria-hidden className="size-3.5 shrink-0" />}
        <span className="min-w-0 truncate">{name}</span>
        <span className="shrink-0 tabular-nums">{`${done}/${phase.tasks.length}`}</span>
      </button>
      <ol id={listId} hidden={!expanded} aria-label={`${name} tasks`} className="flex flex-col gap-0.5">
        {phase.tasks.map((task, taskIndex) => (
          <AgentTodoTaskRow key={`${taskIndex}:${task.content}`} task={task} />
        ))}
      </ol>
    </section>
  );
}

/** Phase-by-phase todo list shared by the pinned card and the side panel tab. */
export function AgentTodoList({ snapshot }: { snapshot: AgentTodoSnapshot }) {
  const listed = snapshot.phases.reduce((sum, phase) => sum + phase.tasks.length, 0);
  const hidden = Math.max(0, snapshot.counts.total - listed);
  if (snapshot.phases.length === 0) {
    return <p className="text-sm text-muted-foreground">The agent cleared its todo list.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {snapshot.phases.map((phase, index) => (
        <AgentTodoPhaseSection key={`${index}:${phase.name}`} phase={phase} index={index} />
      ))}
      {hidden > 0 ? (
        <p className="text-xs text-muted-foreground">{`+${hidden} more ${hidden === 1 ? "task" : "tasks"} not listed`}</p>
      ) : null}
    </div>
  );
}

/** Progress bar, run label, and live dot for a todo snapshot. */
export function AgentTodoProgress({ snapshot }: { snapshot: AgentTodoSnapshot }) {
  const { completed, total } = snapshot.counts;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const live = isAgentTodoRunLive(snapshot);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium tabular-nums text-foreground">{`${completed}/${total}`}</span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1.5">
          {live ? (
            <span
              className="size-1.5 shrink-0 animate-pulse rounded-full bg-(--status-agent-running) motion-reduce:animate-none"
              aria-hidden
              data-testid="agent-todo-live-dot"
            />
          ) : null}
          <span>
            {"from run "}
            <span className="font-mono">{snapshot.runId.slice(0, 8)}</span>
            {` · ${timeAgo(snapshot.createdAt)}`}
          </span>
          {live ? <span className="sr-only">(run in progress)</span> : null}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Agent todo progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={completed}
        aria-valuetext={`${completed} of ${total} tasks completed`}
        className="h-1 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-(--status-task-icon-done)" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/** Latest agent todo for the issue, pinned above the task chat; renders nothing without a snapshot. */
export function AgentTodoCard({
  issueId,
  className,
  frameClassName,
}: {
  issueId: string | null | undefined;
  className?: string;
  frameClassName?: string;
}) {
  const { data: snapshot } = useIssueAgentTodo(issueId);
  const openInPanel = useContext(AgentTodoPanelContext);
  const bodyId = useId();
  const [expanded, setExpanded] = useState(true);
  if (!snapshot) return null;
  const card = (
    <section
      aria-label="Agent todo"
      className={cn("flex flex-col gap-2 rounded-md border border-border bg-card px-3 py-2.5", className)}
      data-testid="agent-todo-card"
    >
      <header className="flex min-w-0 items-center gap-2">
        <ListTodo aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">Agent todo</h2>
        {openInPanel ? (
          <Button type="button" variant="ghost" size="icon-xs" aria-label="Open agent todo in side panel" onClick={openInPanel}>
            <PanelRightOpen aria-hidden />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={expanded ? "Collapse agent todo" : "Expand agent todo"}
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
        </Button>
      </header>
      <AgentTodoProgress snapshot={snapshot} />
      <div id={bodyId} hidden={!expanded} className="max-h-64 overflow-y-auto">
        <AgentTodoList snapshot={snapshot} />
      </div>
    </section>
  );
  return frameClassName ? <div className={frameClassName}>{card}</div> : card;
}
