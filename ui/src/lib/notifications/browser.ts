export const NOTIFICATION_ICON = "/pwa-192x192.png";
export const NOTIFICATION_BADGE = "/pwa-monochrome-512x512.png";

export type NotificationPermissionState = NotificationPermission | "unsupported";

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission(): NotificationPermissionState {
  return notificationsSupported() ? Notification.permission : "unsupported";
}

export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (!notificationsSupported()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  return Notification.requestPermission();
}

export function pushSupported(): boolean {
  return typeof navigator !== "undefined"
    && "serviceWorker" in navigator
    && typeof window !== "undefined"
    && "PushManager" in window;
}

export function isIosWithoutHomeScreenInstall(
  nav: { userAgent: string; platform?: string; maxTouchPoints?: number; standalone?: boolean } | undefined =
    typeof navigator === "undefined" ? undefined : (navigator as Navigator & { standalone?: boolean }),
): boolean {
  if (!nav) return false;
  const ios = /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1);
  return ios && nav.standalone !== true;
}

export async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    return null;
  }
}
