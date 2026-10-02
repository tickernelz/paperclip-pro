import {
  extractAgentMentionIds,
  type LiveEvent,
  type PixelsOfficeAgentStatus,
  type PixelsOfficeSnapshot,
  type PixelsOfficeTimelineEvent,
} from "@tickernelz/paperclip-pro-shared";
import type { LiveRunForIssue } from "../../../api/heartbeats";
import type { ActivityIcon, AgentVisual, AgentVisualStatus, OfficeEffect } from "../officeModel";
import { activityIconForTool } from "./activityIcons";

export const TICKER_CAPACITY = 50;
export const PROGRESS_MESSAGE_MAX = 180;

export type EffectSound = "done" | "error" | "ding";

export interface LiveAgentState {
  agentId: string;
  name: string;
  status: PixelsOfficeAgentStatus;
  activeRunId: string | null;
  queuedRunId: string | null;
  pendingInteractionCount: number;
  awaitingBoardCount: number;
  budgetPaused: boolean;
  errorRunId: string | null;
  activityIcon: ActivityIcon;
  activityMessage: string | null;
  activityAtMs: number;
}

export interface TickerEntry {
  id: number;
  atMs: number;
  action: string;
  text: string;
  agentId: string | null;
}

export interface LiveOfficeState {
  agents: Map<string, LiveAgentState>;
  ticker: TickerEntry[];
  tickerSeq: number;
}

export interface LiveApplyResult {
  changed: boolean;
  effects: OfficeEffect[];
  sounds: EffectSound[];
  refetch: boolean;
  ticker: TickerEntry | null;
}

const NO_CHANGE: LiveApplyResult = Object.freeze({
  changed: false,
  effects: Object.freeze([]) as unknown as OfficeEffect[],
  sounds: Object.freeze([]) as unknown as EffectSound[],
  refetch: false,
  ticker: null,
});

const TERMINAL_RUN_STATUSES: Record<string, true> = {
  completed: true,
  succeeded: true,
  cancelled: true,
  skipped: true,
  done: true,
};
const ERROR_RUN_STATUSES: Record<string, true> = { failed: true, timed_out: true };

export function createLiveOfficeState(): LiveOfficeState {
  return { agents: new Map(), ticker: [], tickerSeq: 0 };
}

function blankAgent(agentId: string, name: string): LiveAgentState {
  return {
    agentId,
    name,
    status: "idle",
    activeRunId: null,
    queuedRunId: null,
    pendingInteractionCount: 0,
    awaitingBoardCount: 0,
    budgetPaused: false,
    errorRunId: null,
    activityIcon: "other",
    activityMessage: null,
    activityAtMs: 0,
  };
}

function ensureAgent(state: LiveOfficeState, agentId: string): LiveAgentState {
  let agent = state.agents.get(agentId);
  if (!agent) {
    agent = blankAgent(agentId, agentId);
    state.agents.set(agentId, agent);
  }
  return agent;
}

export function seedFromSnapshot(state: LiveOfficeState, snapshot: PixelsOfficeSnapshot): void {
  const seen = new Set<string>();
  for (const agent of snapshot.agents) {
    seen.add(agent.id);
    const current = state.agents.get(agent.id) ?? blankAgent(agent.id, agent.name);
    current.name = agent.name;
    current.status = agent.status;
    current.activeRunId = agent.activeRunId;
    current.queuedRunId = agent.queuedRunId;
    current.pendingInteractionCount = agent.pendingInteractionCount;
    current.awaitingBoardCount = agent.awaitingBoardCount;
    current.budgetPaused = agent.budgetPaused;
    if (agent.progress && agent.progress.runId === agent.activeRunId) {
      const at = Date.parse(agent.progress.updatedAt);
      if (!Number.isNaN(at) && at >= current.activityAtMs) {
        current.activityIcon = activityIconForTool(agent.progress.toolName);
        current.activityMessage = clampMessage(agent.progress.message);
        current.activityAtMs = at;
      }
    } else if (agent.activeRunId === null) {
      current.activityMessage = null;
      current.activityAtMs = 0;
      current.activityIcon = "other";
    }
    state.agents.set(agent.id, current);
  }
  for (const agentId of [...state.agents.keys()]) {
    if (!seen.has(agentId)) state.agents.delete(agentId);
  }
}

export function seedFromLiveRuns(state: LiveOfficeState, runs: readonly LiveRunForIssue[]): void {
  for (const run of runs) {
    const agent = state.agents.get(run.agentId);
    if (!agent) continue;
    if (run.status === "queued") {
      agent.queuedRunId = run.id;
      continue;
    }
    agent.activeRunId = run.id;
    const at = run.currentStatusUpdatedAt ? Date.parse(run.currentStatusUpdatedAt) : Number.NaN;
    const message = clampMessage(run.currentStatusMessage ?? run.lastAssistantSnippet ?? null);
    if (message === null) continue;
    const atMs = Number.isNaN(at) ? 0 : at;
    if (atMs < agent.activityAtMs) continue;
    agent.activityIcon = activityIconForTool(run.currentToolName ?? null);
    agent.activityMessage = message;
    agent.activityAtMs = atMs;
  }
}

function clampMessage(message: string | null | undefined): string | null {
  if (typeof message !== "string") return null;
  const trimmed = message.trim();
  if (!trimmed) return null;
  return trimmed.length > PROGRESS_MESSAGE_MAX
    ? `${trimmed.slice(0, PROGRESS_MESSAGE_MAX - 1)}…`
    : trimmed;
}

export function shortAgentName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  const token = first || name.trim();
  return token.length > 10 ? token.slice(0, 10) : token;
}

export function visualStatus(agent: LiveAgentState): AgentVisualStatus {
  if (agent.errorRunId !== null || agent.status === "error") return "error";
  if (agent.awaitingBoardCount > 0) return "awaiting_board";
  if (agent.pendingInteractionCount > 0 || agent.status === "pending_approval") return "pending_approval";
  if (agent.budgetPaused) return "budget_paused";
  if (agent.status === "paused") return "paused";
  if (agent.activeRunId !== null || agent.status === "running") return "running";
  if (agent.queuedRunId !== null) return "queued";
  return "idle";
}

export function deriveAgentVisuals(state: LiveOfficeState): AgentVisual[] {
  const visuals: AgentVisual[] = [];
  for (const agent of state.agents.values()) {
    const status = visualStatus(agent);
    visuals.push({
      agentId: agent.agentId,
      shortName: shortAgentName(agent.name),
      status,
      activity:
        agent.activityMessage === null && agent.activityAtMs === 0
          ? null
          : {
              icon: agent.activityIcon,
              message: agent.activityMessage,
              updatedAtMs: agent.activityAtMs,
            },
      attention: status === "awaiting_board" || status === "pending_approval" || status === "error",
      working: agent.activeRunId !== null || agent.status === "running",
    });
  }
  visuals.sort((a, b) => (a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0));
  return visuals;
}

export function agentVisualsKey(visuals: readonly AgentVisual[]): string {
  let key = "";
  for (const visual of visuals) {
    key += `${visual.agentId}|${visual.shortName}|${visual.status}|${visual.attention ? 1 : 0}|${visual.working ? 1 : 0}|${
      visual.activity ? `${visual.activity.icon}:${visual.activity.updatedAtMs}:${visual.activity.message ?? ""}` : ""
    }\n`;
  }
  return key;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readCommentBody(details: Record<string, unknown> | null): string | null {
  if (!details) return null;
  for (const key of ["body", "content", "markdown", "commentBody", "text"]) {
    const value = details[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function pushTicker(state: LiveOfficeState, entry: Omit<TickerEntry, "id">): TickerEntry {
  state.tickerSeq += 1;
  const full: TickerEntry = { id: state.tickerSeq, ...entry };
  state.ticker.push(full);
  if (state.ticker.length > TICKER_CAPACITY) state.ticker.splice(0, state.ticker.length - TICKER_CAPACITY);
  return full;
}

function tickerText(action: string, details: Record<string, unknown> | null): string {
  const identifier = readString(details?.identifier);
  const title = readString(details?.title);
  const status = readString(details?.status);
  const verb = action.replace(/^[a-z_]+\./, "").replaceAll("_", " ");
  const subject = identifier ?? title ?? status;
  return subject ? `${verb} · ${subject}` : verb;
}

function result(
  changed: boolean,
  effects: OfficeEffect[],
  sounds: EffectSound[],
  refetch: boolean,
  ticker: TickerEntry | null,
): LiveApplyResult {
  return { changed, effects, sounds, refetch, ticker };
}

function applyRunProgress(
  state: LiveOfficeState,
  payload: Record<string, unknown>,
  nowMs: number,
): LiveApplyResult {
  const agentId = readString(payload.agentId);
  if (!agentId) return NO_CHANGE;
  const agent = ensureAgent(state, agentId);
  const runId = readString(payload.runId);
  if (runId) {
    agent.activeRunId = runId;
    if (agent.queuedRunId === runId) agent.queuedRunId = null;
    if (agent.errorRunId === runId) agent.errorRunId = null;
  }
  const updatedAt = readString(payload.updatedAt) ?? readString(payload.lastEventAt);
  const parsed = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  agent.activityAtMs = Number.isNaN(parsed) ? nowMs : parsed;
  agent.activityIcon = activityIconForTool(readString(payload.currentToolName));
  agent.activityMessage =
    clampMessage(readString(payload.message)) ?? clampMessage(readString(payload.lastAssistantSnippet));
  return result(true, [], [], false, null);
}

function applyRunQueued(state: LiveOfficeState, payload: Record<string, unknown>): LiveApplyResult {
  const agentId = readString(payload.agentId);
  const runId = readString(payload.runId);
  if (!agentId) return NO_CHANGE;
  const agent = ensureAgent(state, agentId);
  agent.queuedRunId = runId;
  return result(true, [], [], true, null);
}

function applyRunStatus(state: LiveOfficeState, payload: Record<string, unknown>): LiveApplyResult {
  const agentId = readString(payload.agentId);
  const runId = readString(payload.runId);
  const status = readString(payload.status);
  if (!agentId || !status) return NO_CHANGE;
  const agent = ensureAgent(state, agentId);
  const effects: OfficeEffect[] = [];
  const sounds: EffectSound[] = [];
  if (status === "running") {
    if (runId) agent.activeRunId = runId;
    if (agent.queuedRunId === runId) agent.queuedRunId = null;
    agent.errorRunId = null;
  } else if (status === "queued") {
    agent.queuedRunId = runId;
  } else if (ERROR_RUN_STATUSES[status]) {
    if (runId) {
      agent.errorRunId = runId;
      effects.push({ kind: "error", agentId, runId });
      sounds.push("error");
    }
    if (agent.activeRunId === runId) agent.activeRunId = null;
    agent.activityMessage = null;
  } else if (TERMINAL_RUN_STATUSES[status]) {
    if (agent.activeRunId === runId) agent.activeRunId = null;
    if (agent.queuedRunId === runId) agent.queuedRunId = null;
    agent.activityMessage = null;
    agent.activityAtMs = 0;
    agent.activityIcon = "other";
  }
  return result(true, effects, sounds, true, null);
}

function applyAgentStatus(state: LiveOfficeState, payload: Record<string, unknown>): LiveApplyResult {
  const agentId = readString(payload.agentId);
  const status = readString(payload.status);
  if (!agentId || !status) return NO_CHANGE;
  const agent = ensureAgent(state, agentId);
  agent.status = status as PixelsOfficeAgentStatus;
  if (status !== "error") agent.errorRunId = null;
  return result(true, [], [], true, null);
}

function applyActivity(
  state: LiveOfficeState,
  payload: Record<string, unknown>,
  nowMs: number,
): LiveApplyResult {
  const action = readString(payload.action);
  if (!action) return NO_CHANGE;
  const details = readRecord(payload.details);
  const actorAgentId = readString(payload.agentId) ?? (payload.actorType === "agent" ? readString(payload.actorId) : null);
  const effects: OfficeEffect[] = [];
  const sounds: EffectSound[] = [];
  let changed = false;
  let refetch = false;

  if (action === "issue.updated") {
    if (readString(details?.status) === "done" && actorAgentId) {
      effects.push({ kind: "celebrate", agentId: actorAgentId, big: readChildCount(details) >= 3 });
      sounds.push("done");
    }
    refetch = true;
  } else if (action === "issue.child_created") {
    const toAgentId = readString(details?.assigneeAgentId) ?? readString(details?.addresseeAgentId);
    if (actorAgentId && toAgentId && toAgentId !== actorAgentId) {
      effects.push({ kind: "visit", fromAgentId: actorAgentId, toAgentId, reason: "delegation" });
    }
    refetch = true;
  } else if (action === "issue.thread_interaction_created") {
    const toAgentId = readString(details?.addresseeAgentId);
    if (actorAgentId && toAgentId && toAgentId !== actorAgentId) {
      effects.push({ kind: "visit", fromAgentId: actorAgentId, toAgentId, reason: "interaction" });
    }
    if (actorAgentId) {
      const agent = ensureAgent(state, actorAgentId);
      agent.pendingInteractionCount += 1;
      sounds.push("ding");
      changed = true;
    }
    refetch = true;
  } else if (action.startsWith("issue.comment")) {
    const body = readCommentBody(details);
    if (body) {
      for (const mentionedAgentId of extractAgentMentionIds(body)) {
        effects.push({ kind: "mention", agentId: mentionedAgentId });
      }
    }
    refetch = true;
  } else if (action.startsWith("issue.thread_interaction_")) {
    if (actorAgentId) {
      const agent = ensureAgent(state, actorAgentId);
      if (agent.pendingInteractionCount > 0) agent.pendingInteractionCount -= 1;
      changed = true;
    }
    refetch = true;
  } else if (action === "agent.paused") {
    const target = readString(payload.entityId) ?? actorAgentId;
    if (target) {
      ensureAgent(state, target).status = "paused";
      changed = true;
    }
    refetch = true;
  } else if (action === "agent.resumed" || action === "agent.approved") {
    const target = readString(payload.entityId) ?? actorAgentId;
    if (target) {
      const agent = ensureAgent(state, target);
      agent.status = "active";
      agent.budgetPaused = false;
      changed = true;
    }
    refetch = true;
  } else if (
    action.startsWith("issue.") ||
    action.startsWith("approval.") ||
    action.startsWith("budget.") ||
    action.startsWith("routine.")
  ) {
    refetch = true;
  }

  const ticker = pushTicker(state, { atMs: nowMs, action, text: tickerText(action, details), agentId: actorAgentId });
  return result(changed, effects, sounds, refetch, ticker);
}

function readChildCount(details: Record<string, unknown> | null): number {
  const value = details?.childIssueCount ?? details?.childCount;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function applyLiveEvent(
  state: LiveOfficeState,
  event: LiveEvent,
  nowMs: number,
): LiveApplyResult {
  switch (event.type) {
    case "heartbeat.run.progress":
      return applyRunProgress(state, event.payload, nowMs);
    case "heartbeat.run.queued":
      return applyRunQueued(state, event.payload);
    case "heartbeat.run.status":
      return applyRunStatus(state, event.payload);
    case "agent.status":
      return applyAgentStatus(state, event.payload);
    case "activity.logged":
      return applyActivity(state, event.payload, nowMs);
    default:
      return NO_CHANGE;
  }
}

export function applyTimelineEvent(
  state: LiveOfficeState,
  event: PixelsOfficeTimelineEvent,
): LiveApplyResult {
  const agentId = event.agentId;
  if (!agentId) return NO_CHANGE;
  const agent = ensureAgent(state, agentId);
  const effects: OfficeEffect[] = [];
  switch (event.kind) {
    case "run_started":
      agent.activeRunId = event.runId ?? agent.activeRunId;
      agent.queuedRunId = null;
      agent.errorRunId = null;
      agent.activityMessage = null;
      break;
    case "run_finished":
      if (event.status && ERROR_RUN_STATUSES[event.status]) {
        agent.errorRunId = event.runId ?? agent.activeRunId;
        if (agent.errorRunId) effects.push({ kind: "error", agentId, runId: agent.errorRunId });
      } else {
        agent.errorRunId = null;
      }
      agent.activeRunId = null;
      agent.activityMessage = null;
      break;
    case "issue_status":
      if (event.status === "done") effects.push({ kind: "celebrate", agentId, big: false });
      break;
    case "interaction":
      if (event.otherAgentId) {
        effects.push({ kind: "visit", fromAgentId: agentId, toAgentId: event.otherAgentId, reason: "interaction" });
      }
      break;
    case "approval":
      agent.awaitingBoardCount = event.status === "resolved" ? 0 : 1;
      break;
    case "budget":
      agent.budgetPaused = event.status !== "resolved";
      break;
    case "routine":
      break;
  }
  return result(true, effects, [], false, null);
}

export function resetTimelineAgents(state: LiveOfficeState): void {
  for (const agent of state.agents.values()) {
    agent.activeRunId = null;
    agent.queuedRunId = null;
    agent.errorRunId = null;
    agent.awaitingBoardCount = 0;
    agent.budgetPaused = false;
    agent.activityMessage = null;
    agent.activityAtMs = 0;
    agent.activityIcon = "other";
  }
}
