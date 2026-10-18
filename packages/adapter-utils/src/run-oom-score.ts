import { writeFileSync } from "node:fs";

export const RUN_OOM_SCORE_ADJ_ENV = "PAPERCLIP_RUN_OOM_SCORE_ADJ";

export const DEFAULT_RUN_OOM_SCORE_ADJ = 500;

const MIN_OOM_SCORE_ADJ = -1000;
const MAX_OOM_SCORE_ADJ = 1000;

export function resolveRunOomScoreAdj(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[RUN_OOM_SCORE_ADJ_ENV]?.trim();
  if (!raw) return DEFAULT_RUN_OOM_SCORE_ADJ;
  const value = Number(raw);
  return Number.isInteger(value) && value >= MIN_OOM_SCORE_ADJ && value <= MAX_OOM_SCORE_ADJ
    ? value
    : DEFAULT_RUN_OOM_SCORE_ADJ;
}

export type RunOomScoreAdjResult =
  | { applied: true; value: number }
  | { applied: false; error?: unknown };

export function applyRunOomScoreAdj(
  pid: number | undefined,
  deps: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    write?: (path: string, value: string) => void;
  } = {},
): RunOomScoreAdjResult {
  if ((deps.platform ?? process.platform) !== "linux") return { applied: false };
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return { applied: false };
  const value = resolveRunOomScoreAdj(deps.env);
  try {
    (deps.write ?? writeFileSync)(`/proc/${pid}/oom_score_adj`, String(value));
    return { applied: true, value };
  } catch (error) {
    return { applied: false, error };
  }
}
