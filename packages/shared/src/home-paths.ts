import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrateRetiredEnvFile } from "./retired-env-file.js";

export const DEFAULT_WARDMOTE_INSTANCE_ID = "default";
export const WARDMOTE_CONFIG_BASENAME = "config.json";
export const WARDMOTE_ENV_FILENAME = ".env";

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
  if (fs.existsSync(legacy) && !isLinkTo(legacy, wardmote)) {
    throw new Error(`${legacy} has not been migrated. Stop the service and run \`wardmote migrate-home\`.`);
  }
  defaultHomeByUserHome.set(userHome, wardmote);
  return wardmote;
}

export function resolvePaperclipHomeDir(homeOverride?: string): string {
  const raw = homeOverride?.trim() || process.env.WARDMOTE_HOME?.trim();
  if (raw) return path.resolve(expandHomePrefix(raw));
  return resolveDefaultPaperclipHomeDir();
}

export function resolvePaperclipInstanceId(instanceIdOverride?: string): string {
  const raw = instanceIdOverride?.trim() || process.env.WARDMOTE_INSTANCE_ID?.trim() || DEFAULT_WARDMOTE_INSTANCE_ID;
  if (!PATH_SEGMENT_RE.test(raw)) {
    throw new Error(`Invalid WARDMOTE_INSTANCE_ID '${raw}'.`);
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
  return path.resolve(resolvePaperclipInstanceRoot(input), WARDMOTE_CONFIG_BASENAME);
}

export function resolvePaperclipConfigPathForInstance(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return resolvePaperclipInstanceConfigPath(input);
}

export function resolvePaperclipEnvPathForConfig(configPath: string): string {
  const envPath = path.resolve(path.dirname(configPath), WARDMOTE_ENV_FILENAME);
  migrateRetiredEnvFile(envPath);
  return envPath;
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
  return path.resolve(expandHomePrefix(value));
}
