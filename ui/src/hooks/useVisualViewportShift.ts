import { useEffect } from "react";
import { isEditableElement } from "./useMobileViewportInsets";

const TOP_VAR = "--visual-viewport-shift-top";
const BOTTOM_VAR = "--visual-viewport-shift-bottom";
const MAX_UNZOOMED_SCALE = 1.01;

export interface ViewportShiftSample {
  innerHeight: number;
  visualHeight: number;
  offsetTop: number;
  scale: number;
  editableFocused: boolean;
  overscrolled: boolean;
}

export interface ViewportShift {
  top: number;
  bottom: number;
}

/** Pixels the visible viewport sits inside the layout viewport that fixed and sticky edges anchor to. */
export function resolveViewportShift(sample: ViewportShiftSample): ViewportShift {
  if (sample.editableFocused || sample.overscrolled || sample.scale > MAX_UNZOOMED_SCALE) {
    return { top: 0, bottom: 0 };
  }
  return {
    top: Math.max(0, Math.round(sample.offsetTop)),
    bottom: Math.max(0, Math.round(sample.offsetTop + sample.visualHeight - sample.innerHeight)),
  };
}

function readSample(viewport: VisualViewport): ViewportShiftSample {
  const scroller = document.scrollingElement ?? document.documentElement;
  const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const scrollTop = window.scrollY;
  return {
    innerHeight: window.innerHeight,
    visualHeight: viewport.height,
    offsetTop: viewport.offsetTop,
    scale: viewport.scale,
    editableFocused: isEditableElement(document.activeElement),
    overscrolled: scrollTop < 0 || scrollTop > maxScroll + 1,
  };
}

/** Publishes how far iOS leaves the visual viewport displaced after the keyboard closes, so pinned bars follow the screen edges. */
export function useVisualViewportShift(active: boolean): void {
  useEffect(() => {
    const viewport = typeof window === "undefined" ? null : window.visualViewport;
    if (!active || !viewport) return;
    const root = document.documentElement;
    let top = 0;
    let bottom = 0;
    let frame: number | null = null;

    const apply = () => {
      frame = null;
      const next = resolveViewportShift(readSample(viewport));
      if (next.top !== top) {
        top = next.top;
        root.style.setProperty(TOP_VAR, `${top}px`);
      }
      if (next.bottom !== bottom) {
        bottom = next.bottom;
        root.style.setProperty(BOTTOM_VAR, `${bottom}px`);
      }
    };
    const schedule = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(apply);
    };

    apply();
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    window.addEventListener("pageshow", schedule);
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    document.addEventListener("visibilitychange", schedule);
    return () => {
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      window.removeEventListener("pageshow", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
      document.removeEventListener("visibilitychange", schedule);
      if (frame !== null) window.cancelAnimationFrame(frame);
      root.style.removeProperty(TOP_VAR);
      root.style.removeProperty(BOTTOM_VAR);
    };
  }, [active]);
}
