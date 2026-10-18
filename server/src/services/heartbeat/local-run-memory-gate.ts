import { promises as fs } from "node:fs";

export const LOCAL_RUN_MEMORY_ESTIMATE_BYTES = 614 * 1024 * 1024;

export type MemorySnapshot = {
  memTotalBytes: number;
  memAvailableBytes: number;
  swapTotalBytes: number | null;
  swapFreeBytes: number | null;
  hostOomKill: number | null;
  cgroup: {
    currentBytes: number | null;
    maxBytes: number | null;
    oomEvents: number | null;
    oomKillEvents: number | null;
  } | null;
};

export type LocalRunMemoryGateReason = "ok" | "low_available_memory" | "oom_kill_cooldown" | "signal_unavailable";

export type LocalRunMemoryGateInput = {
  runId: string;
  localRunsLive: number;
  startingRuns: number;
  reservePercent: number;
  cooldownSec: number;
};

export type LocalRunMemoryGateDecision = {
  wouldHold: boolean;
  reason: LocalRunMemoryGateReason;
  snapshot: MemorySnapshot | null;
  reserveBytes: number | null;
  inflightEstimateBytes: number;
  oomKillObserved: number | null;
};

export type LocalRunMemoryGateDeps = {
  readText?: (path: string) => Promise<string>;
  now?: () => number;
};

const KIB = 1024;

function parseKeyedKilobytes(text: string): Map<string, number> {
  const values = new Map<string, number>();
  for (const line of text.split("\n")) {
    const match = /^([A-Za-z_()0-9]+):\s+(\d+)\s*kB\s*$/.exec(line);
    if (match) values.set(match[1]!, Number(match[2]) * KIB);
  }
  return values;
}

function parseKeyedCounters(text: string): Map<string, number> {
  const values = new Map<string, number>();
  for (const line of text.split("\n")) {
    const match = /^([a-z_]+)\s+(\d+)\s*$/.exec(line);
    if (match) values.set(match[1]!, Number(match[2]));
  }
  return values;
}

function parseSingleNumber(text: string | null): number | null {
  if (text === null) return null;
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

function parseServiceCgroupPath(selfCgroup: string | null): string | null {
  if (!selfCgroup) return null;
  for (const line of selfCgroup.split("\n")) {
    if (line.startsWith("0::")) {
      const relative = line.slice(3).trim();
      return relative.startsWith("/") && !relative.includes("..") ? relative : null;
    }
  }
  return null;
}

async function readOptional(readText: (path: string) => Promise<string>, path: string): Promise<string | null> {
  try {
    return await readText(path);
  } catch {
    return null;
  }
}

export async function readMemorySnapshot(readText: (path: string) => Promise<string>): Promise<MemorySnapshot | null> {
  const [meminfoText, vmstatText, selfCgroupText] = await Promise.all([
    readOptional(readText, "/proc/meminfo"),
    readOptional(readText, "/proc/vmstat"),
    readOptional(readText, "/proc/self/cgroup"),
  ]);
  if (meminfoText === null) return null;
  const meminfo = parseKeyedKilobytes(meminfoText);
  const memTotalBytes = meminfo.get("MemTotal");
  const memAvailableBytes = meminfo.get("MemAvailable");
  if (!memTotalBytes || memTotalBytes <= 0 || memAvailableBytes === undefined) return null;
  const cgroupPath = parseServiceCgroupPath(selfCgroupText);
  let cgroup: MemorySnapshot["cgroup"] = null;
  if (cgroupPath) {
    const base = "/sys/fs/cgroup" + cgroupPath;
    const [currentText, maxText, eventsText] = await Promise.all([
      readOptional(readText, base + "/memory.current"),
      readOptional(readText, base + "/memory.max"),
      readOptional(readText, base + "/memory.events"),
    ]);
    const events = eventsText === null ? null : parseKeyedCounters(eventsText);
    cgroup = {
      currentBytes: parseSingleNumber(currentText),
      maxBytes: parseSingleNumber(maxText),
      oomEvents: events?.get("oom") ?? null,
      oomKillEvents: events?.get("oom_kill") ?? null,
    };
  }
  return {
    memTotalBytes,
    memAvailableBytes,
    swapTotalBytes: meminfo.get("SwapTotal") ?? null,
    swapFreeBytes: meminfo.get("SwapFree") ?? null,
    hostOomKill: vmstatText === null ? null : (parseKeyedCounters(vmstatText).get("oom_kill") ?? null),
    cgroup,
  };
}

function oomKillTotal(snapshot: MemorySnapshot): number | null {
  const parts = [snapshot.hostOomKill, snapshot.cgroup?.oomKillEvents ?? null].filter(
    (value): value is number => value !== null,
  );
  return parts.length === 0 ? null : parts.reduce((sum, value) => sum + value, 0);
}

export function createLocalRunMemoryGate(deps: LocalRunMemoryGateDeps = {}) {
  const readText = deps.readText ?? ((path: string) => fs.readFile(path, "utf8"));
  const now = deps.now ?? Date.now;
  let lastOomKillTotal: number | null = null;
  let lastOomKillAtMs: number | null = null;

  async function assess(input: LocalRunMemoryGateInput): Promise<LocalRunMemoryGateDecision> {
    const inflightEstimateBytes = Math.max(0, input.startingRuns) * LOCAL_RUN_MEMORY_ESTIMATE_BYTES;
    let snapshot: MemorySnapshot | null = null;
    try {
      snapshot = await readMemorySnapshot(readText);
    } catch {
      snapshot = null;
    }
    if (!snapshot) {
      return {
        wouldHold: false,
        reason: "signal_unavailable",
        snapshot: null,
        reserveBytes: null,
        inflightEstimateBytes,
        oomKillObserved: null,
      };
    }
    const observedAtMs = now();
    const oomKillObserved = oomKillTotal(snapshot);
    if (oomKillObserved !== null) {
      if (lastOomKillTotal !== null && oomKillObserved > lastOomKillTotal) lastOomKillAtMs = observedAtMs;
      lastOomKillTotal = oomKillObserved;
    }
    const reserveBytes = Math.floor((snapshot.memTotalBytes * input.reservePercent) / 100);
    const lowMemory = snapshot.memAvailableBytes - inflightEstimateBytes < reserveBytes;
    const cooling = lastOomKillAtMs !== null && observedAtMs - lastOomKillAtMs < input.cooldownSec * 1000;
    return {
      wouldHold: lowMemory || cooling,
      reason: lowMemory ? "low_available_memory" : cooling ? "oom_kill_cooldown" : "ok",
      snapshot,
      reserveBytes,
      inflightEstimateBytes,
      oomKillObserved,
    };
  }

  return { assess };
}

export type LocalRunMemoryGate = ReturnType<typeof createLocalRunMemoryGate>;

function mib(bytes: number | null | undefined): string {
  return bytes === null || bytes === undefined ? "na" : String(Math.round(bytes / (1024 * 1024)));
}

export function formatLocalRunMemoryGateLine(input: LocalRunMemoryGateInput, decision: LocalRunMemoryGateDecision): string {
  const snapshot = decision.snapshot;
  return [
    "local-run-memory-gate shadow",
    `run=${input.runId}`,
    `memAvailableMiB=${mib(snapshot?.memAvailableBytes)}`,
    `memTotalMiB=${mib(snapshot?.memTotalBytes)}`,
    `swapFreeMiB=${mib(snapshot?.swapFreeBytes)}`,
    `localRuns=${input.localRunsLive}`,
    `starting=${input.startingRuns}`,
    `inflightEstimateMiB=${mib(decision.inflightEstimateBytes)}`,
    `reservePct=${input.reservePercent}`,
    `reserveMiB=${mib(decision.reserveBytes)}`,
    `cgroupCurrentMiB=${mib(snapshot?.cgroup?.currentBytes)}`,
    `cgroupMaxMiB=${mib(snapshot?.cgroup?.maxBytes)}`,
    `oomKill=${decision.oomKillObserved ?? "na"}`,
    `reason=${decision.reason}`,
    `wouldHold${input.reservePercent}=${decision.wouldHold ? "yes" : "no"}`,
  ].join(" ");
}
