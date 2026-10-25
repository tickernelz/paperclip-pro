import { describe, expect, it } from "vitest";
import {
  LOCAL_BROWSER_CALL_GRACE_MS,
  LOCAL_BROWSER_DEFAULT_NAVIGATE_MS,
  LOCAL_BROWSER_DEFAULT_WAIT_MS,
  localBrowserCallBudget,
} from "../services/local-browser/timeouts.js";
import { LOCAL_BROWSER_CALL_TIMEOUT_MS, LOCAL_BROWSER_LIMITS } from "@tickernelz/paperclip-pro-shared";

const DEFAULT_CALL_MAX = LOCAL_BROWSER_LIMITS.callMaxMs.default;

describe("localBrowserCallBudget", () => {
  it("gives wait and navigate their requested timeout plus grace", () => {
    expect(localBrowserCallBudget("local_browser_wait", { timeoutMs: 60_000 })).toBe(65_000);
    expect(localBrowserCallBudget("local_browser_navigate", { timeoutMs: 60_000 })).toBe(65_000);
  });

  it("uses the tool defaults when no timeout is requested", () => {
    expect(localBrowserCallBudget("local_browser_wait", {})).toBe(LOCAL_BROWSER_DEFAULT_WAIT_MS + LOCAL_BROWSER_CALL_GRACE_MS);
    expect(localBrowserCallBudget("local_browser_navigate", {})).toBe(LOCAL_BROWSER_DEFAULT_NAVIGATE_MS + LOCAL_BROWSER_CALL_GRACE_MS);
    expect(localBrowserCallBudget("local_browser_act", {})).toBe(LOCAL_BROWSER_CALL_TIMEOUT_MS + LOCAL_BROWSER_CALL_GRACE_MS);
    expect(localBrowserCallBudget("local_browser_evaluate", {})).toBe(LOCAL_BROWSER_CALL_TIMEOUT_MS + LOCAL_BROWSER_CALL_GRACE_MS);
  });

  it("clamps every requested timeout to the company call limit", () => {
    expect(localBrowserCallBudget("local_browser_act", { timeoutMs: 600_000 })).toBe(DEFAULT_CALL_MAX + LOCAL_BROWSER_CALL_GRACE_MS);
    expect(localBrowserCallBudget("local_browser_act", { timeoutMs: 600_000 }, 600_000)).toBe(600_000 + LOCAL_BROWSER_CALL_GRACE_MS);
    expect(localBrowserCallBudget("local_browser_wait", { timeoutMs: 60_000 }, 20_000)).toBe(20_000 + LOCAL_BROWSER_CALL_GRACE_MS);
    expect(localBrowserCallBudget("local_browser_act", { timeoutMs: 1 })).toBe(100 + LOCAL_BROWSER_CALL_GRACE_MS);
    expect(localBrowserCallBudget("local_browser_navigate", { timeoutMs: 0 })).toBe(100 + LOCAL_BROWSER_CALL_GRACE_MS);
  });

  it("gives the long tools the whole call limit and everything else the shared default", () => {
    for (const tool of ["local_browser_network", "local_browser_upload", "local_browser_download", "local_browser_api"]) {
      expect(localBrowserCallBudget(tool, {})).toBe(DEFAULT_CALL_MAX + LOCAL_BROWSER_CALL_GRACE_MS);
      expect(localBrowserCallBudget(tool, {}, 300_000)).toBe(300_000 + LOCAL_BROWSER_CALL_GRACE_MS);
    }
    for (const tool of ["local_browser_snapshot", "local_browser_read", "local_browser_screenshot", "local_browser_open", "local_browser_storage", "local_browser_close", "local_browser_context", "local_browser_permissions"]) {
      expect(localBrowserCallBudget(tool, {})).toBe(LOCAL_BROWSER_CALL_TIMEOUT_MS + LOCAL_BROWSER_CALL_GRACE_MS);
      expect(localBrowserCallBudget(tool, {}, 5_000)).toBe(5_000 + LOCAL_BROWSER_CALL_GRACE_MS);
    }
  });
});
