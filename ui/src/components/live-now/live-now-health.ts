import { Activity } from "lucide-react";
import type { LiveRunForIssue } from "../../api/heartbeats";
import { statusLabelIcon, toolTaxonomy, type ToolIcon } from "../task-chat/tool-taxonomy";

export type LiveNowHealth = "starting" | "active" | "thinking" | "quiet" | "stalled";

export interface LiveNowHealthSignal {
  health: LiveNowHealth;
  label: string;
  silentMs: number | null;
}

export interface LiveNowHealthCounts {
  working: number;
  quiet: number;
  stalled: number;
}

const STARTING_WINDOW_MS = 60_000;
const QUIET_AFTER_MS = 2 * 60_000;
const STALLED_AFTER_MS = 15 * 60_000;

const HEALTH_SEVERITY: Record<LiveNowHealth, number> = {
  active: 0,
  thinking: 1,
  starting: 2,
  quiet: 3,
  stalled: 4,
};

/** Pose the agent avatar takes for each health state. */
export const LIVE_NOW_HEALTH_POSE = {
  starting: "loading",
  active: "working",
  thinking: "thinking",
  quiet: "sleepy",
  stalled: "confused",
} as const satisfies Record<LiveNowHealth, string>;

function toMs(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Latest moment the run showed any sign of life, from events, status updates or output. */
export function lastLiveActivityMs(run: LiveRunForIssue): number | null {
  let latest: number | null = null;
  for (const value of [run.lastEventAt, run.currentStatusUpdatedAt, run.outputSilence?.lastOutputAt, run.lastUsefulActionAt]) {
    const ms = toMs(value);
    if (ms !== null && (latest === null || ms > latest)) latest = ms;
  }
  return latest;
}

/** Compact silence length such as `45s`, `6m` or `1h 4m`. */
export function formatSilence(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return `${Math.max(0, Math.floor(ms / 1000))}s`;
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function toolInFlight(run: LiveRunForIssue): boolean {
  return Boolean(run.currentToolName) && !/^finished\b/i.test(run.currentStatusMessage ?? "");
}

/** Classifies a live run as starting, active, thinking, quiet or stalled. */
export function classifyLiveNowHealth(run: LiveRunForIssue, now: number): LiveNowHealthSignal {
  const startedMs = toMs(run.startedAt);
  if (startedMs === null || run.status === "queued" || run.status === "scheduled_retry") {
    return { health: "starting", label: "Queued", silentMs: null };
  }
  const lastMs = lastLiveActivityMs(run);
  if (lastMs === null && now - startedMs < STARTING_WINDOW_MS) {
    return { health: "starting", label: "Starting", silentMs: null };
  }
  const silentMs = Math.max(0, now - (lastMs ?? startedMs));
  const level = run.outputSilence?.level;
  const stalledAfterMs = run.outputSilence?.criticalThresholdMs || STALLED_AFTER_MS;
  if (level === "critical" || (level !== "snoozed" && silentMs >= stalledAfterMs)) {
    return { health: "stalled", label: `Stalled ${formatSilence(silentMs)}`, silentMs };
  }
  if (level === "suspicious" || silentMs >= QUIET_AFTER_MS) {
    return { health: "quiet", label: `Quiet ${formatSilence(silentMs)}`, silentMs };
  }
  if (toolInFlight(run)) return { health: "active", label: "Working", silentMs };
  return { health: "thinking", label: "Thinking", silentMs };
}

/** The signal that most needs the operator's attention. */
export function mostSevereSignal(signals: readonly LiveNowHealthSignal[]): LiveNowHealthSignal {
  return signals.reduce((worst, signal) =>
    HEALTH_SEVERITY[signal.health] > HEALTH_SEVERITY[worst.health] ? signal : worst,
  );
}

/** Counts working, quiet and stalled tasks for the section summary. */
export function countLiveNowHealth(healths: readonly LiveNowHealth[]): LiveNowHealthCounts {
  const counts: LiveNowHealthCounts = { working: 0, quiet: 0, stalled: 0 };
  for (const health of healths) {
    if (health === "quiet") counts.quiet += 1;
    else if (health === "stalled") counts.stalled += 1;
    else counts.working += 1;
  }
  return counts;
}

/** What the run is doing right now, with the icon of its current tool. */
export function describeLiveActivity(run: LiveRunForIssue): { icon: ToolIcon; text: string } | null {
  const tool = run.currentToolName?.trim() || null;
  const status = run.currentStatusMessage?.trim() || null;
  const text = status ?? (tool ? toolTaxonomy(tool).verbLabel : null);
  if (!text) return null;
  const icon = tool ? toolTaxonomy(tool).icon : (statusLabelIcon(text) ?? Activity);
  return { icon, text };
}
