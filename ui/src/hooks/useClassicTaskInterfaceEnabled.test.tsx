// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useClassicTaskInterfaceEnabled } from "./useClassicTaskInterfaceEnabled";

const mockInstanceSettingsApi = vi.hoisted(() => ({
  getExperimental: vi.fn(),
}));

vi.mock("@/api/instanceSettings", () => ({
  instanceSettingsApi: mockInstanceSettingsApi,
}));

function Probe() {
  const state = useClassicTaskInterfaceEnabled();
  return <output>{`${state.enabled}:${state.loaded}`}</output>;
}

async function flushReact() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  flushSync(() => {});
}

let root: Root;
function renderWithClient(queryClient: QueryClient | null) {
  const element = queryClient
    ? <QueryClientProvider client={queryClient}><Probe /></QueryClientProvider>
    : <Probe />;
  flushSync(() => {
    root.render(element);
  });
}

describe("useClassicTaskInterfaceEnabled", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  it("stays off and unloaded while the settings read is in flight", () => {
    mockInstanceSettingsApi.getExperimental.mockImplementation(() => new Promise(() => {}));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderWithClient(queryClient);

    expect(host.textContent).toBe("false:false");
  });

  it("turns on only for an explicit true", async () => {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableClassicTaskInterface: true });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderWithClient(queryClient);
    await flushReact();

    expect(host.textContent).toBe("true:true");
  });

  it("stays off for an explicit false and for settings that omit the flag", async () => {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableClassicTaskInterface: false });
    const offClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithClient(offClient);
    await flushReact();
    expect(host.textContent).toBe("false:true");

    flushSync(() => root.unmount());
    host.textContent = "";
    root = createRoot(host);

    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableStreamlinedUi: true });
    const omittedClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithClient(omittedClient);
    await flushReact();
    expect(host.textContent).toBe("false:true");
  });

  it("settles to off when the settings read fails", async () => {
    mockInstanceSettingsApi.getExperimental.mockRejectedValue(new Error("403 forbidden"));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderWithClient(queryClient);
    await flushReact();

    expect(host.textContent).toBe("false:true");
  });

  it("reports settled-off without a QueryClientProvider instead of throwing", () => {
    renderWithClient(null);

    expect(host.textContent).toBe("false:true");
    expect(mockInstanceSettingsApi.getExperimental).not.toHaveBeenCalled();
  });
});
