import type { NotificationCreatedLivePayload, PaperclipNotification } from "@tickernelz/paperclip-pro-shared";
import { getPageVisibility } from "../page-visibility";
import { NOTIFICATION_BADGE, NOTIFICATION_ICON, getServiceWorkerRegistration, notificationPermission } from "./browser";
import { claimNotificationKey } from "./dedupe";
import { playKindSound } from "./player";
import { hasActivePushSubscription } from "./push";
import { getNotificationSettings, type NotificationSettings } from "./settings";

export type NotificationAction = "none" | "sound" | "os";

export const SW_NOTIFICATION_MESSAGE = "paperclip.notification";
export const SW_NAVIGATE_MESSAGE = "paperclip.navigate";

function kindEnabled(notification: PaperclipNotification, settings: NotificationSettings): boolean {
  return settings.enabled && settings.kinds[notification.kind]?.enabled === true;
}

export function decideLiveNotification(input: {
  payload: NotificationCreatedLivePayload;
  userId: string | null;
  settings: NotificationSettings;
  visible: boolean;
  pushActive: boolean;
}): NotificationAction {
  const { payload, userId, settings } = input;
  if (!userId || !payload.recipientUserIds.includes(userId)) return "none";
  if (!kindEnabled(payload.notification, settings)) return "none";
  if (input.visible) return "sound";
  return input.pushActive ? "none" : "os";
}

export function decideServiceWorkerNotification(input: {
  notification: PaperclipNotification;
  settings: NotificationSettings;
  visible: boolean;
}): NotificationAction {
  if (!input.visible || !kindEnabled(input.notification, input.settings)) return "none";
  return "sound";
}

export interface NotificationDeliveryDeps {
  claim: (key: string) => Promise<boolean>;
  playSound: (notification: PaperclipNotification, settings: NotificationSettings) => Promise<unknown>;
  showOsNotification: (notification: PaperclipNotification) => Promise<unknown>;
}

async function showOsNotification(notification: PaperclipNotification): Promise<void> {
  if (notificationPermission() !== "granted") return;
  const options: NotificationOptions = {
    body: notification.body,
    tag: notification.key,
    data: { url: notification.url },
    icon: NOTIFICATION_ICON,
    badge: NOTIFICATION_BADGE,
  };
  const registration = await getServiceWorkerRegistration();
  if (registration) {
    await registration.showNotification(notification.title, options);
    return;
  }
  new Notification(notification.title, options);
}

const defaultDeps: NotificationDeliveryDeps = {
  claim: (key) => claimNotificationKey(key),
  playSound: (notification, settings) => playKindSound(notification.kind, settings),
  showOsNotification,
};

async function perform(
  action: NotificationAction,
  notification: PaperclipNotification,
  settings: NotificationSettings,
  deps: NotificationDeliveryDeps,
): Promise<NotificationAction> {
  if (action === "none") return action;
  if (!(await deps.claim(notification.key))) return "none";
  if (action === "sound") await deps.playSound(notification, settings);
  else await deps.showOsNotification(notification);
  return action;
}

export function deliverLiveNotification(
  payload: NotificationCreatedLivePayload,
  userId: string | null,
  deps: NotificationDeliveryDeps = defaultDeps,
  context: { settings?: NotificationSettings; visible?: boolean; pushActive?: boolean } = {},
): Promise<NotificationAction> {
  const settings = context.settings ?? getNotificationSettings();
  const action = decideLiveNotification({
    payload,
    userId,
    settings,
    visible: context.visible ?? getPageVisibility().visible,
    pushActive: context.pushActive ?? hasActivePushSubscription(),
  });
  return perform(action, payload.notification, settings, deps);
}

export function deliverServiceWorkerNotification(
  notification: PaperclipNotification,
  deps: NotificationDeliveryDeps = defaultDeps,
  context: { settings?: NotificationSettings; visible?: boolean } = {},
): Promise<NotificationAction> {
  const settings = context.settings ?? getNotificationSettings();
  const action = decideServiceWorkerNotification({
    notification,
    settings,
    visible: context.visible ?? getPageVisibility().visible,
  });
  return perform(action, notification, settings, deps);
}

function readNotification(value: unknown): PaperclipNotification | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PaperclipNotification>;
  return typeof candidate.key === "string" && typeof candidate.kind === "string" && typeof candidate.title === "string"
    ? (candidate as PaperclipNotification)
    : null;
}

export function readNotificationCreatedPayload(value: unknown): NotificationCreatedLivePayload | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { notification?: unknown; recipientUserIds?: unknown };
  const notification = readNotification(record.notification);
  if (!notification || !Array.isArray(record.recipientUserIds)) return null;
  return {
    notification,
    recipientUserIds: record.recipientUserIds.filter((id): id is string => typeof id === "string"),
  };
}

export function readServiceWorkerMessage(
  data: unknown,
): { type: "notification"; notification: PaperclipNotification } | { type: "navigate"; url: string } | null {
  if (!data || typeof data !== "object") return null;
  const message = data as { type?: unknown; notification?: unknown; url?: unknown };
  if (message.type === SW_NOTIFICATION_MESSAGE) {
    const notification = readNotification(message.notification);
    return notification ? { type: "notification", notification } : null;
  }
  if (message.type === SW_NAVIGATE_MESSAGE && typeof message.url === "string" && message.url.startsWith("/")) {
    return { type: "navigate", url: message.url };
  }
  return null;
}
