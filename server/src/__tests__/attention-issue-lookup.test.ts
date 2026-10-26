import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { memoizeIssueLookup } from "../services/attention.js";

describe("memoizeIssueLookup", () => {
  const unhandled: unknown[] = [];
  const recordUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };

  beforeEach(() => {
    unhandled.length = 0;
    process.on("unhandledRejection", recordUnhandled);
  });

  afterEach(() => {
    process.off("unhandledRejection", recordUnhandled);
  });

  it("surfaces a rejected batch to every caller without leaving an unhandled rejection", async () => {
    const lookup = memoizeIssueLookup<string>(async (ids) => {
      await new Promise((resolve) => setTimeout(resolve, ids.includes("a") ? 5 : 15));
      throw new Error(`load failed for ${ids.join(",")}`);
    });

    const first = lookup(["a"]);
    const second = lookup(["a", "b"]);

    await expect(first).rejects.toThrow("load failed for a");
    await expect(second).rejects.toThrow("load failed for a");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(unhandled).toEqual([]);
  });

  it("reuses an in-flight batch for ids already requested", async () => {
    const calls: string[][] = [];
    const lookup = memoizeIssueLookup<string>(async (ids) => {
      calls.push(ids);
      return new Map(ids.map((id) => [id, id.toUpperCase()]));
    });

    const [first, second] = await Promise.all([lookup(["a", null]), lookup(["a", "b", undefined])]);

    expect(calls).toEqual([["a"], ["b"]]);
    expect([...first]).toEqual([["a", "A"]]);
    expect([...second]).toEqual([["a", "A"], ["b", "B"]]);
  });
});
