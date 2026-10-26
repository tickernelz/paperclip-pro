import type { AgentTodoSnapshot, AgentTodoTask } from "@tickernelz/paperclip-pro-shared";

export type AgentTodoFocusKind = "current" | "next" | "blocked" | "done" | "empty";

export interface AgentTodoFocus {
  kind: AgentTodoFocusKind;
  task: AgentTodoTask | null;
}

/** The one task a collapsed todo shows: in progress, else next pending, else blocked, else a finished or empty marker. */
export function agentTodoFocus(snapshot: Pick<AgentTodoSnapshot, "phases" | "counts">): AgentTodoFocus {
  let next: AgentTodoTask | null = null;
  let blocked: AgentTodoTask | null = null;
  for (const phase of snapshot.phases) {
    for (const task of phase.tasks) {
      if (task.status === "in_progress") return { kind: "current", task };
      if (task.status === "pending") next ??= task;
      else if (task.status === "blocked") blocked ??= task;
    }
  }
  if (next) return { kind: "next", task: next };
  if (blocked) return { kind: "blocked", task: blocked };
  return { kind: snapshot.counts.total > 0 ? "done" : "empty", task: null };
}

export function agentTodoFocusText(focus: AgentTodoFocus): string {
  if (focus.task) return focus.task.content;
  return focus.kind === "done" ? "All tasks done" : "Todo list cleared";
}

export function agentTodoFocusStatusLabel(focus: AgentTodoFocus): string {
  switch (focus.kind) {
    case "current":
      return "In progress";
    case "next":
      return "Next";
    case "blocked":
      return "Blocked";
    case "done":
      return "Done";
    case "empty":
      return "Empty";
  }
}

export function agentTodoFocusIconStatus(focus: AgentTodoFocus): string {
  switch (focus.kind) {
    case "current":
      return "in_progress";
    case "next":
      return "queued";
    case "blocked":
      return "blocked";
    case "done":
      return "completed";
    case "empty":
      return "queued";
  }
}
