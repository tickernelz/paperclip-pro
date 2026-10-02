// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureInstallPrompt,
  installAvailability,
  isIosSafariLike,
  promptInstall,
  resetInstallPromptForTests,
} from "./pwa-install-prompt";

function installPromptEvent(outcome: "accepted" | "dismissed") {
  const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string; platform: string }>;
  };
  event.prompt = vi.fn(async () => undefined);
  event.userChoice = Promise.resolve({ outcome, platform: "web" });
  return event;
}

afterEach(() => {
  resetInstallPromptForTests();
});

describe("PWA install prompt", () => {
  it("defers the browser mini-infobar and replays the prompt on demand", async () => {
    const release = captureInstallPrompt(window);
    expect(installAvailability()).toBe("unavailable");

    const event = installPromptEvent("accepted");
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(installAvailability()).toBe("prompt");

    await expect(promptInstall()).resolves.toBe("accepted");
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(installAvailability()).toBe("unavailable");
    await expect(promptInstall()).resolves.toBe("unavailable");
    release();
  });

  it("stops offering install once the app is installed", () => {
    const release = captureInstallPrompt(window);
    window.dispatchEvent(installPromptEvent("dismissed"));
    window.dispatchEvent(new Event("appinstalled"));
    expect(installAvailability()).toBe("installed");
    release();
  });

  it("recognises iPhone, iPad and iPadOS desktop-class Safari", () => {
    expect(isIosSafariLike("Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)", 5)).toBe(true);
    expect(isIosSafariLike("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe(true);
    expect(isIosSafariLike("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe(false);
    expect(isIosSafariLike("Mozilla/5.0 (Linux; Android 15; Pixel 9)", 5)).toBe(false);
  });
});
