import { describe, expect, it } from "vitest";
import {
  getAdapterSteerTarget,
  registerAdapterSteerTarget,
  type AdapterSteerTarget,
} from "./adapter-steer-registry.js";

function target(label: string): AdapterSteerTarget {
  return {
    capabilities: async () => ({ steering: true }),
    snapshot: async () => ({ activeTurnId: `${label}-turn` }),
    steer: async () => {},
  };
}

describe("adapter steer registry", () => {
  it("returns the registered target and nothing for an unknown run", () => {
    const first = target("first");
    registerAdapterSteerTarget("run-registry-a", first);

    expect(getAdapterSteerTarget("run-registry-a")).toBe(first);
    expect(getAdapterSteerTarget("run-registry-missing")).toBeUndefined();
  });

  it("releases the target and leaves the run unregistered", () => {
    const released = target("released");
    const unregister = registerAdapterSteerTarget("run-registry-b", released);
    expect(getAdapterSteerTarget("run-registry-b")).toBe(released);

    unregister();
    expect(getAdapterSteerTarget("run-registry-b")).toBeUndefined();
  });

  it("is idempotent on repeated release", () => {
    const unregister = registerAdapterSteerTarget("run-registry-c", target("c"));
    unregister();
    unregister();

    expect(getAdapterSteerTarget("run-registry-c")).toBeUndefined();
  });

  it("refuses a second live target for one run", () => {
    registerAdapterSteerTarget("run-registry-d", target("d"));

    expect(() => registerAdapterSteerTarget("run-registry-d", target("d2"))).toThrow(
      "adapter_steer_target_conflict",
    );
  });

  it("keeps a later registration when a stale release fires", () => {
    const first = target("first");
    const second = target("second");
    const releaseFirst = registerAdapterSteerTarget("run-registry-e", first);
    releaseFirst();
    registerAdapterSteerTarget("run-registry-e", second);

    releaseFirst();

    expect(getAdapterSteerTarget("run-registry-e")).toBe(second);
  });

  it("re-registers the same target object without throwing", () => {
    const reused = target("reused");
    registerAdapterSteerTarget("run-registry-f", reused);

    expect(() => registerAdapterSteerTarget("run-registry-f", reused)).not.toThrow();
    expect(getAdapterSteerTarget("run-registry-f")).toBe(reused);
  });
});
