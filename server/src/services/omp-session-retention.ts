import { createReadStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { sql } from "drizzle-orm";
import type { Db } from "@tickernelz/wardmote-db";
import { logger } from "../middleware/logger.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const BLOB_REFERENCE = /blob:sha256:([0-9a-f]{64})/g;
const SESSION_FILE = /_([^_]+)\.jsonl$/;

export interface OmpSessionSweepReport {
  maxIdleDays: number;
  scannedSessions: number;
  deletedSessions: number;
  deletedSessionBytes: number;
  skippedProtected: number;
  scannedBlobs: number;
  deletedBlobs: number;
  deletedBlobBytes: number;
  blobScan: "done" | "skipped" | "aborted";
  errors: number;
}

export function defaultOmpSessionRoot() {
  return path.join(os.homedir(), ".omp", "paperclip", "sessions");
}

export function defaultOmpBlobDir() {
  return path.join(os.homedir(), ".omp", "agent", "blobs");
}

export function defaultOmpBlobScanRoots(sessionRoot: string) {
  return [sessionRoot, path.join(os.homedir(), ".omp", "agent", "sessions")];
}

async function allocatedBytes(target: string): Promise<number> {
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat) return 0;
  if (!stat.isDirectory()) return stat.blocks * 512;
  let total = stat.blocks * 512;
  for (const entry of await fs.readdir(target).catch(() => [] as string[])) {
    total += await allocatedBytes(path.join(target, entry));
  }
  return total;
}

async function listJsonlFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { recursive: true }).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return [] as string[];
    throw err;
  });
  return entries.filter((entry) => entry.endsWith(".jsonl")).map((entry) => path.join(root, entry));
}

async function collectBlobReferences(roots: string[]): Promise<Set<string>> {
  const references = new Set<string>();
  for (const root of roots) {
    for (const file of await listJsonlFiles(root)) {
      const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
      for await (const line of lines) {
        if (!line.includes("blob:sha256:")) continue;
        for (const match of line.matchAll(BLOB_REFERENCE)) references.add(match[1]!);
      }
    }
  }
  return references;
}

/** Deletes OMP session files idle past `maxIdleDays` unless a queued or running run uses them, then unreferenced idle blobs. */
export async function sweepOmpSessions(input: {
  sessionRoot: string;
  blobDir: string | null;
  blobScanRoots: string[];
  maxIdleDays: number;
  protectedSessionIds: ReadonlySet<string>;
  now: Date;
  scanBlobs: boolean;
}): Promise<OmpSessionSweepReport> {
  const report: OmpSessionSweepReport = {
    maxIdleDays: input.maxIdleDays,
    scannedSessions: 0,
    deletedSessions: 0,
    deletedSessionBytes: 0,
    skippedProtected: 0,
    scannedBlobs: 0,
    deletedBlobs: 0,
    deletedBlobBytes: 0,
    blobScan: "skipped",
    errors: 0,
  };
  const idleBefore = input.now.getTime() - input.maxIdleDays * DAY_MS;
  const agentDirs = await fs.readdir(input.sessionRoot, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return [];
    throw err;
  });
  for (const agentDir of agentDirs) {
    if (!agentDir.isDirectory()) continue;
    const dir = path.join(input.sessionRoot, agentDir.name);
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    const sessionBasenames = new Set(entries.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl")).map((entry) => entry.name.slice(0, -".jsonl".length)));
    for (const entry of entries) {
      const target = path.join(dir, entry.name);
      try {
        if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          report.scannedSessions += 1;
          const sessionId = SESSION_FILE.exec(entry.name)?.[1];
          if (sessionId && input.protectedSessionIds.has(sessionId)) {
            report.skippedProtected += 1;
            continue;
          }
          const stat = await fs.stat(target);
          if (stat.mtimeMs >= idleBefore) continue;
          const sidecar = target.slice(0, -".jsonl".length);
          const freed = stat.blocks * 512 + (await allocatedBytes(sidecar));
          await fs.rm(target, { force: true });
          await fs.rm(sidecar, { recursive: true, force: true });
          report.deletedSessions += 1;
          report.deletedSessionBytes += freed;
        } else if (entry.isDirectory() && !sessionBasenames.has(entry.name)) {
          const stat = await fs.stat(target);
          if (stat.mtimeMs >= idleBefore) continue;
          const freed = await allocatedBytes(target);
          await fs.rm(target, { recursive: true, force: true });
          report.deletedSessionBytes += freed;
        }
      } catch (err) {
        report.errors += 1;
        logger.warn({ err, target }, "OMP session retention skipped an entry");
      }
    }
  }

  if (!input.scanBlobs || !input.blobDir) return report;
  let references: Set<string>;
  try {
    references = await collectBlobReferences(input.blobScanRoots);
  } catch (err) {
    report.blobScan = "aborted";
    report.errors += 1;
    logger.warn({ err }, "OMP blob retention aborted: session scan failed, no blob deleted");
    return report;
  }
  const blobs = await fs.readdir(input.blobDir, { withFileTypes: true }).catch(() => []);
  for (const blob of blobs) {
    if (!blob.isFile()) continue;
    report.scannedBlobs += 1;
    const hash = blob.name.split(".")[0]!;
    if (references.has(hash)) continue;
    const target = path.join(input.blobDir, blob.name);
    try {
      const stat = await fs.stat(target);
      if (stat.mtimeMs >= idleBefore) continue;
      await fs.rm(target, { force: true });
      report.deletedBlobs += 1;
      report.deletedBlobBytes += stat.blocks * 512;
    } catch (err) {
      report.errors += 1;
      logger.warn({ err, target }, "OMP blob retention skipped a blob");
    }
  }
  report.blobScan = "done";
  return report;
}

/** Session ids a queued or running run may resume or is writing. */
export async function loadProtectedOmpSessionIds(db: Db): Promise<Set<string>> {
  const rows = await db.execute(sql`
    select r.session_id_before as before_id,
           r.session_id_after as after_id,
           ts.session_params_json ->> 'sessionId' as task_session_id,
           ts.session_display_id as task_display_id
    from heartbeat_runs r
    left join agent_task_sessions ts
      on ts.agent_id = r.agent_id
     and ts.task_key = r.context_snapshot ->> 'taskKey'
    where r.status in ('queued', 'running')
  `);
  const ids = new Set<string>();
  for (const row of rows as unknown as Array<Record<string, string | null>>) {
    for (const value of [row.before_id, row.after_id, row.task_session_id, row.task_display_id]) {
      if (value) ids.add(value);
    }
  }
  return ids;
}
