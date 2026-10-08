// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isEditableElement,
  resolveKeyboardInset,
  useMobileViewportInsets,
} from "./useMobileViewportInsets";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type FakeViewport = EventTarget & { height: number; offsetTop: number };

let root: Root;
let host: HTMLDivElement;
let viewport: FakeViewport;
let frames: FrameRequestCallback[];
let innerHeightDescriptor: PropertyDescriptor | undefined;

function Harness() {
  useMobileViewportInsets(true);
  return (
    <>
      <textarea data-testid="editor" />
      <button type="button" data-testid="button">
        Approve
      </button>
      <div data-testid="rich" contentEditable suppressContentEditableWarning>
        <span data-testid="rich-child">text</span>
      </div>
    </>
  );
}

function flushFrames() {
  act(() => {
    const pending = frames;
    frames = [];
    for (const callback of pending) callback(0);
  });
}

function scrollViewport(height: number, offsetTop = 0) {
  viewport.height = height;
  viewport.offsetTop = offsetTop;
  act(() => {
    viewport.dispatchEvent(new Event("scroll"));
    viewport.dispatchEvent(new Event("resize"));
  });
}

function element(testId: string) {
  return host.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!;
}

const rootStyle = () => document.documentElement.style;

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0 });
  innerHeightDescriptor = Object.getOwnPropertyDescriptor(window, "innerHeight");
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
  if (innerHeightDescriptor) Object.defineProperty(window, "innerHeight", innerHeightDescriptor);
  vi.unstubAllGlobals();
});

describe("resolveKeyboardInset", () => {
  it("ignores viewport gaps while nothing editable is focused", () => {
    expect(
      resolveKeyboardInset({ innerHeight: 844, visualHeight: 400, offsetTop: 0, editableFocused: false }),
    ).toBe(0);
  });

  it("ignores toolbar-sized gaps while an editor is focused", () => {
    expect(
      resolveKeyboardInset({ innerHeight: 844, visualHeight: 760, offsetTop: 0, editableFocused: true }),
    ).toBe(0);
  });

  it("reports a keyboard-sized gap while an editor is focused", () => {
    expect(
      resolveKeyboardInset({ innerHeight: 844, visualHeight: 508, offsetTop: 0, editableFocused: true }),
    ).toBe(336);
  });
});

describe("isEditableElement", () => {
  it("accepts text fields and rich editors but not buttons or checkboxes", () => {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    expect(isEditableElement(element("editor"))).toBe(true);
    expect(isEditableElement(element("rich-child"))).toBe(true);
    expect(isEditableElement(element("button"))).toBe(false);
    expect(isEditableElement(checkbox)).toBe(false);
    expect(isEditableElement(null)).toBe(false);
  });
});

describe("useMobileViewportInsets", () => {
  it("publishes no keyboard inset while scrolling shrinks the viewport without focus", () => {
    scrollViewport(420, 24);
    flushFrames();

    expect(rootStyle().getPropertyValue("--mobile-viewport-inset-bottom")).toBe("0px");
    expect(rootStyle().getPropertyValue("--mobile-viewport-height")).toBe("");
    expect(document.documentElement.dataset.keyboardOpen).toBeUndefined();
  });

  it("publishes the keyboard inset and visible height once per frame while an editor is focused", () => {
    act(() => element("editor").focus());
    scrollViewport(600);
    scrollViewport(508);
    expect(frames).toHaveLength(1);
    flushFrames();

    expect(rootStyle().getPropertyValue("--mobile-viewport-inset-bottom")).toBe("336px");
    expect(rootStyle().getPropertyValue("--mobile-viewport-height")).toBe("508px");
    expect(document.documentElement.dataset.keyboardOpen).toBe("true");
  });

  it("drops a small focused inset and clears the keyboard state on blur", () => {
    act(() => element("editor").focus());
    scrollViewport(508);
    flushFrames();
    expect(document.documentElement.dataset.keyboardOpen).toBe("true");

    scrollViewport(760);
    flushFrames();
    expect(rootStyle().getPropertyValue("--mobile-viewport-inset-bottom")).toBe("0px");
    expect(rootStyle().getPropertyValue("--mobile-viewport-height")).toBe("");
    expect(document.documentElement.dataset.keyboardOpen).toBeUndefined();

    scrollViewport(508);
    act(() => element("editor").blur());
    flushFrames();
    expect(rootStyle().getPropertyValue("--mobile-viewport-inset-bottom")).toBe("0px");
    expect(document.documentElement.dataset.keyboardOpen).toBeUndefined();
  });

  it("removes every published value when the last consumer unmounts", () => {
    act(() => element("editor").focus());
    scrollViewport(508);
    flushFrames();
    act(() => root.unmount());
    root = createRoot(host);

    expect(rootStyle().getPropertyValue("--mobile-viewport-inset-bottom")).toBe("");
    expect(rootStyle().getPropertyValue("--mobile-viewport-height")).toBe("");
    expect(document.documentElement.dataset.keyboardOpen).toBeUndefined();
  });
});
