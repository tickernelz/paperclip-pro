import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";

vi.mock("@tickernelz/paperclip-pro-adapter-utils/execution-target", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, runAdapterExecutionTargetShellCommand: vi.fn() };
});

import {
  buildOmpSettingsOverlay,
  renderOmpSettingsOverlay,
  writeOmpSettingsOverlay,
} from "./settings-overlay.js";
import { runAdapterExecutionTargetShellCommand } from "@tickernelz/paperclip-pro-adapter-utils/execution-target";

const runShellMock = vi.mocked(runAdapterExecutionTargetShellCommand);

function ompRegistersTaskTool(overlay: Record<string, unknown>, taskDepth = 0): boolean {
  const task = overlay.task as { maxRecursionDepth?: number } | undefined;
  const max = task?.maxRecursionDepth ?? 2;
  return max < 0 || taskDepth < max;
}

describe("OMP settings overlay", () => {
  afterEach(() => {
    runShellMock.mockReset();
  });

  it("zeroes task recursion so OMP never registers the task tool", () => {
    for (const config of [{}, { task: { maxRecursionDepth: 5 } }, { noTools: false }]) {
      const overlay = buildOmpSettingsOverlay(config);
      expect(overlay.task).toEqual({ maxRecursionDepth: 0 });
      for (const depth of [0, 1, 2, 7]) {
        expect(ompRegistersTaskTool(overlay, depth)).toBe(false);
      }
    }
  });

  it("leaves the task tool registered when the gate is absent, proving the control discriminates", () => {
    const withoutTask = { ...buildOmpSettingsOverlay({}) };
    delete withoutTask.task;
    expect(ompRegistersTaskTool(withoutTask, 0)).toBe(true);
  });

  it("renders task.maxRecursionDepth into the yaml OMP reads", () => {
    expect(parseYaml(renderOmpSettingsOverlay({}))).toEqual({
      advisor: { enabled: false },
      prewalk: { enabled: false },
      lsp: { enabled: true },
      skills: { enabled: true },
      task: { maxRecursionDepth: 0 },
    });
  });

  it("writes the same overlay content to the remote execution target", async () => {
    const config = { advisor: true, prewalk: true, noLsp: true };
    const overlay = await writeOmpSettingsOverlay({
      runId: "run-remote",
      target: null,
      remote: true,
      config,
      remoteRootDir: "/remote/root",
      cwd: "/remote/work",
      env: {},
      timeoutSec: 30,
      graceSec: 5,
    });

    expect(overlay.path).toBe("/remote/root/settings-overlay/config.yml");
    const heredoc = runShellMock.mock.calls[0]?.[2] ?? "";
    const written = heredoc.split("<<'PAPERCLIP_OMP_OVERLAY'\n")[1].split("\nPAPERCLIP_OMP_OVERLAY")[0];
    expect(parseYaml(written)).toEqual(parseYaml(renderOmpSettingsOverlay(config)));
    expect((parseYaml(written) as { task: { maxRecursionDepth: number } }).task.maxRecursionDepth).toBe(0);
  });

  it("writes the same overlay content to a per-run temp file locally", async () => {
    const config = { advisor: true, prewalk: true, noLsp: true };
    const overlay = await writeOmpSettingsOverlay({
      runId: "run-local",
      target: null,
      remote: false,
      config,
      remoteRootDir: null,
      cwd: os.tmpdir(),
      env: {},
      timeoutSec: 30,
      graceSec: 5,
    });

    expect(path.dirname(overlay.path)).toContain("paperclip-omp-overlay-");
    const written = parseYaml(await fs.readFile(overlay.path, "utf8"));
    expect(written).toEqual(parseYaml(renderOmpSettingsOverlay(config)));
    expect(runShellMock).not.toHaveBeenCalled();
  });
});
