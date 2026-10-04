import { describe, expect, it } from "vitest";
import { chatConversationTitle } from "../services/chat-channels.js";

const base = { providerLabel: "WhatsApp", firstMessage: "halo, kamu siapa?", sessionGeneration: 1, startedAt: new Date("2026-10-05T03:00:00Z") };

describe("chatConversationTitle", () => {
  it("names DM and group conversations by who, without the first message", () => {
    expect(chatConversationTitle({ ...base, surfaceKind: "direct_message", who: "Giazkha Delaneira" })).toBe("WhatsApp: Giazkha Delaneira");
    expect(chatConversationTitle({ ...base, surfaceKind: "linear_group", who: "Test Assistant" })).toBe("WhatsApp: Test Assistant");
  });

  it("dates later sessions of the same chat", () => {
    expect(chatConversationTitle({ ...base, surfaceKind: "direct_message", who: "Budi", sessionGeneration: 3 })).toBe("WhatsApp: Budi \u00b7 5 Okt");
  });

  it("adds a clipped first message for thread surfaces and strips mentions", () => {
    const title = chatConversationTitle({
      ...base,
      providerLabel: "Slack",
      surfaceKind: "native_thread",
      who: "#ops",
      firstMessage: "<@U123> deploy gagal di staging karena migrasi " + "x".repeat(120) + "\nbaris kedua",
    });
    expect(title.startsWith("Slack: #ops - deploy gagal di staging")).toBe(true);
    expect(title.endsWith("\u2026")).toBe(true);
    expect(title).not.toContain("baris kedua");
    expect(title.length).toBeLessThanOrEqual(160);
  });

  it("falls back when the sender is unknown", () => {
    expect(chatConversationTitle({ ...base, surfaceKind: "direct_message", who: null })).toBe("WhatsApp: conversation");
  });
});
