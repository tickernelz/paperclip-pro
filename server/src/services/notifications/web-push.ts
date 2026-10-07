import webpush from "web-push";
import type { WebPushConfig } from "@tickernelz/paperclip-pro-shared";
import { logger } from "../../middleware/logger.js";
import { loadOrCreateVapidKeys, resolveVapidSubject, type VapidKeys } from "./vapid.js";

export const WEB_PUSH_TTL_SECONDS = 24 * 60 * 60;

export interface WebPushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export type WebPushSender = (target: WebPushTarget, payload: string) => Promise<void>;

export interface WebPushRuntime {
  config(): WebPushConfig;
  sender(): WebPushSender | null;
}

export function createWebPushSender(keys: VapidKeys, subject: string): WebPushSender {
  const vapidDetails = { subject, publicKey: keys.publicKey, privateKey: keys.privateKey };
  return async (target, payload) => {
    await webpush.sendNotification(target, payload, { vapidDetails, TTL: WEB_PUSH_TTL_SECONDS });
  };
}

export function createWebPushRuntime(opts: { publicBaseUrl?: string | null; keyFilePath?: string } = {}): WebPushRuntime {
  let state: { keys: VapidKeys; sender: WebPushSender } | null | undefined;
  const load = () => {
    if (state !== undefined) return state;
    try {
      const keys = loadOrCreateVapidKeys(opts.keyFilePath);
      state = { keys, sender: createWebPushSender(keys, resolveVapidSubject(opts.publicBaseUrl)) };
    } catch (err) {
      logger.error({ err }, "Web Push VAPID keys unavailable; push notifications disabled");
      state = null;
    }
    return state;
  };
  return {
    config: () => {
      const loaded = load();
      return { enabled: loaded !== null, publicKey: loaded?.keys.publicKey ?? null };
    },
    sender: () => load()?.sender ?? null,
  };
}
