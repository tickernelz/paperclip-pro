import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveCatalogPackageRoot } from "../services/teams-catalog.js";

const PACKAGE_NAME = "@tickernelz/paperclip-pro-teams-catalog";

function fakeInstall(manifestSubpath: string) {
  const root = mkdtempSync(path.join(tmpdir(), "teams-catalog-install-"));
  const serviceDir = path.join(root, "node_modules", "@tickernelz", "paperclip-pro-server", "dist", "services");
  const packageRoot = path.join(root, "node_modules", ...PACKAGE_NAME.split("/"));
  mkdirSync(serviceDir, { recursive: true });
  mkdirSync(path.dirname(path.join(packageRoot, manifestSubpath)), { recursive: true });
  writeFileSync(path.join(packageRoot, manifestSubpath), JSON.stringify({ packageName: PACKAGE_NAME, teams: [] }));
  writeFileSync(
    path.join(packageRoot, "package.json"),
    JSON.stringify({
      name: PACKAGE_NAME,
      version: "2026.926.6",
      exports: { "./catalog.json": `./${manifestSubpath}` },
    }),
  );
  return { root, serviceDir, packageRoot };
}

describe("resolveCatalogPackageRoot", () => {
  it("finds the package when it is installed under its scoped name", () => {
    const { serviceDir, packageRoot } = fakeInstall("generated/catalog.json");
    expect(
      resolveCatalogPackageRoot(pathToFileURL(path.join(serviceDir, "teams-catalog.js")).href),
    ).toBe(packageRoot);
  });

  it("finds the package when the manifest is published under dist", () => {
    const { serviceDir, packageRoot } = fakeInstall("dist/generated/catalog.json");
    expect(
      resolveCatalogPackageRoot(pathToFileURL(path.join(serviceDir, "teams-catalog.js")).href),
    ).toBe(packageRoot);
  });

  it("resolves the manifest the package itself declares, not a hardcoded path", async () => {
    const { serviceDir, packageRoot } = fakeInstall("dist/generated/catalog.json");
    const manifestPath = path.join(packageRoot, "dist", "generated", "catalog.json");
    const { createRequire } = await import("node:module");
    const from = pathToFileURL(path.join(serviceDir, "teams-catalog.js")).href;
    expect(createRequire(from).resolve(`${PACKAGE_NAME}/catalog.json`)).toBe(manifestPath);
  });

  it("lands where the old monorepo-relative candidate pointed, which has no manifest", () => {
    const { serviceDir, packageRoot } = fakeInstall("generated/catalog.json");
    const oldCandidate = path.resolve(serviceDir, "../../..", "packages/teams-catalog");
    expect(oldCandidate).toBe(path.join(serviceDir, "..", "..", "..", "packages", "teams-catalog"));
    expect(oldCandidate).not.toBe(packageRoot);
    expect(existsSync(path.join(oldCandidate, "generated/catalog.json"))).toBe(false);
  });
});
