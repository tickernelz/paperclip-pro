import fs from "node:fs";
import path from "node:path";
import { isNewerVersion } from "@tickernelz/wardmote-shared";
import { resolveLatestWardmoteVersion } from "@tickernelz/wardmote-shared/wardmote-update-check";
import { packageVersion } from "./version.js";
import { readInstallManifest, resolveInstallStorePaths } from "./install-store.js";
import { resolveConfigPath } from "./config/store.js";
export function isUpdateNoticeEnabled(configPath?: string): boolean {
  if (process.env.WARDMOTE_UPDATE_CHECK === "0") return false;
  try { const raw = JSON.parse(fs.readFileSync(resolveConfigPath(configPath), "utf8")) as { updates?: { checkEnabled?: boolean } }; return raw.updates?.checkEnabled !== false; } catch { return true; }
}
export async function checkForUpdateNotice(options: { configPath?: string; now?: number; fetchImpl?: typeof fetch; cachePath?: string } = {}): Promise<string | null> {
  if (!isUpdateNoticeEnabled(options.configPath)) return null;
  const paths = resolveInstallStorePaths();
  const channel = readInstallManifest(paths)?.channel === "canary" ? "canary" : "latest";
  const result = await resolveLatestWardmoteVersion({ cachePath: options.cachePath ?? path.join(paths.cliRoot, "update-check.json"), channel, now: options.now, fetchImpl: options.fetchImpl });
  return isNewerVersion(result?.latest, packageVersion) ? result.latest : null;
}
export async function printUpdateNotice(configPath?: string): Promise<void> { const latest = await checkForUpdateNotice({ configPath }); if (latest) console.log(`Update available: ${latest} — run \`wardmote update\``); }
