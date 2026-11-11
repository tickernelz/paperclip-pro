import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { RETIRED_MANAGED_CODEX_SKILLS_MANIFEST } from "../retired-marker-names.js";
import { readManagedCodexSkillsManifest, writeManagedCodexSkillsManifest } from "./managed-codex-skills-manifest.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

async function skillsHome() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wardmote-managed-skills-"));
  roots.push(root);
  return root;
}

it("keeps tracking skills recorded by an earlier release so they can still be revoked", async () => {
  const home = await skillsHome();
  await fs.writeFile(
    path.join(home, RETIRED_MANAGED_CODEX_SKILLS_MANIFEST),
    JSON.stringify({ version: 1, managedSkillNames: ["old-skill"] }),
  );

  expect([...(await readManagedCodexSkillsManifest(home))]).toEqual(["old-skill"]);
});

it("replaces the earlier release's manifest on write", async () => {
  const home = await skillsHome();
  await fs.writeFile(
    path.join(home, RETIRED_MANAGED_CODEX_SKILLS_MANIFEST),
    JSON.stringify({ version: 1, managedSkillNames: ["old-skill"] }),
  );

  await writeManagedCodexSkillsManifest(home, ["new-skill"]);

  expect([...(await readManagedCodexSkillsManifest(home))]).toEqual(["new-skill"]);
  await expect(fs.stat(path.join(home, RETIRED_MANAGED_CODEX_SKILLS_MANIFEST))).rejects.toMatchObject({ code: "ENOENT" });
});
