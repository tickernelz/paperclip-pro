import {
  LOCAL_BROWSER_CALL_GRACE_MS,
  LOCAL_BROWSER_CALL_TIMEOUT_MS,
  LOCAL_BROWSER_LIMITS,
} from "@tickernelz/paperclip-pro-shared";

export { LOCAL_BROWSER_CALL_GRACE_MS };
export const LOCAL_BROWSER_DEFAULT_NAVIGATE_MS = 15_000;
export const LOCAL_BROWSER_DEFAULT_WAIT_MS = 10_000;

const TIMEOUT_DEFAULTS: Record<string, number> = {
  local_browser_navigate: LOCAL_BROWSER_DEFAULT_NAVIGATE_MS,
  local_browser_wait: LOCAL_BROWSER_DEFAULT_WAIT_MS,
  local_browser_act: LOCAL_BROWSER_CALL_TIMEOUT_MS,
  local_browser_evaluate: LOCAL_BROWSER_CALL_TIMEOUT_MS,
};

const LONG_CALL_TOOLS = new Set([
  "local_browser_network",
  "local_browser_upload",
  "local_browser_download",
  "local_browser_api",
]);

export function localBrowserTimeoutTools(): string[] {
  return Object.keys(TIMEOUT_DEFAULTS);
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  if (number < min) return min;
  if (number > max) return max;
  return number;
}

export function localBrowserCallBudget(
  tool: string,
  args: Record<string, unknown> | null | undefined,
  callMaxMs: number = LOCAL_BROWSER_LIMITS.callMaxMs.default,
): number {
  const fallback = TIMEOUT_DEFAULTS[tool];
  if (fallback !== undefined) {
    return clampInt(args?.timeoutMs, fallback, 100, callMaxMs) + LOCAL_BROWSER_CALL_GRACE_MS;
  }
  if (LONG_CALL_TOOLS.has(tool)) return callMaxMs + LOCAL_BROWSER_CALL_GRACE_MS;
  return Math.min(LOCAL_BROWSER_CALL_TIMEOUT_MS, callMaxMs) + LOCAL_BROWSER_CALL_GRACE_MS;
}
