import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_PAPERCLIP_INSTANCE_ID = "default";
export const PAPERCLIP_CONFIG_BASENAME = "config.json";
export const PAPERCLIP_ENV_FILENAME = ".env";

const PATH_SEGMENT_RE = /^[a-zA-Z0-9_-]+$/;

export function expandHomePrefix(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.resolve(os.homedir(), value.slice(2));
  return value;
}

export const WARDMOTE_HOME_DIRNAME = ".wardmote";
export const LEGACY_HOME_DIRNAME = ".paperclip-pro";

const defaultHomeByUserHome = new Map<string, string>();

function isLinkTo(link: string, target: string): boolean {
  return fs.lstatSync(link).isSymbolicLink() && fs.existsSync(target) && fs.realpathSync(link) === fs.realpathSync(target);
}

export function resolveDefaultPaperclipHomeDir(userHome: string = os.homedir()): string {
  const cached = defaultHomeByUserHome.get(userHome);
  if (cached) return cached;
  const legacy = path.resolve(userHome, LEGACY_HOME_DIRNAME);
  const wardmote = path.resolve(userHome, WARDMOTE_HOME_DIRNAME);
  const resolved = fs.existsSync(legacy) && !isLinkTo(legacy, wardmote) ? legacy : wardmote;
  defaultHomeByUserHome.set(userHome, resolved);
  return resolved;
}

export function resolvePaperclipHomeDir(homeOverride?: string): string {
  const raw = homeOverride?.trim() || process.env.PAPERCLIP_HOME?.trim();
  if (raw) return path.resolve(expandHomePrefix(raw));
  return resolveDefaultPaperclipHomeDir();
}

export function resolvePaperclipInstanceId(instanceIdOverride?: string): string {
  const raw = instanceIdOverride?.trim() || process.env.PAPERCLIP_INSTANCE_ID?.trim() || DEFAULT_PAPERCLIP_INSTANCE_ID;
  if (!PATH_SEGMENT_RE.test(raw)) {
    throw new Error(`Invalid PAPERCLIP_INSTANCE_ID '${raw}'.`);
  }
  return raw;
}

export function resolvePaperclipInstanceRoot(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolvePaperclipHomeDir(input.homeDir), "instances", resolvePaperclipInstanceId(input.instanceId));
}

export function resolvePaperclipInstanceConfigPath(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolvePaperclipInstanceRoot(input), PAPERCLIP_CONFIG_BASENAME);
}

export function resolvePaperclipConfigPathForInstance(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return resolvePaperclipInstanceConfigPath(input);
}

export function resolvePaperclipEnvPathForConfig(configPath: string): string {
  return path.resolve(path.dirname(configPath), PAPERCLIP_ENV_FILENAME);
}

export function resolveDefaultEmbeddedPostgresDir(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolvePaperclipInstanceRoot(input), "db");
}

export function resolveDefaultLogsDir(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolvePaperclipInstanceRoot(input), "logs");
}

export function resolveDefaultSecretsKeyFilePath(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolvePaperclipInstanceRoot(input), "secrets", "master.key");
}

export function resolveDefaultStorageDir(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolvePaperclipInstanceRoot(input), "data", "storage");
}

export function resolveDefaultBackupDir(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolvePaperclipInstanceRoot(input), "data", "backups");
}

export function resolveHomeAwarePath(value: string): string {
  const resolved = path.resolve(expandHomePrefix(value));
  const userHome = os.homedir();
  const homes = [LEGACY_HOME_DIRNAME, WARDMOTE_HOME_DIRNAME].map((name) => path.resolve(userHome, name));
  const owner = homes.find((home) => resolved === home || resolved.startsWith(home + path.sep));
  if (!owner || fs.existsSync(owner)) return resolved;
  const other = homes.find((home) => home !== owner)!;
  return fs.existsSync(other) ? other + resolved.slice(owner.length) : resolved;
}
