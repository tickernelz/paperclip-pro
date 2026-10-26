// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptEntry } from "@/adapters";
import { ThemeProvider } from "@/context/ThemeContext";
import { TaskChatLiveTail } from "./TaskChatLiveTail";
import { TaskChatRunnerTurn } from "./TaskChatRunnerTurn";
import { TaskChatThreadView } from "./TaskChatThreadView";
import type { TaskChatItem, TaskChatTodoItem } from "./task-chat-model";
import { todoRowText } from "./task-chat-todo";
import { buildTurnTimelineRows, transcriptToTaskChatItems } from "./transcript-adapter";

vi.mock("@/lib/router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

const TS = "2026-10-26T09:00:00.000Z";

const INIT_ARGS = {
  op: "init",
  list: [
    { phase: "Context", items: ["Read issue, related issues, memory, skills", "Post start checkpoint"] },
    { phase: "Fix", items: ["Locate theme menu component and double check cause", "Create worktree branch and fix", "Check other menus for same pattern"] },
    { phase: "Prove", items: ["Run related tests and comment gate", "Before/after screenshots in live UI", "Commit, push branch, closing comment"] },
  ],
};

const INIT_DETAILS = {
  op: "init",
  phases: [
    { name: "Context", tasks: [
      { content: "Read issue, related issues, memory, skills", status: "in_progress" },
      { content: "Post start checkpoint", status: "pending" },
    ] },
    { name: "Fix", tasks: [
      { content: "Locate theme menu component and double check cause", status: "pending" },
      { content: "Create worktree branch and fix", status: "pending" },
      { content: "Check other menus for same pattern", status: "pending" },
    ] },
    { name: "Prove", tasks: [
      { content: "Run related tests and comment gate", status: "pending" },
      { content: "Before/after screenshots in live UI", status: "pending" },
      { content: "Commit, push branch, closing comment", status: "pending" },
    ] },
  ],
  storage: "session",
};

const START_DETAILS = {
  op: "start",
  phases: [
    { name: "Probe", tasks: [
      { content: "Verify SHA, range-diff, delta, identity", status: "completed" },
      { content: "Read review findings", status: "completed" },
      { content: "Reproduce the regression", status: "completed" },
    ] },
    { name: "Verdict", tasks: [
      { content: "Post round 2 verdict on ZHA-3590", status: "in_progress" },
      { content: "Upsert review case and findings doc", status: "pending" },
      { content: "Close subtask done with self-evolve", status: "pending" },
      { content: "Notify reviewer", status: "pending" },
      { content: "Archive scratch notes", status: "pending" },
    ] },
  ],
  storage: "session",
};

const DROP_DETAILS = {
  op: "drop",
  phases: [
    { name: "Context", tasks: [
      { content: "Read issue, related issues, memory, skills", status: "abandoned" },
      { content: "Post start checkpoint", status: "completed" },
    ] },
    { name: "Prove", tasks: [
      { content: "Run related tests and comment gate", status: "completed" },
    ] },
  ],
  storage: "session",
};

function todoCall(id: string, args: unknown): TranscriptEntry {
  return { kind: "tool_call", ts: TS, name: "todo", input: args, toolUseId: id };
}

const REMAINING_TEXT =
  "Remaining items (8):\n  - [ ] Read issue, related issues, memory, skills [in_progress] (Context)\n  - [ ] Post start checkpoint [pending] (Context)";
const MISSING_TASK_ERROR = 'Task "Missing task" not found in the todo list';

function todoResult(id: string, details: unknown, isError = false, content = REMAINING_TEXT): TranscriptEntry {
  return {
    kind: "tool_result",
    ts: TS,
    toolUseId: id,
    toolName: "todo",
    content,
    isError,
    details,
  };
}

const failedStart: TranscriptEntry[] = [
  todoCall("t2", { op: "start", task: "Missing task" }),
  todoResult("t2", undefined, true, MISSING_TASK_ERROR),
];

function todoItems(items: readonly TaskChatItem[]): TaskChatTodoItem[] {
  return items.filter((item): item is TaskChatTodoItem => item.kind === "todo");
}

const entries: TranscriptEntry[] = [
  todoCall("toolu_init", INIT_ARGS),
  todoResult("toolu_init", INIT_DETAILS),
  { kind: "tool_call", ts: TS, name: "Read", input: { path: "src/menu.tsx" }, toolUseId: "toolu_read" },
  { kind: "tool_result", ts: TS, toolUseId: "toolu_read", toolName: "Read", content: "file body", isError: false },
  todoCall("toolu_start", { op: "start", task: "Post round 2 verdict on ZHA-3590" }),
  todoResult("toolu_start", START_DETAILS),
  todoCall("toolu_drop", { op: "drop" }),
  todoResult("toolu_drop", DROP_DETAILS),
];

describe("todo tool rows in the transcript adapter", () => {
  it("turns each todo call into one compact item with op verb, subject and counts", () => {
    const items = transcriptToTaskChatItems(entries, { runId: "run-1", running: false });
    const todos = todoItems(items);
    expect(todos.map(todoRowText)).toEqual([
      'Todo · planned "Read issue, related issues, memory, skills" · 0/8',
      'Todo · started "Post round 2 verdict on ZHA-3590" · 3/8',
      "Todo · dropped · 2/3",
    ]);
    expect(todos.every((todo) => todo.status === "completed")).toBe(true);
    expect(JSON.stringify(todos)).not.toContain("Remaining items");
    const tools = items.filter((item) => item.kind === "tool");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ name: "Read", status: "completed", detail: "file body" });
  });

  it("shows a running row before the result and a failed row on error", () => {
    const pending = todoItems(
      transcriptToTaskChatItems([todoCall("t1", { op: "done", task: "Ship it" })], { runId: "run-1", running: true }),
    );
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe("in_progress");
    expect(todoRowText(pending[0])).toBe('Todo · completed "Ship it"');

    const failed = todoItems(transcriptToTaskChatItems(failedStart, { runId: "run-1", running: false }));
    expect(failed[0].status).toBe("failed");
    expect(todoRowText(failed[0])).toBe('Todo · start failed "Missing task"');
    expect(failed[0].error).toBe(MISSING_TASK_ERROR);
  });

  it("keeps a todo call without an OMP op as a normal tool card", () => {
    const items = transcriptToTaskChatItems(
      [
        { kind: "tool_call", ts: TS, name: "todo", input: { detail: "1. Read the spec\n2. Write tests" }, toolUseId: "h1" },
        { kind: "tool_result", ts: TS, toolUseId: "h1", toolName: "todo", content: "1. Read the spec\n2. Write tests", isError: false },
      ],
      { runId: "run-1", running: false },
    );
    expect(todoItems(items)).toHaveLength(0);
    const tools = items.filter((item) => item.kind === "tool");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ rawName: "todo", status: "completed", detail: "1. Read the spec\n2. Write tests" });
  });

  it("keeps todo rows as standalone timeline rows between activity phases", () => {
    const parsed = transcriptToTaskChatItems(entries, { runId: "run-1", running: false });
    const rows = buildTurnTimelineRows(parsed, false, "turn-1");
    expect(rows.map((row) => row.kind)).toEqual(["todo", "activity_phase", "todo", "todo"]);
  });
});

describe("todo rows rendered", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => root?.unmount());
    root = null;
    container.remove();
  });

  const startOnly: TranscriptEntry[] = [
    todoCall("toolu_start", { op: "start", task: "Post round 2 verdict on ZHA-3590" }),
    todoResult("toolu_start", START_DETAILS),
  ];

  function rows() {
    return [...container.querySelectorAll('[data-testid="task-chat-todo-row"]')];
  }

  it("renders one accessible compact row in the thread view", () => {
    const items = transcriptToTaskChatItems(startOnly, { runId: "run-1", running: false });
    flushSync(() =>
      root!.render(
        <ThemeProvider>
          <TaskChatThreadView items={items} scroll={false} />
        </ThemeProvider>,
      ),
    );
    expect(rows()).toHaveLength(1);
    expect(rows()[0].getAttribute("role")).toBe("note");
    expect(rows()[0].getAttribute("aria-label")).toBe('Todo · started "Post round 2 verdict on ZHA-3590" · 3/8 (done)');
    expect(container.textContent).not.toContain("Remaining items");
    expect(container.textContent).not.toContain("Upsert review case");
    expect(container.querySelector('[data-testid="task-chat-tool-card"]')).toBeNull();
  });

  it("shows the error message on a failed todo row", () => {
    const items = transcriptToTaskChatItems(failedStart, { runId: "run-1", running: false });
    flushSync(() =>
      root!.render(
        <ThemeProvider>
          <TaskChatThreadView items={items} scroll={false} />
        </ThemeProvider>,
      ),
    );
    expect(rows()).toHaveLength(1);
    expect(rows()[0].getAttribute("data-todo-status")).toBe("failed");
    const error = rows()[0].querySelector('[data-testid="task-chat-todo-error"]');
    expect(error?.textContent).toBe(MISSING_TASK_ERROR);
    expect(rows()[0].getAttribute("aria-describedby")).toBe(error?.id);
  });

  it("renders a running compact row in the live tail", () => {
    const items = transcriptToTaskChatItems(startOnly.slice(0, 1), { runId: "run-1", running: true });
    flushSync(() =>
      root!.render(
        <ThemeProvider>
          <TaskChatLiveTail items={items} />
        </ThemeProvider>,
      ),
    );
    expect(rows()).toHaveLength(1);
    expect(rows()[0].getAttribute("data-todo-status")).toBe("in_progress");
    expect(rows()[0].textContent).toBe('Todo · started "Post round 2 verdict on ZHA-3590"');
  });

  it("renders the todo row in the runner turn timeline", () => {
    const items = transcriptToTaskChatItems(startOnly, { runId: "run-1", running: false });
    flushSync(() =>
      root!.render(
        <ThemeProvider>
          <TaskChatRunnerTurn runId="run-1" agentName="Atlas" items={items} status="succeeded" startedAtMs={1_000} />
        </ThemeProvider>,
      ),
    );
    expect(rows()).toHaveLength(1);
    expect(container.textContent).toContain('Todo · started "Post round 2 verdict on ZHA-3590" · 3/8');
    expect(container.textContent).not.toContain("Remaining items");
  });
});
