#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const USAGE = `Usage: node scripts/ci-timing-report.mjs [options]
  --repo <owner/name>   repository (default: $GITHUB_REPOSITORY or the origin remote)
  --workflow <file>     workflow file (default: ci.yml)
  --limit <n>           completed runs to analyse (default: 20)
  --event <name>        pull_request | push | all (default: all)
  --branch <name>       only runs on this head branch
  --run <id>            analyse one run (repeatable); overrides --limit
  --logs <n>            parse test logs of the newest <n> analysed runs (default: 0)
  --top <n>             slowest test files and specs to list (default: 50)
  --queue-grace <s>     queue seconds counted toward the effective time (default: 60)
  --json <path>         also write the raw measurements as JSON
  --budget <path>       compare one run (--run) with the job and total budgets in <path>;
                        writes a table to $GITHUB_STEP_SUMMARY and a warning per overrun`;

function parseArgs(argv) {
  const options = { workflow: "ci.yml", limit: 20, event: "all", runs: [], logs: 0, top: 50, queueGrace: 60 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };
    if (arg === "--repo") options.repo = next();
    else if (arg === "--workflow") options.workflow = next();
    else if (arg === "--limit") options.limit = Number(next());
    else if (arg === "--event") options.event = next();
    else if (arg === "--branch") options.branch = next();
    else if (arg === "--run") options.runs.push(next());
    else if (arg === "--logs") options.logs = Number(next());
    else if (arg === "--top") options.top = Number(next());
    else if (arg === "--queue-grace") options.queueGrace = Number(next());
    else if (arg === "--json") options.json = next();
    else if (arg === "--budget") options.budget = next();
    else if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else throw new Error(`unknown option ${arg}\n${USAGE}`);
  }
  if (!["all", "push", "pull_request"].includes(options.event)) throw new Error(`bad --event ${options.event}`);
  return options;
}

function gh(args, { raw = false } = {}) {
  const out = execFileSync("gh", ["api", ...args], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  return raw ? out : JSON.parse(out);
}

function detectRepo() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const url = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  const match = url.match(/github\.com[:/](.+?)(?:\.git)?$/);
  if (!match) throw new Error("cannot detect the repository; pass --repo");
  return match[1];
}

const seconds = (from, to) => (Date.parse(to) - Date.parse(from)) / 1000;

export function quantile(values, q) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(q * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, index))];
}

export function stepCategory(name) {
  if (/^(Set up job|Complete job)$/.test(name) || /^Post /.test(name)) return "runner";
  if (/checkout|setup-workspace|setup-node|Setup Node|pnpm\/action-setup|Install (dependencies|Chromium|WebKit)|rust toolchain|Rust dependencies/i.test(name)) return "setup";
  if (/upload/i.test(name)) return "upload";
  return "work";
}

export function jobGroup(name) {
  return name.replace(/\s*\(\d+\/\d+\)$/, "").replace(/ \d+\/\d+\)$/, ")");
}

export function summariseRun(run, jobs, queueGrace) {
  const ran = jobs.filter((job) => job.started_at && job.completed_at && job.conclusion !== "skipped");
  const verify = jobs.find((job) => job.name === "verify");
  const end = verify?.completed_at ?? run.updated_at;
  const jobRows = ran.map((job) => {
    const steps = { runner: 0, setup: 0, work: 0, upload: 0 };
    for (const step of job.steps ?? []) {
      if (!step.started_at || !step.completed_at) continue;
      steps[stepCategory(step.name)] += Math.max(0, seconds(step.started_at, step.completed_at));
    }
    return {
      name: job.name,
      group: jobGroup(job.name),
      conclusion: job.conclusion,
      attempt: job.run_attempt,
      queue: Math.max(0, seconds(job.created_at, job.started_at)),
      duration: Math.max(0, seconds(job.started_at, job.completed_at)),
      steps,
      startOffset: seconds(run.run_started_at, job.started_at),
      endOffset: seconds(run.run_started_at, job.completed_at),
    };
  });
  const scope = jobRows.find((job) => job.name === "scope");
  const verifyRow = jobRows.find((job) => job.name === "verify");
  const lanes = jobRows.filter((job) => job.name !== "scope" && job.name !== "verify");
  const critical = lanes.reduce((best, job) => (!best || job.endOffset > best.endOffset ? job : best), null);
  const grace = (queue) => Math.min(queue, queueGrace);
  const longestLane = lanes.reduce((best, job) => (!best || job.duration + grace(job.queue) > best.duration + grace(best.queue) ? job : best), null);
  const effective =
    (scope ? grace(scope.queue) + scope.duration : 0) +
    (longestLane ? grace(longestLane.queue) + longestLane.duration : 0) +
    (verifyRow ? grace(verifyRow.queue) + verifyRow.duration : 0);
  return {
    id: run.id,
    url: run.html_url,
    event: run.event,
    branch: run.head_branch,
    sha: run.head_sha,
    attempt: run.run_attempt,
    conclusion: run.conclusion,
    startedAt: run.run_started_at,
    wall: seconds(run.run_started_at, end),
    effective,
    queueTotal: jobRows.reduce((sum, job) => sum + job.queue, 0),
    maxQueue: Math.max(0, ...jobRows.map((job) => job.queue)),
    billedMinutes: jobRows.reduce((sum, job) => sum + Math.ceil(job.duration / 60), 0),
    jobMinutes: jobRows.reduce((sum, job) => sum + job.duration, 0) / 60,
    critical: critical?.name ?? null,
    longestLane: longestLane?.name ?? null,
    jobs: jobRows,
  };
}

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
const VITEST_FILE = /^\s*[✓×❯↓]\s+(?:(\S+)\s+)?(\S+\.test\.[cm]?[jt]sx?)\s+\((\d+) tests?[^)]*\)(?:\s+(\d+)ms)?/;
const PLAYWRIGHT_TEST = /^\s*[✓✘×-]\s+\d+\s+\[[^\]]+\]\s+›\s+(\S+?):\d+:\d+\s+›.*\(([\d.]+)(ms|s|m)\)\s*$/;

export function parseTestLog(text) {
  const files = new Map();
  const specs = new Map();
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(ANSI, "").replace(/^\S+Z /, "");
    const vitest = line.match(VITEST_FILE);
    if (vitest && vitest[4]) {
      const key = vitest[1] && !vitest[1].includes("/") ? `${vitest[1]} ${vitest[2]}` : vitest[2];
      files.set(key, (files.get(key) ?? 0) + Number(vitest[4]) / 1000);
      continue;
    }
    const playwright = line.match(PLAYWRIGHT_TEST);
    if (playwright) {
      const unit = playwright[3];
      const value = Number(playwright[2]) * (unit === "ms" ? 0.001 : unit === "m" ? 60 : 1);
      specs.set(playwright[1], (specs.get(playwright[1]) ?? 0) + value);
    }
  }
  return { files, specs };
}

const fmt = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  const total = Math.round(value);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

function stats(values) {
  return { median: quantile(values, 0.5), p90: quantile(values, 0.9), max: values.length ? Math.max(...values) : null };
}

function fetchRuns(repo, options) {
  if (options.runs.length > 0) return options.runs.map((id) => gh([`repos/${repo}/actions/runs/${id}`]));
  const runs = [];
  for (let page = 1; runs.length < options.limit && page <= 20; page += 1) {
    const query = new URLSearchParams({ per_page: "100", page: String(page), status: "completed" });
    if (options.event !== "all") query.set("event", options.event);
    if (options.branch) query.set("branch", options.branch);
    const batch = gh([`repos/${repo}/actions/workflows/${options.workflow}/runs?${query}`]).workflow_runs;
    if (batch.length === 0) break;
    for (const run of batch) {
      if (run.conclusion === "cancelled" || run.conclusion === "skipped") continue;
      runs.push(run);
      if (runs.length >= options.limit) break;
    }
  }
  return runs;
}

function fetchJobs(repo, runId) {
  const jobs = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = gh([`repos/${repo}/actions/runs/${runId}/jobs?filter=latest&per_page=100&page=${page}`]).jobs;
    jobs.push(...batch);
    if (batch.length < 100) break;
  }
  return jobs;
}

function renderReport(repo, options, summaries, slowest) {
  const lines = [];
  lines.push(`# CI timing: ${repo} ${options.workflow}`, "");
  lines.push(`Runs: ${summaries.length} (${summaries.map((run) => run.id).join(", ")})`, "");
  lines.push(`Wall = run_started_at to verify completed. Effective = scope + longest lane + verify, each with queue capped at ${options.queueGrace}s.`, "");
  for (const event of ["pull_request", "push"]) {
    const runs = summaries.filter((run) => run.event === event);
    if (runs.length === 0) continue;
    const wall = stats(runs.map((run) => run.wall));
    const effective = stats(runs.map((run) => run.effective));
    const queue = stats(runs.map((run) => run.maxQueue));
    lines.push(`## ${event} (${runs.length} runs)`, "");
    lines.push("| metric | median | p90 | max |", "|---|---|---|---|");
    lines.push(`| wall | ${fmt(wall.median)} | ${fmt(wall.p90)} | ${fmt(wall.max)} |`);
    lines.push(`| effective (queue <= ${options.queueGrace}s) | ${fmt(effective.median)} | ${fmt(effective.p90)} | ${fmt(effective.max)} |`);
    lines.push(`| longest single job queue | ${fmt(queue.median)} | ${fmt(queue.p90)} | ${fmt(queue.max)} |`);
    const billed = stats(runs.map((run) => run.billedMinutes));
    lines.push(`| billed job minutes per run | ${billed.median} | ${billed.p90} | ${billed.max} |`, "");
  }
  lines.push("## Runs", "", "| run | event | attempt | conclusion | wall | effective | max queue | job min | longest lane | last lane to finish |", "|---|---|---|---|---|---|---|---|---|---|");
  for (const run of summaries) {
    lines.push(`| [${run.id}](${run.url}) | ${run.event} | ${run.attempt} | ${run.conclusion} | ${fmt(run.wall)} | ${fmt(run.effective)} | ${fmt(run.maxQueue)} | ${run.jobMinutes.toFixed(0)} | ${run.longestLane} | ${run.critical} |`);
  }
  lines.push("");
  const byJob = new Map();
  for (const run of summaries) {
    for (const job of run.jobs) {
      const rows = byJob.get(job.name) ?? [];
      rows.push(job);
      byJob.set(job.name, rows);
    }
  }
  const jobOrder = [...byJob.entries()].sort((a, b) => stats(b[1].map((job) => job.duration)).median - stats(a[1].map((job) => job.duration)).median);
  lines.push("## Jobs (median over runs)", "", "| job | n | queue | runner | setup | work | upload | total | total p90 | failures |", "|---|---|---|---|---|---|---|---|---|---|");
  for (const [name, rows] of jobOrder) {
    const median = (pick) => fmt(quantile(rows.map(pick), 0.5));
    const failures = rows.filter((job) => job.conclusion !== "success").length;
    lines.push(`| ${name} | ${rows.length} | ${median((job) => job.queue)} | ${median((job) => job.steps.runner)} | ${median((job) => job.steps.setup)} | ${median((job) => job.steps.work)} | ${median((job) => job.steps.upload)} | ${median((job) => job.duration)} | ${fmt(quantile(rows.map((job) => job.duration), 0.9))} | ${failures} |`);
  }
  lines.push("");
  const groups = new Map();
  for (const [name, rows] of byJob) {
    const group = jobGroup(name);
    if (group === name) continue;
    const entry = groups.get(group) ?? [];
    entry.push([name, quantile(rows.map((job) => job.duration), 0.5)]);
    groups.set(group, entry);
  }
  if (groups.size > 0) {
    lines.push("## Shard balance (median job total)", "", "| group | fastest | slowest | spread |", "|---|---|---|---|");
    for (const [group, entries] of groups) {
      const values = entries.map(([, value]) => value);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const slowestShard = entries.find(([, value]) => value === max)[0];
      lines.push(`| ${group} | ${fmt(min)} | ${fmt(max)} (${slowestShard}) | ${fmt(max - min)} |`);
    }
    lines.push("");
  }
  const reruns = summaries.filter((run) => run.attempt > 1);
  lines.push(`Reruns: ${reruns.length} of ${summaries.length} analysed runs had run_attempt > 1 (${reruns.map((run) => `${run.id}#${run.attempt}`).join(", ") || "none"}).`, "");
  if (slowest) {
    lines.push(`## Slowest test files (max over ${slowest.runs} runs)`, "", "| file | seconds |", "|---|---|");
    for (const [file, value] of slowest.files) lines.push(`| ${file} | ${value.toFixed(1)} |`);
    lines.push("", `## Slowest Playwright spec files (max over ${slowest.runs} runs)`, "", "| spec | seconds |", "|---|---|");
    for (const [spec, value] of slowest.specs) lines.push(`| ${spec} | ${value.toFixed(1)} |`);
    lines.push("");
  }
  return lines.join("\n");
}

function collectSlowest(repo, summaries, options) {
  const files = new Map();
  const specs = new Map();
  const picked = summaries.slice(0, options.logs);
  for (const run of picked) {
    const jobs = fetchJobs(repo, run.id).filter((job) => /^(Tests|E2E|Verify Paperclip Runner|Mobile shell|Contrast gate|Docs)/.test(job.name) && job.conclusion !== "skipped");
    for (const job of jobs) {
      let text;
      try {
        text = gh(["--allow-escape-sequences", `repos/${repo}/actions/jobs/${job.id}/logs`], { raw: true });
      } catch {
        continue;
      }
      const parsed = parseTestLog(text);
      for (const [key, value] of parsed.files) files.set(key, Math.max(files.get(key) ?? 0, value));
      for (const [key, value] of parsed.specs) specs.set(key, Math.max(specs.get(key) ?? 0, value));
    }
  }
  const top = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, options.top);
  return { runs: picked.length, files: top(files), specs: top(specs), allFiles: Object.fromEntries(files), allSpecs: Object.fromEntries(specs) };
}

export function budgetFindings(summary, budgets) {
  const findings = [];
  const total = budgets.total?.[summary.event] ?? budgets.total?.default;
  if (total && summary.effective > total) findings.push({ name: "total (effective)", actual: summary.effective, budget: total });
  for (const job of summary.jobs) {
    const budget = budgets.jobs?.[job.group] ?? budgets.jobs?.[job.name];
    if (budget && job.duration > budget) findings.push({ name: job.name, actual: job.duration, budget });
  }
  return findings;
}

function reportBudget(repo, options) {
  if (options.runs.length !== 1) throw new Error("--budget needs exactly one --run");
  const budgets = JSON.parse(fs.readFileSync(options.budget, "utf8"));
  const run = gh([`repos/${repo}/actions/runs/${options.runs[0]}`]);
  const summary = summariseRun(run, fetchJobs(repo, run.id), options.queueGrace);
  const findings = budgetFindings(summary, budgets);
  const overrun = new Set(findings.map((finding) => finding.name));
  const lines = [`## CI time budget (run ${summary.id}, ${summary.event})`, ""];
  lines.push(`Wall so far ${fmt(summary.wall)}, effective ${fmt(summary.effective)} (queue counted up to ${options.queueGrace}s per job), longest job queue ${fmt(summary.maxQueue)}, ${summary.jobMinutes.toFixed(0)} job minutes.`, "");
  lines.push("| job | queue | total | budget | |", "|---|---|---|---|---|");
  for (const job of [...summary.jobs].sort((a, b) => b.duration - a.duration)) {
    const budget = budgets.jobs?.[job.group] ?? budgets.jobs?.[job.name];
    lines.push(`| ${job.name} | ${fmt(job.queue)} | ${fmt(job.duration)} | ${budget ? fmt(budget) : "-"} | ${overrun.has(job.name) ? "over" : ""} |`);
  }
  const text = lines.join("\n") + "\n";
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  else console.log(text);
  for (const finding of findings) {
    console.log(`::warning title=CI time budget::${finding.name} took ${fmt(finding.actual)}, budget ${fmt(finding.budget)}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const repo = options.repo ?? detectRepo();
  if (options.budget) {
    reportBudget(repo, options);
    return;
  }
  const runs = fetchRuns(repo, options);
  const summaries = runs.map((run) => summariseRun(run, fetchJobs(repo, run.id), options.queueGrace));
  const slowest = options.logs > 0 ? collectSlowest(repo, summaries, options) : null;
  const report = renderReport(repo, options, summaries, slowest);
  console.log(report);
  if (options.json) fs.writeFileSync(options.json, JSON.stringify({ repo, options, summaries, slowest }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
