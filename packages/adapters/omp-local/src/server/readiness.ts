import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensurePathInEnv } from "@tickernelz/paperclip-pro-adapter-utils/server-utils";
import { parse as parseYaml } from "yaml";
import { OMP_CONTEXT_MANAGEMENT_MIN_VERSION, ompVersionAtLeast } from "./settings-overlay.js";

export const OMP_MIN_VERSION = OMP_CONTEXT_MANAGEMENT_MIN_VERSION;
export const OMP_UPDATE_COMMAND = "omp update";
export const OMP_BUNDLED_VERSION_ENV = "PAPERCLIP_OMP_BUNDLED_VERSION";

export type OmpInstallState = "missing" | "too_old" | "unknown_version" | "ready";

export interface OmpCopy {
  path: string;
  version: string | null;
}

export interface OmpInstallProbe {
  state: OmpInstallState;
  minVersion: string;
  path: string | null;
  version: string | null;
  copies: OmpCopy[];
}

export function ompInstallCommand(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "irm https://omp.sh/install.ps1 | iex" : "curl -fsSL https://omp.sh/install | sh";
}

export function bundledOmpVersion(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env[OMP_BUNDLED_VERSION_ENV]?.trim();
  return value ? value : null;
}

export function parseOmpVersion(output: string): string | null {
  return /(\d+\.\d+\.\d+)/.exec(output)?.[1] ?? null;
}

export function classifyOmpVersion(version: string | null): Exclude<OmpInstallState, "missing"> {
  if (!version) return "unknown_version";
  return ompVersionAtLeast(version, OMP_MIN_VERSION) ? "ready" : "too_old";
}

function executableNames(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform !== "win32") return ["omp"];
  const extensions = (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean);
  return extensions.map((extension) => `omp${extension.toLowerCase()}`);
}

async function isExecutableFile(candidate: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    const stats = await fs.stat(candidate);
    if (!stats.isFile()) return false;
    if (platform !== "win32") await fs.access(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findOmpExecutables(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string[]> {
  const resolvedEnv = ensurePathInEnv({ ...env });
  const searchPath = resolvedEnv.PATH ?? resolvedEnv.Path ?? "";
  const delimiter = platform === "win32" ? ";" : ":";
  const found: string[] = [];
  const seen = new Set<string>();
  for (const directory of searchPath.split(delimiter)) {
    if (!directory) continue;
    for (const name of executableNames(platform, resolvedEnv)) {
      const candidate = path.join(directory, name);
      if (!(await isExecutableFile(candidate, platform))) continue;
      const real = await fs.realpath(candidate).catch(() => candidate);
      if (seen.has(real)) continue;
      seen.add(real);
      found.push(candidate);
    }
  }
  return found;
}

export function readOmpVersion(command: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(command, ["--version"], { env, timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        resolve(null);
        return;
      }
      resolve(parseOmpVersion(`${stdout}\n${stderr}`));
    });
  });
}

export async function probeOmpInstall(options: {
  command?: string | null;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
} = {}): Promise<OmpInstallProbe> {
  const env = ensurePathInEnv({ ...(options.env ?? process.env) });
  const platform = options.platform ?? process.platform;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const command = options.command?.trim() || env.PAPERCLIP_OMP_COMMAND?.trim() || null;
  const isPath = command !== null && (path.isAbsolute(command) || command.includes("/") || command.includes("\\"));
  const candidates = isPath
    ? ((await isExecutableFile(command, platform)) ? [command] : [])
    : command && command !== "omp"
      ? []
      : await findOmpExecutables(env, platform);
  if (candidates.length === 0) {
    return { state: "missing", minVersion: OMP_MIN_VERSION, path: null, version: null, copies: [] };
  }
  const copies = await Promise.all(
    candidates.map(async (candidate) => ({ path: candidate, version: await readOmpVersion(candidate, env, timeoutMs) })),
  );
  const first = copies[0]!;
  return {
    state: classifyOmpVersion(first.version),
    minVersion: OMP_MIN_VERSION,
    path: first.path,
    version: first.version,
    copies,
  };
}

export function ompGateFailure(probe: OmpInstallProbe, platform: NodeJS.Platform = process.platform): string | null {
  switch (probe.state) {
    case "ready":
      return null;
    case "missing":
      return `OMP was not found. Install it with: ${ompInstallCommand(platform)}`;
    case "too_old":
      return `OMP ${probe.version} is older than ${OMP_MIN_VERSION}. Update it with: ${OMP_UPDATE_COMMAND}`;
    case "unknown_version":
      return `Could not read the version of ${probe.path}. OMP ${OMP_MIN_VERSION} or newer is required. Update it with: ${OMP_UPDATE_COMMAND}`;
  }
}

export function ompAgentDir(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  return env.PI_CODING_AGENT_DIR?.trim() || env.PAPERCLIP_OMP_AGENT_DIR?.trim() || path.join(home, ".omp", "agent");
}

async function sessionCwd(file: string): Promise<string | null> {
  const handle = await fs.open(file, "r").catch(() => null);
  if (!handle) return null;
  try {
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    for (const line of buffer.subarray(0, bytesRead).toString("utf8").split("\n")) {
      try {
        const entry = JSON.parse(line) as { type?: unknown; cwd?: unknown };
        if (entry.type === "session" && typeof entry.cwd === "string") return entry.cwd;
      } catch {
        continue;
      }
    }
    return null;
  } finally {
    await handle.close();
  }
}

async function newestEntries(directory: string, filter: (name: string) => boolean): Promise<string[]> {
  const names = await fs.readdir(directory).catch(() => [] as string[]);
  const stamped = await Promise.all(
    names.filter(filter).map(async (name) => {
      const full = path.join(directory, name);
      const stats = await fs.stat(full).catch(() => null);
      return stats ? { full, mtime: stats.mtimeMs } : null;
    }),
  );
  return stamped
    .filter((entry): entry is { full: string; mtime: number } => entry !== null)
    .sort((a, b) => b.mtime - a.mtime)
    .map((entry) => entry.full);
}

export async function detectRecentProjectFolder(
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
  limit = 20,
): Promise<string | null> {
  const temp = path.resolve(os.tmpdir());
  const homeRoot = path.resolve(home);
  const sessionDirs = (await newestEntries(path.join(ompAgentDir(env, home), "sessions"), () => true)).slice(0, limit);
  for (const directory of sessionDirs) {
    const [newest] = await newestEntries(directory, (name) => name.endsWith(".jsonl"));
    if (!newest) continue;
    const cwd = await sessionCwd(newest);
    if (!cwd || !path.isAbsolute(cwd)) continue;
    const resolved = path.resolve(cwd);
    const inTemp = resolved === temp || (resolved.startsWith(temp + path.sep) && !resolved.startsWith(homeRoot + path.sep));
    if (resolved === homeRoot || inTemp) continue;
    const stats = await fs.stat(resolved).catch(() => null);
    if (stats?.isDirectory()) return resolved;
  }
  return null;
}

export async function readOmpDefaultModel(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): Promise<string | null> {
  const text = await fs.readFile(path.join(ompAgentDir(env, home), "config.yml"), "utf8").catch(() => null);
  if (!text) return null;
  try {
    const config = parseYaml(text) as { modelRoles?: { default?: unknown } } | null;
    const value = config?.modelRoles?.default;
    if (typeof value !== "string" || !value.trim()) return null;
    return value.trim().replace(/:(off|minimal|low|medium|high|xhigh|max)$/, "");
  } catch {
    return null;
  }
}

export function recommendOmpModel(models: Array<{ id: string }>, defaultModel: string | null): string | null {
  if (models.length === 0) return null;
  if (defaultModel && models.some((model) => model.id === defaultModel)) return defaultModel;
  return models[0]!.id;
}
