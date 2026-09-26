// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IssueRunModelOverrideView } from "@tickernelz/paperclip-pro-shared";
import { issuesApi } from "@/api/issues";
import { TaskModelOverrideControl } from "./TaskModelOverrideControl";

vi.mock("@/api/issues", () => ({
  issuesApi: { getModelOverride: vi.fn(), setModelOverride: vi.fn() },
}));

function view(
  overrides: { model?: string | null; thinking?: string | null } = {},
): IssueRunModelOverrideView {
  return {
    issueId: "issue-1",
    agentId: "agent-1",
    adapterType: "omp_local",
    supported: true,
    unsupportedReason: null,
    fields: [
      {
        key: "model",
        label: "Model",
        hint: null,
        freeText: true,
        options: [
          { value: "vendor/fast", label: "Fast" },
          { value: "vendor/deep", label: "Deep" },
        ],
        agentDefault: "vendor/agent-default",
        override: overrides.model ?? null,
        effective: overrides.model ?? "vendor/agent-default",
      },
      {
        key: "thinking",
        label: "Thinking",
        hint: null,
        freeText: false,
        options: [
          { value: "low", label: "low" },
          { value: "high", label: "high" },
        ],
        agentDefault: "low",
        override: overrides.thinking ?? null,
        effective: overrides.thinking ?? "low",
      },
    ],
    inheritance: {
      inheritToSubtasks: true,
      subtaskScope: "new",
      inherited: false,
      sourceIssueId: null,
    },
    propagation: null,
  };
}

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;

function node<T extends Element>(testId: string): T {
  const element = document.querySelector<T>(`[data-testid="${testId}"]`);
  if (!element) throw new Error(`Missing ${testId}`);
  return element;
}

async function render() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <TaskModelOverrideControl issueId="issue-1" />
      </QueryClientProvider>,
    );
  });
}

async function openPanel() {
  await act(async () => {
    node<HTMLButtonElement>("task-chat-composer-model-override").click();
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
});

describe("per-task model override control", () => {
  it("shows the agent default as the effective value when nothing is overridden", async () => {
    vi.mocked(issuesApi.getModelOverride).mockResolvedValue(view());
    await render();
    await vi.waitFor(() =>
      expect(
        node("task-chat-composer-model-override").getAttribute("data-has-override"),
      ).toBe("false"),
    );
    expect(node("task-chat-composer-model-override").textContent).toContain(
      "agent-default",
    );
    await openPanel();
    expect(node("task-model-override-effective-thinking").textContent).toBe("low");
  });

  it("shows the override rather than the agent default once one is set", async () => {
    vi.mocked(issuesApi.getModelOverride).mockResolvedValue(
      view({ model: "vendor/deep", thinking: "high" }),
    );
    await render();
    await vi.waitFor(() =>
      expect(
        node("task-chat-composer-model-override").getAttribute("data-has-override"),
      ).toBe("true"),
    );
    expect(node("task-chat-composer-model-override").textContent).toContain("deep");
    expect(node("task-chat-composer-model-override").textContent).toContain("high");
  });

  it("sets the override from an enumerated option", async () => {
    vi.mocked(issuesApi.getModelOverride).mockResolvedValue(view());
    vi.mocked(issuesApi.setModelOverride).mockResolvedValue(view({ thinking: "high" }));
    await render();
    await vi.waitFor(() => node("task-chat-composer-model-override"));
    await openPanel();
    await act(async () => {
      node<HTMLButtonElement>("task-model-override-option-thinking-high").click();
    });
    expect(issuesApi.setModelOverride).toHaveBeenCalledWith("issue-1", {
      thinking: "high",
    });
    await vi.waitFor(() =>
      expect(
        node("task-chat-composer-model-override").getAttribute("data-has-override"),
      ).toBe("true"),
    );
  });

  it("clears the override through the agent default option", async () => {
    vi.mocked(issuesApi.getModelOverride).mockResolvedValue(
      view({ model: "vendor/deep" }),
    );
    vi.mocked(issuesApi.setModelOverride).mockResolvedValue(view());
    await render();
    await vi.waitFor(() => node("task-chat-composer-model-override"));
    await openPanel();
    await act(async () => {
      node<HTMLButtonElement>("task-model-override-default-model").click();
    });
    expect(issuesApi.setModelOverride).toHaveBeenCalledWith("issue-1", {
      model: null,
    });
    await vi.waitFor(() =>
      expect(
        node("task-chat-composer-model-override").getAttribute("data-has-override"),
      ).toBe("false"),
    );
  });

  it("renders nothing when the assignee's adapter exposes no model settings", async () => {
    vi.mocked(issuesApi.getModelOverride).mockResolvedValue({
      issueId: "issue-1",
      agentId: null,
      adapterType: null,
      supported: false,
      unsupportedReason: "This task has no agent assignee.",
      fields: [],
      inheritance: {
        inheritToSubtasks: true,
        subtaskScope: "new",
        inherited: false,
        sourceIssueId: null,
      },
      propagation: null,
    });
    await render();
    await vi.waitFor(() => expect(issuesApi.getModelOverride).toHaveBeenCalled());
    expect(
      document.querySelector('[data-testid="task-chat-composer-model-override"]'),
    ).toBeNull();
  });

  it("surfaces a rejected override instead of silently keeping the old value", async () => {
    vi.mocked(issuesApi.getModelOverride).mockResolvedValue(view());
    vi.mocked(issuesApi.setModelOverride).mockRejectedValue(
      new Error("Thinking must be one of: low, high."),
    );
    await render();
    await vi.waitFor(() => node("task-chat-composer-model-override"));
    await openPanel();
    await act(async () => {
      node<HTMLButtonElement>("task-model-override-option-thinking-high").click();
    });
    await vi.waitFor(() =>
      expect(node("task-model-override-error").textContent).toContain("must be one of"),
    );
  });
});
