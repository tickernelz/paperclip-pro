import { describe, expect, it } from "vitest";
import { resolveLocalRunLimits } from "./local-cli-admission.js";

const SAVED = { maxConcurrentRuns: 2, maxConcurrentStarts: 3, startWaitBypassSec: 45, memoryReservePercent: null, memoryGateCooldownSec: null };

describe("resolveLocalRunLimits", () => {
  it("defaults to 20 running local runs, 4 starts and a 120 second start wait bypass", () => {
    expect(resolveLocalRunLimits({})).toEqual({
      maxConcurrentRuns: { value: 20, source: "default", envVar: "PAPERCLIP_MAX_CONCURRENT_LOCAL_RUNS" },
      maxConcurrentStarts: { value: 4, source: "default", envVar: "PAPERCLIP_MAX_CONCURRENT_LOCAL_STARTS" },
      startWaitBypassSec: { value: 120, source: "default", envVar: "PAPERCLIP_LOCAL_START_WAIT_BYPASS_SEC" },
      memoryReservePercent: { value: 20, source: "default", envVar: "PAPERCLIP_LOCAL_MEMORY_RESERVE_PERCENT" },
      memoryGateCooldownSec: { value: 120, source: "default", envVar: "PAPERCLIP_LOCAL_MEMORY_GATE_COOLDOWN_SEC" },
    });
  });

  it("uses the saved setting over the default", () => {
    const limits = resolveLocalRunLimits({}, SAVED);
    expect(limits.maxConcurrentRuns).toMatchObject({ value: 2, source: "setting" });
    expect(limits.maxConcurrentStarts).toMatchObject({ value: 3, source: "setting" });
    expect(limits.startWaitBypassSec).toMatchObject({ value: 45, source: "setting" });
  });

  it("falls back to the default for a field saved as null", () => {
    const limits = resolveLocalRunLimits({}, { ...SAVED, maxConcurrentRuns: null });
    expect(limits.maxConcurrentRuns).toMatchObject({ value: 20, source: "default" });
    expect(limits.maxConcurrentStarts).toMatchObject({ value: 3, source: "setting" });
  });

  it("lets an explicit environment variable win over the saved setting", () => {
    const limits = resolveLocalRunLimits(
      { PAPERCLIP_MAX_CONCURRENT_LOCAL_RUNS: "7", PAPERCLIP_LOCAL_START_WAIT_BYPASS_SEC: "9999" },
      SAVED,
    );
    expect(limits.maxConcurrentRuns).toMatchObject({ value: 7, source: "env" });
    expect(limits.maxConcurrentStarts).toMatchObject({ value: 3, source: "setting" });
    expect(limits.startWaitBypassSec).toMatchObject({ value: 3600, source: "env" });
  });

  it("ignores a blank or non-numeric environment variable", () => {
    const limits = resolveLocalRunLimits(
      { PAPERCLIP_MAX_CONCURRENT_LOCAL_RUNS: "  ", PAPERCLIP_MAX_CONCURRENT_LOCAL_STARTS: "many" },
      SAVED,
    );
    expect(limits.maxConcurrentRuns).toMatchObject({ value: 2, source: "setting" });
    expect(limits.maxConcurrentStarts).toMatchObject({ value: 3, source: "setting" });
  });
});
