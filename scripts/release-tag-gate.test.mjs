import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const gateScript = new URL("./release-tag-gate.sh", import.meta.url).pathname;

function writeExecutable(path, body) {
  writeFileSync(path, body, { mode: 0o755 });
}

function runGate(args, { ancestor = true, mainRefExists = true, ghOutputs = [], env = {} } = {}) {
  const fixtureDir = mkdtempSync(join(tmpdir(), "paperclip-tag-gate-"));
  const binDir = join(fixtureDir, "bin");
  mkdirSync(binDir);

  writeExecutable(
    join(binDir, "git"),
    `#!/usr/bin/env bash
case " $* " in
  *" merge-base --is-ancestor "*)
    [ "$FAKE_ANCESTOR" = "true" ] && exit 0
    exit 1
    ;;
  *" rev-parse "*)
    [ "$FAKE_MAIN_REF_EXISTS" = "true" ] && exit 0
    exit 1
    ;;
esac
exit 0
`,
  );

  writeExecutable(
    join(binDir, "gh"),
    `#!/usr/bin/env bash
count=0
if [ -f "$FAKE_GH_COUNTER" ]; then
  count="$(cat "$FAKE_GH_COUNTER")"
fi
next=$((count + 1))
printf '%s' "$next" > "$FAKE_GH_COUNTER"
payload="$FAKE_GH_OUTPUT_DIR/$next"
if [ ! -f "$payload" ]; then
  payload="$FAKE_GH_OUTPUT_DIR/last"
fi
cat "$payload"
`,
  );

  const outputsDir = join(fixtureDir, "gh-outputs");
  mkdirSync(outputsDir);
  ghOutputs.forEach((payload, index) => {
    writeFileSync(join(outputsDir, String(index + 1)), payload);
  });
  writeFileSync(join(outputsDir, "last"), ghOutputs.at(-1) ?? "");

  return spawnSync("bash", [gateScript, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      FAKE_ANCESTOR: String(ancestor),
      FAKE_MAIN_REF_EXISTS: String(mainRefExists),
      FAKE_GH_COUNTER: join(fixtureDir, "gh-calls"),
      FAKE_GH_OUTPUT_DIR: outputsDir,
      RELEASE_CI_POLL_DELAY_SECONDS: "0",
      ...env,
    },
  });
}

test("version-from-tag accepts a calendar tag", () => {
  const result = runGate(["version-from-tag", "v2026.925.3"]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "2026.925.3");
});

test("version-from-tag rejects a non-calendar tag", () => {
  const result = runGate(["version-from-tag", "v2026.9.3"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not carry a YYYY\.MDD\.P calendar version/);
});

test("version-from-tag rejects a tag without the v prefix", () => {
  const result = runGate(["version-from-tag", "2026.925.3"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must start with 'v'/);
});

test("require-main-ancestor accepts a commit reachable from origin/main", () => {
  const result = runGate(["require-main-ancestor", "abc123"], { ancestor: true });
  assert.equal(result.status, 0);
});

test("require-main-ancestor rejects a commit outside origin/main", () => {
  const result = runGate(["require-main-ancestor", "abc123"], { ancestor: false });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not reachable from origin\/main/);
});

test("require-main-ancestor rejects a shallow checkout without origin/main", () => {
  const result = runGate(["require-main-ancestor", "abc123"], { mainRefExists: false });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /fetch-depth 0/);
});

test("require-green-ci accepts a completed successful run", () => {
  const result = runGate(["require-green-ci", "tickernelz/paperclip-pro", "abc123"], {
    ghOutputs: ["completed success\n"],
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /ci\.yml succeeded for abc123/);
});

test("require-green-ci rejects a completed failing run without polling", () => {
  const result = runGate(["require-green-ci", "tickernelz/paperclip-pro", "abc123"], {
    ghOutputs: ["completed failure\n"],
    env: { RELEASE_CI_POLL_ATTEMPTS: "5" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /did not succeed for abc123/);
  assert.doesNotMatch(result.stdout, /waiting for ci\.yml/);
});

test("require-green-ci waits for a running run and accepts it when it turns green", () => {
  const result = runGate(["require-green-ci", "tickernelz/paperclip-pro", "abc123"], {
    ghOutputs: ["in_progress null\n", "completed success\n"],
    env: { RELEASE_CI_POLL_ATTEMPTS: "3" },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /waiting for ci\.yml on abc123 \(check 1\/3\)/);
});

test("require-green-ci fails once the bounded poll is exhausted", () => {
  const result = runGate(["require-green-ci", "tickernelz/paperclip-pro", "abc123"], {
    ghOutputs: ["queued null\n"],
    env: { RELEASE_CI_POLL_ATTEMPTS: "2" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /still running for abc123 after 2 checks/);
});

test("require-green-ci fails when no run exists for the commit", () => {
  const result = runGate(["require-green-ci", "tickernelz/paperclip-pro", "abc123"], {
    ghOutputs: [""],
    env: { RELEASE_CI_POLL_ATTEMPTS: "1" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no ci\.yml run exists for abc123/);
});

test("resolve reads the version from the tag on a push", () => {
  const result = runGate(["resolve"], {
    env: { EVENT_NAME: "push", TAG_NAME: "v2026.925.3", INPUT_DRY_RUN: "true", INPUT_AUTH: "oidc" },
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "version=2026.925.3\ndry_run=false\nauth=token\n");
});

test("resolve fails a push whose tag is not a calendar version", () => {
  const result = runGate(["resolve"], { env: { EVENT_NAME: "push", TAG_NAME: "v1.2.3" } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not carry a YYYY\.MDD\.P calendar version/);
});

test("resolve keeps the dispatch inputs", () => {
  const result = runGate(["resolve"], {
    env: {
      EVENT_NAME: "workflow_dispatch",
      INPUT_VERSION: "2026.926.1",
      INPUT_DRY_RUN: "true",
      INPUT_AUTH: "oidc",
    },
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "version=2026.926.1\ndry_run=true\nauth=oidc\n");
});

test("resolve defaults an empty dispatch to a token publish", () => {
  const result = runGate(["resolve"], { env: { EVENT_NAME: "workflow_dispatch" } });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "version=\ndry_run=false\nauth=token\n");
});
