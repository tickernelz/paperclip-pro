import { describe, expect, it, vi } from "vitest";
import type { AdapterRuntimeEvent } from "@tickernelz/paperclip-pro-adapter-utils";
import { createOmpModelFallbackTracker, ompFallbackChain, stripOmpThinkingSuffix } from "./model-fallback.js";

describe("OMP model fallback tracker", () => {
  it("reports an in-run switch with the reason and retry-after of the error that caused it", async () => {
    const emit = vi.fn(async (_event: AdapterRuntimeEvent) => {});
    const tracker = createOmpModelFallbackTracker({ primary: "a/primary", start: "a/primary", emit });
    await tracker.ingest({ type: "auto_retry_start", errorMessage: "429 Too Many Requests retry-after-ms: 90000" });
    await tracker.ingest({ type: "retry_fallback_applied", from: "a/primary:high", to: "b/backup:high", role: "a/primary" });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]![0]).toMatchObject({
      eventType: "model.fallback",
      payload: { phase: "in_run", from: "a/primary", to: "b/backup", primary: "a/primary", reason: "rate_limit", retryAfterMs: 90000 },
    });
    expect(tracker.snapshot()).toMatchObject({ primary: "a/primary", active: "b/backup" });
  });

  it("defaults the cooldown to five minutes and labels server errors as upstream", async () => {
    const emit = vi.fn(async (_event: AdapterRuntimeEvent) => {});
    const tracker = createOmpModelFallbackTracker({ primary: "a/primary", start: "a/primary", emit });
    await tracker.ingest({ type: "auto_retry_start", errorMessage: "503 Service Unavailable" });
    await tracker.ingest({ type: "retry_fallback_applied", from: "a/primary", to: "b/backup", role: "a/primary" });
    expect(emit.mock.calls[0]![0]).toMatchObject({ payload: { reason: "upstream", retryAfterMs: 300000 } });
  });

  it("ignores switches of other roles and reports the return to the primary", async () => {
    const emit = vi.fn(async (_event: AdapterRuntimeEvent) => {});
    const tracker = createOmpModelFallbackTracker({ primary: "a/primary", start: "a/primary", emit });
    await tracker.ingest({ type: "retry_fallback_applied", from: "c/smol", to: "d/smol", role: "smol" });
    expect(emit).not.toHaveBeenCalled();
    await tracker.ingest({ type: "retry_fallback_applied", from: "a/primary", to: "b/backup", role: "a/primary" });
    await tracker.ingest({ type: "message_end", message: { role: "assistant", provider: "a", model: "primary" } });
    expect(emit.mock.calls[1]![0]).toMatchObject({ eventType: "model.fallback_restored", payload: { from: "b/backup", to: "a/primary" } });
    expect(tracker.snapshot().active).toBe("a/primary");
  });

  it("builds the chain from config and strips thinking suffixes only", () => {
    expect(ompFallbackChain({ model: "a/x", fallbackModels: ["b/y", "a/x", "b/y"] })).toEqual({ key: "a/x", chain: ["b/y"] });
    expect(ompFallbackChain({ model: "a/x", fallbackModels: [] })).toBeNull();
    expect(stripOmpThinkingSuffix("ollama/llama3:8b")).toBe("ollama/llama3:8b");
    expect(stripOmpThinkingSuffix("a/x:xhigh")).toBe("a/x");
  });
});
