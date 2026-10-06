import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.mock("@tickernelz/paperclip-pro-adapter-utils/execution-target", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, runAdapterExecutionTargetProcess: vi.fn() };
});

import { execute } from "./execute.js";
import { runAdapterExecutionTargetProcess } from "@tickernelz/paperclip-pro-adapter-utils/execution-target";

const runProcessMock = vi.mocked(runAdapterExecutionTargetProcess);

type ProcessOptions = { onProcessStopped?: () => void };

function processResult(overrides: Record<string, unknown> = {}) {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: "",
    stderr: "",
    pid: 4321,
    startedAt: new Date().toISOString(),
    ...overrides,
  } as never;
}

describe("OMP local provider stop receipt", () => {
  let root: string;
  let commandPath: string;
  let events: string[];

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-omp-provider-stop-"));
    commandPath = path.join(root, "fake-omp");
    await fs.writeFile(commandPath, "#!/bin/sh\nexit 0\n", "utf8");
    await fs.chmod(commandPath, 0o755);
    events = [];
    runProcessMock.mockReset();
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  function exitsWith(overrides: Record<string, unknown>, stopped = true) {
    return async (...args: unknown[]) => {
      const options = args[4] as ProcessOptions;
      events.push("process-exited");
      if (stopped) options.onProcessStopped?.();
      return processResult(overrides);
    };
  }

  async function run(signal?: AbortSignal, rpcSteering = false) {
    const onProviderStopped = vi.fn(async () => {
      events.push("provider-stopped");
    });
    await execute({
      runId: "run-provider-stop",
      agent: { id: "agent-1", companyId: "company-1", name: "OMP", adapterType: "omp_local", adapterConfig: {} },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: { command: commandPath, cwd: root, noSession: true, rpcSteering },
      context: {},
      signal,
      onLog: async () => {},
      onProviderStopped,
    });
    return onProviderStopped;
  }

  it("signals provider stop once after a successful process exits", async () => {
    runProcessMock.mockImplementation(exitsWith({ exitCode: 0 }));
    const onProviderStopped = await run();
    expect(onProviderStopped).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["process-exited", "provider-stopped"]);
  });

  it("signals provider stop once after a failed process exits", async () => {
    runProcessMock.mockImplementation(exitsWith({ exitCode: 1, stderr: "boom" }));
    const onProviderStopped = await run();
    expect(onProviderStopped).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["process-exited", "provider-stopped"]);
  });

  it("signals provider stop once after a cancelled process exits", async () => {
    const controller = new AbortController();
    controller.abort();
    runProcessMock.mockImplementation(exitsWith({ exitCode: null, signal: "SIGINT" }));
    const onProviderStopped = await run(controller.signal);
    expect(onProviderStopped).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["process-exited", "provider-stopped"]);
  });

  it("signals provider stop once after an RPC-mode process exits", async () => {
    runProcessMock.mockImplementation(exitsWith({ exitCode: 0 }));
    const onProviderStopped = await run(undefined, true);
    expect(onProviderStopped).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["process-exited", "provider-stopped"]);
  });

  it("does not signal provider stop when the process exit is not confirmed", async () => {
    runProcessMock.mockImplementation(exitsWith({ exitCode: null, timedOut: true }, false));
    const onProviderStopped = await run();
    expect(onProviderStopped).not.toHaveBeenCalled();
  });
});
