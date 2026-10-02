import { MAX_DELTA_TIME_SEC } from '../constants';

export const LOOP_SLEEP_FOREVER = Number.POSITIVE_INFINITY;

export interface GameLoopOptions {
  step: (dt: number) => number;
  render: () => void;
  fps?: number;
  raf?: (callback: (time: number) => void) => number;
  cancelRaf?: (handle: number) => void;
  now?: () => number;
  isHidden?: () => boolean;
}

export class GameLoop {
  private rafHandle = 0;
  private cancelSleep: (() => void) | null = null;
  private lastTime = 0;
  private lastRender = 0;
  private plannedSleepSec = 0;
  private running = false;
  private readonly interval: number;
  private readonly raf: (callback: (time: number) => void) => number;
  private readonly cancelRaf: (handle: number) => void;
  private readonly now: () => number;
  private readonly isHidden: () => boolean;
  private readonly frame = (time: number) => {
    this.rafHandle = 0;
    if (!this.running) return;
    if (this.isHidden()) return;

    if (this.lastRender !== 0 && time - this.lastRender < this.interval) {
      this.scheduleFrame();
      return;
    }

    const elapsed = this.lastTime === 0 ? 0 : (time - this.lastTime) / 1000;
    const cap = Math.max(MAX_DELTA_TIME_SEC, this.plannedSleepSec + MAX_DELTA_TIME_SEC);
    this.lastTime = time;
    this.lastRender = time;
    this.plannedSleepSec = 0;

    const sleepSec = this.options.step(Math.min(elapsed, cap));
    this.options.render();

    if (sleepSec <= 0) {
      this.scheduleFrame();
      return;
    }
    if (sleepSec === LOOP_SLEEP_FOREVER) return;
    this.plannedSleepSec = sleepSec;
    const handle = setTimeout(() => {
      this.cancelSleep = null;
      this.wake();
    }, sleepSec * 1000);
    this.cancelSleep = () => {
      clearTimeout(handle);
    };
  };

  constructor(private readonly options: GameLoopOptions) {
    this.interval = 1000 / (options.fps ?? 30) - 1;
    this.raf = options.raf ?? ((callback) => requestAnimationFrame(callback));
    this.cancelRaf = options.cancelRaf ?? ((handle) => cancelAnimationFrame(handle));
    this.now = options.now ?? (() => performance.now());
    this.isHidden =
      options.isHidden ?? (() => typeof document !== 'undefined' && document.hidden);
  }

  get scheduled(): boolean {
    return this.rafHandle !== 0 || this.cancelSleep !== null;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = 0;
    this.lastRender = 0;
    this.scheduleFrame();
  }

  stop(): void {
    this.running = false;
    if (this.rafHandle !== 0) {
      this.cancelRaf(this.rafHandle);
      this.rafHandle = 0;
    }
    this.cancelSleep?.();
    this.cancelSleep = null;
  }

  wake(): void {
    if (!this.running || this.isHidden()) return;
    this.cancelSleep?.();
    this.cancelSleep = null;
    if (this.rafHandle !== 0) return;
    this.lastRender = 0;
    if (this.lastTime === 0) this.lastTime = this.now();
    this.scheduleFrame();
  }

  private scheduleFrame(): void {
    if (this.rafHandle !== 0) return;
    this.rafHandle = this.raf(this.frame);
  }
}
