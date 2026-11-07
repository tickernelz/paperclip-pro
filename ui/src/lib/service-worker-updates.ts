import { useSyncExternalStore } from "react";

const DEFAULT_UPDATE_INTERVAL_MS = 60 * 60 * 1000;
const APPLY_FALLBACK_MS = 3000;
export const SKIP_WAITING_MESSAGE = "wardmote.skip-waiting";

export type ApplyServiceWorkerUpdate = () => void;

let readyUpdate: ApplyServiceWorkerUpdate | null = null;
const listeners = new Set<() => void>();

function publishUpdate(apply: ApplyServiceWorkerUpdate) {
  readyUpdate = apply;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useServiceWorkerUpdate(): ApplyServiceWorkerUpdate | null {
  return useSyncExternalStore(subscribe, () => readyUpdate, () => null);
}

export function resetServiceWorkerUpdateForTests() {
  readyUpdate = null;
  listeners.clear();
}

export function startServiceWorkerUpdates(
  options: {
    container?: ServiceWorkerContainer;
    documentRef?: Document;
    reload?: () => void;
    updateIntervalMs?: number;
    onUpdateReady?: (apply: ApplyServiceWorkerUpdate) => void;
  } = {},
): () => void {
  const container =
    options.container ??
    (typeof navigator !== "undefined" && "serviceWorker" in navigator
      ? navigator.serviceWorker
      : undefined);
  if (!container) {
    return () => {};
  }
  const documentRef = options.documentRef ?? document;
  const reload = options.reload ?? (() => window.location.reload());
  const updateIntervalMs = options.updateIntervalMs ?? DEFAULT_UPDATE_INTERVAL_MS;
  const onUpdateReady = options.onUpdateReady ?? publishUpdate;

  let wasControlled = Boolean(container.controller);
  let applyRequested = false;
  let reloaded = false;
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
  const reloadOnce = () => {
    if (reloaded) return;
    reloaded = true;
    if (fallbackTimer !== undefined) clearTimeout(fallbackTimer);
    reload();
  };
  const offerWaiting = (worker: ServiceWorker) => {
    onUpdateReady(() => {
      applyRequested = true;
      worker.postMessage({ type: SKIP_WAITING_MESSAGE });
      fallbackTimer = setTimeout(reloadOnce, APPLY_FALLBACK_MS);
    });
  };
  const onControllerChange = () => {
    if (!wasControlled) {
      wasControlled = true;
      return;
    }
    if (applyRequested) reloadOnce();
    else onUpdateReady(reloadOnce);
  };
  container.addEventListener("controllerchange", onControllerChange);

  let registration: ServiceWorkerRegistration | undefined;
  const watchInstalling = () => {
    const worker = registration?.installing;
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && container.controller) offerWaiting(worker);
    });
  };
  const checkForUpdates = () => {
    void registration?.update().catch(() => {});
  };
  const onVisibilityChange = () => {
    if (documentRef.visibilityState === "visible") checkForUpdates();
  };
  documentRef.addEventListener("visibilitychange", onVisibilityChange);
  const intervalId = setInterval(checkForUpdates, updateIntervalMs);

  void container
    .register("/sw.js")
    .then((reg) => {
      registration = reg;
      if (reg.waiting && container.controller) offerWaiting(reg.waiting);
      reg.addEventListener("updatefound", watchInstalling);
    })
    .catch(() => {});

  return () => {
    container.removeEventListener("controllerchange", onControllerChange);
    documentRef.removeEventListener("visibilitychange", onVisibilityChange);
    registration?.removeEventListener("updatefound", watchInstalling);
    clearInterval(intervalId);
    if (fallbackTimer !== undefined) clearTimeout(fallbackTimer);
  };
}
