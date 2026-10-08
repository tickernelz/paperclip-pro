export interface AdapterSteerTarget {
  capabilities(): Promise<{ steering: boolean }>;
  snapshot(): Promise<{ activeTurnId?: string | null }>;
  steer(input: {
    turnId: string;
    message: { role: "user"; text: string };
    correlationId?: string;
    ackTimeoutMs?: number;
  }): Promise<void>;
}

const adapterSteerTargets = new Map<string, AdapterSteerTarget>();
const registrationListeners = new Set<(runId: string) => void>();

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
    }
  };
}

export function getAdapterSteerTarget(
  runId: string,
): AdapterSteerTarget | undefined {
  return adapterSteerTargets.get(runId);
}
