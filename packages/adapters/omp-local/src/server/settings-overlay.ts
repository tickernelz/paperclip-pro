import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type AdapterExecutionTarget,
  runAdapterExecutionTargetShellCommand,
} from "@tickernelz/wardmote-adapter-utils/execution-target";
import { asBoolean } from "@tickernelz/wardmote-adapter-utils/server-utils";
import { stringify as stringifyYaml } from "yaml";
import { isWellFormedOmpSettingKey } from "@tickernelz/wardmote-shared";
import { ompFallbackChain } from "./model-fallback.js";

export interface OmpSettingsOverlay {
  path: string;
  cleanup: () => Promise<void>;
}

export const OMP_CONTEXT_MANAGEMENT_MIN_VERSION = "18.1.16";

const ADAPTER_OWNED_OMP_SETTINGS = new Set([
  "advisor.enabled",
  "prewalk.enabled",
  "lsp.enabled",
  "skills.enabled",
  "omitThinking",
  "compaction.experimentalContextManagement",
  "tools.approvalMode",
  "task.maxRecursionDepth",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function agentOmpSettings(config: Record<string, unknown>): Array<[string, unknown]> {
  if (!isRecord(config.ompSettings)) return [];
  return Object.entries(config.ompSettings).filter(([key, value]) =>
    value !== undefined &&
    isWellFormedOmpSettingKey(key) &&
    !ADAPTER_OWNED_OMP_SETTINGS.has(key) &&
    !/^(auth|secrets)\./.test(key) &&
    !/(^|\.)(token|apiKey|api_key|secret|password|credentials?)$/i.test(key));
}

function setDotted(target: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split(".");
  let node = target;
  for (const part of parts.slice(0, -1)) {
    const child = Object.hasOwn(node, part) ? node[part] : undefined;
    if (isRecord(child)) {
      node = child;
      continue;
    }
    const created: Record<string, unknown> = {};
    Object.defineProperty(node, part, { value: created, enumerable: true, writable: true, configurable: true });
    node = created;
  }
  Object.defineProperty(node, parts[parts.length - 1]!, { value, enumerable: true, writable: true, configurable: true });
}

export function buildOmpSettingsOverlay(config: Record<string, unknown>): Record<string, unknown> {
  const overlay = buildAdapterSettingsOverlay(config);
  for (const [key, value] of agentOmpSettings(config)) setDotted(overlay, key, value);
  return overlay;
}

function buildAdapterSettingsOverlay(config: Record<string, unknown>): Record<string, unknown> {
  const noPrewalk = asBoolean(config.noPrewalk, false);
  const fallback = ompFallbackChain(config);
  return {
    advisor: { enabled: asBoolean(config.advisor, false) },
    prewalk: { enabled: noPrewalk ? false : asBoolean(config.prewalk, false) },
    lsp: { enabled: !asBoolean(config.noLsp, false) },
    skills: { enabled: !asBoolean(config.noSkills, false) },
    task: { maxRecursionDepth: 0 },
    compaction: { experimentalContextManagement: asBoolean(config.experimentalContextManagement, true) },
    omitThinking: !asBoolean(config.printThoughts, true),
    ...(fallback
      ? {
          retry: {
            modelFallback: true,
            fallbackRevertPolicy: "cooldown-expiry",
            fallbackChains: { [fallback.key]: fallback.chain },
          },
        }
      : {}),
  };
}

export function ompVersionAtLeast(versionOutput: string, minimum: string): boolean | null {
  const found = /(\d+)\.(\d+)\.(\d+)/.exec(versionOutput);
  if (!found) return null;
  const actual = found.slice(1, 4).map(Number);
  const wanted = minimum.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (actual[index]! !== wanted[index]!) return actual[index]! > wanted[index]!;
  }
  return true;
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
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wardmote-omp-overlay-"));
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

  const rootDir = input.remoteRootDir ?? path.posix.join(input.cwd, ".wardmote-runtime", "omp");
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
    `cat > ${posixQuote(file)} <<'WARDMOTE_OMP_OVERLAY'`,
    content.replace(/\n$/, ""),
    "WARDMOTE_OMP_OVERLAY",
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
