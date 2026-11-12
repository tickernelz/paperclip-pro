// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OmpCustomProviderList, OmpCustomProviderView } from "@tickernelz/wardmote-shared";

const api = vi.hoisted(() => ({
  customProviders: vi.fn(),
  saveCustomProvider: vi.fn(),
  removeCustomProvider: vi.fn(),
  probeCustomProvider: vi.fn(),
}));
vi.mock("@/api/onboardingOmp", () => ({ onboardingOmpApi: api }));

import { CustomProviders } from "./CustomProviders";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

function provider(name: string): OmpCustomProviderView {
  return {
    name,
    baseUrl: `https://${name}.example/v1`,
    api: "openai-completions",
    apiKey: { kind: "none" },
    authHeader: false,
    disableStrictTools: false,
    discovery: null,
    headers: [],
    models: [{ id: "model-a" }],
    otherKeys: [],
  };
}

const list: OmpCustomProviderList = { modelsPath: "/home/u/.omp/agent/models.yml", parseError: null, providers: ["alpha", "beta", "gamma"].map(provider) };

beforeEach(async () => {
  api.customProviders.mockResolvedValue(list);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={client}><CustomProviders /></QueryClientProvider>));
  await vi.waitFor(() => expect(host.querySelectorAll("li")).toHaveLength(3));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

const row = (name: string) => Array.from(host.querySelectorAll("li")).find((item) => item.querySelector("b")?.textContent === name)!;
const editButton = (name: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="Edit ${name}"]`)!;
const forms = () => Array.from(host.querySelectorAll("form"));
const click = (element: HTMLElement) => act(() => element.click());

function type(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("CustomProviders inline editor", () => {
  it("opens the editor inside the edited row and focuses its first editable field", () => {
    click(editButton("beta"));

    expect(forms()).toHaveLength(1);
    expect(row("beta").querySelector("form")?.getAttribute("aria-label")).toBe("Edit beta");
    expect(row("gamma").querySelector("form")).toBeNull();
    expect(editButton("beta").getAttribute("aria-expanded")).toBe("true");
    expect(editButton("alpha").getAttribute("aria-expanded")).toBe("false");
    expect((document.activeElement as HTMLInputElement).value).toBe("https://beta.example/v1");
  });

  it("closes on Escape and returns focus to the row's Edit button", async () => {
    click(editButton("gamma"));
    act(() => {
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(forms()).toHaveLength(0);
    expect(editButton("gamma").getAttribute("aria-expanded")).toBe("false");
    await vi.waitFor(() => expect(document.activeElement).toBe(editButton("gamma")));
  });

  it("returns focus to the Edit button after Cancel", async () => {
    click(editButton("alpha"));
    click(Array.from(row("alpha").querySelectorAll("button")).find((button) => button.textContent === "Cancel")!);

    expect(forms()).toHaveLength(0);
    await vi.waitFor(() => expect(document.activeElement).toBe(editButton("alpha")));
  });

  it("keeps one editor open and asks before discarding unsaved changes", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    click(editButton("alpha"));
    click(editButton("beta"));
    expect(confirm).not.toHaveBeenCalled();
    expect(forms()).toHaveLength(1);
    expect(row("beta").querySelector("form")).not.toBeNull();

    type(document.activeElement as HTMLInputElement, "https://changed.example/v1");
    click(editButton("gamma"));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(row("beta").querySelector("form")).not.toBeNull();
    expect(row("gamma").querySelector("form")).toBeNull();

    confirm.mockReturnValue(true);
    click(editButton("gamma"));
    expect(forms()).toHaveLength(1);
    expect(row("gamma").querySelector("form")).not.toBeNull();
  });
});
