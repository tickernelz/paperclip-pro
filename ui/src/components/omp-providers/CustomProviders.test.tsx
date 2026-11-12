// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OmpCustomProviderView } from "@tickernelz/wardmote-shared";

const api = vi.hoisted(() => ({
  fetchCustomProviderModels: vi.fn(),
  saveCustomProvider: vi.fn(),
  probeCustomProvider: vi.fn(),
}));
vi.mock("@/api/onboardingOmp", () => ({ onboardingOmpApi: api }));

import { CustomProviderForm } from "./CustomProviders";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.resetAllMocks();
});

const PROVIDER: OmpCustomProviderView = {
  name: "gw",
  baseUrl: "http://gw/v1",
  api: "openai-completions",
  apiKey: { kind: "literal" },
  authHeader: false,
  disableStrictTools: false,
  headers: [],
  discovery: null,
  models: [
    { id: "kept", name: "Hand named", api: "openai-responses", contextWindow: 200000, maxTokens: 32000, reasoning: true, images: true },
    { id: "retired" },
  ],
  otherKeys: [],
};

async function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(
    <QueryClientProvider client={client}>
      <CustomProviderForm provider={PROVIDER} takenNames={["gw"]} onSaved={vi.fn()} onCancel={vi.fn()} />
    </QueryClientProvider>,
  ));
}

function button(label: RegExp): HTMLButtonElement {
  const found = [...host!.querySelectorAll("button")].find((element) => label.test(element.textContent ?? ""));
  if (!found) throw new Error(`No button ${label}`);
  return found;
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

describe("CustomProviderForm upstream models", () => {
  it("keeps saved models as typed, adds only new upstream models and marks ones upstream dropped", async () => {
    api.fetchCustomProviderModels.mockResolvedValue({
      url: "http://gw/v1/models",
      status: 200,
      truncated: false,
      error: null,
      models: [{ id: "kept", name: "Upstream name" }, { id: "fresh-a", name: "Fresh A" }, { id: "fresh-b" }],
    });
    api.saveCustomProvider.mockResolvedValue({ modelsPath: "/x/models.yml", providers: [], parseError: null });
    await render();

    await click(button(/Fetch models/));
    await vi.waitFor(() => expect(host!.textContent).toContain("lists 3 models: 2 new, 1 already added."));
    expect(api.fetchCustomProviderModels).toHaveBeenCalledWith({ name: "gw", baseUrl: "http://gw/v1", api: "openai-completions", apiKey: { kind: "keep" }, authHeader: false, headers: [] });
    expect(host!.textContent).toContain("1 saved model is not listed upstream and stays until you remove it: retired.");
    expect([...host!.querySelectorAll("span")].filter((span) => span.textContent === "Not listed upstream any more; kept until you remove it.")).toHaveLength(1);
    expect((host!.querySelector('input[aria-label="kept"]') as HTMLInputElement).disabled).toBe(true);

    await click(host!.querySelector('input[aria-label="fresh-b"]') as HTMLInputElement);
    await click(button(/^Add selected \(1\)$/));
    await click(button(/^Add all \(1\)$/));
    await click(button(/^Add all/));

    await act(async () => {
      host!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(api.saveCustomProvider).toHaveBeenCalledTimes(1);
    expect(api.saveCustomProvider.mock.calls[0][1].models).toEqual([
      { id: "kept", name: "Hand named", api: "openai-responses", contextWindow: 200000, maxTokens: 32000, reasoning: true, images: true },
      { id: "retired" },
      { id: "fresh-b" },
      { id: "fresh-a", name: "Fresh A" },
    ]);
  });

  it("shows why the upstream list could not be read", async () => {
    api.fetchCustomProviderModels.mockResolvedValue({
      url: "http://gw/v1/models",
      status: 401,
      truncated: false,
      error: "http://gw/v1/models answered 401: the provider rejected the key or headers.",
      models: [],
    });
    await render();
    await click(button(/Fetch models/));
    await vi.waitFor(() => expect(host!.querySelector('[role="alert"]')?.textContent).toBe("http://gw/v1/models answered 401: the provider rejected the key or headers."));
    expect(host!.querySelector('[aria-label="Upstream models"]')).toBeNull();
  });
});
