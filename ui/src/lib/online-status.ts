import { useSyncExternalStore } from "react";

export const OFFLINE_ACTION_REASON = "You are offline. Approvals and replies wait until you are back.";

function subscribe(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function useOffline(): boolean {
  return useSyncExternalStore(subscribe, isOffline, () => false);
}
