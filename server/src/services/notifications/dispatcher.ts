import type { Db } from "@tickernelz/paperclip-pro-db";
import type { LiveEvent, NotificationCreatedLivePayload } from "@tickernelz/paperclip-pro-shared";
import { logger } from "../../middleware/logger.js";
import { publishLiveEvent, subscribeAllCompanyLiveEvents } from "../live-events.js";
import { classifyTrigger, parseNotificationTrigger } from "./classify.js";
import { loadNotificationContext } from "./context.js";
import { deliverWebPush } from "./subscriptions.js";
import type { WebPushSender } from "./web-push.js";

export const NOTIFICATION_DEDUPE_TTL_MS = 10 * 60 * 1000;
const NOTIFICATION_DEDUPE_MAX_KEYS = 5000;

export interface NotificationDispatcherOptions {
  db: Db;
  sender: () => WebPushSender | null;
  now?: () => number;
}

export interface NotificationDispatcher {
  handleEvent(event: LiveEvent): Promise<void>;
}

function createDedupeCache(now: () => number) {
  const expiresAtByKey = new Map<string, number>();
  return (key: string) => {
    const at = now();
    const expiresAt = expiresAtByKey.get(key);
    if (expiresAt !== undefined && expiresAt > at) return false;
    expiresAtByKey.delete(key);
    expiresAtByKey.set(key, at + NOTIFICATION_DEDUPE_TTL_MS);
    while (expiresAtByKey.size > NOTIFICATION_DEDUPE_MAX_KEYS) {
      const oldest = expiresAtByKey.keys().next().value;
      if (oldest === undefined) break;
      expiresAtByKey.delete(oldest);
    }
    return true;
  };
}

export function createNotificationDispatcher(opts: NotificationDispatcherOptions): NotificationDispatcher {
  const claim = createDedupeCache(opts.now ?? Date.now);
  return {
    async handleEvent(event) {
      const trigger = parseNotificationTrigger(event);
      if (!trigger || !claim(trigger.key)) return;
      const context = await loadNotificationContext(opts.db, trigger);
      if (!context) return;
      const classified = classifyTrigger(trigger, context);
      if (!classified) return;
      const payload: NotificationCreatedLivePayload = classified;
      publishLiveEvent({
        companyId: classified.notification.companyId,
        type: "notification.created",
        payload: { ...payload },
      });
      const sender = opts.sender();
      if (!sender) return;
      await deliverWebPush(opts.db, sender, {
        userIds: classified.recipientUserIds,
        notification: classified.notification,
        kind: classified.notification.kind,
      });
    },
  };
}

export function startNotificationDispatcher(opts: NotificationDispatcherOptions) {
  const dispatcher = createNotificationDispatcher(opts);
  return subscribeAllCompanyLiveEvents((event) => {
    if (event.type !== "activity.logged" && event.type !== "heartbeat.run.status") return;
    void dispatcher.handleEvent(event).catch((err) => {
      logger.warn({ err, eventType: event.type, companyId: event.companyId }, "notification dispatch failed");
    });
  });
}
