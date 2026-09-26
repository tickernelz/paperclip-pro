// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentAdapterConfigBatchPreview,
  IssueRunModelOverrideView,
} from "@tickernelz/paperclip-pro-shared";
import { agentsApi } from "@/api/agents";
import { issuesApi } from "@/api/issues";
import { TaskModelOverrideControl } from "./TaskModelOverrideControl";

vi.mock("@/api/issues", () => ({
  issuesApi: { getModelOverride: vi.fn(), setModelOverride: vi.fn() },
}));

vi.mock("@/api/agents", () => ({
  agentsApi: { batchAdapterConfigPreview: vi.fn() },
}));

function view(
  overrides: { model?: string | null; thinking?: string | null } = {},
  state: {
    inheritance?: Partial<IssueRunModelOverrideView["inheritance"]>;
    propagation?: IssueRunModelOverrideView["propagation"];
  } = {},
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
      ...state.inheritance,
    },
    propagation: state.propagation ?? null,
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

async function renderWithSubtaskRows() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <TaskModelOverrideControl issueId="issue-1" subtaskRows />
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

  it("expands only one field at a time on mobile so the sheet stays compact", async () => {
    vi.mocked(issuesApi.getModelOverride).mockResolvedValue(view());
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <TaskModelOverrideControl issueId="issue-1" mobile />
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(() => node("task-chat-composer-model-override"));
    await openPanel();

    expect(node("task-model-override-section-model").getAttribute("data-expanded")).toBe("true");
    expect(node("task-model-override-section-thinking").getAttribute("data-expanded")).toBe("false");
    expect(
      document.querySelector('[data-testid="task-model-override-option-thinking-high"]'),
    ).toBeNull();

    await act(async () => {
      node<HTMLButtonElement>("task-model-override-toggle-thinking").click();
    });

    expect(node("task-model-override-section-model").getAttribute("data-expanded")).toBe("false");
    expect(node("task-model-override-section-thinking").getAttribute("data-expanded")).toBe("true");
    expect(
      document.querySelector('[data-testid="task-model-override-option-model-vendor/deep"]'),
    ).toBeNull();
    expect(node("task-model-override-option-thinking-high")).toBeTruthy();
  });

  it("expands the first field when the adapter publishes no model field", async () => {
    const thinkingOnly = view();
    thinkingOnly.fields = thinkingOnly.fields.filter((field) => field.key === "thinking");
    vi.mocked(issuesApi.getModelOverride).mockResolvedValue(thinkingOnly);
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <TaskModelOverrideControl issueId="issue-1" mobile />
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(() => node("task-chat-composer-model-override"));
    await openPanel();

    expect(node("task-model-override-section-thinking").getAttribute("data-expanded")).toBe("true");
    expect(node("task-model-override-option-thinking-high")).toBeTruthy();
  });

  it("keeps both fields expanded on desktop", async () => {
    vi.mocked(issuesApi.getModelOverride).mockResolvedValue(view());
    await render();
    await vi.waitFor(() => node("task-chat-composer-model-override"));
    await openPanel();

    expect(node("task-model-override-section-model").getAttribute("data-expanded")).toBe("true");
    expect(node("task-model-override-section-thinking").getAttribute("data-expanded")).toBe("true");
    expect(
      document.querySelector('[data-testid="task-model-override-toggle-model"]'),
    ).toBeNull();
  });

  it("offers a dismiss affordance and the current value in the mobile sheet header", async () => {
    vi.mocked(issuesApi.getModelOverride).mockResolvedValue(view({ model: "vendor/deep" }));
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <TaskModelOverrideControl issueId="issue-1" mobile />
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(() => node("task-chat-composer-model-override"));
    await openPanel();

    const header = document.querySelector("[data-mobile-sheet-header]");
    expect(header).not.toBeNull();
    expect(header?.textContent).toContain("Task model");
    expect(header?.textContent).toContain("deep");

    await act(async () => {
      header?.querySelector<HTMLButtonElement>("[data-mobile-sheet-close]")?.click();
    });

    expect(document.querySelector('[data-testid="task-model-override-panel"]')).toBeNull();
  });
});

const chatPreview: AgentAdapterConfigBatchPreview = {
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
    },
  ],
  agents: [
    {
      agentId: "agent-1",
      name: "Arif",
      adapterType: "omp_local",
      eligible: true,
      reason: null,
      current: { model: "vendor/agent-default", thinking: "low" },
    },
  ],
};

describe("agent chat model override", () => {
  async function renderConversation(resolve: () => Promise<string>) {
    vi.mocked(agentsApi.batchAdapterConfigPreview).mockResolvedValue(chatPreview);
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <TaskModelOverrideControl
            issueId=""
            pendingIssue={{ companyId: "company-1", agentId: "agent-1", resolve }}
          />
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(() => node("task-chat-composer-model-override"));
  }

  it("creates nothing when the picker is opened and dismissed", async () => {
    const resolve = vi.fn().mockResolvedValue("chat-issue");
    await renderConversation(resolve);
    await openPanel();
    await vi.waitFor(() => node("task-model-override-option-thinking-high"));

    expect(node("task-model-override-effective-model").textContent).toBe(
      "vendor/agent-default",
    );
    expect(resolve).not.toHaveBeenCalled();
    expect(issuesApi.getModelOverride).not.toHaveBeenCalled();
    expect(issuesApi.setModelOverride).not.toHaveBeenCalled();

    await act(async () => {
      node<HTMLButtonElement>("task-chat-composer-model-override").click();
    });
    expect(document.querySelector('[data-testid="task-model-override-panel"]')).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("creates the conversation issue on the first pick and reuses it afterwards", async () => {
    const resolve = vi.fn().mockResolvedValue("chat-issue");
    vi.mocked(issuesApi.getModelOverride).mockResolvedValue(view({ thinking: "high" }));
    vi.mocked(issuesApi.setModelOverride).mockResolvedValue(view({ thinking: "high" }));
    await renderConversation(resolve);
    await openPanel();
    await vi.waitFor(() => node("task-model-override-option-thinking-high"));

    await act(async () => {
      node<HTMLButtonElement>("task-model-override-option-thinking-high").click();
    });
    await vi.waitFor(() =>
      expect(issuesApi.setModelOverride).toHaveBeenCalledWith("chat-issue", {
        thinking: "high",
      }),
    );
    expect(resolve).toHaveBeenCalledTimes(1);

    vi.mocked(issuesApi.setModelOverride).mockResolvedValue(
      view({ thinking: "high", model: "vendor/deep" }),
    );
    await act(async () => {
      node<HTMLButtonElement>("task-model-override-option-model-vendor/deep").click();
    });
    await vi.waitFor(() =>
      expect(issuesApi.setModelOverride).toHaveBeenCalledWith("chat-issue", {
        model: "vendor/deep",
      }),
    );
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("keeps the agent default a no-op while no override and no issue exist", async () => {
    const resolve = vi.fn().mockResolvedValue("chat-issue");
    await renderConversation(resolve);
    await openPanel();
    await vi.waitFor(() => node("task-model-override-default-model"));

    await act(async () => {
      node<HTMLButtonElement>("task-model-override-default-model").click();
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(issuesApi.setModelOverride).not.toHaveBeenCalled();
  });

  it("resolves one issue for two picks fired before the first one lands", async () => {
    let release: (id: string) => void = () => {};
    const resolve = vi.fn().mockReturnValue(
      new Promise<string>((resolvePromise) => {
        release = resolvePromise;
      }),
    );
    vi.mocked(issuesApi.getModelOverride).mockResolvedValue(view({ thinking: "high" }));
    vi.mocked(issuesApi.setModelOverride).mockResolvedValue(view({ thinking: "high" }));
    await renderConversation(resolve);
    await openPanel();
    await vi.waitFor(() => node("task-model-override-option-thinking-high"));

    await act(async () => {
      node<HTMLButtonElement>("task-model-override-option-thinking-high").click();
      node<HTMLButtonElement>("task-model-override-option-model-vendor/deep").click();
    });
    expect(resolve).toHaveBeenCalledTimes(1);

    await act(async () => {
      release("chat-issue");
    });
    await vi.waitFor(() =>
      expect(vi.mocked(issuesApi.setModelOverride).mock.calls.map((call) => call[0])).toEqual([
        "chat-issue",
        "chat-issue",
      ]),
    );
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("keeps the subtask switches out of the conversation picker", async () => {
    await renderConversation(vi.fn().mockResolvedValue("chat-issue"));
    await openPanel();
    await vi.waitFor(() => node("task-model-override-panel"));
    expect(
      document.querySelector('[data-testid="task-model-override-footer"]'),
    ).toBeNull();
  });

  it("keeps the subtask switches out of a picker that was not asked for them", async () => {
    vi.mocked(issuesApi.getModelOverride).mockResolvedValue(view());
    await render();
    await vi.waitFor(() => node("task-chat-composer-model-override"));
    await openPanel();
    expect(
      document.querySelector('[data-testid="task-model-override-footer"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-testid="task-model-override-inherit"]'),
    ).toBeNull();
  });

  it("renders nothing for a task that has neither an id nor a conversation resolver", async () => {
    vi.mocked(issuesApi.getModelOverride).mockResolvedValue(view());
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <TaskModelOverrideControl issueId="" />
        </QueryClientProvider>,
      );
    });
    expect(
      document.querySelector('[data-testid="task-chat-composer-model-override"]'),
    ).toBeNull();
    expect(issuesApi.getModelOverride).not.toHaveBeenCalled();
  });
});
describe("existing task subtask switches", () => {
  it("reflects the stored inheritance and writes the toggle through the issue endpoint", async () => {
    vi.mocked(issuesApi.getModelOverride).mockResolvedValue(
      view({}, { inheritance: { inheritToSubtasks: false, subtaskScope: "new" } }),
    );
    vi.mocked(issuesApi.setModelOverride).mockResolvedValue(
      view({}, { inheritance: { inheritToSubtasks: true, subtaskScope: "new" } }),
    );
    await renderWithSubtaskRows();
    await vi.waitFor(() => node("task-chat-composer-model-override"));
    await openPanel();

    expect(
      node("task-model-override-inherit").getAttribute("aria-checked"),
    ).toBe("false");
    expect(
      document.querySelector('[data-testid="task-model-override-scope-new"]'),
    ).toBeNull();

    await act(async () => {
      node<HTMLButtonElement>("task-model-override-inherit").click();
    });

    expect(issuesApi.setModelOverride).toHaveBeenCalledWith("issue-1", {
      inheritToSubtasks: true,
      subtaskScope: "new",
    });
    await vi.waitFor(() =>
      expect(node("task-model-override-scope-new")).toBeTruthy(),
    );
  });

  it("sends the scope switch so the server walks the existing subtree and reports the counts", async () => {
    vi.mocked(issuesApi.getModelOverride).mockResolvedValue(view());
    vi.mocked(issuesApi.setModelOverride).mockResolvedValue(
      view(
        {},
        {
          inheritance: { inheritToSubtasks: true, subtaskScope: "new_and_existing" },
          propagation: { applied: 2, skipped: 1, visited: 3, limitReached: false },
        },
      ),
    );
    await renderWithSubtaskRows();
    await vi.waitFor(() => node("task-chat-composer-model-override"));
    await openPanel();

    expect(
      node("task-model-override-scope-new").getAttribute("aria-checked"),
    ).toBe("true");

    await act(async () => {
      node<HTMLButtonElement>("task-model-override-scope-new_and_existing").click();
    });

    expect(issuesApi.setModelOverride).toHaveBeenCalledWith("issue-1", {
      inheritToSubtasks: true,
      subtaskScope: "new_and_existing",
    });
    await vi.waitFor(() =>
      expect(node("task-model-override-propagation").textContent).toContain(
        "2 of 3 subtasks updated",
      ),
    );
    expect(node("task-model-override-propagation").textContent).toContain(
      "1 kept their own model",
    );
    expect(
      document.querySelector('[data-testid="task-model-override-propagation-warning"]'),
    ).toBeNull();
  });

  it("warns when the subtree walk stopped at the safety limit", async () => {
    vi.mocked(issuesApi.getModelOverride).mockResolvedValue(
      view(
        {},
        {
          inheritance: { inheritToSubtasks: true, subtaskScope: "new_and_existing" },
          propagation: { applied: 500, skipped: 0, visited: 500, limitReached: true },
        },
      ),
    );
    await renderWithSubtaskRows();
    await vi.waitFor(() => node("task-chat-composer-model-override"));
    await openPanel();

    expect(node("task-model-override-propagation-warning").textContent).toContain(
      "safety limit",
    );
  });

  it("surfaces a rejected subtask change and keeps the stored value", async () => {
    vi.mocked(issuesApi.getModelOverride).mockResolvedValue(view());
    vi.mocked(issuesApi.setModelOverride).mockRejectedValue(
      new Error("Only the task owner can change this."),
    );
    await renderWithSubtaskRows();
    await vi.waitFor(() => node("task-chat-composer-model-override"));
    await openPanel();

    await act(async () => {
      node<HTMLButtonElement>("task-model-override-inherit").click();
    });

    await vi.waitFor(() =>
      expect(node("task-model-override-error").textContent).toContain(
        "task owner",
      ),
    );
    expect(node("task-model-override-inherit").getAttribute("aria-checked")).toBe(
      "true",
    );
  });
});
