export interface LiveRunSummary {
  id: string;
  companyId: string | null;
  agentId: string | null;
  status: string | null;
  startedAt: string | null;
  issueId: string | null;
}

export interface LiveRunsSnapshot {
  draining: boolean;
  pendingWakes: number;
  count: number;
  runs: LiveRunSummary[];
}

export interface InstanceRunControl {
  liveRuns(): Promise<LiveRunsSnapshot>;
  startDrain(ttlMs: number | null): Promise<void>;
  stopDrain(): Promise<void>;
}

export class DrainTimeoutError extends Error {
  readonly snapshot: LiveRunsSnapshot;

  constructor(message: string, snapshot: LiveRunsSnapshot) {
    super(message);
    this.name = "DrainTimeoutError";
    this.snapshot = snapshot;
  }
}

export class DrainCancelledError extends Error {
  constructor() {
    super("Waiting for live runs was cancelled.");
    this.name = "DrainCancelledError";
  }
}

export function describeLiveRuns(snapshot: LiveRunsSnapshot): string {
  if (snapshot.runs.length === 0) return "";
  return snapshot.runs
    .map((run) => `  - run ${run.id}${run.issueId ? ` (issue ${run.issueId})` : " (no issue context)"}`)
    .join("\n");
}

export async function waitForInstanceQuiescent(input: {
  control: InstanceRunControl;
  timeoutMs: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onPoll?: (snapshot: LiveRunsSnapshot) => void;
  signal?: AbortSignal;
}): Promise<LiveRunsSnapshot> {
  const pollMs = input.pollMs ?? 1_000;
  const now = input.now ?? (() => Date.now());
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + input.timeoutMs;
  let snapshot = await input.control.liveRuns();
  input.onPoll?.(snapshot);
  while (snapshot.count > 0 || snapshot.pendingWakes > 0) {
    if (input.signal?.aborted) throw new DrainCancelledError();
    if (now() >= deadline) {
      throw new DrainTimeoutError(
        `Wardmote still has ${snapshot.count} live agent run(s) after waiting ${Math.round(input.timeoutMs / 1000)}s; the service was not restarted.${describeLiveRuns(snapshot) ? `\n${describeLiveRuns(snapshot)}` : ""}`,
        snapshot,
      );
    }
    await sleep(pollMs);
    if (input.signal?.aborted) throw new DrainCancelledError();
    snapshot = await input.control.liveRuns();
    input.onPoll?.(snapshot);
  }
  return snapshot;
}

export async function drainInstanceForRestart(input: {
  control: InstanceRunControl;
  timeoutMs: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onPoll?: (snapshot: LiveRunsSnapshot) => void;
  signal?: AbortSignal;
  keepDrainOnError?: (error: unknown) => boolean;
}): Promise<LiveRunsSnapshot> {
  await input.control.startDrain(input.timeoutMs + 60_000);
  try {
    return await waitForInstanceQuiescent(input);
  } catch (error) {
    if (!input.keepDrainOnError?.(error)) await input.control.stopDrain().catch(() => undefined);
    throw error;
  }
}
