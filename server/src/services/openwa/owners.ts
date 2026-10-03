import { and, asc, desc, eq, inArray, ne, notInArray, or, sql } from "drizzle-orm";
import {
  chatAuditEntries,
  chatEndpointOwners,
  chatEndpointResources,
  chatEndpoints,
  chatExternalPrincipals,
  chatIdentityLinks,
  chatOwnerGrants,
  chatSenderRules,
  companyMemberships,
  toolConnections,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import {
  maskOpenwaPhoneNumber,
  openwaChatSettingsSchema,
  openwaEndpointPolicySchema,
  type OpenwaChatSettings,
  type OpenwaEndpointHealth,
  type OpenwaPrincipalRole,
  type OpenwaTriggerClass,
} from "@tickernelz/paperclip-pro-shared";
import { badRequest, conflict, notFound, unprocessable } from "../../errors.js";
import { logActivity, publishActivity, type ActivityPublication } from "../activity-log.js";
import { openwaThreadId, parseOpenwaThreadId } from "./adapter.js";
import type { OpenwaGatewayClient } from "./gateway.js";
import { openwaChatKey } from "./outbound.js";
import { loadOpenwaPolicySnapshot, openwaDigits, openwaGroupEnabled } from "./policy.js";
import { openwaPhoneDigits, openwaSetupError } from "./setup.js";
import { OPENWA_GATEWAY_VERSION } from "@tickernelz/paperclip-pro-shared/openwa-operations";

type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type DbOrTransaction = Db | DbTransaction;
type EndpointRow = typeof chatEndpoints.$inferSelect;

export interface OpenwaPrincipalAuthorization {
  allowed: boolean;
  userId: string | null;
  role: OpenwaPrincipalRole;
  triggerClass: OpenwaTriggerClass;
  ownerId: string | null;
}

export interface OpenwaOwnerView {
  id: string;
  identityLinkId: string;
  principalId: string;
  numberMasked: string;
  displayName: string | null;
  linkStatus: string;
  paperclipUserId: string | null;
  effective: boolean;
  createdAt: string;
}

export interface OpenwaSenderRuleView {
  id: string;
  list: "allow" | "deny";
  e164: string;
  label: string | null;
  createdAt: string;
}

export interface OpenwaChatView {
  id: string;
  chatId: string;
  chatKey: string;
  type: string;
  label: string;
  availability: string;
  enabled: boolean;
  settings: OpenwaChatSettings;
  ownerPresent: boolean | null;
  participantCount: number | null;
}

function sessionOf(endpoint: Pick<EndpointRow, "providerAccountId">): string {
  const account = endpoint.providerAccountId ?? "";
  return account.slice(account.lastIndexOf("#") + 1);
}

export function openwaRoleWithoutOwner(
  policy: { senderPolicyMode: "all" | "allowlist" | "denylist" },
  rules: ReadonlyArray<{ list: string }>,
  digits: string | null,
): OpenwaPrincipalRole {
  if (!digits) return "outside_allowlist";
  if (rules.some((rule) => rule.list === "deny")) return "denylisted";
  if (policy.senderPolicyMode === "allowlist") return rules.some((rule) => rule.list === "allow") ? "allowed" : "outside_allowlist";
  return "allowed";
}

export async function openwaCurrentOwnerUserId(
  database: DbOrTransaction,
  endpoint: Pick<EndpointRow, "companyId" | "id">,
  principalId: string,
  lock = false,
): Promise<{ userId: string | null; ownerId: string | null }> {
  const query = database
    .select({
      ownerId: chatEndpointOwners.id,
      status: chatIdentityLinks.status,
      userId: chatIdentityLinks.paperclipUserId,
    })
    .from(chatEndpointOwners)
    .innerJoin(
      chatIdentityLinks,
      and(eq(chatIdentityLinks.companyId, chatEndpointOwners.companyId), eq(chatIdentityLinks.id, chatEndpointOwners.identityLinkId)),
    )
    .where(
      and(
        eq(chatEndpointOwners.companyId, endpoint.companyId),
        eq(chatEndpointOwners.endpointId, endpoint.id),
        eq(chatIdentityLinks.endpointId, endpoint.id),
        eq(chatIdentityLinks.principalId, principalId),
      ),
    )
    .limit(1);
  const [owner] = lock ? await query.for("update", { of: chatIdentityLinks }) : await query;
  if (!owner || owner.status !== "linked" || !owner.userId) return { userId: null, ownerId: null };
  const membershipQuery = database
    .select({ status: companyMemberships.status, role: companyMemberships.membershipRole })
    .from(companyMemberships)
    .where(
      and(
        eq(companyMemberships.companyId, endpoint.companyId),
        eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, owner.userId),
      ),
    )
    .limit(1);
  const [membership] = lock ? await membershipQuery.for("update") : await membershipQuery;
  if (membership?.status !== "active" || membership.role === "viewer") return { userId: null, ownerId: null };
  return { userId: owner.userId, ownerId: owner.ownerId };
}

export async function openwaPrincipalAuthorization(
  tx: DbOrTransaction,
  endpoint: Pick<EndpointRow, "companyId" | "id" | "policy" | "status">,
  principalId: string,
  context: { isDirectMessage?: boolean } = {},
): Promise<OpenwaPrincipalAuthorization> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`chat-identity:${endpoint.companyId}:${principalId}`}, 0))`);
  const [principal] = await tx
    .select({ externalId: chatExternalPrincipals.externalId })
    .from(chatExternalPrincipals)
    .where(and(eq(chatExternalPrincipals.companyId, endpoint.companyId), eq(chatExternalPrincipals.id, principalId)))
    .limit(1);
  const denied: OpenwaPrincipalAuthorization = { allowed: false, userId: null, role: "outside_allowlist", triggerClass: "other", ownerId: null };
  if (!principal) return denied;
  const owner = await openwaCurrentOwnerUserId(tx, endpoint, principalId, true);
  const digits = openwaDigits(principal.externalId);
  const rules = digits
    ? await tx
        .select({ list: chatSenderRules.list })
        .from(chatSenderRules)
        .where(
          and(
            eq(chatSenderRules.companyId, endpoint.companyId),
            eq(chatSenderRules.endpointId, endpoint.id),
            eq(chatSenderRules.e164, "+" + digits),
          ),
        )
    : [];
  const policy = openwaEndpointPolicySchema.parse(endpoint.policy ?? {});
  const role: OpenwaPrincipalRole = owner.userId ? "owner" : openwaRoleWithoutOwner(policy, rules, digits);
  const allowed =
    role !== "denylisted" &&
    !(context.isDirectMessage === true && role === "outside_allowlist") &&
    !(endpoint.status === "verifying" && role !== "owner");
  return { allowed, userId: owner.userId, role, triggerClass: role === "owner" ? "owner" : "other", ownerId: owner.ownerId };
}

export interface OpenwaCurrentOwner {
  ownerId: string;
  principalId: string;
  userId: string;
  digits: string | null;
}

/** Current owners: linked identity and active, non-viewer company membership. */
export async function openwaCurrentOwners(
  database: DbOrTransaction,
  endpoint: Pick<EndpointRow, "companyId" | "id">,
): Promise<OpenwaCurrentOwner[]> {
  const rows = await database
    .select({
      ownerId: chatEndpointOwners.id,
      principalId: chatIdentityLinks.principalId,
      userId: chatIdentityLinks.paperclipUserId,
      externalId: chatExternalPrincipals.externalId,
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
        eq(chatEndpointOwners.companyId, endpoint.companyId),
        eq(chatEndpointOwners.endpointId, endpoint.id),
        eq(chatIdentityLinks.endpointId, endpoint.id),
        eq(chatIdentityLinks.status, "linked"),
        eq(companyMemberships.status, "active"),
        sql`coalesce(${companyMemberships.membershipRole}, '') <> 'viewer'`,
      ),
    );
  return rows
    .filter((row): row is typeof row & { userId: string } => typeof row.userId === "string" && row.userId.length > 0)
    .map((row) => ({ ownerId: row.ownerId, principalId: row.principalId, userId: row.userId, digits: openwaDigits(row.externalId) }));
}

export async function revokeOpenwaGrantsOfFormerOwners(
  tx: DbOrTransaction,
  endpoint: Pick<EndpointRow, "companyId" | "id">,
  actorUserId: string | null,
): Promise<string[]> {
  const current = [...new Set((await openwaCurrentOwners(tx, endpoint)).map((owner) => owner.userId))];
  const revoked = await tx
    .update(chatOwnerGrants)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(
      and(
        eq(chatOwnerGrants.companyId, endpoint.companyId),
        eq(chatOwnerGrants.endpointId, endpoint.id),
        eq(chatOwnerGrants.status, "live"),
        current.length
          ? or(sql`${chatOwnerGrants.approvedByUserId} is null`, notInArray(chatOwnerGrants.approvedByUserId, current))
          : undefined,
      ),
    )
    .returning({ id: chatOwnerGrants.id });
  const ids = revoked.map((grant) => grant.id);
  if (ids.length)
    await logActivity(tx as unknown as Db, {
      companyId: endpoint.companyId,
      actorType: actorUserId ? "user" : "system",
      actorId: actorUserId ?? "openwa",
      action: "openwa.grant_revoked",
      entityType: "chat_endpoint",
      entityId: endpoint.id,
      details: { grantIds: ids, reason: "approver_no_longer_owner", endpointId: endpoint.id, provider: "openwa" },
    });
  return ids;
}

export async function bumpOpenwaPolicyRevision(tx: DbOrTransaction, endpoint: Pick<EndpointRow, "companyId" | "id">): Promise<void> {
  await tx
    .update(chatEndpoints)
    .set({ policyRevision: sql`${chatEndpoints.policyRevision} + 1`, updatedAt: new Date() })
    .where(and(eq(chatEndpoints.companyId, endpoint.companyId), eq(chatEndpoints.id, endpoint.id), eq(chatEndpoints.provider, "openwa")));
}

export async function syncOpenwaGroupActivation(tx: DbOrTransaction, endpoint: Pick<EndpointRow, "companyId" | "id">): Promise<void> {
  const snapshot = await loadOpenwaPolicySnapshot(tx, endpoint.companyId, endpoint.id);
  if (!snapshot) return;
  const jids = [...snapshot.ownerByJid.keys()];
  const participants = sql`coalesce(${chatEndpointResources.metadata}->'participants', '[]'::jsonb)`;
  const present = jids.length
    ? sql`(${participants} ?| array[${sql.join(
        jids.map((jid) => sql`${jid}`),
        sql`, `,
      )}]::text[])`
    : sql`false`;
  const agentNumber = snapshot.policy.numberMode === "agent_number";
  await tx
    .update(chatEndpointResources)
    .set({
      enabled: sql`case coalesce(${chatEndpointResources.settings}->>'activation', 'auto') when 'on' then true when 'off' then false else (${agentNumber}::boolean and ${present}) end`,
      metadata: sql`${chatEndpointResources.metadata} || jsonb_build_object('ownerPresent', ${present})`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(chatEndpointResources.companyId, endpoint.companyId),
        eq(chatEndpointResources.endpointId, endpoint.id),
        eq(chatEndpointResources.type, "group_chat"),
        eq(chatEndpointResources.availability, "available"),
      ),
    );
}

export interface OpenwaOwnerServiceDeps {
  createLinkIntent(endpointId: string, principalId: string, expiresInSeconds: number): Promise<{ confirmationUrl: string; expiresAt: string }>;
  gatewayFor(endpoint: EndpointRow): Promise<{ client: OpenwaGatewayClient; baseUrl: string }>;
  invalidate(endpointId: string): void;
}

function mergePolicy(stored: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...stored };
  for (const [key, value] of Object.entries(patch)) {
    const current = merged[key];
    merged[key] =
      value && typeof value === "object" && !Array.isArray(value) && current && typeof current === "object" && !Array.isArray(current)
        ? { ...(current as Record<string, unknown>), ...(value as Record<string, unknown>) }
        : value;
  }
  if (patch.numberMode !== undefined && patch.numberMode !== stored.numberMode && patch.triggers === undefined) delete merged.triggers;
  return merged;
}

function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).sort();
}

export function openwaOwnerService(db: Db, deps: OpenwaOwnerServiceDeps) {
  async function endpointFor(endpointId: string): Promise<EndpointRow> {
    const [endpoint] = await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, endpointId));
    if (!endpoint) throw notFound("Chat endpoint not found");
    if (endpoint.provider !== "openwa") throw badRequest("This action is only valid for OpenWA endpoints");
    if (endpoint.status === "archived") throw conflict("This channel was removed");
    return endpoint;
  }

  async function audit(
    tx: DbTransaction,
    endpoint: EndpointRow,
    actorUserId: string | null,
    action: string,
    details: Record<string, unknown>,
    publications: ActivityPublication[],
  ) {
    await logActivity(
      tx as unknown as Db,
      {
        companyId: endpoint.companyId,
        actorType: actorUserId ? "user" : "system",
        actorId: actorUserId ?? "board",
        action,
        entityType: "chat_endpoint",
        entityId: endpoint.id,
        details: { endpointId: endpoint.id, provider: "openwa", ...details },
      },
      publications,
    );
  }

  async function mutate<T>(endpoint: EndpointRow, run: (tx: DbTransaction, publications: ActivityPublication[]) => Promise<T>): Promise<T> {
    const publications: ActivityPublication[] = [];
    const result = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ status: chatEndpoints.status })
        .from(chatEndpoints)
        .where(and(eq(chatEndpoints.companyId, endpoint.companyId), eq(chatEndpoints.id, endpoint.id)))
        .for("update");
      if (!locked || locked.status === "archived") throw conflict("This channel was removed");
      const value = await run(tx, publications);
      await bumpOpenwaPolicyRevision(tx, endpoint);
      await syncOpenwaGroupActivation(tx, endpoint);
      return value;
    });
    deps.invalidate(endpoint.id);
    for (const publication of publications) publishActivity(publication);
    return result;
  }

  async function listOwners(endpointId: string): Promise<OpenwaOwnerView[]> {
    const endpoint = await endpointFor(endpointId);
    const rows = await db
      .select({
        id: chatEndpointOwners.id,
        identityLinkId: chatEndpointOwners.identityLinkId,
        principalId: chatIdentityLinks.principalId,
        externalId: chatExternalPrincipals.externalId,
        displayName: chatExternalPrincipals.displayName,
        linkStatus: chatIdentityLinks.status,
        paperclipUserId: chatIdentityLinks.paperclipUserId,
        membershipStatus: companyMemberships.status,
        membershipRole: companyMemberships.membershipRole,
        createdAt: chatEndpointOwners.createdAt,
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
      .leftJoin(
        companyMemberships,
        and(
          eq(companyMemberships.companyId, chatEndpointOwners.companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, chatIdentityLinks.paperclipUserId),
        ),
      )
      .where(and(eq(chatEndpointOwners.companyId, endpoint.companyId), eq(chatEndpointOwners.endpointId, endpoint.id)))
      .orderBy(asc(chatEndpointOwners.createdAt));
    return rows.map((row) => ({
      id: row.id,
      identityLinkId: row.identityLinkId,
      principalId: row.principalId,
      numberMasked: maskOpenwaPhoneNumber(openwaDigits(row.externalId) ?? ""),
      displayName: row.displayName,
      linkStatus: row.linkStatus,
      paperclipUserId: row.paperclipUserId,
      effective: row.linkStatus === "linked" && row.membershipStatus === "active" && row.membershipRole !== "viewer",
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async function addOwner(endpointId: string, input: { e164: string; expiresInSeconds: number }, actorUserId: string | null) {
    const endpoint = await endpointFor(endpointId);
    if (!endpoint.providerAccountId) throw unprocessable("Connect the OpenWA gateway before adding owners", { code: "openwa_session_required" });
    const digits = openwaDigits(input.e164);
    if (!digits) throw unprocessable("Use an E.164 number such as +6281234567890");
    const [principal] = await db
      .insert(chatExternalPrincipals)
      .values({
        companyId: endpoint.companyId,
        provider: "openwa",
        providerAccountId: endpoint.providerAccountId,
        externalId: digits + "@c.us",
        kind: "user",
        displayName: maskOpenwaPhoneNumber(digits),
        handle: maskOpenwaPhoneNumber(digits),
        isBot: false,
      })
      .onConflictDoUpdate({
        target: [
          chatExternalPrincipals.companyId,
          chatExternalPrincipals.provider,
          chatExternalPrincipals.providerAccountId,
          chatExternalPrincipals.externalId,
        ],
        set: { updatedAt: new Date() },
      })
      .returning({ id: chatExternalPrincipals.id });
    const [existingLink] = await db
      .select({ id: chatIdentityLinks.id, status: chatIdentityLinks.status })
      .from(chatIdentityLinks)
      .where(
        and(
          eq(chatIdentityLinks.companyId, endpoint.companyId),
          eq(chatIdentityLinks.endpointId, endpoint.id),
          eq(chatIdentityLinks.principalId, principal.id),
        ),
      );
    const intent = existingLink?.status === "linked" ? null : await deps.createLinkIntent(endpoint.id, principal.id, input.expiresInSeconds);
    const owner = await mutate(endpoint, async (tx, publications) => {
      const [link] = await tx
        .select({ id: chatIdentityLinks.id })
        .from(chatIdentityLinks)
        .where(
          and(
            eq(chatIdentityLinks.companyId, endpoint.companyId),
            eq(chatIdentityLinks.endpointId, endpoint.id),
            eq(chatIdentityLinks.principalId, principal.id),
          ),
        );
      if (!link) throw conflict("The owner's identity link changed; try again");
      const [inserted] = await tx
        .insert(chatEndpointOwners)
        .values({ companyId: endpoint.companyId, endpointId: endpoint.id, identityLinkId: link.id, addedByUserId: actorUserId })
        .onConflictDoNothing()
        .returning({ id: chatEndpointOwners.id });
      if (inserted)
        await audit(tx, endpoint, actorUserId, "openwa.owner_added", { ownerId: inserted.id, numberMasked: maskOpenwaPhoneNumber(digits) }, publications);
      return inserted ?? null;
    });
    const owners = await listOwners(endpoint.id);
    return {
      owner: owners.find((entry) => entry.principalId === principal.id) ?? null,
      created: owner !== null,
      confirmationUrl: intent?.confirmationUrl ?? null,
      expiresAt: intent?.expiresAt ?? null,
    };
  }

  async function removeOwner(endpointId: string, ownerId: string, actorUserId: string | null) {
    const endpoint = await endpointFor(endpointId);
    await mutate(endpoint, async (tx, publications) => {
      const [removed] = await tx
        .delete(chatEndpointOwners)
        .where(
          and(
            eq(chatEndpointOwners.companyId, endpoint.companyId),
            eq(chatEndpointOwners.endpointId, endpoint.id),
            eq(chatEndpointOwners.id, ownerId),
          ),
        )
        .returning({ id: chatEndpointOwners.id });
      if (!removed) throw notFound("Owner not found");
      await audit(tx, endpoint, actorUserId, "openwa.owner_removed", { ownerId }, publications);
      await revokeOpenwaGrantsOfFormerOwners(tx, endpoint, actorUserId);
    });
  }

  async function listSenderRules(endpointId: string): Promise<OpenwaSenderRuleView[]> {
    const endpoint = await endpointFor(endpointId);
    const rows = await db
      .select()
      .from(chatSenderRules)
      .where(and(eq(chatSenderRules.companyId, endpoint.companyId), eq(chatSenderRules.endpointId, endpoint.id)))
      .orderBy(asc(chatSenderRules.list), asc(chatSenderRules.e164));
    return rows.map((row) => ({ id: row.id, list: row.list, e164: row.e164, label: row.label, createdAt: row.createdAt.toISOString() }));
  }

  async function addSenderRule(endpointId: string, input: { list: "allow" | "deny"; e164: string; label?: string }, actorUserId: string | null) {
    const endpoint = await endpointFor(endpointId);
    const e164 = input.e164.trim();
    const rule = await mutate(endpoint, async (tx, publications) => {
      const [inserted] = await tx
        .insert(chatSenderRules)
        .values({
          companyId: endpoint.companyId,
          endpointId: endpoint.id,
          list: input.list,
          e164,
          label: input.label ?? null,
          createdByUserId: actorUserId,
        })
        .onConflictDoUpdate({
          target: [chatSenderRules.endpointId, chatSenderRules.list, chatSenderRules.e164],
          set: { label: input.label ?? null, updatedAt: new Date() },
        })
        .returning();
      await audit(
        tx,
        endpoint,
        actorUserId,
        "openwa.sender_rule_changed",
        { change: "added", ruleId: inserted.id, list: input.list, numberMasked: maskOpenwaPhoneNumber(e164) },
        publications,
      );
      return inserted;
    });
    return { id: rule.id, list: rule.list, e164: rule.e164, label: rule.label, createdAt: rule.createdAt.toISOString() };
  }

  async function removeSenderRule(endpointId: string, ruleId: string, actorUserId: string | null) {
    const endpoint = await endpointFor(endpointId);
    await mutate(endpoint, async (tx, publications) => {
      const [removed] = await tx
        .delete(chatSenderRules)
        .where(and(eq(chatSenderRules.companyId, endpoint.companyId), eq(chatSenderRules.endpointId, endpoint.id), eq(chatSenderRules.id, ruleId)))
        .returning();
      if (!removed) throw notFound("Sender rule not found");
      await audit(
        tx,
        endpoint,
        actorUserId,
        "openwa.sender_rule_changed",
        { change: "removed", ruleId, list: removed.list, numberMasked: maskOpenwaPhoneNumber(removed.e164) },
        publications,
      );
    });
  }

  function chatView(row: typeof chatEndpointResources.$inferSelect): OpenwaChatView | null {
    try {
      const thread = parseOpenwaThreadId(row.providerResourceId);
      const parsed = openwaChatSettingsSchema.safeParse(row.settings ?? {});
      const participants = Array.isArray(row.metadata.participants) ? row.metadata.participants.length : null;
      return {
        id: row.id,
        chatId: thread.chatId,
        chatKey: openwaChatKey(thread.chatId),
        type: row.type,
        label: row.label,
        availability: row.availability,
        enabled: row.enabled,
        settings: parsed.success ? parsed.data : { activation: "off" },
        ownerPresent: typeof row.metadata.ownerPresent === "boolean" ? row.metadata.ownerPresent : null,
        participantCount: participants,
      };
    } catch {
      return null;
    }
  }

  async function listChats(endpointId: string): Promise<OpenwaChatView[]> {
    const endpoint = await endpointFor(endpointId);
    const rows = await db
      .select()
      .from(chatEndpointResources)
      .where(
        and(
          eq(chatEndpointResources.companyId, endpoint.companyId),
          eq(chatEndpointResources.endpointId, endpoint.id),
          inArray(chatEndpointResources.type, ["direct_message", "group_chat"]),
          ne(chatEndpointResources.availability, "removed"),
        ),
      )
      .orderBy(asc(chatEndpointResources.label));
    return rows.flatMap((row) => {
      const view = chatView(row);
      return view ? [view] : [];
    });
  }

  async function putChat(
    endpointId: string,
    input: { chatId: string; label?: string; settings: OpenwaChatSettings },
    actorUserId: string | null,
  ): Promise<OpenwaChatView> {
    const endpoint = await endpointFor(endpointId);
    const sessionId = sessionOf(endpoint);
    if (!sessionId) throw unprocessable("Connect the OpenWA gateway before configuring chats", { code: "openwa_session_required" });
    const isGroup = input.chatId.endsWith("@g.us");
    const providerResourceId = openwaThreadId({ sessionId, chatId: input.chatId, isGroup });
    const type = isGroup ? "group_chat" : "direct_message";
    const policy = openwaEndpointPolicySchema.parse(endpoint.policy ?? {});
    const row = await mutate(endpoint, async (tx, publications) => {
      const [existing] = await tx
        .select()
        .from(chatEndpointResources)
        .where(
          and(
            eq(chatEndpointResources.companyId, endpoint.companyId),
            eq(chatEndpointResources.endpointId, endpoint.id),
            eq(chatEndpointResources.type, type),
            eq(chatEndpointResources.providerResourceId, providerResourceId),
          ),
        )
        .for("update");
      const before = existing ? openwaChatSettingsSchema.safeParse(existing.settings ?? {}) : null;
      const beforeSettings = before?.success ? before.data : { activation: "auto" as const };
      const enabled = isGroup
        ? openwaGroupEnabled(policy, input.settings, existing?.metadata.ownerPresent === true)
        : input.settings.activation !== "off";
      const [saved] = await tx
        .insert(chatEndpointResources)
        .values({
          companyId: endpoint.companyId,
          endpointId: endpoint.id,
          type,
          providerResourceId,
          label: input.label ?? existing?.label ?? input.chatId,
          availability: "available",
          enabled,
          settings: input.settings,
          metadata: { chatKey: openwaChatKey(input.chatId) },
        })
        .onConflictDoUpdate({
          target: [chatEndpointResources.endpointId, chatEndpointResources.type, chatEndpointResources.providerResourceId],
          set: {
            settings: input.settings,
            enabled,
            ...(input.label ? { label: input.label } : {}),
            updatedAt: new Date(),
          },
        })
        .returning();
      const changed = changedKeys(beforeSettings as unknown as Record<string, unknown>, input.settings as unknown as Record<string, unknown>);
      if (beforeSettings.activation !== input.settings.activation)
        await audit(
          tx,
          endpoint,
          actorUserId,
          "openwa.chat_activation_changed",
          { resourceId: saved.id, chatType: type, before: beforeSettings.activation, after: input.settings.activation },
          publications,
        );
      if (changed.some((key) => key !== "activation"))
        await audit(tx, endpoint, actorUserId, "openwa.config_changed", { scope: "chat", resourceId: saved.id, changed }, publications);
      return saved;
    });
    return chatView(row)!;
  }

  async function gatewayChats(endpointId: string, input: { limit: number; offset: number }) {
    const endpoint = await endpointFor(endpointId);
    const gateway = await deps.gatewayFor(endpoint);
    const result = await gateway.client
      .call("SessionController_getChats", { limit: String(input.limit), offset: String(input.offset) }, { timeoutMs: 15_000 })
      .catch((error: unknown) => {
        throw openwaSetupError(error, gateway.baseUrl);
      });
    const data = result.kind === "json" && Array.isArray(result.data) ? result.data : [];
    const configured = new Map((await listChats(endpoint.id)).map((chat) => [chat.chatKey, chat]));
    return data.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const chat = entry as Record<string, unknown>;
      const id = typeof chat.id === "string" ? chat.id : null;
      if (!id || !/@(c\.us|g\.us|lid)$/.test(id)) return [];
      const isGroup = id.endsWith("@g.us");
      const known = configured.get(openwaChatKey(id));
      return [
        {
          chatId: id,
          isGroup,
          name: typeof chat.name === "string" && chat.name ? chat.name : isGroup ? id : maskOpenwaPhoneNumber(id),
          lastActivityAt: typeof chat.timestamp === "number" ? new Date(chat.timestamp * 1000).toISOString() : null,
          activation: known?.settings.activation ?? "auto",
          configured: Boolean(known),
        },
      ];
    });
  }

  async function updatePolicy(endpointId: string, patch: Record<string, unknown>, actorUserId: string | null) {
    const endpoint = await endpointFor(endpointId);
    const stored = (endpoint.policy ?? {}) as Record<string, unknown>;
    const parsed = openwaEndpointPolicySchema.safeParse(mergePolicy(stored, patch));
    if (!parsed.success) throw unprocessable("Invalid OpenWA policy", { issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })) });
    const before = openwaEndpointPolicySchema.parse(stored);
    const changed = changedKeys(before as unknown as Record<string, unknown>, parsed.data as unknown as Record<string, unknown>);
    if (!changed.length) return { policy: before, policyRevision: endpoint.policyRevision };
    const revision = await mutate(endpoint, async (tx, publications) => {
      const [current] = await tx
        .select({ policy: chatEndpoints.policy })
        .from(chatEndpoints)
        .where(and(eq(chatEndpoints.companyId, endpoint.companyId), eq(chatEndpoints.id, endpoint.id)))
        .for("update");
      if (JSON.stringify(current?.policy ?? {}) !== JSON.stringify(stored))
        throw conflict("The OpenWA policy changed while saving; reload and try again", { code: "openwa_policy_conflict" });
      await tx
        .update(chatEndpoints)
        .set({ policy: parsed.data, updatedAt: new Date() })
        .where(and(eq(chatEndpoints.companyId, endpoint.companyId), eq(chatEndpoints.id, endpoint.id)));
      await audit(tx, endpoint, actorUserId, "openwa.config_changed", { scope: "endpoint", changed }, publications);
      return endpoint.policyRevision + 1;
    });
    return { policy: parsed.data, policyRevision: revision };
  }

  async function health(endpointId: string): Promise<OpenwaEndpointHealth> {
    const endpoint = await endpointFor(endpointId);
    const policy = openwaEndpointPolicySchema.parse(endpoint.policy ?? {});
    const [connection, pacingHit] = await Promise.all([
      db
        .select({ refs: toolConnections.credentialSecretRefs })
        .from(toolConnections)
        .where(and(eq(toolConnections.companyId, endpoint.companyId), eq(toolConnections.id, endpoint.connectionId)))
        .then((rows) => rows[0] ?? null),
      db
        .select({ occurredAt: chatAuditEntries.occurredAt })
        .from(chatAuditEntries)
        .where(
          and(
            eq(chatAuditEntries.companyId, endpoint.companyId),
            eq(chatAuditEntries.endpointId, endpoint.id),
            sql`${chatAuditEntries.metadata} @> '{"pacing":true}'::jsonb`,
          ),
        )
        .orderBy(desc(chatAuditEntries.occurredAt))
        .limit(1)
        .then((rows) => rows[0] ?? null),
    ]);
    const base: OpenwaEndpointHealth = {
      gatewayVersion: null,
      pinnedVersion: OPENWA_GATEWAY_VERSION,
      engine: null,
      session: { status: null, maskedNumber: null, restriction: null },
      pacing: { attested: policy.attestations.pacing, observedAt: pacingHit?.occurredAt.toISOString() ?? null },
      adminKeyConfigured: (connection?.refs ?? []).some((ref) => ref.configPath === "credentials.adminApiKey"),
      gatewayError: null,
      checkedAt: new Date().toISOString(),
    };
    if (!sessionOf(endpoint)) return { ...base, gatewayError: "Connect the OpenWA gateway first" };
    let gateway: { client: OpenwaGatewayClient; baseUrl: string };
    try {
      gateway = await deps.gatewayFor(endpoint);
    } catch (error) {
      return { ...base, gatewayError: error instanceof Error ? error.message : "The OpenWA gateway is not configured" };
    }
    const [version, validation, session] = await Promise.allSettled([
      gateway.client.openApiVersion(),
      gateway.client.validateKey("operator"),
      gateway.client.getSession(),
    ]);
    const failure = [validation, session].find((result) => result.status === "rejected");
    const restriction = session.status === "fulfilled" ? session.value.restriction : null;
    const digits = session.status === "fulfilled" ? openwaPhoneDigits(session.value.phone) : null;
    return {
      ...base,
      gatewayVersion: version.status === "fulfilled" ? version.value : null,
      engine: validation.status === "fulfilled" && typeof validation.value.engineType === "string" ? validation.value.engineType : null,
      session: {
        status: session.status === "fulfilled" && typeof session.value.status === "string" ? session.value.status : null,
        maskedNumber: digits ? maskOpenwaPhoneNumber(digits) : null,
        restriction:
          restriction && typeof restriction === "object"
            ? {
                active: restriction.active === true,
                kind: typeof restriction.kind === "string" ? restriction.kind : null,
                expiresAt: typeof restriction.expiresAt === "string" ? restriction.expiresAt : null,
              }
            : null,
      },
      gatewayError: failure?.status === "rejected" ? openwaSetupError(failure.reason, gateway.baseUrl).message : null,
    };
  }

  return {
    health,
    listOwners,
    addOwner,
    removeOwner,
    listSenderRules,
    addSenderRule,
    removeSenderRule,
    listChats,
    putChat,
    gatewayChats,
    updatePolicy,
  };
}

export type OpenwaOwnerService = ReturnType<typeof openwaOwnerService>;
