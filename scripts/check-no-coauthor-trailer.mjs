#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const TRAILER_PATTERN = "co-authored-by";

export const SELF_PATHS = [
  "scripts/check-no-coauthor-trailer.mjs",
  "scripts/check-no-coauthor-trailer.test.mjs",
];

export function findTrailerOffenses(repoRoot) {
  let output = "";
  try {
    output = execFileSync(
      "git",
      [
        "-C",
        repoRoot,
        "grep",
        "-n",
        "-I",
        "-i",
        "-e",
        TRAILER_PATTERN,
        "--",
        ".",
        ...SELF_PATHS.map((entry) => `:(exclude)${entry}`),
      ],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (error) {
    if (error && error.status === 1) return [];
    throw error;
  }
  return output
    .split("\n")
    .filter(Boolean)
    .map((entry) => {
      const match = /^(.*?):(\d+):(.*)$/.exec(entry);
      return match
        ? { file: match[1], lineNumber: Number(match[2]), line: match[3].trim() }
        : { file: entry, lineNumber: 0, line: "" };
    });
}

export function runCheck({ repoRoot, log = console.log, error = console.error } = {}) {
  const offenses = findTrailerOffenses(repoRoot);
  if (offenses.length === 0) {
    log("  ✓  No Co-Authored-By trailer rules found in tracked files.");
    return 0;
  }
  error("ERROR: tracked files mention a Co-Authored-By trailer:\n");
  for (const offense of offenses) {
    error(`  ${offense.file}:${offense.lineNumber}: ${offense.line.slice(0, 160)}`);
  }
  error(
    "\nAgent commits carry the owner's git identity and no Co-Authored-By trailer of any kind. Delete the line; do not reword it. After an upstream sync, remove lines the merge re-added (see doc/upstream-sync/LAST_SYNC.md).",
  );
  return 1;
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  process.exit(runCheck({ repoRoot: process.cwd() }));
}
