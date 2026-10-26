import { useId } from "react";
import { Check, ListTodo, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TaskChatTodoItem } from "./task-chat-model";
import { todoRowText } from "./task-chat-todo";

const STATUS_ICON = {
  in_progress: { Icon: Loader2, spin: true, tone: "text-(--status-agent-running)", label: "running" },
  completed: { Icon: Check, spin: false, tone: "text-muted-foreground", label: "done" },
  failed: { Icon: X, spin: false, tone: "text-destructive", label: "failed" },
} as const;

/** Compact one-line row standing in for an agent todo tool call. */
export function TaskChatTodoRow({ item }: { item: TaskChatTodoItem }) {
  const errorId = useId();
  const label = todoRowText(item);
  const { Icon, spin, tone, label: statusLabel } = STATUS_ICON[item.status];
  const error = item.status === "failed" ? item.error : undefined;
  return (
    <div
      role="note"
      aria-label={`${label} (${statusLabel})`}
      aria-describedby={error ? errorId : undefined}
      data-testid="task-chat-todo-row"
      data-todo-status={item.status}
      className="-mx-1.5 flex min-w-0 max-w-full flex-col overflow-hidden px-1.5 py-1 text-xs text-muted-foreground"
    >
      <div className="flex min-h-4 min-w-0 items-center gap-2 leading-none">
        <span className="flex w-5 shrink-0 items-center justify-center">
          <ListTodo className="h-3.5 w-3.5 shrink-0" aria-hidden />
        </span>
        <span className="task-chat-collapsed-line-fade min-w-0 flex-1 truncate leading-4" title={label}>
          {label}
        </span>
        <Icon aria-hidden className={cn("h-3.5 w-3.5 shrink-0", tone, spin && "animate-spin")} />
      </div>
      {error ? (
        <p
          id={errorId}
          data-testid="task-chat-todo-error"
          className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words pl-7 leading-4 text-destructive"
          title={error}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
