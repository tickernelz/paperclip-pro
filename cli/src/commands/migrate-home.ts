import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pc from "picocolors";
import { LEGACY_HOME_DIRNAME, WARDMOTE_HOME_DIRNAME } from "@tickernelz/wardmote-shared/home-paths";

const execFileAsync = promisify(execFile);

type MigrateHomeOptions = { dryRun?: boolean };

export type MigrateHomeDependencies = {
  userHomeDir: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  serviceState: (platform: NodeJS.Platform, definitionPath: string) => Promise<ServiceState>;
  reloadUnits: () => Promise<void>;
  log: (message: string) => void;
};

export type ServiceState = "running" | "stopped" | "unknown";

const STOPPED_SYSTEMD_STATES = new Set(["inactive", "failed"]);
const RUNNING_SYSTEMD_STATES = new Set(["active", "activating", "reloading", "deactivating"]);

const SYSTEMD_UNIT_PATTERN = /^paperclip-pro(?:-.+)?\.service$/;
const LAUNCHD_PLIST_PATTERN = /^ing\.paperclip\.paperclip-pro(?:\..+)?\.plist$/;

async function systemctl(args: string[]): Promise<string> {
  return (await execFileAsync("systemctl", ["--user", ...args], { encoding: "utf8" })).stdout.trim();
}

async function commandOutput(file: string, args: string[]): Promise<{ code: number; stdout: string } | null> {
  try {
    return { code: 0, stdout: (await execFileAsync(file, args, { encoding: "utf8" })).stdout.trim() };
  } catch (error) {
    const failure = error as { code?: unknown; stdout?: unknown };
    if (typeof failure.code !== "number") return null;
    return { code: failure.code, stdout: typeof failure.stdout === "string" ? failure.stdout.trim() : "" };
  }
}

async function readServiceState(platform: NodeJS.Platform, definitionPath: string): Promise<ServiceState> {
  if (platform === "darwin") {
    const result = await commandOutput("launchctl", ["list", path.basename(definitionPath, ".plist")]);
    if (!result) return "unknown";
    if (result.code !== 0) return "stopped";
    return /"PID"\s*=\s*\d+/.test(result.stdout) ? "running" : "stopped";
  }
  const result = await commandOutput("systemctl", ["--user", "is-active", path.basename(definitionPath)]);
  if (!result) return "unknown";
  if (RUNNING_SYSTEMD_STATES.has(result.stdout)) return "running";
  return STOPPED_SYSTEMD_STATES.has(result.stdout) ? "stopped" : "unknown";
}

const defaultDependencies: MigrateHomeDependencies = {
  userHomeDir: os.homedir(),
  env: process.env,
  platform: process.platform,
  serviceState: readServiceState,
  reloadUnits: async () => {
    await systemctl(["daemon-reload"]).catch(() => undefined);
  },
  log: (message) => console.log(message),
};

function serviceDefinitions(platform: NodeJS.Platform, userHomeDir: string): string[] {
  const [directory, pattern] = platform === "darwin"
    ? [path.join(userHomeDir, "Library", "LaunchAgents"), LAUNCHD_PLIST_PATTERN]
    : [path.join(userHomeDir, ".config", "systemd", "user"), SYSTEMD_UNIT_PATTERN];
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter((name) => pattern.test(name)).map((name) => path.join(directory, name));
}

function liveEmbeddedPostgres(source: string): string[] {
  const instancesDir = path.join(source, "instances");
  if (!fs.existsSync(instancesDir)) return [];
  const live: string[] = [];
  for (const instanceId of fs.readdirSync(instancesDir)) {
    const pidFile = path.join(instancesDir, instanceId, "db", "postmaster.pid");
    if (!fs.existsSync(pidFile)) continue;
    const pid = Number.parseInt(fs.readFileSync(pidFile, "utf8").split("\n")[0] ?? "", 10);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    try {
      process.kill(pid, 0);
      live.push(`${instanceId} (postgres pid ${pid})`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") live.push(`${instanceId} (postgres pid ${pid})`);
    }
  }
  return live;
}

export async function migrateHomeCommand(
  options: MigrateHomeOptions = {},
  overrides: Partial<MigrateHomeDependencies> = {},
): Promise<void> {
  const deps = { ...defaultDependencies, ...overrides };
  const source = path.join(deps.userHomeDir, LEGACY_HOME_DIRNAME);
  const target = path.join(deps.userHomeDir, WARDMOTE_HOME_DIRNAME);
  const pinned = deps.env.PAPERCLIP_HOME?.trim();
  if (pinned) {
    throw new Error(`WARDMOTE_HOME/PAPERCLIP_HOME is set to ${pinned}. Unset it before migrating the default home.`);
  }
  const sourceStat = fs.lstatSync(source, { throwIfNoEntry: false });
  if (!sourceStat) throw new Error(`Nothing to migrate: ${source} does not exist.`);
  if (sourceStat.isSymbolicLink()) throw new Error(`${source} is already a link; the home was migrated before.`);
  if (!sourceStat.isDirectory()) throw new Error(`Refusing to migrate ${source}: it is not a directory.`);
  if (fs.lstatSync(target, { throwIfNoEntry: false })) throw new Error(`Refusing to migrate: ${target} already exists.`);

  const live = liveEmbeddedPostgres(source);
  const definitions = serviceDefinitions(deps.platform, deps.userHomeDir);
  for (const definition of definitions) {
    const unit = path.basename(definition);
    const state = await deps.serviceState(deps.platform, definition);
    if (state === "running") live.push(`service ${unit}`);
    if (state === "unknown") live.push(`service ${unit} (state could not be read)`);
  }
  if (live.length > 0) {
    throw new Error(`Stop Wardmote before migrating the home; still running: ${live.join(", ")}.`);
  }

  const pinnedDefinitions = definitions.filter((definition) => fs.readFileSync(definition, "utf8").includes(source));
  if (options.dryRun) {
    deps.log(`Would move ${source} to ${target}, link ${source} -> ${target}, and update ${pinnedDefinitions.length} service definition(s).`);
    return;
  }

  try {
    fs.renameSync(source, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EXDEV") {
      throw new Error(`${source} and ${target} are on different filesystems; move it yourself and rerun.`);
    }
    throw error;
  }
  fs.symlinkSync(target, source, "dir");
  for (const definition of pinnedDefinitions) {
    fs.writeFileSync(definition, fs.readFileSync(definition, "utf8").replaceAll(source, target));
  }
  if (pinnedDefinitions.length > 0 && deps.platform === "linux") await deps.reloadUnits();
  deps.log(pc.green(`Moved ${source} to ${target}.`));
  deps.log(`${source} now links to ${target}, so paths recorded in the database and scripts keep working.`);
}
