import fs from "node:fs/promises";
import path from "node:path";

export const RETIRED_RUNNER_RUNTIME_DIR = "paperclip-runner";

export async function moveRetiredRunnerRuntimeDirectory(instanceRoot: string, currentName: string): Promise<boolean> {
  const from = path.join(instanceRoot, "runtime", RETIRED_RUNNER_RUNTIME_DIR);
  const to = path.join(instanceRoot, "runtime", currentName);
  const source = await fs.lstat(from).catch(() => null);
  if (!source || !source.isDirectory() || source.isSymbolicLink()) return false;
  if (await fs.lstat(to).catch(() => null)) return false;
  await fs.rename(from, to);
  return true;
}
