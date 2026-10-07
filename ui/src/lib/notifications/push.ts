import { useSyncExternalStore } from "react";
import { notificationsApi } from "@/api/notifications";
import { getServiceWorkerRegistration, notificationPermission, pushSupported } from "./browser";
import { enabledNotificationKinds, type NotificationSettings } from "./settings";

export type PushStatus = "unknown" | "active" | "off" | "unsupported" | "permission" | "server-disabled" | "error";

export interface PushState {
  status: PushStatus;
  error: string | null;
}

let state: PushState = { status: "unknown", error: null };
const listeners = new Set<() => void>();
let lastSyncedFingerprint: string | null = null;
let queue: Promise<unknown> = Promise.resolve();

function setPushState(next: PushState) {
  if (next.status === state.status && next.error === state.error) return;
  state = next;
  for (const listener of listeners) listener();
}

export function getPushState(): PushState {
  return state;
}

export function hasActivePushSubscription(): boolean {
  return state.status === "active";
}

export function subscribePushState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePushState(): PushState {
  return useSyncExternalStore(subscribePushState, getPushState, getPushState);
}

export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=").replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function sameApplicationServerKey(subscription: PushSubscription, publicKey: string): boolean {
  const current = subscription.options?.applicationServerKey;
  if (!current) return true;
  const expected = urlBase64ToUint8Array(publicKey);
  const actual = new Uint8Array(current);
  return actual.length === expected.length && actual.every((byte, index) => byte === expected[index]);
}

async function forgetSubscription(subscription: PushSubscription) {
  await notificationsApi.deleteWebPushSubscription({ endpoint: subscription.endpoint }).catch(() => undefined);
  await subscription.unsubscribe().catch(() => false);
  lastSyncedFingerprint = null;
}

async function reconcile(settings: NotificationSettings, userId: string): Promise<PushState> {
  if (!pushSupported()) return { status: "unsupported", error: null };
  const registration = await getServiceWorkerRegistration();
  if (!registration) return { status: "unsupported", error: null };
  let subscription = await registration.pushManager.getSubscription();
  const wanted = settings.enabled && settings.pushEnabled;
  if (!wanted) {
    if (subscription) await forgetSubscription(subscription);
    return { status: "off", error: null };
  }
  if (notificationPermission() !== "granted") return { status: "permission", error: null };
  const config = await notificationsApi.getWebPushConfig();
  if (!config.enabled || !config.publicKey) return { status: "server-disabled", error: null };
  if (subscription && !sameApplicationServerKey(subscription, config.publicKey)) {
    await forgetSubscription(subscription);
    subscription = null;
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.publicKey),
    });
  }
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!p256dh || !auth) return { status: "error", error: "The browser returned an incomplete push subscription." };
  const kinds = enabledNotificationKinds(settings);
  const fingerprint = [userId, subscription.endpoint, ...kinds].join("|");
  if (fingerprint !== lastSyncedFingerprint) {
    await notificationsApi.upsertWebPushSubscription({ endpoint: subscription.endpoint, keys: { p256dh, auth }, kinds });
    lastSyncedFingerprint = fingerprint;
  }
  return { status: "active", error: null };
}

/** Brings this device's push subscription in line with its settings; calls are serialized. */
export function syncPushSubscription(settings: NotificationSettings, userId: string): Promise<PushState> {
  const run = queue.then(async () => {
    try {
      const next = await reconcile(settings, userId);
      setPushState(next);
      return next;
    } catch (error) {
      const next: PushState = { status: "error", error: error instanceof Error ? error.message : "Push subscription failed." };
      setPushState(next);
      return next;
    }
  });
  queue = run.catch(() => undefined);
  return run;
}
