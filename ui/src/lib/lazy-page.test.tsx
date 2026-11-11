// @vitest-environment jsdom

import { Component, Suspense, act, type ComponentType, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lazyPage, STALE_CHUNK_RELOAD_KEY } from "./lazy-page";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <p>route-error</p> : this.props.children;
  }
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

async function renderPage(Page: ComponentType) {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <Boundary>
        <Suspense fallback={<p>loading</p>}>
          <Page />
        </Suspense>
      </Boundary>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { text: () => container.textContent, unmount: () => act(() => root.unmount()) };
}

const missingChunk = (): Promise<ComponentType> => Promise.reject(new TypeError("Failed to fetch dynamically imported module"));

describe("lazyPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reloads once when a page chunk is missing and shows the route error when the reload did not help", async () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    const path = () => "/ZHA/issues";

    const beforeReload = await renderPage(lazyPage(missingChunk, { reload, storage, path }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(beforeReload.text()).toBe("loading");
    expect(storage.getItem(STALE_CHUNK_RELOAD_KEY)).toBe("/ZHA/issues");
    beforeReload.unmount();

    const afterReload = await renderPage(lazyPage(missingChunk, { reload, storage, path }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(afterReload.text()).toBe("route-error");
    afterReload.unmount();
  });

  it("clears the reload mark after a page loads so the next deploy can reload again", async () => {
    const storage = memoryStorage();
    storage.setItem(STALE_CHUNK_RELOAD_KEY, "/ZHA/issues");
    const reload = vi.fn();

    const page = await renderPage(lazyPage(async () => () => <p>page</p>, { reload, storage, path: () => "/ZHA/issues" }));

    expect(page.text()).toBe("page");
    expect(storage.getItem(STALE_CHUNK_RELOAD_KEY)).toBeNull();
    expect(reload).not.toHaveBeenCalled();
    page.unmount();
  });

  it("does not reload when session storage is unavailable", async () => {
    const reload = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});

    const page = await renderPage(lazyPage(missingChunk, { reload, storage: null, path: () => "/x" }));

    expect(reload).not.toHaveBeenCalled();
    expect(page.text()).toBe("route-error");
    page.unmount();
  });
});
