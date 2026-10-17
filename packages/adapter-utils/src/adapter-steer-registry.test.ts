import { describe, expect, it } from "vitest";
import {
  deferUntilAdapterTurnActive,
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

  function turnSignallingTarget() {
    const listeners = new Set<() => void>();
    const signalling: AdapterSteerTarget = {
      ...target("signalling"),
      onceTurnActive(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    return {
      target: signalling,
      listeners,
      startTurn() {
        const pending = [...listeners];
        listeners.clear();
        for (const listener of pending) listener();
      },
    };
  }

  it("refuses a deferral when the run has no target or the target cannot signal turns", () => {
    registerAdapterSteerTarget("run-registry-g", target("g"));

    expect(deferUntilAdapterTurnActive("run-registry-missing", async () => {})).toBe(false);
    expect(deferUntilAdapterTurnActive("run-registry-g", async () => {})).toBe(false);
  });

  it("runs deferred tasks once, sequentially and in order, when the turn starts", async () => {
    const signalling = turnSignallingTarget();
    registerAdapterSteerTarget("run-registry-h", signalling.target);
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    expect(
      deferUntilAdapterTurnActive("run-registry-h", async () => {
        order.push("first:start");
        await firstGate;
        order.push("first:end");
      }),
    ).toBe(true);
    expect(
      deferUntilAdapterTurnActive("run-registry-h", async () => {
        order.push("second");
        throw new Error("ignored");
      }),
    ).toBe(true);
    expect(
      deferUntilAdapterTurnActive("run-registry-h", async () => {
        order.push("third");
      }),
    ).toBe(true);
    expect(signalling.listeners.size).toBe(1);
    expect(order).toEqual([]);

    signalling.startTurn();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(["first:start"]);
    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(["first:start", "first:end", "second", "third"]);

    signalling.startTurn();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(["first:start", "first:end", "second", "third"]);
  });

  it("drops pending deferrals when the target is released before a turn starts", async () => {
    const signalling = turnSignallingTarget();
    const release = registerAdapterSteerTarget("run-registry-i", signalling.target);
    let ran = false;
    deferUntilAdapterTurnActive("run-registry-i", async () => {
      ran = true;
    });

    release();
    expect(signalling.listeners.size).toBe(0);
    signalling.startTurn();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ran).toBe(false);
    expect(deferUntilAdapterTurnActive("run-registry-i", async () => {})).toBe(false);
  });
});
