import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { adoptRetiredRepoConfigDir } from "./repo-config-dir.js";

const roots: string[] = [];

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wardmote-repo-config-"));
  roots.push(root);
  return root;
}

function write(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("adoptRetiredRepoConfigDir", () => {
  it("moves the config directory and repoints its absolute paths, leaving managed worktrees in place", () => {
    const root = repo();
    const retired = path.join(root, ".paperclip");
    write(path.join(retired, "config.json"), JSON.stringify({ dataDir: path.join(retired, "instances", "dev", "db"), worktrees: path.join(retired, "worktrees", "a") }));
    write(path.join(retired, ".env"), `WARDMOTE_HOME=${path.join(retired, "instances")}\n`);
    write(path.join(retired, "instances", "dev", "db", "PG_VERSION"), "17");
    write(path.join(retired, "worktrees", "a", "README.md"), "work");

    adoptRetiredRepoConfigDir(root);

    const current = path.join(root, ".wardmote");
    expect(JSON.parse(fs.readFileSync(path.join(current, "config.json"), "utf8"))).toEqual({
      dataDir: path.join(current, "instances", "dev", "db"),
      worktrees: path.join(retired, "worktrees", "a"),
    });
    expect(fs.readFileSync(path.join(current, ".env"), "utf8")).toBe(`WARDMOTE_HOME=${path.join(current, "instances")}\n`);
    expect(fs.readFileSync(path.join(current, "instances", "dev", "db", "PG_VERSION"), "utf8")).toBe("17");
    expect(fs.readFileSync(path.join(retired, "worktrees", "a", "README.md"), "utf8")).toBe("work");
    expect(fs.readdirSync(retired)).toEqual(["worktrees"]);

    adoptRetiredRepoConfigDir(root);
    expect(fs.readdirSync(retired)).toEqual(["worktrees"]);
    expect(fs.readdirSync(current).sort()).toEqual([".env", "config.json", "instances"]);
  });

  it("keeps a value already present under the new directory", () => {
    const root = repo();
    write(path.join(root, ".paperclip", "context.json"), "old");
    write(path.join(root, ".wardmote", "context.json"), "new");

    adoptRetiredRepoConfigDir(root);

    expect(fs.readFileSync(path.join(root, ".wardmote", "context.json"), "utf8")).toBe("new");
    expect(fs.readFileSync(path.join(root, ".paperclip", "context.json"), "utf8")).toBe("old");
  });

  it("leaves directories without a config or context file alone", () => {
    const root = repo();
    fs.mkdirSync(path.join(root, ".paperclip", "artifact-helper"), { recursive: true });

    adoptRetiredRepoConfigDir(root);

    expect(fs.existsSync(path.join(root, ".paperclip", "artifact-helper"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".wardmote"))).toBe(false);
  });

  it("refuses to move a directory whose embedded database is still running", () => {
    const root = repo();
    write(path.join(root, ".paperclip", "config.json"), "{}");
    write(path.join(root, ".paperclip", "instances", "dev", "db", "postmaster.pid"), "123");

    expect(() => adoptRetiredRepoConfigDir(root)).toThrow(/Stop the local Wardmote instance/);
    expect(fs.existsSync(path.join(root, ".paperclip", "config.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".wardmote"))).toBe(false);
  });
});
