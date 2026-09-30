#!/usr/bin/env node
import { createReadStream, existsSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";

const DEFAULT_DATABASE_URL = "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";
const REPEAT_STREAK_MIN = 3;
const UPDATE_CHUNK_MARKER = '"chunk":"{\\"type\\":\\"message_update\\"';
const WHOLE_LINE_CHUNK_END = /\\n"(?:,"seq":\d+)?}$/;

export function createFrameParser() {
  let buffer = "";
  return {
    push(chunk) {
      buffer += chunk;
      const frames = [];
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line.startsWith("{")) continue;
        try {
          const frame = JSON.parse(line);
          if (frame && typeof frame.type === "string") frames.push(frame);
        } catch {
          continue;
        }
      }
      return frames;
    },
    get pending() {
      return buffer.length > 0;
    },
  };
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function callKey(toolName, args) {
  const rest = { ...(args ?? {}) };
  delete rest.i;
  delete rest.intent;
  return `${toolName}:${stableStringify(rest)}`;
}

export function resultText(result) {
  if (!result) return "";
  if (typeof result === "string") return result;
  const content = Array.isArray(result.content) ? result.content : [];
  return content
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("\n");
}

export function normalizePath(value) {
  return value
    .replace(/\?.*$/, "")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/\b[A-Z]{2,8}-\d+\b/g, ":id");
}

const REDACTED = "[REDACTED]";
const SECRET_NAME = "[A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASS|KEY|AUTH|CREDENTIAL)[A-Za-z0-9_]*";
const SECRET_ASSIGNMENT_RE = new RegExp(`\\b(${SECRET_NAME})=(?:\\\\?"[^"\\\\]*\\\\?"|'[^']*'|[^\\s'"\\\\;&|]+)`, "gi");
const SECRET_JSON_FIELD_RE = new RegExp(`((?:\\\\)?"${SECRET_NAME}(?:\\\\)?"\\s*:\\s*)(?:\\\\)?"(?:[^"\\\\]|\\\\[^"])*(?:\\\\)?"`, "gi");
const SECRET_HEADER_RE = /\b(X-[A-Za-z0-9-]*(?:TOKEN|SECRET|PASSWORD|PASS|KEY|AUTH|CREDENTIAL)[A-Za-z0-9-]*|(?:Proxy-)?Authorization|Cookie)(\s*:\s*)(?!(?:Bearer|Basic)\s)[^\s'"\\,}]+/gi;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function looksHighEntropy(run) {
  if (UUID_RE.test(run)) return false;
  return run.split(/[/=-]+/).some(
    (chunk) =>
      /^[0-9a-f]{32,}$/i.test(chunk) ||
      (chunk.length >= 20 && /[A-Z]/.test(chunk) && /[a-z]/.test(chunk) && /\d/.test(chunk)),
  );
}

export function scrubSecrets(text) {
  return String(text ?? "")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED}`)
    .replace(SECRET_HEADER_RE, `$1$2${REDACTED}`)
    .replace(SECRET_ASSIGNMENT_RE, `$1=${REDACTED}`)
    .replace(SECRET_JSON_FIELD_RE, `$1"${REDACTED}"`)
    .replace(/(--password[= ])[^\s'"\\]+/gi, `$1${REDACTED}`)
    .replace(/\bpcp_[A-Za-z0-9_]{6,}/g, REDACTED)
    .replace(/[A-Za-z0-9_\-+/=]{32,}/g, (run) => (looksHighEntropy(run) ? REDACTED : run));
}

function scrubVolatile(line) {
  return scrubSecrets(line)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/\b[A-Z]{2,8}-\d+\b/g, "<issue>")
    .replace(/\bbg_\d+\b/g, "bg_<n>")
    .replace(/(?:~|\.{1,2})?(?:\/[\w.@%+:-]+){2,}\/?/g, "<path>")
    .replace(/\b[0-9a-f]{12,64}\b/gi, "<hex>")
    .replace(/\b\d{4,}\b/g, "<n>")
    .replace(/\d+(?:\.\d+)?\s*(ms|s|seconds)\b/g, "<n>$1")
    .replace(/"(?:[^"\\]|\\.){40,}"/g, '"<str>"')
    .replace(/\s+/g, " ")
    .slice(0, 160);
}

export function normalizeErrorMessage(text) {
  const source = String(text ?? "");
  const api = parseApiError(source);
  if (api) return `HTTP ${api.status} ${api.method} ${api.route}: ${api.code}`;
  const lines = source
    .replace(/^\s*Error:\s*/, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^Wall time:/.test(line));
  const exitCode = /Command exited with code (\d+)/.exec(source)?.[1];
  const meaningful = lines.filter((line) => !/^Command exited with code \d+$/.test(line));
  let headline = meaningful[0] ?? "";
  if (/^Traceback \(most recent call last\)/.test(headline)) {
    headline = [...meaningful].reverse().find((line) => /^[\w.]+(Error|Exception|Exit|Interrupt)\b/.test(line)) ?? headline;
  }
  const scrubbed = scrubVolatile(headline);
  return exitCode ? `[exit ${exitCode}] ${scrubbed}` : scrubbed;
}

export function parseApiError(text) {
  const source = String(text ?? "").replace(/^\s*Error:\s*/, "");
  let payload = null;
  if (source.trimStart().startsWith("{")) {
    try {
      payload = JSON.parse(source);
    } catch {
      payload = null;
    }
  }
  const headline = typeof payload?.error === "string" ? payload.error : source;
  const match = /\b([A-Z]+)\s+(\S+)\s+failed with (\d{3}):\s*([^\n"]*)/.exec(headline);
  if (!match) return null;
  const status = Number(payload?.status ?? match[3]);
  const method = scrubSecrets(payload?.method ?? match[1]);
  const route = normalizePath(payload?.path ?? match[2]);
  const bodyError = payload?.body && typeof payload.body === "object" ? payload.body : {};
  const message = typeof bodyError.error === "string" ? bodyError.error : match[4];
  const explicitCode = typeof bodyError.code === "string" ? bodyError.code : null;
  const prefixCode = /^([a-z][a-z0-9_]+):\s/.exec(message)?.[1] ?? null;
  const code = explicitCode ?? prefixCode ?? scrubVolatile(message).slice(0, 100);
  return { status, method, route: scrubSecrets(route), code: scrubSecrets(code) };
}

export function isEmptyReady(ready) {
  if (ready === undefined || ready === null) return false;
  if (typeof ready !== "object") return false;
  return Object.values(ready).every((value) => value === undefined || value === null || value === "" || value === 0);
}

export function extractKillTargets(args) {
  const targets = [];
  for (const value of Object.values(args ?? {})) {
    if (typeof value !== "string") continue;
    for (const match of value.matchAll(/proc:\/\/([^\s/"']+)\/kill\b/g)) targets.push(match[1]);
  }
  return targets;
}

export function extractAsyncTimeouts(text, details) {
  const timedOut = new Map();
  const blocks = String(text ?? "").split(/(?=###\s)|(?=Background job )/);
  for (const block of blocks) {
    const id = /(?:###\s|Background job )(bg_\d+|[\w.-]+)/.exec(block)?.[1];
    const seconds = /Command timed out after (\d+) seconds/.exec(block)?.[1];
    if (id && seconds) timedOut.set(id, Number(seconds));
  }
  const jobs = Array.isArray(details?.jobs) ? details.jobs : [];
  for (const job of jobs) {
    const seconds = /Command timed out after (\d+) seconds/.exec(String(job?.errorText ?? ""))?.[1];
    if (job?.id && seconds) timedOut.set(String(job.id), Number(seconds));
  }
  return timedOut;
}

function normalizeCommand(command) {
  return String(command ?? "").replace(/\s+/g, " ").trim();
}

export function createRunAnalyzer() {
  const stats = {
    toolCalls: 0,
    toolsByName: new Map(),
    toolErrors: 0,
    errorMessages: new Map(),
    repeatedStreaks: [],
    repeatedExtraCalls: 0,
    asyncBash: 0,
    asyncWithTimeout: 0,
    asyncWithoutTimeout: 0,
    asyncEmptyReady: 0,
    serviceModeRejects: 0,
    asyncTimedOut: new Map(),
    relaunches: 0,
    relaunchedCommands: new Map(),
    killCalls: 0,
    apiErrors: new Map(),
    models: new Map(),
    assistantMessages: 0,
  };
  const startsById = new Map();
  const asyncLaunches = new Map();
  let streakKey = null;
  let streakTool = null;
  let streakLength = 0;

  function closeStreak() {
    if (streakLength >= REPEAT_STREAK_MIN) {
      stats.repeatedStreaks.push({ tool: streakTool, key: scrubSecrets(streakKey), length: streakLength });
      stats.repeatedExtraCalls += streakLength - 1;
    }
  }

  function onStart(frame) {
    const toolName = String(frame.toolName ?? "unknown");
    const args = frame.args && typeof frame.args === "object" ? frame.args : {};
    stats.toolCalls += 1;
    stats.toolsByName.set(toolName, (stats.toolsByName.get(toolName) ?? 0) + 1);
    startsById.set(frame.toolCallId, { toolName, args });
    const key = callKey(toolName, args);
    if (key === streakKey) {
      streakLength += 1;
    } else {
      closeStreak();
      streakKey = key;
      streakTool = toolName;
      streakLength = 1;
    }
    stats.killCalls += extractKillTargets(args).length;
    if (toolName === "bash") {
      const named = typeof args.name === "string" && args.name.trim().length > 0;
      const background = args.async === true || named;
      if (args.async === true) {
        stats.asyncBash += 1;
        if (args.timeout !== undefined && args.timeout !== null) stats.asyncWithTimeout += 1;
        else stats.asyncWithoutTimeout += 1;
        if (isEmptyReady(args.ready)) stats.asyncEmptyReady += 1;
      }
      if (background) {
        const command = normalizeCommand(args.command);
        const seen = asyncLaunches.get(command) ?? 0;
        if (seen > 0) {
          stats.relaunches += 1;
          stats.relaunchedCommands.set(scrubSecrets(command), seen + 1);
        }
        asyncLaunches.set(command, seen + 1);
      }
    }
  }

  function onEnd(frame) {
    const text = resultText(frame.result);
    for (const [id, seconds] of extractAsyncTimeouts(text, frame.result?.details)) stats.asyncTimedOut.set(id, seconds);
    if (!frame.isError) return;
    const start = startsById.get(frame.toolCallId);
    const toolName = String(frame.toolName ?? start?.toolName ?? "unknown");
    const xdevTool = frame.result?.details?.xdev?.tool;
    const label = xdevTool ? `${toolName}→${xdevTool}` : toolName;
    stats.toolErrors += 1;
    if (/Service mode does not accept async or timeout/.test(text)) stats.serviceModeRejects += 1;
    const message = normalizeErrorMessage(text) || "(empty error)";
    const errorKey = `${label}\u0000${message}`;
    stats.errorMessages.set(errorKey, (stats.errorMessages.get(errorKey) ?? 0) + 1);
    const api = parseApiError(text);
    if (api && (api.status === 409 || api.status === 422)) {
      const apiKey = `${api.status}\u0000${api.method} ${api.route}\u0000${api.code}`;
      stats.apiErrors.set(apiKey, (stats.apiErrors.get(apiKey) ?? 0) + 1);
    }
  }

  function onMessageEnd(frame) {
    const message = frame.message;
    if (message?.role === "assistant") {
      stats.assistantMessages += 1;
      const model = message.model ? `${message.provider ? `${message.provider}/` : ""}${message.model}` : null;
      if (model) stats.models.set(model, (stats.models.get(model) ?? 0) + 1);
    }
    if (message?.role === "custom" && message.customType === "async-result") {
      const content = typeof message.content === "string" ? message.content : resultText(message);
      for (const [id, seconds] of extractAsyncTimeouts(content, message.details?.meta)) stats.asyncTimedOut.set(id, seconds);
    }
  }

  return {
    frame(frame) {
      if (frame.type === "tool_execution_start") onStart(frame);
      else if (frame.type === "tool_execution_end") onEnd(frame);
      else if (frame.type === "message_end") onMessageEnd(frame);
    },
    finish() {
      closeStreak();
      streakKey = null;
      streakLength = 0;
      return stats;
    },
  };
}

export async function analyzeRunLog(filePath, { compressed = false } = {}) {
  const analyzer = createRunAnalyzer();
  const parser = createFrameParser();
  const input = createReadStream(filePath);
  const stream = compressed ? input.pipe(createGunzip()) : input;
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    if (!parser.pending && line.includes(UPDATE_CHUNK_MARKER) && WHOLE_LINE_CHUNK_END.test(line)) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record?.stream !== "stdout" || typeof record.chunk !== "string") continue;
    for (const frame of parser.push(record.chunk)) analyzer.frame(frame);
  }
  return analyzer.finish();
}

function parseArgs(argv) {
  const options = { hours: 24, since: null, until: null, json: false, logsDir: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      index += 1;
      return value;
    };
    if (arg === "--json") options.json = true;
    else if (arg === "--hours") options.hours = Number(next());
    else if (arg === "--since") options.since = next();
    else if (arg === "--until") options.until = next();
    else if (arg === "--logs-dir") options.logsDir = next();
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isFinite(options.hours) || options.hours <= 0) throw new Error("--hours must be a positive number");
  return options;
}

function resolveLogsDir(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.RUN_LOG_BASE_PATH?.trim()) return path.resolve(process.env.RUN_LOG_BASE_PATH.trim());
  const home = process.env.PAPERCLIP_HOME?.trim()
    ? path.resolve(process.env.PAPERCLIP_HOME.trim().replace(/^~(?=\/|$)/, os.homedir()))
    : path.resolve(os.homedir(), ".paperclip-pro");
  const instance = process.env.PAPERCLIP_INSTANCE_ID?.trim() || "default";
  return path.resolve(home, "instances", instance, "data", "run-logs");
}

async function loadDatabase(since, until) {
  const requireFromDb = createRequire(new URL("../packages/db/package.json", import.meta.url));
  const postgres = requireFromDb("postgres");
  const sql = postgres(process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL, {
    max: 1,
    onnotice: () => {},
    connection: { default_transaction_read_only: "on", application_name: "agent-efficiency-report" },
  });
  try {
    return await sql.begin("read only", async (tx) => {
      const runs = await tx`
        select r.id, r.agent_id, a.name as agent_name, a.adapter_type,
               a.adapter_config->>'model' as config_model, r.status, r.error_code,
               r.created_at, r.log_store, r.log_ref, r.log_compressed,
               r.context_snapshot->>'issueId' as issue_id, i.identifier as issue_identifier
        from heartbeat_runs r
        join agents a on a.id = r.agent_id
        left join issues i on i.id::text = r.context_snapshot->>'issueId'
        where r.created_at >= ${since} and r.created_at < ${until}
        order by r.created_at`;
      const createdIssues = await tx`
        select c.id, c.identifier, c.title, c.created_at, c.parent_id, c.created_by_agent_id,
               a.name as agent_name, a.adapter_config->>'model' as config_model, c.origin_run_id,
               src.identifier as source_identifier, src.id as source_id,
               (src.conversation_agent_id is not null) as source_is_conversation
        from issues c
        join agents a on a.id = c.created_by_agent_id
        left join heartbeat_runs r on r.id::text = c.origin_run_id
        left join issues src on src.id::text = r.context_snapshot->>'issueId'
        where c.created_at >= ${since} and c.created_at < ${until}
        order by c.created_at`;
      return { runs, createdIssues };
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function emptyBucket(label) {
  return {
    label,
    runs: 0,
    runsWithLog: 0,
    toolCalls: 0,
    toolErrors: 0,
    errorMessages: new Map(),
    repeatedStreaks: 0,
    repeatedExtraCalls: 0,
    asyncBash: 0,
    asyncWithTimeout: 0,
    asyncWithoutTimeout: 0,
    asyncEmptyReady: 0,
    serviceModeRejects: 0,
    asyncTimedOut: 0,
    relaunches: 0,
    killCalls: 0,
    loopRuns: 0,
    api409: 0,
    api422: 0,
    apiErrors: new Map(),
    agentIssuesCreated: 0,
    parentlessWhileOnOther: 0,
  };
}

function addCount(map, key, value) {
  map.set(key, (map.get(key) ?? 0) + value);
}

function mergeRun(bucket, stats) {
  bucket.runsWithLog += 1;
  bucket.toolCalls += stats.toolCalls;
  bucket.toolErrors += stats.toolErrors;
  for (const [key, count] of stats.errorMessages) addCount(bucket.errorMessages, key, count);
  bucket.repeatedStreaks += stats.repeatedStreaks.length;
  bucket.repeatedExtraCalls += stats.repeatedExtraCalls;
  bucket.asyncBash += stats.asyncBash;
  bucket.asyncWithTimeout += stats.asyncWithTimeout;
  bucket.asyncWithoutTimeout += stats.asyncWithoutTimeout;
  bucket.asyncEmptyReady += stats.asyncEmptyReady;
  bucket.serviceModeRejects += stats.serviceModeRejects;
  bucket.asyncTimedOut += stats.asyncTimedOut.size;
  bucket.relaunches += stats.relaunches;
  bucket.killCalls += stats.killCalls;
  if (isLoopRun(stats)) bucket.loopRuns += 1;
  for (const [key, count] of stats.apiErrors) {
    addCount(bucket.apiErrors, key, count);
    if (key.startsWith("409")) bucket.api409 += count;
    if (key.startsWith("422")) bucket.api422 += count;
  }
}

export function isLoopRun(stats) {
  const maxRelaunch = Math.max(0, ...stats.relaunchedCommands.values());
  return maxRelaunch >= 3 || stats.killCalls >= 2 || (stats.killCalls >= 1 && stats.relaunches >= 1);
}

function dominantModel(stats, fallback) {
  let best = null;
  let bestCount = -1;
  for (const [model, count] of stats?.models ?? []) {
    if (count > bestCount) {
      best = model;
      bestCount = count;
    }
  }
  return best ?? fallback ?? "(unknown)";
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function buildReport(options) {
  const until = options.until ? new Date(options.until) : new Date();
  const since = options.since ? new Date(options.since) : new Date(until.getTime() - options.hours * 3_600_000);
  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) throw new Error("Invalid --since/--until");
  const logsDir = resolveLogsDir(options.logsDir);
  const { runs, createdIssues } = await loadDatabase(since, until);

  const missingLogs = [];
  const runStats = await mapLimit(runs, 8, async (run) => {
    if (run.log_store !== "local_file" || !run.log_ref) {
      missingLogs.push({ runId: run.id, reason: `log_store=${run.log_store ?? "null"}` });
      return null;
    }
    const filePath = path.resolve(logsDir, run.log_ref);
    if (!filePath.startsWith(logsDir + path.sep) || !existsSync(filePath)) {
      missingLogs.push({ runId: run.id, reason: "file missing" });
      return null;
    }
    return analyzeRunLog(filePath, { compressed: run.log_compressed === true });
  });

  const byAgent = new Map();
  const byModel = new Map();
  const total = emptyBucket("all");
  const runModel = new Map();
  const loopRuns = [];
  const streaks = [];

  runs.forEach((run, index) => {
    const stats = runStats[index];
    const model = dominantModel(stats, run.config_model);
    runModel.set(run.id, model);
    const agentBucket = byAgent.get(run.agent_id) ?? emptyBucket(run.agent_name);
    byAgent.set(run.agent_id, agentBucket);
    agentBucket.models = agentBucket.models ?? new Set();
    agentBucket.models.add(model);
    const modelBucket = byModel.get(model) ?? emptyBucket(model);
    byModel.set(model, modelBucket);
    for (const bucket of [agentBucket, modelBucket, total]) {
      bucket.runs += 1;
      if (stats) mergeRun(bucket, stats);
    }
    if (!stats) return;
    if (isLoopRun(stats)) {
      const top = [...stats.relaunchedCommands.entries()].sort((a, b) => b[1] - a[1])[0];
      loopRuns.push({
        runId: run.id,
        agent: run.agent_name,
        issue: run.issue_identifier,
        relaunches: stats.relaunches,
        kills: stats.killCalls,
        asyncTimedOut: stats.asyncTimedOut.size,
        topCommand: top ? { command: top[0].slice(0, 120), launches: top[1] } : null,
      });
    }
    for (const streak of stats.repeatedStreaks) {
      streaks.push({ runId: run.id, agent: run.agent_name, issue: run.issue_identifier, ...streak, key: streak.key.slice(0, 160) });
    }
  });

  const parentless = [];
  let conversationHandoffs = 0;
  let noSourceRun = 0;
  for (const issue of createdIssues) {
    const model = runModel.get(issue.origin_run_id) ?? issue.config_model ?? "(unknown)";
    const agentBucket = byAgent.get(issue.created_by_agent_id) ?? emptyBucket(issue.agent_name);
    byAgent.set(issue.created_by_agent_id, agentBucket);
    const modelBucket = byModel.get(model) ?? emptyBucket(model);
    byModel.set(model, modelBucket);
    for (const bucket of [agentBucket, modelBucket, total]) bucket.agentIssuesCreated += 1;
    if (issue.parent_id) continue;
    if (!issue.source_id) {
      noSourceRun += 1;
      continue;
    }
    if (issue.source_id === issue.id) continue;
    if (issue.source_is_conversation) {
      conversationHandoffs += 1;
      continue;
    }
    for (const bucket of [agentBucket, modelBucket, total]) bucket.parentlessWhileOnOther += 1;
    parentless.push({
      identifier: issue.identifier,
      title: scrubSecrets(issue.title),
      createdAt: new Date(issue.created_at).toISOString(),
      agent: issue.agent_name,
      model,
      sourceIssue: issue.source_identifier,
    });
  }

  return {
    window: { since: since.toISOString(), until: until.toISOString() },
    logsDir,
    total,
    byAgent: [...byAgent.values()].sort((a, b) => b.toolCalls - a.toolCalls),
    byModel: [...byModel.values()].sort((a, b) => b.toolCalls - a.toolCalls),
    missingLogs,
    loopRuns: loopRuns.sort((a, b) => b.relaunches + b.kills - (a.relaunches + a.kills)),
    streaks: streaks.sort((a, b) => b.length - a.length),
    parentless,
    conversationHandoffs,
    noSourceRun,
  };
}

function topEntries(map, limit) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

export function rankWastes(total) {
  return [
    { waste: "Tool errors (failed calls)", calls: total.toolErrors },
    { waste: "Repeated identical tool calls (extra calls in ≥3 streaks)", calls: total.repeatedExtraCalls },
    { waste: "Async bash without timeout (300 s default applies)", calls: total.asyncWithoutTimeout },
    { waste: "Async bash jobs killed by the 300 s default timeout", calls: total.asyncTimedOut },
    { waste: "Background bash relaunches of an identical command (async or service)", calls: total.relaunches },
    { waste: "422/409 API rejections", calls: total.api409 + total.api422 },
    { waste: "Service-mode rejections (name + async/timeout)", calls: total.serviceModeRejects },
    { waste: "proc://*/kill calls", calls: total.killCalls },
    { waste: "Parentless issues created while on another issue", calls: total.parentlessWhileOnOther },
  ]
    .filter((entry) => entry.calls > 0)
    .sort((a, b) => b.calls - a.calls);
}

function pct(part, whole) {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "-";
}

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function table(headers, rows) {
  const lines = [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`];
  for (const row of rows) lines.push(`| ${row.map(escapeCell).join(" | ")} |`);
  return lines.join("\n");
}

const METRIC_HEADERS = [
  "runs",
  "logged",
  "tool calls",
  "errors",
  "err%",
  "repeat extra",
  "async",
  "async +timeout",
  "async no timeout",
  "empty ready",
  "300s kills",
  "svc rejects",
  "relaunches",
  "proc kill",
  "loop runs",
  "409",
  "422",
  "issues created",
  "parentless",
];

function metricCells(bucket) {
  return [
    bucket.runs,
    bucket.runsWithLog,
    bucket.toolCalls,
    bucket.toolErrors,
    pct(bucket.toolErrors, bucket.toolCalls),
    bucket.repeatedExtraCalls,
    bucket.asyncBash,
    bucket.asyncWithTimeout,
    bucket.asyncWithoutTimeout,
    bucket.asyncEmptyReady,
    bucket.asyncTimedOut,
    bucket.serviceModeRejects,
    bucket.relaunches,
    bucket.killCalls,
    bucket.loopRuns,
    bucket.api409,
    bucket.api422,
    bucket.agentIssuesCreated,
    bucket.parentlessWhileOnOther,
  ];
}

function renderMarkdown(report) {
  const out = [];
  out.push(`# Agent efficiency report`);
  out.push("");
  out.push(`Window: ${report.window.since} → ${report.window.until}  `);
  out.push(`Runs: ${report.total.runs} (${report.total.runsWithLog} with readable logs; ${report.missingLogs.length} without)  `);
  out.push(`Tool calls: ${report.total.toolCalls}, tool errors: ${report.total.toolErrors} (${pct(report.total.toolErrors, report.total.toolCalls)})`);
  out.push("");
  out.push("## Top wastes");
  out.push("");
  out.push(table(["#", "waste", "calls/items"], rankWastes(report.total).map((entry, index) => [index + 1, entry.waste, entry.calls])));
  out.push("");
  out.push("## Per model");
  out.push("");
  out.push(table(["model", ...METRIC_HEADERS], report.byModel.map((bucket) => [bucket.label, ...metricCells(bucket)])));
  out.push("");
  out.push("## Per agent");
  out.push("");
  out.push(
    table(
      ["agent", "models", ...METRIC_HEADERS],
      report.byAgent.map((bucket) => [bucket.label, [...(bucket.models ?? [])].join(", "), ...metricCells(bucket)]),
    ),
  );
  out.push("");
  out.push("## Top tool error messages (normalized)");
  out.push("");
  out.push(
    table(
      ["count", "tool", "message"],
      topEntries(report.total.errorMessages, 25).map(([key, count]) => {
        const [tool, message] = key.split("\u0000");
        return [count, tool, `\`${message}\``];
      }),
    ),
  );
  out.push("");
  out.push("### Top errors per agent");
  out.push("");
  for (const bucket of report.byAgent) {
    const top = topEntries(bucket.errorMessages, 3);
    if (top.length === 0) continue;
    out.push(`- **${bucket.label}** (${bucket.toolErrors} errors)`);
    for (const [key, count] of top) {
      const [tool, message] = key.split("\u0000");
      out.push(`  - ${count}× ${tool}: \`${message}\``);
    }
  }
  out.push("");
  out.push("### Top errors per model");
  out.push("");
  for (const bucket of report.byModel) {
    const top = topEntries(bucket.errorMessages, 3);
    if (top.length === 0) continue;
    out.push(`- **${bucket.label}** (${bucket.toolErrors} errors)`);
    for (const [key, count] of top) {
      const [tool, message] = key.split("\u0000");
      out.push(`  - ${count}× ${tool}: \`${message}\``);
    }
  }
  out.push("");
  out.push("## 422/409 API errors by code");
  out.push("");
  out.push(
    table(
      ["count", "status", "route", "code"],
      topEntries(report.total.apiErrors, 30).map(([key, count]) => {
        const [status, route, code] = key.split("\u0000");
        return [count, status, route, `\`${code}\``];
      }),
    ),
  );
  out.push("");
  out.push(`## Repeated identical tool calls (streaks ≥${REPEAT_STREAK_MIN})`);
  out.push("");
  out.push(
    table(
      ["length", "agent", "issue", "tool", "args"],
      report.streaks.slice(0, 20).map((streak) => [streak.length, streak.agent, streak.issue ?? "", streak.tool, `\`${streak.key}\``]),
    ),
  );
  out.push("");
  out.push("## Relaunch / kill loops");
  out.push("");
  out.push(
    table(
      ["agent", "issue", "run", "relaunches", "proc kills", "300s kills", "most relaunched command"],
      report.loopRuns.slice(0, 20).map((loop) => [
        loop.agent,
        loop.issue ?? "",
        loop.runId,
        loop.relaunches,
        loop.kills,
        loop.asyncTimedOut,
        loop.topCommand ? `${loop.topCommand.launches}× \`${loop.topCommand.command}\`` : "",
      ]),
    ),
  );
  out.push("");
  out.push("## Parentless issues created while on another issue");
  out.push("");
  out.push(
    `Excluded: ${report.conversationHandoffs} conversation handoffs (intentionally parentless), ${report.noSourceRun} with no resolvable source run.`,
  );
  out.push("");
  out.push(
    table(
      ["issue", "created", "agent", "model", "while on", "title"],
      report.parentless.map((issue) => [issue.identifier, issue.createdAt, issue.agent, issue.model, issue.sourceIssue, issue.title]),
    ),
  );
  if (report.missingLogs.length > 0) {
    out.push("");
    out.push("## Runs without readable logs");
    out.push("");
    const reasons = new Map();
    for (const missing of report.missingLogs) addCount(reasons, missing.reason, 1);
    for (const [reason, count] of reasons) out.push(`- ${count}× ${reason}`);
  }
  out.push("");
  return out.join("\n");
}

function toJson(report) {
  const bucketJson = (bucket) => ({
    ...bucket,
    models: bucket.models ? [...bucket.models] : undefined,
    errorMessages: topEntries(bucket.errorMessages, 25).map(([key, count]) => {
      const [tool, message] = key.split("\u0000");
      return { tool, message, count };
    }),
    apiErrors: topEntries(bucket.apiErrors, 50).map(([key, count]) => {
      const [status, route, code] = key.split("\u0000");
      return { status: Number(status), route, code, count };
    }),
  });
  return {
    ...report,
    total: bucketJson(report.total),
    byAgent: report.byAgent.map(bucketJson),
    byModel: report.byModel.map(bucketJson),
    topWastes: rankWastes(report.total),
  };
}

const USAGE = `Usage: node scripts/agent-efficiency-report.mjs [--hours N | --since ISO] [--until ISO] [--logs-dir DIR] [--json]
Reads heartbeat_runs/agents/issues in a read-only transaction (DATABASE_URL or ${DEFAULT_DATABASE_URL})
and the run-log ndjson files, then prints a markdown (or --json) efficiency report.`;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const report = await buildReport(options);
  process.stdout.write(options.json ? `${JSON.stringify(toJson(report), null, 2)}\n` : renderMarkdown(report));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
