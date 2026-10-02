import { describe, expect, it, vi } from "vitest";
import { GameLoop, LOOP_SLEEP_FOREVER } from "./gameLoop";

interface Harness {
  loop: GameLoop;
  tick: (atMs: number) => void;
  pending: () => boolean;
  renders: () => number;
}

function harness(step: () => number, hidden = { value: false }): Harness {
  let queued: ((time: number) => void) | null = null;
  let renders = 0;
  const loop = new GameLoop({
    step,
    render: () => {
      renders++;
    },
    raf: (callback) => {
      queued = callback;
      return 1;
    },
    cancelRaf: () => {
      queued = null;
    },
    now: () => 0,
    isHidden: () => hidden.value,
  });
  return {
    loop,
    tick: (atMs: number) => {
      const callback = queued;
      queued = null;
      callback?.(atMs);
    },
    pending: () => queued !== null,
    renders: () => renders,
  };
}

describe("GameLoop", () => {
  it("stops scheduling frames once nothing moves and resumes on wake", () => {
    const test = harness(() => LOOP_SLEEP_FOREVER);
    test.loop.start();
    expect(test.pending()).toBe(true);

    test.tick(100);
    expect(test.renders()).toBe(1);
    expect(test.pending()).toBe(false);
    expect(test.loop.scheduled).toBe(false);

    test.loop.wake();
    expect(test.pending()).toBe(true);
    test.tick(200);
    expect(test.renders()).toBe(2);
  });

  it("sleeps on a timer when the next change is known in advance", () => {
    vi.useFakeTimers();
    try {
      const test = harness(() => 5);
      test.loop.start();
      test.tick(100);
      expect(test.pending()).toBe(false);
      expect(test.loop.scheduled).toBe(true);

      vi.advanceTimersByTime(5000);
      expect(test.pending()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps running while work remains but caps the frame rate", () => {
    const test = harness(() => 0);
    test.loop.start();
    test.tick(100);
    expect(test.renders()).toBe(1);

    test.tick(110);
    expect(test.renders()).toBe(1);
    expect(test.pending()).toBe(true);

    test.tick(200);
    expect(test.renders()).toBe(2);
  });

  it("does not render while the document is hidden", () => {
    const hidden = { value: true };
    const test = harness(() => 0, hidden);
    test.loop.start();
    test.tick(100);
    expect(test.renders()).toBe(0);
    expect(test.pending()).toBe(false);

    hidden.value = false;
    test.loop.wake();
    test.tick(200);
    expect(test.renders()).toBe(1);
  });

  it("cancels pending work on stop", () => {
    const test = harness(() => 0);
    test.loop.start();
    test.loop.stop();
    expect(test.loop.scheduled).toBe(false);
    test.loop.wake();
    expect(test.loop.scheduled).toBe(false);
  });
});
