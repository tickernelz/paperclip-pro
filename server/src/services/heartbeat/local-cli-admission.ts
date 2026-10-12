import {
  INSTANCE_DEFAULT_LOCAL_START_WAIT_BYPASS_SEC,
  INSTANCE_DEFAULT_MAX_CONCURRENT_LOCAL_RUNS,
  INSTANCE_DEFAULT_MAX_CONCURRENT_LOCAL_STARTS,
  INSTANCE_LOCAL_START_WAIT_BYPASS_SEC_MAX,
  INSTANCE_LOCAL_START_WAIT_BYPASS_SEC_MIN,
  INSTANCE_MAX_CONCURRENT_LOCAL_RUNS_MAX,
  INSTANCE_MAX_CONCURRENT_LOCAL_RUNS_MIN,
  INSTANCE_MAX_CONCURRENT_LOCAL_STARTS_MAX,
  INSTANCE_MAX_CONCURRENT_LOCAL_STARTS_MIN,
  LOCAL_CLI_ADAPTER_TYPES,
  type EffectiveLocalRunLimit,
  type EffectiveLocalRunLimits,
  type LocalRunLimitKey,
  type LocalRunLimitsSettings,
} from "@tickernelz/paperclip-pro-shared";

const localCliRunStarts = new Map<string, { at: number; signalled: boolean }>();
const localCliStdoutBuffers = new Map<string, string>();
const LOCAL_CLI_HUNG_START_MS = 120_000;
const LOCAL_CLI_STDOUT_BUFFER_MAX_CHARS = 65_536;
const LOCAL_CLI_ADAPTER_TYPE_SET = new Set<string>(LOCAL_CLI_ADAPTER_TYPES);

export function isLocalCliAdapterType(adapterType: string | null | undefined) {
  return adapterType ? LOCAL_CLI_ADAPTER_TYPE_SET.has(adapterType) : false;
}

const LOCAL_RUN_LIMIT_SPECS = {
  maxConcurrentRuns: {
    envVar: "PAPERCLIP_MAX_CONCURRENT_LOCAL_RUNS",
    fallback: INSTANCE_DEFAULT_MAX_CONCURRENT_LOCAL_RUNS,
    min: INSTANCE_MAX_CONCURRENT_LOCAL_RUNS_MIN,
    max: INSTANCE_MAX_CONCURRENT_LOCAL_RUNS_MAX,
  },
  maxConcurrentStarts: {
    envVar: "PAPERCLIP_MAX_CONCURRENT_LOCAL_STARTS",
    fallback: INSTANCE_DEFAULT_MAX_CONCURRENT_LOCAL_STARTS,
    min: INSTANCE_MAX_CONCURRENT_LOCAL_STARTS_MIN,
    max: INSTANCE_MAX_CONCURRENT_LOCAL_STARTS_MAX,
  },
  startWaitBypassSec: {
    envVar: "PAPERCLIP_LOCAL_START_WAIT_BYPASS_SEC",
    fallback: INSTANCE_DEFAULT_LOCAL_START_WAIT_BYPASS_SEC,
    min: INSTANCE_LOCAL_START_WAIT_BYPASS_SEC_MIN,
    max: INSTANCE_LOCAL_START_WAIT_BYPASS_SEC_MAX,
  },
} as const satisfies Record<
  LocalRunLimitKey,
  { envVar: string; fallback: number; min: number; max: number }
>;

function readBoundedEnvInteger(raw: string | undefined, min: number, max: number) {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const parsed = Math.floor(Number(trimmed));
  if (!Number.isFinite(parsed)) return null;
  return Math.max(min, Math.min(max, parsed));
}

function resolveLocalRunLimit(
  key: LocalRunLimitKey,
  env: Record<string, string | undefined>,
  saved: LocalRunLimitsSettings | null | undefined,
): EffectiveLocalRunLimit {
  const spec = LOCAL_RUN_LIMIT_SPECS[key];
  const fromEnv = readBoundedEnvInteger(env[spec.envVar], spec.min, spec.max);
  if (fromEnv !== null) return { value: fromEnv, source: "env", envVar: spec.envVar };
  const fromSetting = saved?.[key];
  if (
    typeof fromSetting === "number" &&
    Number.isInteger(fromSetting) &&
    fromSetting >= spec.min &&
    fromSetting <= spec.max
  ) {
    return { value: fromSetting, source: "setting", envVar: spec.envVar };
  }
  return { value: spec.fallback, source: "default", envVar: spec.envVar };
}

export function resolveLocalRunLimits(
  env: Record<string, string | undefined>,
  saved?: LocalRunLimitsSettings | null,
): EffectiveLocalRunLimits {
  return {
    maxConcurrentRuns: resolveLocalRunLimit("maxConcurrentRuns", env, saved),
    maxConcurrentStarts: resolveLocalRunLimit("maxConcurrentStarts", env, saved),
    startWaitBypassSec: resolveLocalRunLimit("startWaitBypassSec", env, saved),
  };
}

export function markLocalCliRunStarting(runId: string, at = Date.now()) {
  localCliRunStarts.set(runId, { at, signalled: false });
}

export function markLocalCliRunStarted(runId: string) {
  const entry = localCliRunStarts.get(runId);
  if (!entry || entry.signalled) return false;
  entry.signalled = true;
  return true;
}

export function clearLocalCliRunStarting(runId: string) {
  localCliStdoutBuffers.delete(runId);
  return localCliRunStarts.delete(runId);
}

export function countLocalCliRunsStarting(
  inFlight: Map<string, number | null>,
  now = Date.now(),
) {
  let starting = 0;
  for (const [runId, startedAtMs] of inFlight) {
    const entry = localCliRunStarts.get(runId);
    if (entry?.signalled) continue;
    const at = entry?.at ?? startedAtMs;
    if (at !== null && now - at >= LOCAL_CLI_HUNG_START_MS) continue;
    starting += 1;
  }
  return starting;
}

export function mergeLocalCliStartReservations(
  snapshot: Map<string, number | null>,
  now = Date.now(),
) {
  const merged = new Map(snapshot);
  for (const [runId, entry] of localCliRunStarts) {
    if (!snapshot.has(runId) && now - entry.at >= LOCAL_CLI_HUNG_START_MS) {
      continue;
    }
    merged.set(runId, entry.at);
  }
  return merged;
}

export function reportsStartupComplete(
  adapter: { isStartupComplete?: (stdoutLine: string) => boolean },
  chunk: string,
  runId?: string,
) {
  const predicate = adapter.isStartupComplete;
  if (!predicate) return true;
  const buffered = runId ? (localCliStdoutBuffers.get(runId) ?? "") : "";
  const lines = (buffered + chunk).split("\n");
  const remainder = lines.pop() ?? "";
  if (runId) {
    localCliStdoutBuffers.set(
      runId,
      remainder.length > LOCAL_CLI_STDOUT_BUFFER_MAX_CHARS
        ? remainder.slice(-LOCAL_CLI_STDOUT_BUFFER_MAX_CHARS)
        : remainder,
    );
  }
  for (const line of remainder ? [...lines, remainder] : lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      if (!predicate(trimmed)) continue;
    } catch {
      continue;
    }
    if (runId) localCliStdoutBuffers.delete(runId);
    return true;
  }
  return false;
}

export function readLocalCliRunStartingAt(runId: string) {
  return localCliRunStarts.get(runId)?.at ?? null;
}
