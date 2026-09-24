import { describe, expect, it, vi } from "vitest";
import {
  assertAdmissionRestored,
  assertNoLiveRuns,
  DrainTimeoutError,
  drainInstanceForRestart,
  formatLiveRunsBlocker,
  LiveRunsBlockedError,
  waitForInstanceQuiescent,
  type InstanceRunControl,
  type LiveRunsSnapshot,
} from "../services/instance-drain.js";
import { guardServiceStop, safeRestartManagedService } from "../commands/service.js";

function snapshot(partial: Partial<LiveRunsSnapshot> = {}): LiveRunsSnapshot {
  return { draining: false, pendingWakes: 0, count: 0, runs: [], ...partial };
}

function liveSnapshot(count: number, issueIds: (string | null)[] = []): LiveRunsSnapshot {
  return snapshot({
    count,
    runs: Array.from({ length: count }, (_, index) => ({
      id: `run_${index + 1}`,
      companyId: "co_1",
      agentId: "ag_1",
      status: "running",
      startedAt: "2026-09-24T00:00:00.000Z",
      issueId: issueIds[index] ?? null,
    })),
  });
}

function controlFrom(queue: LiveRunsSnapshot[]): InstanceRunControl & {
  startDrain: ReturnType<typeof vi.fn>;
  stopDrain: ReturnType<typeof vi.fn>;
} {
  const pending = [...queue];
  return {
    liveRuns: vi.fn(async () => pending.length > 1 ? pending.shift()! : pending[0]!),
    startDrain: vi.fn(async () => undefined),
    stopDrain: vi.fn(async () => undefined),
  } as InstanceRunControl & { startDrain: ReturnType<typeof vi.fn>; stopDrain: ReturnType<typeof vi.fn> };
}

describe("live-run guard", () => {
  it("refuses a stop while runs are live and names their count and issues", async () => {
    const control = controlFrom([liveSnapshot(2, ["ZHA-21", "ZHA-7"])]);
    await expect(guardServiceStop({ instanceId: "default", control })).rejects.toBeInstanceOf(LiveRunsBlockedError);
    const error = await guardServiceStop({ instanceId: "default", control }).then(
      () => new Error("guard did not throw"),
      (err: Error) => err,
    );
    expect(error.message).toContain("2 live agent run(s)");
    expect(error.message).toContain("ZHA-21");
    expect(error.message).toContain("ZHA-7");
    expect(error.message).toContain("--force");
  });

  it("allows a stop when nothing is live", async () => {
    const control = controlFrom([snapshot()]);
    await expect(guardServiceStop({ instanceId: "default", control })).resolves.toBeUndefined();
  });

  it("lets --force through without consulting the instance", async () => {
    const control = controlFrom([liveSnapshot(3)]);
    await expect(guardServiceStop({ instanceId: "default", force: true, control })).resolves.toBeUndefined();
    expect(control.liveRuns).not.toHaveBeenCalled();
  });

  it("counts a pending wake as live work", async () => {
    const control = controlFrom([snapshot({ pendingWakes: 1 })]);
    await expect(assertNoLiveRuns({ verb: "restart", control })).rejects.toBeInstanceOf(LiveRunsBlockedError);
  });

  it("blocks a plain restart while a run is live", async () => {
    const control = controlFrom([liveSnapshot(1, ["ZHA-21"])]);
    const restart = vi.fn(async () => ({ ok: true }));
    await expect(safeRestartManagedService({ instanceId: "default", control, restart })).rejects.toThrow(/1 live agent run/);
    expect(restart).not.toHaveBeenCalled();
  });

  it("names the issue in the blocker text", () => {
    expect(formatLiveRunsBlocker("stop", liveSnapshot(1, ["ZHA-21"]))).toContain("on issue ZHA-21");
  });
});

describe("safe restart drain", () => {
  it("holds admission, waits for the live runs, then restarts", async () => {
    const control = controlFrom([liveSnapshot(2), liveSnapshot(1), snapshot()]);
    const restart = vi.fn(async () => ({ ok: true }));
    const result = await safeRestartManagedService({
      instanceId: "default",
      drain: true,
      drainTimeoutMs: 60_000,
      pollMs: 0,
      control,
      restart,
    });
    expect(control.startDrain).toHaveBeenCalledTimes(1);
    expect(restart).toHaveBeenCalledTimes(1);
    expect(result.drained).toBe(true);
  });

  it("releases the drain and does not restart when the timeout passes", async () => {
    const control = controlFrom([liveSnapshot(1, ["ZHA-21"])]);
    const restart = vi.fn(async () => ({ ok: true }));
    let clock = 0;
    await expect(
      drainInstanceForRestart({
        control,
        timeoutMs: 10,
        pollMs: 0,
        now: () => (clock += 20),
        sleep: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(DrainTimeoutError);
    expect(control.stopDrain).toHaveBeenCalledTimes(1);
    expect(restart).not.toHaveBeenCalled();
  });

  it("reports the still-live runs when it gives up", async () => {
    const control = controlFrom([liveSnapshot(1, ["ZHA-21"])]);
    let clock = 0;
    const error = await waitForInstanceQuiescent({
      control,
      timeoutMs: 5,
      pollMs: 0,
      now: () => (clock += 10),
      sleep: async () => undefined,
    }).then(
      () => new Error("wait did not time out"),
      (err: Error) => err,
    );
    expect(error).toBeInstanceOf(DrainTimeoutError);
    expect(error.message).toContain("was not restarted");
    expect(error.message).toContain("ZHA-21");
  });
});

describe("admission after restart", () => {
  it("passes when the rebooted instance accepts runs again", async () => {
    const control = controlFrom([snapshot()]);
    await expect(assertAdmissionRestored(control)).resolves.toMatchObject({ draining: false });
    expect(control.stopDrain).not.toHaveBeenCalled();
  });

  it("clears a drain that somehow survived the restart", async () => {
    const control = controlFrom([snapshot({ draining: true }), snapshot()]);
    await expect(assertAdmissionRestored(control)).resolves.toMatchObject({ draining: false });
    expect(control.stopDrain).toHaveBeenCalledTimes(1);
  });

  it("fails loudly when the drain cannot be cleared", async () => {
    const control = controlFrom([snapshot({ draining: true })]);
    await expect(assertAdmissionRestored(control)).rejects.toThrow(/still refusing new runs/);
  });

  it("verifies admission after a drained restart", async () => {
    const control = controlFrom([snapshot()]);
    const restart = vi.fn(async () => ({ ok: true }));
    const result = await safeRestartManagedService({
      instanceId: "default",
      drain: true,
      drainTimeoutMs: 1_000,
      pollMs: 0,
      control,
      restart,
    });
    expect(result.admission).toBe("accepting");
  });
});
