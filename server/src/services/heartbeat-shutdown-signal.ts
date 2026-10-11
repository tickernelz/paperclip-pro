export const DEFAULT_SHUTDOWN_EXECUTOR_SETTLE_TIMEOUT_MS = 15_000;

export const heartbeatServerShutdown: {
  signal: "SIGINT" | "SIGTERM" | null;
} = { signal: null };

const shutdownTerminatedRunIds = new Set<string>();

export function beginHeartbeatServerShutdown(signal: "SIGINT" | "SIGTERM") {
  heartbeatServerShutdown.signal ??= signal;
}

export function resetHeartbeatServerShutdownForTests() {
  heartbeatServerShutdown.signal = null;
  shutdownTerminatedRunIds.clear();
}

export function markShutdownTerminatedRun(runId: string) {
  shutdownTerminatedRunIds.add(runId);
}

export function wasShutdownTerminatedRun(runId: string) {
  return shutdownTerminatedRunIds.has(runId);
}

export function clearShutdownTerminatedRun(runId: string) {
  return shutdownTerminatedRunIds.delete(runId);
}
