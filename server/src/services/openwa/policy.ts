import { and, eq, or, sql } from "drizzle-orm";
import {
  chatEndpointOwners,
  chatEndpointResources,
  chatEndpoints,
  chatExternalPrincipals,
  chatIdentityLinks,
  chatSenderRules,
  companyMemberships,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import {
  openwaChatSettingsSchema,
  openwaEndpointPolicySchema,
  type OpenwaChatSettings,
  type OpenwaEndpointPolicy,
  type OpenwaPrincipalRole,
  type OpenwaTriggerClass,
  type OpenwaTriggerOverrides,
  type OpenwaTriggerRules,
} from "@tickernelz/paperclip-pro-shared";
import { parseOpenwaThreadId } from "./adapter.js";
import { openwaChatKey } from "./outbound.js";
import type { OpenwaInboundEvent } from "./receiver.js";

export const OPENWA_POLICY_REVALIDATE_MS = 30_000;
export const OPENWA_GROUP_PARTICIPANT_CAP = 2048;
export const OPENWA_DISCOVERED_GROUP_CAP = 5_000;

export type OpenwaTriggerRule =
  | "direct_message"
  | "agent_mentioned"
  | "reply_to_agent"
  | "command_prefix"
  | "self_chat"
  | "keywords"
  | "all_messages"
  | "control";

export type OpenwaControlCommand = "new" | "close";

const ADDRESSING_RULES: ReadonlySet<OpenwaTriggerRule> = new Set([
  "direct_message",
  "agent_mentioned",
  "reply_to_agent",
  "command_prefix",
  "self_chat",
  "control",
]);

const OWNER_ACTIVITY_TYPES: ReadonlySet<string> = new Set([
  "text",
  "chat",
  "image",
  "video",
  "audio",
  "voice",
  "ptt",
  "document",
  "sticker",
  "location",
  "contact",
  "vcard",
  "multi_vcard",
  "poll",
  "poll_creation",
]);

export interface OpenwaSnapshotOwner {
  readonly ownerId: string;
  readonly identityLinkId: string;
  readonly principalId: string;
  readonly digits: string | null;
  readonly lids: Set<string>;
}

export interface OpenwaChatState {
  readonly resourceId: string | null;
  readonly chatId: string;
  readonly isGroup: boolean;
  settings: OpenwaChatSettings;
  ownerPresent: boolean | null;
  participants: readonly string[];
  available: boolean;
  label: string;
}

export interface OpenwaPolicySnapshot {
  readonly companyId: string;
  readonly endpointId: string;
  readonly revision: number;
  readonly sessionId: string;
  readonly policy: OpenwaEndpointPolicy;
  readonly agentDigits: string;
  readonly agentJid: string;
  readonly agentLids: Set<string>;
  readonly owners: readonly OpenwaSnapshotOwner[];
  readonly ownerByJid: Map<string, OpenwaSnapshotOwner>;
  readonly allow: ReadonlySet<string>;
  readonly deny: ReadonlySet<string>;
  readonly chats: Map<string, OpenwaChatState>;
  readonly builtAt: number;
}

export type OpenwaClassification =
  | { kind: "discard"; armsAbsence?: true }
  | { kind: "owner_activity"; chatKey: string; owner: OpenwaSnapshotOwner }
  | {
      kind: "trigger";
      triggerClass: OpenwaTriggerClass;
      principalRole: OpenwaPrincipalRole;
      rules: OpenwaTriggerRule[];
      chatKey: string;
      addressed: boolean;
      control: OpenwaControlCommand | null;
      owner: OpenwaSnapshotOwner | null;
    }
  | { kind: "filtered"; reason: OpenwaFilterReason; chatKey: string; principalRole: OpenwaPrincipalRole; rules: OpenwaTriggerRule[] };

export type OpenwaFilterReason = "denylisted" | "outside_allowlist" | "chat_inactive";

export interface OpenwaClassifyFacts {
  quotedFromAgent?: boolean;
}

export interface OpenwaApprovalReply {
  readonly requestId: string;
  readonly bubbleOutboundMessageId: string;
}

export class OpenwaApprovalReplyUnsupportedError extends Error {
  readonly code = "openwa_approval_reply_unsupported";
  constructor() {
    super("OpenWA approval replies require the approval handler");
  }
}

export function detectApprovalReply(_event: OpenwaInboundEvent, _snapshot: OpenwaPolicySnapshot): OpenwaApprovalReply | null {
  return null;
}

export function openwaDigits(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^\+?(\d{5,20})(?:@(?:c\.us|s\.whatsapp\.net))?$/.exec(value.trim().toLowerCase());
  return match ? match[1] : null;
}

export function openwaE164(digits: string): string {
  return "+" + digits;
}

export function openwaPrincipalExternalId(senderJid: string, senderPhone: string | null): string {
  const digits = senderPhone ? senderPhone.replace(/\D/g, "") : "";
  return digits ? digits + "@c.us" : senderJid.trim().toLowerCase();
}

export function openwaEffectiveTriggers(base: OpenwaTriggerRules, overrides: OpenwaTriggerOverrides | undefined): OpenwaTriggerRules {
  if (!overrides) return base;
  return {
    directMessage: overrides.directMessage ?? base.directMessage,
    agentMentioned: overrides.agentMentioned ?? base.agentMentioned,
    replyToAgent: overrides.replyToAgent ?? base.replyToAgent,
    commandPrefix: {
      enabled: overrides.commandPrefix?.enabled ?? base.commandPrefix.enabled,
      prefix: overrides.commandPrefix?.prefix ?? base.commandPrefix.prefix,
    },
    selfChat: overrides.selfChat ?? base.selfChat,
    ownerMentionedAbsent: overrides.ownerMentionedAbsent ?? base.ownerMentionedAbsent,
    keywords: overrides.keywords ?? base.keywords,
    allMessages: overrides.allMessages ?? base.allMessages,
  };
}

const DEFAULT_CHAT_SETTINGS: OpenwaChatSettings = { activation: "auto" };

export function openwaChatSettings(snapshot: OpenwaPolicySnapshot, chatKey: string): OpenwaChatSettings {
  return snapshot.chats.get(chatKey)?.settings ?? DEFAULT_CHAT_SETTINGS;
}

export function openwaEffectiveReplyPolicy(snapshot: OpenwaPolicySnapshot, chatKey: string) {
  return openwaChatSettings(snapshot, chatKey).replyPolicy ?? snapshot.policy.replyPolicy;
}

export function openwaSelfChatKey(snapshot: Pick<OpenwaPolicySnapshot, "agentJid">): string {
  return snapshot.agentJid;
}

export function openwaChatActive(
  snapshot: OpenwaPolicySnapshot,
  chatKey: string,
  isGroup: boolean,
  phoneTyped: boolean,
): boolean {
  const chat = snapshot.chats.get(chatKey);
  if (chat && !chat.available) return false;
  const activation = chat?.settings.activation ?? "auto";
  if (activation === "on") return true;
  if (activation === "off") return false;
  if (snapshot.policy.numberMode === "owner_number") return !isGroup && phoneTyped && chatKey === openwaSelfChatKey(snapshot);
  return isGroup ? chat?.ownerPresent === true : true;
}

export function openwaGroupEnabled(
  policy: Pick<OpenwaEndpointPolicy, "numberMode">,
  settings: Pick<OpenwaChatSettings, "activation">,
  ownerPresent: boolean,
): boolean {
  if (settings.activation === "on") return true;
  if (settings.activation === "off") return false;
  return policy.numberMode === "agent_number" && ownerPresent;
}

export function openwaParticipantJids(participants: readonly { id?: unknown; number?: unknown }[]): string[] {
  const jids = new Set<string>();
  for (const participant of participants) {
    if (jids.size >= OPENWA_GROUP_PARTICIPANT_CAP) break;
    const id = typeof participant.id === "string" ? participant.id.trim().toLowerCase() : "";
    if (id) jids.add(id.endsWith("@s.whatsapp.net") ? id.slice(0, -"@s.whatsapp.net".length) + "@c.us" : id);
    const digits = typeof participant.number === "string" ? openwaDigits(participant.number) : null;
    if (digits) jids.add(digits + "@c.us");
  }
  return [...jids];
}

export function openwaOwnerAmong(snapshot: Pick<OpenwaPolicySnapshot, "ownerByJid">, jids: readonly string[]): boolean {
  return jids.some((jid) => snapshot.ownerByJid.has(jid));
}

export function openwaSenderOwner(
  snapshot: OpenwaPolicySnapshot,
  event: Pick<OpenwaInboundEvent, "senderJid" | "senderPhone" | "phoneTyped">,
): OpenwaSnapshotOwner | null {
  if (event.phoneTyped) return snapshot.policy.numberMode === "owner_number" ? (snapshot.ownerByJid.get(snapshot.agentJid) ?? null) : null;
  const digits = event.senderPhone ? event.senderPhone.replace(/\D/g, "") : null;
  if (digits) {
    const owner = snapshot.ownerByJid.get(digits + "@c.us");
    if (owner) return owner;
  }
  return snapshot.ownerByJid.get(event.senderJid.trim().toLowerCase()) ?? null;
}

export function openwaSenderRole(snapshot: OpenwaPolicySnapshot, owner: OpenwaSnapshotOwner | null, senderPhone: string | null): OpenwaPrincipalRole {
  if (owner) return "owner";
  const digits = senderPhone ? senderPhone.replace(/\D/g, "") : "";
  if (!digits) return "outside_allowlist";
  if (snapshot.deny.has(digits)) return "denylisted";
  if (snapshot.policy.senderPolicyMode === "allowlist") return snapshot.allow.has(digits) ? "allowed" : "outside_allowlist";
  return "allowed";
}

function wholeWord(body: string, keyword: string): boolean {
  const lowerBody = body.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  let from = 0;
  for (;;) {
    const index = lowerBody.indexOf(lowerKeyword, from);
    if (index < 0) return false;
    const before = index === 0 ? "" : lowerBody[index - 1];
    const after = lowerBody[index + lowerKeyword.length] ?? "";
    if (!/[\p{L}\p{N}_]/u.test(before) && !/[\p{L}\p{N}_]/u.test(after)) return true;
    from = index + 1;
  }
}

function startsWithPrefix(body: string, prefix: string): boolean {
  const trimmed = body.trimStart();
  if (trimmed.length < prefix.length) return false;
  if (trimmed.slice(0, prefix.length).toLowerCase() !== prefix.toLowerCase()) return false;
  const next = trimmed[prefix.length];
  return next === undefined || /\s/.test(next);
}

function mentions(event: Pick<OpenwaInboundEvent, "mentionedIds" | "body">, jids: Iterable<string>, digits: string | null): boolean {
  for (const jid of jids) for (const id of event.mentionedIds) if (id.toLowerCase() === jid) return true;
  if (digits) {
    for (const id of event.mentionedIds) if (openwaDigits(id) === digits) return true;
    if (event.body.includes("@" + digits)) return true;
  }
  return false;
}

function mentionsOwner(snapshot: OpenwaPolicySnapshot, event: OpenwaInboundEvent): boolean {
  for (const owner of snapshot.owners) if (mentions(event, owner.lids, owner.digits)) return true;
  return false;
}

export function openwaControlCommand(body: string): OpenwaControlCommand | "status" | null {
  const match = /^\/(new|close|status)\s*$/i.exec(body.trim());
  return match ? (match[1].toLowerCase() as OpenwaControlCommand | "status") : null;
}

function matchedRules(
  snapshot: OpenwaPolicySnapshot,
  event: OpenwaInboundEvent,
  triggers: OpenwaTriggerRules,
  quotedFromAgent: boolean,
): OpenwaTriggerRule[] {
  const rules: OpenwaTriggerRule[] = [];
  const ownerNumber = snapshot.policy.numberMode === "owner_number";
  const isGroup = event.chatKind === "group";
  if (event.phoneTyped) {
    if (!ownerNumber) return rules;
    if (triggers.selfChat && !isGroup && event.chatKey === openwaSelfChatKey(snapshot)) rules.push("self_chat");
    if (triggers.commandPrefix.enabled && startsWithPrefix(event.body, triggers.commandPrefix.prefix)) rules.push("command_prefix");
    if (triggers.replyToAgent && quotedFromAgent) rules.push("reply_to_agent");
    return rules;
  }
  if (!isGroup && triggers.directMessage) rules.push("direct_message");
  if (!ownerNumber && triggers.agentMentioned && mentions(event, [snapshot.agentJid, ...snapshot.agentLids], snapshot.agentDigits)) rules.push("agent_mentioned");
  if (triggers.replyToAgent && quotedFromAgent) rules.push("reply_to_agent");
  if (!ownerNumber && triggers.commandPrefix.enabled && startsWithPrefix(event.body, triggers.commandPrefix.prefix)) rules.push("command_prefix");
  if (triggers.keywords.length && triggers.keywords.some((keyword) => wholeWord(event.body, keyword))) rules.push("keywords");
  if (triggers.allMessages) rules.push("all_messages");
  return rules;
}

export function openwaTriggerCandidate(event: OpenwaInboundEvent, snapshot: OpenwaPolicySnapshot, facts: OpenwaClassifyFacts = {}): boolean {
  const triggers = openwaEffectiveTriggers(snapshot.policy.triggers, openwaChatSettings(snapshot, event.chatKey).triggers);
  return matchedRules(snapshot, event, triggers, facts.quotedFromAgent === true).length > 0 || openwaControlCommand(event.body) !== null;
}

export function openwaQuoteMayAddressAgent(event: OpenwaInboundEvent, snapshot: OpenwaPolicySnapshot): boolean {
  if (!event.quoted || event.quoted.id.startsWith("false_")) return false;
  const triggers = openwaEffectiveTriggers(snapshot.policy.triggers, openwaChatSettings(snapshot, event.chatKey).triggers);
  return triggers.replyToAgent && openwaChatActive(snapshot, event.chatKey, event.chatKind === "group", event.phoneTyped);
}

export function classifyOpenwaEvent(
  event: OpenwaInboundEvent,
  snapshot: OpenwaPolicySnapshot,
  facts: OpenwaClassifyFacts = {},
): OpenwaClassification {
  if (event.event === "message.sent" && !event.phoneTyped) return { kind: "discard" };
  if (event.phoneTyped && snapshot.policy.numberMode !== "owner_number") return { kind: "discard" };
  const owner = openwaSenderOwner(snapshot, event);
  const isGroup = event.chatKind === "group";
  const chatKey = event.chatKey;
  const active = openwaChatActive(snapshot, chatKey, isGroup, event.phoneTyped);
  const triggers = openwaEffectiveTriggers(snapshot.policy.triggers, openwaChatSettings(snapshot, chatKey).triggers);
  const role = openwaSenderRole(snapshot, owner, event.senderPhone);
  const command = openwaControlCommand(event.body);
  const controlAllowed = command !== null && (role === "owner" || (!isGroup && role === "allowed"));
  const rules = controlAllowed ? (["control"] as OpenwaTriggerRule[]) : matchedRules(snapshot, event, triggers, facts.quotedFromAgent === true);
  const addressed = rules.some((rule) => ADDRESSING_RULES.has(rule));
  if (!rules.length || !active) {
    if (addressed && !active) return { kind: "filtered", reason: "chat_inactive", chatKey, principalRole: role, rules };
    if (owner && OWNER_ACTIVITY_TYPES.has(event.type)) return { kind: "owner_activity", chatKey, owner };
    if (
      !owner &&
      active &&
      !event.phoneTyped &&
      triggers.ownerMentionedAbsent &&
      (isGroup ? mentionsOwner(snapshot, event) : snapshot.policy.numberMode === "owner_number")
    )
      return { kind: "discard", armsAbsence: true };
    return { kind: "discard" };
  }
  if (role === "denylisted") return addressed ? { kind: "filtered", reason: "denylisted", chatKey, principalRole: role, rules } : { kind: "discard" };
  if (role === "outside_allowlist" && !isGroup)
    return addressed ? { kind: "filtered", reason: "outside_allowlist", chatKey, principalRole: role, rules } : { kind: "discard" };
  return {
    kind: "trigger",
    triggerClass: role === "owner" ? "owner" : "other",
    principalRole: role,
    rules,
    chatKey,
    addressed,
    control: controlAllowed && command !== "status" ? command : null,
    owner,
  };
}

type Reader = Pick<Db, "select">;

function settingsOf(value: unknown): OpenwaChatSettings {
  const parsed = openwaChatSettingsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : { activation: "off" };
}

function chatStateFromRow(row: {
  id: string;
  type: string;
  providerResourceId: string;
  settings: unknown;
  metadata: Record<string, unknown>;
  enabled: boolean;
  availability: string;
  label: string;
}): [string, OpenwaChatState] | null {
  let chatId: string;
  let isGroup: boolean;
  try {
    const thread = parseOpenwaThreadId(row.providerResourceId);
    chatId = thread.chatId;
    isGroup = thread.isGroup;
  } catch {
    return null;
  }
  const participants = Array.isArray(row.metadata.participants)
    ? row.metadata.participants.filter((entry): entry is string => typeof entry === "string").slice(0, OPENWA_GROUP_PARTICIPANT_CAP)
    : [];
  return [
    openwaChatKey(chatId),
    {
      resourceId: row.id,
      chatId,
      isGroup,
      settings: settingsOf(row.settings),
      ownerPresent: typeof row.metadata.ownerPresent === "boolean" ? row.metadata.ownerPresent : null,
      participants,
      available: row.availability === "available",
      label: row.label,
    },
  ];
}

export async function loadOpenwaPolicySnapshot(db: Reader, companyId: string, endpointId: string, now = Date.now()): Promise<OpenwaPolicySnapshot | null> {
  const [endpoint] = await db
    .select({
      policy: chatEndpoints.policy,
      revision: chatEndpoints.policyRevision,
      botExternalId: chatEndpoints.botExternalId,
      providerAccountId: chatEndpoints.providerAccountId,
      provider: chatEndpoints.provider,
    })
    .from(chatEndpoints)
    .where(and(eq(chatEndpoints.companyId, companyId), eq(chatEndpoints.id, endpointId)));
  if (!endpoint || endpoint.provider !== "openwa") return null;
  const ownerRows = await db
    .select({
      ownerId: chatEndpointOwners.id,
      identityLinkId: chatEndpointOwners.identityLinkId,
      principalId: chatIdentityLinks.principalId,
      externalId: chatExternalPrincipals.externalId,
      alternateExternalIds: chatExternalPrincipals.alternateExternalIds,
      membershipStatus: companyMemberships.status,
      membershipRole: companyMemberships.membershipRole,
    })
    .from(chatEndpointOwners)
    .innerJoin(
      chatIdentityLinks,
      and(eq(chatIdentityLinks.companyId, chatEndpointOwners.companyId), eq(chatIdentityLinks.id, chatEndpointOwners.identityLinkId)),
    )
    .innerJoin(
      chatExternalPrincipals,
      and(eq(chatExternalPrincipals.companyId, chatIdentityLinks.companyId), eq(chatExternalPrincipals.id, chatIdentityLinks.principalId)),
    )
    .innerJoin(
      companyMemberships,
      and(
        eq(companyMemberships.companyId, chatIdentityLinks.companyId),
        eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, chatIdentityLinks.paperclipUserId),
      ),
    )
    .where(
      and(
        eq(chatEndpointOwners.companyId, companyId),
        eq(chatEndpointOwners.endpointId, endpointId),
        eq(chatIdentityLinks.status, "linked"),
      ),
    );
  const ruleRows = await db
    .select({ list: chatSenderRules.list, e164: chatSenderRules.e164 })
    .from(chatSenderRules)
    .where(and(eq(chatSenderRules.companyId, companyId), eq(chatSenderRules.endpointId, endpointId)));
  const resourceRows = await db
    .select({
      id: chatEndpointResources.id,
      type: chatEndpointResources.type,
      providerResourceId: chatEndpointResources.providerResourceId,
      settings: chatEndpointResources.settings,
      metadata: chatEndpointResources.metadata,
      enabled: chatEndpointResources.enabled,
      availability: chatEndpointResources.availability,
      label: chatEndpointResources.label,
    })
    .from(chatEndpointResources)
    .where(
      and(
        eq(chatEndpointResources.companyId, companyId),
        eq(chatEndpointResources.endpointId, endpointId),
        or(eq(chatEndpointResources.type, "group_chat"), sql`${chatEndpointResources.settings} <> '{}'::jsonb`),
      ),
    )
    .limit(OPENWA_DISCOVERED_GROUP_CAP);
  const policy = openwaEndpointPolicySchema.parse(endpoint.policy ?? {});
  const agentDigits = (endpoint.botExternalId ?? "").replace(/\D/g, "");
  const account = endpoint.providerAccountId ?? "";
  const owners: OpenwaSnapshotOwner[] = [];
  const ownerByJid = new Map<string, OpenwaSnapshotOwner>();
  for (const row of ownerRows) {
    if (row.membershipStatus !== "active" || row.membershipRole === "viewer") continue;
    const digits = openwaDigits(row.externalId);
    const lids = new Set<string>();
    for (const id of [row.externalId, ...row.alternateExternalIds]) {
      const lower = id.trim().toLowerCase();
      if (lower.endsWith("@lid")) lids.add(lower);
    }
    const owner: OpenwaSnapshotOwner = { ownerId: row.ownerId, identityLinkId: row.identityLinkId, principalId: row.principalId, digits, lids };
    owners.push(owner);
    if (digits) ownerByJid.set(digits + "@c.us", owner);
    for (const lid of lids) ownerByJid.set(lid, owner);
  }
  const allow = new Set<string>();
  const deny = new Set<string>();
  for (const rule of ruleRows) (rule.list === "deny" ? deny : allow).add(rule.e164.replace(/\D/g, ""));
  const chats = new Map<string, OpenwaChatState>();
  for (const row of resourceRows) {
    const entry = chatStateFromRow(row);
    if (!entry) continue;
    if (entry[1].isGroup && entry[1].participants.length) entry[1].ownerPresent = entry[1].participants.some((id) => ownerByJid.has(id));
    chats.set(entry[0], entry[1]);
  }
  return {
    companyId,
    endpointId,
    revision: endpoint.revision,
    sessionId: account.slice(account.lastIndexOf("#") + 1),
    policy,
    agentDigits,
    agentJid: agentDigits + "@c.us",
    agentLids: new Set(),
    owners,
    ownerByJid,
    allow,
    deny,
    chats,
    builtAt: now,
  };
}

export function openwaLearnOwnerLid(snapshot: OpenwaPolicySnapshot, owner: OpenwaSnapshotOwner, lid: string): boolean {
  const lower = lid.trim().toLowerCase();
  if (!lower.endsWith("@lid") || owner.lids.has(lower)) return false;
  owner.lids.add(lower);
  snapshot.ownerByJid.set(lower, owner);
  return true;
}

export function openwaRememberChat(snapshot: OpenwaPolicySnapshot, chatKey: string, state: OpenwaChatState): void {
  if (!snapshot.chats.has(chatKey) && snapshot.chats.size >= OPENWA_DISCOVERED_GROUP_CAP) {
    const oldest = snapshot.chats.keys().next().value;
    if (oldest !== undefined) snapshot.chats.delete(oldest);
  }
  snapshot.chats.set(chatKey, state);
}

export interface OpenwaPolicyCache {
  peek(endpointId: string): OpenwaPolicySnapshot | null;
  get(companyId: string, endpointId: string): Promise<OpenwaPolicySnapshot | null>;
  refreshIfStale(companyId: string, endpointId: string, revision: number): Promise<OpenwaPolicySnapshot | null>;
  revalidateInBackground(companyId: string, endpointId: string): void;
  invalidate(endpointId: string): void;
}

export function createOpenwaPolicyCache(db: Reader, now: () => number = Date.now): OpenwaPolicyCache {
  const entries = new Map<string, { snapshot: OpenwaPolicySnapshot | null; checkedAt: number }>();
  const loading = new Map<string, Promise<OpenwaPolicySnapshot | null>>();
  const revalidating = new Set<string>();
  let generation = 0;
  const generations = new Map<string, number>();

  function load(companyId: string, endpointId: string): Promise<OpenwaPolicySnapshot | null> {
    const inFlight = loading.get(endpointId);
    if (inFlight) return inFlight;
    const started = generations.get(endpointId) ?? 0;
    const promise = loadOpenwaPolicySnapshot(db, companyId, endpointId, now())
      .then((snapshot) => {
        if ((generations.get(endpointId) ?? 0) === started) entries.set(endpointId, { snapshot, checkedAt: now() });
        return snapshot;
      })
      .finally(() => loading.delete(endpointId));
    loading.set(endpointId, promise);
    return promise;
  }

  return {
    peek(endpointId) {
      return entries.get(endpointId)?.snapshot ?? null;
    },
    async get(companyId, endpointId) {
      const entry = entries.get(endpointId);
      if (entry?.snapshot) return entry.snapshot;
      return load(companyId, endpointId);
    },
    async refreshIfStale(companyId, endpointId, revision) {
      const entry = entries.get(endpointId);
      if (entry?.snapshot && entry.snapshot.revision === revision) {
        entry.checkedAt = now();
        return entry.snapshot;
      }
      generations.set(endpointId, ++generation);
      loading.delete(endpointId);
      return load(companyId, endpointId);
    },
    revalidateInBackground(companyId, endpointId) {
      const entry = entries.get(endpointId);
      if (!entry?.snapshot || now() - entry.checkedAt < OPENWA_POLICY_REVALIDATE_MS || revalidating.has(endpointId)) return;
      revalidating.add(endpointId);
      entry.checkedAt = now();
      void db
        .select({ revision: chatEndpoints.policyRevision })
        .from(chatEndpoints)
        .where(and(eq(chatEndpoints.companyId, companyId), eq(chatEndpoints.id, endpointId)))
        .then(async ([row]) => {
          if (row && row.revision !== entry.snapshot?.revision) await this.refreshIfStale(companyId, endpointId, row.revision);
        })
        .catch(() => undefined)
        .finally(() => revalidating.delete(endpointId));
    },
    invalidate(endpointId) {
      generations.set(endpointId, ++generation);
      entries.delete(endpointId);
      loading.delete(endpointId);
    },
  };
}
