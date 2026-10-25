import { describe, expect, it } from "vitest";
import {
  LOCAL_BROWSER_CALL_GRACE_MS,
  LOCAL_BROWSER_EXTENSION_BUDGET_MARGIN_MS,
  LOCAL_BROWSER_LIMITS,
  LOCAL_BROWSER_TOOL_NAMES,
} from "@tickernelz/paperclip-pro-shared";
import { localBrowserCallBudget } from "../services/local-browser/timeouts.js";

const LEGACY_LONG_TOOLS = new Set(["local_browser_network", "local_browser_upload", "local_browser_download"]);

function legacyExtensionBudget(tool: string, args: Record<string, unknown>): number {
  const clamp = (value: unknown, fallback: number, max: number) => {
    const number = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
    return Math.min(Math.max(number, 100), max);
  };
  if (tool === "local_browser_navigate") return clamp(args.timeoutMs, 15_000, 120_000) + 5_000;
  if (tool === "local_browser_wait") return clamp(args.timeoutMs, 10_000, 120_000) + 5_000;
  if (tool === "local_browser_act" || tool === "local_browser_evaluate") return clamp(args.timeoutMs, 30_000, 60_000) + 5_000;
  if (LEGACY_LONG_TOOLS.has(tool)) return 60_000;
  return 30_000;
}

const ARG_SHAPES: Record<string, unknown>[] = [
  {},
  { timeoutMs: 0 },
  { timeoutMs: 100 },
  { timeoutMs: 5_000 },
  { timeoutMs: 30_000 },
  { timeoutMs: 60_000 },
  { timeoutMs: 120_000 },
  { timeoutMs: 600_000 },
];

const CALL_LIMITS = [LOCAL_BROWSER_LIMITS.callMaxMs.min, 30_000, LOCAL_BROWSER_LIMITS.callMaxMs.default, LOCAL_BROWSER_LIMITS.callMaxMs.ceiling];

describe("call budgets under the budget.v1 model", () => {
  for (const tool of LOCAL_BROWSER_TOOL_NAMES) {
    for (const args of ARG_SHAPES) {
      const label = tool + " " + JSON.stringify(args);
      it("never undercuts a legacy extension at the default limit: " + label, () => {
        expect(localBrowserCallBudget(tool, args)).toBeGreaterThanOrEqual(legacyExtensionBudget(tool, args));
      });
      it("stays inside the company call limit and leaves the extension its margin: " + label, () => {
        for (const callMaxMs of CALL_LIMITS) {
          const budget = localBrowserCallBudget(tool, args, callMaxMs);
          expect(budget).toBeLessThanOrEqual(callMaxMs + LOCAL_BROWSER_CALL_GRACE_MS);
          expect(budget - LOCAL_BROWSER_EXTENSION_BUDGET_MARGIN_MS).toBeGreaterThan(0);
        }
      });
    }
  }
});
