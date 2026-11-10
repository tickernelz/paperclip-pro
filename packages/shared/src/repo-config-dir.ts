import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const REPO_CONFIG_DIR = ".wardmote";
export const RETIRED_REPO_CONFIG_DIR = ".paperclip";
export const REPO_CONFIG_DIR_NAMES: readonly string[] = [REPO_CONFIG_DIR, RETIRED_REPO_CONFIG_DIR];

const MARKER_FILES = ["config.json", "context.json"];
const REWRITTEN_FILES = ["config.json", ".env", "context.json"];
const KEPT_IN_PLACE = new Set(["worktrees"]);

function isRealDirectory(target: string): boolean {
  try {
    const entry = fs.lstatSync(target);
    return entry.isDirectory() && !entry.isSymbolicLink();
  } catch {
    return false;
  }
}

function runningPostmasters(root: string): string[] {
  return ["instances", path.join("runtime-services", "instances")].flatMap((parent) => {
    const dir = path.join(root, parent);
    if (!isRealDirectory(dir)) return [];
    return fs.readdirSync(dir)
      .map((name) => path.join(dir, name, "db", "postmaster.pid"))
      .filter((pidFile) => fs.existsSync(pidFile));
  });
}

function rewritePathPrefix(file: string, from: string, to: string) {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  const next = text.split(from).join(to);
  if (next !== text) fs.writeFileSync(file, next);
}

/** Moves a repository-local `.paperclip` config directory to `.wardmote`, keeping its absolute paths valid. */
export function adoptRetiredRepoConfigDir(dir: string): void {
  const base = path.resolve(dir);
  if (base === path.resolve(os.homedir())) return;
  const retired = path.join(base, RETIRED_REPO_CONFIG_DIR);
  if (!isRealDirectory(retired) || !MARKER_FILES.some((name) => fs.existsSync(path.join(retired, name)))) return;
  const current = path.join(base, REPO_CONFIG_DIR);
  if (fs.existsSync(current) && !isRealDirectory(current)) {
    throw new Error(`Cannot move ${retired} to ${current}: ${current} is not a directory.`);
  }
  const running = runningPostmasters(retired);
  if (running.length > 0) {
    throw new Error(`Stop the local Wardmote instance before moving ${retired} to ${current}; still running: ${running.join(", ")}`);
  }
  fs.mkdirSync(current, { recursive: true });
  const moved: string[] = [];
  for (const name of fs.readdirSync(retired)) {
    const target = path.join(current, name);
    if (KEPT_IN_PLACE.has(name) || fs.existsSync(target)) continue;
    fs.renameSync(path.join(retired, name), target);
    moved.push(name);
  }
  if (fs.readdirSync(retired).length === 0) fs.rmdirSync(retired);
  for (const name of REWRITTEN_FILES) {
    for (const entry of moved) {
      rewritePathPrefix(path.join(current, name), path.join(retired, entry), path.join(current, entry));
    }
  }
}
