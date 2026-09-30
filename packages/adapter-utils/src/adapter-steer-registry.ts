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

export function registerAdapterSteerTarget(
  runId: string,
  target: AdapterSteerTarget,
): () => void {
  const existing = adapterSteerTargets.get(runId);
  if (existing && existing !== target) {
    throw new Error("adapter_steer_target_conflict");
  }
  adapterSteerTargets.set(runId, target);
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
