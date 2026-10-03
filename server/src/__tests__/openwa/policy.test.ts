import { describe, expect, it } from "vitest";
import { openwaEndpointPolicySchema, type OpenwaChatSettings } from "@tickernelz/paperclip-pro-shared";
import {
  classifyOpenwaEvent,
  detectApprovalReply,
  type OpenwaChatState,
  type OpenwaPolicySnapshot,
  type OpenwaSnapshotOwner,
} from "../../services/openwa/policy.js";
import type { OpenwaInboundEvent } from "../../services/openwa/receiver.js";

const AGENT = "628111000111";
const OWNER = "628333000333";
const ALLOWED = "628444000444";
const DENIED = "628777000777";
const STRANGER = "628555000555";
const GROUP = "120363000000000001@g.us";

function snapshot(policy: Record<string, unknown> = {}, chats: Array<[string, Partial<OpenwaChatState>]> = []): OpenwaPolicySnapshot {
  const owner: OpenwaSnapshotOwner = { ownerId: "o", identityLinkId: "l", principalId: "p", digits: OWNER, lids: new Set(["99001@lid"]) };
  return {
    companyId: "c",
    endpointId: "e",
    revision: 1,
    sessionId: "s",
    policy: openwaEndpointPolicySchema.parse(policy),
    agentDigits: AGENT,
    agentJid: AGENT + "@c.us",
    agentLids: new Set(),
    owners: [owner],
    ownerByJid: new Map([
      [OWNER + "@c.us", owner],
      ["99001@lid", owner],
    ]),
    allow: new Set([ALLOWED]),
    deny: new Set([DENIED, OWNER]),
    chats: new Map(
      chats.map(([key, state]) => [
        key,
        {
          resourceId: "r",
          chatId: key,
          isGroup: key.endsWith("@g.us"),
          settings: { activation: "auto" } as OpenwaChatSettings,
          ownerPresent: null,
          participants: [],
          available: true,
          label: key,
          ...state,
        },
      ]),
    ),
    builtAt: 0,
  };
}

function event(input: Partial<OpenwaInboundEvent> & { chatKey: string }): OpenwaInboundEvent {
  const isGroup = input.chatKey.endsWith("@g.us");
  const senderJid = input.senderJid ?? (isGroup ? STRANGER + "@c.us" : input.chatKey);
  return {
    source: "live",
    event: "message.received",
    sessionId: "s",
    waMessageId: "false_x",
    rowUuid: null,
    dedupeKey: "openwa:s:false_x",
    chatId: input.chatKey,
    chatKind: isGroup ? "group" : "dm",
    from: input.chatKey,
    author: isGroup ? senderJid : null,
    senderJid,
    senderPhone: senderJid.endsWith("@c.us") ? senderJid.slice(0, -5) : null,
    isLidSender: senderJid.endsWith("@lid"),
    fromMe: false,
    phoneTyped: false,
    degraded: false,
    body: "hello",
    type: "chat",
    timestamp: 1,
    mentionedIds: [],
    quoted: null,
    media: null,
    location: null,
    contact: null,
    raw: {},
    ...input,
  };
}

describe("classifyOpenwaEvent", () => {
  it("keeps the approval-reply seam empty until approvals land", () => {
    expect(detectApprovalReply(event({ chatKey: OWNER + "@c.us" }), snapshot())).toBeNull();
  });

  it("applies the sender policy in direct messages, with owners bypassing the denylist", () => {
    const s = snapshot();
    expect(classifyOpenwaEvent(event({ chatKey: OWNER + "@c.us" }), s)).toMatchObject({ kind: "trigger", principalRole: "owner", triggerClass: "owner", rules: ["direct_message"], addressed: true });
    expect(classifyOpenwaEvent(event({ chatKey: ALLOWED + "@c.us" }), s)).toMatchObject({ kind: "trigger", principalRole: "allowed", triggerClass: "other" });
    expect(classifyOpenwaEvent(event({ chatKey: STRANGER + "@c.us" }), s)).toMatchObject({ kind: "filtered", reason: "outside_allowlist" });
    expect(classifyOpenwaEvent(event({ chatKey: DENIED + "@c.us" }), s)).toMatchObject({ kind: "filtered", reason: "denylisted" });
    expect(classifyOpenwaEvent(event({ chatKey: "88001@lid", senderJid: "88001@lid" }), s)).toMatchObject({ kind: "filtered", reason: "outside_allowlist" });
    expect(classifyOpenwaEvent(event({ chatKey: "99001@lid", senderJid: "99001@lid" }), s)).toMatchObject({ kind: "trigger", principalRole: "owner" });
    expect(classifyOpenwaEvent(event({ chatKey: STRANGER + "@c.us" }), snapshot({ senderPolicyMode: "all" }))).toMatchObject({ kind: "trigger", principalRole: "allowed" });
    expect(classifyOpenwaEvent(event({ chatKey: DENIED + "@c.us" }), snapshot({ senderPolicyMode: "all" }))).toMatchObject({ kind: "filtered", reason: "denylisted" });
  });

  it("activates groups only with an owner present and admits outside-allowlist members there", () => {
    const mention = { mentionedIds: [AGENT + "@c.us"], body: "@" + AGENT + " help" };
    const withOwner = snapshot({}, [[GROUP, { ownerPresent: true }]]);
    expect(classifyOpenwaEvent(event({ chatKey: GROUP, ...mention }), withOwner)).toMatchObject({ kind: "trigger", principalRole: "outside_allowlist", rules: ["agent_mentioned"] });
    expect(classifyOpenwaEvent(event({ chatKey: GROUP, body: "chatter" }), withOwner)).toEqual({ kind: "discard" });
    expect(classifyOpenwaEvent(event({ chatKey: GROUP, senderJid: OWNER + "@c.us", body: "chatter" }), withOwner)).toMatchObject({ kind: "owner_activity" });
    const without = snapshot({}, [[GROUP, { ownerPresent: false }]]);
    expect(classifyOpenwaEvent(event({ chatKey: GROUP, ...mention }), without)).toMatchObject({ kind: "filtered", reason: "chat_inactive" });
    expect(classifyOpenwaEvent(event({ chatKey: GROUP, body: "chatter" }), without)).toEqual({ kind: "discard" });
    const forcedOn = snapshot({}, [[GROUP, { ownerPresent: false, settings: { activation: "on" } }]]);
    expect(classifyOpenwaEvent(event({ chatKey: GROUP, ...mention }), forcedOn)).toMatchObject({ kind: "trigger" });
    const forcedOff = snapshot({}, [[GROUP, { ownerPresent: true, settings: { activation: "off" } }]]);
    expect(classifyOpenwaEvent(event({ chatKey: GROUP, ...mention }), forcedOff)).toMatchObject({ kind: "filtered", reason: "chat_inactive" });
  });

  it("lets per-chat trigger overrides win over endpoint defaults", () => {
    const keywords = snapshot({}, [[GROUP, { ownerPresent: true, settings: { activation: "auto", triggers: { keywords: ["invoice"] } } }]]);
    expect(classifyOpenwaEvent(event({ chatKey: GROUP, body: "where is the Invoice?" }), keywords)).toMatchObject({ kind: "trigger", rules: ["keywords"], addressed: false });
    expect(classifyOpenwaEvent(event({ chatKey: GROUP, body: "invoices pending" }), keywords)).toEqual({ kind: "discard" });
    const noDm = snapshot({}, [[ALLOWED + "@c.us", { settings: { activation: "auto", triggers: { directMessage: false } } }]]);
    expect(classifyOpenwaEvent(event({ chatKey: ALLOWED + "@c.us" }), noDm)).toEqual({ kind: "discard" });
    const all = snapshot({ triggers: { allMessages: true } }, [[GROUP, { ownerPresent: true }]]);
    expect(classifyOpenwaEvent(event({ chatKey: GROUP, body: "anything" }), all)).toMatchObject({ kind: "trigger", rules: ["all_messages"] });
  });

  it("treats the agent number's own phone-typed messages by number mode", () => {
    const phoneTyped = { fromMe: true, phoneTyped: true, event: "message.sent" as const, senderJid: AGENT + "@c.us", senderPhone: AGENT };
    expect(classifyOpenwaEvent(event({ chatKey: OWNER + "@c.us", ...phoneTyped, body: "/ai do it" }), snapshot())).toEqual({ kind: "discard" });
    expect(classifyOpenwaEvent(event({ chatKey: OWNER + "@c.us", event: "message.sent", fromMe: true }), snapshot())).toEqual({ kind: "discard" });
    const ownerNumber = snapshot({ numberMode: "owner_number" });
    const self = ownerNumber.owners[0];
    ownerNumber.ownerByJid.set(AGENT + "@c.us", self);
    expect(classifyOpenwaEvent(event({ chatKey: STRANGER + "@c.us", ...phoneTyped, body: "/ai summarize" }), ownerNumber)).toMatchObject({ kind: "filtered", reason: "chat_inactive" });
    const prefixed = snapshot({ numberMode: "owner_number" }, [[STRANGER + "@c.us", { settings: { activation: "on" } }]]);
    prefixed.ownerByJid.set(AGENT + "@c.us", prefixed.owners[0]);
    expect(classifyOpenwaEvent(event({ chatKey: STRANGER + "@c.us", ...phoneTyped, body: "/ai summarize" }), prefixed)).toMatchObject({ kind: "trigger", rules: ["command_prefix"], principalRole: "owner" });
    expect(classifyOpenwaEvent(event({ chatKey: STRANGER + "@c.us", ...phoneTyped, body: "plain reply" }), prefixed)).toMatchObject({ kind: "owner_activity" });
    expect(classifyOpenwaEvent(event({ chatKey: AGENT + "@c.us", ...phoneTyped, body: "note to self" }), ownerNumber)).toMatchObject({ kind: "trigger", rules: ["self_chat"] });
    expect(classifyOpenwaEvent(event({ chatKey: ALLOWED + "@c.us", body: "hi" }), ownerNumber)).toEqual({ kind: "discard" });
    const unlinkedSelf = snapshot({ numberMode: "owner_number" });
    expect(classifyOpenwaEvent(event({ chatKey: AGENT + "@c.us", ...phoneTyped, body: "note to self" }), unlinkedSelf)).toMatchObject({ kind: "filtered", reason: "outside_allowlist" });
  });

  it("accepts control commands from owners and allowed DM senders only", () => {
    const s = snapshot({}, [[GROUP, { ownerPresent: true }]]);
    expect(classifyOpenwaEvent(event({ chatKey: OWNER + "@c.us", body: "/new" }), s)).toMatchObject({ kind: "trigger", rules: ["control"], control: "new" });
    expect(classifyOpenwaEvent(event({ chatKey: ALLOWED + "@c.us", body: "/close" }), s)).toMatchObject({ kind: "trigger", control: "close" });
    expect(classifyOpenwaEvent(event({ chatKey: ALLOWED + "@c.us", body: "/status" }), s)).toMatchObject({ kind: "trigger", rules: ["control"], control: null, addressed: true });
    expect(classifyOpenwaEvent(event({ chatKey: GROUP, body: "/new" }), s)).toEqual({ kind: "discard" });
    expect(classifyOpenwaEvent(event({ chatKey: GROUP, senderJid: OWNER + "@c.us", body: "/close" }), s)).toMatchObject({ kind: "trigger", control: "close" });
  });
});
