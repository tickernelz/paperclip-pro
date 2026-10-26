import { describe, expect, it } from "vitest";
import type { AgentTodoSnapshot } from "@tickernelz/paperclip-pro-shared";
import { agentTodoFocus, agentTodoFocusText } from "./agent-todo-focus";

type Input = Pick<AgentTodoSnapshot, "phases" | "counts">;

function input(statuses: Array<"pending" | "in_progress" | "completed" | "blocked" | "dropped">[]): Input {
  const phases = statuses.map((tasks, phase) => ({
    name: `Phase ${phase}`,
    tasks: tasks.map((status, index) => ({ content: `task ${phase}.${index}`, status })),
  }));
  const total = phases.reduce((sum, phase) => sum + phase.tasks.length, 0);
  return { phases, counts: { total, completed: 0, inProgress: 0, pending: 0, blocked: 0, dropped: 0 } };
}

describe("agentTodoFocus", () => {
  it("prefers the in-progress task over earlier pending ones, across phases", () => {
    const focus = agentTodoFocus(input([["completed", "pending"], ["pending", "in_progress"]]));
    expect(focus.kind).toBe("current");
    expect(focus.task?.content).toBe("task 1.1");
  });

  it("falls back to the first pending task, then the first blocked one", () => {
    expect(agentTodoFocus(input([["completed", "blocked", "pending", "pending"]])).task?.content).toBe("task 0.2");
    const blocked = agentTodoFocus(input([["completed", "dropped", "blocked"]]));
    expect(blocked.kind).toBe("blocked");
    expect(blocked.task?.content).toBe("task 0.2");
  });

  it("reports a finished list when every task is settled, and an empty list when none exist", () => {
    const done = agentTodoFocus(input([["completed", "dropped"]]));
    expect(done.kind).toBe("done");
    expect(agentTodoFocusText(done)).toBe("All tasks done");
    const empty = agentTodoFocus(input([]));
    expect(empty.kind).toBe("empty");
    expect(agentTodoFocusText(empty)).toBe("Todo list cleared");
  });
});
