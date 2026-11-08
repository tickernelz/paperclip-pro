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

const PROMOTE_STUB = `#!/bin/bash
if [ "$1" = "view" ]; then echo "1.2.2"; exit 0; fi
if [ "$1" = "dist-tag" ]; then
  token="$(cat "\${NPM_CONFIG_USERCONFIG:-/nonexistent}" 2>/dev/null)"
  echo "$*|oidc=\${ACTIONS_ID_TOKEN_REQUEST_URL:-}|userconfig=\${NPM_CONFIG_USERCONFIG:-}|token=$token" >> "$CALLS_LOG"
  if [ -n "\${ACTIONS_ID_TOKEN_REQUEST_URL:-}" ] && [ "$MODE" = "refuse_oidc" ]; then
    echo "npm error 403 Forbidden - dist-tag not allowed for this trusted publisher" >&2; exit 1
  fi
  exit 0
fi
exit 0
`;

function shellFunction(name) {
  const lines = readFileSync(releaseSh, "utf8").split("\n");
  const start = lines.findIndex((line) => line.startsWith(`${name}() {`));
  assert.ok(start >= 0, `release.sh must define ${name}`);
  const end = lines.indexOf("}", start);
  return lines.slice(start, end + 1).join("\n");
}


function runPromote({ mode, nodeAuthToken }) {
  const dir = mkdtempSync(path.join(tmpdir(), "release-promote-"));
  const binDir = path.join(dir, "bin");
  mkdirSync(binDir);
  writeFileSync(path.join(binDir, "npm"), PROMOTE_STUB);
  chmodSync(path.join(binDir, "npm"), 0o755);
  const calls = path.join(dir, "npm-calls.log");
  const script = [
    "set -u",
    "exec 2>&1",
    `source ${JSON.stringify(releaseLib)}`,
    `export PATH=${JSON.stringify(binDir)}:$PATH`,
    "PROMOTE_TAG=latest",
    "dry_run=false",
    shellFunction("promote_to_latest"),
    `promote_to_latest "$(printf 'pkg\\t%s\\t%s' ${JSON.stringify(NAME)} ${JSON.stringify(VERSION)})"`,
    "echo PROMOTE_RETURNED_OK",
  ].join("\n");
  const env = { ...process.env, CALLS_LOG: calls, MODE: mode, ACTIONS_ID_TOKEN_REQUEST_URL: "https://oidc.example", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "id-token" };
  if (nodeAuthToken) env.NODE_AUTH_TOKEN = nodeAuthToken;
  else delete env.NODE_AUTH_TOKEN;
  delete env.NPM_CONFIG_USERCONFIG;
  let output;
  let status = 0;
  try {
    output = execFileSync("bash", ["-c", script], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env });
  } catch (error) {
    status = error.status;
    output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
  const log = existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : [];
  rmSync(dir, { recursive: true, force: true });
  return { status, output, log };
}

test("promote_to_latest moves the tag over OIDC", () => {
  const result = runPromote({ mode: "accept_oidc" });
  assert.equal(result.status, 0, result.output);
  assert.equal(result.log.length, 1);
  assert.match(result.log[0], /\|oidc=https:\/\/oidc\.example\|userconfig=\|token=$/);
});

test("promote_to_latest fails a refused OIDC dist-tag and points at a token rerun", () => {
  const result = runPromote({ mode: "refuse_oidc" });
  assert.equal(result.status, 1);
  assert.match(result.output, /enable "Allow npm dist-tag" on its trusted publisher, or rerun this version with auth=token/);
  assert.equal(result.log.length, 1);
});

test("promote_to_latest in token mode moves the tag without the OIDC identity overriding the token", () => {
  const result = runPromote({ mode: "refuse_oidc", nodeAuthToken: "classic-token" });
  assert.equal(result.status, 0, result.output);
  assert.equal(result.log.length, 1);
  assert.match(result.log[0], /^dist-tag add @tickernelz\/example-package@1\.2\.3 latest\|oidc=\|/);
});
