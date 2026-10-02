import type { Character } from '../types';
import { CharacterState, Direction } from '../types';
import type { RestoredPose } from './officeState';

const STORAGE_PREFIX = 'pixels-office:v2:';
const FLUSH_INTERVAL_MS = 2000;

interface StoredPose {
  c: number;
  r: number;
  x: number;
  y: number;
  d: number;
  s: string;
  p: number;
  h: number;
  seat: string | null;
}

interface StoredOffice {
  v: 2;
  poses: Record<string, StoredPose>;
}

function storage(): Storage | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

function toRestoredPose(stored: StoredPose): RestoredPose | null {
  const state = Object.values(CharacterState).find((value) => value === stored.s);
  const dir = Object.values(Direction).find((value) => value === stored.d);
  if (!state || dir === undefined) return null;
  if (!Number.isFinite(stored.x) || !Number.isFinite(stored.y)) return null;
  return {
    tileCol: stored.c,
    tileRow: stored.r,
    x: stored.x,
    y: stored.y,
    dir,
    state,
    palette: stored.p,
    hueShift: stored.h,
    seatId: stored.seat,
  };
}

export function loadStoredPoses(companyId: string): Map<string, RestoredPose> {
  const poses = new Map<string, RestoredPose>();
  const store = storage();
  if (!store) return poses;
  const raw = store.getItem(STORAGE_PREFIX + companyId);
  if (!raw) return poses;
  let parsed: StoredOffice;
  try {
    parsed = JSON.parse(raw) as StoredOffice;
  } catch {
    return poses;
  }
  if (parsed?.v !== 2 || typeof parsed.poses !== 'object') return poses;
  for (const [agentId, stored] of Object.entries(parsed.poses)) {
    const pose = toRestoredPose(stored);
    if (pose) poses.set(agentId, pose);
  }
  return poses;
}

export function storePoses(companyId: string, characters: Iterable<Character>): void {
  const store = storage();
  if (!store) return;
  const poses: Record<string, StoredPose> = {};
  for (const ch of characters) {
    poses[ch.id] = {
      c: ch.tileCol,
      r: ch.tileRow,
      x: ch.x,
      y: ch.y,
      d: ch.dir,
      s: ch.state,
      p: ch.palette,
      h: ch.hueShift,
      seat: ch.seatId,
    };
  }
  const payload: StoredOffice = { v: 2, poses };
  try {
    store.setItem(STORAGE_PREFIX + companyId, JSON.stringify(payload));
  } catch {
    return;
  }
}

export class PoseFlusher {
  private cancelTimer: (() => void) | null = null;
  private readonly onPageHide = () => {
    this.flushNow();
  };

  constructor(
    private readonly companyId: string,
    private readonly collect: () => Iterable<Character>,
  ) {
    if (typeof window !== 'undefined') window.addEventListener('pagehide', this.onPageHide);
  }

  schedule(): void {
    if (this.cancelTimer !== null) return;
    const handle = setTimeout(() => {
      this.cancelTimer = null;
      storePoses(this.companyId, this.collect());
    }, FLUSH_INTERVAL_MS);
    this.cancelTimer = () => {
      clearTimeout(handle);
    };
  }

  flushNow(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
    storePoses(this.companyId, this.collect());
  }

  dispose(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.onPageHide);
  }
}
