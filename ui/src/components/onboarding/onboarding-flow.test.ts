import { describe, expect, it } from "vitest";
import type { OnboardingOmpStatus, OnboardingRemoteOmpStatus } from "@tickernelz/paperclip-pro-shared";
import {
  checkView,
  companyNameForFolder,
  nextStepAfterCheck,
  nextStepAfterRemote,
  olderCopies,
  signedInProvider,
  taskTitle,
} from "./onboarding-flow";

function status(overrides: Partial<OnboardingOmpStatus> = {}): OnboardingOmpStatus {
  return {
    runtime: "local",
    os: { platform: "linux", label: "Linux" },
    minVersion: "18.1.16",
    state: "ready",
    path: "/home/u/.local/bin/omp",
    version: "18.18.0",
    copies: [{ path: "/home/u/.local/bin/omp", version: "18.18.0" }],
    installCommand: "curl -fsSL https://omp.sh/install | sh",
    updateCommand: "omp update",
    network: null,
    models: [],
    recommendedModel: null,
    projectFolder: "/home/u/Projects/acme",
    ...overrides,
  };
}

describe("onboarding flow", () => {
  it("never leaves Check OMP until OMP is present and new enough", () => {
    expect(nextStepAfterCheck(status({ state: "missing" }))).toBeNull();
    expect(nextStepAfterCheck(status({ state: "too_old", version: "18.0.2" }))).toBeNull();
    expect(nextStepAfterCheck(status({ state: "unknown_version" }))).toBeNull();
  });

  it("skips Connect a model when OMP already has a signed-in model", () => {
    expect(nextStepAfterCheck(status())).toBe(1);
    expect(nextStepAfterCheck(status({ models: [{ id: "anthropic/opus", label: "Opus", provider: "anthropic" }] }))).toBe(2);
  });

  it("chooses the screen for each OMP state", () => {
    expect(checkView(status({ state: "missing" }))).toBe("install");
    expect(checkView(status({ state: "missing", network: "offline" }))).toBe("offline");
    expect(checkView(status({ state: "too_old" }))).toBe("old");
    expect(checkView(status({ state: "unknown_version" }))).toBe("old");
  });

  it("warns only about other copies with a different version", () => {
    const copies = [
      { path: "/usr/local/bin/omp", version: "18.0.2" },
      { path: "/home/u/.bun/bin/omp", version: "18.18.0" },
      { path: "/opt/omp", version: "18.0.2" },
    ];
    expect(olderCopies(status({ version: "18.0.2", copies }))).toEqual([copies[1]]);
  });

  it("gates a remote machine the same way", () => {
    const remote: OnboardingRemoteOmpStatus = {
      address: "ada@box", host: "box", port: 22, username: "ada", connected: true, latencyMs: 40,
      state: "ready", path: "/home/ada/.local/bin/omp", version: "18.17.0", modelCount: 0, homeFolder: "/home/ada", error: null,
    };
    expect(nextStepAfterRemote(remote)).toBe(1);
    expect(nextStepAfterRemote({ ...remote, modelCount: 2 })).toBe(2);
    expect(nextStepAfterRemote({ ...remote, state: "too_old" })).toBeNull();
    expect(nextStepAfterRemote({ ...remote, connected: false })).toBeNull();
  });

  it("turns the first task text into a title", () => {
    expect(taskTitle("  Read the README\nand list risks")).toBe("Read the README");
    expect(taskTitle("x".repeat(200))).toHaveLength(120);
  });

  it("names the company after the project folder", () => {
    expect(companyNameForFolder("/home/u/Projects/acme/")).toBe("acme");
    expect(companyNameForFolder(null)).toBe("My company");
  });

  it("names the provider OMP signed in to", () => {
    expect(signedInProvider(status({
      models: [{ id: "anthropic/opus", label: "Opus", provider: "anthropic" }],
      recommendedModel: "anthropic/opus",
    }))).toBe("Anthropic");
  });
});
