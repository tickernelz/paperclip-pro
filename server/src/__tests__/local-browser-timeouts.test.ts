import { describe, expect, it } from "vitest";
import {
  LOCAL_BROWSER_CALL_GRACE_MS,
  LOCAL_BROWSER_LONG_CALL_MS,
  localBrowserCallBudget,
} from "../services/local-browser/timeouts.js";
import { LOCAL_BROWSER_CALL_TIMEOUT_MS } from "@tickernelz/paperclip-pro-shared";

describe("localBrowserCallBudget", () => {
  it("gives wait and navigate their requested timeout instead of the 30s default", () => {
    expect(localBrowserCallBudget("local_browser_wait", { timeoutMs: 60_000 })).toBe(65_000);
    expect(localBrowserCallBudget("local_browser_navigate", { timeoutMs: 60_000 })).toBe(65_000);
    expect(localBrowserCallBudget("local_browser_wait", { timeoutMs: 60_000 })).toBeGreaterThan(
      LOCAL_BROWSER_CALL_TIMEOUT_MS,
    );
  });

  it("uses the tool defaults when no timeout is requested", () => {
    expect(localBrowserCallBudget("local_browser_wait", {})).toBe(10_000 + LOCAL_BROWSER_CALL_GRACE_MS);
    expect(localBrowserCallBudget("local_browser_navigate", {})).toBe(15_000 + LOCAL_BROWSER_CALL_GRACE_MS);
    expect(localBrowserCallBudget("local_browser_act", {})).toBe(LOCAL_BROWSER_CALL_TIMEOUT_MS + LOCAL_BROWSER_CALL_GRACE_MS);
    expect(localBrowserCallBudget("local_browser_evaluate", {})).toBe(
      LOCAL_BROWSER_CALL_TIMEOUT_MS + LOCAL_BROWSER_CALL_GRACE_MS,
    );
  });

  it("clamps act and evaluate to the 60s tool ceiling", () => {
    expect(localBrowserCallBudget("local_browser_act", { timeoutMs: 120_000 })).toBe(60_000 + LOCAL_BROWSER_CALL_GRACE_MS);
    expect(localBrowserCallBudget("local_browser_evaluate", { timeoutMs: 5_000 })).toBe(5_000 + LOCAL_BROWSER_CALL_GRACE_MS);
    expect(localBrowserCallBudget("local_browser_act", { timeoutMs: 1 })).toBe(100 + LOCAL_BROWSER_CALL_GRACE_MS);
  });

  it("clamps wait and navigate to the 120s ceiling", () => {
    expect(localBrowserCallBudget("local_browser_wait", { timeoutMs: 999_999 })).toBe(120_000 + LOCAL_BROWSER_CALL_GRACE_MS);
    expect(localBrowserCallBudget("local_browser_navigate", { timeoutMs: 0 })).toBe(100 + LOCAL_BROWSER_CALL_GRACE_MS);
  });

  it("gives the long tools 60s and everything else the shared default", () => {
    for (const tool of ["local_browser_network", "local_browser_upload", "local_browser_download"]) {
      expect(localBrowserCallBudget(tool, {})).toBe(LOCAL_BROWSER_LONG_CALL_MS);
      expect(localBrowserCallBudget(tool, { timeoutMs: 100 })).toBe(LOCAL_BROWSER_LONG_CALL_MS);
    }
    for (const tool of ["local_browser_snapshot", "local_browser_read", "local_browser_screenshot", "local_browser_open", "local_browser_storage", "local_browser_close"]) {
      expect(localBrowserCallBudget(tool, {})).toBe(LOCAL_BROWSER_CALL_TIMEOUT_MS);
    }
  });
});
