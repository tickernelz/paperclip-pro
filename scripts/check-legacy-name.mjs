#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const LEGACY_NAME = "paperclip";
export const ALLOWLIST_PATH = "scripts/legacy-name-allowlist.json";
export const SELF_PATHS = [
  ALLOWLIST_PATH,
  "scripts/check-legacy-name.mjs",
  "scripts/check-legacy-name.test.mjs",
];

const LEGACY_RE = new RegExp(LEGACY_NAME, "i");

export const REPORT_CLASSES = [
  ["env PAPERCLIP_*", /PAPERCLIP_[A-Z0-9_]+/],
  ["npm @tickernelz/paperclip-pro", /@tickernelz\/paperclip-pro/i],
  ["paperclip-pro (repo, home, unit)", /paperclip-pro/i],
  ["home ~/.paperclip*", /(?:~|\$HOME|[\/"'`])\.paperclip/i],
  ["upstream paperclipai", /paperclipai/i],
  ["upstream github.com/paperclipai", /github\.com\/paperclipai/i],
  ["header X-Paperclip-*", /x-paperclip-/i],
  ["camelCase paperclipX (MCP tools, identifiers)", /\bpaperclip[A-Z][A-Za-z]+|mcp__paperclip/],
  ["Paperclip Cloud/Labs/EE", /paperclip (cloud|labs|ee)\b/i],
];

const LUCIDE_IMPORT_RE = /import\s*(?:type\s*)?\{[^}]*\bPaperclip\b[^}]*\}\s*from\s*["']lucide-react["']/s;
const LUCIDE_USE_RE = /\bPaperclip\b/;

function git(repoRoot, args) {
  try {
    return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  } catch (error) {
    if (error && error.status === 1) return "";
    throw error;
  }
}

const excludes = SELF_PATHS.map((entry) => `:(exclude)${entry}`);

export function countOccurrences(repoRoot) {
  const counts = new Map();
  const byLine = git(repoRoot, ["grep", "-z", "-c", "-I", "-i", "-e", LEGACY_NAME, "--", ".", ...excludes]);
  for (const record of byLine.split("\n")) {
    if (!record) continue;
    const [file, count] = record.split("\0");
    counts.set(file, Number(count));
  }
  const files = git(repoRoot, ["ls-files", "-z", "--", ".", ...excludes]).split("\0");
  for (const file of files) {
    if (file && LEGACY_RE.test(file)) counts.set(file, (counts.get(file) ?? 0) + 1);
  }
  return counts;
}

export function loadAllowlist(repoRoot) {
  return JSON.parse(readFileSync(path.join(repoRoot, ALLOWLIST_PATH), "utf8"));
}

export function serializeAllowlist(allowlist) {
  const entries = [...allowlist.entries].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const head = JSON.stringify({ pattern: allowlist.pattern, classes: allowlist.classes }, null, 2).replace(/\n}$/, "");
  const body = entries.map((entry) => `    ${JSON.stringify(entry)}`).join(",\n");
  return `${head},\n  "entries": [\n${body}\n  ]\n}\n`;
}

export function evaluate(counts, allowlist) {
  const problems = [];
  const stale = [];
  if (allowlist.pattern !== LEGACY_NAME) problems.push(`allowlist pattern must be "${LEGACY_NAME}"`);
  for (const [name, spec] of Object.entries(allowlist.classes)) {
    if (!spec?.reason?.trim() || !spec?.approvedBy?.trim()) problems.push(`class "${name}" needs a reason and approvedBy`);
  }
  const allowed = new Map();
  for (const [file, limit, klass] of allowlist.entries) {
    if (allowed.has(file)) problems.push(`${file}: listed twice`);
    if (!allowlist.classes[klass]) problems.push(`${file}: unknown class "${klass}"`);
    if (!Number.isInteger(limit) || limit < 1) problems.push(`${file}: limit must be a positive integer`);
    allowed.set(file, limit);
  }
  for (const [file, count] of counts) {
    const limit = allowed.get(file);
    if (limit === undefined) problems.push(`${file}: ${count} new occurrence(s), not in the allowlist`);
    else if (count > limit) problems.push(`${file}: ${count} occurrence(s), allowlist permits ${limit}`);
  }
  for (const [file, limit] of allowed) {
    const count = counts.get(file) ?? 0;
    if (count < limit) stale.push({ file, count, limit });
  }
  return { problems, stale };
}

export function tighten(counts, allowlist) {
  const entries = [];
  for (const [file, limit, klass] of allowlist.entries) {
    const count = Math.min(counts.get(file) ?? 0, limit);
    if (count > 0) entries.push([file, count, klass]);
  }
  return { ...allowlist, entries };
}

export function report(repoRoot) {
  const rows = new Map([["total", { files: new Set(), lines: 0 }], ["file path", { files: new Set(), lines: 0 }]]);
  for (const [name] of REPORT_CLASSES) rows.set(name, { files: new Set(), lines: 0 });
  rows.set("lucide Paperclip icon", { files: new Set(), lines: 0 });
  const output = git(repoRoot, ["grep", "-z", "-n", "-I", "-i", "-e", LEGACY_NAME, "--", ".", ...excludes]);
  const lucideFiles = new Map();
  for (const record of output.split("\n")) {
    if (!record) continue;
    const [file, , line = ""] = record.split("\0");
    const total = rows.get("total");
    total.files.add(file);
    total.lines += 1;
    for (const [name, re] of REPORT_CLASSES) {
      if (!re.test(line)) continue;
      const row = rows.get(name);
      row.files.add(file);
      row.lines += 1;
    }
    if (!/\.(tsx?|jsx?|mjs)$/.test(file) || !LUCIDE_USE_RE.test(line)) continue;
    if (!lucideFiles.has(file)) lucideFiles.set(file, LUCIDE_IMPORT_RE.test(readFileSync(path.join(repoRoot, file), "utf8")));
    if (!lucideFiles.get(file)) continue;
    const row = rows.get("lucide Paperclip icon");
    row.files.add(file);
    row.lines += 1;
  }
  const pathRow = rows.get("file path");
  for (const file of git(repoRoot, ["ls-files", "-z", "--", ".", ...excludes]).split("\0")) {
    if (file && LEGACY_RE.test(file)) {
      pathRow.files.add(file);
      pathRow.lines += 1;
    }
  }
  return [...rows].map(([name, row]) => ({ class: name, files: row.files.size, lines: row.lines }));
}

export function runCheck({ repoRoot, log = console.log, error = console.error } = {}) {
  const counts = countOccurrences(repoRoot);
  const { problems, stale } = evaluate(counts, loadAllowlist(repoRoot));
  if (problems.length > 0) {
    error(`ERROR: the legacy product name "${LEGACY_NAME}" appears outside ${ALLOWLIST_PATH}:\n`);
    for (const problem of problems) error(`  ${problem}`);
    error(
      `\nUse the Wardmote name (WARDMOTE_*, X-Wardmote-*, wardmote*). A legacy name that must stay needs an allowlist entry [path, count, class] whose class carries a reason and approvedBy; reviewers check every added or raised entry.`,
    );
    return 1;
  }
  const occurrences = [...counts.values()].reduce((sum, count) => sum + count, 0);
  log(`  ✓  No legacy product name outside the allowlist (${counts.size} files, ${occurrences} occurrences allowed).`);
  if (stale.length > 0) log(`  ${stale.length} allowlist entries can shrink: run node scripts/check-legacy-name.mjs --tighten`);
  return 0;
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const repoRoot = process.cwd();
  const args = process.argv.slice(2);
  if (args.includes("--report")) {
    const rows = report(repoRoot);
    if (args.includes("--json")) console.log(JSON.stringify(rows, null, 2));
    else for (const row of rows) console.log(`${String(row.files).padStart(6)} files ${String(row.lines).padStart(7)} lines  ${row.class}`);
    process.exit(0);
  }
  if (args.includes("--tighten")) {
    const allowlist = loadAllowlist(repoRoot);
    const next = tighten(countOccurrences(repoRoot), allowlist);
    writeFileSync(path.join(repoRoot, ALLOWLIST_PATH), serializeAllowlist(next));
    console.log(`  tightened ${allowlist.entries.length} -> ${next.entries.length} entries`);
  }
  process.exit(runCheck({ repoRoot }));
}
