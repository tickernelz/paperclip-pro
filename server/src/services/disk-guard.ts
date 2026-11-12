import { statfsSync } from "node:fs";
import type { Db } from "@tickernelz/wardmote-db";
import type { DiskGuardConfig, RunLogRetentionConfig } from "@tickernelz/wardmote-shared";
import { logger } from "../middleware/logger.js";
import { logActivity } from "./activity-log.js";
import { setDiskEmergencyHold } from "./disk-emergency-hold.js";
import { deleteFinishedRunLogs, loadLiveRunLogRefs, sweepRunLogs } from "./run-log-retention.js";
import { loadOmpSessionDirs, loadProtectedOmpSessionIds, sweepOmpSessions } from "./omp-session-retention.js";

const GB = 1024 ** 3;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type DiskPressureLevel = "ok" | "warning" | "action" | "emergency";

export type DiskSpaceReading = { path: string; freeBytes: number; totalBytes: number };

export type DiskGuardAction = {
  at: string;
  kind: "run_log_trim" | "run_log_delete" | "omp_session_sweep";
  files: number;
  freedBytes: number;
};

export type DiskSpaceStatus = {
  level: DiskPressureLevel;
  path: string;
  freeBytes: number;
  totalBytes: number;
  freePercent: number;
  checkedAt: string;
  thresholds: {
    warnFreePercent: number;
    warnFreeGb: number;
    actionFreePercent: number;
    emergencyFreePercent: number;
  };
  holdingRuns: boolean;
  lastActions: DiskGuardAction[];
};

const LEVEL_RANK: Record<DiskPressureLevel, number> = { ok: 0, warning: 1, action: 2, emergency: 3 };

export function freePercentOf(reading: Pick<DiskSpaceReading, "freeBytes" | "totalBytes">) {
  return reading.totalBytes > 0 ? (reading.freeBytes / reading.totalBytes) * 100 : 100;
}

export function assessDiskPressure(
  reading: Pick<DiskSpaceReading, "freeBytes" | "totalBytes">,
  config: Pick<DiskGuardConfig, "warnFreePercent" | "warnFreeGb" | "actionFreePercent" | "emergencyFreePercent">,
): DiskPressureLevel {
  const percent = freePercentOf(reading);
  if (percent < config.emergencyFreePercent) return "emergency";
  if (percent < config.actionFreePercent) return "action";
  const warnFreeBytes = Math.min(config.warnFreeGb * GB, reading.totalBytes / 2);
  if (percent < config.warnFreePercent || reading.freeBytes < warnFreeBytes) return "warning";
  return "ok";
}

/** Shorter run-log tails under pressure; null keeps the configured policy. */
export function runLogTailsFor(level: DiskPressureLevel, settings: RunLogRetentionConfig) {
  if (level === "action") {
    return { recentTailBytes: settings.oldTailBytes, oldTailBytes: Math.floor(settings.oldTailBytes / 4) };
  }
  if (level === "emergency") {
    return { recentTailBytes: Math.floor(settings.oldTailBytes / 4), oldTailBytes: Math.floor(settings.oldTailBytes / 16) };
  }
  return null;
}

export function ompSessionIdleDaysFor(level: DiskPressureLevel, maxIdleDays: number) {
  if (level === "emergency") return Math.min(maxIdleDays, 1);
  if (level === "action") return Math.min(maxIdleDays, 3);
  return maxIdleDays;
}

function readSpace(path: string): DiskSpaceReading {
  const stats = statfsSync(path);
  return { path, freeBytes: stats.bavail * stats.bsize, totalBytes: stats.blocks * stats.bsize };
}

function gb(bytes: number) {
  return `${(bytes / GB).toFixed(1)} GB`;
}

export function describeDiskSpace(status: Pick<DiskSpaceStatus, "level" | "freeBytes" | "totalBytes" | "freePercent" | "path">) {
  const free = `${gb(status.freeBytes)} free of ${gb(status.totalBytes)} (${status.freePercent.toFixed(1)}%) on ${status.path}`;
  if (status.level === "emergency") {
    return `Disk space critically low: ${free}. New runs are held in the queue and database backups are skipped until space is freed.`;
  }
  if (status.level === "action") return `Disk space low: ${free}. Finished run logs and idle OMP sessions are trimmed sooner.`;
  if (status.level === "warning") return `Disk space getting low: ${free}.`;
  return `Disk space back to normal: ${free}.`;
}

export type DiskGuardOptions = {
  config: DiskGuardConfig;
  paths: string[];
  runLogBasePath: string;
  runLogSettings: RunLogRetentionConfig;
  ompSessionRoot: string | null;
  ompBlobDir: string | null;
  ompAgentDir: string;
  listCompanyIds: () => Promise<string[]>;
  statfs?: (path: string) => DiskSpaceReading;
  now?: () => Date;
};

/** Watches free space on the data volumes and applies the safest cleanup that fits the pressure level. */
export function diskGuardService(db: Db, options: DiskGuardOptions) {
  const statfs = options.statfs ?? readSpace;
  const now = options.now ?? (() => new Date());
  const { config } = options;
  let status: DiskSpaceStatus | null = null;
  let active: Promise<DiskSpaceStatus | null> | null = null;
  let lastSessionSweepAt = Number.NEGATIVE_INFINITY;
  let lastBlobScanAt = now().getTime() - DAY_MS + HOUR_MS;

  function worstReading(): DiskSpaceReading | null {
    let worst: DiskSpaceReading | null = null;
    for (const path of new Set(options.paths)) {
      try {
        const reading = statfs(path);
        if (!worst || freePercentOf(reading) < freePercentOf(worst)) worst = reading;
      } catch (err) {
        logger.warn({ err, path }, "disk guard could not read free space");
      }
    }
    return worst;
  }

  async function recordActivity(action: string, details: Record<string, unknown>) {
    try {
      for (const companyId of await options.listCompanyIds()) {
        await logActivity(db, {
          companyId,
          actorType: "system",
          actorId: "disk-guard",
          action,
          entityType: "instance_settings",
          entityId: "default",
          details,
        });
      }
    } catch (err) {
      logger.warn({ err, action }, "disk guard could not record activity");
    }
  }

  async function sweep(): Promise<DiskSpaceStatus | null> {
    const before = worstReading();
    if (!before) return status;
    const at = now();
    const level = assessDiskPressure(before, config);
    const previousLevel = status?.level ?? "ok";
    const actions: DiskGuardAction[] = [];

    const tails = runLogTailsFor(level, options.runLogSettings);
    if (tails) {
      const liveLogRefs = await loadLiveRunLogRefs(db);
      const trim = await sweepRunLogs({
        basePath: options.runLogBasePath,
        settings: { ...options.runLogSettings, ...tails, dryRun: false },
        liveLogRefs,
        now: at,
      });
      if (trim.trimmed > 0) {
        actions.push({ at: at.toISOString(), kind: "run_log_trim", files: trim.trimmed, freedBytes: trim.freedBytes });
      }
      if (level === "emergency") {
        const afterTrim = statfs(before.path);
        const target = (afterTrim.totalBytes * config.actionFreePercent) / 100;
        const removed = await deleteFinishedRunLogs({
          basePath: options.runLogBasePath,
          liveLogRefs,
          minIdleMinutes: options.runLogSettings.minIdleMinutes,
          minimalTailBytes: tails.oldTailBytes,
          needBytes: Math.ceil(target - afterTrim.freeBytes),
          now: at,
        });
        if (removed.deleted > 0) {
          actions.push({ at: at.toISOString(), kind: "run_log_delete", files: removed.deleted, freedBytes: removed.freedBytes });
        }
      }
    }

    const pressured = LEVEL_RANK[level] >= LEVEL_RANK.action;
    const sessionSweepDue = at.getTime() - lastSessionSweepAt >= HOUR_MS || (pressured && LEVEL_RANK[level] > LEVEL_RANK[previousLevel]);
    if (sessionSweepDue) {
      lastSessionSweepAt = at.getTime();
      const scanBlobs = at.getTime() - lastBlobScanAt >= (pressured ? HOUR_MS : DAY_MS);
      if (scanBlobs) lastBlobScanAt = at.getTime();
      const sessions = await sweepOmpSessions({
        sessionRoot: options.ompSessionRoot,
        blobDir: options.ompBlobDir,
        agentDir: options.ompAgentDir,
        extraTranscriptRoots: scanBlobs ? await loadOmpSessionDirs(db) : [],
        maxIdleDays: ompSessionIdleDaysFor(level, config.ompSessionMaxIdleDays),
        protectedSessionIds: await loadProtectedOmpSessionIds(db),
        now: at,
        scanBlobs,
      });
      logger.info({ ompSessionRetention: sessions }, "OMP session retention sweep");
      const files = sessions.deletedSessions + sessions.deletedBlobs;
      if (files > 0) {
        actions.push({
          at: at.toISOString(),
          kind: "omp_session_sweep",
          files,
          freedBytes: sessions.deletedSessionBytes + sessions.deletedBlobBytes,
        });
      }
    }

    const after = actions.length > 0 ? statfs(before.path) : before;
    const finalLevel = assessDiskPressure(after, config);
    const holdingRuns = finalLevel === "emergency";
    setDiskEmergencyHold(holdingRuns
      ? { since: status?.holdingRuns ? status.checkedAt : at.toISOString(), freeBytes: after.freeBytes, totalBytes: after.totalBytes }
      : null);
    status = {
      level: finalLevel,
      path: after.path,
      freeBytes: after.freeBytes,
      totalBytes: after.totalBytes,
      freePercent: freePercentOf(after),
      checkedAt: at.toISOString(),
      thresholds: {
        warnFreePercent: config.warnFreePercent,
        warnFreeGb: config.warnFreeGb,
        actionFreePercent: config.actionFreePercent,
        emergencyFreePercent: config.emergencyFreePercent,
      },
      holdingRuns,
      lastActions: actions.length > 0 ? actions : status?.lastActions ?? [],
    };

    const numbers = {
      path: after.path,
      freeBytesBefore: before.freeBytes,
      freeBytesAfter: after.freeBytes,
      totalBytes: after.totalBytes,
      freePercentBefore: Number(freePercentOf(before).toFixed(2)),
      freePercentAfter: Number(freePercentOf(after).toFixed(2)),
    };
    for (const action of actions) {
      await recordActivity("instance.disk_guard.cleanup", { ...numbers, level, ...action });
    }
    if (finalLevel !== previousLevel) {
      logger.warn({ diskGuard: { ...numbers, level: finalLevel, previousLevel } }, describeDiskSpace(status));
      await recordActivity(
        finalLevel === "emergency" ? "instance.disk_space.emergency" : "instance.disk_space.level_changed",
        { ...numbers, level: finalLevel, previousLevel, message: describeDiskSpace(status) },
      );
    }
    return status;
  }

  return {
    intervalMs: config.intervalMinutes * 60 * 1000,
    status: () => status,
    tick() {
      if (!config.enabled) return Promise.resolve(null);
      if (active) return active;
      active = sweep().finally(() => {
        active = null;
      });
      return active;
    },
  };
}
