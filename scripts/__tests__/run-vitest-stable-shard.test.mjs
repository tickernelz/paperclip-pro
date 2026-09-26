import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  defaultSuiteWeight,
  loadShardDurations,
  partitionGeneralServerSuites,
} from "../general-server-shard.mjs";

import { assertSelectedTests, partitionTestLines } from "../test-line-shard.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = path.join(repoRoot, "scripts", "run-vitest-stable.mjs");
const durationsManifest = path.join(repoRoot, "scripts", "general-server-shard-durations.json");
const serializedDurationsManifest = path.join(
  repoRoot,
  "scripts",
  "serialized-shard-durations.json",
);

// Membership of general-server-without-chat depends on GITHUB_WORKFLOW (see
// prWorkflowName in run-vitest-stable.mjs), so strip the ambient value and
// make every test pin the caller it mirrors explicitly — these tests
// themselves run inside a workflow on CI.
function workflowEnv(envOverrides = {}) {
  const env = { ...process.env, ...envOverrides };
  if (!("GITHUB_WORKFLOW" in envOverrides)) {
    delete env.GITHUB_WORKFLOW;
  }
  return env;
}

function dryRun(args, envOverrides = {}) {
  const result = spawnSync(process.execPath, [script, ...args, "--dry-run"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: workflowEnv(envOverrides),
  });
  return result;
}

function dryRunJson(args, envOverrides = {}) {
  const result = dryRun(args, envOverrides);
  assert.equal(result.status, 0, `expected success for ${args.join(" ")}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

const SHARD_COUNT = 5;
const SERIALIZED_SHARD_COUNT = 4;


test("the serialized shards form a complete, non-overlapping partition", () => {
  const shards = Array.from({ length: SERIALIZED_SHARD_COUNT }, (_, index) =>
    dryRunJson(["--mode", "serialized", "--shard-index", String(index), "--shard-count", String(SERIALIZED_SHARD_COUNT)]),
  );

  const total = shards[0].serializedSuiteCount;
  const selected = shards.flatMap((shard) => shard.selectedSerializedSuites);
  assert.equal(selected.length, total, "every serialized suite must be selected exactly once");
  assert.equal(new Set(selected).size, total, "serialized shards must not overlap");
});

test("the general-server shards form a complete, non-overlapping partition", () => {
  const shards = Array.from({ length: SHARD_COUNT }, (_, index) =>
    dryRunJson(["--mode", "general", "--group", "general-server", "--shard-index", String(index), "--shard-count", String(SHARD_COUNT)]),
  );

  const total = shards[0].generalServerSuiteCount;
  assert.ok(total > 0, "expected a non-empty general-server suite set");

  const seen = new Set();
  let selectedTotal = 0;
  for (const shard of shards) {
    assert.equal(shard.generalServerSuiteCount, total, "suite count must be stable across shards");
    for (const file of shard.selectedGeneralServerSuites) {
      assert.ok(!seen.has(file), `suite assigned to more than one shard: ${file}`);
      seen.add(file);
      selectedTotal += 1;
    }
  }

  // Every suite runs exactly once: union covers the whole set with no overlap.
  assert.equal(selectedTotal, total, "every suite must be selected exactly once");
  assert.equal(seen.size, total, "union of shards must cover the whole suite set");
});

test("a route/authz suite never leaks into the general-server shards", () => {
  const shard = dryRunJson(["--mode", "general", "--group", "general-server", "--shard-index", "0", "--shard-count", SHARD_COUNT.toString()]);
  for (const file of shard.selectedGeneralServerSuites) {
    assert.ok(
      !/[^/]*(?:route|routes|authz)[^/]*\.test\.ts$/.test(file),
      `route/authz suite must stay in the serialized lane, not general-server: ${file}`,
    );
  }
});

test("shard flags are rejected for the workspaces-b group", () => {
  const result = dryRun(["--mode", "general", "--group", "general-workspaces-b", "--shard-index", "0", "--shard-count", "3"]);
  assert.notEqual(result.status, 0, "workspaces-b must not accept shard flags");
});

test("workspaces-a shards map to Vitest native --shard slices over a stable project list", () => {
  const shards = [0, 1].map((index) =>
    dryRunJson([
      "--mode", "general", "--group", "general-workspaces-a",
      "--shard-index", String(index), "--shard-count", "2",
    ]),
  );

  assert.deepEqual(
    shards.map((shard) => shard.workspacesVitestShard),
    ["1/2", "2/2"],
    "each matrix job must pass its own --shard slice to vitest",
  );
  // Vitest's --shard partitions each project's file list deterministically, so
  // an identical project list across jobs is what guarantees complete,
  // non-overlapping coverage of the lane.
  assert.deepEqual(shards[0].workspaceProjects, shards[1].workspaceProjects);
  assert.ok(shards[0].workspaceProjects.length > 0, "workspaces-a must run at least one project");

  const unsharded = dryRunJson(["--mode", "general", "--group", "general-workspaces-a"]);
  assert.deepEqual(
    unsharded.workspaceProjects,
    shards[0].workspaceProjects,
    "sharding must not change which projects the lane covers",
  );
  assert.equal(unsharded.workspacesVitestShard, null);
});

test("duration-aware partition balances skewed weights better than round-robin", () => {
  // Round-robin puts all three heavy suites on shard 0 (indexes 0, 3, 6).
  const files = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
  const durations = { a: 30000, d: 30000, g: 30000, b: 100, c: 100, e: 100, f: 100, h: 100, i: 100 };

  const shards = partitionGeneralServerSuites(files, 3, durations);
  const totals = shards.map((shard) => shard.totalWeight);
  const maxTotal = Math.max(...totals);
  const minTotal = Math.min(...totals);
  assert.ok(
    maxTotal - minTotal <= 200,
    `expected near-even shard weights, got ${totals.join(", ")}`,
  );
  assert.equal(
    shards.flatMap((shard) => shard.files).sort().join(","),
    files.join(","),
    "partition must cover every file exactly once",
  );
});

test("the partition is deterministic for identical inputs", () => {
  const files = Array.from({ length: 50 }, (_, index) => `suite-${index}.test.ts`);
  const durations = Object.fromEntries(files.map((file, index) => [file, (index * 37) % 5000]));

  const first = partitionGeneralServerSuites(files, 3, durations);
  const second = partitionGeneralServerSuites(files, 3, durations);
  assert.deepEqual(first, second, "same inputs must always produce the same partition");
});

test("suites missing from the manifest get the median weight", () => {
  assert.equal(defaultSuiteWeight({ a: 100, b: 300, c: 900 }), 300);
  assert.equal(defaultSuiteWeight({ a: 100, b: 300, c: 500, d: 900 }), 400);
  assert.equal(defaultSuiteWeight({}), 1000, "empty manifest falls back to a fixed weight");
});

test("a missing or malformed manifest degrades to uniform weights", () => {
  assert.deepEqual(loadShardDurations(path.join(repoRoot, "scripts", "no-such-manifest.json")), {});

  const files = ["a", "b", "c", "d"];
  const shards = partitionGeneralServerSuites(files, 2, {});
  assert.equal(shards[0].files.length + shards[1].files.length, files.length);
  assert.equal(Math.abs(shards[0].files.length - shards[1].files.length), 0);
});

test("the checked-in manifest loads and covers most of the current suite set", () => {
  const durations = loadShardDurations(durationsManifest);
  assert.ok(Object.keys(durations).length > 0, "manifest must parse to a non-empty duration map");

  const shard = dryRunJson(["--mode", "general", "--group", "general-server", "--shard-index", "0", "--shard-count", "1"]);
  const currentFiles = shard.selectedGeneralServerSuites;
  const known = currentFiles.filter((file) => durations[file] !== undefined).length;
  assert.ok(
    known / currentFiles.length >= 0.5,
    `manifest is stale: only ${known} of ${currentFiles.length} suites have recorded durations — regenerate it from a recent PR run (see the manifest's $comment)`,
  );
});

test("the chat integration suite keeps a measured duration for duration-aware fallbacks", () => {
  // The PR and release matrices both run the chat suite in dedicated
  // line-sharded lanes, but the plain general-server group (local full runs)
  // still weighs it into the LPT partition; a median-fallback weight there
  // would silently overload whichever shard receives it.
  const chatSuite = "server/src/__tests__/chat-channels.integration.test.ts";
  const durations = loadShardDurations(durationsManifest);
  assert.ok(
    Number.isFinite(durations[chatSuite]),
    "the full chat cohort must have a measured duration, not the median fallback",
  );
});

test("the checked-in serialized manifest loads and covers most of the current suite set", () => {
  const durations = loadShardDurations(serializedDurationsManifest);
  assert.ok(Object.keys(durations).length > 0, "manifest must parse to a non-empty duration map");

  const shard = dryRunJson(["--mode", "serialized", "--shard-index", "0", "--shard-count", "1"]);
  const currentFiles = shard.selectedSerializedSuites;
  const known = currentFiles.filter((file) => durations[file] !== undefined).length;
  assert.ok(
    known / currentFiles.length >= 0.5,
    `manifest is stale: only ${known} of ${currentFiles.length} suites have recorded durations — regenerate it from a recent PR run (see the manifest's $comment)`,
  );
});

test("the real serialized shard partition is duration-balanced", () => {
  const durations = loadShardDurations(serializedDurationsManifest);
  const fallback = defaultSuiteWeight(durations);
  const shards = Array.from({ length: SERIALIZED_SHARD_COUNT }, (_, index) =>
    dryRunJson(["--mode", "serialized", "--shard-index", String(index), "--shard-count", String(SERIALIZED_SHARD_COUNT)]),
  );

  const totals = shards.map((shard) =>
    shard.selectedSerializedSuites.reduce((sum, file) => sum + (durations[file] ?? fallback), 0),
  );
  const maxTotal = Math.max(...totals);
  const minTotal = Math.min(...totals);
  // LPT keeps the spread within the heaviest single suite; use that as the bound.
  const heaviest = Math.max(...Object.values(durations));
  assert.ok(
    maxTotal - minTotal <= heaviest,
    `serialized shard weight spread ${maxTotal - minTotal}ms exceeds heaviest suite ${heaviest}ms: ${totals.join(", ")}`,
  );
});

test("the real shard partition is duration-balanced", () => {
  // Mirrors the CI matrix: general-server-without-chat across SHARD_COUNT
  // runners, with the chat suite carried by the dedicated general-chat lanes
  // and the native-runner suite by the Rust-cached PR vitest lane.
  const durations = loadShardDurations(durationsManifest);
  const fallback = defaultSuiteWeight(durations);
  const shards = Array.from({ length: SHARD_COUNT }, (_, index) =>
    dryRunJson(
      ["--mode", "general", "--group", "general-server-without-chat", "--shard-index", String(index), "--shard-count", String(SHARD_COUNT)],
      { GITHUB_WORKFLOW: "CI" },
    ),
  );

  const totals = shards.map((shard) =>
    shard.selectedGeneralServerSuites.reduce((sum, file) => sum + (durations[file] ?? fallback), 0),
  );
  const maxTotal = Math.max(...totals);
  const minTotal = Math.min(...totals);
  // LPT keeps the spread within the heaviest single suite; use that as the
  // bound. The chat and native-runner suites run in their own lanes, so
  // exclude them here.
  const chat = "server/src/__tests__/chat-channels.integration.test.ts";
  const nativeRunner =
    "server/src/services/native-runtime/native-codex-runner.integration.test.ts";
  const heaviest = Math.max(
    ...Object.entries(durations)
      .filter(([file]) => file !== chat && file !== nativeRunner)
      .map(([, ms]) => ms),
  );
  assert.ok(
    maxTotal - minTotal <= heaviest,
    `shard weight spread ${maxTotal - minTotal}ms exceeds heaviest suite ${heaviest}ms: ${totals.join(", ")}`,
  );
});


const chatSuitePath = "server/src/__tests__/chat-channels.integration.test.ts";
const nativeRunnerSuitePath =
  "server/src/services/native-runtime/native-codex-runner.integration.test.ts";

// Mirrors ci.yml: the chat suite runs in its dedicated lane and the
// cargo-dependent native-runner suite in the Rust-cached Verify Paperclip
// Runner vitest lane, so together the three cover the full server group.
test("the without-chat shards plus the dedicated chat and native-runner lanes cover the original server group exactly", () => {
  const ciEnv = { GITHUB_WORKFLOW: "CI" };
  const full = dryRunJson(["--mode", "general", "--group", "general-server", "--shard-index", "0", "--shard-count", "1"], ciEnv);
  const shards = Array.from({ length: SHARD_COUNT }, (_, index) => dryRunJson([
    "--mode", "general", "--group", "general-server-without-chat",
    "--shard-index", String(index), "--shard-count", String(SHARD_COUNT),
  ], ciEnv));
  const files = shards.flatMap((shard) => shard.selectedGeneralServerSuites);
  assert.ok(!files.includes(chatSuitePath));
  assert.ok(!files.includes(nativeRunnerSuitePath));
  assert.deepEqual([...files, chatSuitePath, nativeRunnerSuitePath].sort(), full.selectedGeneralServerSuites.sort());
  assert.equal(new Set(files).size, files.length);
  const defaultRun = dryRunJson([], ciEnv);
  assert.ok(defaultRun.generalServerSuiteCount === full.generalServerSuiteCount);
});

// Any caller other than ci.yml, including local runs: no Rust-cached vitest
// lane exists there, so the native-runner suite must stay in the server shards.
for (const [caller, envOverrides] of [["Release", { GITHUB_WORKFLOW: "Release" }], ["no ambient workflow", {}]]) {
  test(`10 without-chat shards under ${caller} keep the native-runner suite and cover the server group with chat alone`, () => {
    const full = dryRunJson(["--mode", "general", "--group", "general-server", "--shard-index", "0", "--shard-count", "1"], envOverrides);
    const shards = Array.from({ length: 10 }, (_, index) => dryRunJson([
      "--mode", "general", "--group", "general-server-without-chat",
      "--shard-index", String(index), "--shard-count", "10",
    ], envOverrides));
    const files = shards.flatMap((shard) => shard.selectedGeneralServerSuites);
    assert.ok(!files.includes(chatSuitePath));
    assert.ok(files.includes(nativeRunnerSuitePath));
    assert.deepEqual([...files, chatSuitePath].sort(), full.selectedGeneralServerSuites.sort());
    assert.equal(new Set(files).size, files.length);
  });
}

test("the native-runner lane runs exactly the cargo-dependent vertical-slice suite", () => {
  const lane = dryRunJson(["--mode", "general", "--group", "general-server-native-runner"]);
  assert.deepEqual(lane.selectedGeneralServerSuites, [
    "server/src/services/native-runtime/native-codex-runner.integration.test.ts",
  ]);
});

test("shard flags are rejected for the native-runner group", () => {
  const result = dryRun(["--mode", "general", "--group", "general-server-native-runner", "--shard-index", "0", "--shard-count", "2"]);
  assert.notEqual(result.status, 0, "the native-runner lane is a single suite and must not accept shard flags");
});

test("the docs mode reports the documentation-reading suites and nothing else", () => {
  const docs = dryRunJson(["--mode", "docs"]);
  assert.ok(docs.docsLaneVitestSuites.length > 0, "the docs mode must report its vitest suites");
  assert.ok(docs.docsLaneNodeTestSuites.length > 0, "the docs mode must report its node:test suites");
  assert.equal(docs.selectedGeneralServerSuites, null, "the docs mode must not select general-server suites");
  assert.equal(docs.selectedSerializedSuites.length, docs.serializedSuiteCount,
    "the docs mode must not select a serialized shard");

  const other = dryRunJson([]);
  assert.equal(other.docsLaneVitestSuites, null, "only the docs mode reports the docs lane suites");
});

test("the docs mode rejects shard flags and an unknown group", () => {
  assert.notEqual(dryRun(["--mode", "docs", "--shard-index", "0", "--shard-count", "2"]).status, 0);
  assert.notEqual(dryRun(["--mode", "docs", "--group", "general-chat"]).status, 0);
});

const laneWrapper = path.join(repoRoot, "packages/paperclip-runner/scripts/run-pr-vitest-lane.mjs");

function wrapperPlan(args, envOverrides = {}) {
  const result = spawnSync(process.execPath, [laneWrapper, ...args, "--dry-run"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: workflowEnv(envOverrides),
  });
  assert.equal(result.status, 0, `expected wrapper dry run to succeed for ${args.join(" ")}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

test("the vitest lane wrapper runs the native-runner group exactly on the final shard", () => {
  for (const [args, envOverrides, expected] of [
    [["--shard=1/2"], { GITHUB_WORKFLOW: "CI" }, false],
    [["--shard=2/2"], { GITHUB_WORKFLOW: "CI" }, true],
    [[], { GITHUB_WORKFLOW: "CI" }, true],
    [["--shard=2/2"], { GITHUB_WORKFLOW: "Release" }, false],
    [["--shard=2/2"], {}, false],
    [[], {}, false],
  ]) {
    const plan = wrapperPlan(args, envOverrides);
    assert.equal(plan.runNativeRunnerGroup, expected,
      `args ${JSON.stringify(args)} env ${JSON.stringify(envOverrides)}`);
    const commands = plan.plannedCommands.map((planned) => planned.args.join(" "));
    assert.ok(commands.some((command) => command.startsWith(`exec vitest run${args.length ? ` ${args.join(" ")}` : ""}`)),
      "the wrapper must pass shard flags through to vitest");
    assert.equal(
      commands.some((command) => command.includes("--group general-server-native-runner")),
      expected,
    );
  }

  const malformed = spawnSync(process.execPath, [laneWrapper, "--shard=nonsense", "--dry-run"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: workflowEnv({ GITHUB_WORKFLOW: "CI" }),
  });
  assert.notEqual(malformed.status, 0, "a malformed shard flag must fail rather than guess a lane");
});

const lineShardFile = path.join(repoRoot, "server/src/__tests__/chat-channels.integration.test.ts");
const caseAt = (line, name) => ({ name, file: lineShardFile, projectName: "@tickernelz/paperclip-pro-server", location: { line, column: 3 } });

test("test-line shards cover nested and parameterized cases exactly once without splitting a source line", () => {
  const cases = [caseAt(10, "suite > nested > first"), caseAt(10, "suite > nested > second"),
    caseAt(20, "same name"), caseAt(30, "same name"), caseAt(40, "last"), caseAt(50, "new case")];
  const shards = partitionTestLines(cases, 3, lineShardFile);
  assert.deepEqual(shards.map((shard) => shard.tests.length), [2, 2, 2]);
  assert.equal(shards.filter((shard) => shard.lines.includes(10)).length, 1);
  assert.equal(shards.find((shard) => shard.lines.includes(10)).tests.length, 2);
  assert.equal(shards.flatMap((shard) => shard.lines).length, 5);
  assert.deepEqual(shards.flatMap((shard) => shard.tests).sort((a, b) => a.location.line - b.location.line), cases);
  assert.deepEqual(partitionTestLines([...cases].reverse(), 3, lineShardFile).map((shard) => shard.lines), shards.map((shard) => shard.lines));
});

test("line-shard collection rejects empty, foreign, or unlocated tests and invalid shard counts", () => {
  const good = caseAt(10, "valid");
  for (const input of [[], null, [{ ...good, file: "/another.test.ts" }], [{ ...good, projectName: "wrong" }],
    [{ ...good, location: undefined }], [{ ...good, location: { line: 0 } }], [{ ...good, name: "" }]]) {
    assert.throws(() => partitionTestLines(input, 1, lineShardFile));
  }
  for (const count of [0, -1, 1.5, Infinity, 2]) assert.throws(() => partitionTestLines([good], count, lineShardFile));
});

test("filtered collection must match the exact assigned case identities, including duplicates", () => {
  const expected = [caseAt(10, "same"), caseAt(10, "same"), caseAt(20, "nested > case")];
  assertSelectedTests(expected, [...expected].reverse(), lineShardFile);
  for (const actual of [expected.slice(1), [...expected, caseAt(30, "extra")],
    [expected[0], expected[1], caseAt(20, "renamed")],
    [expected[0], expected[1], caseAt(21, "nested > case")]]) {
    assert.throws(() => assertSelectedTests(expected, actual, lineShardFile));
  }
});
