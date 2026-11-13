import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const RETIRED_OMP_SESSION_PRODUCT_DIR = "paperclip";

export type RetiredOmpSessionRootMove =
  | { status: "absent" }
  | { status: "moved"; conflicts: string[] };

async function exists(target: string) {
  return fs.lstat(target).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
}

async function removeEmptyDirectory(target: string) {
  return fs.rmdir(target).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code === "ENOTEMPTY" || error.code === "EEXIST" || error.code === "ENOTDIR") return false;
    throw error;
  });
}

export async function moveRetiredOmpSessionRoot(home = os.homedir()): Promise<RetiredOmpSessionRootMove> {
  const retiredParent = path.join(home, ".omp", RETIRED_OMP_SESSION_PRODUCT_DIR);
  const retired = path.join(retiredParent, "sessions");
  const current = path.join(home, ".omp", "wardmote", "sessions");
  if (!(await exists(retired))) return { status: "absent" };
  const conflicts: string[] = [];
  if (!(await exists(current))) {
    await fs.mkdir(path.dirname(current), { recursive: true });
    await fs.rename(retired, current);
  } else {
    for (const name of await fs.readdir(retired)) {
      const target = path.join(current, name);
      if ((await exists(target)) && !(await removeEmptyDirectory(target))) {
        conflicts.push(name);
        continue;
      }
      await fs.rename(path.join(retired, name), target);
    }
    if (conflicts.length === 0) await fs.rmdir(retired);
  }
  if (conflicts.length === 0) await removeEmptyDirectory(retiredParent).catch(() => false);
  return { status: "moved", conflicts };
}
