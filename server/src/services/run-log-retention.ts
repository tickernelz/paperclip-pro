import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, inArray, isNotNull } from "drizzle-orm";
import { heartbeatRuns, type Db } from "@tickernelz/wardmote-db";
import type { RunLogRetentionConfig } from "@tickernelz/wardmote-shared";
import { logger } from "../middleware/logger.js";
import { readRunLogRetainedMarker, RUN_LOG_RETAINED_SUFFIX, type RunLogRetainedMarker } from "./run-log-store.js";

const HOUR_MS = 60 * 60 * 1000;
const COPY_CHUNK_BYTES = 1024 * 1024;
const LIVE_RUN_STATUSES = ["queued", "running"];
const TRIM_TMP_SUFFIX = ".retention.tmp";
const MARKER_TMP_SUFFIX = `${RUN_LOG_RETAINED_SUFFIX}.tmp`;

export interface RunLogRetentionReport {
  dryRun: boolean;
  scanned: number;
  trimmed: number;
  trimmedOriginalBytes: number;
  freedBytes: number;
  skippedLive: number;
  skippedRecent: number;
  skippedChanged: number;
  errors: number;
}

type TrimOutcome = "trimmed" | "changed" | "no_line_boundary";

async function findRetainedStart(handle: fs.FileHandle, size: number, keepBytes: number) {
  const start = size - keepBytes;
  const buffer = Buffer.alloc(Math.min(keepBytes, COPY_CHUNK_BYTES));
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
  const newline = buffer.subarray(0, bytesRead).indexOf(0x0a);
  return newline < 0 ? null : start + newline + 1;
}

/** Rewrites a log so only its tail stays allocated; byte offsets are unchanged because the head becomes a hole. */
export async function trimRunLogFile(absPath: string, keepBytes: number, now: Date): Promise<TrimOutcome> {
  const before = await fs.stat(absPath);
  const source = await fs.open(absPath, "r");
  const tmpPath = path.join(path.dirname(absPath), `.${path.basename(absPath)}.${randomUUID()}${TRIM_TMP_SUFFIX}`);
  let retainedFromByte: number | null;
  try {
    retainedFromByte = await findRetainedStart(source, before.size, keepBytes);
    if (retainedFromByte === null) return "no_line_boundary";
    const target = await fs.open(tmpPath, "wx", before.mode & 0o777);
    try {
      await target.truncate(retainedFromByte);
      const buffer = Buffer.alloc(COPY_CHUNK_BYTES);
      let position = retainedFromByte;
      while (position < before.size) {
        const { bytesRead } = await source.read(buffer, 0, buffer.length, position);
        if (bytesRead === 0) break;
        await target.write(buffer, 0, bytesRead, position);
        position += bytesRead;
      }
      if ((await target.stat()).size !== before.size) throw new Error(`run log changed size while trimming: ${absPath}`);
      await target.sync();
    } finally {
      await target.close();
    }
  } catch (err) {
    await fs.rm(tmpPath, { force: true });
    throw err;
  } finally {
    await source.close();
  }

  const after = await fs.stat(absPath);
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
    await fs.rm(tmpPath, { force: true });
    return "changed";
  }
  await fs.utimes(tmpPath, before.atime, before.mtime);
  const marker: RunLogRetainedMarker = {
    version: 1,
    retainedFromByte,
    originalBytes: before.size,
    truncatedAt: now.toISOString(),
    reason: "run_log_retention",
  };
  const markerPath = `${absPath}${RUN_LOG_RETAINED_SUFFIX}`;
  await fs.writeFile(`${absPath}${MARKER_TMP_SUFFIX}`, JSON.stringify(marker), { mode: before.mode & 0o777 });
  await fs.rename(`${absPath}${MARKER_TMP_SUFFIX}`, markerPath);
  await fs.rename(tmpPath, absPath);
  return "trimmed";
}

async function startsWithHole(absPath: string) {
  const handle = await fs.open(absPath, "r");
  try {
    const byte = Buffer.alloc(1);
    const { bytesRead } = await handle.read(byte, 0, 1, 0);
    return bytesRead === 1 && byte[0] === 0;
  } finally {
    await handle.close();
  }
}

async function tailAlreadyWithin(absPath: string, size: number, keepBytes: number) {
  const marker = await readRunLogRetainedMarker(absPath);
  if (!marker || size - marker.retainedFromByte > keepBytes) return false;
  return startsWithHole(absPath);
}

async function removeAbandonedTemps(basePath: string, entries: string[], olderThanMs: number) {
  for (const entry of entries) {
    if (!entry.endsWith(TRIM_TMP_SUFFIX) && !entry.endsWith(MARKER_TMP_SUFFIX)) continue;
    const absPath = path.join(basePath, entry);
    try {
      if ((await fs.stat(absPath)).ctimeMs < olderThanMs) await fs.rm(absPath, { force: true });
    } catch (err) {
      logger.warn({ err, entry }, "run log retention could not remove an abandoned temp file");
    }
  }
}

/** Trims finished run logs to their tail per the retention policy; never deletes a log. */
export async function sweepRunLogs(input: {
  basePath: string;
  settings: RunLogRetentionConfig;
  liveLogRefs: ReadonlySet<string>;
  now: Date;
}): Promise<RunLogRetentionReport> {
  const { basePath, settings, liveLogRefs, now } = input;
  const report: RunLogRetentionReport = {
    dryRun: settings.dryRun,
    scanned: 0,
    trimmed: 0,
    trimmedOriginalBytes: 0,
    freedBytes: 0,
    skippedLive: 0,
    skippedRecent: 0,
    skippedChanged: 0,
    errors: 0,
  };
  let entries: string[];
  try {
    entries = await fs.readdir(basePath, { recursive: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException | null)?.code === "ENOENT") return report;
    throw err;
  }
  if (!settings.dryRun) {
    await removeAbandonedTemps(basePath, entries, now.getTime() - settings.minIdleMinutes * 60 * 1000);
  }
  for (const logRef of entries.filter((entry) => entry.endsWith(".ndjson")).sort()) {
    const absPath = path.join(basePath, logRef);
    report.scanned += 1;
    try {
      const stat = await fs.stat(absPath);
      const ageMs = now.getTime() - stat.mtimeMs;
      if (ageMs < settings.minIdleMinutes * 60 * 1000) {
        report.skippedRecent += 1;
        continue;
      }
      if (liveLogRefs.has(logRef)) {
        report.skippedLive += 1;
        continue;
      }
      const keepBytes = ageMs >= settings.keepFullHours * HOUR_MS ? settings.oldTailBytes : settings.recentTailBytes;
      if (keepBytes <= 0 || stat.size <= keepBytes) continue;
      if (await tailAlreadyWithin(absPath, stat.size, keepBytes)) continue;
      const freed = Math.max(0, stat.blocks * 512 - keepBytes);
      if (!settings.dryRun) {
        const outcome = await trimRunLogFile(absPath, keepBytes, now);
        if (outcome === "changed") {
          report.skippedChanged += 1;
          continue;
        }
        if (outcome !== "trimmed") continue;
      }
      report.trimmed += 1;
      report.trimmedOriginalBytes += stat.size;
      report.freedBytes += freed;
    } catch (err) {
      report.errors += 1;
      logger.warn({ err, logRef }, "run log retention skipped a log");
    }
  }
  return report;
}

/** Schedules run-log retention sweeps for the instance's local run-log directory. */
export function runLogRetentionService(db: Db, options: { basePath: string; settings: RunLogRetentionConfig }) {
  let active: Promise<RunLogRetentionReport | null> | null = null;

  async function liveLogRefs() {
    const rows = await db
      .select({ logRef: heartbeatRuns.logRef })
      .from(heartbeatRuns)
      .where(and(inArray(heartbeatRuns.status, LIVE_RUN_STATUSES), isNotNull(heartbeatRuns.logRef)));
    return new Set(rows.flatMap((row) => (row.logRef ? [row.logRef] : [])));
  }

  async function sweep() {
    const report = await sweepRunLogs({
      basePath: options.basePath,
      settings: options.settings,
      liveLogRefs: await liveLogRefs(),
      now: new Date(),
    });
    logger.info({ runLogRetention: report }, report.dryRun ? "run log retention dry run" : "run log retention sweep");
    return report;
  }

  return {
    intervalMs: options.settings.intervalMinutes * 60 * 1000,
    tick() {
      if (!options.settings.enabled) return Promise.resolve(null);
      if (active) return active;
      active = sweep().finally(() => {
        active = null;
      });
      return active;
    },
  };
}
