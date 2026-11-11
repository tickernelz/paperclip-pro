const DEFAULT_INTERVAL_MS = 10_000;

interface PerfMeasureReaperGlobal {
  __paperclipKeepPerfMeasures?: boolean;
}

export function startPerfMeasureReaper(intervalMs: number = DEFAULT_INTERVAL_MS): () => void {
  if (typeof performance === "undefined" || typeof performance.clearMeasures !== "function") {
    return () => {};
  }
  const reap = () => {
    if ((globalThis as PerfMeasureReaperGlobal).__paperclipKeepPerfMeasures) return;
    // clearMeasures() is cheap and does not materialize the (huge) buffer —
    // unlike getEntriesByType('measure'), so never call that to gate on size.
    performance.clearMeasures();
  };
  const id = setInterval(reap, intervalMs);
  return () => clearInterval(id);
}
