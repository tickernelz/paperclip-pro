import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as ServerUtils from "@tickernelz/paperclip-pro-adapter-utils/server-utils";
import type * as Ssh from "@tickernelz/paperclip-pro-adapter-utils/ssh";
import type * as ExecutionTarget from "@tickernelz/paperclip-pro-adapter-utils/execution-target";

const {
  runAdapterExecutionTargetProcess,
  ensureCommandResolvable,
  resolveCommandForLogs,
  prepareWorkspaceForSshExecution,
  restoreWorkspaceFromSshExecution,
  runSshCommand,
  syncDirectoryToSsh,
  startAdapterExecutionTargetPaperclipBridge,
} = vi.hoisted(() => ({
  runAdapterExecutionTargetProcess: vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: "",
    stderr: "",
    pid: 123,
    startedAt: new Date().toISOString(),
  })),
  ensureCommandResolvable: vi.fn(async () => undefined),
  resolveCommandForLogs: vi.fn(async () => "ssh://fixture@127.0.0.1:2222/remote/workspace :: omp"),
  prepareWorkspaceForSshExecution: vi.fn(async () => ({ gitBacked: false })),
  restoreWorkspaceFromSshExecution: vi.fn(async () => undefined),
  runSshCommand: vi.fn(async () => ({ stdout: "/home/agent", stderr: "", exitCode: 0 })),
  syncDirectoryToSsh: vi.fn(async () => undefined),
  startAdapterExecutionTargetPaperclipBridge: vi.fn(async () => ({
    env: {
      PAPERCLIP_API_URL: "http://127.0.0.1:4310",
      PAPERCLIP_API_KEY: "bridge-token",
      PAPERCLIP_API_BRIDGE_MODE: "queue_v1",
    },
    stop: async () => {},
  })),
}));

vi.mock("@tickernelz/paperclip-pro-adapter-utils/server-utils", async () => {
  const actual = await vi.importActual<typeof ServerUtils>(
    "@tickernelz/paperclip-pro-adapter-utils/server-utils",
  );
  return { ...actual, ensureCommandResolvable, resolveCommandForLogs };
});

vi.mock("@tickernelz/paperclip-pro-adapter-utils/ssh", async () => {
  const actual = await vi.importActual<typeof Ssh>(
    "@tickernelz/paperclip-pro-adapter-utils/ssh",
  );
  return {
    ...actual,
    prepareWorkspaceForSshExecution,
    restoreWorkspaceFromSshExecution,
    runSshCommand,
    syncDirectoryToSsh,
  };
});

vi.mock("@tickernelz/paperclip-pro-adapter-utils/execution-target", async () => {
  const actual = await vi.importActual<typeof ExecutionTarget>(
    "@tickernelz/paperclip-pro-adapter-utils/execution-target",
  );
  return { ...actual, runAdapterExecutionTargetProcess, startAdapterExecutionTargetPaperclipBridge };
});

import { execute } from "./execute.js";
import { OMP_PYTHON_ENV_FILE_NAME, OMP_PYTHON_LAUNCHER_FILE_NAME } from "./python-env.js";

describe("OMP remote Python env bridge", () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    vi.clearAllMocks();
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("launches OMP through a remote PYTHONPATH launcher instead of a literal PYTHONPATH", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "paperclip-omp-remote-pyenv-"));
    cleanupDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspace");
    await mkdir(workspaceDir, { recursive: true });

    await execute({
      runId: "run-remote-pyenv",
      agent: { id: "agent-1", companyId: "company-1", name: "OMP", adapterType: "omp_local", adapterConfig: {} },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: { command: "omp", paperclipMcp: false },
      context: { paperclipWorkspace: { cwd: workspaceDir, source: "project_primary" } },
      executionTransport: {
        remoteExecution: {
          host: "127.0.0.1",
          port: 2222,
          username: "fixture",
          remoteWorkspacePath: "/remote/workspace",
          remoteCwd: "/remote/workspace",
          privateKey: "PRIVATE KEY",
          knownHosts: "[127.0.0.1]:2222 ssh-ed25519 AAAA",
          strictHostKeyChecking: true,
        },
      },
      onLog: async () => {},
    });

    const spawn = (runAdapterExecutionTargetProcess.mock.calls as unknown as Array<
      [string, unknown, string, string[], { env: Record<string, string> }]
    >).at(-1);
    expect(spawn).toBeDefined();
    const [, , command, args, options] = spawn!;
    expect(options.env).not.toHaveProperty("PYTHONPATH");
    expect(command).toBe("sh");
    const launcherPath = args[0]!;
    expect(path.posix.basename(launcherPath)).toBe(OMP_PYTHON_LAUNCHER_FILE_NAME);
    expect(args[1]).toBe("omp");
    expect(args.join(" ")).not.toContain("bridge-token");

    const bridgeDir = path.posix.dirname(launcherPath);
    const shellScripts = (runSshCommand.mock.calls as unknown as Array<[unknown, string]>).map((call) => call[1]);
    const launcherWrite = shellScripts.find((script) => script.includes(`cat > '${launcherPath}'`));
    expect(launcherWrite).toContain(`PYTHONPATH='${bridgeDir}'"\${PYTHONPATH:+:$PYTHONPATH}"`);
    expect(shellScripts.some((script) => script.includes(path.posix.join(bridgeDir, OMP_PYTHON_ENV_FILE_NAME)))).toBe(true);
    expect(shellScripts.some((script) => script === `rm -rf '${bridgeDir}'`)).toBe(true);
  });
});
