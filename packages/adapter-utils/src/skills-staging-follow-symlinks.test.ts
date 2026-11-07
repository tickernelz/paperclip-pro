import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoAdaptersDir = path.resolve(__moduleDir, "../../adapters");

// One flat object literal, such as an asset entry in an `assets: [...]`
// array. `[^{}]*` stops at the object's own closing brace, so a match never
// bleeds into a sibling asset (e.g. `mcp-config`) later in the same array.
const OBJECT_LITERAL = /\{[^{}]*\}/g;
const KEY_IS_SKILLS = /key:\s*"skills"/;
// Property order inside the object is not significant: `key: "skills"` can
// come before or after `followSymlinks`, so each is matched on its own
// against the whole block instead of one property chained after the other.
const FOLLOW_SYMLINKS_VALUE = /followSymlinks:\s*(true|false)/;

/**
 * The `followSymlinks` value of every `key: "skills"` object literal in a
 * source string, regardless of the order its properties appear in.
 */
function parseSkillsAssetFollowSymlinksValues(source: string): boolean[] {
  const followSymlinksValues: boolean[] = [];
  for (const [block] of source.matchAll(OBJECT_LITERAL)) {
    if (!KEY_IS_SKILLS.test(block)) continue;
    const followSymlinksMatch = FOLLOW_SYMLINKS_VALUE.exec(block);
    if (!followSymlinksMatch) continue;
    followSymlinksValues.push(followSymlinksMatch[1] === "true");
  }
  return followSymlinksValues;
}

/**
 * Every real occurrence of a `key: "skills"` staging asset under
 * `packages/adapters`, keyed by its repo-relative path. This walks the real
 * adapter source tree, so it catches a new staging site as soon as it lands
 * — a test that only checks a hand-picked list, or a fabricated string,
 * cannot. It also catches a site whose `key` and `followSymlinks`
 * properties appear in either order.
 */
async function findSkillsStagingSites(): Promise<Map<string, boolean[]>> {
  const sites = new Map<string, boolean[]>();

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!fullPath.endsWith(".ts") || fullPath.endsWith(".test.ts")) continue;

      const source = await fs.readFile(fullPath, "utf8");
      const followSymlinksValues = parseSkillsAssetFollowSymlinksValues(source);
      if (followSymlinksValues.length === 0) continue;

      const relativePath = path
        .relative(repoAdaptersDir, fullPath)
        .split(path.sep)
        .join("/");
      sites.set(relativePath, followSymlinksValues);
    }
  }

  await walk(repoAdaptersDir);
  return sites;
}

const EXPECTED_SKILLS_STAGING_SITES: Record<string, boolean> = {};

describe("remote skills staging sites (real source scan)", () => {
  it("matches the reviewed followSymlinks setting at every known site, and finds no unlisted site", async () => {
    const discoveredSites = await findSkillsStagingSites();

    for (const [relativePath, followSymlinksValues] of discoveredSites) {
      expect(
        relativePath in EXPECTED_SKILLS_STAGING_SITES,
        `Found an unreviewed "skills" staging site at ${relativePath}. ` +
          "Add it to EXPECTED_SKILLS_STAGING_SITES with a deliberate " +
          "followSymlinks choice.",
      ).toBe(true);
      for (const value of followSymlinksValues) {
        expect(
          value,
          `${relativePath} sets followSymlinks: ${value}, but the reviewed ` +
            `value is ${EXPECTED_SKILLS_STAGING_SITES[relativePath]}.`,
        ).toBe(EXPECTED_SKILLS_STAGING_SITES[relativePath]);
      }
    }

    for (const relativePath of Object.keys(EXPECTED_SKILLS_STAGING_SITES)) {
      expect(
        discoveredSites.has(relativePath),
        `Expected a "skills" staging site at ${relativePath}; it is missing ` +
          "or no longer sets followSymlinks in that object literal.",
      ).toBe(true);
    }
  });

  it("finds a skills asset's followSymlinks value in either property order", () => {
    const keyFirst = `{ key: "skills", localDir: dir, followSymlinks: false }`;
    const followSymlinksFirst = `{ followSymlinks: true, localDir: dir, key: "skills" }`;

    expect(parseSkillsAssetFollowSymlinksValues(keyFirst)).toEqual([false]);
    expect(parseSkillsAssetFollowSymlinksValues(followSymlinksFirst)).toEqual([
      true,
    ]);
  });
});
