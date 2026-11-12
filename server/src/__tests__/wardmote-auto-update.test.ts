import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstanceUpdateStatus, UpdateJob } from "@tickernelz/wardmote-shared";
import { createAutoUpdater, decideAutoUpdate } from "../services/wardmote-auto-update.js";

const STATUS: InstanceUpdateStatus = {
  currentVersion: "2026.1111.0",
  latestVersion: "2026.1112.0",
  updateAvailable: true,
  channel: "latest",
  checkEnabled: true,
  checkedAt: null,
  releaseNotesUrl: null,
  install: { kind: "managed", command: "wardmote update --version 2026.1112.0", canInstall: true },
};

function job(overrides: Partial<UpdateJob>): UpdateJob {
  return {
    id: "job-1", phase: "failed", mode: "wait", trigger: "auto", fromVersion: "2026.1111.0", toVersion: "2026.1112.0",
    requestedBy: null, requestedAt: "2026-11-12T03:00:00.000Z", waitDeadline: null, liveRuns: 0,
    startedAt: "2026-11-12T03:00:01.000Z", finishedAt: "2026-11-12T03:01:00.000Z", installedVersion: "2026.1111.0",
    rolledBackTo: "2026.1111.0", error: "rolled back", logHint: null, ...overrides,
  };
}

const base = { enabled: true, status: STATUS, job: null, activeRuns: 0, queuedRuns: 0, failedVersions: [] as string[] };

describe("decideAutoUpdate", () => {
  it("installs the newer version only when enabled and nothing is running or queued", () => {
    expect(decideAutoUpdate(base)).toEqual({ install: true, version: "2026.1112.0" });
    expect(decideAutoUpdate({ ...base, enabled: false })).toEqual({ install: false, reason: "disabled" });
    expect(decideAutoUpdate({ ...base, activeRuns: 1 })).toEqual({ install: false, reason: "runs_active" });
    expect(decideAutoUpdate({ ...base, queuedRuns: 1 })).toEqual({ install: false, reason: "runs_active" });
  });

  it("never downgrades or reinstalls the running version", () => {
    for (const status of [
      { ...STATUS, latestVersion: "2026.1110.0", updateAvailable: false },
      { ...STATUS, latestVersion: "2026.1111.0", updateAvailable: false },
      { ...STATUS, latestVersion: null, updateAvailable: false },
    ]) {
      expect(decideAutoUpdate({ ...base, status })).toEqual({ install: false, reason: "no_update" });
    }
  });

  it("skips a version that already failed automatically, installs the next one, and waits for a running update", () => {
    expect(decideAutoUpdate({ ...base, failedVersions: ["2026.1112.0"] })).toEqual({ install: false, reason: "failed_before" });
    expect(decideAutoUpdate({ ...base, failedVersions: ["2026.1112.0"], status: { ...STATUS, latestVersion: "2026.1113.0" } }))
      .toEqual({ install: true, version: "2026.1113.0" });
    expect(decideAutoUpdate({ ...base, job: job({ phase: "waiting", trigger: "manual" }) })).toEqual({ install: false, reason: "busy" });
  });

  it("leaves Docker, npm, and source installs alone", () => {
    expect(decideAutoUpdate({ ...base, status: { ...STATUS, install: { kind: "docker", command: "docker pull", canInstall: false } } }))
      .toEqual({ install: false, reason: "not_installable" });
  });
});

describe("createAutoUpdater", () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "zha5799-auto-")); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  function updater(input: { enabled?: boolean; current?: UpdateJob | null; activeRuns?: number; queuedRuns?: number; status?: InstanceUpdateStatus }) {
    const start = vi.fn(async () => job({ phase: "waiting" }));
    const refresh = vi.fn(async () => undefined);
    let current = input.current ?? null;
    const auto = createAutoUpdater({
      enabled: async () => input.enabled ?? true,
      status: () => input.status ?? STATUS,
      refresh,
      installer: { current: () => current, start },
      activeRuns: () => input.activeRuns ?? 0,
      queuedRuns: async () => input.queuedRuns ?? 0,
      instanceRoot: root,
    });
    return { auto, start, refresh, setCurrent: (next: UpdateJob | null) => { current = next; } };
  }

  it("starts a wait-mode update, never force, when the instance is quiet", async () => {
    const { auto, start } = updater({});
    expect(await auto.tick()).toEqual({ install: true, version: "2026.1112.0" });
    expect(start).toHaveBeenCalledWith({ version: "2026.1112.0", mode: "wait", trigger: "auto", requestedBy: null });
  });

  it("does nothing and does not even check the registry while disabled", async () => {
    const { auto, start, refresh } = updater({ enabled: false });
    expect(await auto.tick()).toEqual({ install: false, reason: "disabled" });
    expect(refresh).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it("defers while a run is active or queued", async () => {
    for (const counts of [{ activeRuns: 2 }, { queuedRuns: 1 }]) {
      const { auto, start } = updater(counts);
      expect(await auto.tick()).toEqual({ install: false, reason: "runs_active" });
      expect(start).not.toHaveBeenCalled();
    }
  });

  it("remembers an automatic update that failed after installing so it is not retried, even after a manual job", async () => {
    const { auto, start, setCurrent } = updater({ current: job({}) });
    expect(await auto.tick()).toEqual({ install: false, reason: "failed_before" });
    setCurrent(job({ phase: "cancelled", trigger: "manual", startedAt: null }));
    expect(await auto.tick()).toEqual({ install: false, reason: "failed_before" });
    expect(start).not.toHaveBeenCalled();
  });

  it("retries a version whose automatic attempt never started installing", async () => {
    const { auto, start } = updater({ current: job({ startedAt: null, rolledBackTo: null, error: "Runs were still active" }) });
    expect(await auto.tick()).toEqual({ install: true, version: "2026.1112.0" });
    expect(start).toHaveBeenCalledTimes(1);
  });
});
