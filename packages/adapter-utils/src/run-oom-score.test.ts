import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_RUN_OOM_SCORE_ADJ,
  RUN_OOM_SCORE_ADJ_ENV,
  applyRunOomScoreAdj,
  resolveRunOomScoreAdj,
} from "./run-oom-score.js";
import { runChildProcess } from "./server-utils.js";

function currentOomScoreAdj(): number {
  try {
    return Number(readFileSync("/proc/self/oom_score_adj", "utf8").trim());
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

const canRaiseTo500 = process.platform === "linux" && currentOomScoreAdj() <= DEFAULT_RUN_OOM_SCORE_ADJ;
const canRaiseTo700 = process.platform === "linux" && currentOomScoreAdj() <= 700;

const previousOverride = process.env[RUN_OOM_SCORE_ADJ_ENV];

afterEach(() => {
  if (previousOverride === undefined) delete process.env[RUN_OOM_SCORE_ADJ_ENV];
  else process.env[RUN_OOM_SCORE_ADJ_ENV] = previousOverride;
});

async function childReportedOomScoreAdj(): Promise<string> {
  let stdout = "";
  const result = await runChildProcess(
    "oom-score-adj-probe",
    process.execPath,
    [
      "-e",
      "setTimeout(() => process.stdout.write(require('node:fs').readFileSync('/proc/self/oom_score_adj', 'utf8').trim()), 300)",
    ],
    {
      cwd: process.cwd(),
      env: {},
      timeoutSec: 30,
      graceSec: 1,
      onLog: async (stream, chunk) => {
        if (stream === "stdout") stdout += chunk;
      },
    },
  );
  expect(result.exitCode, result.stderr).toBe(0);
  return stdout;
}

describe("resolveRunOomScoreAdj", () => {
  it("defaults to 500", () => {
    expect(resolveRunOomScoreAdj({})).toBe(500);
  });

  it("honours an in-range integer override", () => {
    expect(resolveRunOomScoreAdj({ [RUN_OOM_SCORE_ADJ_ENV]: " 700 " })).toBe(700);
    expect(resolveRunOomScoreAdj({ [RUN_OOM_SCORE_ADJ_ENV]: "0" })).toBe(0);
  });

  it.each(["abc", "1.5", "1001", "-1001", ""])("falls back to the default for %j", (raw) => {
    expect(resolveRunOomScoreAdj({ [RUN_OOM_SCORE_ADJ_ENV]: raw })).toBe(500);
  });
});

describe("applyRunOomScoreAdj", () => {
  it("is a no-op off Linux", () => {
    const writes: string[] = [];
    expect(applyRunOomScoreAdj(123, { platform: "darwin", write: (path) => writes.push(path) })).toEqual({ applied: false });
    expect(writes).toEqual([]);
  });

  it("ignores a missing pid", () => {
    expect(applyRunOomScoreAdj(undefined, { platform: "linux", write: () => { throw new Error("unreachable"); } }))
      .toEqual({ applied: false });
  });

  it("reports a write failure instead of throwing", () => {
    const failure = new Error("EACCES");
    expect(applyRunOomScoreAdj(123, { platform: "linux", write: () => { throw failure; } }))
      .toEqual({ applied: false, error: failure });
  });
});

describe.runIf(process.platform === "linux")("runChildProcess oom_score_adj", () => {
  it.runIf(canRaiseTo500)("starts the child at 500", async () => {
    delete process.env[RUN_OOM_SCORE_ADJ_ENV];
    expect(await childReportedOomScoreAdj()).toBe("500");
  });

  it.runIf(canRaiseTo700)("starts the child at the operator override", async () => {
    process.env[RUN_OOM_SCORE_ADJ_ENV] = "700";
    expect(await childReportedOomScoreAdj()).toBe("700");
  });
});
