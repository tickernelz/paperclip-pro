import { useSyncExternalStore } from "react";
import { isChromelessDisplayMode } from "./pwa-display-mode";

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export type InstallAvailability = "installed" | "prompt" | "ios-manual" | "unavailable";

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installedThisSession = false;
let iosHelpOpen = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function isIosSafariLike(
  userAgent: string = typeof navigator === "undefined" ? "" : navigator.userAgent,
  maxTouchPoints: number = typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints,
): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
}

export function captureInstallPrompt(target: Window = window): () => void {
  const onPrompt = (event: Event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    emit();
  };
  const onInstalled = () => {
    deferredPrompt = null;
    installedThisSession = true;
    emit();
  };
  target.addEventListener("beforeinstallprompt", onPrompt);
  target.addEventListener("appinstalled", onInstalled);
  return () => {
    target.removeEventListener("beforeinstallprompt", onPrompt);
    target.removeEventListener("appinstalled", onInstalled);
  };
}

export function installAvailability(): InstallAvailability {
  if (installedThisSession || isChromelessDisplayMode()) return "installed";
  if (deferredPrompt) return "prompt";
  if (isIosSafariLike()) return "ios-manual";
  return "unavailable";
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = deferredPrompt;
  if (!event) return "unavailable";
  deferredPrompt = null;
  emit();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome;
}

export function setIosInstallHelpOpen(open: boolean) {
  if (iosHelpOpen === open) return;
  iosHelpOpen = open;
  emit();
}

function iosInstallHelpOpen() {
  return iosHelpOpen;
}

export function useIosInstallHelpOpen(): boolean {
  return useSyncExternalStore(subscribe, iosInstallHelpOpen, () => false);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useInstallAvailability(): InstallAvailability {
  return useSyncExternalStore(subscribe, installAvailability, () => "unavailable");
}

export function useInstallNudgeVisible(pathname: string): boolean {
  const availability = useInstallAvailability();
  return useSyncExternalStore(subscribe, () => installNudgeVisible(availability, pathname), () => false);
}

export const INSTALL_NUDGE_MIN_VISITS = 3;
export const INSTALL_NUDGE_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;
const VISITS_KEY = "wardmote.install.visits";
const VISIT_COUNTED_KEY = "wardmote.install.visit-counted";
const SNOOZED_UNTIL_KEY = "wardmote.install.snoozed-until";

function readNumber(storage: Storage, key: string): number {
  const value = Number(storage.getItem(key));
  return Number.isFinite(value) ? value : 0;
}

export function recordAppVisit(storage: Storage = window.localStorage, session: Storage = window.sessionStorage) {
  try {
    if (session.getItem(VISIT_COUNTED_KEY)) return;
    session.setItem(VISIT_COUNTED_KEY, "1");
    storage.setItem(VISITS_KEY, String(readNumber(storage, VISITS_KEY) + 1));
  } catch {
    return;
  }
}

export function installNudgeVisible(
  availability: InstallAvailability,
  pathname: string,
  now: number = Date.now(),
  storage: Storage = window.localStorage,
): boolean {
  if (availability !== "prompt" && availability !== "ios-manual") return false;
  if (/^\/(?:[^/]+\/)?onboarding(?:\/|$)/.test(pathname)) return false;
  try {
    return readNumber(storage, VISITS_KEY) >= INSTALL_NUDGE_MIN_VISITS && readNumber(storage, SNOOZED_UNTIL_KEY) <= now;
  } catch {
    return false;
  }
}

export function snoozeInstallNudge(now: number = Date.now(), storage: Storage = window.localStorage) {
  try {
    storage.setItem(SNOOZED_UNTIL_KEY, String(now + INSTALL_NUDGE_SNOOZE_MS));
  } catch {
    return;
  } finally {
    emit();
  }
}

export function resetInstallPromptForTests() {
  deferredPrompt = null;
  installedThisSession = false;
  iosHelpOpen = false;
  listeners.clear();
}
