import { useEffect } from "react";

const INSET_BOTTOM_VAR = "--mobile-viewport-inset-bottom";
const HEIGHT_VAR = "--mobile-viewport-height";

let subscribers = 0;
let detach: (() => void) | null = null;

function publish(): void {
  const style = document.documentElement.style;
  const viewport = window.visualViewport;
  const height = viewport?.height ?? window.innerHeight;
  const offsetTop = viewport?.offsetTop ?? 0;
  const inset = Math.max(0, Math.round(window.innerHeight - height - offsetTop));
  style.setProperty(INSET_BOTTOM_VAR, `${inset}px`);
  style.setProperty(HEIGHT_VAR, `${Math.round(height)}px`);
}

function attach(): () => void {
  const viewport = window.visualViewport;
  publish();
  viewport?.addEventListener("resize", publish);
  viewport?.addEventListener("scroll", publish);
  window.addEventListener("resize", publish);
  window.addEventListener("orientationchange", publish);
  return () => {
    viewport?.removeEventListener("resize", publish);
    viewport?.removeEventListener("scroll", publish);
    window.removeEventListener("resize", publish);
    window.removeEventListener("orientationchange", publish);
    const style = document.documentElement.style;
    style.removeProperty(INSET_BOTTOM_VAR);
    style.removeProperty(HEIGHT_VAR);
  };
}

/** Publishes the visual-viewport height and software-keyboard inset as CSS variables while any consumer is active. */
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
