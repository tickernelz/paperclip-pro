import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstanceUpdateStatus, UpdateJob } from "@tickernelz/wardmote-shared";
import type { InstanceRunControl } from "@tickernelz/wardmote-shared/instance-drain";
import { createSystemdUpdateLauncher, createUpdateInstaller, type UpdateAuditEvent, type UpdateInstallerDeps } from "../services/wardmote-update-install.js";

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

let root: string;
const installers: Array<{ stop(): void }> = [];
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "zha5799-install-")); });
afterEach(() => {
  for (const installer of installers.splice(0)) installer.stop();
  fs.rmSync(root, { recursive: true, force: true });
});

function runs(count: number) {
  let live = count;
  let draining = false;
  const control: InstanceRunControl & { setLive(n: number): void; isDraining(): boolean } = {
    liveRuns: vi.fn(async () => ({ draining, pendingWakes: 0, count: live, runs: [] })),
    startDrain: vi.fn(async () => { draining = true; }),
    stopDrain: vi.fn(async () => { draining = false; }),
    setLive: (n) => { live = n; },
    isDraining: () => draining,
  };
  return control;
}

function installer(overrides: Partial<UpdateInstallerDeps> & { runControl: InstanceRunControl }) {
  const audits: UpdateAuditEvent[] = [];
  const launch = vi.fn(async (_job: UpdateJob, _resultPath: string) => ({ logHint: "journalctl --user -u wardmote-update-test" }));
  const created = createUpdateInstaller({
    status: () => STATUS,
    launch,
    audit: async (event) => { audits.push(structuredClone(event)); },
    instanceRoot: root,
    pollMs: 5,
    waitTimeoutMs: 5_000,
    ...overrides,
  });
  installers.push(created);
  return { installer: created, launch, audits };
}

async function until(check: () => boolean, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function writeResult(result: Record<string, unknown>) {
  fs.writeFileSync(path.join(root, "update-result.json"), JSON.stringify({ finishedAt: new Date(Date.now() + 1000).toISOString(), ...result }));
}

const admin = { actorType: "user", actorId: "admin-1" };

describe("systemd update launcher", () => {
  it("runs the managed CLI update in its own transient unit with the instance's home, shim, and exact version", async () => {
    const exec = vi.fn(async () => undefined);
    const launch = createSystemdUpdateLauncher({
      homeDir: "/srv/wm",
      instanceId: "team",
      nodePath: "/opt/node/bin/node",
      env: { WARDMOTE_SHIM_PATH: "/srv/bin/wardmote", PATH: "/opt/node/bin:/usr/bin", WARDMOTE_API_KEY: "secret" },
      exec,
    });
    const result = await launch({ id: "abcdef12-0000", toVersion: "2026.1112.0" } as UpdateJob, "/srv/wm/instances/team/update-result.json");
    expect(result.logHint).toBe("journalctl --user -u wardmote-update-team-abcdef12");
    expect(exec).toHaveBeenCalledWith("systemd-run", [
      "--user", "--collect", "--quiet", "--unit=wardmote-update-team-abcdef12",
      "--setenv", "WARDMOTE_HOME=/srv/wm",
      "--setenv", "WARDMOTE_INSTANCE_ID=team",
      "--setenv", "WARDMOTE_SHIM_PATH=/srv/bin/wardmote",
      "--setenv", "PATH=/opt/node/bin:/usr/bin",
      "/opt/node/bin/node", "/srv/wm/cli/current/node_modules/.bin/wardmote",
      "update", "--version", "2026.1112.0", "--yes", "--result-file", "/srv/wm/instances/team/update-result.json",
    ]);
  });
});

describe("update installer", () => {
  it("force starts the update at once, records the runs it cuts, and reports success after the restart", async () => {
    const control = runs(2);
    const { installer: updates, launch, audits } = installer({ runControl: control });
    const job = await updates.start({ version: "2026.1112.0", mode: "force", trigger: "manual", requestedBy: admin });
    expect(job).toMatchObject({ phase: "installing", mode: "force", liveRuns: 2, fromVersion: "2026.1111.0", toVersion: "2026.1112.0", logHint: "journalctl --user -u wardmote-update-test" });
    expect(launch).toHaveBeenCalledTimes(1);
    expect(control.startDrain).not.toHaveBeenCalled();
    writeResult({ ok: true, version: "2026.1112.0" });
    await until(() => updates.current()?.phase === "succeeded");
    expect(updates.current()).toMatchObject({ installedVersion: "2026.1112.0", error: null });
    expect(audits.map((event) => [event.action, event.job.phase])).toEqual([
      ["instance.update.requested", "installing"],
      ["instance.update.finished", "succeeded"],
    ]);
    expect(audits[0]?.job.requestedBy).toEqual(admin);
  });

  it("wait holds new runs, never turns into force on its own, and can be cancelled", async () => {
    const control = runs(1);
    const { installer: updates, launch, audits } = installer({ runControl: control });
    expect((await updates.start({ version: "2026.1112.0", mode: "wait", trigger: "manual", requestedBy: admin })).phase).toBe("waiting");
    expect(control.startDrain).toHaveBeenCalledTimes(1);
    await until(() => vi.mocked(control.liveRuns).mock.calls.length >= 20);
    expect(updates.current()).toMatchObject({ phase: "waiting", mode: "wait", liveRuns: 1 });
    expect(launch).not.toHaveBeenCalled();
    await updates.cancelWaiting();
    await until(() => updates.current()?.phase === "cancelled");
    expect(launch).not.toHaveBeenCalled();
    expect(control.isDraining()).toBe(false);
    expect(audits.at(-1)?.job.phase).toBe("cancelled");
  });

  it("wait installs once the last run finishes", async () => {
    const control = runs(1);
    const { installer: updates, launch } = installer({ runControl: control });
    await updates.start({ version: "2026.1112.0", mode: "wait", trigger: "manual", requestedBy: admin });
    control.setLive(0);
    await until(() => updates.current()?.phase === "installing");
    expect(launch).toHaveBeenCalledTimes(1);
    expect(control.isDraining()).toBe(true);
  });

  it("switching a waiting update to force installs without waiting further", async () => {
    const control = runs(3);
    const { installer: updates, launch } = installer({ runControl: control });
    await updates.start({ version: "2026.1112.0", mode: "wait", trigger: "manual", requestedBy: admin });
    await updates.forceWaiting();
    await until(() => updates.current()?.phase === "installing");
    expect(launch).toHaveBeenCalledTimes(1);
    expect(updates.current()?.mode).toBe("force");
  });

  it("gives up after the wait limit without installing and lets runs start again", async () => {
    const control = runs(1);
    const { installer: updates, launch } = installer({ runControl: control, waitTimeoutMs: 40 });
    await updates.start({ version: "2026.1112.0", mode: "wait", trigger: "manual", requestedBy: admin });
    await until(() => updates.current()?.phase === "failed");
    expect(updates.current()?.error).toContain("nothing was installed");
    expect(launch).not.toHaveBeenCalled();
    expect(control.isDraining()).toBe(false);
  });

  it("reports a failed update that rolled back, with the log hint", async () => {
    const control = runs(0);
    const { installer: updates } = installer({ runControl: control });
    await updates.start({ version: "2026.1112.0", mode: "force", trigger: "manual", requestedBy: admin });
    writeResult({ ok: false, version: "2026.1111.0", rolledBackTo: "2026.1111.0", error: "Updated payload failed service validation and was rolled back to 2026.1111.0." });
    await until(() => updates.current()?.phase === "failed");
    expect(updates.current()).toMatchObject({ rolledBackTo: "2026.1111.0", logHint: "journalctl --user -u wardmote-update-test" });
  });

  it("finishes the job after the server restarted mid-update", async () => {
    const control = runs(0);
    const first = installer({ runControl: control });
    await first.installer.start({ version: "2026.1112.0", mode: "force", trigger: "manual", requestedBy: admin });
    first.installer.stop();
    writeResult({ ok: true, version: "2026.1112.0" });
    const restarted = installer({ runControl: control });
    expect(restarted.installer.current()?.phase).toBe("installing");
    restarted.installer.resume();
    await until(() => restarted.installer.current()?.phase === "succeeded");
    expect(restarted.audits.map((event) => event.action)).toEqual(["instance.update.finished"]);
  });

  it("refuses non-managed installs, other versions, and a second update", async () => {
    const control = runs(0);
    const docker = installer({ runControl: control, status: () => ({ ...STATUS, install: { kind: "docker", command: "docker pull", canInstall: false } }) });
    await expect(docker.installer.start({ version: "2026.1112.0", mode: "force", trigger: "manual", requestedBy: admin })).rejects.toMatchObject({ status: 422 });
    expect(docker.launch).not.toHaveBeenCalled();
    const managed = installer({ runControl: control });
    await expect(managed.installer.start({ version: "2026.1110.0", mode: "force", trigger: "manual", requestedBy: admin })).rejects.toMatchObject({ status: 422 });
    await managed.installer.start({ version: "2026.1112.0", mode: "force", trigger: "manual", requestedBy: admin });
    await expect(managed.installer.start({ version: "2026.1112.0", mode: "force", trigger: "manual", requestedBy: admin })).rejects.toMatchObject({ status: 409 });
    expect(managed.launch).toHaveBeenCalledTimes(1);
  });
});
