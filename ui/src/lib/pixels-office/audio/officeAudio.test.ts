import { afterEach, describe, expect, it, vi } from "vitest";
import { playEffectSound, setAmbientEnabled, setTypingLevel } from "./index";

let constructed = 0;
let closed = 0;

class FakeParam {
  value = 0;
  setValueAtTime(): this {
    return this;
  }
  linearRampToValueAtTime(): this {
    return this;
  }
  exponentialRampToValueAtTime(): this {
    return this;
  }
  setTargetAtTime(): this {
    return this;
  }
}

class FakeNode {
  readonly gain = new FakeParam();
  readonly frequency = new FakeParam();
  readonly Q = new FakeParam();
  type = "sine";
  buffer: unknown = null;
  loop = false;
  onended: (() => void) | null = null;
  connect(): void {}
  disconnect(): void {}
  start(): void {}
  stop(): void {}
}

class FakeAudioContext {
  readonly sampleRate = 8000;
  readonly currentTime = 0;
  readonly destination = new FakeNode();
  state = "running";

  constructor() {
    constructed += 1;
  }

  createGain(): FakeNode {
    return new FakeNode();
  }

  createOscillator(): FakeNode {
    return new FakeNode();
  }

  createBiquadFilter(): FakeNode {
    return new FakeNode();
  }

  createBufferSource(): FakeNode {
    return new FakeNode();
  }

  createBuffer(_channels: number, frames: number): { getChannelData(): Float32Array } {
    const data = new Float32Array(frames);
    return { getChannelData: () => data };
  }

  close(): Promise<void> {
    closed += 1;
    return Promise.resolve();
  }

  resume(): Promise<void> {
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    return Promise.resolve();
  }
}

const FakeCtor = FakeAudioContext as unknown as typeof AudioContext;

afterEach(() => {
  setAmbientEnabled(false);
  setTypingLevel(0);
  constructed = 0;
  closed = 0;
  vi.unstubAllGlobals();
});

describe("office audio", () => {
  it("stays inert while disabled", () => {
    vi.stubGlobal("AudioContext", FakeCtor);

    setTypingLevel(7);
    playEffectSound("done");
    playEffectSound("error");

    expect(constructed).toBe(0);
  });

  it("creates exactly one audio context once enabled and sound is requested", () => {
    vi.stubGlobal("AudioContext", FakeCtor);

    setAmbientEnabled(true);
    expect(constructed).toBe(0);

    playEffectSound("ding");
    playEffectSound("done");
    setTypingLevel(3);

    expect(constructed).toBe(1);
  });

  it("tears the context down when ambience is switched off", () => {
    vi.stubGlobal("AudioContext", FakeCtor);
    setAmbientEnabled(true);
    playEffectSound("ding");

    setAmbientEnabled(false);

    expect(closed).toBe(1);

    setTypingLevel(5);
    expect(constructed).toBe(1);
  });

  it("does nothing when the platform has no WebAudio", () => {
    vi.stubGlobal("AudioContext", undefined);

    setAmbientEnabled(true);
    expect(() => playEffectSound("error")).not.toThrow();
    expect(constructed).toBe(0);
  });
});
