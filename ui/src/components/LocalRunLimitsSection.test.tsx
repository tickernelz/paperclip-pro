// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EffectiveLocalRunLimits, LocalRunLimitsSettings } from "@tickernelz/paperclip-pro-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import { LocalRunLimitsSection } from "./LocalRunLimitsSection";

const mockInstanceSettingsApi = vi.hoisted(() => ({
  updateGeneral: vi.fn(),
  getLocalRunLimits: vi.fn(),
}));

vi.mock("@/api/instanceSettings", () => ({ instanceSettingsApi: mockInstanceSettingsApi }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const DEFAULTS: EffectiveLocalRunLimits = {
  maxConcurrentRuns: { value: 20, source: "default", envVar: "PAPERCLIP_MAX_CONCURRENT_LOCAL_RUNS" },
  maxConcurrentStarts: { value: 4, source: "default", envVar: "PAPERCLIP_MAX_CONCURRENT_LOCAL_STARTS" },
  startWaitBypassSec: { value: 120, source: "default", envVar: "PAPERCLIP_LOCAL_START_WAIT_BYPASS_SEC" },
};

const UNSET: LocalRunLimitsSettings = { maxConcurrentRuns: null, maxConcurrentStarts: null, startWaitBypassSec: null };

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll("button")).find((element) => element.textContent?.trim() === label);
  if (!found) throw new Error(`Button "${label}" not found`);
  return found as HTMLButtonElement;
}

function input(label: string): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!found) throw new Error(`Input "${label}" not found`);
  return found;
}

describe("LocalRunLimitsSection", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let queryClient: QueryClient;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mockInstanceSettingsApi.updateGeneral.mockResolvedValue({});
    mockInstanceSettingsApi.getLocalRunLimits.mockResolvedValue(DEFAULTS);
  });

  afterEach(() => {
    flushSync(() => root?.unmount());
    queryClient.clear();
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  async function renderSection(value: LocalRunLimitsSettings = UNSET) {
    root = createRoot(container);
    flushSync(() => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <LocalRunLimitsSection value={value} />
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(() => expect(container.textContent).toContain("In force"));
  }

  it("saves edited limits and refreshes the limits in force", async () => {
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    await renderSection();

    flushSync(() => setInputValue(input("Max running local runs"), "2"));
    flushSync(() => setInputValue(input("Start wait bypass (seconds)"), "300"));
    flushSync(() => button("Save local run limits").click());

    await vi.waitFor(() =>
      expect(mockInstanceSettingsApi.updateGeneral).toHaveBeenCalledWith({
        localRuns: { maxConcurrentRuns: 2, maxConcurrentStarts: null, startWaitBypassSec: 300 },
      }),
    );
    await vi.waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.instance.localRunLimits }),
    );
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.instance.generalSettings });
  });

  it("clears a saved limit back to the default when the field is emptied", async () => {
    await renderSection({ maxConcurrentRuns: 8, maxConcurrentStarts: 2, startWaitBypassSec: null });

    flushSync(() => setInputValue(input("Max running local runs"), ""));
    flushSync(() => button("Save local run limits").click());

    await vi.waitFor(() =>
      expect(mockInstanceSettingsApi.updateGeneral).toHaveBeenCalledWith({
        localRuns: { maxConcurrentRuns: null, maxConcurrentStarts: 2, startWaitBypassSec: null },
      }),
    );
  });

  it("blocks an out-of-range value without calling the API", async () => {
    await renderSection();

    flushSync(() => setInputValue(input("Max running local runs"), "65"));
    flushSync(() => button("Save local run limits").click());

    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain("from 1 to 64"));
    expect(mockInstanceSettingsApi.updateGeneral).not.toHaveBeenCalled();
  });

  it("shows an environment override read-only and keeps the saved value for that field", async () => {
    mockInstanceSettingsApi.getLocalRunLimits.mockResolvedValue({
      ...DEFAULTS,
      maxConcurrentRuns: { value: 12, source: "env", envVar: "PAPERCLIP_MAX_CONCURRENT_LOCAL_RUNS" },
    });
    await renderSection({ maxConcurrentRuns: 5, maxConcurrentStarts: null, startWaitBypassSec: null });
    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="local-run-limit-env-maxConcurrentRuns"]')?.textContent).toContain(
        "PAPERCLIP_MAX_CONCURRENT_LOCAL_RUNS",
      ),
    );

    const runs = input("Max running local runs");
    expect(runs.value).toBe("12");
    expect(runs.readOnly).toBe(true);
    expect(runs.disabled).toBe(true);

    flushSync(() => setInputValue(input("Max runs starting at once"), "6"));
    flushSync(() => button("Save local run limits").click());

    await vi.waitFor(() =>
      expect(mockInstanceSettingsApi.updateGeneral).toHaveBeenCalledWith({
        localRuns: { maxConcurrentRuns: 5, maxConcurrentStarts: 6, startWaitBypassSec: null },
      }),
    );
  });
});
