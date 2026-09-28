import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureOmpSkills } from "./skills.js";

const SKILLS = ["paperclip", "paperclip-board", "para-memory-files"];

function bundled(root: string, version: string, skill: string): string {
  return path.join(root, "installs", version, "node_modules", "@tickernelz", "paperclip-pro-server", "skills", skill);
}

describe("ensureOmpSkills", () => {
  let root: string;
  let agentDir: string;
  let skillsHome: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-omp-skills-"));
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
        paperclipRuntimeSkills: [...SKILLS, "notes"].map((skill) => ({
          key: `paperclipai/paperclip/${skill}`,
          runtimeName: skill,
          source: skill === "notes" ? path.join(root, "bundled-notes") : bundled(root, "new", skill),
        })),
        paperclipSkillSync: { desiredSkills: ["paperclipai/paperclip/paperclip"] },
      },
      agentDir,
    );

    for (const skill of SKILLS) {
      expect(await fs.readlink(path.join(skillsHome, skill))).toBe(bundled(root, "new", skill));
    }
    expect(await fs.readlink(path.join(skillsHome, "notes"))).toBe(foreign);
  });
});
