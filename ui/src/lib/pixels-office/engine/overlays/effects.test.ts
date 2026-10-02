import { describe, expect, it } from "vitest";
import type {
  AgentVisual,
  CharacterPose,
  OfficeCameraState,
  OfficeController,
  OfficeEffect,
  OfficeHit,
  OfficeObjectKind,
} from "../../officeModel";
import { ParticlePool } from "./particles";
import {
  CONFETTI_CAPACITY,
  MENTION_CAPACITY,
  OfficeEffectState,
  SMOKE_CAPACITY,
  VISIT_CAPACITY,
} from "./effectState";

function createOffice(agentIds: string[]): OfficeController {
  const listeners: ((effect: OfficeEffect) => void)[] = [];
  const camera: OfficeCameraState = {
    centerX: 0,
    centerY: 0,
    zoom: 2,
    followAgentId: null,
  };
  return {
    companyId: "company",
    worldWidth: 1024,
    worldHeight: 512,
    frameCount: 0,
    syncAgents: () => undefined,
    readPlacements: () => [],
    visual: (agentId: string): AgentVisual | undefined =>
      agentIds.includes(agentId)
        ? {
            agentId,
            shortName: agentId,
            status: "running",
            activity: null,
            attention: false,
            working: true,
          }
        : undefined,
    forEachPose: (visit: (pose: CharacterPose) => void) => {
      for (let i = 0; i < agentIds.length; i += 1) {
        visit({ agentId: agentIds[i], x: i * 16, y: 32, moving: false, seated: true });
      }
    },
    pose: (agentId: string): CharacterPose | undefined => {
      const index = agentIds.indexOf(agentId);
      return index < 0
        ? undefined
        : { agentId, x: index * 16, y: 32, moving: false, seated: true };
    },
    objectAnchor: (_object: OfficeObjectKind) => ({ x: 8, y: 8 }),
    emit: (effect: OfficeEffect) => {
      for (const listener of listeners) listener(effect);
    },
    onEffect: (listener: (effect: OfficeEffect) => void) => {
      listeners.push(listener);
      return () => {
        listeners.splice(listeners.indexOf(listener), 1);
      };
    },
    setOverlayLayers: () => undefined,
    hitTest: (): OfficeHit => null,
    select: () => undefined,
    selectedAgentId: null,
    hover: () => undefined,
    hoveredAgentId: null,
    camera,
    panBy: () => undefined,
    zoomAt: () => undefined,
    centerOn: () => undefined,
    follow: () => undefined,
    drawMinimap: () => undefined,
    attach: () => undefined,
    detach: () => undefined,
    wake: () => undefined,
  };
}

describe("ParticlePool", () => {
  it("never exceeds its capacity no matter how many spawns arrive", () => {
    const pool = new ParticlePool(8);

    let accepted = 0;
    for (let i = 0; i < 500; i += 1) {
      if (pool.spawn(0, 0, 1, 1, 1, 0)) accepted += 1;
    }

    expect(accepted).toBe(8);
    expect(pool.count).toBe(8);
  });

  it("frees slots as particles expire and reuses them for later spawns", () => {
    const pool = new ParticlePool(4);
    for (let i = 0; i < 4; i += 1) pool.spawn(0, 0, 0, 0, 0.1, 0);

    const stillAlive = pool.step(0.2, 0, 1);

    expect(stillAlive).toBe(false);
    expect(pool.count).toBe(0);
    expect(pool.spawn(0, 0, 0, 0, 1, 0)).toBe(true);
  });

  it("keeps surviving particles when only some expire", () => {
    const pool = new ParticlePool(4);
    pool.spawn(0, 0, 0, 0, 0.05, 0);
    pool.spawn(10, 0, 0, 0, 5, 1);
    pool.spawn(20, 0, 0, 0, 0.05, 2);

    pool.step(0.1, 0, 1);

    expect(pool.count).toBe(1);
    expect(pool.x[0]).toBe(10);
    expect(pool.tint[0]).toBe(1);
  });
});

describe("OfficeEffectState", () => {
  it("caps confetti, smoke, visits and mentions under an event storm", () => {
    const agents = Array.from({ length: 40 }, (_, i) => `agent-${i}`);
    const office = createOffice(agents);
    const state = new OfficeEffectState(office);

    for (let i = 0; i < 200; i += 1) {
      office.emit({ kind: "celebrate", agentId: agents[i % agents.length], big: true });
      office.emit({ kind: "error", agentId: agents[i % agents.length], runId: `run-${i}` });
      office.emit({
        kind: "visit",
        fromAgentId: agents[i % agents.length],
        toAgentId: agents[(i + 1) % agents.length],
        reason: "interaction",
      });
      office.emit({ kind: "mention", agentId: agents[i % agents.length] });
    }

    expect(state.confetti.count).toBeLessThanOrEqual(CONFETTI_CAPACITY);
    expect(state.smokeCount).toBeLessThanOrEqual(SMOKE_CAPACITY);
    expect(state.visitCount).toBeLessThanOrEqual(VISIT_CAPACITY);
    expect(state.mentionCount).toBeLessThanOrEqual(MENTION_CAPACITY);

    state.update(0.033);

    expect(state.smokeCount).toBeLessThanOrEqual(SMOKE_CAPACITY);
    state.dispose();
  });

  it("refreshes an existing smoke source instead of consuming another slot", () => {
    const office = createOffice(["a", "b"]);
    const state = new OfficeEffectState(office);

    office.emit({ kind: "error", agentId: "a", runId: "run-1" });
    office.emit({ kind: "error", agentId: "a", runId: "run-2" });

    expect(state.smokeCount).toBe(1);
    state.dispose();
  });

  it("goes quiet once every timed effect has expired", () => {
    const office = createOffice(["a"]);
    const state = new OfficeEffectState(office);
    office.emit({ kind: "mention", agentId: "a" });
    office.emit({ kind: "error", agentId: "a", runId: "run-1" });

    expect(state.update(0.1)).toBe(true);

    for (let i = 0; i < 400; i += 1) state.update(0.1);

    expect(state.update(0.1)).toBe(false);
    expect(state.alarmPhase).toBe(0);
    state.dispose();
  });
});
