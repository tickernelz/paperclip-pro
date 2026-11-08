import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReleasePackagePlan,
  checkConfiguration,
  findUnpublishableWorkspaceEdges,
  getReleasePackages,
} from "./release-package-map.mjs";

function pkg(name, { publishFromCi, ...deps } = {}) {
  return { name, dir: name, publishFromCi, pkg: { name, ...deps } };
}

test("release package manifest covers all public packages with explicit CI enrollment", () => {
  const packages = buildReleasePackagePlan();
  assert.ok(packages.length > 0);
  assert.ok(packages.every((pkg) => typeof pkg.publishFromCi === "boolean"));
});

test("release package list only contains CI-enrolled packages", () => {
  const enabledPackages = getReleasePackages();
  assert.ok(enabledPackages.length > 0);
  assert.ok(enabledPackages.every((pkg) => pkg.publishFromCi === true));
});

test("release package list publishes the installable channel entrypoint last", () => {
  const enabledPackages = getReleasePackages();

  assert.equal(enabledPackages.at(-1)?.name, "@tickernelz/wardmote");
  assert.ok(enabledPackages.slice(0, -1).some((pkg) => pkg.name === "@tickernelz/wardmote-server"));
});

test("release package list keeps runtime workspace dependencies ahead of consumers", () => {
  const enabledPackages = getReleasePackages();
  const publishIndexByName = new Map(enabledPackages.map((pkg, index) => [pkg.name, index]));

  for (const pkg of enabledPackages) {
    for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      for (const [dependencyName, spec] of Object.entries(pkg.pkg[section] ?? {})) {
        if (typeof spec !== "string" || !spec.startsWith("workspace:")) continue;
        const dependencyIndex = publishIndexByName.get(dependencyName);
        if (dependencyIndex === undefined) continue;

        assert.ok(
          dependencyIndex < publishIndexByName.get(pkg.name),
          `${dependencyName} must publish before ${pkg.name}`,
        );
      }
    }
  }
});

test("release surface publishes omp-local as the only agent adapter package", () => {
  const adapterPackages = buildReleasePackagePlan()
    .filter((pkg) => pkg.dir.startsWith("packages/adapters/"))
    .map((pkg) => pkg.name);
  assert.deepEqual(adapterPackages, ["@tickernelz/wardmote-adapter-omp-local"]);
});

test("release package configuration validates successfully", () => {
  assert.doesNotThrow(() => checkConfiguration());
});

test("guard flags a publishFromCi:true package depending on a publishFromCi:false package", () => {
  const problems = findUnpublishableWorkspaceEdges([
    pkg("@tickernelz/wardmote-server", {
      publishFromCi: true,
      dependencies: { "@tickernelz/wardmote-skills-catalog": "workspace:*" },
    }),
    pkg("@tickernelz/wardmote-skills-catalog", { publishFromCi: false }),
  ]);

  assert.equal(problems.length, 1);
  assert.match(problems[0], /@tickernelz\/wardmote-server/);
  assert.match(problems[0], /@tickernelz\/wardmote-skills-catalog/);
});

test("guard inspects optional and peer dependency sections too", () => {
  const problems = findUnpublishableWorkspaceEdges([
    pkg("@tickernelz/wardmote-server", {
      publishFromCi: true,
      optionalDependencies: { "@tickernelz/wardmote-opt": "workspace:^" },
      peerDependencies: { "@tickernelz/wardmote-peer": "workspace:*" },
    }),
    pkg("@tickernelz/wardmote-opt", { publishFromCi: false }),
    pkg("@tickernelz/wardmote-peer", { publishFromCi: false }),
  ]);

  assert.equal(problems.length, 2);
});

test("guard treats a workspace dep on an unknown @tickernelz package as unpublishable", () => {
  const problems = findUnpublishableWorkspaceEdges([
    pkg("@tickernelz/wardmote-server", {
      publishFromCi: true,
      dependencies: { "@tickernelz/wardmote-private-internal": "workspace:*" },
    }),
  ]);

  assert.equal(problems.length, 1);
});

test("guard allows true->true workspace edges", () => {
  const problems = findUnpublishableWorkspaceEdges([
    pkg("@tickernelz/wardmote-server", {
      publishFromCi: true,
      dependencies: { "@tickernelz/wardmote-shared": "workspace:*" },
    }),
    pkg("@tickernelz/wardmote-shared", { publishFromCi: true }),
  ]);

  assert.deepEqual(problems, []);
});

test("guard ignores non-workspace specs, non-internal deps, and edges from off-train packages", () => {
  const problems = findUnpublishableWorkspaceEdges([
    pkg("@tickernelz/wardmote-server", {
      publishFromCi: true,
      dependencies: {
        "@tickernelz/wardmote-pinned": "0.3.1",
        zod: "^3.0.0",
      },
    }),
    pkg("@tickernelz/wardmote-pinned", { publishFromCi: false }),
    pkg("@tickernelz/wardmote-offtrain", {
      publishFromCi: false,
      dependencies: { "@tickernelz/wardmote-also-off": "workspace:*" },
    }),
    pkg("@tickernelz/wardmote-also-off", { publishFromCi: false }),
  ]);

  assert.deepEqual(problems, []);
});

test("the live release manifest has no unpublishable workspace edges", () => {
  assert.deepEqual(findUnpublishableWorkspaceEdges(buildReleasePackagePlan()), []);
});
