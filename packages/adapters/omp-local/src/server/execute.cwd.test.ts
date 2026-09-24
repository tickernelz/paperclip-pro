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

describe("OMP local workspace cwd precedence", () => {
  let root: string;
  let commandPath: string;
  let configuredCwd: string;
  let workspaceCwd: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-omp-cwd-"));
    configuredCwd = path.join(root, "configured");
    workspaceCwd = path.join(root, "workspace");
    commandPath = path.join(root, "fake-omp");
    await fs.mkdir(configuredCwd, { recursive: true });
    await fs.mkdir(workspaceCwd, { recursive: true });
    await fs.writeFile(commandPath, "#!/bin/sh\nexit 0\n", "utf8");
    await fs.chmod(commandPath, 0o755);
    runProcessMock.mockReset();
    runProcessMock.mockResolvedValue(processResult());
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function run(workspace: Record<string, unknown>, cwdConfig: string | undefined) {
    await execute({
      runId: "run-cwd",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "OMP",
        adapterType: "omp_local",
        adapterConfig: {},
      },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: {
        command: commandPath,
        noSession: true,
        ...(cwdConfig ? { cwd: cwdConfig } : {}),
      },
      context: { paperclipWorkspace: workspace },
      onLog: async () => {},
    });
    expect(runProcessMock).toHaveBeenCalled();
    const call = runProcessMock.mock.calls.at(-1) as unknown as [
      string,
      unknown,
      string,
      string[],
      { cwd: string; env: Record<string, string> },
    ];
    return call[4];
  }

  it("prefers a configured cwd over the agent_home fallback workspace", async () => {
    const options = await run({ cwd: workspaceCwd, source: "agent_home" }, configuredCwd);
    expect(options.cwd).toBe(configuredCwd);
    expect(options.env.PAPERCLIP_WORKSPACE_CWD).toBeUndefined();
  });

  it("keeps a project workspace cwd ahead of a configured cwd", async () => {
    const options = await run({ cwd: workspaceCwd, source: "project_primary" }, configuredCwd);
    expect(options.cwd).toBe(workspaceCwd);
    expect(options.env.PAPERCLIP_WORKSPACE_CWD).toBe(workspaceCwd);
  });

  it("keeps a task workspace cwd ahead of a configured cwd", async () => {
    const options = await run({ cwd: workspaceCwd, source: "task_session" }, configuredCwd);
    expect(options.cwd).toBe(workspaceCwd);
    expect(options.env.PAPERCLIP_WORKSPACE_CWD).toBe(workspaceCwd);
  });

  it("falls back to the agent_home workspace cwd when no cwd is configured", async () => {
    const options = await run({ cwd: workspaceCwd, source: "agent_home" }, undefined);
    expect(options.cwd).toBe(workspaceCwd);
    expect(options.env.PAPERCLIP_WORKSPACE_CWD).toBe(workspaceCwd);
  });
});
