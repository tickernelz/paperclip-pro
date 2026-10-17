export interface AdapterSteerTarget {
  capabilities(): Promise<{ steering: boolean }>;
  snapshot(): Promise<{ activeTurnId?: string | null }>;
  steer(input: {
    turnId: string;
    message: { role: "user"; text: string };
    correlationId?: string;
    ackTimeoutMs?: number;
  }): Promise<void>;
  onceTurnActive?(listener: () => void): () => void;
}

const adapterSteerTargets = new Map<string, AdapterSteerTarget>();
const registrationListeners = new Set<(runId: string) => void>();
const turnActiveWaits = new Map<
  string,
  { tasks: Array<() => Promise<void>>; cancel: () => void }
>();
const turnActiveFlushes = new Map<string, Promise<void>>();

/** Subscribes to steer target registrations; returns the unsubscribe function. */
export function onAdapterSteerTargetRegistered(
  listener: (runId: string) => void,
): () => void {
  registrationListeners.add(listener);
  return () => {
    registrationListeners.delete(listener);
  };
}

export function registerAdapterSteerTarget(
  runId: string,
  target: AdapterSteerTarget,
): () => void {
  const existing = adapterSteerTargets.get(runId);
  if (existing && existing !== target) {
    throw new Error("adapter_steer_target_conflict");
  }
  adapterSteerTargets.set(runId, target);
  if (existing !== target) {
    for (const listener of registrationListeners) {
      try {
        listener(runId);
      } catch {
      }
    }
  }
  return () => {
    if (adapterSteerTargets.get(runId) === target) {
      adapterSteerTargets.delete(runId);
      turnActiveWaits.get(runId)?.cancel();
      turnActiveWaits.delete(runId);
    }
  };
}

export function deferUntilAdapterTurnActive(
  runId: string,
  task: () => Promise<void>,
): boolean {
  const target = adapterSteerTargets.get(runId);
  if (!target?.onceTurnActive) return false;
  const waiting = turnActiveWaits.get(runId);
  if (waiting) {
    waiting.tasks.push(task);
    return true;
  }
  const tasks = [task];
  const cancel = target.onceTurnActive(() => {
    if (turnActiveWaits.get(runId)?.tasks !== tasks) return;
    turnActiveWaits.delete(runId);
    const flush = (turnActiveFlushes.get(runId) ?? Promise.resolve()).then(async () => {
      for (const run of tasks) await run().catch(() => undefined);
    });
    turnActiveFlushes.set(runId, flush);
    void flush.finally(() => {
      if (turnActiveFlushes.get(runId) === flush) turnActiveFlushes.delete(runId);
    });
  });
  turnActiveWaits.set(runId, { tasks, cancel });
  return true;
}

export function getAdapterSteerTarget(
  runId: string,
): AdapterSteerTarget | undefined {
  return adapterSteerTargets.get(runId);
}
