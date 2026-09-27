// @vitest-environment jsdom

import { act } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { useDefaultMessageDelivery } from "./useDefaultMessageDelivery";

vi.mock("@/api/instanceSettings", () => ({
  instanceSettingsApi: { getGeneral: vi.fn() },
}));

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  flushSync(() => root?.unmount());
  root = null;
  container.remove();
  vi.mocked(instanceSettingsApi.getGeneral).mockReset();
});

async function readDefault(): Promise<string> {
  const seen = { value: "" };
  function Probe() {
    seen.value = useDefaultMessageDelivery();
    return null;
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  await act(async () => {
    root!.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  for (let tick = 0; tick < 5; tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  return seen.value;
}

describe("useDefaultMessageDelivery", () => {
  it("steers when the instance has never stored a preference", async () => {
    vi.mocked(instanceSettingsApi.getGeneral).mockResolvedValue({} as never);
    expect(await readDefault()).toBe("steer");
  });

  it("returns the stored queue preference", async () => {
    vi.mocked(instanceSettingsApi.getGeneral).mockResolvedValue({
      defaultMessageDelivery: "queue",
    } as never);
    expect(await readDefault()).toBe("queue");
  });

  it("returns the stored steer preference", async () => {
    vi.mocked(instanceSettingsApi.getGeneral).mockResolvedValue({
      defaultMessageDelivery: "steer",
    } as never);
    expect(await readDefault()).toBe("steer");
  });

  it("steers while the query has not resolved, so a bare message is never lost to a null mode", async () => {
    vi.mocked(instanceSettingsApi.getGeneral).mockReturnValue(new Promise(() => {}));
    expect(await readDefault()).toBe("steer");
  });

  it("steers when the settings query fails rather than blocking the composer", async () => {
    vi.mocked(instanceSettingsApi.getGeneral).mockRejectedValue(new Error("offline"));
    expect(await readDefault()).toBe("steer");
  });
});
