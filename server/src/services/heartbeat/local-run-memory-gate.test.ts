import { describe, expect, it } from "vitest";
import {
  LOCAL_RUN_MEMORY_ESTIMATE_BYTES,
  createLocalRunMemoryGate,
  formatLocalRunMemoryGateLine,
} from "./local-run-memory-gate.js";

const GIB = 1024 * 1024 * 1024;
const CGROUP = "/user.slice/user-1000.slice/user@1000.service/app.slice/paperclip-pro.service";

type Host = {
  totalGiB?: number;
  availableGiB?: number;
  swapTotalGiB?: number;
  swapFreeGiB?: number;
  vmstatOomKill?: number | null;
  cgroupOomKill?: number | null;
  files?: Record<string, string | null>;
};

function kib(gib: number) {
  return Math.round((gib * GIB) / 1024);
}

function hostFiles(host: Host): Record<string, string | null> {
  const total = host.totalGiB ?? 32;
  const files: Record<string, string | null> = {
    "/proc/meminfo": [
      `MemTotal:       ${kib(total)} kB`,
      `MemFree:        ${kib(1)} kB`,
      `MemAvailable:   ${kib(host.availableGiB ?? 20)} kB`,
      `SwapTotal:      ${kib(host.swapTotalGiB ?? 8)} kB`,
      `SwapFree:       ${kib(host.swapFreeGiB ?? 8)} kB`,
      "",
    ].join("\n"),
    "/proc/vmstat": host.vmstatOomKill === null ? null : `nr_free_pages 1\noom_kill ${host.vmstatOomKill ?? 0}\npswpin 0\n`,
    "/proc/self/cgroup": `0::${CGROUP}\n`,
    [`/sys/fs/cgroup${CGROUP}/memory.current`]: String(12 * GIB) + "\n",
    [`/sys/fs/cgroup${CGROUP}/memory.max`]: "max\n",
    [`/sys/fs/cgroup${CGROUP}/memory.events`]:
      host.cgroupOomKill === null ? null : `low 0\nhigh 0\nmax 0\noom 0\noom_kill ${host.cgroupOomKill ?? 0}\n`,
  };
  return { ...files, ...host.files };
}

function gateFor(sequence: Host[], clock: { now: number }) {
  let index = 0;
  const gate = createLocalRunMemoryGate({
    now: () => clock.now,
    readText: async (path) => {
      const files = hostFiles(sequence[Math.min(index, sequence.length - 1)]!);
      const value = files[path];
      if (value === undefined || value === null) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return value;
    },
  });
  return { assess: async (input: Partial<Parameters<typeof gate.assess>[0]> = {}) => {
    const decision = await gate.assess({
      runId: "run-1", localRunsLive: 3, startingRuns: 0, reservePercent: 20, cooldownSec: 120, ...input,
    });
    index += 1;
    return decision;
  } };
}

describe("local run memory gate (shadow decision)", () => {
  it("would hold once available memory minus starting runs falls under the reserve", async () => {
    const gate = gateFor([{ availableGiB: 7 }, { availableGiB: 7 }], { now: 0 });
    const roomy = await gate.assess({ startingRuns: 0 });
    expect(roomy).toMatchObject({ wouldHold: false, reason: "ok", reserveBytes: Math.floor(0.2 * 32 * GIB) });
    const crowded = await gate.assess({ startingRuns: 2 });
    expect(crowded).toMatchObject({
      wouldHold: true,
      reason: "low_available_memory",
      inflightEstimateBytes: 2 * LOCAL_RUN_MEMORY_ESTIMATE_BYTES,
    });
  });

  it("follows available memory down and back up between decisions", async () => {
    const gate = gateFor([{ availableGiB: 20 }, { availableGiB: 5 }, { availableGiB: 9 }], { now: 0 });
    expect((await gate.assess()).wouldHold).toBe(false);
    expect((await gate.assess()).wouldHold).toBe(true);
    expect((await gate.assess()).wouldHold).toBe(false);
  });

  it("applies the configured reserve percentage to the same snapshot", async () => {
    const gate = gateFor([{ availableGiB: 5 }, { availableGiB: 5 }], { now: 0 });
    expect((await gate.assess({ reservePercent: 20 })).wouldHold).toBe(true);
    expect((await gate.assess({ reservePercent: 10 })).wouldHold).toBe(false);
  });

  it("records a full swap without turning it into a hold", async () => {
    const gate = gateFor([{ availableGiB: 20, swapTotalGiB: 8, swapFreeGiB: 0 }], { now: 0 });
    const decision = await gate.assess();
    expect(decision.wouldHold).toBe(false);
    expect(decision.snapshot).toMatchObject({ swapTotalBytes: 8 * GIB, swapFreeBytes: 0 });
  });

  it("fails open when /proc/meminfo cannot be read", async () => {
    const gate = gateFor([{ files: { "/proc/meminfo": null } }], { now: 0 });
    expect(await gate.assess({ startingRuns: 50 })).toMatchObject({
      wouldHold: false,
      reason: "signal_unavailable",
      snapshot: null,
      reserveBytes: null,
    });
  });

  it("fails open when meminfo has no MemAvailable", async () => {
    const gate = gateFor([{ files: { "/proc/meminfo": "MemTotal: 1024 kB\n" } }], { now: 0 });
    expect((await gate.assess()).reason).toBe("signal_unavailable");
  });

  it("still decides when vmstat and the service cgroup are unreadable", async () => {
    const gate = gateFor(
      [{ availableGiB: 2, vmstatOomKill: null, files: { "/proc/self/cgroup": null } }],
      { now: 0 },
    );
    const decision = await gate.assess();
    expect(decision).toMatchObject({ wouldHold: true, reason: "low_available_memory", oomKillObserved: null });
    expect(decision.snapshot).toMatchObject({ hostOomKill: null, cgroup: null });
  });

  it("holds for the cooldown after the host OOM kill counter rises, then releases", async () => {
    const clock = { now: 1_000_000 };
    const gate = gateFor(
      [{ vmstatOomKill: 4 }, { vmstatOomKill: 5 }, { vmstatOomKill: 5 }, { vmstatOomKill: 5 }],
      clock,
    );
    expect((await gate.assess()).wouldHold).toBe(false);
    clock.now += 10_000;
    expect(await gate.assess()).toMatchObject({ wouldHold: true, reason: "oom_kill_cooldown", oomKillObserved: 5 });
    clock.now += 119_000;
    expect((await gate.assess()).wouldHold).toBe(true);
    clock.now += 2_000;
    expect(await gate.assess()).toMatchObject({ wouldHold: false, reason: "ok" });
  });

  it("counts a rise of the service cgroup oom_kill event the same way", async () => {
    const clock = { now: 0 };
    const gate = gateFor([{ cgroupOomKill: 0 }, { cgroupOomKill: 1 }], clock);
    expect((await gate.assess()).wouldHold).toBe(false);
    expect(await gate.assess()).toMatchObject({ wouldHold: true, reason: "oom_kill_cooldown" });
  });

  it("honours a shorter configured cooldown", async () => {
    const clock = { now: 0 };
    const gate = gateFor([{ vmstatOomKill: 0 }, { vmstatOomKill: 1 }, { vmstatOomKill: 1 }], clock);
    await gate.assess({ cooldownSec: 30 });
    expect((await gate.assess({ cooldownSec: 30 })).wouldHold).toBe(true);
    clock.now += 31_000;
    expect((await gate.assess({ cooldownSec: 30 })).wouldHold).toBe(false);
  });

  it("reads the real host when no reader is injected", async () => {
    const decision = await createLocalRunMemoryGate().assess({
      runId: "real", localRunsLive: 0, startingRuns: 0, reservePercent: 20, cooldownSec: 120,
    });
    if (process.platform === "linux") {
      expect(decision.snapshot?.memTotalBytes).toBeGreaterThan(0);
      expect(decision.reason).not.toBe("signal_unavailable");
    } else {
      expect(decision.wouldHold).toBe(false);
    }
  });
});

describe("formatLocalRunMemoryGateLine", () => {
  it("renders one greppable line with the numbers a threshold decision needs", async () => {
    const gate = gateFor([{ availableGiB: 5, swapFreeGiB: 3 }], { now: 0 });
    const input = { runId: "run-9", localRunsLive: 7, startingRuns: 1, reservePercent: 20, cooldownSec: 120 };
    const decision = await gate.assess(input);
    const line = formatLocalRunMemoryGateLine(input, decision);
    expect(line).not.toContain("\n");
    expect(line).toBe(
      "local-run-memory-gate shadow run=run-9 memAvailableMiB=5120 memTotalMiB=32768 swapFreeMiB=3072 localRuns=7 starting=1 " +
        "inflightEstimateMiB=614 reservePct=20 reserveMiB=6554 cgroupCurrentMiB=12288 cgroupMaxMiB=na oomKill=0 " +
        "reason=low_available_memory wouldHold20=yes",
    );
  });

  it("marks unreadable signals as na", async () => {
    const gate = gateFor([{ files: { "/proc/meminfo": null } }], { now: 0 });
    const input = { runId: "run-x", localRunsLive: 0, startingRuns: 0, reservePercent: 20, cooldownSec: 120 };
    const line = formatLocalRunMemoryGateLine(input, await gate.assess(input));
    expect(line).toContain("memAvailableMiB=na");
    expect(line).toContain("reason=signal_unavailable wouldHold20=no");
  });
});
