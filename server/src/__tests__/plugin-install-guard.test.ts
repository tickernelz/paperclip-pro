import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalizeLocalPluginPath } from "../services/plugin-install-guard.js";

describe("canonicalizeLocalPluginPath", () => {
  const cleanupPaths = new Set<string>();

  afterEach(async () => {
    for (const cleanupPath of cleanupPaths) {
      await rm(cleanupPath, { recursive: true, force: true });
    }
    cleanupPaths.clear();
  });

  async function makeTempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
    cleanupPaths.add(dir);
    return dir;
  }

  it("accepts an existing absolute directory path", async () => {
    const dir = await makeTempDir("guard-abs-");
    const result = await canonicalizeLocalPluginPath(dir);
    expect(result).toEqual({ ok: true, canonicalPath: await realCanonical(dir) });
  });

  it("collapses traversal segments to the canonical path", async () => {
    const dir = await makeTempDir("guard-traversal-");
    const nested = path.join(dir, "a", "b");
    await mkdir(nested, { recursive: true });
    const traversal = path.join(dir, "a", "..", "a", "b", "..", "b");
    const result = await canonicalizeLocalPluginPath(traversal);
    expect(result).toEqual({ ok: true, canonicalPath: await realCanonical(nested) });
  });

  it("resolves symlinks to their target", async () => {
    const dir = await makeTempDir("guard-symlink-");
    const target = path.join(dir, "target");
    await mkdir(target, { recursive: true });
    const link = path.join(dir, "link");
    await symlink(target, link, "dir");
    const result = await canonicalizeLocalPluginPath(link);
    expect(result).toEqual({ ok: true, canonicalPath: await realCanonical(target) });
  });

  it("rejects paths containing a null byte", async () => {
    const result = await canonicalizeLocalPluginPath("/tmp/foo\0bar");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("null byte");
  });

  it("rejects nonexistent paths", async () => {
    const dir = await makeTempDir("guard-missing-");
    const result = await canonicalizeLocalPluginPath(path.join(dir, "does-not-exist"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("does not exist");
  });

  it("rejects paths that resolve to a file rather than a directory", async () => {
    const dir = await makeTempDir("guard-file-");
    const file = path.join(dir, "plugin.txt");
    await writeFile(file, "not a directory", "utf8");
    const result = await canonicalizeLocalPluginPath(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("not a directory");
  });
});

/** realpath through the same lens the guard uses (macOS /tmp is a symlink). */
async function realCanonical(target: string): Promise<string> {
  const result = await canonicalizeLocalPluginPath(target);
  if (!result.ok) throw new Error(`fixture path did not canonicalize: ${result.reason}`);
  return result.canonicalPath;
}
