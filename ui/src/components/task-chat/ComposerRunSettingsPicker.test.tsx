// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAdapterConfigBatchPreview } from "@tickernelz/paperclip-pro-shared";
import { agentsApi } from "@/api/agents";
import {
  ComposerRunSettingsPicker,
  useComposerRunSettingsStaging,
} from "./ComposerRunSettingsPicker";

vi.mock("@/api/issues", () => ({
  issuesApi: { getModelOverride: vi.fn(), setModelOverride: vi.fn() },
}));

vi.mock("@/api/agents", () => ({
  agentsApi: { batchAdapterConfigPreview: vi.fn() },
}));

const OWN = "sub2api-claude/claude-opus-5-5";
const OTHER = "sub2api-claude-kaitech/claude-opus-5-5";

function preview(model: string): AgentAdapterConfigBatchPreview {
  return {
    fields: [
      {
        key: "model",
        label: "Model",
        hint: null,
        freeText: true,
        options: [
          { value: OWN, label: `Claude Opus 5.5 (${OWN})`, group: "sub2api-claude", name: "Claude Opus 5.5" },
          { value: OTHER, label: `Claude Opus 5.5 (${OTHER})`, group: "sub2api-claude-kaitech", name: "Claude Opus 5.5" },
        ],
      },
    ],
    agents: [
      {
        agentId: "fajar",
        name: "Fajar",
        adapterType: "omp_local",
        eligible: true,
        reason: null,
        current: { model },
      },
    ],
  };
}

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;

function node<T extends Element = HTMLElement>(testId: string): T {
  const element = document.querySelector<T>(`[data-testid="${testId}"]`);
  if (!element) throw new Error(`Missing ${testId}`);
  return element;
}

function Harness({ model }: { model?: string }) {
  const staging = useComposerRunSettingsStaging();
  if (model && staging.values.model !== model) staging.set("model", model);
  return (
    <ComposerRunSettingsPicker
      companyId="company-1"
      draft
      assigneeValue="agent:fajar"
      currentAssigneeValue="agent:fajar"
      options={[{ id: "agent:fajar", label: "Fajar" }]}
      onAssigneeChange={vi.fn()}
      staging={staging}
    />
  );
}

async function render(model?: string) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Harness model={model} />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    node<HTMLButtonElement>("task-chat-composer-assignee").click();
  });
  await vi.waitFor(() => node("composer-run-settings-model-value"));
}

async function openModels() {
  await act(async () => {
    node<HTMLButtonElement>("composer-run-settings-model-row").click();
  });
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(agentsApi.batchAdapterConfigPreview).mockResolvedValue(preview(OWN));
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
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

describe("composer run settings model display", () => {
  it("shows the display name over the provider, titled with the full id", async () => {
    await render();
    expect(node("composer-run-settings-model-value").textContent).toBe("Claude Opus 5.5");
    expect(node("composer-run-settings-model-value-provider").textContent).toBe("sub2api-claude");
    expect(node("composer-run-settings-model-value").parentElement?.getAttribute("title")).toBe(OWN);
    const summary = node("task-chat-composer-run-summary").textContent;
    expect(summary).toContain("Claude Opus 5.5");
    expect(summary).toContain("sub2api-claude");
  });

  it("tells the same model from another provider apart once chosen", async () => {
    await render(OTHER);
    expect(node("composer-run-settings-model-value").textContent).toBe("Claude Opus 5.5");
    expect(node("composer-run-settings-model-value-provider").textContent).toBe("sub2api-claude-kaitech");
  });

  it("groups the same model from two providers into distinct rows", async () => {
    await render();
    await openModels();
    const own = node(`composer-run-settings-model-option-${OWN}`);
    const other = node(`composer-run-settings-model-option-${OTHER}`);
    expect(own.closest('[role="group"]')?.getAttribute("aria-label")).toBe("sub2api-claude");
    expect(other.closest('[role="group"]')?.getAttribute("aria-label")).toBe("sub2api-claude-kaitech");
    expect(node("composer-run-settings-model-group-sub2api-claude-kaitech").textContent).toBe(
      "sub2api-claude-kaitech",
    );
    expect(own.textContent).toBe(`Claude Opus 5.5${OWN}`);
    expect(other.textContent).toBe(`Claude Opus 5.5${OTHER}`);
  });

  it("names the agent default with its display name and provider", async () => {
    await render();
    await openModels();
    expect(node("composer-run-settings-model-default-value").textContent).toBe(
      "Claude Opus 5.5 · sub2api-claude",
    );
  });

  it("shows the full id for a free-text value", async () => {
    await render("my-gateway/claude-opus-5-5");
    expect(node("composer-run-settings-model-value").textContent).toBe("my-gateway/claude-opus-5-5");
    expect(document.querySelector('[data-testid="composer-run-settings-model-value-provider"]')).toBeNull();
  });

  it("shows the full id for an agent default the catalog does not list", async () => {
    vi.mocked(agentsApi.batchAdapterConfigPreview).mockResolvedValue(preview("legacy/claude-opus-4"));
    await render();
    expect(node("composer-run-settings-model-value").textContent).toBe("legacy/claude-opus-4");
    await openModels();
    expect(node("composer-run-settings-model-default-value").textContent).toBe("legacy/claude-opus-4");
  });

  it("finds options by provider", async () => {
    await render();
    await openModels();
    await act(async () => {
      typeInto(node<HTMLInputElement>("composer-run-settings-model-search"), "kaitech");
    });
    expect(document.querySelector(`[data-testid="composer-run-settings-model-option-${OWN}"]`)).toBeNull();
    expect(node(`composer-run-settings-model-option-${OTHER}`)).toBeTruthy();
  });
});
