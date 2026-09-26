import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  absentDeclaredSuites,
  documentationReferences,
  docsLaneNodeTestSuites,
  docsLaneVitestSuites,
  findLiteralDocumentationReaders,
  undeclaredDocumentationReaders,
} from "../docs-lane-suites.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("every declared docs-lane suite exists", () => {
  assert.deepEqual(absentDeclaredSuites(repoRoot), []);
});

test("every test that reads a repository document is declared in the docs lane", () => {
  assert.deepEqual(undeclaredDocumentationReaders(repoRoot), []);
});

test("the docs lane declares at least one suite of each runner", () => {
  assert.ok(docsLaneVitestSuites.length > 0, "the docs lane must run at least one vitest suite");
  assert.ok(docsLaneNodeTestSuites.length > 0, "the docs lane must run at least one node:test suite");
});

test("the reader scan resolves a documented path and ignores a fixture path", () => {
  const references = documentationReferences(repoRoot, "server/src/__tests__/cli-invocation-safety.test.ts");
  assert.ok(
    references.includes("doc/CLI.md"),
    `expected the CLI guide in ${references.join(", ")}`,
  );
  assert.ok(
    references.includes("skills/paperclip/SKILL.md"),
    `expected the runtime skill in ${references.join(", ")}`,
  );
});

test("the reader scan ignores a markdown path that lives only inside a fixture", () => {
  const readers = findLiteralDocumentationReaders(repoRoot);
  assert.ok(
    !readers.vitest.includes("server/src/__tests__/file-resources.test.ts"),
    "a workspace-relative fixture path such as docs/README.md is not a repository document",
  );
  assert.ok(
    !readers.vitest.includes("server/src/__tests__/heartbeat-project-repositories.test.ts"),
    "a README.md inside a temporary git checkout is not a repository document",
  );
});
