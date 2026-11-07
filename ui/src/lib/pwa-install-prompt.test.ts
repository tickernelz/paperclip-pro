// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureInstallPrompt,
  installAvailability,
  installNudgeVisible,
  recordAppVisit,
  snoozeInstallNudge,
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

describe("install nudge", () => {
  const DAY = 24 * 60 * 60 * 1000;

  function visit(times: number) {
    for (let i = 0; i < times; i++) {
      window.sessionStorage.clear();
      recordAppVisit();
    }
  }

  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("appears from the third visit, counting each browser session once", () => {
    visit(2);
    recordAppVisit();
    recordAppVisit();
    expect(installNudgeVisible("prompt", "/WAR/dashboard")).toBe(false);
    visit(1);
    expect(installNudgeVisible("prompt", "/WAR/dashboard")).toBe(true);
    expect(installNudgeVisible("ios-manual", "/WAR/dashboard")).toBe(true);
  });

  it("stays away from onboarding and from browsers that cannot install", () => {
    visit(5);
    expect(installNudgeVisible("prompt", "/onboarding")).toBe(false);
    expect(installNudgeVisible("prompt", "/WAR/onboarding/agent")).toBe(false);
    expect(installNudgeVisible("unavailable", "/WAR/dashboard")).toBe(false);
    expect(installNudgeVisible("installed", "/WAR/dashboard")).toBe(false);
  });

  it("hides for 30 days after Not now", () => {
    visit(3);
    const now = Date.UTC(2026, 10, 7);
    snoozeInstallNudge(now);
    expect(installNudgeVisible("prompt", "/WAR/dashboard", now + 29 * DAY)).toBe(false);
    expect(installNudgeVisible("prompt", "/WAR/dashboard", now + 30 * DAY)).toBe(true);
  });
});
