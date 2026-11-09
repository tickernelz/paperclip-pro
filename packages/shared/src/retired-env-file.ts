import fs from "node:fs";
import { writeEnvFileAtomicallyIfChanged } from "./env-file.js";

const RETIRED_ENV_PREFIX = "PAPERCLIP_";
const CURRENT_ENV_PREFIX = "WARDMOTE_";
const ASSIGNMENT_PATTERN = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=)/;
export const RETIRED_ENV_FILE_BACKUP_SUFFIX = ".pre-wardmote-env";

function assignedKey(line: string): string | null {
  return line.match(ASSIGNMENT_PATTERN)?.[2] ?? null;
}

/** Renames retired env assignments to the current prefix; an existing current name keeps its value. */
export function migrateRetiredEnvFileContents(contents: string): string {
  const lines = contents.split(/(?<=\n)/);
  const assigned = new Set(lines.map(assignedKey).filter((key): key is string => key !== null));
  return lines
    .flatMap((line) => {
      const match = line.match(ASSIGNMENT_PATTERN);
      if (!match || !match[2]!.startsWith(RETIRED_ENV_PREFIX)) return [line];
      const current = CURRENT_ENV_PREFIX + match[2]!.slice(RETIRED_ENV_PREFIX.length);
      if (assigned.has(current)) return [];
      return [match[1] + current + line.slice(match[1]!.length + match[2]!.length)];
    })
    .join("");
}

/** Rewrites a retired env file in place after keeping one untouched backup copy beside it. */
export function migrateRetiredEnvFile(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const contents = fs.readFileSync(filePath, "utf8");
  const next = migrateRetiredEnvFileContents(contents);
  if (next === contents) return false;
  const backupPath = filePath + RETIRED_ENV_FILE_BACKUP_SUFFIX;
  if (!fs.existsSync(backupPath)) fs.copyFileSync(filePath, backupPath, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(backupPath, 0o600);
  return writeEnvFileAtomicallyIfChanged(filePath, contents, next);
}
