// @vitest-environment jsdom

import type { ReactElement } from "react";
import { flushSync } from "react-dom";
import { MemoryRouter } from "react-router-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { INSTANCE_FEATURE_CATALOG, INSTANCE_FEATURE_KEYS, type InstanceFeatureKey } from "@tickernelz/wardmote-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstanceFeatures } from "./InstanceFeatures";
import { InstanceAdvanced } from "./InstanceAdvanced";

const api = vi.hoisted(() => ({ getExperimental: vi.fn(), updateExperimental: vi.fn() }));

vi.mock("@/api/instanceSettings", () => ({ instanceSettingsApi: api }));
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompany: { id: "company", issuePrefix: "PAP" } }),
}));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }) }));

const PRODUCTION_ON: InstanceFeatureKey[] = [
  "enableNativeRunner", "enableStreamlinedLeftNavigation", "enableStreamlinedUi", "enableApps",
  "enableMcpAggregators", "enableChatConnectors", "enableCases", "enableAgentChat",
  "enableExperimentalFileViewer", "enableExternalObjects", "enableSummaries", "enableStatusCards",
  "enableDecisions", "enablePaperclipDeveloperMode", "enablePixelsOffice",
  "enableWorkspaceBranchReconcileForward", "enableWorkspaceDirtyQuarantineRepair",
];

function settings(on: InstanceFeatureKey[] = PRODUCTION_ON, extra: Record<string, unknown> = {}) {
  return {
    ...Object.fromEntries(INSTANCE_FEATURE_KEYS.map((key) => [key, on.includes(key)])),
    worktreeRunExecutionActivatedAt: null,
    worktreeRunExecutionActivationInstanceId: null,
    ...extra,
  };
}

async function flush() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  flushSync(() => {});
}

let container: HTMLDivElement;
let root: Root;

async function render(element: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(container);
  flushSync(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{element}</MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await flush();
}

function toggle(name: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[role="switch"][aria-label="${name}"]`);
  expect(button).not.toBeNull();
  return button!;
}

function lastPatch() {
  return api.updateExperimental.mock.calls.at(-1)?.[0] as Record<string, boolean>;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.updateExperimental.mockImplementation(async (patch: Record<string, unknown>) => ({ ...settings(), ...patch }));
});

afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("InstanceFeatures", () => {
  it("shows the production instance as the Standard preset with 8 of 24 on", async () => {
    api.getExperimental.mockResolvedValue(settings());
    await render(<InstanceFeatures />);

    expect(container.textContent).toContain("8 of 24 on");
    const standard = [...container.querySelectorAll("button[aria-pressed]")].find((b) => b.textContent === "Standard");
    expect(standard?.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).not.toMatch(/experimental/i);
  });

  it("applies a preset to every finished feature only", async () => {
    api.getExperimental.mockResolvedValue(settings());
    await render(<InstanceFeatures />);

    const minimal = [...container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")].find((b) => b.textContent === "Minimal");
    flushSync(() => minimal!.click());
    await flush();

    const patch = lastPatch();
    expect(Object.keys(patch)).toHaveLength(19);
    expect(Object.entries(patch).filter(([, on]) => on).map(([key]) => key).sort()).toEqual(
      ["enableAgentChat", "enableChatConnectors", "enableDecisions"],
    );
    expect(patch).not.toHaveProperty("enableMemoryConnectors");
  });

  it("turns a requirement on together with the feature that needs it", async () => {
    api.getExperimental.mockResolvedValue(settings([]));
    await render(<InstanceFeatures />);

    expect(container.textContent).toContain("Needs Cases");
    flushSync(() => toggle("Pipelines").click());
    await flush();
    expect(lastPatch()).toEqual({ enablePipelines: true, enableCases: true });
  });

  it("turns dependents off with their requirement", async () => {
    api.getExperimental.mockResolvedValue(settings(["enableCases", "enablePipelines"]));
    await render(<InstanceFeatures />);

    flushSync(() => toggle("Cases").click());
    await flush();
    expect(lastPatch()).toEqual({ enableCases: false, enablePipelines: false });
  });

  it("locks unfinished features off and lets one that is already on be turned off", async () => {
    api.getExperimental.mockResolvedValue(settings(["enableFastResponses"]));
    await render(<InstanceFeatures />);

    expect(toggle("Memory connectors").disabled).toBe(true);
    expect(toggle("Fast replies").disabled).toBe(false);
    expect(container.textContent).toContain("Not finished yet");
  });

  it("offers Use for new projects inside Isolated workspaces", async () => {
    api.getExperimental.mockResolvedValue(settings(["enableIsolatedWorkspaces"]));
    await render(<InstanceFeatures />);

    const option = container.querySelector<HTMLButtonElement>('button[role="checkbox"]');
    expect(container.textContent).toContain("Use for new projects");
    flushSync(() => option!.click());
    await flush();
    expect(lastPatch()).toEqual({ enableIsolatedWorkspacesByDefault: true });
  });

  it("filters rows by search", async () => {
    api.getExperimental.mockResolvedValue(settings());
    await render(<InstanceFeatures />);

    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!;
    flushSync(() => {
      setter.call(input, "pipelines");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    expect(container.querySelectorAll('button[role="switch"]')).toHaveLength(1);
  });

});

describe("InstanceAdvanced", () => {
  it("marks rows that differ from the default and resets only those", async () => {
    api.getExperimental.mockResolvedValue(settings());
    await render(<InstanceAdvanced />);

    const changedRows = [...container.querySelectorAll("h3")].filter((heading) =>
      heading.parentElement?.textContent?.includes("changed"),
    );
    expect(changedRows.map((heading) => heading.textContent)).toEqual(["Developer mode"]);
    expect(container.querySelector('button[aria-label="Worktree run execution"]')).toBeNull();

    const reset = [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("Reset to defaults"));
    flushSync(() => reset!.click());
    await flush();
    expect(lastPatch()).toEqual({ enablePaperclipDeveloperMode: INSTANCE_FEATURE_CATALOG.enablePaperclipDeveloperMode.selfHostedDefault });
  });

  it("disables reset when every row is at its default", async () => {
    api.getExperimental.mockResolvedValue(
      settings(["enableNativeRunner", "enableWorkspaceBranchReconcileForward", "enableWorkspaceDirtyQuarantineRepair"]),
    );
    await render(<InstanceAdvanced />);
    const reset = [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("Reset to defaults"));
    expect(reset?.disabled).toBe(true);
    expect(container.textContent).not.toContain("changed");
  });
});
