import { and, desc, eq, sql } from "drizzle-orm";
import { chatActions, chatEndpoints, type Db } from "@tickernelz/wardmote-db";
import { openwaEndpointPolicySchema, type PendingDecisionChatOrigin, type PendingDecisionChatRoute } from "@tickernelz/wardmote-shared";
import { parseOpenwaThreadId } from "./adapter.js";
import { openwaChatKey } from "./outbound.js";
import { openwaChatResource, openwaOwnerReportRoute } from "./owner-report.js";
import { openwaCurrentOwners, type OpenwaCurrentOwner } from "./owners.js";
import { openwaDigits, openwaResourceGroupActive } from "./policy.js";
import { openwaAgentConversation, openwaOwnerApprovalConversation } from "./session-health.js";

type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type DbOrTransaction = Db | DbTransaction;
type EndpointRow = typeof chatEndpoints.$inferSelect;
type ChatResource = NonNullable<Awaited<ReturnType<typeof openwaChatResource>>>;

export type OpenwaCardRoute = PendingDecisionChatRoute;

export const OPENWA_PENDING_CARD_ACTION_KIND = "openwa_pending_card";
const MAX_ORIGIN_DEPTH = 32;
const OWNER_DM_LABEL = "Owner DM";
const DM_LABEL = "WhatsApp DM";
const GROUP_LABEL = "WhatsApp group";
const LABEL_LIMIT = 120;
const UUID_TEXT = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
const ROUTE_KINDS = new Set<string>(["owner_report", "origin_dm", "origin_group", "owner_dm"]);

/** The OpenWA chat a card's task came from. */
export interface OpenwaCardOriginChat {
  endpointId: string;
  chatConversationId: string;
  chatKey: string;
  isGroup: boolean;
  summary: PendingDecisionChatOrigin;
}

export interface OpenwaCardTarget {
  conversationId: string;
  issueId: string;
  agentId: string;
  chatKey: string;
  route: OpenwaCardRoute;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readable(value: string | null | undefined, fallback: string): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  const digitRuns = text.match(/\d[\d\s\-+().]*\d/g) ?? [];
  if (!text || text.includes("@") || digitRuns.some((run) => run.replace(/\D/g, "").length >= 6)) return fallback;
  return text.length > LABEL_LIMIT ? text.slice(0, LABEL_LIMIT - 1) + "\u2026" : text;
}

function groupLabel(resource: Pick<ChatResource, "label" | "metadata"> | null): string {
  const name = record(resource?.metadata).groupName;
  return readable(typeof name === "string" ? name : (resource?.label ?? null), GROUP_LABEL);
}

function ownerKeys(owner: OpenwaCurrentOwner): string[] {
  return [...owner.jids.map(openwaChatKey), ...(owner.digits ? [owner.digits + "@c.us"] : [])];
}

function chatKeyOf(externalConversationId: string): string | null {
  try {
    return openwaChatKey(parseOpenwaThreadId(externalConversationId).chatId);
  } catch {
    return null;
  }
}

/** OpenWA chat a card's task was asked in: the nearest handoff or conversation on the card's issue or its ancestors. */
export async function openwaCardOriginChat(db: DbOrTransaction, input: { companyId: string; issueId: string }): Promise<OpenwaCardOriginChat | null> {
  const [row] = (await db.execute(sql`
    with recursive chain(id, parent_id, depth) as (
      select i.id, i.parent_id, 0 from issues i where i.company_id = ${input.companyId}::uuid and i.id = ${input.issueId}::uuid
      union all
      select p.id, p.parent_id, chain.depth + 1 from issues p join chain on p.id = chain.parent_id
      where p.company_id = ${input.companyId}::uuid and chain.depth < ${MAX_ORIGIN_DEPTH}
    ),
    bound as (
      select distinct c.issue_id from chat_conversations c
      join chat_endpoints e on e.company_id = c.company_id and e.id = c.endpoint_id and e.provider = 'openwa'
      where c.company_id = ${input.companyId}::uuid and c.issue_id in (select id from chain)
    ),
    hit as (
      select chain.id as task_id, h.task_id is not null as handed_off, h.report_to_owner, coalesce(h.conversation_id, chain.id) as conversation_issue_id
      from chain
      left join chat_task_handoffs h on h.company_id = ${input.companyId}::uuid and h.task_id = chain.id and h.channel = 'openwa'
      where h.task_id is not null or chain.id in (select issue_id from bound)
      order by chain.depth
      limit 1
    )
    select hit.handed_off, hit.report_to_owner, coalesce(ci.identifier, ci.id::text) as conversation,
      cc.id as chat_conversation_id, cc.endpoint_id, cc.external_conversation_id, cc.is_direct_message,
      r.label as resource_label, r.metadata as resource_metadata,
      case when hit.handed_off then o.openwa ->> 'triggerClass' end as trigger_class,
      case when hit.handed_off then d.principal_role end as requester_role,
      case when hit.handed_off then d.normalized_event -> 'openwa' -> 'sender' ->> 'name' end as requester_name
    from hit
    join issues ci on ci.company_id = ${input.companyId}::uuid and ci.id = hit.conversation_issue_id
    join lateral (
      select c.id, c.endpoint_id, c.external_conversation_id, c.is_direct_message, c.resource_id from chat_conversations c
      join chat_endpoints e on e.company_id = c.company_id and e.id = c.endpoint_id and e.provider = 'openwa'
      where c.company_id = ${input.companyId}::uuid and c.issue_id = hit.conversation_issue_id
      order by c.created_at desc limit 1
    ) cc on true
    left join chat_endpoint_resources r on r.company_id = ${input.companyId}::uuid and r.id = cc.resource_id
    left join issues t on t.company_id = ${input.companyId}::uuid and t.id = hit.task_id
    left join heartbeat_runs run on run.company_id = ${input.companyId}::uuid
      and run.id = case when t.origin_run_id ~* ${UUID_TEXT} then t.origin_run_id::uuid end
    left join lateral (select run.context_snapshot -> 'wardmoteOpenwa' as openwa, run.context_snapshot -> 'wardmoteOpenwa' -> 'deliveryIds' ->> -1 as delivery_id) o on true
    left join chat_deliveries d on d.company_id = ${input.companyId}::uuid
      and d.id = case when o.delivery_id ~* ${UUID_TEXT} then o.delivery_id::uuid end`)) as unknown as Array<{
    handed_off: boolean;
    report_to_owner: boolean | null;
    conversation: string;
    chat_conversation_id: string;
    endpoint_id: string;
    external_conversation_id: string;
    is_direct_message: boolean;
    resource_label: string | null;
    resource_metadata: unknown;
    trigger_class: string | null;
    requester_role: string | null;
    requester_name: string | null;
  }>;
  if (!row) return null;
  const chatKey = chatKeyOf(row.external_conversation_id);
  if (!chatKey) return null;
  const isGroup = chatKey.endsWith("@g.us");
  return {
    endpointId: row.endpoint_id,
    chatConversationId: row.chat_conversation_id,
    chatKey,
    isGroup,
    summary: {
      chat: isGroup ? groupLabel({ label: row.resource_label ?? "", metadata: record(row.resource_metadata) }) : DM_LABEL,
      kind: isGroup ? "group" : "dm",
      conversation: row.conversation,
      requester: row.handed_off ? (row.report_to_owner ? "owner" : "non_owner") : null,
      requesterName: row.requester_name ? readable(row.requester_name, "") || null : null,
      requesterRole: row.requester_role ?? null,
    },
  };
}

function presentOwners(owners: OpenwaCurrentOwner[], resource: ChatResource | null): OpenwaCurrentOwner[] {
  const participants = record(resource?.metadata).participants;
  if (!Array.isArray(participants)) return [];
  const present = new Set(participants.filter((entry): entry is string => typeof entry === "string").map(openwaChatKey));
  return owners.filter((owner) => ownerKeys(owner).some((key) => present.has(key)));
}

/** True when every participant of the group is a current owner or this endpoint's own number; an unknown or partial list is never private. */
function onlyOwnersAndBot(endpoint: EndpointRow, owners: OpenwaCurrentOwner[], resource: ChatResource): boolean {
  const metadata = record(resource.metadata);
  const participants = Array.isArray(metadata.participants) ? metadata.participants.filter((entry): entry is string => typeof entry === "string") : null;
  const count = typeof metadata.participantCount === "number" ? metadata.participantCount : null;
  if (!participants || participants.length === 0 || count === null || count < 1) return false;
  const bot = openwaDigits(endpoint.botExternalId ?? "");
  const people = new Set<string>();
  for (const jid of participants.map(openwaChatKey)) {
    if (bot && openwaDigits(jid) === bot) {
      people.add("bot");
      continue;
    }
    const owner = owners.find((candidate) => ownerKeys(candidate).includes(jid));
    if (!owner) return false;
    people.add("owner:" + owner.ownerId);
  }
  return people.has("bot") && people.size > 1 && people.size === count;
}

/** Owners who read a chat a card goes to: the DM's own owner, every owner in owner_number mode, or the owners present in an active group. */
export async function openwaCardChatRecipients(db: DbOrTransaction, endpoint: EndpointRow, chatKey: string): Promise<string[]> {
  const owners = await openwaCurrentOwners(db, endpoint);
  const policy = openwaEndpointPolicySchema.parse(endpoint.policy ?? {});
  const readers = chatKey.endsWith("@g.us")
    ? await (async () => {
        const resource = await openwaChatResource(db, endpoint, chatKey);
        return resource && openwaResourceGroupActive(policy, resource) ? presentOwners(owners, resource) : [];
      })()
    : policy.numberMode === "owner_number"
      ? owners
      : owners.filter((owner) => owner.jids.map(openwaChatKey).includes(chatKey));
  return [...new Set(readers.map((owner) => owner.userId))];
}

/** Owner chat a human_only card goes to on one endpoint, or null when no readable owner chat exists. */
export async function openwaCardTarget(
  tx: DbTransaction,
  endpoint: EndpointRow,
  input: {
    sessionId: string;
    selfChatKey: string;
    addresseeUserId: string | null;
    origin: OpenwaCardOriginChat | null;
    mayRead: (recipients: string[]) => Promise<boolean>;
  },
): Promise<OpenwaCardTarget | null> {
  const origin = input.origin && input.origin.endpointId === endpoint.id ? input.origin : null;
  const summary = input.origin?.summary ?? null;
  const policy = openwaEndpointPolicySchema.parse(endpoint.policy ?? {});
  const owners = origin ? await openwaCurrentOwners(tx, endpoint) : [];
  const deliver = async (
    chatKey: string,
    recipients: string[],
    route: Omit<OpenwaCardRoute, "origin">,
  ): Promise<OpenwaCardTarget | null> => {
    if (recipients.length === 0) return null;
    if (input.addresseeUserId && !recipients.includes(input.addresseeUserId)) return null;
    const conversation = await openwaAgentConversation(tx, endpoint, input.sessionId, [chatKey]);
    if (!conversation || !(await input.mayRead(recipients))) return null;
    return { ...conversation, route: { ...route, origin: summary } };
  };
  const group = async (chatKey: string, kind: "owner_report" | "origin_group"): Promise<OpenwaCardTarget | null> => {
    const resource = await openwaChatResource(tx, endpoint, chatKey);
    if (!resource || resource.type !== "group_chat" || !openwaResourceGroupActive(policy, resource)) return null;
    if (kind === "origin_group" && !onlyOwnersAndBot(endpoint, owners, resource)) return null;
    const recipients = [...new Set(presentOwners(owners, resource).map((owner) => owner.userId))];
    return deliver(chatKey, recipients, { route: kind, viaOwnerReport: kind === "owner_report", sentTo: { chat: groupLabel(resource), kind: "group" } });
  };
  if (origin) {
    const report = await openwaOwnerReportRoute(tx, endpoint, origin.chatKey, { source: "pending_card", conversationId: origin.chatConversationId });
    const viaReport = report ? await group(openwaChatKey(report.chatKey), "owner_report") : null;
    if (viaReport) return viaReport;
    if (origin.isGroup) {
      const privateGroup = await group(origin.chatKey, "origin_group");
      if (privateGroup) return privateGroup;
    } else if (policy.numberMode !== "owner_number") {
      const owner = owners.find((candidate) => ownerKeys(candidate).includes(origin.chatKey));
      const direct = owner
        ? await deliver(origin.chatKey, [owner.userId], { route: "origin_dm", viaOwnerReport: false, sentTo: { chat: OWNER_DM_LABEL, kind: "dm" } })
        : null;
      if (direct) return direct;
    }
  }
  const dm = await openwaOwnerApprovalConversation(tx, endpoint, {
    sessionId: input.sessionId,
    selfChatKey: input.selfChatKey,
    ...(input.addresseeUserId ? { onlyUserId: input.addresseeUserId } : {}),
  });
  if (!dm || !(await input.mayRead(await openwaCardChatRecipients(tx, endpoint, dm.chatKey)))) return null;
  return { ...dm, route: { route: "owner_dm", viaOwnerReport: false, sentTo: { chat: OWNER_DM_LABEL, kind: "dm" }, origin: summary } };
}

/** True while a group still holds only current owners and this number, as an origin_group card requires when it is sent. */
export async function openwaGroupStillPrivate(db: DbOrTransaction, endpoint: EndpointRow, chatKey: string): Promise<boolean> {
  const resource = await openwaChatResource(db, endpoint, chatKey);
  const policy = openwaEndpointPolicySchema.parse(endpoint.policy ?? {});
  if (!resource || resource.type !== "group_chat" || !openwaResourceGroupActive(policy, resource)) return false;
  return onlyOwnersAndBot(endpoint, await openwaCurrentOwners(db, endpoint), resource);
}

export function openwaCardRouteOf(value: unknown): OpenwaCardRoute | null {
  const route = record(value);
  const sentTo = record(route.sentTo);
  if (typeof route.route !== "string" || !ROUTE_KINDS.has(route.route) || typeof sentTo.chat !== "string") return null;
  const origin = record(route.origin);
  return {
    route: route.route as OpenwaCardRoute["route"],
    viaOwnerReport: route.viaOwnerReport === true,
    sentTo: { chat: sentTo.chat, kind: sentTo.kind === "group" ? "group" : "dm" },
    origin:
      typeof origin.chat === "string" && typeof origin.conversation === "string"
        ? {
            chat: origin.chat,
            kind: origin.kind === "group" ? "group" : "dm",
            conversation: origin.conversation,
            requester: origin.requester === "owner" || origin.requester === "non_owner" ? origin.requester : null,
            requesterName: typeof origin.requesterName === "string" ? origin.requesterName : null,
            requesterRole: typeof origin.requesterRole === "string" ? origin.requesterRole : null,
          }
        : null,
  };
}

/** Newest WhatsApp route recorded for each of these cards when it was staged. */
export async function openwaCardRoutes(db: DbOrTransaction, companyId: string, interactionIds: string[]): Promise<Map<string, OpenwaCardRoute>> {
  const routes = new Map<string, OpenwaCardRoute>();
  if (interactionIds.length === 0) return routes;
  const rows = await db
    .select({ payload: chatActions.payload })
    .from(chatActions)
    .where(
      and(
        eq(chatActions.companyId, companyId),
        eq(chatActions.kind, OPENWA_PENDING_CARD_ACTION_KIND),
        sql`${chatActions.payload} -> 'openwa' -> 'cardRoutes' ?| array[${sql.join(interactionIds.map((id) => sql`${id}`), sql`, `)}]::text[]`,
      ),
    )
    .orderBy(desc(chatActions.createdAt));
  for (const row of rows) {
    const byCard = record(record(record(row.payload).openwa).cardRoutes);
    for (const id of interactionIds) {
      if (routes.has(id)) continue;
      const route = openwaCardRouteOf(byCard[id]);
      if (route) routes.set(id, route);
    }
  }
  return routes;
}

/** True while a card staged for this group chat still waits, so an owner's unquoted yes or no there answers it. */
export async function openwaGroupAwaitsCardAnswer(db: DbOrTransaction, input: { companyId: string; endpointId: string; chatKey: string }): Promise<boolean> {
  const rows = (await db.execute(sql`
    select 1 from chat_actions a
    where a.company_id = ${input.companyId}::uuid and a.endpoint_id = ${input.endpointId}::uuid
      and a.kind = ${OPENWA_PENDING_CARD_ACTION_KIND} and a.payload ->> 'chatKey' = ${input.chatKey}
      and exists (
        select 1 from issue_thread_interactions i
        where i.company_id = a.company_id and i.status = 'pending'
          and i.id = any(array(select (jsonb_array_elements_text(coalesce(a.payload -> 'openwa' -> 'pendingCardIds', '[]'::jsonb)))::uuid))
      )
    limit 1`)) as unknown as unknown[];
  return rows.length > 0;
}

