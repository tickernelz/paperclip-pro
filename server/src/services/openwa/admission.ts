import { and, eq, sql } from "drizzle-orm";
import { Message, parseMarkdown } from "chat";
import {
  chatAuditEntries,
  chatEndpointResources,
  chatExternalPrincipals,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import {
  maskOpenwaPhoneNumber,
  type OpenwaPrincipalRole,
  type OpenwaTriggerClass,
} from "@tickernelz/paperclip-pro-shared";
import type { ChatSdkMessageTrigger } from "../chat-sdk-runtime.js";
import { openwaThreadId, type OpenwaChatAdapter } from "./adapter.js";
import { findOpenwaApprovalBubble, type OpenwaApprovalRequestStatus } from "./approvals.js";
import type { OpenwaGatewayClient } from "./gateway.js";
import type { OpenwaIngressHooks } from "./ingress.js";
import { openwaChatKey, type OpenwaOutboundRegistry } from "./outbound.js";
import {
  classifyOpenwaEvent,
  detectApprovalReply,
  openwaChatSettings,
  openwaDigits,
  openwaGroupEnabled,
  openwaLearnOwnerLid,
  openwaOwnerAmong,
  openwaParticipantJids,
  openwaPrincipalExternalId,
  openwaQuoteMayAddressAgent,
  openwaRememberChat,
  openwaSenderOwner,
  openwaSenderRole,
  openwaTriggerCandidate,
  OPENWA_DISCOVERED_GROUP_CAP,
  OPENWA_GROUP_PARTICIPANT_CAP,
  type OpenwaApprovalReplyCandidate,
  type OpenwaPolicyCache,
  type OpenwaPolicySnapshot,
  type OpenwaTriggerRule,
} from "./policy.js";
import type { OpenwaGroupEvent, OpenwaInboundContext, OpenwaInboundEvent } from "./receiver.js";

export const OPENWA_DISCOVERY_WAIT_MS = 2_000;
const DISCOVERY_RETRY_MS = 60_000;
const LEARNED_LID_CAP = 10_000;
const AUDIT_TEXT_LIMIT = 4_096;

export type OpenwaWakeEvent = "message" | "group_added" | "owner_absent" | "approval_reply";

export interface OpenwaAbsenceBatch {
  readonly wakeId: string;
  readonly carrier: boolean;
  readonly dedupeKeys: string[];
}

export interface OpenwaApprovalReplyDecoration {
  readonly requestId: string;
  readonly requestStatus: OpenwaApprovalRequestStatus;
}

export interface OpenwaAdmissionDecoration {
  readonly version: 1;
  readonly event: OpenwaWakeEvent;
  readonly triggerClass: OpenwaTriggerClass;
  readonly principalRole: OpenwaPrincipalRole;
  readonly rules: OpenwaTriggerRule[];
  readonly addressed: boolean;
  readonly control: "new" | "close" | null;
  readonly chatKey: string;
  readonly chatId: string;
  readonly chatKind: "dm" | "group";
  readonly waMessageId: string | null;
  readonly dedupeKey: string;
  readonly phoneTyped: boolean;
  readonly sender: { jid: string; phone: string | null; name: string | null };
  readonly quoted: { id: string; body: string | null; fromAgent: boolean } | null;
  readonly mentionedIds: string[];
  readonly location: Record<string, unknown> | null;
  readonly contact: Record<string, unknown> | null;
  readonly media: { mimetype: string | null; filename: string | null; sizeBytes: number | null; omitted: boolean } | null;
  readonly group: { name: string | null; participantCount: number; actorMasked: string | null } | null;
  readonly absence?: OpenwaAbsenceBatch | null;
  readonly approval?: OpenwaApprovalReplyDecoration | null;
  readonly ownerNowActive?: true;
}

type DbOrTransaction = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

function auditContent(text: string | null | undefined, retentionDays: number, occurredAt: Date) {
  return text
    ? { content: { text: text.slice(0, AUDIT_TEXT_LIMIT) }, contentPurgeAt: new Date(occurredAt.getTime() + retentionDays * 86_400_000) }
    : {};
}

/** Layer-2 trigger_admitted entry for an admitted trigger; written in the transaction that persists its delivery. */
export async function recordOpenwaTriggerAdmitted(
  database: DbOrTransaction,
  input: {
    companyId: string;
    endpointId: string;
    conversationId: string;
    deliveryId: string;
    decoration: OpenwaAdmissionDecoration;
    text: string | null;
    retentionDays: number;
  },
): Promise<void> {
  const { decoration } = input;
  const occurredAt = new Date();
  await database.insert(chatAuditEntries).values({
    companyId: input.companyId,
    endpointId: input.endpointId,
    conversationId: input.conversationId,
    chatKey: decoration.chatKey,
    kind: "trigger_admitted",
    actorKind: "chat_principal",
    actorRef: openwaPrincipalExternalId(decoration.sender.jid, decoration.sender.phone),
    metadata: {
      event: decoration.event,
      triggerClass: decoration.triggerClass,
      principalRole: decoration.principalRole,
      rules: decoration.rules,
      addressed: decoration.addressed,
      chatKind: decoration.chatKind,
      waMessageId: decoration.waMessageId,
      deliveryId: input.deliveryId,
      senderMasked: decoration.sender.phone ? maskOpenwaPhoneNumber(decoration.sender.phone) : null,
    },
    ...auditContent(input.text, input.retentionDays, occurredAt),
    occurredAt,
  });
}

export interface OpenwaWakePayload {
  event: OpenwaWakeEvent;
  triggerClass: OpenwaTriggerClass;
  deliveryIds: string[];
}

export interface OpenwaTimerHooks {
  onOwnerActivity?(chatKey: string, event: OpenwaInboundEvent, ctx: OpenwaInboundContext): Promise<void>;
  onAbsenceCandidate?(event: OpenwaInboundEvent, ctx: OpenwaInboundContext): Promise<void>;
}

export interface OpenwaAdmitInput {
  threadId: string;
  message: Message;
  trigger: ChatSdkMessageTrigger;
  decoration: OpenwaAdmissionDecoration;
}

export interface OpenwaAdmissionRuntime {
  companyId: string;
  endpointId: string;
  sessionId: string;
  adapter(): OpenwaChatAdapter | null;
  admit(input: OpenwaAdmitInput): Promise<void>;
}

export interface OpenwaAdmissionDeps {
  db: Db;
  policies: OpenwaPolicyCache;
  outbound: OpenwaOutboundRegistry;
  timers?: OpenwaTimerHooks;
  now?: () => number;
  discoveryWaitMs?: number;
}

export interface OpenwaAdmissionStats {
  discarded: number;
  ownerActivity: number;
  filtered: number;
  admitted: number;
  discoveries: number;
  discoveryFailures: number;
  quoteLookups: number;
  approvalReplies: number;
}

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function parseOpenwaDecoration(value: unknown): OpenwaAdmissionDecoration | null {
  const source = record(value);
  if (!source || source.version !== 1) return null;
  const event =
    source.event === "group_added" || source.event === "message" || source.event === "owner_absent" || source.event === "approval_reply"
      ? source.event
      : null;
  const triggerClass = source.triggerClass === "owner" || source.triggerClass === "other" || source.triggerClass === "grant" ? source.triggerClass : null;
  const principalRole =
    source.principalRole === "owner" || source.principalRole === "allowed" || source.principalRole === "outside_allowlist" || source.principalRole === "denylisted"
      ? source.principalRole
      : null;
  const chatKey = stringOf(source.chatKey);
  const chatId = stringOf(source.chatId);
  const dedupeKey = stringOf(source.dedupeKey);
  const sender = record(source.sender);
  if (!event || !triggerClass || !principalRole || !chatKey || !chatId || !dedupeKey || !sender || typeof sender.jid !== "string") return null;
  const quoted = record(source.quoted);
  const media = record(source.media);
  const group = record(source.group);
  const absence = record(source.absence);
  const approval = record(source.approval);
  return {
    version: 1,
    event,
    triggerClass,
    principalRole,
    rules: Array.isArray(source.rules) ? (source.rules.filter((rule) => typeof rule === "string") as OpenwaTriggerRule[]) : [],
    addressed: source.addressed === true,
    control: source.control === "new" || source.control === "close" ? source.control : null,
    chatKey,
    chatId,
    chatKind: source.chatKind === "group" ? "group" : "dm",
    waMessageId: stringOf(source.waMessageId),
    dedupeKey,
    phoneTyped: source.phoneTyped === true,
    sender: { jid: sender.jid, phone: stringOf(sender.phone), name: stringOf(sender.name) },
    quoted: quoted && typeof quoted.id === "string" ? { id: quoted.id, body: stringOf(quoted.body), fromAgent: quoted.fromAgent === true } : null,
    mentionedIds: Array.isArray(source.mentionedIds) ? source.mentionedIds.filter((id): id is string => typeof id === "string") : [],
    location: record(source.location),
    contact: record(source.contact),
    media: media
      ? {
          mimetype: stringOf(media.mimetype),
          filename: stringOf(media.filename),
          sizeBytes: typeof media.sizeBytes === "number" ? media.sizeBytes : null,
          omitted: media.omitted === true,
        }
      : null,
    group: group
      ? {
          name: stringOf(group.name),
          participantCount: typeof group.participantCount === "number" ? group.participantCount : 0,
          actorMasked: stringOf(group.actorMasked),
        }
      : null,
    absence:
      absence && typeof absence.wakeId === "string"
        ? {
            wakeId: absence.wakeId,
            carrier: absence.carrier === true,
            dedupeKeys: Array.isArray(absence.dedupeKeys) ? absence.dedupeKeys.filter((key): key is string => typeof key === "string") : [],
          }
        : null,
    approval:
      approval && typeof approval.requestId === "string"
        ? { requestId: approval.requestId, requestStatus: approval.requestStatus === "pending" ? "pending" : "resolved" }
        : null,
    ...(source.ownerNowActive === true ? { ownerNowActive: true as const } : {}),
  };
}

function senderName(event: OpenwaInboundEvent): string | null {
  const contact = event.contact ?? record(event.raw.contact);
  return stringOf(contact?.pushName) ?? stringOf(contact?.name) ?? stringOf(event.raw.notifyName) ?? stringOf(event.raw.pushName);
}

function triggerFor(chatKind: "dm" | "group", addressed: boolean): ChatSdkMessageTrigger {
  if (chatKind === "dm") return "direct_message";
  return addressed ? "mention" : "unaddressed_message";
}

export function openwaInboundDecoration(
  event: OpenwaInboundEvent,
  input: {
    event?: OpenwaWakeEvent;
    triggerClass: OpenwaTriggerClass;
    principalRole: OpenwaPrincipalRole;
    rules: OpenwaTriggerRule[];
    addressed: boolean;
    control: "new" | "close" | null;
    quotedFromAgent: boolean;
    absence?: OpenwaAbsenceBatch | null;
    ownerNowActive?: boolean;
  },
): OpenwaAdmissionDecoration {
  return {
    version: 1,
    event: input.event ?? "message",
    triggerClass: input.triggerClass,
    principalRole: input.principalRole,
    rules: input.rules,
    addressed: input.addressed,
    control: input.control,
    chatKey: event.chatKey,
    chatId: event.chatKey,
    chatKind: event.chatKind,
    waMessageId: event.waMessageId,
    dedupeKey: event.dedupeKey,
    phoneTyped: event.phoneTyped,
    sender: { jid: event.senderJid, phone: event.senderPhone, name: senderName(event) },
    quoted: event.quoted ? { id: event.quoted.id, body: event.quoted.body, fromAgent: input.quotedFromAgent } : null,
    mentionedIds: [...event.mentionedIds],
    location: event.location,
    contact: event.contact,
    media: event.media ? { ...event.media } : null,
    group: null,
    ...(input.absence ? { absence: input.absence } : {}),
    ...(input.ownerNowActive ? { ownerNowActive: true as const } : {}),
  };
}

export function openwaAdmitInput(
  runtime: Pick<OpenwaAdmissionRuntime, "sessionId">,
  adapter: OpenwaChatAdapter,
  event: OpenwaInboundEvent,
  decoration: OpenwaAdmissionDecoration,
): OpenwaAdmitInput {
  const threadId = openwaThreadId({ sessionId: runtime.sessionId, chatId: event.chatKey, isGroup: event.chatKind === "group" });
  const message = adapter.parseMessage({ ...event, chatId: event.chatKey });
  return { threadId, message, trigger: triggerFor(event.chatKind, decoration.addressed), decoration };
}

export function createOpenwaAdmission(deps: OpenwaAdmissionDeps) {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const discoveryWaitMs = deps.discoveryWaitMs ?? OPENWA_DISCOVERY_WAIT_MS;
  const discoveries = new Map<string, Promise<boolean>>();
  const discoveryFailures = new Map<string, number>();
  const learnedLids = new Set<string>();
  const resolvedLids = new Map<string, string>();
  const lidLookups = new Map<string, Promise<void>>();
  const lidRetryAt = new Map<string, number>();
  const stats: OpenwaAdmissionStats = {
    discarded: 0,
    ownerActivity: 0,
    filtered: 0,
    admitted: 0,
    discoveries: 0,
    discoveryFailures: 0,
    quoteLookups: 0,
    approvalReplies: 0,
  };

  async function snapshotFor(runtime: OpenwaAdmissionRuntime): Promise<OpenwaPolicySnapshot | null> {
    return deps.policies.peek(runtime.endpointId) ?? deps.policies.get(runtime.companyId, runtime.endpointId);
  }

  async function audit(
    snapshot: OpenwaPolicySnapshot,
    input: {
      kind: "trigger_filtered" | "group_added" | "group_left";
      chatKey: string;
      actorKind: "chat_principal" | "system";
      actorRef: string | null;
      metadata: Record<string, unknown>;
      text?: string | null;
    },
  ) {
    const occurredAt = new Date(now());
    await db.insert(chatAuditEntries).values({
      companyId: snapshot.companyId,
      endpointId: snapshot.endpointId,
      chatKey: input.chatKey,
      kind: input.kind,
      actorKind: input.actorKind,
      actorRef: input.actorRef,
      metadata: input.metadata,
      ...auditContent(input.text, snapshot.policy.auditContentRetentionDays, occurredAt),
      occurredAt,
    });
  }

  async function learnLid(snapshot: OpenwaPolicySnapshot, event: OpenwaInboundEvent): Promise<void> {
    if (!event.isLidSender || !event.senderPhone) return;
    const lid = event.senderJid.trim().toLowerCase();
    const digits = event.senderPhone.replace(/\D/g, "");
    if (!lid.endsWith("@lid") || !digits) return;
    const key = snapshot.endpointId + "\u0000" + lid;
    if (learnedLids.has(key)) return;
    const updated = await db
      .update(chatExternalPrincipals)
      .set({
        alternateExternalIds: sql`array_append(${chatExternalPrincipals.alternateExternalIds}, ${lid}::text)`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(chatExternalPrincipals.companyId, snapshot.companyId),
          eq(chatExternalPrincipals.provider, "openwa"),
          eq(chatExternalPrincipals.externalId, digits + "@c.us"),
          sql`not (${lid}::text = any(${chatExternalPrincipals.alternateExternalIds}))`,
        ),
      )
      .returning({ id: chatExternalPrincipals.id });
    const owner = snapshot.ownerByJid.get(digits + "@c.us");
    if (owner) openwaLearnOwnerLid(snapshot, owner, lid);
    if (!updated.length && !owner) return;
    if (learnedLids.size >= LEARNED_LID_CAP) {
      const oldest = learnedLids.values().next().value;
      if (oldest !== undefined) learnedLids.delete(oldest);
    }
    learnedLids.add(key);
  }

  async function resolveLid(runtime: OpenwaAdmissionRuntime, snapshot: OpenwaPolicySnapshot, digits: string): Promise<string | null> {
    const key = snapshot.endpointId + "\u0000" + digits;
    const known = resolvedLids.get(key);
    if (known || (lidRetryAt.get(key) ?? 0) > now()) return known ?? null;
    const gateway = runtime.adapter()?.gateway ?? null;
    if (!gateway) return null;
    let lookup = lidLookups.get(key);
    if (!lookup) {
      lookup = gateway
        .checkNumber(digits)
        .then(
          (check) => {
            const found = check.whatsappId?.trim().toLowerCase() ?? "";
            if (found.endsWith("@lid")) resolvedLids.set(key, found);
            else lidRetryAt.set(key, now() + DISCOVERY_RETRY_MS);
          },
          () => {
            lidRetryAt.set(key, now() + DISCOVERY_RETRY_MS);
          },
        )
        .finally(() => lidLookups.delete(key));
      lidLookups.set(key, lookup);
    }
    await lookup;
    return resolvedLids.get(key) ?? null;
  }

  /** Adds the agent's and owners' WhatsApp LIDs to the snapshot so LID-addressed groups recognise their mentions and joins. */
  async function ensureLids(runtime: OpenwaAdmissionRuntime, snapshot: OpenwaPolicySnapshot): Promise<void> {
    const pending: Promise<void>[] = [];
    if (!snapshot.agentLids.size && snapshot.agentDigits)
      pending.push(
        resolveLid(runtime, snapshot, snapshot.agentDigits).then((lid) => {
          if (lid) snapshot.agentLids.add(lid);
        }),
      );
    for (const owner of snapshot.owners)
      if (!owner.lids.size && owner.digits)
        pending.push(
          resolveLid(runtime, snapshot, owner.digits).then((lid) => {
            if (lid) openwaLearnOwnerLid(snapshot, owner, lid);
          }),
        );
    if (pending.length) await Promise.all(pending);
  }

  async function discoverGroup(
    runtime: OpenwaAdmissionRuntime,
    snapshot: OpenwaPolicySnapshot,
    chatId: string,
    options: { force?: boolean } = {},
  ): Promise<boolean> {
    const chatKey = openwaChatKey(chatId);
    const key = runtime.endpointId + "\u0000" + chatKey;
    const inFlight = discoveries.get(key);
    if (inFlight) return inFlight;
    if (!options.force && (discoveryFailures.get(key) ?? 0) > now()) return false;
    const gateway = runtime.adapter()?.gateway ?? null;
    if (!gateway) return false;
    const promise = (async () => {
      try {
        await upsertGroup(runtime, snapshot, gateway, chatKey);
        discoveryFailures.delete(key);
        stats.discoveries++;
        return true;
      } catch {
        stats.discoveryFailures++;
        if (discoveryFailures.size >= OPENWA_DISCOVERED_GROUP_CAP) {
          const oldest = discoveryFailures.keys().next().value;
          if (oldest !== undefined) discoveryFailures.delete(oldest);
        }
        discoveryFailures.set(key, now() + DISCOVERY_RETRY_MS);
        return false;
      } finally {
        discoveries.delete(key);
      }
    })();
    discoveries.set(key, promise);
    return promise;
  }

  async function upsertGroup(
    runtime: OpenwaAdmissionRuntime,
    snapshot: OpenwaPolicySnapshot,
    gateway: OpenwaGatewayClient,
    chatKey: string,
  ) {
    const group = await gateway.getGroup(chatKey);
    const participants = openwaParticipantJids(group.participants ?? []);
    const ownerPresent = openwaOwnerAmong(snapshot, participants);
    const label = (group.name || chatKey).slice(0, 512);
    const autoEnabled = openwaGroupEnabled(snapshot.policy, { activation: "auto" }, ownerPresent);
    const providerResourceId = openwaThreadId({ sessionId: runtime.sessionId, chatId: chatKey, isGroup: true });
    const metadata = { chatKey, groupName: group.name ?? null, participants, ownerPresent, participantCount: group.participants?.length ?? participants.length };
    const [row] = await db
      .insert(chatEndpointResources)
      .values({
        companyId: runtime.companyId,
        endpointId: runtime.endpointId,
        type: "group_chat",
        providerResourceId,
        label,
        availability: "available",
        enabled: autoEnabled,
        metadata,
      })
      .onConflictDoUpdate({
        target: [chatEndpointResources.endpointId, chatEndpointResources.type, chatEndpointResources.providerResourceId],
        set: {
          label,
          availability: "available",
          metadata: sql`${chatEndpointResources.metadata} || ${JSON.stringify(metadata)}::jsonb`,
          enabled: sql`case coalesce(${chatEndpointResources.settings}->>'activation', 'auto') when 'on' then true when 'off' then false else ${autoEnabled} end`,
          updatedAt: new Date(),
        },
      })
      .returning();
    const existing = snapshot.chats.get(chatKey);
    openwaRememberChat(snapshot, chatKey, {
      resourceId: row.id,
      chatId: chatKey,
      isGroup: true,
      settings: existing?.settings ?? openwaChatSettings(snapshot, chatKey),
      ownerPresent,
      participants: participants.slice(0, OPENWA_GROUP_PARTICIPANT_CAP),
      available: true,
      label,
    });
    return { label, participantCount: metadata.participantCount, ownerPresent };
  }

  async function quotedFromAgent(snapshot: OpenwaPolicySnapshot, event: OpenwaInboundEvent): Promise<boolean> {
    if (!event.quoted) return false;
    if (deps.outbound.lookup(snapshot.endpointId, event.quoted.id)) return true;
    if (!openwaQuoteMayAddressAgent(event, snapshot)) return false;
    stats.quoteLookups++;
    return (await deps.outbound.lookupStored(snapshot.companyId, snapshot.endpointId, event.quoted.id)) !== null;
  }

  async function admitApprovalReply(
    runtime: OpenwaAdmissionRuntime,
    snapshot: OpenwaPolicySnapshot,
    event: OpenwaInboundEvent,
    candidate: OpenwaApprovalReplyCandidate,
  ): Promise<boolean> {
    const { quotedMessageId, owner } = candidate;
    let outbound = deps.outbound.lookup(snapshot.endpointId, quotedMessageId);
    if (!outbound) {
      stats.quoteLookups++;
      outbound = await deps.outbound.lookupStored(snapshot.companyId, snapshot.endpointId, quotedMessageId);
    }
    if (!outbound || outbound.source !== "approval") return false;
    const bubble = await findOpenwaApprovalBubble(db, outbound);
    if (!bubble) return false;
    if (event.isLidSender && event.senderPhone && !owner.lids.has(event.senderJid.toLowerCase())) await learnLid(snapshot, event);
    const adapter = runtime.adapter();
    if (!adapter) throw new Error("OpenWA adapter unavailable for admission");
    const decoration: OpenwaAdmissionDecoration = {
      version: 1,
      event: "approval_reply",
      triggerClass: "owner",
      principalRole: "owner",
      rules: [],
      addressed: true,
      control: null,
      chatKey: event.chatKey,
      chatId: event.chatKey,
      chatKind: event.chatKind,
      waMessageId: event.waMessageId,
      dedupeKey: event.dedupeKey,
      phoneTyped: event.phoneTyped,
      sender: { jid: event.senderJid, phone: event.senderPhone, name: senderName(event) },
      quoted: { id: quotedMessageId, body: event.quoted?.body ?? null, fromAgent: true },
      mentionedIds: [...event.mentionedIds],
      location: event.location,
      contact: event.contact,
      media: event.media ? { ...event.media } : null,
      group: null,
      approval: { requestId: bubble.requestId, requestStatus: bubble.requestStatus },
    };
    const threadId = openwaThreadId({ sessionId: runtime.sessionId, chatId: event.chatKey, isGroup: event.chatKind === "group" });
    const message = adapter.parseMessage({ ...event, chatId: event.chatKey });
    stats.approvalReplies++;
    stats.admitted++;
    await runtime.admit({ threadId, message, trigger: triggerFor(event.chatKind, true), decoration });
    return true;
  }

  async function onInbound(runtime: OpenwaAdmissionRuntime, event: OpenwaInboundEvent, ctx: OpenwaInboundContext): Promise<void> {
    const snapshot = await snapshotFor(runtime);
    if (!snapshot) {
      stats.discarded++;
      return;
    }
    const approvalCandidate = detectApprovalReply(event, snapshot);
    if (approvalCandidate && (await admitApprovalReply(runtime, snapshot, event, approvalCandidate))) return;
    if (event.chatKind === "group" && (event.mentionedIds.length || event.body.includes("@") || event.quoted)) await ensureLids(runtime, snapshot);
    const fromAgent = event.quoted ? await quotedFromAgent(snapshot, event) : false;
    const facts = { quotedFromAgent: fromAgent };
    if (event.chatKind === "group" && !snapshot.chats.has(event.chatKey)) {
      const discovery = discoverGroup(runtime, snapshot, event.chatKey);
      if (openwaTriggerCandidate(event, snapshot, facts)) {
        let timer: NodeJS.Timeout | undefined;
        await Promise.race([
          discovery,
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), discoveryWaitMs);
          }),
        ]);
        if (timer) clearTimeout(timer);
      } else void discovery;
    }
    const classification = classifyOpenwaEvent(event, snapshot, facts);
    const owner = classification.kind === "owner_activity" || classification.kind === "trigger" ? openwaSenderOwner(snapshot, event) : null;
    if (owner) {
      if (event.isLidSender && event.senderPhone && !owner.lids.has(event.senderJid.toLowerCase())) await learnLid(snapshot, event);
      await deps.timers?.onOwnerActivity?.(event.chatKey, event, ctx);
    }
    switch (classification.kind) {
      case "discard":
        stats.discarded++;
        if (classification.armsAbsence) await deps.timers?.onAbsenceCandidate?.(event, ctx);
        return;
      case "owner_activity":
        stats.ownerActivity++;
        return;
      case "filtered":
        stats.filtered++;
        await audit(snapshot, {
          kind: "trigger_filtered",
          chatKey: event.chatKey,
          actorKind: "chat_principal",
          actorRef: openwaPrincipalExternalId(event.senderJid, event.senderPhone),
          metadata: {
            reason: classification.reason,
            principalRole: classification.principalRole,
            rules: classification.rules,
            chatKind: event.chatKind,
            waMessageId: event.waMessageId,
            senderMasked: event.senderPhone ? maskOpenwaPhoneNumber(event.senderPhone) : null,
            source: event.source,
          },
          text: event.body,
        });
        return;
      case "trigger":
        break;
    }
    await learnLid(snapshot, event);
    const adapter = runtime.adapter();
    if (!adapter) throw new Error("OpenWA adapter unavailable for admission");
    const decoration = openwaInboundDecoration(event, {
      triggerClass: classification.triggerClass,
      principalRole: classification.principalRole,
      rules: classification.rules,
      addressed: classification.addressed,
      control: classification.control,
      quotedFromAgent: fromAgent,
    });
    stats.admitted++;
    await runtime.admit(openwaAdmitInput(runtime, adapter, event, decoration));
  }

  async function groupAddedWake(
    runtime: OpenwaAdmissionRuntime,
    snapshot: OpenwaPolicySnapshot,
    event: OpenwaGroupEvent,
    discovered: { label: string; participantCount: number },
  ) {
    const chatKey = openwaChatKey(event.groupId);
    const actor = event.actorId ? event.actorId.trim().toLowerCase() : null;
    const actorDigits = actor ? openwaDigits(actor) : null;
    const actorOwner = actor ? (snapshot.ownerByJid.get(actor) ?? null) : null;
    const principalRole = openwaSenderRole(snapshot, actorOwner, actorDigits);
    const actorMasked = actorDigits ? maskOpenwaPhoneNumber(actorDigits) : null;
    const timestamp = event.timestamp ?? Math.floor(now() / 1000);
    const messageId = "group_added:" + timestamp;
    const threadId = openwaThreadId({ sessionId: runtime.sessionId, chatId: chatKey, isGroup: true });
    const text =
      "The WhatsApp number was added to the group " +
      JSON.stringify(discovered.label) +
      (actorMasked ? " by " + actorMasked : "") +
      " (" +
      discovered.participantCount +
      " participants). The group is inactive: no owner is a participant.";
    const authorId = actor ?? chatKey;
    const message = new Message({
      id: messageId,
      threadId,
      text,
      formatted: parseMarkdown(text),
      raw: {},
      attachments: [],
      author: { userId: authorId, userName: actorMasked ?? authorId, fullName: actorMasked ?? authorId, isBot: false, isMe: false },
      metadata: { dateSent: new Date(timestamp * 1000), edited: false },
    });
    await runtime.admit({
      threadId,
      message,
      trigger: "unaddressed_message",
      decoration: {
        version: 1,
        event: "group_added",
        triggerClass: "other",
        principalRole,
        rules: [],
        addressed: false,
        control: null,
        chatKey,
        chatId: chatKey,
        chatKind: "group",
        waMessageId: null,
        dedupeKey: "openwa:" + runtime.sessionId + ":group_added:" + chatKey + ":" + timestamp,
        phoneTyped: false,
        sender: { jid: authorId, phone: actorDigits, name: null },
        quoted: null,
        mentionedIds: [],
        location: null,
        contact: null,
        media: null,
        group: { name: discovered.label, participantCount: discovered.participantCount, actorMasked },
      },
    });
  }

  async function markGroupLeft(runtime: OpenwaAdmissionRuntime, snapshot: OpenwaPolicySnapshot, event: OpenwaGroupEvent) {
    const chatKey = openwaChatKey(event.groupId);
    const providerResourceId = openwaThreadId({ sessionId: runtime.sessionId, chatId: chatKey, isGroup: true });
    await db
      .update(chatEndpointResources)
      .set({ availability: "unavailable", enabled: false, updatedAt: new Date() })
      .where(
        and(
          eq(chatEndpointResources.companyId, runtime.companyId),
          eq(chatEndpointResources.endpointId, runtime.endpointId),
          eq(chatEndpointResources.type, "group_chat"),
          eq(chatEndpointResources.providerResourceId, providerResourceId),
        ),
      );
    const existing = snapshot.chats.get(chatKey);
    if (existing) existing.available = false;
    await audit(snapshot, {
      kind: "group_left",
      chatKey,
      actorKind: "system",
      actorRef: event.actorId,
      metadata: { groupId: chatKey },
    });
  }

  async function onGroup(runtime: OpenwaAdmissionRuntime, event: OpenwaGroupEvent): Promise<void> {
    const snapshot = await snapshotFor(runtime);
    if (!snapshot) return;
    const chatKey = openwaChatKey(event.groupId);
    if (event.participantIds.some((id) => id.trim().toLowerCase().endsWith("@lid"))) await ensureLids(runtime, snapshot);
    const self = event.participantIds.some((id) => {
      const lower = id.trim().toLowerCase();
      return lower === snapshot.agentJid || snapshot.agentLids.has(lower) || openwaDigits(lower) === snapshot.agentDigits;
    });
    if (event.event === "group.leave" && self) {
      await markGroupLeft(runtime, snapshot, event);
      return;
    }
    const added = event.event === "group.join" && self;
    const gateway = runtime.adapter()?.gateway ?? null;
    if (!gateway) return;
    const discovered = await upsertGroup(runtime, snapshot, gateway, chatKey).catch(() => null);
    if (!discovered) return;
    if (!added) return;
    const active = openwaGroupEnabled(snapshot.policy, openwaChatSettings(snapshot, chatKey), discovered.ownerPresent);
    await audit(snapshot, {
      kind: "group_added",
      chatKey,
      actorKind: "system",
      actorRef: event.actorId,
      metadata: { groupId: chatKey, active, participantCount: discovered.participantCount, ownerPresent: discovered.ownerPresent },
    });
    if (!active && snapshot.policy.numberMode === "agent_number" && openwaChatSettings(snapshot, chatKey).activation === "auto")
      await groupAddedWake(runtime, snapshot, event, discovered);
  }

  async function refreshGroups(runtime: OpenwaAdmissionRuntime): Promise<number> {
    const snapshot = await snapshotFor(runtime);
    const gateway = runtime.adapter()?.gateway ?? null;
    if (!snapshot || !gateway) return 0;
    let refreshed = 0;
    for (const [chatKey, chat] of [...snapshot.chats]) {
      if (!chat.isGroup || !chat.available) continue;
      if (await upsertGroup(runtime, snapshot, gateway, chatKey).then(() => true, () => false)) refreshed++;
    }
    return refreshed;
  }

  return {
    stats,
    refreshGroups,
    hooks(runtime: OpenwaAdmissionRuntime): OpenwaIngressHooks {
      return {
        onInbound: (event, ctx) => onInbound(runtime, event, ctx),
        onGroup: (event) => onGroup(runtime, event),
      };
    },
  };
}

export type OpenwaAdmission = ReturnType<typeof createOpenwaAdmission>;
