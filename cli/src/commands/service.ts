import fs from "node:fs/promises";
import path from "node:path";
import * as p from "@clack/prompts";
import type { Command } from "commander";
import { readConfig, resolveConfigPath } from "../config/store.js";
import { resolvePaperclipInstanceId, resolvePaperclipInstanceRoot } from "../config/home.js";
import { detectServiceManager, type ServiceManager, type ServiceStatus } from "../services/service-manager.js";
import {
  assertAdmissionRestored,
  assertNoLiveRuns,
  createInstanceRunControl,
  drainInstanceForRestart,
  type InstanceRunControl,
  type LiveRunsSnapshot,
} from "../services/instance-drain.js";
import { buildLocalHealthUrl } from "../utils/health-url.js";

type CommonOptions = { instance?: string; json?: boolean };
type HealthResult = { ok: boolean; serverVersion: string | null; error?: string };

function output(value: unknown, json: boolean | undefined): void {
  if (json) console.log(JSON.stringify(value, null, 2));
  else if (typeof value === "string") console.log(value);
  else console.log(JSON.stringify(value, null, 2));
}

async function resolveManager(opts: CommonOptions): Promise<ServiceManager | null> {
  const detection = await detectServiceManager({ instanceId: opts.instance });
  if (detection.supported) return detection.manager;
  output({ supported: false, message: detection.reason }, opts.json);
  return null;
}

function healthUrl(instanceId: string): string {
  process.env.PAPERCLIP_INSTANCE_ID = instanceId;
  const config = readConfig(resolveConfigPath());
  return buildLocalHealthUrl(config?.server.host, config?.server.port ?? 3100);
}

async function probeHealth(instanceId: string): Promise<HealthResult> {
  try {
    const response = await fetch(healthUrl(instanceId), { signal: AbortSignal.timeout(2_000) });
    const body = await response.json() as { status?: unknown; serverVersion?: unknown; version?: unknown };
    return { ok: response.ok && body.status === "ok", serverVersion: typeof body.serverVersion === "string" ? body.serverVersion : typeof body.version === "string" ? body.version : null };
  } catch (error) {
    return { ok: false, serverVersion: null, error: error instanceof Error ? error.message : String(error) };
  }
}

async function waitForHealth(instanceId: string, expectedVersion: string | null, timeoutMs = 60_000): Promise<HealthResult> {
  const deadline = Date.now() + timeoutMs;
  let last: HealthResult = { ok: false, serverVersion: null };
  while (Date.now() < deadline) {
    last = await probeHealth(instanceId);
    if (last.ok && (!expectedVersion || last.serverVersion === expectedVersion)) return last;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Paperclip service did not become healthy${expectedVersion ? ` at version ${expectedVersion}` : ""}: ${last.error ?? `reported ${last.serverVersion ?? "no version"}`}`);
}

export function resolveRestartExpectedVersion(expectedVersion: string | null | undefined): string | null {
  return expectedVersion ?? null;
}

export async function withHotRestartLock<T>(
  instanceId: string,
  callback: () => Promise<T>,
  options: { timeoutMs?: number; pollMs?: number; isProcessAlive?: (pid: number) => boolean } = {},
): Promise<T> {
  const instanceRoot = resolvePaperclipInstanceRoot(instanceId);
  const lockPath = path.join(instanceRoot, "hot-restart.lock");
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  const deadline = Date.now() + (options.timeoutMs ?? 120_000);
  const pollMs = options.pollMs ?? 100;
  const isProcessAlive = options.isProcessAlive ?? ((pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== "ESRCH";
    }
  });
  await fs.mkdir(instanceRoot, { recursive: true });

  while (true) {
    try {
      await fs.writeFile(lockPath, `${token}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const existingToken = (await fs.readFile(lockPath, "utf8")).trim();
        const ownerPid = Number.parseInt(existingToken.split(":", 1)[0] ?? "", 10);
        if (Number.isInteger(ownerPid) && ownerPid > 0 && !isProcessAlive(ownerPid)) {
          if ((await fs.readFile(lockPath, "utf8")).trim() === existingToken) {
            await fs.rm(lockPath, { force: true });
            continue;
          }
        }
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw readError;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Another restart for instance ${instanceId} is still running. ` +
          `If no restart process is active, remove the stale lock at ${lockPath} and retry.`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  try {
    return await callback();
  } finally {
    try {
      if ((await fs.readFile(lockPath, "utf8")).trim() === token) {
        await fs.rm(lockPath, { force: true });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

async function writeHotRestartIntent(status: ServiceStatus, instanceId: string, drainRequired: boolean): Promise<{ requestedAt: string }> {
  if (!status.pid) throw new Error(`Cannot restart ${status.serviceName}: supervisor did not report a server pid.`);
  const health = await probeHealth(instanceId);
  const instanceRoot = resolvePaperclipInstanceRoot(instanceId);
  const requestedAt = new Date().toISOString();
  await fs.mkdir(instanceRoot, { recursive: true });
  await fs.rm(path.join(instanceRoot, "hot-restart-report.json"), { force: true });
  await fs.writeFile(path.join(instanceRoot, "hot-restart-intent.json"), `${JSON.stringify({
    version: 1,
    requestedAt,
    previousServerPid: status.pid,
    previousServerVersion: health.serverVersion,
    drainRequired,
    requestedByRunId: process.env.PAPERCLIP_RUN_ID?.trim() || null,
  }, null, 2)}\n`, "utf8");
  return { requestedAt };
}

async function waitForRestartReport(instanceId: string, requestedAt: string, timeoutMs = 10_000): Promise<unknown | null> {
  const reportPath = path.join(resolvePaperclipInstanceRoot(instanceId), "hot-restart-report.json");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const report = JSON.parse(await fs.readFile(reportPath, "utf8")) as { requestedAt?: unknown };
      if (report.requestedAt === requestedAt) return report;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

export async function restartManagedService(input: { instanceId?: string; expectedVersion?: string | null; waitForDrain?: boolean } = {}): Promise<{ status: ServiceStatus; health: HealthResult; report: unknown | null }> {
  const instanceId = resolvePaperclipInstanceId(input.instanceId);
  return withHotRestartLock(instanceId, async () => {
    const detection = await detectServiceManager({ instanceId });
    if (!detection.supported) throw new Error(detection.reason);
    const before = await detection.manager.status();
    const intent = await writeHotRestartIntent(before, instanceId, input.waitForDrain ?? false);
    await detection.manager.restart();
    const health = await waitForHealth(instanceId, resolveRestartExpectedVersion(input.expectedVersion));
    return { status: await detection.manager.status(), health, report: await waitForRestartReport(instanceId, intent.requestedAt) };
  });
}

export interface SafeRestartOptions {
  instanceId?: string;
  expectedVersion?: string | null;
  waitForDrain?: boolean;
  force?: boolean;
  drain?: boolean;
  drainTimeoutMs?: number;
  control?: InstanceRunControl;
  onPoll?: (snapshot: LiveRunsSnapshot) => void;
  pollMs?: number;
  restart?: (input: { instanceId?: string; expectedVersion?: string | null; waitForDrain?: boolean }) => Promise<unknown>;
}

export async function safeRestartManagedService(options: SafeRestartOptions = {}): Promise<{
  restarted: unknown;
  drained: boolean;
  liveRunsBefore: number;
  admission: "accepting";
}> {
  const instanceId = resolvePaperclipInstanceId(options.instanceId);
  const control = options.control ?? createInstanceRunControl(instanceId);
  const restart = options.restart ?? restartManagedService;
  let drained = false;
  let liveRunsBefore = 0;

  if (options.force) {
    drained = false;
  } else if (options.drain) {
    const settled = await drainInstanceForRestart({
      control,
      timeoutMs: options.drainTimeoutMs ?? 900_000,
      pollMs: options.pollMs,
      onPoll: options.onPoll,
    });
    liveRunsBefore = settled.count;
    drained = true;
  } else {
    await assertNoLiveRuns({ verb: "restart", control });
  }

  const restarted = await restart({
    instanceId: options.instanceId,
    expectedVersion: options.expectedVersion,
    waitForDrain: options.waitForDrain,
  });
  await assertAdmissionRestored(control);
  return { restarted, drained, liveRunsBefore, admission: "accepting" };
}

export async function guardServiceStop(options: {
  instanceId?: string;
  force?: boolean;
  control?: InstanceRunControl;
}): Promise<void> {
  const instanceId = resolvePaperclipInstanceId(options.instanceId);
  await assertNoLiveRuns({
    verb: "stop",
    force: options.force,
    control: options.control ?? createInstanceRunControl(instanceId),
  });
}

export function registerServiceCommands(program: Command): void {
  const service = program.command("service").description("Manage Paperclip as a background service");
  const common = (command: Command) => command.option("-i, --instance <id>", "Local instance id (default: default)").option("--json", "Print machine-readable JSON", false);

  common(service.command("install").description("Install and register the background service"))
    .option("--no-start-now", "Install without starting now")
    .option("--no-start-on-login", "Install without enabling start on login")
    .option("--enable-linger", "Allow systemd startup without an active login session", false)
    .action(async (opts) => {
      const manager = await resolveManager(opts); if (!manager) return;
      const result = await manager.install({ startNow: opts.startNow, startOnLogin: opts.startOnLogin });
      let lingerEnabled = false;
      if (manager.enableLinger) {
        let consent = opts.enableLinger === true;
        if (!consent && process.stdin.isTTY && process.stdout.isTTY) {
          consent = await p.confirm({ message: "Allow Paperclip to run without an active login session? This runs 'loginctl enable-linger' for your user and may request system authorization.", initialValue: false }) === true;
        }
        if (consent) { await manager.enableLinger(); lingerEnabled = true; }
      }
      output({ installed: true, changed: result.changed, platform: manager.platform, serviceName: manager.serviceName, definitionPath: manager.definitionPath, lingerEnabled }, opts.json);
    });

  common(service.command("uninstall").description("Stop, disable, and remove the background service")).action(async (opts) => {
    const manager = await resolveManager(opts); if (!manager) return;
    await manager.uninstall();
    const status = await manager.status();
    if (status.installed || status.active) throw new Error(`${manager.serviceName} is still loaded after uninstall.`);
    output({ uninstalled: true, serviceName: manager.serviceName }, opts.json);
  });

  common(service.command("start").description("Start the background service")).action(async (opts) => {
    const manager = await resolveManager(opts); if (!manager) return;
    await manager.start();
    output(await manager.status(), opts.json);
  });

  common(service.command("stop").description("Stop the background service"))
    .option("--force", "Stop even while agent runs are still executing", false)
    .action(async (opts) => {
      const manager = await resolveManager(opts); if (!manager) return;
      await guardServiceStop({ instanceId: opts.instance, force: opts.force });
      await manager.stop();
      output(await manager.status(), opts.json);
    });

  common(service.command("restart").description("Hot-restart the service while preserving active agent runs"))
    .option("--wait", "Wait for active runs to drain instead of adopting them", false)
    .option("--drain", "Stop admitting new runs, wait for the live ones to finish, then restart", false)
    .option("--drain-timeout <seconds>", "How long --drain waits for live runs before giving up", "900")
    .option("--force", "Restart even while agent runs are still executing", false)
    .option("--expected-version <version>", "Require the restarted server to report this version")
    .action(async (opts) => {
      const drainTimeoutSeconds = Number.parseInt(opts.drainTimeout, 10);
      if (!Number.isInteger(drainTimeoutSeconds) || drainTimeoutSeconds < 1) {
        throw new Error("--drain-timeout must be a positive number of seconds.");
      }
      const result = await safeRestartManagedService({
        instanceId: opts.instance,
        expectedVersion: opts.expectedVersion,
        waitForDrain: opts.wait,
        drain: opts.drain,
        force: opts.force,
        drainTimeoutMs: drainTimeoutSeconds * 1_000,
        onPoll: opts.json
          ? undefined
          : (snapshot) => {
            if (snapshot.count > 0 || snapshot.pendingWakes > 0) {
              console.log(`Draining: ${snapshot.count} live run(s), ${snapshot.pendingWakes} pending wake(s) remaining.`);
            }
          },
      });
      output(result, opts.json);
    });

  common(service.command("status").description("Show supervisor and health status")).action(async (opts) => {
    const manager = await resolveManager(opts); if (!manager) return;
    const instanceId = resolvePaperclipInstanceId(opts.instance);
    output({ ...await manager.status(), health: await probeHealth(instanceId) }, opts.json);
  });

  common(service.command("logs").description("Show service logs"))
    .option("-f, --follow", "Follow new log output", false)
    .option("-n, --lines <count>", "Number of recent lines", "100")
    .action(async (opts) => {
      const manager = await resolveManager(opts); if (!manager) return;
      const lines = Number.parseInt(opts.lines, 10);
      if (!Number.isInteger(lines) || lines < 1) throw new Error("--lines must be a positive integer.");
      await manager.logs(opts.follow, lines);
    });
}
