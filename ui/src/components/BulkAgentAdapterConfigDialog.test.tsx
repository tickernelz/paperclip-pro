// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgentAdapterConfigBatchPreview } from "@tickernelz/paperclip-pro-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BulkAgentAdapterConfigDialog } from "./BulkAgentAdapterConfigDialog";

const mockAgentsApi = vi.hoisted(() => ({
  batchAdapterConfigPreview: vi.fn(),
  batchAdapterConfig: vi.fn(),
}));

vi.mock("../api/agents", () => ({ agentsApi: mockAgentsApi }));

const OPUS = "sub2api-claude/claude-opus-5-5";
const GPT = "sub2api-claude/gpt-5";

const OPTIONS = [
  { value: OPUS, label: "Claude Opus 5.5", group: "sub2api-claude", name: "Claude Opus 5.5", efforts: ["low", "medium", "high", "xhigh", "max"] },
  { value: GPT, label: "GPT-5", group: "sub2api-claude", name: "GPT-5", efforts: ["minimal", "low", "medium", "high"] },
];

const PREVIEW: AgentAdapterConfigBatchPreview = {
  fields: [
    { key: "model", label: "Model", hint: null, freeText: true, options: OPTIONS },
    {
      key: "fallbackModels",
      label: "Fallback models",
      hint: null,
      freeText: true,
      options: OPTIONS,
      list: { maxItems: 5, distinctFromKey: "model" },
    },
    {
      key: "thinking",
      label: "OMP thinking override",
      hint: null,
      freeText: false,
      options: ["auto", "low", "medium", "high", "xhigh", "max"].map((value) => ({ value, label: value })),
    },
  ],
  agents: [
    {
      agentId: "agent-omp",
      name: "Arif",
      adapterType: "omp_local",
      eligible: true,
      reason: null,
      current: {},
      currentLists: { fallbackModels: [] },
    },
  ],
};

let root: Root;
let container: HTMLDivElement;
let queryClient: QueryClient;

const byTestId = <T extends Element = HTMLElement>(id: string) => document.body.querySelector<T>(`[data-testid="${id}"]`);
const $ = <T extends Element = HTMLElement>(selector: string) => document.body.querySelector<T>(selector);
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mockAgentsApi.batchAdapterConfigPreview.mockResolvedValue(PREVIEW);
  mockAgentsApi.batchAdapterConfig.mockResolvedValue({ updated: 1, unchanged: 0, results: [{ agentId: "agent-omp", name: "Arif", status: "updated", changedKeys: ["thinking"] }] });
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  queryClient.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function renderDialog() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <BulkAgentAdapterConfigDialog
          companyId="company-1"
          agentIds={["agent-omp"]}
          open
          onOpenChange={() => {}}
        />
      </QueryClientProvider>,
    );
  });
  await settle();
}

async function pickModel(user: ReturnType<typeof userEvent.setup>, value: string) {
  const select = byTestId<HTMLSelectElement>("bulk-agent-config-field-model")!;
  await act(async () => { await user.selectOptions(select, "Set to…"); });
  await act(async () => { await user.click(byTestId("bulk-agent-config-custom-model-trigger")!); });
  await act(async () => { await user.click($(`[data-testid="bulk-agent-config-custom-model-option"][data-value="${value}"]`)!); });
  await settle();
}

describe("bulk agent model change", () => {
  it("offers the level beside the model instead of a separate thinking field", async () => {
    const user = userEvent.setup();
    await renderDialog();
    expect(byTestId("bulk-agent-config-field-thinking")).toBeNull();
    expect(byTestId("bulk-agent-config-field-model")).not.toBeNull();

    await pickModel(user, OPUS);
    const chips = [...document.querySelectorAll('[data-testid="bulk-agent-config-custom-model-effort"] [role="radio"]')].map((chip) => chip.textContent);
    expect(chips).toEqual(["Adapter default", "low", "medium", "high", "xhigh", "max"]);
  });

  it("sends the picked level with the model as the agent's thinking value", async () => {
    const user = userEvent.setup();
    await renderDialog();
    await pickModel(user, OPUS);
    await act(async () => { await user.click(byTestId("bulk-agent-config-custom-model-effort-xhigh")!); });
    await settle();
    await act(async () => { await user.click(byTestId("bulk-agent-config-submit")!); });
    await act(async () => { await user.click(byTestId("bulk-agent-config-submit")!); });
    await settle();

    expect(mockAgentsApi.batchAdapterConfig).toHaveBeenCalledWith(["agent-omp"], { model: OPUS, thinking: "xhigh" });
  });

  it("re-lists the level choices for the model the batch would set", async () => {
    const user = userEvent.setup();
    await renderDialog();
    await pickModel(user, GPT);
    const chips = [...document.querySelectorAll('[data-testid="bulk-agent-config-custom-model-effort"] [role="radio"]')].map((chip) => chip.textContent);
    expect(chips).toEqual(["Adapter default", "minimal", "low", "medium", "high"]);
  });

  it("carries a per-fallback level on the replaced list", async () => {
    const user = userEvent.setup();
    await renderDialog();
    const listSelect = byTestId<HTMLSelectElement>("bulk-agent-config-field-fallbackModels")!;
    await act(async () => { await user.selectOptions(listSelect, "Replace list"); });
    await act(async () => { await user.click(byTestId("bulk-agent-config-list-fallbackModels-add")!); });
    await act(async () => { await user.click($(`[data-testid="bulk-agent-config-list-fallbackModels-add-option"][data-value="${GPT}"]`)!); });
    await settle();
    await act(async () => { await user.click(byTestId("bulk-agent-config-list-fallbackModels-effort")!); });
    await act(async () => { await user.click(byTestId("bulk-agent-config-list-fallbackModels-effort-chips-minimal")!); });
    await settle();
    await act(async () => { await user.click(byTestId("bulk-agent-config-submit")!); });
    await act(async () => { await user.click(byTestId("bulk-agent-config-submit")!); });
    await settle();

    expect(mockAgentsApi.batchAdapterConfig).toHaveBeenCalledWith(["agent-omp"], {
      fallbackModels: [GPT],
      modelEfforts: { [GPT]: "minimal" },
    });
  });
});
