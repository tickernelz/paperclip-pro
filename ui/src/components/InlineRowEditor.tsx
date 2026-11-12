import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils";

const FIRST_FIELD = "input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled)";
const DISCARD_PROMPT = "Discard your unsaved changes?";
const VISIBLE_FRACTION = 2 / 3;

export function useInlineRowEditor<T>(keyOf: (value: T) => string, fallbackFocus?: RefObject<HTMLElement | null>) {
  const [open, setOpen] = useState<T | null>(null);
  const dirty = useRef(false);
  const triggers = useRef(new Map<string, HTMLElement>());
  const keyOfRef = useRef(keyOf);
  keyOfRef.current = keyOf;
  const openRef = useRef(open);
  openRef.current = open;
  const baseId = useId();
  const openKey = open === null ? null : keyOf(open);

  const panelId = useCallback((key: string) => `${baseId}-row-editor-${key.replace(/\s+/g, "_")}`, [baseId]);
  const mayDiscard = () => !dirty.current || window.confirm(DISCARD_PROMPT);

  const close = useCallback((restoreFocus = true) => {
    const current = openRef.current;
    dirty.current = false;
    setOpen(null);
    if (current === null || !restoreFocus) return;
    const key = keyOfRef.current(current);
    requestAnimationFrame(() => {
      const trigger = triggers.current.get(key);
      (trigger?.isConnected ? trigger : fallbackFocus?.current)?.focus();
    });
  }, [fallbackFocus]);

  const request = (next: T): boolean => {
    if (openKey === keyOf(next)) return true;
    if (openKey !== null && !mayDiscard()) return false;
    dirty.current = false;
    setOpen(next);
    return true;
  };

  const toggle = (next: T) => {
    if (openKey !== keyOf(next)) {
      request(next);
      return;
    }
    if (mayDiscard()) close();
  };

  const dismiss = () => {
    if (mayDiscard()) close();
  };

  const setDirty = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);

  const triggerProps = (key: string) => ({
    ref: (element: HTMLElement | null) => {
      if (element) triggers.current.set(key, element);
    },
    "aria-expanded": openKey === key,
    "aria-controls": openKey === key ? panelId(key) : undefined,
  });

  return { open, openKey, request, toggle, close, dismiss, setDirty, triggerProps, panelId };
}

export function InlineRowEditorPanel({
  id,
  onEscape,
  className,
  children,
}: {
  id: string;
  onEscape: () => void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.querySelector<HTMLElement>(FIRST_FIELD)?.focus({ preventScroll: true });
    const top = node.getBoundingClientRect().top;
    if (top >= 0 && top <= window.innerHeight * VISIBLE_FRACTION) return;
    const row = node.parentElement?.tagName === "LI" ? node.previousElementSibling : null;
    if (row) row.scrollIntoView?.({ block: "center" });
    else node.scrollIntoView?.({ block: "start" });
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    onEscape();
  };
  return (
    <div ref={ref} id={id} className={cn("scroll-mt-16", className)} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}
