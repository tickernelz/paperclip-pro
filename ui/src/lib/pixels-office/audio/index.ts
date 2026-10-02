export type EffectSound = "done" | "error" | "ding";

const TYPING_MAX_GAIN = 0.035;
const TYPING_RAMP_SEC = 0.4;
const TYPING_SATURATION = 6;
const EFFECT_GAIN = 0.12;

interface EffectVoice {
  frequency: number;
  endFrequency: number;
  duration: number;
  type: OscillatorType;
}

const EFFECT_VOICES: Record<EffectSound, EffectVoice> = {
  done: { frequency: 660, endFrequency: 990, duration: 0.22, type: "triangle" },
  ding: { frequency: 880, endFrequency: 880, duration: 0.14, type: "sine" },
  error: { frequency: 220, endFrequency: 130, duration: 0.35, type: "sawtooth" },
};

let enabled = false;
let context: AudioContext | null = null;
let master: GainNode | null = null;
let typingSource: AudioBufferSourceNode | null = null;
let typingGain: GainNode | null = null;
let typingLevel = 0;
let visibilityBound = false;

function applyTypingGain(): void {
  if (!context || !typingGain) return;
  const target = enabled
    ? TYPING_MAX_GAIN * Math.min(1, typingLevel / TYPING_SATURATION)
    : 0;
  typingGain.gain.setTargetAtTime(target, context.currentTime, TYPING_RAMP_SEC);
}

function stopAudio(): void {
  if (typingSource) {
    typingSource.stop();
    typingSource.disconnect();
    typingSource = null;
  }
  typingGain?.disconnect();
  typingGain = null;
  master?.disconnect();
  master = null;
  if (context) {
    void context.close();
    context = null;
  }
}

function handleVisibility(): void {
  if (typeof document === "undefined" || !context) return;
  if (document.hidden) {
    void context.suspend();
  } else if (enabled) {
    void context.resume();
  }
}

function startTypingNoise(ctx: AudioContext, target: GainNode): void {
  const frames = Math.floor(ctx.sampleRate * 1.5);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let nextKeyAt = 0;
  let decay = 0;
  for (let i = 0; i < frames; i += 1) {
    if (i >= nextKeyAt) {
      decay = 1;
      nextKeyAt = i + Math.floor(ctx.sampleRate * (0.04 + Math.random() * 0.14));
    }
    decay *= 0.9965;
    data[i] = (Math.random() * 2 - 1) * decay * decay;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 2400;
  filter.Q.value = 0.8;
  source.connect(filter);
  filter.connect(target);
  source.start();
  typingSource = source;
}

function ensureContext(): AudioContext | null {
  if (!enabled) return null;
  if (context) return context;
  if (typeof globalThis.AudioContext !== "function") return null;
  const ctx = new globalThis.AudioContext();
  context = ctx;
  master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);
  typingGain = ctx.createGain();
  typingGain.gain.value = 0;
  typingGain.connect(master);
  startTypingNoise(ctx, typingGain);
  applyTypingGain();
  if (!visibilityBound && typeof document !== "undefined") {
    visibilityBound = true;
    document.addEventListener("visibilitychange", handleVisibility);
  }
  return ctx;
}

export function setAmbientEnabled(value: boolean): void {
  if (enabled === value) return;
  enabled = value;
  if (!value) {
    stopAudio();
    return;
  }
  if (typingLevel > 0) ensureContext();
}

export function ambientEnabled(): boolean {
  return enabled;
}

export function setTypingLevel(runningCount: number): void {
  typingLevel = Math.max(0, runningCount);
  if (!enabled) return;
  if (typingLevel > 0) ensureContext();
  applyTypingGain();
}

export function playEffectSound(kind: EffectSound): void {
  const ctx = ensureContext();
  if (!ctx || !master) return;
  if (ctx.state === "suspended") void ctx.resume();
  const voice = EFFECT_VOICES[kind];
  const now = ctx.currentTime;
  const oscillator = ctx.createOscillator();
  oscillator.type = voice.type;
  oscillator.frequency.setValueAtTime(voice.frequency, now);
  oscillator.frequency.linearRampToValueAtTime(voice.endFrequency, now + voice.duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(EFFECT_GAIN, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + voice.duration);
  oscillator.connect(gain);
  gain.connect(master);
  oscillator.start(now);
  oscillator.stop(now + voice.duration + 0.02);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };
}
