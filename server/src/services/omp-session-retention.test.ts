import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { sweepOmpSessions } from "./omp-session-retention.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop()!;
    fs.chmodSync(root, 0o700);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-session-retention-"));
  roots.push(root);
  return root;
}

function write(file: string, content: string | Buffer, daysAgo: number) {
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
const ref = (char: string) => `{"data":"blob:sha256:${hash(char)}"}\n`;

function layout() {
  const root = tempRoot();
  return {
    root,
    sessionRoot: path.join(root, "paperclip-sessions"),
    agentDir: path.join(root, "agent"),
    blobDir: path.join(root, "agent", "blobs"),
  };
}

function sweep(dirs: ReturnType<typeof layout>, overrides: Partial<Parameters<typeof sweepOmpSessions>[0]> = {}) {
  return sweepOmpSessions({
    sessionRoot: dirs.sessionRoot,
    blobDir: dirs.blobDir,
    agentDir: dirs.agentDir,
    extraTranscriptRoots: [],
    maxIdleDays: 7,
    protectedSessionIds: new Set(),
    now: new Date(),
    scanBlobs: true,
    ...overrides,
  });
}

describe("sweepOmpSessions", () => {
  it("deletes idle sessions, their sidecars and unreferenced idle blobs, keeping protected, recent and referenced ones", async () => {
    const dirs = layout();
    const agentDir = path.join(dirs.sessionRoot, "agent-a");
    const oldSession = path.join(agentDir, "2026-10-01T00-00-00-000Z_old-session.jsonl");
    write(oldSession, ref("d"), 10);
    fs.mkdirSync(oldSession.slice(0, -".jsonl".length));
    age(oldSession.slice(0, -".jsonl".length), 10);
    const liveSession = path.join(agentDir, "2026-10-01T00-00-00-000Z_live-session.jsonl");
    write(liveSession, "{}\n", 10);
    const recentSession = path.join(agentDir, "2026-11-11T00-00-00-000Z_recent-session.jsonl");
    write(recentSession, ref("a"), 1);
    const orphanSidecar = path.join(agentDir, "2026-09-01T00-00-00-000Z_gone");
    fs.mkdirSync(orphanSidecar);
    age(orphanSidecar, 30);
    write(path.join(dirs.blobDir, hash("a")), "referenced", 20);
    write(path.join(dirs.blobDir, `${hash("b")}.webp`), "unreferenced", 20);
    write(path.join(dirs.blobDir, hash("c")), "recent", 1);
    write(path.join(dirs.blobDir, hash("d")), "only the deleted session", 20);

    const report = await sweep(dirs, { protectedSessionIds: new Set(["live-session"]) });

    expect(fs.existsSync(oldSession)).toBe(false);
    expect(fs.existsSync(oldSession.slice(0, -".jsonl".length))).toBe(false);
    expect(fs.existsSync(orphanSidecar)).toBe(false);
    expect(fs.existsSync(liveSession)).toBe(true);
    expect(fs.existsSync(recentSession)).toBe(true);
    expect(fs.readdirSync(dirs.blobDir).sort()).toEqual([hash("a"), hash("c")]);
    expect(report).toMatchObject({
      scannedSessions: 3,
      deletedSessions: 1,
      skippedProtected: 1,
      scannedBlobs: 4,
      deletedBlobs: 2,
      blobScan: "done",
    });
  });

  it("keeps blobs referenced from every transcript form and location OMP uses", async () => {
    const dirs = layout();
    const outside = path.join(dirs.root, "outside");
    write(path.join(dirs.agentDir, "sessions", "-repo", "live.jsonl"), ref("a"), 1);
    write(path.join(dirs.agentDir, "archive", "sessions", "-repo", "old_x.jsonl.gz"), gzipSync(ref("b")), 40);
    write(path.join(dirs.agentDir, "sessions", "-repo", "s2.jsonl.1.bak"), ref("c"), 40);
    write(path.join(outside, "custom", "pinned-session.jsonl"), ref("d"), 1);
    write(path.join(dirs.agentDir, "custom-session-files", "marker"), path.join(outside, "custom", "pinned-session.jsonl"), 1);
    write(path.join(outside, "term", "named.jsonl"), ref("e"), 1);
    write(path.join(dirs.agentDir, "terminal-sessions", "pts-0"), `${path.join(outside, "term")}\nnamed.jsonl\n`, 1);
    write(path.join(outside, "agent-dir", "x.jsonl"), ref("f").toUpperCase().replace("BLOB:SHA256:", "blob:sha256:"), 1);
    write(path.join(dirs.agentDir, "custom-session-files", "gone"), path.join(outside, "missing.jsonl"), 1);
    for (const char of ["a", "b", "c", "d", "e", "f", "9"]) write(path.join(dirs.blobDir, hash(char)), char, 30);
    write(path.join(dirs.blobDir, `.${hash("8")}.0123456789abcdef.tmp`), "staging", 30);
    write(path.join(dirs.blobDir, "notes.txt"), "not a blob", 30);

    const report = await sweep(dirs, { extraTranscriptRoots: [path.join(outside, "agent-dir")] });

    expect(report.blobScan).toBe("done");
    expect(fs.readdirSync(dirs.blobDir).sort()).toEqual(
      [...["a", "b", "c", "d", "e", "f"].map(hash), `.${hash("8")}.0123456789abcdef.tmp`, "notes.txt"].sort(),
    );
    expect(report).toMatchObject({ deletedBlobs: 1, referencedBlobs: 6 });
  });

  it("deletes no blob while omp gc holds its lock", async () => {
    const dirs = layout();
    write(path.join(dirs.blobDir, hash("a")), "blob", 30);
    write(path.join(dirs.agentDir, "gc.lock"), "", 0);

    const report = await sweep(dirs);

    expect(report.blobScan).toBe("gc_locked");
    expect(fs.existsSync(path.join(dirs.blobDir, hash("a")))).toBe(true);
  });

  it.each([
    ["an unreadable transcript", (file: string) => {
      write(file, ref("e"), 1);
      fs.chmodSync(file, 0o000);
    }, "s.jsonl"],
    ["a corrupt archived transcript", (file: string) => write(file, gzipSync(ref("e")).subarray(0, 20), 40), "s.jsonl.gz"],
  ])("keeps every blob when %s cannot be scanned", async (_label, prepare, name) => {
    if (process.getuid?.() === 0) return;
    const dirs = layout();
    write(path.join(dirs.blobDir, hash("e")), "blob", 20);
    prepare(path.join(dirs.agentDir, "sessions", "-repo", name));

    const report = await sweep(dirs);

    expect(report.blobScan).toBe("aborted");
    expect(fs.existsSync(path.join(dirs.blobDir, hash("e")))).toBe(true);
  });

  it("keeps every blob when an agent session directory is relative and cannot be located", async () => {
    const dirs = layout();
    write(path.join(dirs.blobDir, hash("e")), "blob", 20);

    const report = await sweep(dirs, { extraTranscriptRoots: ["relative/sessions"] });

    expect(report.blobScan).toBe("aborted");
    expect(fs.existsSync(path.join(dirs.blobDir, hash("e")))).toBe(true);
  });

  it("touches nothing when the session sweep is disabled for this instance", async () => {
    const dirs = layout();
    const session = path.join(dirs.sessionRoot, "agent-a", "2026-10-01T00-00-00-000Z_old.jsonl");
    write(session, "{}\n", 30);
    write(path.join(dirs.blobDir, hash("a")), "blob", 30);

    const report = await sweep(dirs, { sessionRoot: null, blobDir: null });

    expect(fs.existsSync(session)).toBe(true);
    expect(fs.existsSync(path.join(dirs.blobDir, hash("a")))).toBe(true);
    expect(report).toMatchObject({ scannedSessions: 0, blobScan: "skipped" });
  });
});
