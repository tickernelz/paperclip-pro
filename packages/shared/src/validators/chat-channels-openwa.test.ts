import { describe, expect, it } from "vitest";
import {
  chatInflightModeSchema,
  inspectOpenwaGatewaySchema,
  OPENWA_DEFAULT_BURST_WINDOW_SECONDS,
  openwaBaseUrlSchema,
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
        burstWindowSeconds: 3,
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
        burstWindowSeconds: 3,
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
      burstWindowSeconds: 3,
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

  it("defaults the burst window to 3 seconds and accepts 0 to 10 whole seconds", () => {
    expect(OPENWA_DEFAULT_BURST_WINDOW_SECONDS).toBe(3);
    expect(openwaEndpointPolicySchema.parse({}).triggers.burstWindowSeconds).toBe(3);
    expect(openwaEndpointPolicySchema.parse({ numberMode: "owner_number" }).triggers.burstWindowSeconds).toBe(3);
    expect(openwaEndpointPolicySchema.parse({ triggers: { burstWindowSeconds: 0 } }).triggers.burstWindowSeconds).toBe(0);
    expect(openwaEndpointPolicySchema.parse({ triggers: { burstWindowSeconds: 10 } }).triggers.burstWindowSeconds).toBe(10);
    for (const burstWindowSeconds of [11, -1, 2.5, "3"])
      expect(openwaEndpointPolicySchema.safeParse({ triggers: { burstWindowSeconds } }).success).toBe(false);
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

  it("keeps the burst window out of per-chat trigger overrides", () => {
    expect(openwaChatSettingsSchema.safeParse({ triggers: { burstWindowSeconds: 3 } }).success).toBe(false);
    expect(openwaChatSettingsSchema.safeParse({ triggers: { burstWindowSeconds: 0 } }).success).toBe(false);
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

  it("stores an owner report group as a lowercase group chat key, or null for the direct chat", () => {
    expect(openwaChatSettingsSchema.parse({ ownerReportChatKey: "120363000000000512@G.US" })).toEqual({
      activation: "auto",
      ownerReportChatKey: "120363000000000512@g.us",
    });
    expect(openwaChatSettingsSchema.parse({ ownerReportChatKey: null })).toEqual({ activation: "auto", ownerReportChatKey: null });
  });

  it.each([
    [{ activation: "maybe" }],
    [{ ownerReportChatKey: "628333000511@c.us" }],
    [{ ownerReportChatKey: "" }],
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

describe("OpenWA pasted connection values", () => {
  it.each(["\u2060", "\u200b", "\ufeff", "\u00a0", " \u200d"])("removes invisible character %j copied after the gateway URL", (noise) => {
    expect(openwaBaseUrlSchema.parse("http://127.0.0.1:2785" + noise)).toBe("http://127.0.0.1:2785");
    expect(openwaBaseUrlSchema.parse(noise + "http://127.0.0.1:27" + noise + "85")).toBe("http://127.0.0.1:2785");
  });

  it("still rejects a URL that is invalid once the invisible characters are gone, with a message that says what to enter", () => {
    const notUrl = openwaBaseUrlSchema.safeParse("127.0.0.1:2785\u2060/");
    expect(notUrl.success).toBe(false);
    const withPath = openwaBaseUrlSchema.safeParse("http://127.0.0.1:2785/api\u2060");
    expect(withPath.success).toBe(false);
    expect(withPath.error?.issues[0]?.message).toBe("Use only the gateway origin: http(s)://host:port, without a path, query, or credentials");
    expect(openwaBaseUrlSchema.safeParse("\u2060").error?.issues[0]?.message).toBe("Enter the OpenWA gateway URL, for example http://localhost:2785");
  });

  it("removes invisible characters from keys and accepts either key alone, but not neither", () => {
    expect(inspectOpenwaGatewaySchema.parse({ baseUrl: "http://localhost:2785", adminApiKey: "\u200bowa_admin\u2060" })).toEqual({
      baseUrl: "http://localhost:2785",
      adminApiKey: "owa_admin",
    });
    expect(inspectOpenwaGatewaySchema.parse({ baseUrl: "http://localhost:2785", apiKey: "owa_op\u200b" }).apiKey).toBe("owa_op");
    expect(inspectOpenwaGatewaySchema.safeParse({ baseUrl: "http://localhost:2785", apiKey: "\u2060\u200b" }).success).toBe(false);
    expect(inspectOpenwaGatewaySchema.safeParse({ baseUrl: "http://localhost:2785" }).success).toBe(false);
  });
});
