import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RunLogRetentionConfig } from "@tickernelz/wardmote-shared";
import { createDurableRunLogStore, RUN_LOG_RETAINED_SUFFIX } from "./run-log-store.js";
import { sweepRunLogs } from "./run-log-retention.js";

const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date("2026-11-11T05:00:00.000Z");

const settings: RunLogRetentionConfig = {
  enabled: true,
  dryRun: false,
  intervalMinutes: 60,
  minIdleMinutes: 120,
  keepFullHours: 24,
  recentTailBytes: 4096,
  oldTailBytes: 1024,
};

function ndjson(lines: number) {
  let out = "";
  for (let index = 0; index < lines; index += 1) {
    out += `${JSON.stringify({ ts: "2026-11-01T00:00:00.000Z", stream: "stdout", chunk: `line ${index} ${"x".repeat(40)}\n` })}\n`;
  }
  return out;
}

describe("run log retention", () => {
  let basePath: string;

  async function writeLog(logRef: string, content: string, ageMs: number) {
    const absPath = path.join(basePath, logRef);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, content);
    const mtime = new Date(NOW.getTime() - ageMs);
    await fs.utimes(absPath, mtime, mtime);
    return absPath;
  }

  beforeEach(async () => {
    basePath = await fs.mkdtemp(path.join(os.tmpdir(), "run-log-retention-"));
  });

  afterEach(async () => {
    await fs.rm(basePath, { recursive: true, force: true });
  });

  it("keeps the tail at its original offsets and serves a retention marker for the removed head", async () => {
    const content = ndjson(400);
    const absPath = await writeLog("c/a/old.ndjson", content, 48 * HOUR_MS);
    const store = createDurableRunLogStore({ basePath });
    const tailOffset = content.length - 600;
    const tailBefore = await store.read({ store: "local_file", logRef: "c/a/old.ndjson" }, { offset: tailOffset, limitBytes: 600 });

    const report = await sweepRunLogs({ basePath, settings, liveLogRefs: new Set(), now: NOW });

    expect(report).toMatchObject({ trimmed: 1, errors: 0, dryRun: false });
    const stat = await fs.stat(absPath);
    expect(stat.size).toBe(content.length);
    expect(stat.mtimeMs).toBe(NOW.getTime() - 48 * HOUR_MS);
    const marker = JSON.parse(await fs.readFile(`${absPath}${RUN_LOG_RETAINED_SUFFIX}`, "utf8"));
    expect(marker.originalBytes).toBe(content.length);
    expect(content.length - marker.retainedFromByte).toBeLessThanOrEqual(settings.oldTailBytes);
    expect(content[marker.retainedFromByte - 1]).toBe("\n");

    const tailAfter = await store.read({ store: "local_file", logRef: "c/a/old.ndjson" }, { offset: tailOffset, limitBytes: 600 });
    expect(tailAfter).toEqual(tailBefore);

    const head = await store.read({ store: "local_file", logRef: "c/a/old.ndjson" }, { offset: 0, limitBytes: 64_000 });
    const [markerLine, ...rest] = head.content.split("\n");
    expect(JSON.parse(markerLine!)).toMatchObject({ stream: "system" });
    expect(JSON.parse(markerLine!).chunk).toContain(`first ${marker.retainedFromByte} bytes`);
    expect(rest.join("\n")).toBe(content.slice(marker.retainedFromByte));
    expect(head.content).not.toContain("\u0000");
  });

  it("trims logs younger than the full-retention window to the larger recent tail", async () => {
    const content = ndjson(400);
    const absPath = await writeLog("c/a/recent.ndjson", content, 3 * HOUR_MS);

    await sweepRunLogs({ basePath, settings, liveLogRefs: new Set(), now: NOW });

    const marker = JSON.parse(await fs.readFile(`${absPath}${RUN_LOG_RETAINED_SUFFIX}`, "utf8"));
    expect(content.length - marker.retainedFromByte).toBeGreaterThan(settings.oldTailBytes);
    expect(content.length - marker.retainedFromByte).toBeLessThanOrEqual(settings.recentTailBytes);
  });

  it("leaves live, recently written, small, and dry-run logs untouched", async () => {
    const content = ndjson(400);
    await writeLog("c/a/live.ndjson", content, 48 * HOUR_MS);
    await writeLog("c/a/fresh.ndjson", content, 30 * 60 * 1000);
    await writeLog("c/a/small.ndjson", ndjson(5), 48 * HOUR_MS);
    await writeLog("c/a/dry.ndjson", content, 48 * HOUR_MS);

    const dry = await sweepRunLogs({
      basePath,
      settings: { ...settings, dryRun: true },
      liveLogRefs: new Set([path.join("c", "a", "live.ndjson")]),
      now: NOW,
    });
    const real = await sweepRunLogs({
      basePath,
      settings,
      liveLogRefs: new Set([path.join("c", "a", "live.ndjson"), path.join("c", "a", "dry.ndjson")]),
      now: NOW,
    });

    expect(dry).toMatchObject({ dryRun: true, trimmed: 1, skippedLive: 1, skippedRecent: 1 });
    expect(real).toMatchObject({ trimmed: 0, skippedLive: 2, skippedRecent: 1 });
    for (const name of ["live", "fresh", "small", "dry"]) {
      await expect(fs.access(path.join(basePath, "c", "a", `${name}.ndjson${RUN_LOG_RETAINED_SUFFIX}`))).rejects.toThrow();
    }
    expect(await fs.readFile(path.join(basePath, "c", "a", "dry.ndjson"), "utf8")).toBe(content);
  });
});
