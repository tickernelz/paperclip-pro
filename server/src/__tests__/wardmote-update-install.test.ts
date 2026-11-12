import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstanceUpdateStatus, UpdateJob } from "@tickernelz/wardmote-shared";
import type { InstanceRunControl } from "@tickernelz/wardmote-shared/instance-drain";
import {
  createSystemdUnitState,
  createSystemdUpdateLauncher,
  createUpdateInstaller,
  UPDATE_INSTALL_DEADLINE_MS,
  type UpdateAuditEvent,
  type UpdateInstallerDeps,
  type UpdateUnitState,
} from "../services/wardmote-update-install.js";

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
    startDrain: vi.fn(async (_ttlMs: number | null) => { draining = true; }),
    stopDrain: vi.fn(async () => { draining = false; }),
    setLive: (n) => { live = n; },
    isDraining: () => draining,
  };
  return control;
}

function installer(overrides: Partial<UpdateInstallerDeps> & { runControl: InstanceRunControl; unit?: { state: UpdateUnitState } }) {
  const audits: UpdateAuditEvent[] = [];
  const unit = overrides.unit ?? { state: "running" as UpdateUnitState };
  const launch = vi.fn(async (_job: UpdateJob, _resultPath: string) => ({ logHint: "journalctl --user -u wardmote-update-test", unit: "wardmote-update-test" }));
  const unitState = vi.fn(async (_unit: string) => unit.state);
  const created = createUpdateInstaller({
    status: () => STATUS,
    launch,
    unitState,
    audit: async (event) => { audits.push(structuredClone(event)); },
    instanceRoot: root,
    pollMs: 5,
    waitTimeoutMs: 5_000,
    ...overrides,
  });
  installers.push(created);
  return { installer: created, launch, audits, unitState };
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
  function managedHome(executable = true) {
    const bin = path.join(root, "cli", "current", "node_modules", ".bin");
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, "wardmote"), "#!/bin/sh\n", { mode: executable ? 0o755 : 0o644 });
    return root;
  }

  it("runs the managed CLI update in its own transient unit with the instance's home, shim, and exact version", async () => {
    const home = managedHome();
    const exec = vi.fn(async () => undefined);
    const launch = createSystemdUpdateLauncher({
      homeDir: home,
      instanceId: "team",
      nodePath: "/opt/node/bin/node",
      env: { WARDMOTE_SHIM_PATH: "/srv/bin/wardmote", PATH: "/opt/node/bin:/usr/bin", WARDMOTE_API_KEY: "secret" },
      exec,
    });
    const result = await launch({ id: "abcdef12-0000", toVersion: "2026.1112.0" } as UpdateJob, "/srv/wm/instances/team/update-result.json");
    expect(result).toEqual({ logHint: "journalctl --user -u wardmote-update-team-abcdef12", unit: "wardmote-update-team-abcdef12" });
    expect(exec).toHaveBeenCalledWith("systemd-run", [
      "--user", "--collect", "--quiet", "--unit=wardmote-update-team-abcdef12",
      "--setenv", `WARDMOTE_HOME=${home}`,
      "--setenv", "WARDMOTE_INSTANCE_ID=team",
      "--setenv", "WARDMOTE_SHIM_PATH=/srv/bin/wardmote",
      "--setenv", "PATH=/opt/node/bin:/usr/bin",
      "/opt/node/bin/node", path.join(home, "cli/current/node_modules/.bin/wardmote"),
      "update", "--version", "2026.1112.0", "--yes", "--result-file", "/srv/wm/instances/team/update-result.json",
    ]);
  });

  it("refuses to start a unit when the managed command is missing or not executable", async () => {
    for (const home of [path.join(root, "empty"), managedHome(false)]) {
      const exec = vi.fn(async () => undefined);
      const launch = createSystemdUpdateLauncher({ homeDir: home, instanceId: "team", exec });
      await expect(launch({ id: "abcdef12-0000", toVersion: "2026.1112.0" } as UpdateJob, "/tmp/r.json")).rejects.toThrow("missing or not executable");
      expect(exec).not.toHaveBeenCalled();
    }
  });

  it("a missing managed command ends the job failed and reopens admission instead of leaving it installing", async () => {
    const control = runs(1);
    const { installer: updates } = installer({
      runControl: control,
      launch: createSystemdUpdateLauncher({ homeDir: path.join(root, "empty"), instanceId: "team", exec: vi.fn(async () => undefined) }),
    });
    const job = await updates.start({ version: "2026.1112.0", mode: "force", trigger: "manual", requestedBy: admin });
    expect(job.phase).toBe("failed");
    expect(job.error).toContain("could not be started");
    expect(control.isDraining()).toBe(false);
  });

  it("reads the transient unit state from systemctl", async () => {
    const answer = (stdout: string) => createSystemdUnitState(vi.fn(async () => ({ stdout })));
    expect(await answer("LoadState=not-found\nActiveState=inactive\n")("u")).toBe("gone");
    expect(await answer("LoadState=loaded\nActiveState=failed\n")("u")).toBe("gone");
    expect(await answer("LoadState=loaded\nActiveState=active\n")("u")).toBe("running");
    expect(await answer("LoadState=loaded\nActiveState=activating\n")("u")).toBe("running");
    expect(await createSystemdUnitState(vi.fn(async () => { throw new Error("no bus"); }))("u")).toBe("unknown");
  });
});

describe("update installer", () => {
  it("force starts the update at once, records the runs it cuts, and reports success after the restart", async () => {
    const control = runs(2);
    const { installer: updates, launch, audits } = installer({ runControl: control });
    const job = await updates.start({ version: "2026.1112.0", mode: "force", trigger: "manual", requestedBy: admin });
    expect(job).toMatchObject({ phase: "installing", mode: "force", liveRuns: 2, fromVersion: "2026.1111.0", toVersion: "2026.1112.0", logHint: "journalctl --user -u wardmote-update-test" });
    expect(launch).toHaveBeenCalledTimes(1);
    expect(control.startDrain).toHaveBeenCalledExactlyOnceWith(UPDATE_INSTALL_DEADLINE_MS + 60_000);
    expect(control.isDraining()).toBe(true);
    writeResult({ ok: true, version: "2026.1112.0" });
    await until(() => updates.current()?.phase === "succeeded");
    expect(updates.current()).toMatchObject({ installedVersion: "2026.1112.0", error: null });
    expect(control.isDraining()).toBe(false);
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

  it("switching a waiting update to force installs without waiting further and never reopens admission", async () => {
    const control = runs(3);
    const { installer: updates, launch } = installer({ runControl: control });
    await updates.start({ version: "2026.1112.0", mode: "wait", trigger: "manual", requestedBy: admin });
    await updates.forceWaiting();
    await until(() => updates.current()?.phase === "installing");
    expect(launch).toHaveBeenCalledTimes(1);
    expect(updates.current()?.mode).toBe("force");
    expect(control.stopDrain).not.toHaveBeenCalled();
    expect(vi.mocked(control.startDrain).mock.calls.at(-1)).toEqual([UPDATE_INSTALL_DEADLINE_MS + 60_000]);
  });

  it("fails the job and reopens admission when the update process exits without a result", async () => {
    const control = runs(0);
    const unit = { state: "running" as UpdateUnitState };
    const { installer: updates, audits } = installer({ runControl: control, unit });
    await updates.start({ version: "2026.1112.0", mode: "force", trigger: "auto", requestedBy: null });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(updates.current()?.phase).toBe("installing");
    unit.state = "gone";
    await until(() => updates.current()?.phase === "failed");
    expect(updates.current()).toMatchObject({ trigger: "auto", unit: "wardmote-update-test" });
    expect(updates.current()?.error).toContain("exited without reporting a result");
    expect(updates.current()?.error).toContain("journalctl --user -u wardmote-update-test");
    expect(control.isDraining()).toBe(false);
    expect(audits.at(-1)?.job.phase).toBe("failed");
    await expect(updates.start({ version: "2026.1112.0", mode: "force", trigger: "manual", requestedBy: admin })).resolves.toMatchObject({ phase: "installing" });
  });

  it("keeps a result written just before the process exited", async () => {
    const control = runs(0);
    const unit = { state: "running" as UpdateUnitState };
    const { installer: updates, unitState } = installer({ runControl: control, unit });
    await updates.start({ version: "2026.1112.0", mode: "force", trigger: "manual", requestedBy: admin });
    unitState.mockImplementationOnce(async () => {
      writeResult({ ok: true, version: "2026.1112.0" });
      return "gone";
    });
    await until(() => updates.current()?.phase === "succeeded");
  });

  it("after a restart, ends a job whose update process is already gone", async () => {
    const control = runs(0);
    const first = installer({ runControl: control });
    await first.installer.start({ version: "2026.1112.0", mode: "force", trigger: "manual", requestedBy: admin });
    first.installer.stop();
    const restarted = installer({ runControl: control, unit: { state: "gone" } });
    restarted.installer.resume();
    await until(() => restarted.installer.current()?.phase === "failed");
    expect(restarted.unitState).toHaveBeenCalledWith("wardmote-update-test");
  });

  it("gives up after the hard deadline even when the unit state is unknown", async () => {
    const control = runs(0);
    let clock = Date.UTC(2026, 10, 12, 8);
    const { installer: updates } = installer({ runControl: control, unit: { state: "unknown" }, now: () => clock });
    await updates.start({ version: "2026.1112.0", mode: "force", trigger: "manual", requestedBy: admin });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(updates.current()?.phase).toBe("installing");
    clock += UPDATE_INSTALL_DEADLINE_MS;
    await until(() => updates.current()?.phase === "failed");
    expect(updates.current()?.error).toContain("within 45 minutes");
  });

  it("keeps waiting and keeps admission closed while the update unit still runs past the deadline", async () => {
    const control = runs(0);
    let clock = Date.UTC(2026, 10, 12, 8);
    const { installer: updates } = installer({ runControl: control, unit: { state: "running" }, now: () => clock });
    await updates.start({ version: "2026.1112.0", mode: "force", trigger: "manual", requestedBy: admin });
    clock += UPDATE_INSTALL_DEADLINE_MS + 10 * 60_000;
    await until(() => vi.mocked(control.startDrain).mock.calls.length === 2);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(updates.current()).toMatchObject({ phase: "installing", error: null });
    expect(control.isDraining()).toBe(true);
    expect(control.startDrain).toHaveBeenCalledTimes(2);
    writeResult({ ok: true, version: "2026.1112.0", finishedAt: new Date(clock + 60_000).toISOString() });
    await until(() => updates.current()?.phase === "succeeded");
    expect(control.isDraining()).toBe(false);
  });

  it("shows the real outcome when the result arrives after the job was given up", async () => {
    const control = runs(0);
    let clock = Date.UTC(2026, 10, 12, 8);
    const { installer: updates, audits } = installer({ runControl: control, unit: { state: "unknown" }, now: () => clock });
    await updates.start({ version: "2026.1112.0", mode: "force", trigger: "manual", requestedBy: admin });
    clock += UPDATE_INSTALL_DEADLINE_MS;
    await until(() => updates.current()?.phase === "failed");
    const resultFinishedAt = new Date(clock + 5 * 60_000).toISOString();
    writeResult({ ok: true, version: "2026.1112.0", finishedAt: resultFinishedAt });
    expect(updates.current()).toMatchObject({ phase: "succeeded", installedVersion: "2026.1112.0", error: null, finishedAt: resultFinishedAt });
    updates.current();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(audits.map((event) => event.job.phase)).toEqual(["installing", "failed", "succeeded"]);
  });

  it("does not rewrite a failure that already came from the update's own result", async () => {
    const control = runs(0);
    const { installer: updates, audits } = installer({ runControl: control });
    await updates.start({ version: "2026.1112.0", mode: "force", trigger: "manual", requestedBy: admin });
    writeResult({ ok: false, error: "npm install failed" });
    await until(() => updates.current()?.phase === "failed");
    const finished = updates.current();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(updates.current()).toEqual(finished);
    expect(audits.filter((event) => event.action === "instance.update.finished")).toHaveLength(1);
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
