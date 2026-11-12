import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  isUpdateJobActive,
  UPDATE_WAIT_TIMEOUT_MS,
  type InstanceUpdateStatus,
  type UpdateInstallMode,
  type UpdateJob,
} from "@tickernelz/wardmote-shared";
import {
  DrainCancelledError,
  DrainTimeoutError,
  drainInstanceForRestart,
  type InstanceRunControl,
} from "@tickernelz/wardmote-shared/instance-drain";
import { conflict, unprocessable } from "../errors.js";

const execFileAsync = promisify(execFile);
const RESULT_POLL_MS = 2_000;

type UpdateResultFile = { ok?: unknown; version?: unknown; rolledBackTo?: unknown; error?: unknown; finishedAt?: unknown };
export type UpdateAuditEvent = { action: "instance.update.requested" | "instance.update.finished"; job: UpdateJob };

export interface UpdateInstallerDeps {
  status: () => InstanceUpdateStatus;
  runControl: InstanceRunControl;
  launch: (job: UpdateJob, resultPath: string) => Promise<{ logHint: string }>;
  audit: (event: UpdateAuditEvent) => Promise<void>;
  instanceRoot: string;
  now?: () => number;
  waitTimeoutMs?: number;
  pollMs?: number;
}

export interface UpdateInstaller {
  current(): UpdateJob | null;
  start(input: { version: string; mode: UpdateInstallMode; trigger: "manual" | "auto"; requestedBy: UpdateJob["requestedBy"] }): Promise<UpdateJob>;
  forceWaiting(): Promise<UpdateJob>;
  cancelWaiting(): Promise<UpdateJob>;
  resume(): void;
  stop(): void;
}

export function createUpdateInstaller(deps: UpdateInstallerDeps): UpdateInstaller {
  const now = deps.now ?? Date.now;
  const jobPath = path.join(deps.instanceRoot, "update-job.json");
  const resultPath = path.join(deps.instanceRoot, "update-result.json");
  let job: UpdateJob | null = readJson<UpdateJob>(jobPath);
  let waitAbort: AbortController | null = null;
  let monitor: ReturnType<typeof setInterval> | null = null;

  function save(next: UpdateJob): UpdateJob {
    job = next;
    fs.mkdirSync(path.dirname(jobPath), { recursive: true });
    const temp = `${jobPath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(temp, jobPath);
    return next;
  }

  async function finish(patch: Partial<UpdateJob>): Promise<UpdateJob> {
    if (!job) throw new Error("No update job to finish.");
    const done = save({ ...job, ...patch, finishedAt: new Date(now()).toISOString() });
    stopMonitor();
    await deps.audit({ action: "instance.update.finished", job: done }).catch(() => undefined);
    return done;
  }

  function stopMonitor() {
    if (monitor) clearInterval(monitor);
    monitor = null;
  }

  async function checkResult(): Promise<void> {
    if (job?.phase !== "installing" || !job.startedAt) return;
    const result = readJson<UpdateResultFile>(resultPath);
    if (!result || typeof result.finishedAt !== "string" || Date.parse(result.finishedAt) < Date.parse(job.startedAt)) return;
    await deps.runControl.stopDrain().catch(() => undefined);
    await finish({
      phase: result.ok === true ? "succeeded" : "failed",
      installedVersion: typeof result.version === "string" ? result.version : null,
      rolledBackTo: typeof result.rolledBackTo === "string" ? result.rolledBackTo : null,
      error: typeof result.error === "string" ? result.error : null,
    });
  }

  function startMonitor() {
    if (monitor) return;
    monitor = setInterval(() => void checkResult(), deps.pollMs ?? RESULT_POLL_MS);
    monitor.unref?.();
  }

  async function launch(): Promise<UpdateJob> {
    if (!job) throw new Error("No update job to launch.");
    fs.rmSync(resultPath, { force: true });
    const started = save({ ...job, phase: "installing", startedAt: new Date(now()).toISOString() });
    try {
      const { logHint } = await deps.launch(started, resultPath);
      save({ ...started, logHint });
    } catch (error) {
      await deps.runControl.stopDrain().catch(() => undefined);
      return finish({ phase: "failed", error: `The update process could not be started: ${error instanceof Error ? error.message : String(error)}` });
    }
    startMonitor();
    return job!;
  }

  async function waitThenLaunch(signal: AbortSignal): Promise<void> {
    try {
      await drainInstanceForRestart({
        control: deps.runControl,
        timeoutMs: deps.waitTimeoutMs ?? UPDATE_WAIT_TIMEOUT_MS,
        pollMs: deps.pollMs,
        signal,
        onPoll: (snapshot) => {
          if (job?.phase === "waiting" && job.liveRuns !== snapshot.count + snapshot.pendingWakes) {
            save({ ...job, liveRuns: snapshot.count + snapshot.pendingWakes });
          }
        },
      });
    } catch (error) {
      if (signal.reason === "force") {
        await launch();
        return;
      }
      if (error instanceof DrainCancelledError) {
        await finish({ phase: "cancelled" });
        return;
      }
      await finish({
        phase: "failed",
        error: error instanceof DrainTimeoutError
          ? `Runs were still active after ${Math.round((deps.waitTimeoutMs ?? UPDATE_WAIT_TIMEOUT_MS) / 60_000)} minutes, so nothing was installed.`
          : `Waiting for runs failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }
    if (signal.aborted && signal.reason !== "force") {
      await deps.runControl.stopDrain().catch(() => undefined);
      await finish({ phase: "cancelled" });
      return;
    }
    await launch();
  }

  return {
    current: () => job,

    async start(input) {
      if (isUpdateJobActive(job)) throw conflict("An update is already in progress");
      const status = deps.status();
      if (!status.install.canInstall) throw unprocessable(`This install cannot update itself from the web UI. Run: ${status.install.command}`);
      if (!status.updateAvailable || status.latestVersion !== input.version) {
        throw unprocessable(`Only the newest published version (${status.latestVersion ?? "unknown"}) can be installed.`);
      }
      const snapshot = await deps.runControl.liveRuns();
      const waitDeadline = input.mode === "wait" ? new Date(now() + (deps.waitTimeoutMs ?? UPDATE_WAIT_TIMEOUT_MS)).toISOString() : null;
      save({
        id: randomUUID(),
        phase: input.mode === "wait" ? "waiting" : "installing",
        mode: input.mode,
        trigger: input.trigger,
        fromVersion: status.currentVersion,
        toVersion: input.version,
        requestedBy: input.requestedBy,
        requestedAt: new Date(now()).toISOString(),
        waitDeadline,
        liveRuns: snapshot.count + snapshot.pendingWakes,
        startedAt: null,
        finishedAt: null,
        installedVersion: null,
        rolledBackTo: null,
        error: null,
        logHint: null,
      });
      await deps.audit({ action: "instance.update.requested", job: job! }).catch(() => undefined);
      if (input.mode === "force") return launch();
      waitAbort = new AbortController();
      void waitThenLaunch(waitAbort.signal).finally(() => { waitAbort = null; });
      return job!;
    },

    async forceWaiting() {
      if (job?.phase !== "waiting" || !waitAbort) throw conflict("No update is waiting for runs");
      save({ ...job, mode: "force" });
      waitAbort.abort("force");
      return job;
    },

    async cancelWaiting() {
      if (job?.phase !== "waiting" || !waitAbort) throw conflict("No update is waiting for runs");
      waitAbort.abort("cancel");
      return job;
    },

    resume() {
      if (job?.phase === "installing") {
        startMonitor();
        void checkResult();
      } else if (job?.phase === "waiting") {
        void finish({ phase: "cancelled", error: "The server restarted while the update was waiting for runs." });
      }
    },

    stop() {
      stopMonitor();
      waitAbort?.abort("cancel");
    },
  };
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

const FORWARDED_UPDATE_ENV = ["WARDMOTE_CONFIG", "WARDMOTE_SHIM_PATH", "PATH"] as const;

export function createSystemdUpdateLauncher(input: {
  homeDir: string;
  instanceId: string;
  nodePath?: string;
  env?: NodeJS.ProcessEnv;
  exec?: (file: string, args: string[]) => Promise<unknown>;
}) {
  const exec = input.exec ?? ((file: string, args: string[]) => execFileAsync(file, args, { timeout: 30_000 }));
  return async (job: UpdateJob, resultPath: string): Promise<{ logHint: string }> => {
    const unit = `wardmote-update-${input.instanceId}-${job.id.slice(0, 8)}`;
    const entrypoint = path.join(input.homeDir, "cli", "current", "node_modules", ".bin", "wardmote");
    const source = input.env ?? process.env;
    const env = [
      `WARDMOTE_HOME=${input.homeDir}`,
      `WARDMOTE_INSTANCE_ID=${input.instanceId}`,
      ...FORWARDED_UPDATE_ENV.flatMap((key) => (source[key]?.trim() ? [`${key}=${source[key]!.trim()}`] : [])),
    ].flatMap((value) => ["--setenv", value]);
    await exec("systemd-run", [
      "--user",
      "--collect",
      "--quiet",
      `--unit=${unit}`,
      ...env,
      input.nodePath ?? process.execPath,
      entrypoint,
      "update",
      "--version",
      job.toVersion,
      "--yes",
      "--result-file",
      resultPath,
    ]);
    return { logHint: `journalctl --user -u ${unit}` };
  };
}
