import { describe, expect, it } from "vitest";
import {
  agentTodoPayloadSchema,
  agentTodoPhaseSchema,
  agentTodoSnapshotSchema,
  agentTodoTaskSchema,
  buildAgentTodoPayloadFromOmpDetails,
  summarizeAgentTodo,
} from "./agent-todo.js";

describe("agent todo", () => {
  it("counts every status and picks the first in-progress task as current", () => {
    const summary = summarizeAgentTodo([
      { name: "Context", tasks: [{ content: "Read issue", status: "completed" }, { content: "Checkpoint", status: "dropped" }] },
      { name: "Fix", tasks: [
        { content: "Locate cause", status: "in_progress" },
        { content: "Wait for keys", status: "blocked" },
        { content: "Second active", status: "in_progress" },
        { content: "Ship", status: "pending" },
      ] },
    ]);
    expect(summary).toEqual({
      counts: { total: 6, completed: 1, inProgress: 2, pending: 1, blocked: 1, dropped: 1 },
      current: "Locate cause",
    });
    expect(summarizeAgentTodo([]).current).toBeNull();
  });

  it("enforces schema bounds", () => {
    expect(agentTodoTaskSchema.safeParse({ content: "x".repeat(500), status: "pending" }).success).toBe(true);
    expect(agentTodoTaskSchema.safeParse({ content: "x".repeat(501), status: "pending" }).success).toBe(false);
    expect(agentTodoTaskSchema.safeParse({ content: "x", status: "abandoned" }).success).toBe(false);
    expect(agentTodoPhaseSchema.safeParse({ name: "p".repeat(201), tasks: [] }).success).toBe(false);
    const tasks = Array.from({ length: 101 }, (_, i) => ({ content: `t${i}`, status: "pending" }));
    expect(agentTodoPhaseSchema.safeParse({ name: "p", tasks }).success).toBe(false);
    expect(agentTodoPhaseSchema.safeParse({ name: "p", tasks: tasks.slice(0, 100) }).success).toBe(true);
    const counts = { total: 0, completed: 0, inProgress: 0, pending: 0, blocked: 0, dropped: 0 };
    const phases = Array.from({ length: 31 }, (_, i) => ({ name: `p${i}`, tasks: [] }));
    expect(agentTodoPayloadSchema.safeParse({ version: 1, source: "omp", op: "init", phases, counts }).success).toBe(false);
    expect(agentTodoPayloadSchema.safeParse({ version: 1, source: "omp", op: "init", phases: phases.slice(0, 30), counts }).success).toBe(true);
    expect(agentTodoPayloadSchema.safeParse({ version: 2, source: "omp", op: "init", phases: [], counts }).success).toBe(false);
    expect(agentTodoSnapshotSchema.safeParse({
      version: 1, source: "omp", op: "init", phases: [], counts,
      runId: "r", agentId: "a", issueId: "i", seq: 3, createdAt: "2026-10-26T00:00:00.000Z", runStatus: "running",
    }).success).toBe(true);
  });

  it("builds a bounded payload from OMP details, normalising abandoned to dropped and counting the full list", () => {
    const payload = buildAgentTodoPayloadFromOmpDetails({
      op: "drop",
      phases: [
        { name: "Context", tasks: [{ content: "Read", status: "abandoned" }, { content: "Wait", status: "blocked", blocker: "keys" }] },
        { name: "Big", tasks: Array.from({ length: 70 }, (_, i) => ({ content: `${i}`.padEnd(600, "x"), status: i < 10 ? "completed" : "pending" })) },
      ],
      storage: "session",
    }, { toolCallId: "toolu_1" });
    expect(payload?.op).toBe("drop");
    expect(payload?.toolCallId).toBe("toolu_1");
    expect(payload?.phases[0]?.tasks).toEqual([{ content: "Read", status: "dropped" }, { content: "Wait", status: "blocked", blocker: "keys" }]);
    expect(payload?.phases[1]?.tasks).toHaveLength(50);
    expect(payload?.phases[1]?.tasks[0]?.content).toHaveLength(500);
    expect(payload?.counts).toEqual({ total: 72, completed: 10, inProgress: 0, pending: 60, blocked: 1, dropped: 1 });
    expect(agentTodoPayloadSchema.safeParse(payload).success).toBe(true);
    expect(buildAgentTodoPayloadFromOmpDetails({ op: "view" })).toBeNull();
    expect(buildAgentTodoPayloadFromOmpDetails("text")).toBeNull();
  });
});
