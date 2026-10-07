import type { NotificationKind } from "@tickernelz/paperclip-pro-shared";
import { loadCustomSound, subscribeCustomSounds } from "./custom-sounds";
import type { NotificationSettings } from "./settings";
import { CUSTOM_SOUND_ID, DEFAULT_KIND_SOUNDS, SILENT_SOUND_ID, isLibrarySoundId, librarySoundUrl } from "./sounds";

const audioByUrl = new Map<string, HTMLAudioElement>();
const customUrlByKind = new Map<NotificationKind, Promise<string | null>>();
let customSubscriptionAttached = false;
let preferredFormat: "ogg" | "mp3" | null = null;

function audioSupported(): boolean {
  return typeof Audio !== "undefined";
}

function libraryFormat(): "ogg" | "mp3" {
  if (preferredFormat) return preferredFormat;
  const probe = new Audio();
  preferredFormat = probe.canPlayType('audio/ogg; codecs="vorbis"') ? "ogg" : "mp3";
  return preferredFormat;
}

function audioFor(url: string): HTMLAudioElement {
  let audio = audioByUrl.get(url);
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
    audio.src = url;
    audioByUrl.set(url, audio);
  }
  return audio;
}

function revokeCustomSounds() {
  for (const pending of customUrlByKind.values()) {
    void pending.then((url) => {
      if (!url) return;
      audioByUrl.delete(url);
      URL.revokeObjectURL(url);
    });
  }
  customUrlByKind.clear();
}

function customSoundUrl(kind: NotificationKind): Promise<string | null> {
  if (!customSubscriptionAttached) {
    customSubscriptionAttached = true;
    subscribeCustomSounds(revokeCustomSounds);
  }
  let pending = customUrlByKind.get(kind);
  if (!pending) {
    pending = loadCustomSound(kind).then((sound) => (sound ? URL.createObjectURL(sound.blob) : null));
    customUrlByKind.set(kind, pending);
  }
  return pending;
}

async function resolveSoundUrl(kind: NotificationKind, soundId: string): Promise<string | null> {
  if (soundId === SILENT_SOUND_ID) return null;
  if (soundId === CUSTOM_SOUND_ID) {
    const custom = await customSoundUrl(kind);
    if (custom) return custom;
    return librarySoundUrl(DEFAULT_KIND_SOUNDS[kind], libraryFormat());
  }
  return librarySoundUrl(isLibrarySoundId(soundId) ? soundId : DEFAULT_KIND_SOUNDS[kind], libraryFormat());
}

export async function playSound(kind: NotificationKind, soundId: string, volume: number): Promise<boolean> {
  if (!audioSupported()) return false;
  const url = await resolveSoundUrl(kind, soundId);
  if (!url) return false;
  const audio = audioFor(url);
  audio.volume = Math.min(1, Math.max(0, volume));
  audio.currentTime = 0;
  try {
    await audio.play();
    return true;
  } catch {
    return false;
  }
}

export function playKindSound(kind: NotificationKind, settings: NotificationSettings): Promise<boolean> {
  return playSound(kind, settings.kinds[kind].soundId, settings.volume);
}

export function preloadNotificationSounds(settings: NotificationSettings): void {
  if (!audioSupported() || !settings.enabled) return;
  for (const [kind, kindSettings] of Object.entries(settings.kinds) as [NotificationKind, NotificationSettings["kinds"][NotificationKind]][]) {
    if (!kindSettings.enabled) continue;
    void resolveSoundUrl(kind, kindSettings.soundId).then((url) => {
      if (url) audioFor(url);
    });
  }
}
