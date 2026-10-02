import type { CharacterPose, OfficeController, OfficeEffect } from "../../officeModel";
import { ParticlePool } from "./particles";

export const CONFETTI_CAPACITY = 180;
export const VISIT_CAPACITY = 12;
export const MENTION_CAPACITY = 12;
export const SMOKE_CAPACITY = 8;
export const CHEER_CAPACITY = 40;

export const VISIT_DURATION_SEC = 4;
export const MENTION_DURATION_SEC = 3;
export const SMOKE_DURATION_SEC = 6;
export const CHEER_DURATION_SEC = 1.2;
export const SMOKE_FRAME_SEC = 0.25;
export const CONFETTI_GRAVITY = 90;
export const CONFETTI_DRAG = 0.985;
export const CONFETTI_BURST = 36;
export const CONFETTI_BIG_BURST = 72;

export const CONFETTI_COLORS = [
  "#f87171",
  "#fbbf24",
  "#34d399",
  "#60a5fa",
  "#c084fc",
  "#f9fafb",
];

export interface VisitLink {
  fromAgentId: string;
  toAgentId: string;
  ttl: number;
}

export interface TimedAgent {
  agentId: string;
  ttl: number;
}

export interface SmokeSource {
  agentId: string;
  ttl: number;
  frame: number;
  frameTimer: number;
}

export class OfficeEffectState {
  readonly confetti = new ParticlePool(CONFETTI_CAPACITY);
  readonly visits: VisitLink[] = Array.from({ length: VISIT_CAPACITY }, () => ({
    fromAgentId: "",
    toAgentId: "",
    ttl: 0,
  }));
  readonly mentions: TimedAgent[] = Array.from({ length: MENTION_CAPACITY }, () => ({
    agentId: "",
    ttl: 0,
  }));
  readonly smokes: SmokeSource[] = Array.from({ length: SMOKE_CAPACITY }, () => ({
    agentId: "",
    ttl: 0,
    frame: 0,
    frameTimer: 0,
  }));
  readonly cheers: TimedAgent[] = Array.from({ length: CHEER_CAPACITY }, () => ({
    agentId: "",
    ttl: 0,
  }));
  readonly stickyErrors = new Set<string>();

  visitCount = 0;
  mentionCount = 0;
  smokeCount = 0;
  cheerCount = 0;
  alarmPhase = 0;

  private readonly office: OfficeController;
  private readonly unsubscribe: () => void;
  private bigCheerPending = false;

  constructor(office: OfficeController) {
    this.office = office;
    this.unsubscribe = office.onEffect(this.handleEffect);
  }

  dispose(): void {
    this.unsubscribe();
  }

  private readonly cheerPose = (pose: CharacterPose): void => {
    this.pushCheer(pose.agentId);
  };

  private readonly handleEffect = (effect: OfficeEffect): void => {
    if (effect.kind === "celebrate") {
      const pose = this.office.pose(effect.agentId);
      if (pose) {
        this.burst(pose.x, pose.y - 24, effect.big ? CONFETTI_BIG_BURST : CONFETTI_BURST);
      }
      this.pushCheer(effect.agentId);
      if (effect.big) {
        this.bigCheerPending = true;
      }
      return;
    }
    if (effect.kind === "error") {
      this.stickyErrors.add(effect.agentId);
      for (let i = 0; i < this.smokeCount; i += 1) {
        if (this.smokes[i].agentId !== effect.agentId) continue;
        this.smokes[i].ttl = SMOKE_DURATION_SEC;
        return;
      }
      if (this.smokeCount >= SMOKE_CAPACITY) return;
      const slot = this.smokes[this.smokeCount];
      slot.agentId = effect.agentId;
      slot.ttl = SMOKE_DURATION_SEC;
      slot.frame = 0;
      slot.frameTimer = 0;
      this.smokeCount += 1;
      return;
    }
    if (effect.kind === "visit") {
      for (let i = 0; i < this.visitCount; i += 1) {
        const link = this.visits[i];
        if (link.fromAgentId !== effect.fromAgentId) continue;
        link.toAgentId = effect.toAgentId;
        link.ttl = VISIT_DURATION_SEC;
        return;
      }
      if (this.visitCount >= VISIT_CAPACITY) return;
      const link = this.visits[this.visitCount];
      link.fromAgentId = effect.fromAgentId;
      link.toAgentId = effect.toAgentId;
      link.ttl = VISIT_DURATION_SEC;
      this.visitCount += 1;
      return;
    }
    for (let i = 0; i < this.mentionCount; i += 1) {
      if (this.mentions[i].agentId !== effect.agentId) continue;
      this.mentions[i].ttl = MENTION_DURATION_SEC;
      return;
    }
    if (this.mentionCount >= MENTION_CAPACITY) return;
    const slot = this.mentions[this.mentionCount];
    slot.agentId = effect.agentId;
    slot.ttl = MENTION_DURATION_SEC;
    this.mentionCount += 1;
  };

  burst(x: number, y: number, amount: number): void {
    for (let i = 0; i < amount; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 20 + Math.random() * 55;
      const spawned = this.confetti.spawn(
        x,
        y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed - 40,
        0.9 + Math.random() * 0.8,
        (Math.random() * CONFETTI_COLORS.length) | 0,
      );
      if (!spawned) return;
    }
  }

  pushCheer(agentId: string): void {
    for (let i = 0; i < this.cheerCount; i += 1) {
      if (this.cheers[i].agentId !== agentId) continue;
      this.cheers[i].ttl = CHEER_DURATION_SEC;
      return;
    }
    if (this.cheerCount >= CHEER_CAPACITY) return;
    const slot = this.cheers[this.cheerCount];
    slot.agentId = agentId;
    slot.ttl = CHEER_DURATION_SEC;
    this.cheerCount += 1;
  }

  mentionTtl(agentId: string): number {
    for (let i = 0; i < this.mentionCount; i += 1) {
      if (this.mentions[i].agentId === agentId) return this.mentions[i].ttl;
    }
    return 0;
  }

  update(dt: number): boolean {
    if (this.bigCheerPending) {
      this.bigCheerPending = false;
      this.office.forEachPose(this.cheerPose);
    }

    const selected = this.office.selectedAgentId;
    if (selected !== null) this.stickyErrors.delete(selected);

    let active = this.confetti.step(dt, CONFETTI_GRAVITY, CONFETTI_DRAG);

    let i = 0;
    while (i < this.visitCount) {
      const link = this.visits[i];
      link.ttl -= dt;
      if (link.ttl <= 0) {
        const last = this.visitCount - 1;
        this.visits[i] = this.visits[last];
        this.visits[last] = link;
        this.visitCount = last;
        continue;
      }
      i += 1;
    }
    if (this.visitCount > 0) active = true;

    i = 0;
    while (i < this.mentionCount) {
      const slot = this.mentions[i];
      slot.ttl -= dt;
      if (slot.ttl <= 0) {
        const last = this.mentionCount - 1;
        this.mentions[i] = this.mentions[last];
        this.mentions[last] = slot;
        this.mentionCount = last;
        continue;
      }
      i += 1;
    }
    if (this.mentionCount > 0) active = true;

    i = 0;
    while (i < this.cheerCount) {
      const slot = this.cheers[i];
      slot.ttl -= dt;
      if (slot.ttl <= 0) {
        const last = this.cheerCount - 1;
        this.cheers[i] = this.cheers[last];
        this.cheers[last] = slot;
        this.cheerCount = last;
        continue;
      }
      i += 1;
    }
    if (this.cheerCount > 0) active = true;

    i = 0;
    while (i < this.smokeCount) {
      const slot = this.smokes[i];
      slot.ttl -= dt;
      if (slot.ttl <= 0) {
        const last = this.smokeCount - 1;
        this.smokes[i] = this.smokes[last];
        this.smokes[last] = slot;
        this.smokeCount = last;
        continue;
      }
      slot.frameTimer += dt;
      while (slot.frameTimer >= SMOKE_FRAME_SEC) {
        slot.frameTimer -= SMOKE_FRAME_SEC;
        slot.frame = (slot.frame + 1) % 3;
      }
      i += 1;
    }
    if (this.smokeCount > 0) {
      this.alarmPhase += dt;
      active = true;
    } else {
      this.alarmPhase = 0;
    }

    return active;
  }
}
