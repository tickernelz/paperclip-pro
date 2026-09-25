import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type AdapterExecutionTarget,
  runAdapterExecutionTargetShellCommand,
} from "@tickernelz/paperclip-pro-adapter-utils/execution-target";
import { asBoolean } from "@tickernelz/paperclip-pro-adapter-utils/server-utils";
import { stringify as stringifyYaml } from "yaml";

export interface OmpSettingsOverlay {
  path: string;
  cleanup: () => Promise<void>;
}

export function buildOmpSettingsOverlay(config: Record<string, unknown>): Record<string, unknown> {
  const noPrewalk = asBoolean(config.noPrewalk, false);
  return {
    advisor: { enabled: asBoolean(config.advisor, false) },
    prewalk: { enabled: noPrewalk ? false : asBoolean(config.prewalk, false) },
    lsp: { enabled: !asBoolean(config.noLsp, false) },
    skills: { enabled: !asBoolean(config.noSkills, false) },
  };
}

export function renderOmpSettingsOverlay(config: Record<string, unknown>): string {
  return stringifyYaml(buildOmpSettingsOverlay(config), { lineWidth: 0 });
}

function posixQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export async function writeOmpSettingsOverlay(input: {
  runId: string;
  target: AdapterExecutionTarget | null | undefined;
  remote: boolean;
  config: Record<string, unknown>;
  remoteRootDir: string | null;
  cwd: string;
  env: Record<string, string>;
  timeoutSec: number;
  graceSec: number;
}): Promise<OmpSettingsOverlay> {
  const content = renderOmpSettingsOverlay(input.config);
  if (!input.remote) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-omp-overlay-"));
    await fs.chmod(dir, 0o700);
    const file = path.join(dir, "config.yml");
    await fs.writeFile(file, content, { encoding: "utf8", mode: 0o600 });
    return {
      path: file,
      cleanup: async () => {
        await fs.rm(dir, { recursive: true, force: true });
      },
    };
  }

  const rootDir = input.remoteRootDir ?? path.posix.join(input.cwd, ".paperclip-runtime", "omp");
  const dir = path.posix.join(rootDir, "settings-overlay");
  const file = path.posix.join(dir, "config.yml");
  const shellOptions = {
    cwd: input.cwd,
    env: input.env,
    timeoutSec: Math.min(input.timeoutSec || 15, 15),
    graceSec: Math.min(input.graceSec, 5),
  };
  const heredoc = [
    `mkdir -p ${posixQuote(dir)}`,
    `cat > ${posixQuote(file)} <<'PAPERCLIP_OMP_OVERLAY'`,
    content.replace(/\n$/, ""),
    "PAPERCLIP_OMP_OVERLAY",
    `chmod 600 ${posixQuote(file)}`,
  ].join("\n");
  await runAdapterExecutionTargetShellCommand(input.runId, input.target, heredoc, shellOptions);
  return {
    path: file,
    cleanup: async () => {
      await runAdapterExecutionTargetShellCommand(
        input.runId,
        input.target,
        `rm -rf ${posixQuote(dir)}`,
        shellOptions,
      ).catch(() => {});
    },
  };
}
