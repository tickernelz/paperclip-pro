import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInstanceRunControl,
  InstanceUnreachableError,
  resolveInstanceEndpoint,
} from "../services/instance-drain.js";
import { resolveInstanceLiveness, safeRestartManagedService } from "../commands/service.js";
import { paperclipConfigSchema } from "../config/schema.js";
import { writeRuntimeInfo } from "../runtime-info.js";

const INSTANCE = "guardfix";
let home = "";
let previousHome: string | undefined;
let previousInstance: string | undefined;

function writeConfig(port: number): void {
  const instanceDir = path.join(home, "instances", INSTANCE);
  fs.mkdirSync(instanceDir, { recursive: true });
  const config = paperclipConfigSchema.parse({
    $meta: { version: 1, updatedAt: new Date().toISOString(), source: "onboard" },
    llm: { provider: "claude" },
    database: {},
    logging: { mode: "file" },
    server: { host: "127.0.0.1", port },
  });
  fs.writeFileSync(path.join(instanceDir, "config.json"), JSON.stringify(config, null, 2));
}

function writeRuntime(port: number, pid: number): void {
  writeRuntimeInfo({
    schemaVersion: 1,
    instanceId: INSTANCE,
    pid,
    host: "127.0.0.1",
    port,
    dashboardUrl: `http://127.0.0.1:${port}`,
    startedAt: new Date().toISOString(),
  });
}

beforeEach(() => {
  previousHome = process.env.PAPERCLIP_HOME;
  previousInstance = process.env.PAPERCLIP_INSTANCE_ID;
  home = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-guardfix-"));
  process.env.PAPERCLIP_HOME = home;
  process.env.PAPERCLIP_INSTANCE_ID = INSTANCE;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.PAPERCLIP_HOME;
  else process.env.PAPERCLIP_HOME = previousHome;
  if (previousInstance === undefined) delete process.env.PAPERCLIP_INSTANCE_ID;
  else process.env.PAPERCLIP_INSTANCE_ID = previousInstance;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("guard endpoint resolution", () => {
  it("queries the port the server is actually listening on, not the one the config was just changed to", async () => {
    writeConfig(3100);
    writeRuntime(3200, process.pid);

    const endpoint = resolveInstanceEndpoint(INSTANCE);
    expect(endpoint.apiBase).toBe("http://127.0.0.1:3200");
    expect(endpoint.source).toBe("runtime-info");

    const requested: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      requested.push(url);
      return new Response(JSON.stringify({ draining: false, pendingWakes: 0, count: 0, runs: [] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const control = createInstanceRunControl(INSTANCE, { endpoint, fetchImpl: fetchImpl as unknown as typeof fetch });
    await control.liveRuns();
    expect(requested).toEqual(["http://127.0.0.1:3200/api/instance/live-runs"]);

    const restart = vi.fn(async () => ({ ok: true }));
    const start = vi.fn(async () => ({ started: true }));
    const result = await safeRestartManagedService({
      instanceId: INSTANCE,
      control,
      restart,
      start,
    });
    expect(result.action).toBe("restarted");
    expect(restart).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
  });

  it("falls back to the configured port when the recorded server pid is gone", () => {
    writeConfig(3100);
    writeRuntime(3200, 4_194_303);
    const endpoint = resolveInstanceEndpoint(INSTANCE, { isProcessAlive: () => false });
    expect(endpoint.apiBase).toBe("http://127.0.0.1:3100");
    expect(endpoint.source).toBe("config");
  });
});

describe("restart when the service is not running", () => {
  it("reports the instance as stopped when no runtime info and an inactive unit", async () => {
    writeConfig(3100);
    const liveness = await resolveInstanceLiveness({
      instanceId: INSTANCE,
      status: async () => ({ platform: "systemd", serviceName: "paperclip-pro.service", installed: true, active: false, enabled: true, pid: null }),
    });
    expect(liveness.running).toBe(false);
  });

  it("starts the service instead of consulting a server that cannot be running", async () => {
    writeConfig(3100);
    const restart = vi.fn(async () => ({ ok: true }));
    const start = vi.fn(async () => ({ started: true }));
    const result = await safeRestartManagedService({
      instanceId: INSTANCE,
      liveness: async () => ({ running: false, detail: "paperclip-pro.service is not running" }),
      restart,
      start,
    });
    expect(result.action).toBe("started");
    expect(start).toHaveBeenCalledTimes(1);
    expect(restart).not.toHaveBeenCalled();
  });
});

describe("restart when the service runs but is unreachable", () => {
  it("refuses with a clear message instead of a bare transport error", async () => {
    writeConfig(3100);
    writeRuntime(3200, process.pid);
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const restart = vi.fn(async () => ({ ok: true }));
    const control = createInstanceRunControl(INSTANCE, {
      endpoint: resolveInstanceEndpoint(INSTANCE),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const error = await safeRestartManagedService({ instanceId: INSTANCE, control, restart }).then(
      () => new Error("safe restart did not refuse"),
      (err: Error) => err,
    );
    expect(error).toBeInstanceOf(InstanceUnreachableError);
    expect(error.message).toContain("unreachable at http://127.0.0.1:3200");
    expect(error.message).toContain("--force");
    expect(restart).not.toHaveBeenCalled();
  });

  it("restarts anyway under --force", async () => {
    writeConfig(3100);
    writeRuntime(3200, process.pid);
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const restart = vi.fn(async () => ({ ok: true }));
    const control = createInstanceRunControl(INSTANCE, {
      endpoint: resolveInstanceEndpoint(INSTANCE),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const admissionControl = {
      liveRuns: vi.fn(async () => ({ draining: false, pendingWakes: 0, count: 0, runs: [] })),
      startDrain: vi.fn(async () => undefined),
      stopDrain: vi.fn(async () => undefined),
    };
    const result = await safeRestartManagedService({ instanceId: INSTANCE, control, admissionControl, restart, force: true });
    expect(restart).toHaveBeenCalledTimes(1);
    expect(result.action).toBe("restarted");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
