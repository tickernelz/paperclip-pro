import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isNewerVersion,
  wardmoteReleaseNotesUrl,
  type InstanceUpdateStatus,
  type WardmoteInstallKind,
  type WardmoteUpdateChannel,
} from "@tickernelz/wardmote-shared";
import {
  readCachedLatestWardmoteVersion,
  resolveLatestWardmoteVersion,
  type UpdateCheckResult,
} from "@tickernelz/wardmote-shared/wardmote-update-check";
import { readConfigFile } from "../config-file.js";
import { resolveWardmoteHomeDir } from "../home-paths.js";
import { serverVersion } from "../version.js";

const FIRST_CHECK_DELAY_MS = 60 * 1000;
const CHECK_TICK_MS = 60 * 60 * 1000;

type InstallManifestSnapshot = { source?: unknown; channel?: unknown };

export interface WardmoteUpdateServiceOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  currentVersion?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  configCheckEnabled?: () => boolean;
  inContainer?: () => boolean;
  serverModulePath?: string;
  platform?: NodeJS.Platform;
}

export interface WardmoteUpdateService {
  status(): InstanceUpdateStatus;
  refresh(): Promise<void>;
  startPeriodicChecks(): () => void;
}

function readInstallManifest(homeDir: string): InstallManifestSnapshot | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(homeDir, "cli", "install.json"), "utf8")) as InstallManifestSnapshot;
  } catch {
    return null;
  }
}

function defaultInContainer(): boolean {
  return fs.existsSync("/.dockerenv") || fs.existsSync("/run/.containerenv");
}

export function resolveWardmoteInstallKind(input: {
  env: NodeJS.ProcessEnv;
  manifest: InstallManifestSnapshot | null;
  inContainer: boolean;
  serverModulePath: string;
}): WardmoteInstallKind {
  if (input.inContainer) return "docker";
  if (input.manifest?.source === "npm") {
    return input.env.WARDMOTE_SERVICE_MANAGED === "1" ? "managed" : "managed_foreground";
  }
  if (input.manifest?.source === "git") return "source";
  return input.serverModulePath.split(path.sep).join("/").includes("/node_modules/@tickernelz/wardmote-server/") ? "npm" : "source";
}

export function manualUpdateCommand(kind: WardmoteInstallKind, latestVersion: string | null): string {
  const version = latestVersion ?? "latest";
  switch (kind) {
    case "managed":
    case "managed_foreground":
      return latestVersion ? `wardmote update --version ${latestVersion}` : "wardmote update";
    case "docker":
      return `Pull the wardmote image for ${version} and recreate the container`;
    case "npm":
      return `npm install -g @tickernelz/wardmote@${version}`;
    case "source":
      return "git pull && pnpm install && pnpm build";
  }
}

export function createWardmoteUpdateService(options: WardmoteUpdateServiceOptions = {}): WardmoteUpdateService {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? resolveWardmoteHomeDir();
  const currentVersion = options.currentVersion ?? serverVersion;
  const now = options.now ?? Date.now;
  const configCheckEnabled = options.configCheckEnabled ?? (() => readConfigFile()?.updates?.checkEnabled !== false);
  const serverModulePath = options.serverModulePath ?? fileURLToPath(import.meta.url);
  const inContainer = (options.inContainer ?? defaultInContainer)();
  const platform = options.platform ?? process.platform;
  const cachePath = path.join(homeDir, "cli", "update-check.json");
  const checkEnabled = () => env.WARDMOTE_UPDATE_CHECK !== "0" && configCheckEnabled();
  const manifest = () => readInstallManifest(homeDir);
  const channel = (): WardmoteUpdateChannel =>
    manifest()?.channel === "canary" || /-canary\b/.test(currentVersion) ? "canary" : "latest";
  let result: UpdateCheckResult | null = checkEnabled() ? readCachedLatestWardmoteVersion(cachePath, channel()) : null;
  let inFlight: Promise<void> | null = null;

  async function refresh(): Promise<void> {
    if (!checkEnabled()) return;
    if (inFlight) return inFlight;
    inFlight = resolveLatestWardmoteVersion({
      cachePath,
      channel: channel(),
      now: now(),
      fetchImpl: options.fetchImpl,
    })
      .then((next) => { if (next) result = next; })
      .catch(() => undefined)
      .finally(() => { inFlight = null; });
    return inFlight;
  }

  function status(): InstanceUpdateStatus {
    const enabled = checkEnabled();
    const latest = enabled ? result?.latest ?? null : null;
    const kind = resolveWardmoteInstallKind({ env, manifest: manifest(), inContainer, serverModulePath });
    return {
      currentVersion,
      latestVersion: latest,
      updateAvailable: isNewerVersion(latest, currentVersion),
      channel: channel(),
      checkEnabled: enabled,
      checkedAt: enabled && result ? new Date(result.checkedAt).toISOString() : null,
      releaseNotesUrl: latest ? wardmoteReleaseNotesUrl(latest) : null,
      install: { kind, command: manualUpdateCommand(kind, latest), canInstall: kind === "managed" && platform === "linux" },
    };
  }

  function startPeriodicChecks(): () => void {
    if (!checkEnabled()) return () => undefined;
    const first = setTimeout(() => void refresh(), FIRST_CHECK_DELAY_MS);
    const tick = setInterval(() => void refresh(), CHECK_TICK_MS);
    first.unref?.();
    tick.unref?.();
    return () => {
      clearTimeout(first);
      clearInterval(tick);
    };
  }

  return { status, refresh, startPeriodicChecks };
}
