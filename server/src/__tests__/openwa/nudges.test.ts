import { describe, expect, it, vi } from "vitest";
import { createOpenwaNudges, OPENWA_NUDGE_MAX_PER_RUN, OPENWA_NUDGE_REPEAT_MS } from "../../services/openwa/nudges.js";
import { decideOpenwaInflight } from "../../services/openwa/steering.js";
import type { OpenwaScheduledWakeClock } from "../../services/openwa/scheduled-wakes.js";

class FakeClock implements OpenwaScheduledWakeClock {
  time = 0;
  private seq = 0;
  readonly timers = new Map<number, { at: number; fire: () => void }>();
  now() {
    return this.time;
  }
  setTimer(fire: () => void, delayMs: number) {
    const id = ++this.seq;
    this.timers.set(id, { at: this.time + delayMs, fire });
    return id;
  }
  clearTimer(handle: unknown) {
    this.timers.delete(handle as number);
  }
  async advanceTo(at: number) {
    for (;;) {
      const due = [...this.timers].filter(([, timer]) => timer.at <= at).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.time = due[1].at;
      due[1].fire();
      await new Promise((resolve) => setImmediate(resolve));
    }
    this.time = at;
  }
}

function harness(delivered = true) {
  const clock = new FakeClock();
  const at: number[] = [];
  const steer = vi.fn(async (input: { runId: string; text: string; correlationId: string }) => {
    at.push(clock.now());
    return delivered;
  });
  const waiting = vi.fn(async (_runId: string, _chatKey: string) => true);
  const nudges = createOpenwaNudges({ steer, waiting, clock });
  return { clock, at, steer, waiting, nudges };
}

describe("OpenWA progress nudges (spec 7.6)", () => {
  it("nudges first after progressNudgeSeconds, then every 180 s, at most 5 per run", async () => {
    const t = harness();
    t.nudges.start({ runId: "run-1", chatKey: "628@c.us", progressNudgeSeconds: 60 });
    await t.clock.advanceTo(59_999);
    expect(t.steer).not.toHaveBeenCalled();
    await t.clock.advanceTo(60 * 60_000);
    expect(t.at).toEqual([60_000, 240_000, 420_000, 600_000, 780_000]);
    expect(t.at).toHaveLength(OPENWA_NUDGE_MAX_PER_RUN);
    expect(t.at[1]! - t.at[0]!).toBe(OPENWA_NUDGE_REPEAT_MS);
    expect(t.nudges.active("run-1")).toBe(false);
    expect(t.clock.timers.size).toBe(0);
    const [first] = t.steer.mock.calls[0]!;
    expect(first).toMatchObject({ runId: "run-1", correlationId: "openwa-nudge:run-1:1" });
    expect(first.text).toContain("not sent to WhatsApp");
  });

  it("skips the nudge and stops for the run when its triggers were already acknowledged in the chat", async () => {
    const t = harness();
    t.waiting.mockResolvedValue(false);
    t.nudges.start({ runId: "run-1", chatKey: "628@c.us", progressNudgeSeconds: 60 });
    await t.clock.advanceTo(3_600_000);
    expect(t.waiting).toHaveBeenCalledTimes(1);
    expect(t.waiting).toHaveBeenCalledWith("run-1", "628@c.us");
    expect(t.steer).not.toHaveBeenCalled();
    expect(t.nudges.active("run-1")).toBe(false);
    expect(t.clock.timers.size).toBe(0);
  });

  it("nudges once for a fresh unacknowledged trigger and stops once nothing waits any more", async () => {
    const t = harness();
    t.waiting.mockResolvedValueOnce(true).mockResolvedValue(false);
    t.nudges.start({ runId: "run-1", chatKey: "628@c.us", progressNudgeSeconds: 60 });
    await t.clock.advanceTo(3_600_000);
    expect(t.at).toEqual([60_000]);
    expect(t.steer.mock.calls[0]![0].text).toContain("only if your final reply is still minutes away");
    expect(t.nudges.active("run-1")).toBe(false);
    expect(t.clock.timers.size).toBe(0);
  });

  it("stops nudging the run once it sends to its origin chat, also mid-check; sends to other chats do not", async () => {
    const t = harness();
    t.nudges.start({ runId: "run-1", chatKey: "628@c.us", progressNudgeSeconds: 60 });
    await t.clock.advanceTo(50_000);
    t.nudges.originSent("run-1", "other@c.us");
    await t.clock.advanceTo(60_000);
    expect(t.at).toEqual([60_000]);
    t.nudges.originSent("run-1", "628@c.us");
    expect(t.nudges.active("run-1")).toBe(false);
    expect(t.clock.timers.size).toBe(0);
    await t.clock.advanceTo(3_600_000);
    expect(t.at).toEqual([60_000]);

    let resolve!: (value: boolean) => void;
    t.waiting.mockImplementationOnce(() => new Promise<boolean>((done) => (resolve = done)));
    t.nudges.start({ runId: "run-2", chatKey: "628@c.us", progressNudgeSeconds: 60 });
    await t.clock.advanceTo(3_660_000);
    t.nudges.originSent("run-2", "628@c.us");
    resolve(true);
    await new Promise((done) => setImmediate(done));
    expect(t.at).toEqual([60_000]);
    expect(t.nudges.active("run-2")).toBe(false);
  });

  it("schedules nothing at 0 seconds and stops with the run", async () => {
    const t = harness();
    t.nudges.start({ runId: "run-0", chatKey: "628@c.us", progressNudgeSeconds: 0 });
    expect(t.clock.timers.size).toBe(0);
    t.nudges.start({ runId: "run-1", chatKey: "628@c.us", progressNudgeSeconds: 60 });
    t.nudges.stop("run-1");
    await t.clock.advanceTo(3_600_000);
    expect(t.steer).not.toHaveBeenCalled();
    expect(t.clock.timers.size).toBe(0);
  });

  it("keeps one timer per run and gives up after 5 failed steers when the run cannot be steered", async () => {
    const t = harness(false);
    t.nudges.start({ runId: "run-1", chatKey: "628@c.us", progressNudgeSeconds: 60 });
    t.nudges.start({ runId: "run-1", chatKey: "628@c.us", progressNudgeSeconds: 60 });
    expect(t.clock.timers.size).toBe(1);
    await t.clock.advanceTo(3_600_000);
    expect(t.steer).toHaveBeenCalledTimes(OPENWA_NUDGE_MAX_PER_RUN);
    expect(t.nudges.active("run-1")).toBe(false);
  });
});

describe("OpenWA in-flight table (spec 7.3)", () => {
  const owner = { triggerClass: "owner" as const, event: "message" };
  const other = { triggerClass: "other" as const, event: "message" };
  const cases: Array<[string, Parameters<typeof decideOpenwaInflight>[0], "steer" | "queue"]> = [
    ["owner message during an owner full run", { inflightMode: "steer", incoming: owner, run: { triggerClass: "owner", profile: "full" } }, "steer"],
    ["owner message during a member read_only run", { inflightMode: "steer", incoming: owner, run: { triggerClass: "other", profile: "read_only" } }, "steer"],
    ["owner message during a grant run", { inflightMode: "steer", incoming: owner, run: { triggerClass: "grant", profile: "read_only" } }, "steer"],
    ["member message during a member read_only run", { inflightMode: "steer", incoming: other, run: { triggerClass: "other", profile: "read_only" } }, "steer"],
    ["member message during an owner full run", { inflightMode: "steer", incoming: other, run: { triggerClass: "owner", profile: "full" } }, "queue"],
    ["member message during a grant run", { inflightMode: "steer", incoming: other, run: { triggerClass: "grant", profile: "read_only" } }, "queue"],
    ["approval reply", { inflightMode: "steer", incoming: { triggerClass: "owner", event: "approval_reply" }, run: { triggerClass: "owner", profile: "full" } }, "queue"],
    ["owner message with inflight_mode queue", { inflightMode: "queue", incoming: owner, run: { triggerClass: "owner", profile: "full" } }, "queue"],
    ["member message with inflight_mode queue", { inflightMode: "queue", incoming: other, run: { triggerClass: "other", profile: "read_only" } }, "queue"],
  ];
  it.each(cases)("%s", (_name, input, expected) => {
    expect(decideOpenwaInflight(input)).toBe(expected);
  });
});
