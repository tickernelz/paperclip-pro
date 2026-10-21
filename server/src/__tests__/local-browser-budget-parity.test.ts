import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { localBrowserCallBudget } from "../services/local-browser/timeouts.js";
import { LOCAL_BROWSER_TOOL_NAMES } from "@tickernelz/paperclip-pro-shared";

const root = path.resolve(__dirname, "..", "..", "..");

function loadBudget(relativePaths: string[], name: string): (tool: string, args: Record<string, unknown>) => number {
  const sandbox: { globalThis: unknown } = { globalThis: null };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const relativePath of relativePaths) {
    const source = readFileSync(path.join(root, relativePath), "utf8");
    new vm.Script(source, { filename: relativePath }).runInContext(sandbox);
  }
  const relativePath = relativePaths[relativePaths.length - 1];
  const scope = sandbox as unknown as { LB: { budget: Record<string, unknown> } };
  const budget = scope.LB.budget;
  const fn = budget[name];
  if (typeof fn !== "function") throw new Error(relativePath + " does not export " + name);
  return fn as (tool: string, args: Record<string, unknown>) => number;
}

const chromium = loadBudget(
  ["apps/local-browser/chromium/lib/protocol.js", "apps/local-browser/chromium/lib/budget.js"],
  "callBudget",
);
const firefox = loadBudget(
  ["apps/local-browser/firefox/lib/protocol.js", "apps/local-browser/firefox/lib/budget.js"],
  "budgetFor",
);

const ARG_SHAPES: Record<string, unknown>[] = [
  {},
  { timeoutMs: 0 },
  { timeoutMs: 100 },
  { timeoutMs: 5_000 },
  { timeoutMs: 10_000 },
  { timeoutMs: 15_000 },
  { timeoutMs: 30_000 },
  { timeoutMs: 60_000 },
  { timeoutMs: 120_000 },
  { timeoutMs: 600_000 },
];

describe("call budgets agree across the server and both extensions", () => {
  for (const tool of LOCAL_BROWSER_TOOL_NAMES) {
    for (const args of ARG_SHAPES) {
      const label = tool + " " + JSON.stringify(args);
      it(label, () => {
        const server = localBrowserCallBudget(tool, args);
        expect(chromium(tool, args), "chromium budget for " + label).toBe(server);
        expect(firefox(tool, args), "firefox budget for " + label).toBe(server);
      });
    }
  }
});
