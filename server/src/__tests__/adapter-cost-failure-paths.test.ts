import { describe, expect, it, vi } from "vitest";
import type { AdapterExecutionContext } from "@tickernelz/wardmote-adapter-utils";

const processResult = vi.hoisted(() => vi.fn());
vi.mock("@tickernelz/wardmote-adapter-utils/execution-target", async (original) => ({
  ...await original<typeof import("@tickernelz/wardmote-adapter-utils/execution-target")>(),
  runAdapterExecutionTargetProcess: processResult,
}));

describe("process adapter bootstrap accounting proof", () => {
  const context = (config: Record<string, unknown>): AdapterExecutionContext => ({
    runId: `bootstrap-${crypto.randomUUID()}`,
    agent: { id: "agent", companyId: "company", name: "Process", adapterType: "process", adapterConfig: {} },
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config, context: {}, onLog: async () => {},
  });
  it.each([{}, { command: "/nonexistent-wardmote-accounting-command" },
    { command: process.execPath, cwd: "/nonexistent-wardmote-accounting-directory" }])(
    "proves no provider work for a failure before spawn: %j", async (config) => {
      const { execute } = await import("../adapters/process/execute.js");
      const onSpawn = vi.fn();
      const result = await execute({ ...context(config), onSpawn });
      expect(result).toMatchObject({ exitCode: 1, executionRecovery: { kind: "bootstrap", providerWorkStarted: false } });
      expect(result.errorMessage).toBeTruthy();
      expect(onSpawn).not.toHaveBeenCalled();
    },
  );
  it("does not invent bootstrap proof when a spawned process fails", async () => {
    const { execute } = await import("../adapters/process/execute.js");
    const onSpawn = vi.fn(async () => { throw new Error("Metadata persistence failed"); });
    const result = await execute({ ...context({ command: process.execPath, args: ["-e", "process.exit(7)"] }), onSpawn });
    expect(onSpawn).toHaveBeenCalledOnce();
    expect(result.exitCode).toBe(7);
    expect(result.executionRecovery).toBeUndefined();
  });
});
