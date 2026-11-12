import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sweepOmpSessions } from "./omp-session-retention.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-session-retention-"));
  roots.push(root);
  return root;
}

function write(file: string, content: string, daysAgo: number) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  const at = new Date(Date.now() - daysAgo * DAY_MS);
  fs.utimesSync(file, at, at);
}

function age(target: string, daysAgo: number) {
  const at = new Date(Date.now() - daysAgo * DAY_MS);
  fs.utimesSync(target, at, at);
}

const hash = (char: string) => char.repeat(64);

describe("sweepOmpSessions", () => {
  it("deletes idle sessions, their sidecars and unreferenced idle blobs, keeping protected, recent and referenced ones", async () => {
    const root = tempRoot();
    const sessionRoot = path.join(root, "sessions");
    const blobDir = path.join(root, "blobs");
    const agentDir = path.join(sessionRoot, "agent-a");
    const oldSession = path.join(agentDir, "2026-10-01T00-00-00-000Z_old-session.jsonl");
    write(oldSession, `{"data":"blob:sha256:${hash("d")}"}\n`, 10);
    fs.mkdirSync(oldSession.slice(0, -".jsonl".length));
    age(oldSession.slice(0, -".jsonl".length), 10);
    const liveSession = path.join(agentDir, "2026-10-01T00-00-00-000Z_live-session.jsonl");
    write(liveSession, "{}\n", 10);
    const recentSession = path.join(agentDir, "2026-11-11T00-00-00-000Z_recent-session.jsonl");
    write(recentSession, `{"data":"blob:sha256:${hash("a")}"}\n`, 1);
    const orphanSidecar = path.join(agentDir, "2026-09-01T00-00-00-000Z_gone");
    fs.mkdirSync(orphanSidecar);
    age(orphanSidecar, 30);
    write(path.join(blobDir, hash("a")), "referenced", 20);
    write(path.join(blobDir, `${hash("b")}.webp`), "unreferenced", 20);
    write(path.join(blobDir, hash("c")), "recent", 1);
    write(path.join(blobDir, hash("d")), "only the deleted session", 20);

    const report = await sweepOmpSessions({
      sessionRoot,
      blobDir,
      blobScanRoots: [sessionRoot],
      maxIdleDays: 7,
      protectedSessionIds: new Set(["live-session"]),
      now: new Date(),
      scanBlobs: true,
    });

    expect(fs.existsSync(oldSession)).toBe(false);
    expect(fs.existsSync(oldSession.slice(0, -".jsonl".length))).toBe(false);
    expect(fs.existsSync(orphanSidecar)).toBe(false);
    expect(fs.existsSync(liveSession)).toBe(true);
    expect(fs.existsSync(recentSession)).toBe(true);
    expect(fs.readdirSync(blobDir).sort()).toEqual([hash("a"), hash("c")]);
    expect(report).toMatchObject({
      scannedSessions: 3,
      deletedSessions: 1,
      skippedProtected: 1,
      scannedBlobs: 4,
      deletedBlobs: 2,
      blobScan: "done",
    });
  });

  it("keeps every blob when a referencing session cannot be read", async () => {
    const root = tempRoot();
    const sessionRoot = path.join(root, "sessions");
    const blobDir = path.join(root, "blobs");
    write(path.join(blobDir, hash("e")), "blob", 20);
    const unreadable = path.join(sessionRoot, "agent-a", "2026-11-11T00-00-00-000Z_recent.jsonl");
    write(unreadable, `{"data":"blob:sha256:${hash("e")}"}\n`, 1);
    fs.chmodSync(unreadable, 0o000);
    if (process.getuid?.() === 0) return;

    const report = await sweepOmpSessions({
      sessionRoot,
      blobDir,
      blobScanRoots: [sessionRoot],
      maxIdleDays: 7,
      protectedSessionIds: new Set(),
      now: new Date(),
      scanBlobs: true,
    });

    fs.chmodSync(unreadable, 0o600);
    expect(report.blobScan).toBe("aborted");
    expect(fs.existsSync(path.join(blobDir, hash("e")))).toBe(true);
  });
});
