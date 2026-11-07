import { configProbe, detectionEnv, resolveOmpCommand } from "./config.js";

export type OmpSettingType = "boolean" | "number" | "string" | "array" | "record" | "enum";

export interface OmpSettingsCatalogEntry {
  key: string;
  section: string;
  type: OmpSettingType;
  options?: string[];
  description: string;
  value?: boolean | number | string;
}

const CATALOG_TTL_MS = 5 * 60_000;
const LINE_RE = /^\s{2}([A-Za-z0-9_.-]+) = (.*) \(([^()]*)\)$/;
const SECTION_RE = /^\[([a-z]+)\]$/;
const HIDDEN_SECTIONS = new Set(["internal"]);
let cache: { expiresAt: number; entries: OmpSettingsCatalogEntry[] } | null = null;

function isCredentialKey(key: string): boolean {
  return /^(auth|secrets)\./.test(key) || /(^|\.)(token|apiKey|api_key|secret|password|credentials?)$/i.test(key);
}

function scalarType(raw: string): OmpSettingType | null {
  if (raw.includes("|")) return "enum";
  return raw === "boolean" || raw === "number" || raw === "string" || raw === "array" || raw === "record" ? raw : null;
}

export function parseOmpSettingsCatalog(listText: string, listJson: string): OmpSettingsCatalogEntry[] {
  let details: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(listJson);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) details = parsed as Record<string, unknown>;
  } catch {
    details = {};
  }
  const entries: OmpSettingsCatalogEntry[] = [];
  let section: string | null = null;
  for (const line of listText.split(/\r?\n/)) {
    const heading = SECTION_RE.exec(line.trim());
    if (heading) {
      section = heading[1]!;
      continue;
    }
    const match = LINE_RE.exec(line);
    if (!match || !section || HIDDEN_SECTIONS.has(section)) continue;
    const [, key, , rawType] = match;
    const type = scalarType(rawType!);
    if (!type || isCredentialKey(key!)) continue;
    const detail = details[key!] && typeof details[key!] === "object" ? details[key!] as Record<string, unknown> : {};
    if (detail.redacted) continue;
    const entry: OmpSettingsCatalogEntry = {
      key: key!,
      section,
      type,
      description: typeof detail.description === "string" ? detail.description : "",
    };
    if (type === "enum") entry.options = rawType!.split("|").map((option) => option.trim()).filter(Boolean);
    const value = detail.value;
    if ((type === "boolean" && typeof value === "boolean") || (type === "number" && typeof value === "number") || (type === "enum" && typeof value === "string")) {
      entry.value = value;
    }
    entries.push(entry);
  }
  return entries;
}

export async function listOmpSettingsCatalog(): Promise<OmpSettingsCatalogEntry[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.entries;
  const command = resolveOmpCommand({});
  const env = detectionEnv();
  const [listText, listJson] = await Promise.all([
    configProbe(command, ["config", "list"], env),
    configProbe(command, ["config", "list", "--json"], env),
  ]);
  if (listText.timedOut || (listText.exitCode ?? 1) !== 0) {
    throw new Error("omp config list failed; check that OMP is installed and on PATH.");
  }
  const entries = parseOmpSettingsCatalog(listText.stdout, listJson.timedOut ? "" : listJson.stdout);
  cache = { expiresAt: Date.now() + CATALOG_TTL_MS, entries };
  return entries;
}

export function resetOmpSettingsCatalogCacheForTests(): void {
  cache = null;
}
