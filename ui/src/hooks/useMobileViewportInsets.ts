import { useEffect, useState } from "react";

const INSET_BOTTOM_VAR = "--mobile-viewport-inset-bottom";
const HEIGHT_VAR = "--mobile-viewport-height";
const KEYBOARD_ATTRIBUTE = "keyboardOpen";
export const KEYBOARD_MIN_INSET_PX = 120;
export const SHORT_VIEWPORT_MAX_PX = 500;

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

export interface ViewportSample {
  innerHeight: number;
  visualHeight: number;
  offsetTop: number;
  editableFocused: boolean;
}

export function isEditableElement(element: Element | null): boolean {
  if (!element) return false;
  if (element instanceof HTMLTextAreaElement) return !element.readOnly && !element.disabled;
  if (element instanceof HTMLInputElement) {
    return !NON_TEXT_INPUT_TYPES.has(element.type) && !element.readOnly && !element.disabled;
  }
  const editable = element.closest("[contenteditable]");
  return editable !== null && editable.getAttribute("contenteditable") !== "false";
}

/** Keyboard inset in px, or 0 when the viewport gap is browser chrome rather than a software keyboard. */
export function resolveKeyboardInset(sample: ViewportSample): number {
  if (!sample.editableFocused) return 0;
  const inset = Math.max(0, Math.round(sample.innerHeight - sample.visualHeight - sample.offsetTop));
  return inset > KEYBOARD_MIN_INSET_PX ? inset : 0;
}

let subscribers = 0;
let detach: (() => void) | null = null;
let frame: number | null = null;

function readSample(): ViewportSample {
  const viewport = window.visualViewport;
  return {
    innerHeight: window.innerHeight,
    visualHeight: viewport?.height ?? window.innerHeight,
    offsetTop: viewport?.offsetTop ?? 0,
    editableFocused: isEditableElement(document.activeElement),
  };
}

function publish(): void {
  const root = document.documentElement;
  const sample = readSample();
  const inset = resolveKeyboardInset(sample);
  root.style.setProperty(INSET_BOTTOM_VAR, `${inset}px`);
  if (inset > 0) {
    root.style.setProperty(HEIGHT_VAR, `${Math.round(sample.visualHeight)}px`);
    root.dataset[KEYBOARD_ATTRIBUTE] = "true";
  } else {
    root.style.removeProperty(HEIGHT_VAR);
    delete root.dataset[KEYBOARD_ATTRIBUTE];
  }
}

function schedule(): void {
  if (frame !== null) return;
  frame = window.requestAnimationFrame(() => {
    frame = null;
    publish();
  });
}

function attach(): () => void {
  const viewport = window.visualViewport;
  publish();
  viewport?.addEventListener("resize", schedule);
  viewport?.addEventListener("scroll", schedule);
  window.addEventListener("resize", schedule);
  window.addEventListener("orientationchange", schedule);
  document.addEventListener("focusin", schedule);
  document.addEventListener("focusout", schedule);
  return () => {
    viewport?.removeEventListener("resize", schedule);
    viewport?.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    window.removeEventListener("orientationchange", schedule);
    document.removeEventListener("focusin", schedule);
    document.removeEventListener("focusout", schedule);
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
    const root = document.documentElement;
    root.style.removeProperty(INSET_BOTTOM_VAR);
    root.style.removeProperty(HEIGHT_VAR);
    delete root.dataset[KEYBOARD_ATTRIBUTE];
  };
}

/** Publishes the software-keyboard inset, visible height and data-keyboard-open while any consumer is active. */
export function useMobileViewportInsets(active: boolean): void {
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    subscribers += 1;
    if (subscribers === 1) detach = attach();
    else publish();
    return () => {
      subscribers -= 1;
      if (subscribers > 0) return;
      detach?.();
      detach = null;
    };
  }, [active]);
}

function readShortViewport(): boolean {
  const height = window.visualViewport?.height ?? window.innerHeight;
  return height < SHORT_VIEWPORT_MAX_PX;
}

export function useShortVisibleViewport(active: boolean): boolean {
  const [short, setShort] = useState(
    () => active && typeof window !== "undefined" && readShortViewport(),
  );
  useEffect(() => {
    if (!active || typeof window === "undefined") {
      setShort(false);
      return;
    }
    let pending: number | null = null;
    const update = () => {
      if (pending !== null) return;
      pending = window.requestAnimationFrame(() => {
        pending = null;
        setShort(readShortViewport());
      });
    };
    setShort(readShortViewport());
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", update);
    window.addEventListener("resize", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      window.removeEventListener("resize", update);
      if (pending !== null) window.cancelAnimationFrame(pending);
    };
  }, [active]);
  return short;
}
