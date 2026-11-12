import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runLogRetentionConfigSchema, diskGuardConfigSchema } from "@tickernelz/wardmote-shared";

const liveRefs = vi.hoisted(() => ({ value: new Set<string>() }));
const activity = vi.hoisted(() => ({ calls: [] as Array<{ action: string; details: Record<string, unknown> }> }));

vi.mock("./run-log-retention.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./run-log-retention.js")>()),
  loadLiveRunLogRefs: async () => liveRefs.value,
}));
vi.mock("./omp-session-retention.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./omp-session-retention.js")>()),
  loadProtectedOmpSessionIds: async () => new Set<string>(),
  loadOmpSessionDirs: async () => [],
}));
vi.mock("./activity-log.js", () => ({
  logActivity: async (_db: unknown, input: { action: string; details: Record<string, unknown> }) => {
    activity.calls.push({ action: input.action, details: input.details });
  },
}));

const { assessDiskPressure, diskGuardService } = await import("./disk-guard.js");
const { readDiskEmergencyHold, setDiskEmergencyHold } = await import("./disk-emergency-hold.js");

const GB = 1024 ** 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const roots: string[] = [];

beforeEach(() => {
  liveRefs.value = new Set();
  activity.calls = [];
  setDiskEmergencyHold(null);
});

afterEach(() => {
  while (roots.length > 0) fs.rmSync(roots.pop()!, { recursive: true, force: true });
  setDiskEmergencyHold(null);
});

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "disk-guard-"));
  roots.push(root);
  return root;
}

function writeLog(file: string, bytes: number, daysAgo: number) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${"x".repeat(127)}\n`.repeat(Math.ceil(bytes / 128)));
  const at = new Date(Date.now() - daysAgo * DAY_MS);
  fs.utimesSync(file, at, at);
}

const config = diskGuardConfigSchema.parse({});
const runLogSettings = runLogRetentionConfigSchema.parse({});

function guard(root: string, freePercent: () => number) {
  return diskGuardService({} as never, {
    config,
    paths: [root],
    runLogBasePath: path.join(root, "run-logs"),
    runLogSettings,
    ompSessionRoot: path.join(root, "sessions"),
    ompBlobDir: null,
    ompAgentDir: path.join(root, "agent"),
    listCompanyIds: async () => ["company-1"],
    statfs: (target) => ({ path: target, totalBytes: 1000 * GB, freeBytes: (freePercent() / 100) * 1000 * GB }),
  });
}

describe("assessDiskPressure", () => {
  it.each([
    [40, 1000, "ok"],
    [15, 1000, "warning"],
    [25, 200, "warning"],
    [8, 1000, "action"],
    [3, 1000, "emergency"],
  ] as const)("%s%% free of %s GB is %s", (percent, totalGb, level) => {
    expect(assessDiskPressure({ freeBytes: (percent / 100) * totalGb * GB, totalBytes: totalGb * GB }, config)).toBe(level);
  });
});

describe("diskGuardService", () => {
  it("at the emergency level trims and deletes finished logs, never live ones, holds runs and notifies", async () => {
    const root = tempRoot();
    const finished = path.join(root, "run-logs", "company", "finished.ndjson");
    const live = path.join(root, "run-logs", "company", "live.ndjson");
    writeLog(finished, 512 * 1024, 3);
    writeLog(live, 512 * 1024, 3);
    const liveBefore = fs.readFileSync(live);
    liveRefs.value = new Set([path.join("company", "live.ndjson")]);

    const status = await guard(root, () => 3).tick();

    expect(status).toMatchObject({ level: "emergency", holdingRuns: true });
    expect(fs.existsSync(finished)).toBe(false);
    expect(fs.readFileSync(live)).toEqual(liveBefore);
    expect(readDiskEmergencyHold()).not.toBeNull();
    expect(activity.calls.map((call) => call.action)).toEqual(
      expect.arrayContaining(["instance.disk_guard.cleanup", "instance.disk_space.emergency"]),
    );
    const cleanup = activity.calls.find((call) => call.action === "instance.disk_guard.cleanup")!;
    expect(cleanup.details).toMatchObject({ freeBytesBefore: 30 * GB, totalBytes: 1000 * GB });
  });

  it("at the action level only trims finished logs and keeps runs flowing", async () => {
    const root = tempRoot();
    const finished = path.join(root, "run-logs", "company", "finished.ndjson");
    writeLog(finished, 512 * 1024, 3);

    const status = await guard(root, () => 8).tick();

    expect(status).toMatchObject({ level: "action", holdingRuns: false });
    expect(fs.existsSync(finished)).toBe(true);
    expect(fs.statSync(finished).blocks * 512).toBeLessThan(512 * 1024);
    expect(readDiskEmergencyHold()).toBeNull();
  });

  it("releases the run hold once space recovers and records the level change", async () => {
    const root = tempRoot();
    let percent = 3;
    const service = guard(root, () => percent);
    await service.tick();
    expect(readDiskEmergencyHold()).not.toBeNull();

    percent = 40;
    activity.calls = [];
    const status = await service.tick();

    expect(status).toMatchObject({ level: "ok", holdingRuns: false });
    expect(readDiskEmergencyHold()).toBeNull();
    expect(activity.calls).toEqual([
      expect.objectContaining({ action: "instance.disk_space.level_changed", details: expect.objectContaining({ level: "ok", previousLevel: "emergency" }) }),
    ]);
  });
});
