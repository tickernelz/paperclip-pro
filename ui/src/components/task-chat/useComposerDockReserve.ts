import { useEffect, useState } from "react";

const RESERVE_VAR = "--tc-composer-reserve";

/** Measures the pinned composer dock so the thread reserves exactly its height as it grows. */
export function useComposerDockReserve(enabled: boolean): {
  dockRef: (node: HTMLDivElement | null) => void;
  reserve: number;
} {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [reserve, setReserve] = useState(0);

  useEffect(() => {
    if (!enabled || !node) {
      setReserve(0);
      return;
    }
    const measure = () => {
      setReserve(Math.ceil(node.getBoundingClientRect().height));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, node]);

  useEffect(() => {
    if (!enabled) return;
    const style = document.documentElement.style;
    style.setProperty(RESERVE_VAR, `${reserve}px`);
    return () => {
      style.removeProperty(RESERVE_VAR);
    };
  }, [enabled, reserve]);

  return { dockRef: setNode, reserve };
}
