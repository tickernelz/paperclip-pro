import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(PACKAGE_DIR, "package.json"), "utf8"),
) as {
  files: string[];
  exports: Record<string, string>;
  publishConfig: { exports: Record<string, string | { import: string }> };
};

function importTarget(entry: string | { import: string } | undefined): string {
  if (typeof entry === "string") return entry;
  return entry?.import ?? "";
}

describe("teams catalog packaging", () => {
  it("ships the manifest file the server reads", () => {
    expect(manifest.files).toContain("generated");
    expect(fs.existsSync(path.join(PACKAGE_DIR, "generated/catalog.json"))).toBe(true);
  });

  it("exposes the manifest as a subpath export in both the source and published layouts", () => {
    expect(manifest.exports["./catalog.json"]).toBe("./generated/catalog.json");
    expect(importTarget(manifest.publishConfig.exports["./catalog.json"])).toBe(
      "./dist/generated/catalog.json",
    );
  });

  it("keeps the published dist layout that emit path implies", () => {
    const tsconfig = JSON.parse(
      fs.readFileSync(path.join(PACKAGE_DIR, "tsconfig.json"), "utf8"),
    ) as { include: string[]; compilerOptions: { outDir: string; rootDir: string } };
    expect(tsconfig.compilerOptions.outDir).toBe("dist");
    expect(tsconfig.compilerOptions.rootDir).toBe(".");
    expect(tsconfig.include.some((entry) => entry.startsWith("generated/"))).toBe(true);
  });
});
