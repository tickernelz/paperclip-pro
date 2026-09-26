// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useComposerDockReserve } from "./useComposerDockReserve";

let container: HTMLDivElement;
let root: Root | null = null;
let observed: HTMLElement | null = null;
let trigger: (() => void) | null = null;

class FakeResizeObserver {
  constructor(private readonly callback: () => void) {}
  observe(target: Element) {
    observed = target as HTMLElement;
    trigger = () => this.callback();
  }
  disconnect() {
    observed = null;
    trigger = null;
  }
  unobserve() {}
}

function setDockHeight(element: HTMLElement, height: number): void {
  element.getBoundingClientRect = () =>
    ({ height, width: 390, top: 0, left: 0, right: 390, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

function Probe({ enabled, height }: { enabled: boolean; height: number }) {
  const { dockRef, reserve } = useComposerDockReserve(enabled);
  return (
    <div
      ref={(node) => {
        if (node) setDockHeight(node, height);
        dockRef(node);
      }}
      data-testid="dock"
      data-reserve={reserve}
    />
  );
}

describe("useComposerDockReserve", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
    container.remove();
    document.documentElement.style.removeProperty("--tc-composer-reserve");
    vi.unstubAllGlobals();
  });

  it("reserves the dock's measured height and republishes it when the dock grows", () => {
    root = createRoot(container);
    act(() => {
      root!.render(<Probe enabled height={96} />);
    });

    const dock = container.querySelector('[data-testid="dock"]') as HTMLElement;
    expect(dock.dataset.reserve).toBe("96");
    expect(document.documentElement.style.getPropertyValue("--tc-composer-reserve")).toBe("96px");

    setDockHeight(dock, 158);
    act(() => {
      trigger?.();
    });

    expect(dock.dataset.reserve).toBe("158");
    expect(document.documentElement.style.getPropertyValue("--tc-composer-reserve")).toBe("158px");
  });

  it("rounds fractional dock heights up so the reserved space is never short", () => {
    root = createRoot(container);
    act(() => {
      root!.render(<Probe enabled height={96.4} />);
    });

    const dock = container.querySelector('[data-testid="dock"]') as HTMLElement;
    expect(dock.dataset.reserve).toBe("97");
  });

  it("publishes nothing while disabled", () => {
    root = createRoot(container);
    act(() => {
      root!.render(<Probe enabled={false} height={96} />);
    });

    expect(container.querySelector('[data-testid="dock"]')?.getAttribute("data-reserve")).toBe("0");
    expect(document.documentElement.style.getPropertyValue("--tc-composer-reserve")).toBe("");
    expect(observed).toBeNull();
  });
});
