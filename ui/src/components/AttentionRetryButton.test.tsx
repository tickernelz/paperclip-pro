// @vitest-environment jsdom

import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { useState, type AnchorHTMLAttributes, type ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Agent, AttentionItem } from "@tickernelz/paperclip-pro-shared";
import { agentsApi } from "../api/agents";
import type { LiveRunForIssue } from "../api/heartbeats";
import { issuesApi } from "../api/issues";
import { ToastProvider } from "../context/ToastContext";
import { AttentionQueueRow } from "./AttentionQueueRow";
import { ToastViewport } from "./ToastViewport";

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
}));

vi.mock("../api/agents", () => ({
  agentsApi: { retryFailedRun: vi.fn() },
}));

vi.mock("../api/issues", () => ({
  issuesApi: {
    resolveRecoveryAction: vi.fn(),
    acceptInteraction: vi.fn(),
    rejectInteraction: vi.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function act<T>(cb: () => T): T {
  let result: T | undefined;
  flushSync(() => {
    result = cb();
  });
  return result as T;
}

async function settle() {
  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    act(() => undefined);
  }
}

let root: ReturnType<typeof createRoot> | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.clearAllMocks();
});

function render(element: ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  act(() =>
    root?.render(
      <ToastProvider>
        <QueryClientProvider client={client}>
          {element}
          <ToastViewport />
        </QueryClientProvider>
      </ToastProvider>,
    ),
  );
  return container;
}

const BAYU = { id: "agent-bayu", name: "Bayu", status: "error", pauseReason: null } as unknown as Agent;

function agentMapOf(...agents: Agent[]) {
  return new Map(agents.map((agent) => [agent.id, agent]));
}

function baseItem(overrides: Partial<AttentionItem>): AttentionItem {
  return {
    id: "row",
    companyId: "c1",
    sourceKind: "failed_run",
    subject: {
      kind: "run",
      id: "run-1",
      companyId: "c1",
      title: "Bayu run failed",
      identifier: null,
      status: "failed",
      href: "/ZHA/agents/agent-bayu/runs/run-1",
      metadata: {},
    },
    whyNow: "",
    decisionVerbs: [],
    inlineResolvable: true,
    entryRule: "",
    exitRule: "",
    dedupKey: "run:run-1",
    dismissalKey: "attention:run:run-1",
    dismissal: null,
    severity: "high",
    rank: 0,
    activityAt: "2026-10-11T08:00:00Z",
    createdAt: "2026-10-11T08:00:00Z",
    updatedAt: "2026-10-11T08:00:00Z",
    relatedIssue: null,
    project: null,
    workspace: null,
    expiresAt: null,
    ruleKey: null,
    originAgentName: null,
    queues: [],
    shelf: false,
    retentionDays: 30,
    keep: false,
    archivedAt: null,
    retentionVersion: 1,
    decideBy: null,
    decideByAttribution: null,
    snoozedUntil: null,
    detail: null,
    trainingExampleId: null,
    ...overrides,
  };
}

function relatedIssue(status: string, assigneeAgentId: string | null = "agent-bayu"): AttentionItem["relatedIssue"] {
  return {
    kind: "issue",
    id: "issue-1442",
    companyId: "c1",
    title: "Kaitech dev task",
    identifier: "ZHA-1442",
    status,
    href: "/ZHA/issues/ZHA-1442",
    metadata: { assigneeAgentId, assigneeUserId: null },
  };
}

function failedRunItem(issueStatus = "in_progress"): AttentionItem {
  return baseItem({
    id: "failed_run:run:run-1",
    subject: {
      kind: "run",
      id: "run-1",
      companyId: "c1",
      title: "Bayu (Kaitech Dev) run failed",
      identifier: null,
      status: "failed",
      href: "/ZHA/agents/agent-bayu/runs/run-1",
      metadata: { agentId: "agent-bayu", agentName: "Bayu", issueId: "issue-1442", error: "503 No available accounts" },
    },
    relatedIssue: relatedIssue(issueStatus),
  });
}

function recoveryItem(cause = "run_failed"): AttentionItem {
  return baseItem({
    id: "recovery_action:recovery-1",
    sourceKind: "recovery_action",
    subject: {
      kind: "recovery_action",
      id: "recovery-1",
      companyId: "c1",
      title: "Board operator: inspect the evidence, repair the runtime if appropriate, then explicitly retry the original owner, reassign, or intentionally resolve the task.",
      identifier: null,
      status: "escalated",
      href: "/ZHA/issues/ZHA-1442",
      metadata: { kind: "stranded", cause, ownerType: "board", sourceIssueId: "issue-1442", recoveryIssueId: null },
    },
    relatedIssue: relatedIssue("blocked"),
  });
}

function Desk({
  items,
  agentMap,
  liveRuns,
}: {
  items: AttentionItem[];
  agentMap?: Map<string, Agent>;
  liveRuns?: LiveRunForIssue[];
}) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  return (
    <div>
      {items.filter((item) => !hidden.has(item.id)).map((item) => (
        <AttentionQueueRow
          key={item.id}
          item={item}
          companyId="c1"
          expanded={false}
          onToggleExpand={() => {}}
          onDismiss={() => {}}
          agentMap={agentMap}
          liveRuns={liveRuns}
          onRetried={(retried) => setHidden((prev) => new Set(prev).add(retried.id))}
        />
      ))}
    </div>
  );
}

function retryButton(): HTMLButtonElement | null {
  return container?.querySelector<HTMLButtonElement>("button[data-attention-retry]") ?? null;
}

function click(button: HTMLElement | null) {
  act(() => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function rowCount() {
  return container?.querySelectorAll("[data-attention-row]").length ?? 0;
}

function disabledReason(): string | null {
  const button = retryButton();
  const id = button?.getAttribute("aria-describedby");
  return id ? document.getElementById(id)?.textContent ?? null : null;
}

describe("desk Retry", () => {
  it("retries a failed run through the exact failed-run wake and hides the card", async () => {
    vi.mocked(agentsApi.retryFailedRun).mockResolvedValue({ runId: "run-2", issueId: null });
    render(<Desk items={[failedRunItem()]} agentMap={agentMapOf(BAYU)} />);

    const button = retryButton();
    expect(button?.getAttribute("data-attention-retry")).toBe("failed_run");
    expect(button?.getAttribute("aria-label")).toBe("Retry with Bayu");
    expect(button?.nextElementSibling?.textContent).toContain("Open");

    click(button);
    await settle();

    expect(agentsApi.retryFailedRun).toHaveBeenCalledTimes(1);
    expect(agentsApi.retryFailedRun).toHaveBeenCalledWith("agent-bayu", "run-1", "c1");
    expect(rowCount()).toBe(0);
    expect(document.body.textContent).toContain("Retrying with Bayu");
  });

  it("resolves a recovery with the retry-owner outcome and hides the card", async () => {
    vi.mocked(issuesApi.resolveRecoveryAction).mockResolvedValue({
      issue: { id: "issue-1442", status: "todo", assigneeAgentId: "agent-bayu" },
      recoveryAction: { id: "recovery-1" },
    } as never);
    render(<Desk items={[recoveryItem()]} agentMap={agentMapOf(BAYU)} />);

    expect(retryButton()?.getAttribute("data-attention-retry")).toBe("recovery");
    click(retryButton());
    await settle();

    expect(issuesApi.resolveRecoveryAction).toHaveBeenCalledWith("issue-1442", {
      actionId: "recovery-1",
      outcome: "restored",
      sourceIssueStatus: "todo",
    });
    expect(agentsApi.retryFailedRun).not.toHaveBeenCalled();
    expect(rowCount()).toBe(0);
    expect(document.body.textContent).toContain("Retrying with Bayu");
  });

  it("explains a paused owner and does not call the API", async () => {
    const paused = { ...BAYU, status: "paused", pauseReason: "manual" } as Agent;
    render(<Desk items={[failedRunItem()]} agentMap={agentMapOf(paused)} />);

    expect(retryButton()?.getAttribute("aria-disabled")).toBe("true");
    expect(disabledReason()).toBe("Bayu is paused. Resume it before retrying.");
    click(retryButton());
    await settle();
    expect(agentsApi.retryFailedRun).not.toHaveBeenCalled();
    expect(rowCount()).toBe(1);
  });

  it("explains a budget-stopped owner on a recovery", () => {
    const budget = { ...BAYU, status: "paused", pauseReason: "budget" } as Agent;
    render(<Desk items={[recoveryItem()]} agentMap={agentMapOf(budget)} />);
    expect(disabledReason()).toBe("Bayu is stopped by its budget.");
  });

  it("explains a task that is already done", async () => {
    render(<Desk items={[failedRunItem("done")]} agentMap={agentMapOf(BAYU)} />);
    expect(retryButton()?.getAttribute("aria-disabled")).toBe("true");
    expect(disabledReason()).toBe("The task is already done.");
    click(retryButton());
    await settle();
    expect(agentsApi.retryFailedRun).not.toHaveBeenCalled();
  });

  it("explains a run that is already live on the task", async () => {
    const live = [{ id: "run-live", agentId: "agent-bayu", issueId: "issue-1442", status: "running" }] as LiveRunForIssue[];
    render(<Desk items={[failedRunItem(), recoveryItem()]} agentMap={agentMapOf(BAYU)} liveRuns={live} />);
    const buttons = container?.querySelectorAll<HTMLButtonElement>("button[data-attention-retry]") ?? [];
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.getAttribute("aria-disabled")).toBe("true");
      expect(document.getElementById(button.getAttribute("aria-describedby") ?? "")?.textContent)
        .toBe("A run is already live or queued for this task.");
      click(button);
    }
    await settle();
    expect(agentsApi.retryFailedRun).not.toHaveBeenCalled();
    expect(issuesApi.resolveRecoveryAction).not.toHaveBeenCalled();
  });

  it("keeps a recovery that needs reconciliation on the task page", () => {
    render(<Desk items={[recoveryItem("uncertain_provider_action")]} agentMap={agentMapOf(BAYU)} />);
    expect(disabledReason()).toBe("This recovery needs an execution reconciliation. Open the task to record it.");
  });

  it("surfaces the server error and keeps the card", async () => {
    vi.mocked(agentsApi.retryFailedRun).mockRejectedValue(new Error("The task is no longer assigned to this agent."));
    render(<Desk items={[failedRunItem()]} agentMap={agentMapOf(BAYU)} />);

    click(retryButton());
    await settle();

    expect(rowCount()).toBe(1);
    expect(document.body.textContent).toContain("Could not retry");
    expect(document.body.textContent).toContain("The task is no longer assigned to this agent.");
    expect(retryButton()?.disabled).toBe(false);
  });

  it("submits once when clicked twice before the first retry settles", async () => {
    let resolveRetry: (value: { runId: string; issueId: null }) => void = () => {};
    vi.mocked(agentsApi.retryFailedRun).mockImplementation(
      () => new Promise((resolve) => {
        resolveRetry = resolve;
      }),
    );
    render(<Desk items={[failedRunItem()]} agentMap={agentMapOf(BAYU)} />);

    const button = retryButton();
    click(button);
    click(button);
    await settle();
    expect(retryButton()?.disabled).toBe(true);
    expect(retryButton()?.textContent).toContain("Retrying");
    click(retryButton());
    expect(agentsApi.retryFailedRun).toHaveBeenCalledTimes(1);

    resolveRetry({ runId: "run-2", issueId: null });
    await settle();
    expect(rowCount()).toBe(0);
  });

  it("offers no Retry on other rows", () => {
    render(
      <Desk
        items={[baseItem({ id: "approval", sourceKind: "approval", subject: { ...failedRunItem().subject, kind: "approval" } })]}
      />,
    );
    expect(retryButton()).toBeNull();
  });
});
