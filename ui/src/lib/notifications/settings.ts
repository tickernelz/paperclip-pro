import { useSyncExternalStore } from "react";
import { NOTIFICATION_KINDS, type NotificationKind } from "@tickernelz/paperclip-pro-shared";
import { DEFAULT_KIND_SOUNDS, isKnownSoundId } from "./sounds";

export const NOTIFICATION_SETTINGS_STORAGE_KEY = "paperclip.notifications.v1";

export interface NotificationKindSettings {
  enabled: boolean;
  soundId: string;
}

export interface NotificationSettings {
  enabled: boolean;
  volume: number;
  pushEnabled: boolean;
  kinds: Record<NotificationKind, NotificationKindSettings>;
}

const DEFAULT_VOLUME = 0.6;

export function defaultNotificationSettings(): NotificationSettings {
  const kinds = {} as Record<NotificationKind, NotificationKindSettings>;
  for (const kind of NOTIFICATION_KINDS) {
    kinds[kind] = { enabled: true, soundId: DEFAULT_KIND_SOUNDS[kind] };
  }
  return { enabled: true, volume: DEFAULT_VOLUME, pushEnabled: true, kinds };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Fills missing or invalid fields of a stored value with defaults. */
export function normalizeNotificationSettings(raw: unknown): NotificationSettings {
  const defaults = defaultNotificationSettings();
  const record = asRecord(raw);
  if (!record) return defaults;
  const volume = typeof record.volume === "number" && Number.isFinite(record.volume)
    ? Math.min(1, Math.max(0, record.volume))
    : defaults.volume;
  const storedKinds = asRecord(record.kinds) ?? {};
  const kinds = { ...defaults.kinds };
  for (const kind of NOTIFICATION_KINDS) {
    const stored = asRecord(storedKinds[kind]);
    if (!stored) continue;
    kinds[kind] = {
      enabled: typeof stored.enabled === "boolean" ? stored.enabled : defaults.kinds[kind].enabled,
      soundId: isKnownSoundId(stored.soundId) ? stored.soundId : defaults.kinds[kind].soundId,
    };
  }
  return {
    enabled: typeof record.enabled === "boolean" ? record.enabled : defaults.enabled,
    volume,
    pushEnabled: typeof record.pushEnabled === "boolean" ? record.pushEnabled : defaults.pushEnabled,
    kinds,
  };
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readStored(): NotificationSettings {
  const raw = storage()?.getItem(NOTIFICATION_SETTINGS_STORAGE_KEY);
  if (!raw) return defaultNotificationSettings();
  try {
    return normalizeNotificationSettings(JSON.parse(raw));
  } catch {
    return defaultNotificationSettings();
  }
}

let cachedRaw: string | null | undefined;
let cachedSettings: NotificationSettings | null = null;
const listeners = new Set<() => void>();
let storageListenerAttached = false;

export function getNotificationSettings(): NotificationSettings {
  const raw = storage()?.getItem(NOTIFICATION_SETTINGS_STORAGE_KEY) ?? null;
  if (cachedSettings && raw === cachedRaw) return cachedSettings;
  cachedRaw = raw;
  cachedSettings = readStored();
  return cachedSettings;
}

function notify() {
  for (const listener of listeners) listener();
}

export function setNotificationSettings(
  update: NotificationSettings | ((current: NotificationSettings) => NotificationSettings),
): NotificationSettings {
  const next = normalizeNotificationSettings(
    typeof update === "function" ? update(getNotificationSettings()) : update,
  );
  try {
    storage()?.setItem(NOTIFICATION_SETTINGS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    cachedRaw = undefined;
  }
  cachedSettings = next;
  cachedRaw = storage()?.getItem(NOTIFICATION_SETTINGS_STORAGE_KEY) ?? null;
  notify();
  return next;
}

export function updateKindSettings(kind: NotificationKind, patch: Partial<NotificationKindSettings>): NotificationSettings {
  return setNotificationSettings((current) => ({
    ...current,
    kinds: { ...current.kinds, [kind]: { ...current.kinds[kind], ...patch } },
  }));
}

export function enabledNotificationKinds(settings: NotificationSettings): NotificationKind[] {
  if (!settings.enabled) return [];
  return NOTIFICATION_KINDS.filter((kind) => settings.kinds[kind].enabled);
}

function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== NOTIFICATION_SETTINGS_STORAGE_KEY) return;
  notify();
}

export function subscribeNotificationSettings(listener: () => void): () => void {
  listeners.add(listener);
  if (!storageListenerAttached && typeof window !== "undefined") {
    storageListenerAttached = true;
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && storageListenerAttached && typeof window !== "undefined") {
      storageListenerAttached = false;
      window.removeEventListener("storage", onStorage);
    }
  };
}

export function useNotificationSettings(): NotificationSettings {
  return useSyncExternalStore(subscribeNotificationSettings, getNotificationSettings, getNotificationSettings);
}
