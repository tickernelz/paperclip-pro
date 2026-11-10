import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// packages/shared/src/ is three levels below the repo root
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

describe("gitignore: .wardmote-runtime/", () => {
  it("ignores files under .wardmote-runtime/ via the explicit gitignore rule", () => {
    const output = execSync(
      "git check-ignore -v .wardmote-runtime/codex/home/auth.json",
      { cwd: REPO_ROOT, encoding: "utf8" },
    ).trim();
    expect(output).toMatch(/^\.gitignore:\d+:\.wardmote-runtime\//);
  });

  it("keeps ignoring a staging directory left by a release before the rename", () => {
    const output = execSync(
      "git check-ignore -v .paperclip-runtime/codex/home/auth.json",
      { cwd: REPO_ROOT, encoding: "utf8" },
    ).trim();
    expect(output).toMatch(/^\.gitignore:\d+:\.paperclip-runtime\//);
  });

  it("ignores the artifact helper state under .wardmote/", () => {
    const output = execSync(
      "git check-ignore -v .wardmote/artifact-helper/state.json",
      { cwd: REPO_ROOT, encoding: "utf8" },
    ).trim();
    expect(output).toMatch(/^\.gitignore:\d+:\.wardmote\//);
  });
});
