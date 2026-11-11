import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RETIRED_BUNDLED_SKILL_RUNTIME_NAMES } from "@tickernelz/wardmote-adapter-utils/retired-skill-names";
import { ensureOmpSkills } from "./skills.js";

const SKILLS = ["wardmote", "wardmote-board", "para-memory-files"];

function bundled(root: string, version: string, skill: string): string {
  return path.join(root, "installs", version, "node_modules", "@tickernelz", "wardmote-server", "skills", skill);
}

describe("ensureOmpSkills", () => {
  let root: string;
  let agentDir: string;
  let skillsHome: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "wardmote-omp-skills-"));
    agentDir = path.join(root, "agent");
    skillsHome = path.join(agentDir, "skills");
    await fs.mkdir(skillsHome, { recursive: true });
    for (const skill of SKILLS) {
      await fs.mkdir(bundled(root, "old", skill), { recursive: true });
      await fs.mkdir(bundled(root, "new", skill), { recursive: true });
    }
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("moves every bundled skill link off an older install, not only the agent's desired skills", async () => {
    for (const skill of SKILLS) await fs.symlink(bundled(root, "old", skill), path.join(skillsHome, skill));
    const foreign = path.join(root, "mine", "notes");
    await fs.mkdir(foreign, { recursive: true });
    await fs.symlink(foreign, path.join(skillsHome, "notes"));

    await ensureOmpSkills(
      {
        wardmoteRuntimeSkills: [...SKILLS, "notes"].map((skill) => ({
          key: `tickernelz/wardmote/${skill}`,
          runtimeName: skill,
          source: skill === "notes" ? path.join(root, "bundled-notes") : bundled(root, "new", skill),
        })),
        wardmoteSkillSync: { desiredSkills: ["tickernelz/wardmote/wardmote"] },
      },
      agentDir,
    );

    for (const skill of SKILLS) {
      expect(await fs.readlink(path.join(skillsHome, skill))).toBe(bundled(root, "new", skill));
    }
    expect(await fs.readlink(path.join(skillsHome, "notes"))).toBe(foreign);
  });

  it("removes links to bundled skills under retired runtime names and keeps user folders with those names", async () => {
    const retired = RETIRED_BUNDLED_SKILL_RUNTIME_NAMES[0];
    const retiredBoard = RETIRED_BUNDLED_SKILL_RUNTIME_NAMES[1];
    const oldBundled = bundled(root, "old", retired);
    await fs.mkdir(oldBundled, { recursive: true });
    await fs.symlink(oldBundled, path.join(skillsHome, retired));
    const userOwned = path.join(root, "mine", retiredBoard);
    await fs.mkdir(userOwned, { recursive: true });
    await fs.symlink(userOwned, path.join(skillsHome, retiredBoard));

    await ensureOmpSkills(
      {
        wardmoteRuntimeSkills: SKILLS.map((skill) => ({
          key: `tickernelz/wardmote/${skill}`,
          runtimeName: skill,
          source: bundled(root, "new", skill),
        })),
        wardmoteSkillSync: { desiredSkills: ["tickernelz/wardmote/wardmote"] },
      },
      agentDir,
    );

    await expect(fs.lstat(path.join(skillsHome, retired))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readlink(path.join(skillsHome, retiredBoard))).toBe(userOwned);
    expect(await fs.readlink(path.join(skillsHome, "wardmote"))).toBe(bundled(root, "new", "wardmote"));
  });

  it("moves bundled skill links off an install published under the legacy package name", async () => {
    for (const skill of SKILLS) {
      const legacy = path.join(root, "installs", "legacy", "node_modules", "@tickernelz", "paperclip-pro-server", "skills", skill);
      await fs.mkdir(legacy, { recursive: true });
      await fs.symlink(legacy, path.join(skillsHome, skill));
    }

    await ensureOmpSkills(
      {
        wardmoteRuntimeSkills: SKILLS.map((skill) => ({
          key: `tickernelz/wardmote/${skill}`,
          runtimeName: skill,
          source: bundled(root, "new", skill),
        })),
        wardmoteSkillSync: { desiredSkills: ["tickernelz/wardmote/wardmote"] },
      },
      agentDir,
    );

    for (const skill of SKILLS) {
      expect(await fs.readlink(path.join(skillsHome, skill))).toBe(bundled(root, "new", skill));
    }
  });
});
