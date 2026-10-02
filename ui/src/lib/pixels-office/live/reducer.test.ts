import { describe, expect, it } from "vitest";
import type {
  LiveEvent,
  PixelsOfficeAgent,
  PixelsOfficeSnapshot,
} from "@tickernelz/paperclip-pro-shared";
import {
  agentVisualsKey,
  applyLiveEvent,
  createLiveOfficeState,
  deriveAgentVisuals,
  seedFromSnapshot,
  shortAgentName,
  TICKER_CAPACITY,
  type LiveOfficeState,
} from "./reducer";
import { createOfficeLiveStore, type LiveFlushSummary } from "./store";

function agent(overrides: Partial<PixelsOfficeAgent> = {}): PixelsOfficeAgent {
  return {
    id: "agent-1",
    name: "Codex Coder",
    title: null,
    role: "worker",
    status: "active",
    urlKey: null,
    activeRunId: null,
    queuedRunId: null,
    activeTaskCount: 0,
    queuedTaskCount: 0,
    maxConcurrentRuns: 1,
    pendingInteractionCount: 0,
    awaitingBoardCount: 0,
    budgetPaused: false,
    progress: null,
    tasks: [],
    ...overrides,
  };
}

function snapshot(agents: PixelsOfficeAgent[]): PixelsOfficeSnapshot {
  return {
    companyId: "company-1",
    agents,
    assignments: [],
    collaboration: [],
    generatedAt: new Date(0).toISOString(),
  };
}

function event(type: LiveEvent["type"], payload: Record<string, unknown>): LiveEvent {
  return { id: 1, companyId: "company-1", type, createdAt: new Date(0).toISOString(), payload };
}

function seeded(agents: PixelsOfficeAgent[]): LiveOfficeState {
  const state = createLiveOfficeState();
  seedFromSnapshot(state, snapshot(agents));
  return state;
}

describe("short agent names", () => {
  it("keeps the first token and clamps it to ten characters", () => {
    expect(shortAgentName("Codex Coder")).toBe("Codex");
    expect(shortAgentName("Multitaskmaster Two")).toBe("Multitaskm");
    expect(shortAgentName("  Solo  ")).toBe("Solo");
  });
});

describe("agent visual status precedence", () => {
  it("ranks error above every other signal", () => {
    const state = seeded([
      agent({
        status: "error",
        awaitingBoardCount: 2,
        pendingInteractionCount: 3,
        budgetPaused: true,
        activeRunId: "run-1",
      }),
    ]);
    expect(deriveAgentVisuals(state)[0]?.status).toBe("error");
  });

  it("orders awaiting_board, pending_approval, budget_paused, paused, running, queued, idle", () => {
    const rows: Array<[Partial<PixelsOfficeAgent>, string]> = [
      [{ awaitingBoardCount: 1, pendingInteractionCount: 1, budgetPaused: true }, "awaiting_board"],
      [{ pendingInteractionCount: 1, budgetPaused: true, status: "paused" }, "pending_approval"],
      [{ budgetPaused: true, status: "paused" }, "budget_paused"],
      [{ status: "paused", activeRunId: "run-1" }, "paused"],
      [{ activeRunId: "run-1", queuedRunId: "run-2" }, "running"],
      [{ queuedRunId: "run-2" }, "queued"],
      [{}, "idle"],
    ];
    for (const [overrides, expected] of rows) {
      const state = seeded([agent(overrides)]);
      expect(deriveAgentVisuals(state)[0]?.status, JSON.stringify(overrides)).toBe(expected);
    }
  });

  it("flags attention only for board, approval and error states", () => {
    expect(deriveAgentVisuals(seeded([agent({ awaitingBoardCount: 1 })]))[0]?.attention).toBe(true);
    expect(deriveAgentVisuals(seeded([agent({ activeRunId: "run-1" })]))[0]?.attention).toBe(false);
  });

  it("keeps an agent working while a decision is waiting on its run", () => {
    const [visual] = deriveAgentVisuals(
      seeded([agent({ activeRunId: "run-1", status: "running", awaitingBoardCount: 1 })]),
    );
    expect(visual?.status).toBe("awaiting_board");
    expect(visual?.attention).toBe(true);
    expect(visual?.working).toBe(true);
    expect(deriveAgentVisuals(seeded([agent({ awaitingBoardCount: 1 })]))[0]?.working).toBe(false);
  });
});

describe("run events", () => {
  it("turns progress into an activity message with a tool icon", () => {
    const state = seeded([agent()]);
    applyLiveEvent(
      state,
      event("heartbeat.run.progress", {
        agentId: "agent-1",
        runId: "run-1",
        message: "Using Read",
        currentToolName: "Read",
        updatedAt: new Date(5_000).toISOString(),
      }),
      0,
    );
    const visual = deriveAgentVisuals(state)[0];
    expect(visual?.status).toBe("running");
    expect(visual?.activity).toEqual({ icon: "read", message: "Using Read", updatedAtMs: 5_000 });
  });

  it("emits an error effect and sound when a run fails, and clears it when the agent runs again", () => {
    const state = seeded([agent({ activeRunId: "run-1" })]);
    const failed = applyLiveEvent(
      state,
      event("heartbeat.run.status", { agentId: "agent-1", runId: "run-1", status: "failed" }),
      0,
    );
    expect(failed.effects).toEqual([{ kind: "error", agentId: "agent-1", runId: "run-1" }]);
    expect(failed.sounds).toEqual(["error"]);
    expect(deriveAgentVisuals(state)[0]?.status).toBe("error");

    applyLiveEvent(
      state,
      event("heartbeat.run.status", { agentId: "agent-1", runId: "run-2", status: "running" }),
      0,
    );
    expect(deriveAgentVisuals(state)[0]?.status).toBe("running");
  });

  it("drops the activity line when a run completes", () => {
    const state = seeded([agent({ activeRunId: "run-1" })]);
    applyLiveEvent(
      state,
      event("heartbeat.run.progress", { agentId: "agent-1", runId: "run-1", message: "Working" }),
      1_000,
    );
    applyLiveEvent(
      state,
      event("heartbeat.run.status", { agentId: "agent-1", runId: "run-1", status: "completed" }),
      2_000,
    );
    const visual = deriveAgentVisuals(state)[0];
    expect(visual?.status).toBe("idle");
    expect(visual?.activity).toBeNull();
  });
});

describe("activity events", () => {
  it("celebrates a task reaching done and plays the done sound", () => {
    const state = seeded([agent()]);
    const applied = applyLiveEvent(
      state,
      event("activity.logged", {
        actorType: "agent",
        actorId: "agent-1",
        agentId: "agent-1",
        action: "issue.updated",
        entityType: "issue",
        entityId: "issue-1",
        details: { status: "done", identifier: "PAP-1" },
      }),
      0,
    );
    expect(applied.effects).toEqual([{ kind: "celebrate", agentId: "agent-1", big: false }]);
    expect(applied.sounds).toEqual(["done"]);
    expect(applied.refetch).toBe(true);
  });

  it("marks a celebration big when the payload names three or more children", () => {
    const state = seeded([agent()]);
    const applied = applyLiveEvent(
      state,
      event("activity.logged", {
        actorType: "agent",
        agentId: "agent-1",
        action: "issue.updated",
        entityId: "issue-1",
        details: { status: "done", childIssueCount: 4 },
      }),
      0,
    );
    expect(applied.effects).toEqual([{ kind: "celebrate", agentId: "agent-1", big: true }]);
  });

  it("walks the creator to the addressee for an interaction and raises pending approval", () => {
    const state = seeded([agent(), agent({ id: "agent-2", name: "Reviewer" })]);
    const applied = applyLiveEvent(
      state,
      event("activity.logged", {
        actorType: "agent",
        agentId: "agent-1",
        action: "issue.thread_interaction_created",
        entityId: "issue-1",
        details: { interactionId: "i-1", addresseeAgentId: "agent-2" },
      }),
      0,
    );
    expect(applied.effects).toEqual([
      { kind: "visit", fromAgentId: "agent-1", toAgentId: "agent-2", reason: "interaction" },
    ]);
    expect(deriveAgentVisuals(state).find((v) => v.agentId === "agent-1")?.status).toBe(
      "pending_approval",
    );
  });

  it("walks the delegator to the new child's assignee", () => {
    const state = seeded([agent(), agent({ id: "agent-2", name: "Builder" })]);
    const applied = applyLiveEvent(
      state,
      event("activity.logged", {
        actorType: "agent",
        agentId: "agent-1",
        action: "issue.child_created",
        entityId: "issue-2",
        details: { parentId: "issue-1", assigneeAgentId: "agent-2" },
      }),
      0,
    );
    expect(applied.effects).toEqual([
      { kind: "visit", fromAgentId: "agent-1", toAgentId: "agent-2", reason: "delegation" },
    ]);
  });

  it("raises a mention bubble for each agent linked in a comment body", () => {
    const state = seeded([agent()]);
    const applied = applyLiveEvent(
      state,
      event("activity.logged", {
        actorType: "user",
        actorId: "user-1",
        action: "issue.comment_added",
        entityId: "issue-1",
        details: { body: "[@Codex](agent://agent-1) please look" },
      }),
      0,
    );
    expect(applied.effects).toEqual([{ kind: "mention", agentId: "agent-1" }]);
  });

  it("skips mentions when the payload carries no body", () => {
    const state = seeded([agent()]);
    const applied = applyLiveEvent(
      state,
      event("activity.logged", {
        actorType: "user",
        action: "issue.comment_added",
        entityId: "issue-1",
        details: { commentId: "comment-1" },
      }),
      0,
    );
    expect(applied.effects).toEqual([]);
  });

  it("caps the ticker at its capacity", () => {
    const state = seeded([agent()]);
    for (let index = 0; index < TICKER_CAPACITY + 7; index += 1) {
      applyLiveEvent(
        state,
        event("activity.logged", { action: "routine.run_triggered", entityId: `r-${index}` }),
        index,
      );
    }
    expect(state.ticker).toHaveLength(TICKER_CAPACITY);
    expect(state.ticker[0]?.id).toBe(8);
  });
});

describe("store batching", () => {
  it("applies a burst of events in one scheduled flush", () => {
    const frames: Array<() => void> = [];
    const store = createOfficeLiveStore("company-1", (run) => frames.push(run));
    store.seedSnapshot(snapshot([agent(), agent({ id: "agent-2", name: "Reviewer" })]));
    const summaries: LiveFlushSummary[] = [];
    store.subscribe((summary) => summaries.push(summary));

    store.push(event("heartbeat.run.status", { agentId: "agent-1", runId: "run-1", status: "running" }));
    store.push(event("heartbeat.run.progress", { agentId: "agent-1", runId: "run-1", message: "Reading" }));
    store.push(event("agent.status", { agentId: "agent-2", status: "paused" }));

    expect(frames).toHaveLength(1);
    expect(summaries).toHaveLength(0);
    frames[0]?.();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.visuals.map((visual) => visual.status)).toEqual(["running", "paused"]);
  });

  it("ignores live events while a replay is driving the office", () => {
    const frames: Array<() => void> = [];
    const store = createOfficeLiveStore("company-1", (run) => frames.push(run));
    store.seedSnapshot(snapshot([agent()]));
    store.startReplay();
    store.push(event("heartbeat.run.status", { agentId: "agent-1", runId: "run-1", status: "running" }));
    expect(frames).toHaveLength(0);

    store.applyTimelineFrame([{ at: new Date(0).toISOString(), agentId: "agent-1", kind: "run_started", runId: "run-9" }], true);
    expect(store.getVisuals()[0]?.status).toBe("running");

    store.stopReplay();
    expect(store.getVisuals()[0]?.status).toBe("idle");
  });
});

describe("visual keys", () => {
  it("changes only when something a character draws changes", () => {
    const state = seeded([agent({ activeRunId: "run-1" })]);
    const before = agentVisualsKey(deriveAgentVisuals(state));
    applyLiveEvent(
      state,
      event("heartbeat.run.progress", { agentId: "agent-1", runId: "run-1", message: "Reading" }),
      0,
    );
    const after = agentVisualsKey(deriveAgentVisuals(state));
    expect(after).not.toBe(before);

    applyLiveEvent(state, event("plugin.ui.updated", { pluginId: "p" }), 0);
    expect(agentVisualsKey(deriveAgentVisuals(state))).toBe(after);
  });

  it("keeps the bubble fresh when the same message repeats with a newer timestamp", () => {
    const state = seeded([agent({ activeRunId: "run-1" })]);
    const progress = (updatedAt: string) =>
      event("heartbeat.run.progress", { agentId: "agent-1", runId: "run-1", message: "Reading", updatedAt });
    applyLiveEvent(state, progress("2026-10-02T08:00:00.000Z"), 0);
    const first = deriveAgentVisuals(state);
    applyLiveEvent(state, progress("2026-10-02T08:00:30.000Z"), 0);
    const second = deriveAgentVisuals(state);
    expect(second[0]?.activity?.updatedAtMs).toBe(Date.parse("2026-10-02T08:00:30.000Z"));
    expect(agentVisualsKey(second)).not.toBe(agentVisualsKey(first));
  });
});
