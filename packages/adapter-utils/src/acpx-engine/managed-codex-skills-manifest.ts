import fs from "node:fs/promises";
import path from "node:path";
import { RETIRED_MANAGED_CODEX_SKILLS_MANIFEST } from "../retired-marker-names.js";
import { parseObject } from "../server-utils.js";

const MANAGED_CODEX_SKILLS_MANIFEST = ".wardmote-managed-skills.json";

export async function readManagedCodexSkillsManifest(skillsHome: string): Promise<Set<string>> {
  const current = await readManifestFile(path.join(skillsHome, MANAGED_CODEX_SKILLS_MANIFEST));
  if (current) return current;
  return (await readManifestFile(path.join(skillsHome, RETIRED_MANAGED_CODEX_SKILLS_MANIFEST))) ?? new Set();
}

async function readManifestFile(manifestPath: string): Promise<Set<string> | null> {
  try {
    const raw = JSON.parse(await fs.readFile(manifestPath, "utf8")) as unknown;
    const parsed = parseObject(raw);
    const skills = Array.isArray(parsed.managedSkillNames)
      ? parsed.managedSkillNames.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    return new Set(skills);
  } catch {
    return null;
  }
}

export async function writeManagedCodexSkillsManifest(skillsHome: string, skillNames: Iterable<string>): Promise<void> {
  const managedSkillNames = Array.from(new Set(skillNames)).sort();
  await fs.writeFile(
    path.join(skillsHome, MANAGED_CODEX_SKILLS_MANIFEST),
    `${JSON.stringify({ version: 1, managedSkillNames }, null, 2)}\n`,
    "utf8",
  );
  await fs.rm(path.join(skillsHome, RETIRED_MANAGED_CODEX_SKILLS_MANIFEST), { force: true });
}
