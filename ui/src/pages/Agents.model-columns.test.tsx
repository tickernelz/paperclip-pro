// @vitest-environment jsdom

import { act, type MouseEvent, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent, AgentAdapterConfigBatchPreview } from "@tickernelz/paperclip-pro-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { ToastProvider, useToastState } from "../context/ToastContext";
import { Agents } from "./Agents";

const mockNavigate = vi.hoisted(() => vi.fn());

const mockAgentsApi = vi.hoisted(() => ({
  list: vi.fn(),
  org: vi.fn(),
  batchAdapterConfigPreview: vi.fn(),
  batchAdapterConfig: vi.fn(),
  adapterModels: vi.fn(),
}));

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, onClick, ...props }: { children: ReactNode; to: string; onClick?: (event: MouseEvent) => void }) => (
    <a
      href={to}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) mockNavigate(to);
        event.preventDefault();
      }}
    >
      {children}
    </a>
  ),
  useLocation: () => ({ pathname: "/agents/all", search: "", hash: "", state: null }),
  useNavigate: () => mockNavigate,
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1" }),
}));

vi.mock("../context/DialogContext", () => ({
  useDialogActions: () => ({ openNewAgent: vi.fn() }),
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));

vi.mock("../context/SidebarContext", () => ({
  useSidebar: () => ({ isMobile: false }),
}));

vi.mock("../api/agents", () => ({ agentsApi: mockAgentsApi }));

vi.mock("../api/builtInAgents", () => ({
  builtInAgentsApi: { list: vi.fn().mockResolvedValue([]), provision: vi.fn(), reset: vi.fn() },
}));

vi.mock("../api/environments", () => ({
  environmentsApi: { list: vi.fn().mockResolvedValue([]), capabilities: vi.fn().mockResolvedValue(null) },
}));

vi.mock("../api/heartbeats", () => ({
  heartbeatsApi: { liveRunsForCompany: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../api/instanceSettings", () => ({
  instanceSettingsApi: {
    get: vi.fn().mockResolvedValue({
      id: "instance-settings-1",
      defaultEnvironmentId: null,
      experimental: { enableEnvironments: false, enableAgentChat: false, enableBuiltInAgents: false },
    }),
  },
}));

vi.mock("../api/resourceMemberships", () => ({
  resourceMembershipsApi: {
    listMine: vi.fn().mockResolvedValue({ projectMemberships: {}, agentMemberships: {}, updatedAt: null }),
    updateAgent: vi.fn(),
  },
}));

vi.mock("../adapters/adapter-display-registry", () => ({
  getAdapterLabel: (type: string) => `label:${type}`,
}));

const OPUS = "kaitech/claude-opus-5-5";
const GPT = "kaitech/gpt-5";
const MINI = "openai/gpt-5-mini";
const GLM = "zai/glm-5";
const FLASH = "google/gemini-3-flash";
const HAIKU = "anthropic/claude-haiku-5";
const SONNET = "anthropic/claude-sonnet-5";

const CATALOG = [
  { id: OPUS, label: "Claude Opus 5.5", provider: "kaitech", thinking: ["low", "medium", "high", "xhigh", "max"] },
  { id: GPT, label: "GPT-5", provider: "kaitech", thinking: ["minimal", "low", "medium", "high"] },
  { id: MINI, label: "GPT-5 mini", provider: "openai" },
  { id: GLM, label: "GLM 5", provider: "zai" },
  { id: FLASH, label: "Gemini 3 Flash", provider: "google" },
  { id: HAIKU, label: "Claude Haiku 5", provider: "anthropic" },
  { id: SONNET, label: "Claude Sonnet 5", provider: "anthropic" },
];

const SCHEMA_OPTIONS = CATALOG.map((model) => ({
  value: model.id,
  label: `${model.label} (${model.id})`,
  group: model.provider,
  name: model.label,
}));

function makeAgent(overrides: Partial<Agent>): Agent {
  return {
    id: "agent-omp",
    companyId: "company-1",
    name: "Alpha",
    urlKey: "alpha",
    role: "engineer",
    title: null,
    icon: null,
    status: "active",
    reportsTo: null,
    capabilities: null,
    adapterType: "omp_local",
    adapterConfig: {},
    runtimeConfig: {},
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    pauseReason: null,
    pausedAt: null,
    permissions: { canCreateAgents: false },
    lastHeartbeatAt: null,
    metadata: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

const ompPreview = (agentId: string): AgentAdapterConfigBatchPreview => ({
  fields: [
    { key: "model", label: "Model", hint: null, freeText: true, options: SCHEMA_OPTIONS },
    {
      key: "fallbackModels",
      label: "Fallback models",
      hint: null,
      freeText: true,
      options: SCHEMA_OPTIONS,
      list: { maxItems: 5, distinctFromKey: "model" },
    },
    {
      key: "thinking",
      label: "OMP thinking override",
      hint: null,
      freeText: false,
      options: ["auto", "low", "medium", "high", "xhigh"].map((value) => ({ value, label: value })),
    },
  ],
  agents: [{ agentId, name: "Alpha", adapterType: "omp_local", eligible: true, reason: null, current: {} }],
});

function ToastProbe() {
  const toasts = useToastState();
  return (
    <ul data-testid="toasts">
      {toasts.map((toast) => (
        <li key={toast.id} data-tone={toast.tone}>
          <span>{toast.title}</span>
          <span>{toast.body}</span>
          {toast.action?.onClick ? (
            <button type="button" data-testid="toast-action" onClick={toast.action.onClick}>
              {toast.action.label}
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

let root: Root;
let container: HTMLDivElement;
let queryClient: QueryClient;

const $ = <T extends Element = HTMLElement>(selector: string) => document.body.querySelector<T>(selector);
const byTestId = <T extends Element = HTMLElement>(id: string) => $<T>(`[data-testid="${id}"]`);
const toastsText = () => byTestId("toasts")?.textContent ?? "";

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

async function renderPage(agents: Agent[]) {
  mockAgentsApi.list.mockResolvedValue(agents);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <Agents />
          <ToastProbe />
        </ToastProvider>
      </QueryClientProvider>,
    );
  });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await settle();
    if (byTestId("agent-model-agent-omp")?.textContent?.includes("Claude Opus 5.5")) break;
  }
}

const alpha = (adapterConfig: Record<string, unknown>) =>
  makeAgent({ id: "agent-omp", name: "Alpha", adapterConfig });
const gamma = makeAgent({
  id: "agent-codex",
  name: "Gamma",
  urlKey: "gamma",
  adapterType: "codex_local",
  adapterConfig: { model: "gpt-5.4" },
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mockAgentsApi.org.mockResolvedValue([]);
  mockAgentsApi.batchAdapterConfigPreview.mockImplementation(async (agentIds: string[]) => {
    const [agentId] = agentIds;
    if (agentId !== "agent-codex") return ompPreview(agentId);
    return {
      fields: [],
      agents: [{ agentId, name: "Gamma", adapterType: "codex_local", eligible: false, reason: "no fields", current: {} }],
    };
  });
  mockAgentsApi.adapterModels.mockImplementation(async (_companyId: string, type: string) =>
    type === "omp_local" ? CATALOG : [],
  );
  mockAgentsApi.batchAdapterConfig.mockImplementation(async (agentIds: string[], values: Record<string, unknown>) => ({
    updated: 1,
    unchanged: 0,
    results: [{ agentId: agentIds[0], name: "Alpha", status: "updated", changedKeys: Object.keys(values) }],
  }));
});

afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("Agents table model columns", () => {
  it("shows the model name with its provider, fallback chips with overflow and the effort", async () => {
    await renderPage([alpha({ model: OPUS, fallbackModels: [GPT, MINI, GLM], thinking: "high" }), gamma]);

    const model = byTestId("agent-model-agent-omp")!;
    expect(model.tagName).toBe("BUTTON");
    expect(model.textContent).toContain("Claude Opus 5.5");
    expect(model.textContent).toContain("kaitech");
    expect(model.textContent).not.toContain(OPUS);
    expect(model.getAttribute("title")).toBe(OPUS);

    const fallbacks = byTestId("agent-fallbacks-agent-omp")!;
    expect(fallbacks.textContent).toContain("1GPT-5 · kaitech");
    expect(byTestId("agent-fallbacks-agent-omp-overflow")?.textContent).toBe("+2");

    expect(byTestId("agent-effort-agent-omp")?.textContent).toContain("high");
    expect(container.textContent).not.toContain("label:omp_local");
    expect(byTestId("agents-table-header")?.textContent).toContain("Fallback models");
    expect(mockAgentsApi.batchAdapterConfigPreview).toHaveBeenCalledTimes(2);
    expect(mockAgentsApi.adapterModels).toHaveBeenCalledWith("company-1", "omp_local", { provider: undefined });
  });

  it("shows a dash and no editor for fields the adapter does not support", async () => {
    await renderPage([alpha({ model: OPUS }), gamma]);

    expect(byTestId("agent-model-agent-codex")?.tagName).toBe("DIV");
    expect(byTestId("agent-model-agent-codex")?.textContent).toContain("gpt-5.4");
    expect(byTestId("agent-fallbacks-agent-codex")).toBeNull();
    expect(byTestId("agent-effort-agent-codex")).toBeNull();
    expect($('[aria-label="Fallback models not available"]')?.textContent).toBe("—");
    expect($('[aria-label="Model for Gamma"]')).toBeNull();
    expect($('[aria-label="Edit models for Gamma"]')).toBeNull();
    expect($('[aria-label="Edit models for Alpha"]')).not.toBeNull();
  });

  it("saves a model pick through the adapter config API, drops it from fallbacks and offers undo", async () => {
    const user = userEvent.setup();
    await renderPage([alpha({ model: OPUS, fallbackModels: [GPT, MINI], thinking: "high" }), gamma]);

    await act(async () => { await user.click(byTestId("agent-model-agent-omp")!); });
    expect(byTestId("agent-model-picker-agent-omp-listbox")).not.toBeNull();
    await act(async () => { await user.click(byTestId("agent-model-picker-agent-omp-search")!); });
    mockAgentsApi.list.mockResolvedValue([alpha({ model: GPT, fallbackModels: [MINI], thinking: "high" }), gamma]);
    await act(async () => {
      await user.click($(`[data-testid="agent-model-picker-agent-omp-option"][data-value="${GPT}"]`)!);
    });
    await settle();

    expect(mockAgentsApi.batchAdapterConfig).toHaveBeenCalledWith(["agent-omp"], { model: GPT });
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(byTestId("agent-model-agent-omp")?.textContent).toContain("GPT-5");
    expect(byTestId("agent-fallbacks-agent-omp")?.textContent).toContain("1GPT-5 mini");
    expect(byTestId("agent-fallbacks-agent-omp-overflow")).toBeNull();
    expect(toastsText()).toContain("Saved");
    expect(byTestId("toast-action")?.textContent).toBe("Undo");
  });

  it("picks the main model's effort from its own levels inside the model popover", async () => {
    const user = userEvent.setup();
    await renderPage([alpha({ model: OPUS, fallbackModels: [GPT], thinking: "high" }), gamma]);
    expect(byTestId("agent-model-agent-omp")?.textContent).toContain("high");

    await act(async () => { await user.click(byTestId("agent-model-agent-omp")!); });
    const chips = [...document.querySelectorAll('[data-testid="agent-effort-chips-agent-omp"] [role="radio"]')].map((chip) => chip.textContent);
    expect(chips).toEqual(["Default", "low", "medium", "high", "xhigh", "max"]);

    mockAgentsApi.list.mockResolvedValue([alpha({ model: OPUS, fallbackModels: [GPT], thinking: "xhigh" }), gamma]);
    await act(async () => { await user.click(byTestId("agent-effort-chips-agent-omp-xhigh")!); });
    await settle();
    expect(mockAgentsApi.batchAdapterConfig).toHaveBeenCalledWith(["agent-omp"], { thinking: "xhigh" });
    expect(byTestId("agent-model-agent-omp")?.textContent).toContain("xhigh");
  });

  it("clears the main effort when the new model does not list it", async () => {
    const user = userEvent.setup();
    await renderPage([alpha({ model: OPUS, thinking: "xhigh" }), gamma]);
    await act(async () => { await user.click(byTestId("agent-model-agent-omp")!); });
    await act(async () => {
      await user.click($(`[data-testid="agent-model-picker-agent-omp-option"][data-value="${GPT}"]`)!);
    });
    await settle();
    expect(mockAgentsApi.batchAdapterConfig).toHaveBeenCalledWith(["agent-omp"], { model: GPT, thinking: null });
  });

  it("keeps the fallback row's provider readable next to its effort control", async () => {
    const user = userEvent.setup();
    await renderPage([alpha({ model: OPUS, fallbackModels: [GLM], thinking: "high" }), gamma]);
    await act(async () => { await user.click(byTestId("agent-fallbacks-agent-omp")!); });
    const item = byTestId("agent-fallbacks-editor-agent-omp-item")!;
    const name = item.querySelector<HTMLElement>('[class*="truncate"]')!;
    const provider = item.querySelector<HTMLElement>('[class*="max-w-"]')!;
    expect(provider.textContent).toBe("zai");
    expect(provider.className).toContain("shrink-0");
    expect(name.className).toContain("flex-1");
    expect(item.textContent).toContain("GLM 5");
  });

  it("sets a fallback's own effort from the fallback editor and skips models without levels", async () => {
    const user = userEvent.setup();
    await renderPage([alpha({ model: OPUS, fallbackModels: [GPT, MINI], thinking: "high" }), gamma]);
    await act(async () => { await user.click(byTestId("agent-fallbacks-agent-omp")!); });
    const effortButtons = document.querySelectorAll('[data-testid="agent-fallbacks-editor-agent-omp-effort"]');
    expect(effortButtons).toHaveLength(1);
    await act(async () => { await user.click(effortButtons[0]!); });
    const levels = [...document.querySelectorAll('[data-testid="agent-fallbacks-editor-agent-omp-effort-chips"] [role="radio"]')].map((chip) => chip.textContent);
    expect(levels).toEqual(["Default", "minimal", "low", "medium", "high"]);
    await act(async () => { await user.click(byTestId("agent-fallbacks-editor-agent-omp-effort-chips-minimal")!); });
    await settle();
    expect(mockAgentsApi.batchAdapterConfig).toHaveBeenCalledWith(["agent-omp"], { modelEfforts: { [GPT]: "minimal" } });
  });

  it("keeps a stored fallback effort visible on a model whose catalog lists no levels", async () => {
    const user = userEvent.setup();
    await renderPage([
      alpha({ model: OPUS, fallbackModels: [MINI], thinking: "high", modelEfforts: { [MINI]: "low" } }),
      gamma,
    ]);
    await act(async () => { await user.click(byTestId("agent-fallbacks-agent-omp")!); });
    const button = byTestId("agent-fallbacks-editor-agent-omp-effort");
    expect(button?.textContent).toContain("low");
    await act(async () => { await user.click(button!); });
    await act(async () => { await user.click(byTestId("agent-fallbacks-editor-agent-omp-effort-chips-default")!); });
    await settle();
    expect(mockAgentsApi.batchAdapterConfig).toHaveBeenCalledWith(["agent-omp"], { modelEfforts: null });
  });

  it("undo restores every value the save changed through the same path", async () => {
    const user = userEvent.setup();
    await renderPage([alpha({ model: OPUS, fallbackModels: [GPT, MINI] }), gamma]);
    mockAgentsApi.batchAdapterConfig.mockResolvedValueOnce({
      updated: 1,
      unchanged: 0,
      results: [{ agentId: "agent-omp", name: "Alpha", status: "updated", changedKeys: ["fallbackModels", "model"] }],
    });

    mockAgentsApi.list.mockResolvedValue([alpha({ model: GPT, fallbackModels: [MINI] }), gamma]);
    await act(async () => { await user.click(byTestId("agent-model-agent-omp")!); });
    await act(async () => {
      await user.click($(`[data-testid="agent-model-picker-agent-omp-option"][data-value="${GPT}"]`)!);
    });
    await settle();
    expect(byTestId("agent-model-agent-omp")?.textContent).toContain("GPT-5");

    mockAgentsApi.list.mockResolvedValue([alpha({ model: OPUS, fallbackModels: [GPT, MINI] }), gamma]);
    await act(async () => { await user.click(byTestId("toast-action")!); });
    await settle();

    expect(mockAgentsApi.batchAdapterConfig).toHaveBeenLastCalledWith(["agent-omp"], {
      fallbackModels: [GPT, MINI],
      model: OPUS,
    });
    expect(byTestId("agent-model-agent-omp")?.textContent).toContain("Claude Opus 5.5");
    expect(byTestId("agent-fallbacks-agent-omp-overflow")?.textContent).toBe("+1");
    expect(toastsText()).toContain("Restored");
  });

  it("rolls back and shows the server message when the save fails", async () => {
    const user = userEvent.setup();
    await renderPage([alpha({ model: OPUS, thinking: "high" }), gamma]);
    let reject: (error: unknown) => void = () => {};
    mockAgentsApi.batchAdapterConfig.mockImplementationOnce(
      () => new Promise((_, rejectPromise) => { reject = rejectPromise; }),
    );

    await act(async () => { await user.click(byTestId("agent-model-agent-omp")!); });
    await act(async () => {
      await user.click($(`[data-testid="agent-model-picker-agent-omp-option"][data-value="${HAIKU}"]`)!);
    });
    expect(byTestId("agent-model-agent-omp")?.textContent).toContain("Claude Haiku 5");
    expect(byTestId("agent-model-agent-omp")?.getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      reject(
        new ApiError("No agent was changed: some values are invalid for their adapter.", 422, {
          error: "No agent was changed: some values are invalid for their adapter.",
          failures: [{ agentId: "agent-omp", name: "Alpha", key: "model", message: "Model is not allowed for this agent." }],
        }),
      );
    });
    await settle();

    expect(byTestId("agent-model-agent-omp")?.textContent).toContain("Claude Opus 5.5");
    expect(byTestId("agent-model-agent-omp")?.hasAttribute("aria-busy")).toBe(false);
    expect(toastsText()).toContain("Model not saved");
    expect(toastsText()).toContain("Model is not allowed for this agent.");
    expect($('[data-tone="error"]')).not.toBeNull();
  });

  it("validates fallback edits: rejects the primary, caps at five, then saves a valid list", async () => {
    const user = userEvent.setup();
    await renderPage([
      alpha({ model: OPUS, fallbackModels: [GPT] }),
      makeAgent({
        id: "agent-full",
        name: "Beta",
        urlKey: "beta",
        adapterConfig: { model: OPUS, fallbackModels: [GPT, MINI, GLM, FLASH, HAIKU] },
      }),
      gamma,
    ]);

    await act(async () => { await user.click(byTestId("agent-fallbacks-agent-full")!); });
    const fullAdd = byTestId<HTMLButtonElement>("agent-fallbacks-editor-agent-full-add")!;
    expect(fullAdd.disabled).toBe(true);
    expect(fullAdd.textContent).toContain("Limit of 5 reached");
    await act(async () => { await user.keyboard("{Escape}"); });
    await settle();

    await act(async () => { await user.click(byTestId("agent-fallbacks-agent-omp")!); });
    await act(async () => { await user.click(byTestId("agent-fallbacks-editor-agent-omp-add")!); });
    await act(async () => {
      await user.click($(`[data-testid="agent-fallbacks-editor-agent-omp-add-option"][data-value="${OPUS}"]`)!);
    });
    expect(byTestId("agent-fallbacks-editor-agent-omp-error")?.textContent).toMatch(/is the primary model/i);
    expect(mockAgentsApi.batchAdapterConfig).not.toHaveBeenCalled();

    await act(async () => { await user.click(byTestId("agent-fallbacks-editor-agent-omp-add")!); });
    await act(async () => {
      await user.click($(`[data-testid="agent-fallbacks-editor-agent-omp-add-option"][data-value="${MINI}"]`)!);
    });
    await settle();
    expect(mockAgentsApi.batchAdapterConfig).toHaveBeenCalledWith(["agent-omp"], { fallbackModels: [GPT, MINI] });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("opens with Enter, cancels with Escape and keeps row clicks navigating", async () => {
    const user = userEvent.setup();
    await renderPage([alpha({ model: OPUS }), gamma]);
    const trigger = byTestId<HTMLButtonElement>("agent-model-agent-omp")!;

    await act(async () => { trigger.focus(); });
    await act(async () => { await user.keyboard("{Enter}"); });
    expect(byTestId("agent-model-picker-agent-omp-listbox")).not.toBeNull();
    await act(async () => { await user.keyboard("{Escape}"); });
    await settle();
    expect(byTestId("agent-model-picker-agent-omp-listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(mockAgentsApi.batchAdapterConfig).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();

    await act(async () => { await user.click(byTestId("agent-fallbacks-agent-omp")!); });
    await act(async () => { await user.keyboard("{Escape}"); });
    await settle();
    expect(mockNavigate).not.toHaveBeenCalled();

    await act(async () => { await user.click($('span[title="Alpha"]')!); });
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });
});
