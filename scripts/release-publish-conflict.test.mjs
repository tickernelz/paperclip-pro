import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const releaseSh = path.join(repoRoot, "scripts", "release.sh");
const releaseLib = path.join(repoRoot, "scripts", "release-lib.sh");
const NAME = "@tickernelz/example-package";
const VERSION = "1.2.3";

const STUB = `#!/bin/bash
echo "$*" >> "$CALLS_LOG"
if [ "$1" = "view" ]; then
  if [ -f "$VISIBLE" ]; then echo "$VERSION"; exit 0; fi
  exit 1
fi
if [ "$1" = "publish" ]; then
  if [ -f "$VISIBLE" ]; then echo "npm error 409 Conflict - Cannot publish over previously published version \\"$VERSION\\"" >&2; exit 1; fi
  case "$MODE" in
    staged_visible) touch "$VISIBLE"; echo "npm error 409 Conflict - Cannot publish over previously staged version \\"$VERSION\\"" >&2; exit 1 ;;
    staged_stuck) echo "npm error 409 Conflict - Cannot publish over previously staged version \\"$VERSION\\"" >&2; exit 1 ;;
    published) touch "$VISIBLE"; echo "npm error 409 Conflict - Cannot publish over previously published version \\"$VERSION\\"" >&2; exit 1 ;;
    hard_failure) echo "npm error code E404 - Not found" >&2; exit 1 ;;
  esac
  exit 0
fi
exit 0
`;

function publishFunctionSource() {
  const lines = readFileSync(releaseSh, "utf8").split("\n");
  const start = lines.findIndex((line) => line.startsWith("publish_one_tarball() {"));
  assert.ok(start >= 0, "release.sh must define publish_one_tarball");
  const end = lines.indexOf("}", start);
  assert.ok(end > start, "publish_one_tarball must close");
  return lines.slice(start, end + 1).join("\n");
}

function harness(mode) {
  const dir = mkdtempSync(path.join(tmpdir(), "release-publish-"));
  const binDir = path.join(dir, "bin");
  mkdirSync(binDir);
  const stub = path.join(binDir, "npm");
  writeFileSync(stub, STUB);
  chmodSync(stub, 0o755);
  return { dir, binDir, visible: path.join(dir, "visible"), calls: path.join(dir, "npm-calls.log"), mode };
}

function runPublish(context) {
  const script = [
    "set -u",
    "exec 2>&1",
    `source ${JSON.stringify(releaseLib)}`,
    `export PATH=${JSON.stringify(context.binDir)}:$PATH`,
    "PUBLISH_TAG=next",
    "dry_run=false",
    "provenance_available=false",
    'release_npm() { npm "$@"; }',
    publishFunctionSource(),
    `publish_one_tarball ${JSON.stringify(NAME)} ${JSON.stringify(VERSION)} /tmp/example.tgz`,
    "echo PUBLISH_RETURNED_OK",
  ].join("\n");
  return execFileSync("bash", ["-c", script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NPM_STAGED_VISIBILITY_ATTEMPTS: "3",
      NPM_STAGED_VISIBILITY_DELAY_SECONDS: "0",
      CALLS_LOG: context.calls,
      VISIBLE: context.visible,
      MODE: context.mode,
      VERSION,
    },
  });
}

function withHarness(mode, body) {
  const context = harness(mode);
  try {
    body(context);
  } finally {
    rmSync(context.dir, { recursive: true, force: true });
  }
}

test("a staged upload that becomes visible is waited for instead of aborting the set", () => {
  withHarness("staged_visible", (context) => {
    const output = runPublish(context);
    assert.match(output, /PUBLISH_RETURNED_OK/);
    assert.match(output, /staged upload that is not visible yet/);
    assert.ok(existsSync(context.visible));
  });
});

test("an already published version does not abort the remaining packages", () => {
  withHarness("published", (context) => {
    const output = runPublish(context);
    assert.match(output, /PUBLISH_RETURNED_OK/);
    assert.match(output, /already publishes/);
    assert.match(readFileSync(context.calls, "utf8"), /publish/);
  });
});

test("a staged upload that never becomes visible still fails the release", () => {
  withHarness("staged_stuck", (context) => {
    assert.throws(
      () => runPublish(context),
      (error) => {
        assert.match(String(error.stdout ?? ""), /never exposed it/);
        return true;
      },
    );
  });
});

test("any other publish failure still stops the release", () => {
  withHarness("hard_failure", (context) => {
    assert.throws(
      () => runPublish(context),
      (error) => {
        assert.match(String(error.stdout ?? ""), /npm rejected/);
        return true;
      },
    );
  });
});
