// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OnboardingOmpLoginView } from "@tickernelz/wardmote-shared";

const api = vi.hoisted(() => ({
  loginProviders: vi.fn(),
  startLogin: vi.fn(),
  login: vi.fn(),
  answerLogin: vi.fn(),
  cancelLogin: vi.fn(),
}));
vi.mock("@/api/onboardingOmp", () => ({ onboardingOmpApi: api }));

import { OmpSignIn } from "./OmpSignIn";

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

function view(patch: Partial<OnboardingOmpLoginView>): OnboardingOmpLoginView {
  return { id: "login-1", provider: "Anthropic (Claude Pro/Max)", state: "waiting", url: null, lines: [], prompt: null, message: null, ...patch };
}

let rerender: () => Promise<void> = async () => undefined;

async function render(onSignedIn = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const draw = () => root!.render(<QueryClientProvider client={client}><OmpSignIn onSignedIn={() => onSignedIn()} /></QueryClientProvider>);
  rerender = async () => {
    await act(async () => draw());
  };
  await rerender();
  await vi.waitFor(() => expect(host!.querySelector("select")).not.toBeNull());
  return onSignedIn;
}

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

function type(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("OmpSignIn", () => {
  it("signs in with the provider OMP lists, takes a pasted redirect URL, and reports success once", async () => {
    api.loginProviders.mockResolvedValue({ providers: ["Anthropic (Claude Pro/Max)", "OpenRouter"] });
    api.startLogin.mockResolvedValue(view({
      url: "https://claude.ai/oauth/authorize",
      prompt: { label: "Paste the authorization code (or full redirect URL):", secret: false },
    }));
    api.answerLogin.mockResolvedValue(view({ state: "succeeded", message: "Logged in to Anthropic (Claude Pro/Max)" }));
    const popup = { location: { href: "about:blank" }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const onSignedIn = await render();
    expect([...host!.querySelectorAll("option")].map((option) => option.textContent)).toEqual(["Anthropic (Claude Pro/Max)", "OpenRouter"]);
    await submit(host!.querySelector("form")!);
    expect(api.startLogin).toHaveBeenCalledWith("Anthropic (Claude Pro/Max)");
    await vi.waitFor(() => expect(host!.querySelector('a[href="https://claude.ai/oauth/authorize"]')).not.toBeNull());
    expect(popup.location.href).toBe("https://claude.ai/oauth/authorize");
    open.mockRestore();
    const input = host!.querySelector<HTMLInputElement>('section input')!;
    expect(input.type).toBe("text");
    type(input, "http://localhost:54545/callback?code=abc");
    await submit(input.form!);
    expect(api.answerLogin).toHaveBeenCalledWith("login-1", "http://localhost:54545/callback?code=abc");
    await vi.waitFor(() => expect(host!.textContent).toContain("Logged in to Anthropic (Claude Pro/Max)"));
    await rerender();
    await rerender();
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });

  it("hides a typed API key and shows OMP's failure with the next step", async () => {
    api.loginProviders.mockResolvedValue({ providers: ["xAI API"] });
    api.startLogin.mockResolvedValue(view({ provider: "xAI API", prompt: { label: "Paste your xAI API key (xai-...):", secret: true } }));
    api.answerLogin.mockResolvedValue(view({ provider: "xAI API", state: "failed", message: "Invalid API key" }));
    const onSignedIn = await render();
    await submit(host!.querySelector("form")!);
    await vi.waitFor(() => expect(host!.querySelector<HTMLInputElement>("section input")?.type).toBe("password"));
    const input = host!.querySelector<HTMLInputElement>("section input")!;
    type(input, "xai-wrong");
    await submit(input.form!);
    await vi.waitFor(() => expect(host!.querySelector('[role="alert"]')?.textContent).toContain("Invalid API key. Check the account on the provider's page, then press Sign in again."));
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it("says why the provider list failed and retries", async () => {
    api.loginProviders.mockRejectedValueOnce(new Error("OMP must be installed and up to date first."));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<QueryClientProvider client={client}><OmpSignIn /></QueryClientProvider>);
    });
    await vi.waitFor(() => expect(host!.textContent).toContain("OMP must be installed and up to date first."));
    api.loginProviders.mockResolvedValue({ providers: ["OpenRouter"] });
    await act(async () => { host!.querySelector<HTMLButtonElement>('[role="alert"] button')!.click(); });
    await vi.waitFor(() => expect(host!.querySelector("select")).not.toBeNull());
  });
});
