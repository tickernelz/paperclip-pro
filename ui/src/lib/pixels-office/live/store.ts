import type {
  LiveEvent,
  PixelsOfficeSnapshot,
  PixelsOfficeTimelineEvent,
} from "@tickernelz/paperclip-pro-shared";
import type { LiveRunForIssue } from "../../../api/heartbeats";
import type { AgentVisual, OfficeEffect } from "../officeModel";
import {
  agentVisualsKey,
  applyLiveEvent,
  applyTimelineEvent,
  createLiveOfficeState,
  deriveAgentVisuals,
  resetTimelineAgents,
  seedFromLiveRuns,
  seedFromSnapshot,
  type EffectSound,
  type LiveOfficeState,
  type TickerEntry,
} from "./reducer";

export interface LiveFlushSummary {
  visuals: readonly AgentVisual[];
  visualsChanged: boolean;
  ticker: readonly TickerEntry[];
  tickerChanged: boolean;
  effects: readonly OfficeEffect[];
  sounds: readonly EffectSound[];
  refetch: boolean;
}

export type LiveFlushListener = (summary: LiveFlushSummary) => void;

export type FrameScheduler = (run: () => void) => void;

export interface OfficeLiveStore {
  readonly companyId: string;
  readonly state: LiveOfficeState;
  getVisuals(): readonly AgentVisual[];
  getTicker(): readonly TickerEntry[];
  isReplaying(): boolean;
  seedSnapshot(snapshot: PixelsOfficeSnapshot): void;
  seedLiveRuns(runs: readonly LiveRunForIssue[]): void;
  push(event: LiveEvent): void;
  flushNow(): void;
  startReplay(): void;
  applyTimelineFrame(events: readonly PixelsOfficeTimelineEvent[], reset: boolean): void;
  stopReplay(): void;
  subscribe(listener: LiveFlushListener): () => void;
}

function defaultScheduler(run: () => void): void {
  if (typeof requestAnimationFrame === "function" && typeof document !== "undefined" && !document.hidden) {
    requestAnimationFrame(run);
    return;
  }
  setTimeout(run, 0);
}

export function createOfficeLiveStore(
  companyId: string,
  schedule: FrameScheduler = defaultScheduler,
): OfficeLiveStore {
  const state = createLiveOfficeState();
  const listeners = new Set<LiveFlushListener>();
  const pending: LiveEvent[] = [];
  let visuals: readonly AgentVisual[] = [];
  let visualsKey = "";
  let scheduled = false;
  let replaying = false;
  let lastSnapshot: PixelsOfficeSnapshot | null = null;

  const effects: OfficeEffect[] = [];
  const sounds: EffectSound[] = [];

  function recomputeVisuals(): boolean {
    const next = deriveAgentVisuals(state);
    const nextKey = agentVisualsKey(next);
    if (nextKey === visualsKey) return false;
    visuals = next;
    visualsKey = nextKey;
    return true;
  }

  function emit(summary: LiveFlushSummary): void {
    for (const listener of listeners) listener(summary);
  }

  function publish(tickerChanged: boolean, refetch: boolean): void {
    const visualsChanged = recomputeVisuals();
    if (!visualsChanged && !tickerChanged && !refetch && effects.length === 0 && sounds.length === 0) return;
    emit({
      visuals,
      visualsChanged,
      ticker: state.ticker,
      tickerChanged,
      effects: effects.slice(),
      sounds: sounds.slice(),
      refetch,
    });
    effects.length = 0;
    sounds.length = 0;
  }

  function flush(): void {
    scheduled = false;
    if (pending.length === 0) return;
    const nowMs = Date.now();
    let tickerChanged = false;
    let refetch = false;
    for (const event of pending) {
      const applied = applyLiveEvent(state, event, nowMs);
      if (applied.ticker) tickerChanged = true;
      if (applied.refetch) refetch = true;
      for (const effect of applied.effects) effects.push(effect);
      for (const sound of applied.sounds) sounds.push(sound);
    }
    pending.length = 0;
    publish(tickerChanged, refetch);
  }

  return {
    companyId,
    state,
    getVisuals: () => visuals,
    getTicker: () => state.ticker,
    isReplaying: () => replaying,
    seedSnapshot(snapshot) {
      lastSnapshot = snapshot;
      if (replaying) return;
      seedFromSnapshot(state, snapshot);
      publish(false, false);
    },
    seedLiveRuns(runs) {
      if (replaying) return;
      seedFromLiveRuns(state, runs);
      publish(false, false);
    },
    push(event) {
      if (replaying) return;
      pending.push(event);
      if (scheduled) return;
      scheduled = true;
      schedule(flush);
    },
    flushNow: flush,
    startReplay() {
      replaying = true;
      pending.length = 0;
    },
    applyTimelineFrame(events, reset) {
      if (!replaying) return;
      if (reset) resetTimelineAgents(state);
      for (const event of events) {
        const applied = applyTimelineEvent(state, event);
        for (const effect of applied.effects) effects.push(effect);
      }
      publish(false, false);
    },
    stopReplay() {
      replaying = false;
      if (lastSnapshot) seedFromSnapshot(state, lastSnapshot);
      publish(false, true);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const stores = new Map<string, OfficeLiveStore>();

export function getOfficeLiveStore(companyId: string): OfficeLiveStore {
  let store = stores.get(companyId);
  if (!store) {
    store = createOfficeLiveStore(companyId);
    stores.set(companyId, store);
  }
  return store;
}
