import { describe, expect, it } from "vitest";
import {
  describeDeliveryDowngrade,
  normalizeComposerCommandText,
  parseMessageDeliveryCommand,
} from "./message-delivery-command";

const NBSP = "\u00a0";

describe("parseMessageDeliveryCommand", () => {
  it("parses /steer into the steer mode and strips the command token", () => {
    expect(parseMessageDeliveryCommand("/steer look at the failing test")).toEqual({
      matched: true,
      command: { mode: "steer", prompt: "look at the failing test" },
    });
  });

  it("parses /queue into the queue mode and strips the command token", () => {
    expect(parseMessageDeliveryCommand("/queue write the summary")).toEqual({
      matched: true,
      command: { mode: "queue", prompt: "write the summary" },
    });
  });

  it("leaves bare text unmatched so it resolves to the global default", () => {
    expect(parseMessageDeliveryCommand("look at the failing test")).toEqual({
      matched: false,
    });
  });

  it("rejects a command with no message instead of sending an empty prompt", () => {
    const steer = parseMessageDeliveryCommand("/steer");
    expect(steer.matched).toBe(true);
    expect(steer).toHaveProperty("error");

    const queue = parseMessageDeliveryCommand(`/queue${NBSP}`);
    expect(queue.matched).toBe(true);
    expect(queue).toHaveProperty("error");
  });

  it("keeps a prompt that itself starts with a slash", () => {
    expect(parseMessageDeliveryCommand("/steer /queue then /goal clear")).toEqual({
      matched: true,
      command: { mode: "steer", prompt: "/queue then /goal clear" },
    });
  });

  it("does not match a command that only prefixes a longer word", () => {
    expect(parseMessageDeliveryCommand("/steering the run")).toEqual({
      matched: false,
    });
  });
});

describe("parseMessageDeliveryCommand with the MDXEditor autolink shape", () => {
  it("absorbs the whole-document relative autolink for /steer", () => {
    expect(
      parseMessageDeliveryCommand("[/steer](</steer look at the failing test>)"),
    ).toEqual({
      matched: true,
      command: { mode: "steer", prompt: "look at the failing test" },
    });
  });

  it("absorbs the whole-document relative autolink for /queue", () => {
    expect(parseMessageDeliveryCommand("[/queue](</queue write the summary>)")).toEqual({
      matched: true,
      command: { mode: "queue", prompt: "write the summary" },
    });
  });

  it("absorbs the percent-encoded autolink for both commands", () => {
    expect(parseMessageDeliveryCommand("[/steer](/steer%20look%20now)")).toEqual({
      matched: true,
      command: { mode: "steer", prompt: "look now" },
    });
    expect(
      parseMessageDeliveryCommand(`[/queue](/queue${encodeURIComponent(NBSP)}later)`),
    ).toEqual({
      matched: true,
      command: { mode: "queue", prompt: "later" },
    });
  });

  it("absorbs the non-breaking separator the picker inserts after the token", () => {
    expect(parseMessageDeliveryCommand(`/steer${NBSP}look at this`)).toEqual({
      matched: true,
      command: { mode: "steer", prompt: "look at this" },
    });
  });

  it("still absorbs every pre-existing /goal autolink shape", () => {
    expect(normalizeComposerCommandText("[/goal](</goal ship it>)")).toBe(
      "/goal ship it",
    );
    expect(normalizeComposerCommandText("[/go](</goal ship it>)")).toBe(
      "/goal ship it",
    );
    expect(normalizeComposerCommandText("[/goal](/goal%20ship%20it)")).toBe(
      "/goal ship it",
    );
    expect(normalizeComposerCommandText(`[/goal](</goal ship${NBSP}it>)`)).toBe(
      "/goal ship it",
    );
  });

  it("leaves an ordinary Markdown link as an ordinary comment", () => {
    expect(parseMessageDeliveryCommand("[steer](</steer look at this>)")).toEqual({
      matched: false,
    });
    expect(parseMessageDeliveryCommand("[docs](/steer%20x)")).toEqual({
      matched: false,
    });
    expect(
      normalizeComposerCommandText("see [the log](</logs/12>) now"),
    ).toBe("see [the log](</logs/12>) now");
  });

  it("does not absorb a link whose label and target name different commands", () => {
    expect(parseMessageDeliveryCommand("[/steer](</queue later>)")).toEqual({
      matched: false,
    });
  });
});

describe("describeDeliveryDowngrade", () => {
  it("reports a downgraded steer with the reason the server gave", () => {
    expect(
      describeDeliveryDowngrade("steer", {
        deliveredAs: "queued",
        steeringUnavailable: "board_only",
      }),
    ).toContain("board users");
  });

  it("distinguishes a failed attempt from a missing live turn", () => {
    const failed = describeDeliveryDowngrade("steer", {
      deliveredAs: "queued",
      steeringUnavailable: "steering_failed",
    });
    const noRun = describeDeliveryDowngrade("steer", {
      deliveredAs: "queued",
      steeringUnavailable: "no_active_run",
    });
    expect(failed).not.toBe(noRun);
    expect(failed).toContain("next turn");
    expect(noRun).toContain("no active run");
  });

  it("stays silent when the steer actually landed", () => {
    expect(
      describeDeliveryDowngrade("steer", { deliveredAs: "steered" }),
    ).toBeNull();
  });

  it("stays silent for an explicit /queue, which is never a downgrade", () => {
    expect(
      describeDeliveryDowngrade("queue", {
        deliveredAs: "queued",
        steeringUnavailable: "not_requested",
      }),
    ).toBeNull();
  });

  it("stays silent for a steer that came back with no reason at all", () => {
    expect(describeDeliveryDowngrade("steer", { deliveredAs: "queued" })).toBeNull();
    expect(describeDeliveryDowngrade("steer", null)).toBeNull();
  });

  it("falls back to calm copy for an unknown reason literal", () => {
    const notice = describeDeliveryDowngrade("steer", {
      deliveredAs: "queued",
      steeringUnavailable: "something_new" as never,
    });
    expect(notice).toContain("could not be steered");
  });
});
