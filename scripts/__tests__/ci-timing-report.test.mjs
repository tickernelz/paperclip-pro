import assert from "node:assert/strict";
import test from "node:test";

import { budgetFindings, parseTestLog, quantile, summariseRun } from "../ci-timing-report.mjs";

const at = (seconds) => new Date(Date.UTC(2026, 10, 8, 6, 0, 0) + seconds * 1000).toISOString().replace(".000", "");

function job(name, created, started, completed, conclusion = "success") {
  return { name, created_at: at(created), started_at: at(started), completed_at: at(completed), conclusion, run_attempt: 1, steps: [] };
}

test("parseTestLog sums vitest file durations and playwright spec durations from raw job logs", () => {
  const log = [
    "2026-11-08T07:01:51.0859320Z  \u001b[32m✓\u001b[39m  @tickernelz/paperclip-pro-server  src/__tests__/workspace-runtime.test.ts (174 tests) 136707ms",
    "2026-11-08T07:01:51.0860884Z    ✓ realizeExecutionWorkspace (69)",
    "2026-11-08T07:01:51.0862496Z      ✓ fast-forwards an unstarted reused worktree 338ms",
    "2026-11-08T07:02:00.0000000Z  × src/flaky.test.ts (3 tests | 1 failed) 2500ms",
    "2026-11-08T07:11:40.5168272Z   ✓   1 [chromium] › tests/e2e/agent-chat-sessions.spec.ts:16:1 › built chat initializes (25.3s)",
    "2026-11-08T07:11:58.8967481Z   ✓   2 [chromium] › tests/e2e/agent-chat-sessions.spec.ts:54:1 › chat first open (500ms)",
    "2026-11-08T07:12:58.8967481Z   ✘   3 [chromium] › tests/e2e/onboarding.spec.ts:9:1 › onboarding (1.5m)",
  ].join("\n");
  const { files, specs } = parseTestLog(log);
  assert.deepEqual(Object.fromEntries(files), {
    "@tickernelz/paperclip-pro-server src/__tests__/workspace-runtime.test.ts": 136.707,
    "src/flaky.test.ts": 2.5,
  });
  assert.equal(specs.get("tests/e2e/agent-chat-sessions.spec.ts").toFixed(1), "25.8");
  assert.equal(specs.get("tests/e2e/onboarding.spec.ts"), 90);
});

test("summariseRun ends at verify and caps each job queue at the grace in the effective time", () => {
  const run = { id: 1, html_url: "u", event: "pull_request", head_branch: "b", head_sha: "s", run_attempt: 1, conclusion: "success", run_started_at: at(0), updated_at: at(5000) };
  const jobs = [
    job("scope", 0, 5, 20),
    job("Tests (server 1/5)", 20, 920, 1400),
    job("Tests (server 2/5)", 20, 30, 530),
    { name: "Upgrade path", created_at: at(20), started_at: at(20), completed_at: at(20), conclusion: "skipped", steps: [] },
    job("verify", 1400, 1410, 1413),
  ];
  const summary = summariseRun(run, jobs, 60);
  assert.equal(summary.wall, 1413);
  assert.equal(summary.maxQueue, 900);
  assert.equal(summary.longestLane, "Tests (server 1/5)");
  assert.equal(summary.critical, "Tests (server 1/5)");
  assert.equal(summary.effective, 5 + 15 + 60 + 480 + 10 + 3);
  assert.equal(summary.jobs.length, 4);
});

test("budgetFindings flags jobs by shard group and the effective total by event", () => {
  const summary = {
    event: "push",
    effective: 700,
    jobs: [
      { name: "Tests (server 1/5)", group: "Tests (server)", duration: 481 },
      { name: "Tests (server 2/5)", group: "Tests (server)", duration: 480 },
      { name: "Build", group: "Build", duration: 900 },
    ],
  };
  const findings = budgetFindings(summary, { total: { default: 600, push: 720 }, jobs: { "Tests (server)": 480 } });
  assert.deepEqual(findings.map((finding) => finding.name), ["Tests (server 1/5)"]);
  assert.deepEqual(budgetFindings({ ...summary, event: "pull_request" }, { total: { default: 600 } }).map((finding) => finding.name), ["total (effective)"]);
});

test("quantile uses the nearest-rank value", () => {
  assert.equal(quantile([5, 1, 3, 2, 4], 0.5), 3);
  assert.equal(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9);
  assert.equal(quantile([], 0.5), null);
});
