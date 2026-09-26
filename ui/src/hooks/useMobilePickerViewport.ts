import { useEffect } from "react";

const KEYBOARD_INSET_VAR = "--mobile-entity-picker-keyboard-inset";
const VIEWPORT_HEIGHT_VAR = "--mobile-entity-picker-viewport-height";

/** Publishes the software keyboard inset and visible viewport height as CSS variables while a picker is open. */
export function useMobilePickerViewport(open: boolean): void {
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const style = document.documentElement.style;
    const viewport = window.visualViewport;
    const apply = () => {
      const height = viewport?.height ?? window.innerHeight;
      const offsetTop = viewport?.offsetTop ?? 0;
      const inset = Math.max(0, Math.round(window.innerHeight - height - offsetTop));
      style.setProperty(KEYBOARD_INSET_VAR, `${inset}px`);
      style.setProperty(VIEWPORT_HEIGHT_VAR, `${Math.round(height)}px`);
    };
    apply();
    viewport?.addEventListener("resize", apply);
    viewport?.addEventListener("scroll", apply);
    window.addEventListener("resize", apply);
    return () => {
      viewport?.removeEventListener("resize", apply);
      viewport?.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
      style.removeProperty(KEYBOARD_INSET_VAR);
      style.removeProperty(VIEWPORT_HEIGHT_VAR);
    };
  }, [open]);
}
