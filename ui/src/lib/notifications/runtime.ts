import { readServiceWorkerMessage, deliverServiceWorkerNotification } from "./delivery";
import { preloadNotificationSounds } from "./player";
import { syncPushSubscription } from "./push";
import { getNotificationSettings, subscribeNotificationSettings } from "./settings";

/** Wires service-worker messages, sound preloading, and push sync for the signed-in user. */
export function startNotificationRuntime(options: { userId: string; navigate: (url: string) => void }): () => void {
  let lastSettings = getNotificationSettings();
  preloadNotificationSounds(lastSettings);
  void syncPushSubscription(lastSettings, options.userId);

  const unsubscribeSettings = subscribeNotificationSettings(() => {
    const next = getNotificationSettings();
    if (next === lastSettings) return;
    lastSettings = next;
    preloadNotificationSounds(next);
    void syncPushSubscription(next, options.userId);
  });

  const container = typeof navigator !== "undefined" && "serviceWorker" in navigator ? navigator.serviceWorker : null;
  const onMessage = (event: MessageEvent) => {
    const message = readServiceWorkerMessage(event.data);
    if (!message) return;
    if (message.type === "navigate") options.navigate(message.url);
    else void deliverServiceWorkerNotification(message.notification);
  };
  container?.addEventListener("message", onMessage);
  container?.startMessages();

  return () => {
    unsubscribeSettings();
    container?.removeEventListener("message", onMessage);
  };
}
