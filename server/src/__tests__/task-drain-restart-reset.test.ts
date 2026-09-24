import { afterEach, describe, expect, it, vi } from "vitest";

type HeartbeatModule = typeof import("../services/heartbeat.ts");

async function loadHeartbeatProcess(): Promise<HeartbeatModule> {
  vi.resetModules();
  return await import("../services/heartbeat.ts");
}

afterEach(() => {
  vi.resetModules();
});

describe("task drain across a process restart", () => {
  it("does not carry a drain into the next process", async () => {
    const before = await loadHeartbeatProcess();
    before.startTaskDrain({});
    expect(before.getTaskDrainStatus().draining).toBe(true);

    const afterRestart = await loadHeartbeatProcess();
    expect(afterRestart.getTaskDrainStatus().draining).toBe(false);
    expect(afterRestart.getTaskDrainStatus().quiescent).toBe(true);
  });

  it("reports no active run executions in a freshly started process", async () => {
    const afterRestart = await loadHeartbeatProcess();
    expect(afterRestart.listActiveRunExecutionIds()).toEqual([]);
    expect(afterRestart.getTaskDrainStatus().activeRuns).toBe(0);
  });

  it("holds a drain within one process until it is stopped", async () => {
    const heartbeat = await loadHeartbeatProcess();
    heartbeat.startTaskDrain({});
    expect(heartbeat.getTaskDrainStatus().draining).toBe(true);
    expect(heartbeat.stopTaskDrain()).toEqual({ wasActive: true });
    expect(heartbeat.getTaskDrainStatus().draining).toBe(false);
  });

  it("holds new run admission while draining and releases it on stop", async () => {
    const heartbeat = await loadHeartbeatProcess();
    expect(heartbeat.resolveHeartbeatSchedulingSuppression({})).toEqual({ suppressed: false, reason: null });
    heartbeat.startTaskDrain({});
    expect(heartbeat.resolveHeartbeatSchedulingSuppression({})).toEqual({ suppressed: true, reason: "task_drain" });
    heartbeat.stopTaskDrain();
    expect(heartbeat.resolveHeartbeatSchedulingSuppression({})).toEqual({ suppressed: false, reason: null });
  });

  it("admits runs again in the process that replaces a draining one", async () => {
    const before = await loadHeartbeatProcess();
    before.startTaskDrain({});
    expect(before.resolveHeartbeatSchedulingSuppression({})).toEqual({ suppressed: true, reason: "task_drain" });

    const afterRestart = await loadHeartbeatProcess();
    expect(afterRestart.resolveHeartbeatSchedulingSuppression({})).toEqual({ suppressed: false, reason: null });
  });

  it("expires a drain that outlives its ttl", async () => {
    const heartbeat = await loadHeartbeatProcess();
    heartbeat.startTaskDrain({ ttlMs: -1 });
    expect(heartbeat.getTaskDrainStatus().draining).toBe(false);
  });
});
