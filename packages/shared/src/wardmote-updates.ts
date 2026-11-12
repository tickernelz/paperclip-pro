export const WARDMOTE_DIST_TAGS_URL = "https://registry.npmjs.org/-/package/@tickernelz%2Fwardmote/dist-tags";
export const WARDMOTE_RELEASES_URL = "https://github.com/tickernelz/wardmote/releases";
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_NOTICE_HIDE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export type WardmoteUpdateChannel = "latest" | "canary";
export type WardmoteInstallKind = "managed" | "managed_foreground" | "docker" | "npm" | "source";

export interface InstanceUpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  channel: WardmoteUpdateChannel;
  checkEnabled: boolean;
  checkedAt: string | null;
  releaseNotesUrl: string | null;
  install: { kind: WardmoteInstallKind; command: string };
}

export function compareVersions(left: string, right: string): number {
  const parse = (value: string) => { const [core, prerelease = ""] = value.replace(/^v/, "").split("-", 2); return { numbers: core.split(".").map((part) => Number(part) || 0), prerelease }; };
  const a = parse(left); const b = parse(right);
  for (let index = 0; index < Math.max(a.numbers.length, b.numbers.length); index += 1) { const delta = (a.numbers[index] ?? 0) - (b.numbers[index] ?? 0); if (delta !== 0) return Math.sign(delta); }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  const aParts = a.prerelease.split(".");
  const bParts = b.prerelease.split(".");
  for (let index = 0; index < Math.max(aParts.length, bParts.length); index += 1) {
    const leftPart = aParts[index];
    const rightPart = bParts[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Math.sign(Number(leftPart) - Number(rightPart));
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

export function isNewerVersion(candidate: string | null | undefined, installed: string): candidate is string {
  return typeof candidate === "string" && candidate.length > 0 && compareVersions(candidate, installed) > 0;
}

export async function fetchLatestWardmoteVersion(
  channel: WardmoteUpdateChannel,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<string | null> {
  const response = await (options.fetchImpl ?? fetch)(WARDMOTE_DIST_TAGS_URL, { signal: AbortSignal.timeout(options.timeoutMs ?? 2_500) });
  if (!response.ok) throw new Error(`npm registry answered HTTP ${response.status}`);
  const tags = await response.json() as Record<string, unknown>;
  const version = tags[channel];
  return typeof version === "string" && version.trim() ? version.trim() : null;
}

export function wardmoteReleaseNotesUrl(version: string): string {
  return `${WARDMOTE_RELEASES_URL}/tag/v${version.replace(/^v/, "")}`;
}

export function updateNoticeHiddenUntil(hiddenAt: number): number {
  return hiddenAt + UPDATE_NOTICE_HIDE_DAYS * DAY_MS;
}

export function isUpdateNoticeHidden(hiddenUntil: number | null | undefined, now: number): boolean {
  return typeof hiddenUntil === "number" && Number.isFinite(hiddenUntil) && now < hiddenUntil;
}
