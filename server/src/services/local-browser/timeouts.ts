import { LOCAL_BROWSER_CALL_TIMEOUT_MS } from "@tickernelz/paperclip-pro-shared";

export const LOCAL_BROWSER_CALL_GRACE_MS = 5_000;
export const LOCAL_BROWSER_LONG_CALL_MS = 60_000;
export const LOCAL_BROWSER_MAX_CALL_MS = 120_000;
export const LOCAL_BROWSER_MAX_TOOL_CALL_MS = 60_000;
export const LOCAL_BROWSER_DEFAULT_NAVIGATE_MS = 15_000;
export const LOCAL_BROWSER_DEFAULT_WAIT_MS = 10_000;

const LONG_CALL_TOOLS = new Set(["local_browser_network", "local_browser_upload", "local_browser_download"]);

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  if (number < min) return min;
  if (number > max) return max;
  return number;
}

export function localBrowserCallBudget(tool: string, args: Record<string, unknown> | null | undefined): number {
  const requested = args?.timeoutMs;
  if (tool === "local_browser_navigate") {
    return clampInt(requested, LOCAL_BROWSER_DEFAULT_NAVIGATE_MS, 100, LOCAL_BROWSER_MAX_CALL_MS) + LOCAL_BROWSER_CALL_GRACE_MS;
  }
  if (tool === "local_browser_wait") {
    return clampInt(requested, LOCAL_BROWSER_DEFAULT_WAIT_MS, 100, LOCAL_BROWSER_MAX_CALL_MS) + LOCAL_BROWSER_CALL_GRACE_MS;
  }
  if (tool === "local_browser_act" || tool === "local_browser_evaluate") {
    return clampInt(requested, LOCAL_BROWSER_CALL_TIMEOUT_MS, 100, LOCAL_BROWSER_MAX_TOOL_CALL_MS) + LOCAL_BROWSER_CALL_GRACE_MS;
  }
  if (LONG_CALL_TOOLS.has(tool)) return LOCAL_BROWSER_LONG_CALL_MS;
  return LOCAL_BROWSER_CALL_TIMEOUT_MS;
}
