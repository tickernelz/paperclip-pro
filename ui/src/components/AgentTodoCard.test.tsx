// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgentTodoPayload, AgentTodoSnapshot } from "@tickernelz/paperclip-pro-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issuesApi } from "@/api/issues";
import { __liveUpdatesTestUtils } from "@/context/LiveUpdatesProvider";
import { AgentTodoPanelContext } from "@/context/AgentTodoPanelContext";
import { queryKeys } from "@/lib/queryKeys";
import { AgentTodoCard } from "./AgentTodoCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COMPANY_ID = "company-1";
const ISSUE_ID = "issue-1";
const RUN_ID = "abcdef12-3456-7890-abcd-ef1234567890";

function payload(overrides: Partial<AgentTodoPayload> = {}): AgentTodoPayload {
  return {
    version: 1,
    source: "omp",
    op: "start",
    phases: [
      {
        name: "Context",
        tasks: [
          { content: "Read the issue", status: "completed" },
          { content: "Skip old notes", status: "dropped" },
        ],
      },
      {
        name: "Fix",
        tasks: [
          { content: "Locate the bug", status: "in_progress" },
          { content: "Wait for credentials", status: "blocked", blocker: "Missing API key" },
          { content: "Write the patch", status: "pending" },
        ],
      },
    ],
    counts: { total: 7, completed: 1, inProgress: 1, pending: 3, blocked: 1, dropped: 1 },
    ...overrides,
  };
}

function snapshot(overrides: Partial<AgentTodoSnapshot> = {}): AgentTodoSnapshot {
  return {
    ...payload(),
    runId: RUN_ID,
    agentId: "agent-1",
    issueId: ISSUE_ID,
    seq: 5,
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    runStatus: "running",
    ...overrides,
  };
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("AgentTodoCard", () => {
  let root: Root;
  let container: HTMLDivElement;
  let client: QueryClient;

  beforeEach(() => {
    localStorage.clear();
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

  async function render(openInPanel: (() => void) | null = null) {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <AgentTodoPanelContext.Provider value={openInPanel}>
            <AgentTodoCard issueId={ISSUE_ID} />
          </AgentTodoPanelContext.Provider>
        </QueryClientProvider>,
      );
    });
    await flush();
  }

  async function dispatch(type: string, eventPayload: Record<string, unknown>) {
    act(() => {
      __liveUpdatesTestUtils.handleLiveEvent(
        client,
        COMPANY_ID,
        "/PAP/issues/PAP-1",
        { id: 1, companyId: COMPANY_ID, type, createdAt: new Date().toISOString(), payload: eventPayload } as never,
        () => null,
        { cooldownHits: new Map(), suppressUntil: 0, observedRunOutcomes: new Set<string>() },
        { userId: "user-1", agentId: null },
      );
    });
    await flush();
  }

  function todoEvent(seq: number, todo: AgentTodoPayload) {
    return {
      runId: RUN_ID,
      agentId: "agent-1",
      issueId: ISSUE_ID,
      seq,
      eventType: "agent.todo",
      stream: "system",
      level: "info",
      message: "Todo 2/7",
      lastEventAt: new Date().toISOString(),
      payload: todo,
    };
  }

  const progressbar = () => container.querySelector<HTMLElement>('[role="progressbar"]');
  const taskRow = (text: string) =>
    Array.from(container.querySelectorAll("li")).find((li) => li.textContent?.includes(text)) ?? null;
  const phaseToggle = (name: string) =>
    Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes(name)) ?? null;

  it("renders progress, run label, phases and task statuses from the fetched snapshot", async () => {
    vi.spyOn(issuesApi, "getAgentTodo").mockResolvedValue({ snapshot: snapshot() });
    await render();

    expect(issuesApi.getAgentTodo).toHaveBeenCalledWith(ISSUE_ID);
    expect(container.querySelector('section[aria-label="Agent todo"] h2')?.textContent).toBe("Agent todo");
    expect(progressbar()?.getAttribute("aria-valuenow")).toBe("1");
    expect(progressbar()?.getAttribute("aria-valuemax")).toBe("7");
    expect(container.textContent).toContain("1/7");
    expect(container.textContent).toContain("from run abcdef12 · 5m ago");
    expect(container.querySelector('[data-testid="agent-todo-live-dot"]')).not.toBeNull();

    expect(phaseToggle("Context")?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('ol[aria-label="Context tasks"]')?.hasAttribute("hidden")).toBe(true);
    expect(phaseToggle("Fix")?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('ol[aria-label="Fix tasks"]')?.hasAttribute("hidden")).toBe(false);

    expect(taskRow("Locate the bug")?.getAttribute("aria-current")).toBe("step");
    expect(taskRow("Wait for credentials")?.textContent).toContain("Blocked: Missing API key");
    expect(taskRow("Read the issue")?.querySelector(".line-through")?.textContent).toBe("Read the issue");
    expect(taskRow("Skip old notes")?.querySelector(".line-through")?.textContent).toBe("Skip old notes");
    expect(taskRow("Skip old notes")?.getAttribute("data-status")).toBe("dropped");
    expect(taskRow("Write the patch")?.querySelector(".line-through")).toBeNull();
    expect(container.textContent).toContain("+2 more tasks not listed");

    await act(async () => phaseToggle("Context")?.click());
    expect(container.querySelector('ol[aria-label="Context tasks"]')?.hasAttribute("hidden")).toBe(false);
  });

  it("renders nothing when the task has no agent todo", async () => {
    vi.spyOn(issuesApi, "getAgentTodo").mockResolvedValue({ snapshot: null });
    await render();
    expect(container.innerHTML).toBe("");
  });

  it("offers opening the list in the side panel when a panel host is present", async () => {
    vi.spyOn(issuesApi, "getAgentTodo").mockResolvedValue({ snapshot: snapshot() });
    const openInPanel = vi.fn();
    await render(openInPanel);
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Open agent todo in side panel"]')?.click());
    expect(openInPanel).toHaveBeenCalledOnce();
  });

  it("follows live agent.todo run events and the run status through the live update handler", async () => {
    vi.spyOn(issuesApi, "getAgentTodo").mockResolvedValue({ snapshot: snapshot() });
    await render();
    expect(progressbar()?.getAttribute("aria-valuenow")).toBe("1");

    const advanced = payload({
      op: "done",
      phases: [{ name: "Fix", tasks: [{ content: "Locate the bug", status: "completed" }, { content: "Write the patch", status: "in_progress" }] }],
      counts: { total: 2, completed: 1, inProgress: 1, pending: 0, blocked: 0, dropped: 0 },
    });
    await dispatch("heartbeat.run.event", todoEvent(6, advanced));
    expect(taskRow("Write the patch")?.getAttribute("aria-current")).toBe("step");
    expect(taskRow("Read the issue")).toBeNull();
    expect(progressbar()?.getAttribute("aria-valuemax")).toBe("2");

    await dispatch("heartbeat.run.event", todoEvent(4, payload()));
    expect(taskRow("Read the issue")).toBeNull();

    await dispatch("heartbeat.run.event", { ...todoEvent(7, payload()), eventType: "omp.tool" });
    expect(taskRow("Read the issue")).toBeNull();

    await dispatch("heartbeat.run.status", { runId: RUN_ID, agentId: "agent-1", issueId: ISSUE_ID, status: "succeeded" });
    expect(container.querySelector('[data-testid="agent-todo-live-dot"]')).toBeNull();
    expect(container.textContent).toContain("from run abcdef12");
    expect(taskRow("Write the patch")?.getAttribute("aria-current")).toBe("step");
  });

  it("ignores a live agent.todo event for another issue", async () => {
    vi.spyOn(issuesApi, "getAgentTodo").mockResolvedValue({ snapshot: snapshot() });
    await render();
    const before = client.getQueryData(queryKeys.issues.agentTodo(ISSUE_ID));

    const otherIssue = payload({
      phases: [{ name: "Elsewhere", tasks: [{ content: "Other issue work", status: "in_progress" }] }],
      counts: { total: 1, completed: 0, inProgress: 1, pending: 0, blocked: 0, dropped: 0 },
    });
    await dispatch("heartbeat.run.event", { ...todoEvent(9, otherIssue), issueId: "issue-2" });

    expect(client.getQueryData(queryKeys.issues.agentTodo(ISSUE_ID))).toBe(before);
    expect(taskRow("Locate the bug")?.getAttribute("aria-current")).toBe("step");
    expect(taskRow("Other issue work")).toBeNull();
  });

  it("starts collapsed on the current task with its progress and hides the list", async () => {
    vi.spyOn(issuesApi, "getAgentTodo").mockResolvedValue({ snapshot: snapshot() });
    await render();
    const card = container.querySelector<HTMLElement>('[data-testid="agent-todo-card"]');
    expect(card?.getAttribute("data-expanded")).toBe("false");
    const summary = container.querySelector<HTMLElement>('[data-testid="agent-todo-collapsed-summary"]');
    expect(summary?.textContent).toContain("Locate the bug");
    expect(summary?.textContent).not.toContain("Read the issue");
    expect(card?.querySelector('[aria-label="Agent todo"] h2, h2')?.textContent).toBe("Agent todo");
    expect(container.querySelector("#" + CSS.escape(summary?.getAttribute("aria-controls") ?? ""))?.hasAttribute("hidden")).toBe(true);
    expect(container.querySelector('button[aria-label="Expand agent todo"]')).not.toBeNull();
    expect(container.textContent).toContain("1/7");
  });

  it("opens the list on demand and remembers the choice in this browser", async () => {
    vi.spyOn(issuesApi, "getAgentTodo").mockResolvedValue({ snapshot: snapshot() });
    await render();
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Expand agent todo"]')?.click());
    const card = container.querySelector<HTMLElement>('[data-testid="agent-todo-card"]');
    expect(card?.getAttribute("data-expanded")).toBe("true");
    expect(container.querySelector('[data-testid="agent-todo-collapsed-summary"]')).toBeNull();
    expect(container.querySelector('[data-testid="agent-todo-card-list"]')?.parentElement?.hasAttribute("hidden")).toBe(false);
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(container.querySelector('[data-testid="agent-todo-card"]')?.getAttribute("data-expanded")).toBe("true");
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Collapse agent todo"]')?.click());
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(container.querySelector('[data-testid="agent-todo-card"]')?.getAttribute("data-expanded")).toBe("false");
  });

  it("summarizes the next pending task, then a finished list, once nothing is in progress", async () => {
    const idle = payload({
      phases: [{ name: "Fix", tasks: [{ content: "Read the issue", status: "completed" }, { content: "Write the patch", status: "pending" }] }],
      counts: { total: 2, completed: 1, inProgress: 0, pending: 1, blocked: 0, dropped: 0 },
    });
    vi.spyOn(issuesApi, "getAgentTodo").mockResolvedValue({ snapshot: snapshot(idle) });
    await render();
    const summary = () => container.querySelector('[data-testid="agent-todo-collapsed-summary"]')?.textContent;
    expect(summary()).toContain("Write the patch");
    const finished = payload({
      op: "done",
      phases: [{ name: "Fix", tasks: [{ content: "Read the issue", status: "completed" }, { content: "Write the patch", status: "completed" }] }],
      counts: { total: 2, completed: 2, inProgress: 0, pending: 0, blocked: 0, dropped: 0 },
    });
    await dispatch("heartbeat.run.event", todoEvent(9, finished));
    expect(summary()).toContain("All tasks done");
    expect(container.textContent).toContain("2/2");
  });
});
