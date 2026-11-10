import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pc from "picocolors";
import { LEGACY_HOME_DIRNAME, WARDMOTE_HOME_DIRNAME } from "@tickernelz/wardmote-shared/home-paths";
import {
  MANAGED_STORE_MARKER,
  PATH_BLOCK_END,
  PATH_BLOCK_START,
  removeShimFile,
  resolveInstallStorePaths,
  writeFileAtomic,
  writeManagedShim,
} from "../install-store.js";
import { launchdServiceName, systemdServiceName } from "../services/service-manager.js";

const execFileAsync = promisify(execFile);

type MigrateHomeOptions = { dryRun?: boolean };

export type MigrateHomeDependencies = {
  userHomeDir: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  serviceState: (platform: NodeJS.Platform, definitionPath: string) => Promise<ServiceState>;
  reloadUnits: () => Promise<void>;
  unitEnabled: (unit: string) => Promise<boolean>;
  setUnitEnabled: (unit: string, enabled: boolean) => Promise<void>;
  log: (message: string) => void;
};

export type ServiceState = "running" | "stopped" | "unknown";

const STOPPED_SYSTEMD_STATES = new Set(["inactive", "failed"]);
const RUNNING_SYSTEMD_STATES = new Set(["active", "activating", "reloading", "deactivating"]);

const LEGACY_PRODUCT = "paperclip-pro";
const LEGACY_SYSTEMD_UNIT_PATTERN = new RegExp(`^${LEGACY_PRODUCT}(?:-(.+))?\\.service$`);
const LEGACY_LAUNCHD_LABEL = `ing.paperclip.${LEGACY_PRODUCT}`;
const LEGACY_LAUNCHD_PLIST_PATTERN = new RegExp(`^${LEGACY_LAUNCHD_LABEL.replaceAll(".", "\\.")}(?:\\.(.+))?\\.plist$`);
const LEGACY_SHIM_MARKER = `${LEGACY_PRODUCT} managed install shim v1`;
const LEGACY_STORE_MARKER = `${LEGACY_PRODUCT} managed install store v1\n`;
const LEGACY_PATH_BLOCK_START = `# >>> ${LEGACY_PRODUCT} managed PATH >>>`;
const LEGACY_PATH_BLOCK_END = `# <<< ${LEGACY_PRODUCT} managed PATH <<<`;

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
  unitEnabled: async (unit) => (await commandOutput("systemctl", ["--user", "is-enabled", unit]))?.stdout === "enabled",
  setUnitEnabled: async (unit, enabled) => {
    await systemctl([enabled ? "enable" : "disable", unit]);
  },
  log: (message) => console.log(message),
};

type LegacyDefinition = { from: string; to: string; instanceId: string };

function legacyDefinitions(platform: NodeJS.Platform, userHomeDir: string): LegacyDefinition[] {
  const darwin = platform === "darwin";
  const directory = darwin ? path.join(userHomeDir, "Library", "LaunchAgents") : path.join(userHomeDir, ".config", "systemd", "user");
  if (!fs.existsSync(directory)) return [];
  const pattern = darwin ? LEGACY_LAUNCHD_PLIST_PATTERN : LEGACY_SYSTEMD_UNIT_PATTERN;
  return fs.readdirSync(directory).flatMap((name) => {
    const match = pattern.exec(name);
    if (!match) return [];
    const instanceId = match[1] ?? "default";
    const next = darwin ? `${launchdServiceName(instanceId)}.plist` : systemdServiceName(instanceId);
    return [{ from: path.join(directory, name), to: path.join(directory, next), instanceId }];
  });
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

function homeState(source: string, target: string): "move" | "done" | "absent" {
  const sourceStat = fs.lstatSync(source, { throwIfNoEntry: false });
  if (!sourceStat) return "absent";
  if (sourceStat.isSymbolicLink()) {
    if (fs.existsSync(target) && fs.realpathSync(source) === fs.realpathSync(target)) return "done";
    throw new Error(`Refusing to migrate: ${source} is a link that does not point to ${target}.`);
  }
  if (!sourceStat.isDirectory()) throw new Error(`Refusing to migrate ${source}: it is not a directory.`);
  if (fs.lstatSync(target, { throwIfNoEntry: false })) throw new Error(`Refusing to migrate: ${target} already exists.`);
  return "move";
}

function readIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** True when the default home or managed install still uses the retired layout. */
export function hasLegacyInstall(userHomeDir = os.homedir(), platform: NodeJS.Platform = process.platform): boolean {
  const source = path.join(userHomeDir, LEGACY_HOME_DIRNAME);
  const stat = fs.lstatSync(source, { throwIfNoEntry: false });
  return Boolean(stat && !stat.isSymbolicLink())
    || legacyDefinitions(platform, userHomeDir).length > 0
    || Boolean(readIfExists(path.join(userHomeDir, ".local", "bin", LEGACY_PRODUCT))?.includes(`# ${LEGACY_SHIM_MARKER}\n`));
}

/** Moves the retired home, service definitions, shims and markers to the Wardmote names; idempotent. */
export async function migrateHomeCommand(
  options: MigrateHomeOptions = {},
  overrides: Partial<MigrateHomeDependencies> = {},
): Promise<void> {
  const deps = { ...defaultDependencies, ...overrides };
  const source = path.join(deps.userHomeDir, LEGACY_HOME_DIRNAME);
  const target = path.join(deps.userHomeDir, WARDMOTE_HOME_DIRNAME);
  const pinned = deps.env.WARDMOTE_HOME?.trim();
  if (pinned) {
    throw new Error(`WARDMOTE_HOME is set to ${pinned}. Unset it before migrating the default home.`);
  }
  const home = homeState(source, target);
  const definitions = legacyDefinitions(deps.platform, deps.userHomeDir);
  const live = home === "move" ? liveEmbeddedPostgres(source) : [];
  for (const definition of definitions) {
    const unit = path.basename(definition.from);
    const state = await deps.serviceState(deps.platform, definition.from);
    if (state === "running") live.push(`service ${unit}`);
    if (state === "unknown") live.push(`service ${unit} (state could not be read)`);
    if (fs.existsSync(definition.to)) throw new Error(`Refusing to migrate ${unit}: ${definition.to} already exists.`);
  }
  if (live.length > 0) {
    throw new Error(`Stop Wardmote before migrating the home; still running: ${live.join(", ")}.`);
  }

  const binDir = path.join(deps.userHomeDir, ".local", "bin");
  const legacyShim = path.join(binDir, LEGACY_PRODUCT);
  const shim = path.join(binDir, "wardmote");
  const legacyShims = [legacyShim, shim].filter((file) => readIfExists(file)?.includes(`# ${LEGACY_SHIM_MARKER}\n`));
  const rcFiles = [".bashrc", ".zshrc"].map((name) => path.join(deps.userHomeDir, name))
    .filter((file) => readIfExists(file)?.includes(LEGACY_PATH_BLOCK_START));
  const storeHome = home === "absent" ? source : target;
  const markerPath = path.join(home === "move" ? source : storeHome, "cli", ".managed-install");
  const legacyStore = readIfExists(markerPath) === LEGACY_STORE_MARKER;

  const steps = [
    home === "move" ? `move ${source} to ${target} and link ${source} -> ${target}` : null,
    ...definitions.map((definition) => `replace ${path.basename(definition.from)} with ${path.basename(definition.to)}`),
    legacyStore ? "rewrite the managed install store marker" : null,
    ...legacyShims.map((file) => `replace the ${path.basename(file)} shim with ${shim}`),
    ...rcFiles.map((file) => `rename the managed PATH block in ${file}`),
  ].filter((step): step is string => step !== null);
  if (steps.length === 0) {
    deps.log("Nothing to migrate: this install already uses the Wardmote names.");
    return;
  }
  if (options.dryRun) {
    deps.log(`Would ${steps.join("; ")}.`);
    return;
  }

  if (home === "move") {
    try {
      fs.renameSync(source, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EXDEV") {
        throw new Error(`${source} and ${target} are on different filesystems; move it yourself and rerun.`);
      }
      throw error;
    }
    fs.symlinkSync(target, source, "dir");
  }

  for (const definition of definitions) {
    const content = fs.readFileSync(definition.from, "utf8")
      .replaceAll(source, target)
      .replaceAll(legacyShim, shim)
      .replaceAll(LEGACY_LAUNCHD_LABEL, launchdServiceName("default"));
    const enabled = deps.platform === "linux" && await deps.unitEnabled(path.basename(definition.from));
    if (enabled) await deps.setUnitEnabled(path.basename(definition.from), false);
    writeFileAtomic(definition.to, content, fs.statSync(definition.from).mode & 0o777);
    fs.rmSync(definition.from);
    if (enabled) {
      await deps.reloadUnits();
      await deps.setUnitEnabled(path.basename(definition.to), true);
    }
  }
  if (definitions.length > 0 && deps.platform === "linux") await deps.reloadUnits();

  if (legacyStore) writeFileAtomic(path.join(storeHome, "cli", ".managed-install"), MANAGED_STORE_MARKER, 0o600);
  if (legacyShims.length > 0) {
    for (const file of legacyShims) removeShimFile(file, LEGACY_SHIM_MARKER);
    if (legacyStore || readIfExists(path.join(storeHome, "cli", ".managed-install")) === MANAGED_STORE_MARKER) {
      writeManagedShim(resolveInstallStorePaths({ paperclipHome: storeHome, homeDir: deps.userHomeDir }));
    }
  }
  for (const file of rcFiles) {
    const content = fs.readFileSync(file, "utf8");
    writeFileAtomic(file, content.replace(LEGACY_PATH_BLOCK_START, PATH_BLOCK_START).replace(LEGACY_PATH_BLOCK_END, PATH_BLOCK_END),
      fs.statSync(file).mode & 0o777);
  }

  for (const step of steps) deps.log(pc.green(`Done: ${step}.`));
  if (home === "move") deps.log(`${source} now links to ${target}, so paths recorded in the database and scripts keep working.`);
  if (definitions.length > 0) deps.log("Start the service with `wardmote service start`.");
}

