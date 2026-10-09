import { describe, expect, it } from "vitest";
import {
  chatInflightModeSchema,
  openwaChatSettingsSchema,
  openwaEndpointPolicySchema,
} from "./chat-channels.js";

const sharedDefaults = {
  senderPolicyMode: "allowlist",
  replyPolicy: "allowed",
  groupMemberReplies: true,
  absenceSeconds: 120,
  approvals: {
    createTask: true,
    externalTools: true,
    crossChatSend: true,
    waAdmin: true,
    gatewayAdmin: true,
    reminderMinutes: 30,
    maxReminders: 3,
    grantTtlHours: 24,
    pendingTtlHours: 24,
  },
  rotateAfterIdleHours: 24,
  progressNudgeSeconds: 60,
  typingIndicator: true,
  ownerNumberPrefix: { enabled: true, text: "\u{1F916} *Assistant:*" },
  gatewayAdminTools: "off",
  customInstructions: "",
  auditContentRetentionDays: 90,
  attestations: { pacing: false, soleClient: false },
};

describe("OpenWA endpoint policy", () => {
  it("fills every agent_number default from an empty stored policy", () => {
    expect(openwaEndpointPolicySchema.parse({})).toEqual({
      ...sharedDefaults,
      numberMode: "agent_number",
      triggers: {
        directMessage: true,
        agentMentioned: true,
        replyToAgent: true,
        commandPrefix: { enabled: false, prefix: "/ai" },
        selfChat: false,
        ownerMentionedAbsent: true,
        keywords: [],
        allMessages: false,
      },
    });
  });

  it("derives owner_number trigger defaults from the number mode", () => {
    expect(openwaEndpointPolicySchema.parse({ numberMode: "owner_number" })).toEqual({
      ...sharedDefaults,
      numberMode: "owner_number",
      triggers: {
        directMessage: false,
        agentMentioned: false,
        replyToAgent: true,
        commandPrefix: { enabled: true, prefix: "/ai" },
        selfChat: true,
        ownerMentionedAbsent: true,
        keywords: [],
        allMessages: false,
      },
    });
  });

  it("keeps explicit trigger values over the mode defaults", () => {
    const policy = openwaEndpointPolicySchema.parse({
      numberMode: "owner_number",
      triggers: {
        directMessage: true,
        commandPrefix: { prefix: "!bot" },
        keywords: ["deploy"],
      },
    });
    expect(policy.triggers).toEqual({
      directMessage: true,
      agentMentioned: false,
      replyToAgent: true,
      commandPrefix: { enabled: true, prefix: "!bot" },
      selfChat: true,
      ownerMentionedAbsent: true,
      keywords: ["deploy"],
      allMessages: false,
    });
  });

  it("is idempotent over its own output", () => {
    const once = openwaEndpointPolicySchema.parse({ numberMode: "owner_number", approvals: { waAdmin: false } });
    expect(openwaEndpointPolicySchema.parse(once)).toEqual(once);
  });

  it.each([
    [{ absenceSeconds: 9 }],
    [{ absenceSeconds: 86_401 }],
    [{ absenceSeconds: 120.5 }],
    [{ approvals: { reminderMinutes: 0 } }],
    [{ approvals: { maxReminders: 11 } }],
    [{ approvals: { grantTtlHours: 0 } }],
    [{ approvals: { pendingTtlHours: 0 } }],
    [{ approvals: { pendingTtlHours: 169 } }],
    [{ approvals: { pendingTtlHours: 1.5 } }],
    [{ rotateAfterIdleHours: 0 }],
    [{ progressNudgeSeconds: -1 }],
    [{ auditContentRetentionDays: 0 }],
    [{ customInstructions: "x".repeat(8001) }],
    [{ ownerNumberPrefix: { text: "" } }],
    [{ triggers: { commandPrefix: { prefix: "two words" } } }],
    [{ triggers: { keywords: [""] } }],
    [{ numberMode: "shared_number" }],
    [{ gatewayAdminTools: "admin" }],
  ])("rejects out-of-range value %j", (input) => {
    expect(openwaEndpointPolicySchema.safeParse(input).success).toBe(false);
  });

  it("accepts the boundary values", () => {
    const policy = openwaEndpointPolicySchema.parse({
      absenceSeconds: 10,
      progressNudgeSeconds: 0,
      customInstructions: "x".repeat(8000),
      approvals: { maxReminders: 0, pendingTtlHours: 1 },
    });
    expect(openwaEndpointPolicySchema.parse({ approvals: { pendingTtlHours: 168 } }).approvals.pendingTtlHours).toBe(168);
    expect(policy.approvals.pendingTtlHours).toBe(1);
    expect(policy.absenceSeconds).toBe(10);
    expect(policy.progressNudgeSeconds).toBe(0);
    expect(policy.customInstructions).toHaveLength(8000);
    expect(policy.approvals.maxReminders).toBe(0);
  });

  it.each([
    [{ unknown: true }],
    [{ triggers: { mentionAll: true } }],
    [{ triggers: { commandPrefix: { enabled: true, caseSensitive: true } } }],
    [{ approvals: { deleteChat: true } }],
    [{ ownerNumberPrefix: { emoji: "x" } }],
    [{ attestations: { pacing: true, other: true } }],
  ])("rejects unknown key in %j", (input) => {
    expect(openwaEndpointPolicySchema.safeParse(input).success).toBe(false);
  });
});

describe("OpenWA per-chat settings", () => {
  it("defaults activation to auto and leaves overrides absent", () => {
    expect(openwaChatSettingsSchema.parse({})).toEqual({ activation: "auto" });
  });

  it("accepts overrides within bounds", () => {
    expect(
      openwaChatSettingsSchema.parse({
        activation: "on",
        triggers: { allMessages: true },
        absenceSeconds: 300,
        replyPolicy: "owner_absent_only",
        note: "n".repeat(2000),
      }),
    ).toMatchObject({ activation: "on", absenceSeconds: 300, replyPolicy: "owner_absent_only" });
  });

  it.each([
    [{ activation: "maybe" }],
    [{ note: "n".repeat(2001) }],
    [{ absenceSeconds: 5 }],
    [{ replyPolicy: "never" }],
    [{ triggers: { unknown: true } }],
    [{ extra: 1 }],
  ])("rejects %j", (input) => {
    expect(openwaChatSettingsSchema.safeParse(input).success).toBe(false);
  });
});

describe("chat in-flight mode", () => {
  it("accepts only steer and queue", () => {
    expect(chatInflightModeSchema.options).toEqual(["steer", "queue"]);
    expect(chatInflightModeSchema.safeParse("drop").success).toBe(false);
  });
});
