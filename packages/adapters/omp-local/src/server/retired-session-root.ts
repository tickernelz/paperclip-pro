import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const RETIRED_OMP_SESSION_PRODUCT_DIR = "paperclip";

export type RetiredOmpSessionRootMove = "moved" | "absent" | "kept-both";

async function exists(target: string) {
  return fs.lstat(target).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
}

/** Moves the OMP session root written before the rename to the Wardmote root, once. */
export async function moveRetiredOmpSessionRoot(home = os.homedir()): Promise<RetiredOmpSessionRootMove> {
  const retiredParent = path.join(home, ".omp", RETIRED_OMP_SESSION_PRODUCT_DIR);
  const retired = path.join(retiredParent, "sessions");
  const current = path.join(home, ".omp", "wardmote", "sessions");
  if (!(await exists(retired))) return "absent";
  if (await exists(current)) return "kept-both";
  await fs.mkdir(path.dirname(current), { recursive: true });
  await fs.rename(retired, current);
  await fs.rmdir(retiredParent).catch(() => {});
  return "moved";
}
