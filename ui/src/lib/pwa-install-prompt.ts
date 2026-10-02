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

export function resetInstallPromptForTests() {
  deferredPrompt = null;
  installedThisSession = false;
  iosHelpOpen = false;
  listeners.clear();
}
