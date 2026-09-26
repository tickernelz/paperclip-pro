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

describe("OMP local model and thinking flags", () => {
  let root: string;
  let commandPath: string;
  let workspaceCwd: string;
  let captured: string[] | null;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-omp-model-override-"));
    workspaceCwd = path.join(root, "workspace");
    commandPath = path.join(root, "fake-omp");
    await fs.mkdir(workspaceCwd, { recursive: true });
    await fs.writeFile(commandPath, "#!/bin/sh\nexit 0\n", "utf8");
    await fs.chmod(commandPath, 0o755);
    captured = null;
    runProcessMock.mockReset();
    runProcessMock.mockImplementation((async (
      _runId: string,
      _target: unknown,
      _command: string,
      args: string[],
    ) => {
      captured = args;
      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: "",
        pid: 4321,
        startedAt: new Date().toISOString(),
      };
    }) as never);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function flagValue(
    config: Record<string, unknown>,
    flag: string,
  ): Promise<string | null> {
    await execute({
      runId: "run-model-override",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "OMP",
        adapterType: "omp_local",
        adapterConfig: { model: "vendor/agent-default", thinking: "low" },
      },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: { command: commandPath, noSession: true, cwd: workspaceCwd, ...config },
      context: {},
      onLog: async () => {},
    });
    const args = captured as string[] | null;
    expect(args).not.toBeNull();
    const index = (args as string[]).indexOf(flag);
    return index >= 0 ? ((args as string[])[index + 1] ?? null) : null;
  }

  it("passes the agent's own model and thinking when the run config carries no override", async () => {
    const agentConfig = { model: "vendor/agent-default", thinking: "low" };
    expect(await flagValue(agentConfig, "--model")).toBe("vendor/agent-default");
    expect(await flagValue(agentConfig, "--thinking")).toBe("low");
  });

  it("passes the per-task override that the run config layered over the agent", async () => {
    const overridden = { model: "vendor/task-model", thinking: "high" };
    expect(await flagValue(overridden, "--model")).toBe("vendor/task-model");
    expect(await flagValue(overridden, "--thinking")).toBe("high");
  });

  it("omits both flags when neither the agent nor the task supplies a value", async () => {
    expect(await flagValue({}, "--model")).toBeNull();
    expect(await flagValue({}, "--thinking")).toBeNull();
  });
});
