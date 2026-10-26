// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgentTodoSnapshot } from "@tickernelz/paperclip-pro-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issuesApi } from "@/api/issues";
import { LiveNowTodoLine } from "./LiveNowTodoLine";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ISSUE_ID = "issue-1";

function snapshot(overrides: Partial<AgentTodoSnapshot> = {}): AgentTodoSnapshot {
  return {
    version: 1,
    source: "omp",
    op: "update",
    phases: [
      {
        name: "Fix",
        tasks: [
          { content: "Read the issue", status: "completed" },
          { content: "Locate the bug", status: "in_progress" },
          { content: "Write the patch", status: "pending" },
        ],
      },
    ],
    counts: { total: 3, completed: 1, inProgress: 1, pending: 1, blocked: 0, dropped: 0 },
    runId: "run-live",
    agentId: "agent-1",
    issueId: ISSUE_ID,
    seq: 2,
    createdAt: new Date().toISOString(),
    runStatus: "running",
    ...overrides,
  };
}

describe("LiveNowTodoLine", () => {
  let root: Root;
  let container: HTMLDivElement;
  let client: QueryClient;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    act(() => root.unmount());
    client.clear();
    container.remove();
    vi.restoreAllMocks();
  });

  async function render(runIds: string[]) {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <LiveNowTodoLine issueId={ISSUE_ID} runIds={runIds} />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("shows only the current task and progress for a live run, not the list", async () => {
    vi.spyOn(issuesApi, "getAgentTodo").mockResolvedValue({ snapshot: snapshot() });
    await render(["run-live"]);
    const line = container.querySelector('[data-slot="tasks-live-now-todo"]');
    expect(line?.textContent).toContain("Locate the bug");
    expect(line?.textContent).toContain("1/3");
    expect(container.textContent).not.toContain("Write the patch");
    expect(container.textContent).not.toContain("Read the issue");
  });

  it("renders nothing when the todo came from a run that is not live or there is no todo", async () => {
    const spy = vi.spyOn(issuesApi, "getAgentTodo").mockResolvedValue({ snapshot: snapshot({ runId: "run-old" }) });
    await render(["run-live"]);
    expect(container.innerHTML).toBe("");
    spy.mockResolvedValue({ snapshot: null });
    client.clear();
    await render(["run-live"]);
    expect(container.innerHTML).toBe("");
  });
});
