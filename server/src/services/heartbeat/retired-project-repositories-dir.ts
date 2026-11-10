import fs from "node:fs/promises";
import path from "node:path";

const RETIRED_PROJECT_REPOSITORIES_DIR = ".paperclip-repositories";

export async function adoptRetiredProjectRepositoriesDir(cwd: string, root: string) {
  const retired = path.join(cwd, RETIRED_PROJECT_REPOSITORIES_DIR);
  const retiredEntry = await fs.lstat(retired).catch(() => null);
  if (!retiredEntry?.isDirectory() || await fs.lstat(root).catch(() => null)) return;
  await fs.rename(retired, root);
}
