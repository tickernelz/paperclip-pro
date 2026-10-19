// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveViewportShift, useVisualViewportShift } from "./useVisualViewportShift";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type FakeViewport = EventTarget & { height: number; offsetTop: number; scale: number };

let root: Root;
let host: HTMLDivElement;
let viewport: FakeViewport;
let frames: FrameRequestCallback[];

function Harness({ active = true }: { active?: boolean }) {
  useVisualViewportShift(active);
  return <input data-testid="field" />;
}

function flushFrames() {
  act(() => {
    const pending = frames;
    frames = [];
    for (const callback of pending) callback(0);
  });
}

function moveViewport(next: Partial<Pick<FakeViewport, "height" | "offsetTop" | "scale">>) {
  Object.assign(viewport, next);
  act(() => {
    viewport.dispatchEvent(new Event("scroll"));
  });
  flushFrames();
}

const shiftTop = () => document.documentElement.style.getPropertyValue("--visual-viewport-shift-top");
const shiftBottom = () => document.documentElement.style.getPropertyValue("--visual-viewport-shift-bottom");

const resting = {
  innerHeight: 844,
  visualHeight: 844,
  offsetTop: 0,
  scale: 1,
  editableFocused: false,
  overscrolled: false,
};

describe("resolveViewportShift", () => {
  it("is zero while the visual viewport fills the layout viewport", () => {
    expect(resolveViewportShift(resting)).toEqual({ top: 0, bottom: 0 });
  });

  it("follows the stale offset iOS leaves behind after the keyboard closes", () => {
    expect(resolveViewportShift({ ...resting, offsetTop: 297 })).toEqual({ top: 297, bottom: 297 });
  });

  it("never pulls bars toward the keyboard while it is still covering the screen", () => {
    expect(resolveViewportShift({ ...resting, visualHeight: 508, offsetTop: 0 })).toEqual({ top: 0, bottom: 0 });
    expect(resolveViewportShift({ ...resting, visualHeight: 508, offsetTop: 336 })).toEqual({ top: 336, bottom: 0 });
  });

  it("leaves bars alone while an editable control has focus", () => {
    expect(resolveViewportShift({ ...resting, offsetTop: 297, editableFocused: true })).toEqual({ top: 0, bottom: 0 });
  });

  it("ignores pinch zoom and edge bounce", () => {
    expect(resolveViewportShift({ ...resting, offsetTop: 120, scale: 2 })).toEqual({ top: 0, bottom: 0 });
    expect(resolveViewportShift({ ...resting, offsetTop: 24, overscrolled: true })).toEqual({ top: 0, bottom: 0 });
  });

  it("clamps rubber-band negative offsets to zero", () => {
    expect(resolveViewportShift({ ...resting, offsetTop: -18 })).toEqual({ top: 0, bottom: 0 });
  });
});

describe("useVisualViewportShift", () => {
  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<Harness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    Reflect.deleteProperty(window, "visualViewport");
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute("style");
  });

  it("publishes nothing while the viewport is aligned", () => {
    expect(shiftTop()).toBe("");
    expect(shiftBottom()).toBe("");
  });

  it("publishes the stale offset and clears it once iOS resets the viewport", () => {
    moveViewport({ offsetTop: 297 });
    expect(shiftTop()).toBe("297px");
    expect(shiftBottom()).toBe("297px");
    moveViewport({ offsetTop: 0 });
    expect(shiftTop()).toBe("0px");
    expect(shiftBottom()).toBe("0px");
  });

  it("does not shift bars while the keyboard is open for a focused field", () => {
    const field = host.querySelector<HTMLInputElement>('[data-testid="field"]')!;
    act(() => field.focus());
    moveViewport({ height: 508, offsetTop: 336 });
    expect(shiftTop()).toBe("");
    expect(shiftBottom()).toBe("");
  });

  it("removes its properties when the shell leaves mobile", () => {
    moveViewport({ offsetTop: 120 });
    act(() => root.render(<Harness active={false} />));
    expect(shiftTop()).toBe("");
    expect(shiftBottom()).toBe("");
  });
});
