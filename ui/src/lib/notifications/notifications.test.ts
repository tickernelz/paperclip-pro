import { afterEach, describe, expect, it, vi } from "vitest";
import { NOTIFICATION_KINDS, type NotificationCreatedLivePayload, type PaperclipNotification } from "@tickernelz/paperclip-pro-shared";
import {
  NOTIFICATION_SETTINGS_STORAGE_KEY,
  defaultNotificationSettings,
  enabledNotificationKinds,
  getNotificationSettings,
  setNotificationSettings,
  type NotificationSettings,
} from "./settings";
import { CUSTOM_SOUND_MAX_BYTES, validateCustomSoundFile } from "./custom-sounds";
import { claimNotificationKey, type NotificationClaimEnv } from "./dedupe";
import {
  decideLiveNotification,
  deliverLiveNotification,
  deliverServiceWorkerNotification,
  readServiceWorkerMessage,
  type NotificationDeliveryDeps,
} from "./delivery";

function notification(overrides: Partial<PaperclipNotification> = {}): PaperclipNotification {
  return {
    key: "approval:1",
    kind: "approval",
    companyId: "company-1",
    title: "Approval requested",
    body: "Hire Coder",
    url: "/PAP/approvals/1",
    issueId: null,
    createdAt: "2026-10-07T00:00:00.000Z",
    ...overrides,
  };
}

function livePayload(overrides: Partial<PaperclipNotification> = {}, recipients = ["user-1"]): NotificationCreatedLivePayload {
  return { notification: notification(overrides), recipientUserIds: recipients };
}

function memoryStorage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
  };
}

function serialLocks() {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    request<T>(_name: string, callback: () => Promise<T> | T): Promise<T> {
      const run = tail.then(async () => {
        await Promise.resolve();
        return callback();
      });
      tail = run.catch(() => undefined);
      return run;
    },
  };
}

function tab(shared: ReturnType<typeof memoryStorage>, locks: NotificationClaimEnv["locks"], now: () => number): NotificationClaimEnv {
  return { storage: shared, locks, now, memory: new Map() };
}

afterEach(() => {
  localStorage.removeItem(NOTIFICATION_SETTINGS_STORAGE_KEY);
});

describe("notification settings", () => {
  it("defaults to every kind on with its own sound and push requested", () => {
    const settings = getNotificationSettings();
    expect(settings.enabled).toBe(true);
    expect(settings.pushEnabled).toBe(true);
    expect(enabledNotificationKinds(settings)).toEqual([...NOTIFICATION_KINDS]);
    expect(new Set(NOTIFICATION_KINDS.map((kind) => settings.kinds[kind].soundId)).size).toBe(NOTIFICATION_KINDS.length);
  });

  it("repairs partial or invalid stored settings with defaults", () => {
    localStorage.setItem(
      NOTIFICATION_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        enabled: false,
        volume: 7,
        kinds: { comment: { enabled: false, soundId: "missing-sound" }, review: { soundId: "drop" }, bogus: { enabled: true } },
      }),
    );
    const settings = getNotificationSettings();
    const defaults = defaultNotificationSettings();
    expect(settings.enabled).toBe(false);
    expect(settings.volume).toBe(1);
    expect(settings.pushEnabled).toBe(true);
    expect(settings.kinds.comment).toEqual({ enabled: false, soundId: defaults.kinds.comment.soundId });
    expect(settings.kinds.review).toEqual({ enabled: true, soundId: "drop" });
    expect(settings.kinds.approval).toEqual(defaults.kinds.approval);
    expect(Object.keys(settings.kinds)).toEqual([...NOTIFICATION_KINDS]);
  });

  it("falls back to defaults for unreadable storage and reports no kinds when muted", () => {
    localStorage.setItem(NOTIFICATION_SETTINGS_STORAGE_KEY, "{not json");
    expect(getNotificationSettings()).toEqual(defaultNotificationSettings());
    const muted = setNotificationSettings((current) => ({ ...current, enabled: false }));
    expect(enabledNotificationKinds(muted)).toEqual([]);
    expect(JSON.parse(localStorage.getItem(NOTIFICATION_SETTINGS_STORAGE_KEY) ?? "{}").enabled).toBe(false);
  });
});

describe("custom sound validation", () => {
  it.each([
    [{ type: "audio/mpeg", size: CUSTOM_SOUND_MAX_BYTES }, true],
    [{ type: "audio/ogg", size: 1 }, true],
    [{ type: "audio/wav", size: CUSTOM_SOUND_MAX_BYTES + 1 }, false],
    [{ type: "audio/wav", size: 0 }, false],
    [{ type: "video/mp4", size: 1000 }, false],
    [{ type: "", size: 1000 }, false],
  ])("accepts %o: %s", (file, ok) => {
    expect(validateCustomSoundFile(file).ok).toBe(ok);
  });
});

describe("cross-tab notification dedupe", () => {
  it("lets exactly one of several tabs claim a key", async () => {
    const shared = memoryStorage();
    const locks = serialLocks();
    const now = () => 1_000;
    const results = await Promise.all([1, 2, 3].map(() => claimNotificationKey("approval:1", tab(shared, locks, now))));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await claimNotificationKey("approval:2", tab(shared, locks, now))).toBe(true);
  });

  it("dedupes within a tab without locks and frees keys after they expire", async () => {
    const shared = memoryStorage();
    let time = 0;
    const env = tab(shared, null, () => time);
    expect(await claimNotificationKey("comment:1", env)).toBe(true);
    expect(await claimNotificationKey("comment:1", env)).toBe(false);
    time = 11 * 60_000;
    expect(await claimNotificationKey("comment:1", env)).toBe(true);
  });

  it("still dedupes in memory when storage is unavailable", async () => {
    const env: NotificationClaimEnv = { storage: null, locks: null, now: () => 0, memory: new Map() };
    expect(await claimNotificationKey("review:1", env)).toBe(true);
    expect(await claimNotificationKey("review:1", env)).toBe(false);
  });
});

describe("live notification decision", () => {
  const settings = defaultNotificationSettings();
  const base = { userId: "user-1", settings, visible: true, pushActive: false };

  it("ignores events for other recipients or signed-out users", () => {
    expect(decideLiveNotification({ ...base, payload: livePayload({}, ["user-2"]) })).toBe("none");
    expect(decideLiveNotification({ ...base, userId: null, payload: livePayload() })).toBe("none");
  });

  it("ignores disabled kinds and a muted device", () => {
    const kindOff: NotificationSettings = { ...settings, kinds: { ...settings.kinds, approval: { ...settings.kinds.approval, enabled: false } } };
    expect(decideLiveNotification({ ...base, settings: kindOff, payload: livePayload() })).toBe("none");
    expect(decideLiveNotification({ ...base, settings: kindOff, payload: livePayload({ kind: "comment", key: "c" }) })).toBe("sound");
    expect(decideLiveNotification({ ...base, settings: { ...settings, enabled: false }, payload: livePayload() })).toBe("none");
  });

  it("plays a sound when visible and pops an OS notification only when hidden without push", () => {
    expect(decideLiveNotification({ ...base, payload: livePayload() })).toBe("sound");
    expect(decideLiveNotification({ ...base, visible: false, payload: livePayload() })).toBe("os");
    expect(decideLiveNotification({ ...base, visible: false, pushActive: true, payload: livePayload() })).toBe("none");
  });

  it("plays one sound per key across the socket and service worker paths", async () => {
    const shared = memoryStorage();
    const env = tab(shared, null, () => 0);
    const deps: NotificationDeliveryDeps = {
      claim: (key) => claimNotificationKey(key, env),
      playSound: vi.fn(async () => true),
      showOsNotification: vi.fn(async () => undefined),
    };
    const context = { settings, visible: true, pushActive: true };
    expect(await deliverLiveNotification(livePayload(), "user-1", deps, context)).toBe("sound");
    expect(await deliverServiceWorkerNotification(notification(), deps, context)).toBe("none");
    expect(await deliverServiceWorkerNotification(notification({ key: "approval:9" }), deps, { settings, visible: false })).toBe("none");
    expect(await deliverLiveNotification(livePayload(), "user-1", deps, { ...context, visible: false, pushActive: false })).toBe("none");
    expect(deps.playSound).toHaveBeenCalledTimes(1);
    expect(deps.showOsNotification).not.toHaveBeenCalled();
    expect(await deliverLiveNotification(livePayload({ key: "approval:3" }), "user-1", deps, { ...context, visible: false, pushActive: false })).toBe("os");
    expect(deps.showOsNotification).toHaveBeenCalledTimes(1);
  });

  it("accepts only same-origin navigation messages from the service worker", () => {
    expect(readServiceWorkerMessage({ type: "paperclip.navigate", url: "/PAP/issues/PAP-1" })).toEqual({ type: "navigate", url: "/PAP/issues/PAP-1" });
    expect(readServiceWorkerMessage({ type: "paperclip.navigate", url: "https://evil.example/" })).toBeNull();
    expect(readServiceWorkerMessage({ type: "paperclip.notification", notification: notification() })?.type).toBe("notification");
  });
});
