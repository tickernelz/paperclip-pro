import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";

vi.mock("@tickernelz/paperclip-pro-adapter-utils/execution-target", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, runAdapterExecutionTargetProcess: vi.fn() };
});

import { execute } from "./execute.js";
import { buildOmpSettingsOverlay, renderOmpSettingsOverlay } from "./settings-overlay.js";
import { runAdapterExecutionTargetProcess } from "@tickernelz/paperclip-pro-adapter-utils/execution-target";

const runProcessMock = vi.mocked(runAdapterExecutionTargetProcess);

interface Invocation {
  args: string[];
  env: Record<string, string>;
  overlayPath: string | null;
  overlay: Record<string, unknown> | null;
}

describe("OMP local toggle overlay", () => {
  let root: string;
  let commandPath: string;
  let workspaceCwd: string;
  let captured: Invocation | null;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-omp-toggles-"));
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
      options: { env: Record<string, string> },
    ) => {
      const index = args.indexOf("--config");
      const overlayPath = index >= 0 ? (args[index + 1] ?? null) : null;
      let overlay: Record<string, unknown> | null = null;
      if (overlayPath) {
        overlay = parseYaml(await fs.readFile(overlayPath, "utf8")) as Record<string, unknown>;
      }
      captured = { args, env: options.env, overlayPath, overlay };
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

  async function run(config: Record<string, unknown>): Promise<Invocation> {
    await execute({
      runId: "run-toggles",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "OMP",
        adapterType: "omp_local",
        adapterConfig: {},
      },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: { command: commandPath, noSession: true, cwd: workspaceCwd, ...config },
      context: {},
      onLog: async () => {},
    });
    expect(captured).not.toBeNull();
    return captured as Invocation;
  }

  it("pins every settings-backed toggle off by default instead of inheriting the global config", async () => {
    const invocation = await run({});
    expect(invocation.overlayPath).toBeTruthy();
    expect(invocation.overlay).toEqual({
      advisor: { enabled: false },
      prewalk: { enabled: false },
      lsp: { enabled: true },
      skills: { enabled: true },
      task: { maxRecursionDepth: 0 },
    });
    expect(invocation.args).not.toContain("--advisor");
  });

  it("pins the advisor on and still passes the explicit flag", async () => {
    const invocation = await run({ advisor: true });
    expect(invocation.overlay?.advisor).toEqual({ enabled: true });
    expect(invocation.args).toContain("--advisor");
  });

  it("pins lsp and skills off alongside their disabling flags", async () => {
    const invocation = await run({ noLsp: true, noSkills: true });
    expect(invocation.overlay?.lsp).toEqual({ enabled: false });
    expect(invocation.overlay?.skills).toEqual({ enabled: false });
    expect(invocation.args).toContain("--no-lsp");
    expect(invocation.args).toContain("--no-skills");
  });

  it("pins prewalk on when enabled and off when explicitly disabled", async () => {
    const enabled = await run({ prewalk: true });
    expect(enabled.overlay?.prewalk).toEqual({ enabled: true });
    expect(enabled.args).toContain("--prewalk");
    const disabled = await run({ prewalk: true, noPrewalk: true });
    expect(disabled.overlay?.prewalk).toEqual({ enabled: false });
    expect(disabled.args).toContain("--no-prewalk");
    expect(disabled.args).not.toContain("--prewalk");
  });

  it("keeps user config overlays ahead of the generated overlay", async () => {
    const userOverlay = path.join(root, "user.yml");
    await fs.writeFile(userOverlay, "advisor:\n  enabled: true\n", "utf8");
    const invocation = await run({ configFiles: userOverlay });
    const positions = invocation.args
      .map((value, index) => ({ value, index }))
      .filter((entry) => entry.value === "--config")
      .map((entry) => entry.index);
    expect(positions).toHaveLength(2);
    expect(invocation.args[positions[0] + 1]).toBe(invocation.overlayPath);
    expect(invocation.args[positions[1] + 1]).toBe(userOverlay);
  });

  it("zeroes OMP task recursion in the overlay handed to the run regardless of adapter config", async () => {
    for (const config of [{}, { task: { maxRecursionDepth: 5 } }, { tools: "read,bash" }]) {
      const invocation = await run(config);
      expect(invocation.overlayPath).toBeTruthy();
      expect(invocation.overlay?.task).toEqual({ maxRecursionDepth: 0 });
    }
  });

  it("renders task.maxRecursionDepth into the overlay yaml OMP actually parses", () => {
    expect(parseYaml(renderOmpSettingsOverlay({}))).toEqual({
      advisor: { enabled: false },
      prewalk: { enabled: false },
      lsp: { enabled: true },
      skills: { enabled: true },
      task: { maxRecursionDepth: 0 },
    });
  });

  it("removes the generated overlay once the run finishes", async () => {
    const invocation = await run({});
    await expect(fs.access(invocation.overlayPath as string)).rejects.toThrow();
  });

  it("pins the pty and title environment instead of inheriting it", async () => {
    process.env.PI_NO_PTY = "1";
    process.env.PI_NO_TITLE = "1";
    try {
      const inherited = await run({ noPty: false, noTitle: false });
      expect(inherited.env.PI_NO_PTY).toBeUndefined();
      expect(inherited.env.PI_NO_TITLE).toBeUndefined();
      const disabled = await run({ noPty: true, noTitle: true });
      expect(disabled.env.PI_NO_PTY).toBe("1");
      expect(disabled.env.PI_NO_TITLE).toBe("1");
    } finally {
      delete process.env.PI_NO_PTY;
      delete process.env.PI_NO_TITLE;
    }
  });

  it("maps every toggle to an explicit boolean in the overlay payload", () => {
    expect(buildOmpSettingsOverlay({})).toEqual({
      advisor: { enabled: false },
      prewalk: { enabled: false },
      lsp: { enabled: true },
      skills: { enabled: true },
      task: { maxRecursionDepth: 0 },
    });
    expect(buildOmpSettingsOverlay({ advisor: true, noLsp: true, noSkills: true, prewalk: true })).toEqual({
      advisor: { enabled: true },
      prewalk: { enabled: true },
      lsp: { enabled: false },
      skills: { enabled: false },
      task: { maxRecursionDepth: 0 },
    });
  });
});
