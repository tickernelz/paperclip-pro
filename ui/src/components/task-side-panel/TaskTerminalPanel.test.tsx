// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TerminalSession } from "@tickernelz/paperclip-pro-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import { TaskTerminalPanel } from "./TaskTerminalPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const terminalApiMock = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn() }));

vi.mock("@/api/terminal", () => ({
  terminalApi: terminalApiMock,
  terminalQueryKeys: { sessions: (companyId: string) => ["terminal-sessions", companyId] },
}));

vi.mock("@/components/terminal/TerminalView", () => ({
  TerminalView: ({ sessionId, active }: { sessionId: string; active: boolean }) => (
    <div data-testid="terminal-view-stub" data-active={String(active)}>{sessionId}</div>
  ),
}));

function session(overrides: Partial<TerminalSession>): TerminalSession {
  return {
    id: "session-1",
    companyId: "company-1",
    kind: "local",
    title: "PAP-1",
    cwd: "/work/PAP-1",
    issueId: "task-1",
    environmentId: null,
    status: "running",
    exitCode: null,
    cols: 100,
    rows: 30,
    attachedClients: 0,
    createdAt: "2026-10-24T00:00:00.000Z",
    lastActivityAt: "2026-10-24T00:00:00.000Z",
    createdByUserId: "user-1",
    ...overrides,
  };
}

const issue = { id: "task-1", companyId: "company-1", identifier: "PAP-1", title: "Portable tabs" };

describe("TaskTerminalPanel", () => {
  let root: Root;
  let container: HTMLDivElement;
  let queryClient: QueryClient;

  beforeEach(() => {
    terminalApiMock.list.mockReset();
    terminalApiMock.create.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
  });

  async function render() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TaskTerminalPanel issue={issue} active />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }

  it("reattaches to the task's running local session instead of creating another", async () => {
    terminalApiMock.list.mockResolvedValue([
      session({ id: "other-task", issueId: "task-2" }),
      session({ id: "ended", status: "exited" }),
      session({ id: "task-session" }),
    ]);
    await render();

    expect(terminalApiMock.create).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="terminal-view-stub"]')?.textContent).toBe("task-session");
  });

  it("creates a local session bound to the issue when none is running", async () => {
    terminalApiMock.list.mockResolvedValue([session({ id: "other-task", issueId: "task-2" })]);
    terminalApiMock.create.mockResolvedValue(session({ id: "created" }));
    await render();

    expect(terminalApiMock.create).toHaveBeenCalledTimes(1);
    expect(terminalApiMock.create).toHaveBeenCalledWith("company-1", { kind: "local", issueId: "task-1", title: "PAP-1" });
    expect(container.querySelector('[data-testid="terminal-view-stub"]')?.textContent).toBe("created");
  });

  it("shows a clear error when the server refuses terminal access", async () => {
    terminalApiMock.list.mockRejectedValue(new ApiError("Instance admin access required", 403, null));
    await render();

    expect(terminalApiMock.create).not.toHaveBeenCalled();
    const error = container.querySelector('[data-testid="task-terminal-error"]');
    expect(error?.textContent).toContain("Terminal access is limited to board operators.");
    expect(error?.textContent).toContain("Instance admin access required");
  });
});
