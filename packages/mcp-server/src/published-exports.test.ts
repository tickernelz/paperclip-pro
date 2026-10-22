import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface PackageManifest {
  exports: Record<string, string>;
  publishConfig: { exports: Record<string, unknown> };
}

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
) as PackageManifest;

describe("published subpath surface", () => {
  it("publishes every subpath the source exports map declares", () => {
    const missing = Object.keys(manifest.exports).filter(
      (key) => !Object.hasOwn(manifest.publishConfig.exports, key),
    );
    expect(missing).toEqual([]);
  });

  it("points each published subpath at a dist file that the build emits", () => {
    for (const [key, entry] of Object.entries(manifest.publishConfig.exports)) {
      if (typeof entry !== "object" || entry === null) continue;
      const target = (entry as { import?: string }).import;
      if (!target) continue;
      expect(target.startsWith("./dist/"), key + " must publish from dist").toBe(true);
    }
  });
});
