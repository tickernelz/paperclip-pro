import { getStoredBoardCredential } from "../client/board-auth.js";
import { readConfig, resolveConfigPath } from "../config/store.js";
import { readRuntimeInfo, type PaperclipRuntimeInfo } from "../runtime-info.js";
import { buildLocalAppUrl } from "../utils/health-url.js";

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

export class LiveRunsBlockedError extends Error {
  readonly snapshot: LiveRunsSnapshot;

  constructor(message: string, snapshot: LiveRunsSnapshot) {
    super(message);
    this.name = "LiveRunsBlockedError";
    this.snapshot = snapshot;
  }
}

export class DrainTimeoutError extends Error {
  readonly snapshot: LiveRunsSnapshot;

  constructor(message: string, snapshot: LiveRunsSnapshot) {
    super(message);
    this.name = "DrainTimeoutError";
    this.snapshot = snapshot;
  }
}

export interface InstanceEndpoint {
  apiBase: string;
  source: "runtime-info" | "config";
  pid: number | null;
}

export interface InstanceEndpointDeps {
  readRuntime?: (instanceId: string) => PaperclipRuntimeInfo | null;
  isProcessAlive?: (pid: number) => boolean;
}

export class InstanceUnreachableError extends Error {
  readonly endpoint: InstanceEndpoint;

  constructor(message: string, endpoint: InstanceEndpoint, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "InstanceUnreachableError";
    this.endpoint = endpoint;
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function resolveConfiguredInstanceApiBase(instanceId: string): string {
  process.env.PAPERCLIP_INSTANCE_ID = instanceId;
  const config = readConfig(resolveConfigPath());
  return buildLocalAppUrl(config?.server.host, config?.server.port ?? 3100);
}

export function resolveInstanceEndpoint(instanceId: string, deps: InstanceEndpointDeps = {}): InstanceEndpoint {
  const runtime = (deps.readRuntime ?? readRuntimeInfo)(instanceId);
  const alive = deps.isProcessAlive ?? isProcessAlive;
  if (runtime && alive(runtime.pid)) {
    return { apiBase: buildLocalAppUrl(runtime.host, runtime.port), source: "runtime-info", pid: runtime.pid };
  }
  return { apiBase: resolveConfiguredInstanceApiBase(instanceId), source: "config", pid: null };
}

export function resolveInstanceApiBase(instanceId: string, deps: InstanceEndpointDeps = {}): string {
  return resolveInstanceEndpoint(instanceId, deps).apiBase;
}

function emptySnapshot(): LiveRunsSnapshot {
  return { draining: false, pendingWakes: 0, count: 0, runs: [] };
}

function normalizeSnapshot(body: unknown): LiveRunsSnapshot {
  const raw = (body ?? {}) as Partial<LiveRunsSnapshot>;
  const runs = Array.isArray(raw.runs) ? raw.runs : [];
  return {
    draining: raw.draining === true,
    pendingWakes: typeof raw.pendingWakes === "number" ? raw.pendingWakes : 0,
    count: typeof raw.count === "number" ? raw.count : runs.length,
    runs: runs.map((run) => ({
      id: String((run as LiveRunSummary)?.id ?? ""),
      companyId: (run as LiveRunSummary)?.companyId ?? null,
      agentId: (run as LiveRunSummary)?.agentId ?? null,
      status: (run as LiveRunSummary)?.status ?? null,
      startedAt: (run as LiveRunSummary)?.startedAt ?? null,
      issueId: (run as LiveRunSummary)?.issueId ?? null,
    })),
  };
}

export function describeUnreachableInstance(endpoint: InstanceEndpoint, verb: string): string {
  const origin = endpoint.source === "runtime-info"
    ? `the running server (pid ${endpoint.pid}) reported ${endpoint.apiBase}`
    : `the configured address ${endpoint.apiBase}`;
  return `Refusing to ${verb} Paperclip: it is running but its API is unreachable at ${endpoint.apiBase}, so live agent runs cannot be counted (${origin}). Check the service logs, or pass --force to ${verb} anyway and interrupt whatever is running.`;
}

export function createInstanceRunControl(
  instanceId: string,
  options: {
    apiBase?: string;
    endpoint?: InstanceEndpoint;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    verb?: string;
  } = {},
): InstanceRunControl {
  const endpoint: InstanceEndpoint = options.endpoint
    ?? (options.apiBase ? { apiBase: options.apiBase, source: "config", pid: null } : resolveInstanceEndpoint(instanceId));
  const apiBase = endpoint.apiBase;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const verb = options.verb ?? "restart";

  async function call(path: string, method: "GET" | "POST" | "DELETE", body?: unknown): Promise<unknown> {
    const token = getStoredBoardCredential(apiBase)?.token;
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    let response: Response;
    try {
      response = await fetchImpl(`${apiBase}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new InstanceUnreachableError(describeUnreachableInstance(endpoint, verb), endpoint, { cause: error });
    }
    if (!response.ok) {
      throw new Error(`Paperclip API ${method} ${path} failed with HTTP ${response.status}.`);
    }
    return await response.json().catch(() => null);
  }

  return {
    async liveRuns() {
      return normalizeSnapshot(await call("/api/instance/live-runs", "GET"));
    },
    async startDrain(ttlMs) {
      await call("/api/instance/task-drain", "POST", ttlMs === null ? {} : { ttlMs });
    },
    async stopDrain() {
      await call("/api/instance/task-drain", "DELETE");
    },
  };
}

export function describeLiveRuns(snapshot: LiveRunsSnapshot): string {
  if (snapshot.runs.length === 0) return "";
  return snapshot.runs
    .map((run) => `  - run ${run.id}${run.issueId ? ` (issue ${run.issueId})` : " (no issue context)"}`)
    .join("\n");
}

export function formatLiveRunsBlocker(verb: string, snapshot: LiveRunsSnapshot): string {
  const issueIds = [...new Set(snapshot.runs.map((run) => run.issueId).filter((id): id is string => !!id))];
  const issueLabel = issueIds.length > 0 ? ` on issue${issueIds.length === 1 ? "" : "s"} ${issueIds.join(", ")}` : "";
  const detail = describeLiveRuns(snapshot);
  const pending = snapshot.pendingWakes > 0 ? `\n${snapshot.pendingWakes} queued wake(s) are also still pending.` : "";
  return `Refusing to ${verb} Paperclip: ${snapshot.count} live agent run(s)${issueLabel} would be interrupted.${detail ? `\n${detail}` : ""}${pending}\nWait for them to finish, run "paperclip-pro service restart --drain" to stop admitting new runs and wait, or pass --force to interrupt them now.`;
}

export async function assertNoLiveRuns(input: {
  verb: string;
  control: InstanceRunControl;
  force?: boolean;
}): Promise<LiveRunsSnapshot> {
  if (input.force) return emptySnapshot();
  const snapshot = await input.control.liveRuns();
  if (snapshot.count > 0 || snapshot.pendingWakes > 0) {
    throw new LiveRunsBlockedError(formatLiveRunsBlocker(input.verb, snapshot), snapshot);
  }
  return snapshot;
}

export async function waitForInstanceQuiescent(input: {
  control: InstanceRunControl;
  timeoutMs: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onPoll?: (snapshot: LiveRunsSnapshot) => void;
}): Promise<LiveRunsSnapshot> {
  const pollMs = input.pollMs ?? 1_000;
  const now = input.now ?? (() => Date.now());
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + input.timeoutMs;
  let snapshot = await input.control.liveRuns();
  input.onPoll?.(snapshot);
  while (snapshot.count > 0 || snapshot.pendingWakes > 0) {
    if (now() >= deadline) {
      throw new DrainTimeoutError(
        `Paperclip still has ${snapshot.count} live agent run(s) after waiting ${Math.round(input.timeoutMs / 1000)}s; the service was not restarted.${describeLiveRuns(snapshot) ? `\n${describeLiveRuns(snapshot)}` : ""}`,
        snapshot,
      );
    }
    await sleep(pollMs);
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
}): Promise<LiveRunsSnapshot> {
  await input.control.startDrain(input.timeoutMs + 60_000);
  try {
    return await waitForInstanceQuiescent(input);
  } catch (error) {
    await input.control.stopDrain().catch(() => undefined);
    throw error;
  }
}

export async function assertAdmissionRestored(control: InstanceRunControl): Promise<LiveRunsSnapshot> {
  const snapshot = await control.liveRuns();
  if (!snapshot.draining) return snapshot;
  await control.stopDrain();
  const cleared = await control.liveRuns();
  if (cleared.draining) {
    throw new Error("Paperclip restarted but is still refusing new runs: the task drain did not clear.");
  }
  return cleared;
}
