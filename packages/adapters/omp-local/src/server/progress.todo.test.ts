import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AdapterRuntimeEvent } from "@tickernelz/paperclip-pro-adapter-utils";
import { createOmpProgressReporter } from "./progress.js";

const recorded = readFileSync(new URL("./test-fixtures/omp-todo-events.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter((line) => line.trim());

function recordedLine(type: string, op: string): string {
  const line = recorded.find((candidate) => {
    const event = JSON.parse(candidate) as { type: string; args?: { op?: string }; result?: { details?: { op?: string } } };
    return event.type === type && (type === "tool_execution_start" ? event.args?.op : event.result?.details?.op) === op;
  });
  if (!line) throw new Error(`missing recorded ${type} ${op}`);
  return line;
}

async function run(lines: string[]): Promise<AdapterRuntimeEvent[]> {
  const events: AdapterRuntimeEvent[] = [];
  const reporter = createOmpProgressReporter(undefined, async (event) => {
    events.push(event);
  });
  for (const line of lines) await reporter.ingest(line);
  return events;
}

function todoEvents(events: AdapterRuntimeEvent[]) {
  return events.filter((event) => event.eventType === "agent.todo");
}

describe("OMP progress reporter agent todo events", () => {
  it("emits an agent.todo snapshot for a recorded init call", async () => {
    const events = await run([recordedLine("tool_execution_start", "init"), recordedLine("tool_execution_end", "init")]);
    const [todo] = todoEvents(events);
    expect(todoEvents(events)).toHaveLength(1);
    expect(todo).toMatchObject({
      eventType: "agent.todo",
      stream: "system",
      level: "info",
      message: "Todo 0/5 · Locate Scheduled job prefix rendering and colors",
    });
    expect(todo?.payload).toEqual({
      version: 1,
      source: "omp",
      op: "init",
      toolCallId: "toolu_01LZ5a9tsyhZJoCfJgmYC6UP",
      phases: [
        { name: "Investigate", tasks: [
          { content: "Locate Scheduled job prefix rendering and colors", status: "in_progress" },
          { content: "Measure contrast of secondary elements on light bubble", status: "pending" },
        ] },
        { name: "Build", tasks: [
          { content: "Create worktree and fix failing colors", status: "pending" },
          { content: "Capture before/after screenshots dark/light 800/1280", status: "pending" },
        ] },
        { name: "Ship", tasks: [{ content: "Commit, push, open MR, Hendra handoff", status: "pending" }] },
      ],
      counts: { total: 5, completed: 0, inProgress: 1, pending: 4, blocked: 0, dropped: 0 },
    });
    expect(events.some((event) => event.eventType === "omp.tool" && event.message?.startsWith("todo ok"))).toBe(true);
  });

  it("reports the started task of a recorded start call as current", async () => {
    const [todo] = todoEvents(await run([recordedLine("tool_execution_start", "start"), recordedLine("tool_execution_end", "start")]));
    expect(todo?.message).toBe("Todo 0/16 · Scaffold kaitech_support addon manifest/security");
    expect(todo?.payload).toMatchObject({ op: "start", counts: { total: 16, inProgress: 1, pending: 15 } });
  });

  it("normalises an abandoned task from a recorded drop call to dropped", async () => {
    const [todo] = todoEvents(await run([recordedLine("tool_execution_start", "drop"), recordedLine("tool_execution_end", "drop")]));
    const payload = todo?.payload as { counts: unknown; phases: { name: string; tasks: { content: string; status: string }[] }[] };
    expect(payload.counts).toEqual({ total: 14, completed: 0, inProgress: 1, pending: 12, blocked: 0, dropped: 1 });
    expect(payload.phases[1]?.tasks[3]).toEqual({ content: "T4 Alt+R invisible fallback shortcut per PDF", status: "dropped" });
  });

  it("keeps the blocker note of a recorded block call", async () => {
    const [todo] = todoEvents(await run([recordedLine("tool_execution_end", "block")]));
    expect(todo?.message).toBe("Todo 6/7");
    expect(todo?.payload).toMatchObject({ counts: { total: 7, completed: 6, blocked: 1 } });
    const payload = todo?.payload as { phases: { tasks: { blocker?: string }[] }[] };
    expect(payload.phases[2]?.tasks[2]?.blocker).toContain("menunggu verdict Hendra");
  });

  it("emits no agent.todo for other tools or failed todo calls", async () => {
    const bash = JSON.stringify({
      type: "tool_execution_end",
      toolCallId: "call_1",
      toolName: "bash",
      result: { content: [{ type: "text", text: "ok" }], details: { phases: [{ name: "x", tasks: [{ content: "y", status: "pending" }] }] } },
      isError: false,
    });
    const failed = JSON.stringify({ ...JSON.parse(recordedLine("tool_execution_end", "init")), isError: true });
    const events = await run([bash, failed]);
    expect(todoEvents(events)).toHaveLength(0);
    expect(events.filter((event) => event.eventType === "omp.tool")).toHaveLength(2);
  });

  it("caps oversized lists while counting the full list", async () => {
    const tasks = Array.from({ length: 80 }, (_, index) => ({
      content: `Task ${index} `.padEnd(900, "x"),
      status: index < 30 ? "completed" : index === 30 ? "in_progress" : "pending",
    }));
    const phases = Array.from({ length: 35 }, (_, index) => ({ name: `Phase ${index}`, tasks: index === 0 ? tasks : [{ content: `Only ${index}`, status: "pending" }] }));
    const line = JSON.stringify({
      type: "tool_execution_end",
      toolCallId: "toolu_big",
      toolName: "todo",
      result: { content: [{ type: "text", text: "Remaining items" }], details: { op: "append", phases, storage: "session" } },
      isError: false,
    });
    const [todo] = todoEvents(await run([line]));
    const payload = todo?.payload as { counts: Record<string, number>; phases: { tasks: { content: string }[] }[] };
    expect(payload.phases).toHaveLength(30);
    expect(payload.phases[0]?.tasks).toHaveLength(50);
    expect(payload.phases[0]?.tasks[0]?.content.length).toBe(500);
    expect(payload.counts).toEqual({ total: 114, completed: 30, inProgress: 1, pending: 83, blocked: 0, dropped: 0 });
    expect(todo?.message?.startsWith("Todo 30/114 · Task 30 ")).toBe(true);
  });
});
