import { createReadStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { sql } from "drizzle-orm";
import type { Db } from "@tickernelz/wardmote-db";
import { logger } from "../middleware/logger.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const BLOB_REFERENCE = /\bblob:sha256:([a-f0-9]{64})\b/gi;
const BLOB_FILE = /^([a-f0-9]{64})(?:\.[A-Za-z0-9][A-Za-z0-9._-]{0,31})?$/;
const SESSION_FILE = /_([^_]+)\.jsonl$/;
const SESSION_TRANSCRIPT = /\.jsonl(?:\.gz|\.[^/]*\.bak)?$/;

export interface OmpSessionSweepReport {
  maxIdleDays: number;
  scannedSessions: number;
  deletedSessions: number;
  deletedSessionBytes: number;
  skippedProtected: number;
  scannedBlobs: number;
  deletedBlobs: number;
  deletedBlobBytes: number;
  blobScan: "done" | "skipped" | "aborted" | "gc_locked";
  referencedBlobs: number;
  errors: number;
}

export function defaultOmpAgentDir() {
  return path.join(os.homedir(), ".omp", "agent");
}

/** Every place OMP keeps transcripts that may reference blobs, mirroring `omp gc`. */
export async function collectOmpTranscriptSources(input: { agentDir: string; extraRoots: string[] }) {
  const relative = input.extraRoots.filter((root) => !path.isAbsolute(root));
  if (relative.length > 0) {
    throw new Error(`OMP session directories with a relative path cannot be scanned: ${relative.join(", ")}`);
  }
  const roots = [
    ...input.extraRoots,
    path.join(input.agentDir, "sessions"),
    path.join(input.agentDir, "archive", "sessions"),
  ];
  const exactFiles = new Set<string>();
  for (const entry of await readdirIfPresent(path.join(input.agentDir, "custom-session-files"))) {
    const recorded = (await readTextIfPresent(path.join(input.agentDir, "custom-session-files", entry))).trim();
    if (recorded) exactFiles.add(path.resolve(recorded));
  }
  for (const entry of await readdirIfPresent(path.join(input.agentDir, "terminal-sessions"))) {
    const [cwd, file] = (await readTextIfPresent(path.join(input.agentDir, "terminal-sessions", entry))).split("\n").map((line) => line.trim());
    if (cwd && file) exactFiles.add(path.resolve(cwd, file));
  }
  return { roots: [...new Set(roots.map((root) => path.resolve(root)))], exactFiles: [...exactFiles] };
}

async function readdirIfPresent(dir: string): Promise<string[]> {
  return fs.readdir(dir).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT" || err.code === "ENOTDIR") return [] as string[];
    throw err;
  });
}

async function readTextIfPresent(file: string): Promise<string> {
  return fs.readFile(file, "utf8").catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT" || err.code === "EISDIR") return "";
    throw err;
  });
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

async function listTranscriptFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { recursive: true }).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return [] as string[];
    throw err;
  });
  return entries.filter((entry) => SESSION_TRANSCRIPT.test(entry)).map((entry) => path.join(root, entry));
}

async function scanTranscript(file: string, references: Set<string>) {
  let input: Readable = createReadStream(file);
  try {
    await new Promise<void>((resolveOpen, rejectOpen) => {
      input.once("open", () => resolveOpen());
      input.once("error", rejectOpen);
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  let failure: unknown = null;
  input.on("error", (err) => {
    failure ??= err;
  });
  if (file.endsWith(".gz")) {
    const gunzip = createGunzip();
    gunzip.on("error", (err) => {
      failure ??= err;
    });
    input.once("error", (err) => gunzip.destroy(err));
    input = input.pipe(gunzip);
  }
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    if (!line.includes("blob:sha256:")) continue;
    for (const match of line.matchAll(BLOB_REFERENCE)) references.add(match[1]!.toLowerCase());
  }
  if (failure) throw failure;
}

async function collectBlobReferences(sources: { roots: string[]; exactFiles: string[] }): Promise<Set<string>> {
  const files = new Set(sources.exactFiles);
  for (const root of sources.roots) {
    for (const file of await listTranscriptFiles(root)) files.add(file);
  }
  const references = new Set<string>();
  for (const file of files) await scanTranscript(file, references);
  return references;
}

/** Deletes OMP session files idle past `maxIdleDays` unless a queued or running run uses them, then unreferenced idle blobs. */
export async function sweepOmpSessions(input: {
  sessionRoot: string | null;
  blobDir: string | null;
  agentDir: string;
  extraTranscriptRoots: string[];
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
    referencedBlobs: 0,
    errors: 0,
  };
  if (!input.sessionRoot) return report;
  const sessionRoot = input.sessionRoot;
  const idleBefore = input.now.getTime() - input.maxIdleDays * DAY_MS;
  const agentDirs = await fs.readdir(sessionRoot, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return [];
    throw err;
  });
  for (const agentDir of agentDirs) {
    if (!agentDir.isDirectory()) continue;
    const dir = path.join(sessionRoot, agentDir.name);
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
  const gcLock = await fs.stat(path.join(input.agentDir, "gc.lock")).catch(() => null);
  if (gcLock) {
    report.blobScan = "gc_locked";
    return report;
  }
  let references: Set<string>;
  try {
    references = await collectBlobReferences(
      await collectOmpTranscriptSources({ agentDir: input.agentDir, extraRoots: [sessionRoot, ...input.extraTranscriptRoots] }),
    );
    report.referencedBlobs = references.size;
  } catch (err) {
    report.blobScan = "aborted";
    report.errors += 1;
    logger.warn({ err }, "OMP blob retention aborted: session scan failed, no blob deleted");
    return report;
  }
  const blobs = await fs.readdir(input.blobDir, { withFileTypes: true }).catch(() => []);
  for (const blob of blobs) {
    if (!blob.isFile()) continue;
    const hash = BLOB_FILE.exec(blob.name)?.[1];
    if (!hash) continue;
    report.scannedBlobs += 1;
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

/** Session directories configured per agent or recorded per task that may sit outside the default root. */
export async function loadOmpSessionDirs(db: Db): Promise<string[]> {
  const rows = await db.execute(sql`
    select distinct session_params_json ->> 'sessionDir' as dir
    from agent_task_sessions
    where adapter_type = 'omp_local' and session_params_json ->> 'sessionDir' is not null
    union
    select distinct adapter_config ->> 'sessionDir' as dir
    from agents
    where adapter_type = 'omp_local' and adapter_config ->> 'sessionDir' is not null
  `);
  const dirs = new Set<string>();
  for (const row of rows as unknown as Array<{ dir: string | null }>) {
    const dir = row.dir?.trim();
    if (dir) dirs.add(path.isAbsolute(dir) ? path.resolve(dir) : dir);
  }
  return [...dirs];
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
