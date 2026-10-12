import { and, desc, eq, or, sql } from "drizzle-orm";
import { chatEndpointResources, type Db } from "@tickernelz/paperclip-pro-db";
import { openwaChatSettingsSchema } from "@tickernelz/paperclip-pro-shared";
import { unprocessable } from "../../errors.js";
import { openwaThreadId, parseOpenwaThreadId } from "./adapter.js";
import { recordOpenwaAudit } from "./audit.js";
import { openwaChatKey } from "./outbound.js";

type DbOrTransaction = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];
type EndpointRef = { companyId: string; id: string; providerAccountId: string | null };
type ResourceRow = Pick<typeof chatEndpointResources.$inferSelect, "type" | "providerResourceId" | "label" | "availability" | "settings" | "metadata">;

export const OPENWA_OWNER_REPORT_ACTOR_ID = "openwa:owner_report";

export type OpenwaOwnerReportProblem = "missing" | "unavailable" | "owner_absent";

export interface OpenwaOwnerReportChat {
  chatId: string;
  chatKey: string;
  label: string;
  participants: string[];
}

const PROBLEM_MESSAGES: Record<OpenwaOwnerReportProblem | "self", string> = {
  self: "A chat cannot send its owner reports to itself; choose another group",
  missing: "Choose a WhatsApp group this number is a member of",
  unavailable: "This WhatsApp number is no longer active in that group",
  owner_absent: "No owner is a member of that group; choose a group where an owner is present",
};

function sessionOf(endpoint: Pick<EndpointRef, "providerAccountId">): string {
  const account = endpoint.providerAccountId ?? "";
  return account.slice(account.lastIndexOf("#") + 1);
}

async function resourceOf(db: DbOrTransaction, endpoint: EndpointRef, chatKey: string): Promise<ResourceRow | null> {
  let threadId: string | null = null;
  try {
    threadId = openwaThreadId({ sessionId: sessionOf(endpoint), chatId: chatKey, isGroup: chatKey.endsWith("@g.us") });
  } catch {
    threadId = null;
  }
  const [row] = await db
    .select({
      type: chatEndpointResources.type,
      providerResourceId: chatEndpointResources.providerResourceId,
      label: chatEndpointResources.label,
      availability: chatEndpointResources.availability,
      settings: chatEndpointResources.settings,
      metadata: chatEndpointResources.metadata,
    })
    .from(chatEndpointResources)
    .where(
      and(
        eq(chatEndpointResources.companyId, endpoint.companyId),
        eq(chatEndpointResources.endpointId, endpoint.id),
        or(
          ...(threadId ? [eq(chatEndpointResources.providerResourceId, threadId)] : []),
          sql`${chatEndpointResources.metadata}->>'chatKey' = ${chatKey}`,
        ),
      ),
    )
    .orderBy(desc(chatEndpointResources.updatedAt))
    .limit(1);
  return row ?? null;
}

function problemOf(row: ResourceRow | null): OpenwaOwnerReportProblem | null {
  if (!row || row.type !== "group_chat") return "missing";
  if (row.availability !== "available") return "unavailable";
  return row.metadata.ownerPresent === true ? null : "owner_absent";
}

function chatOf(row: ResourceRow, chatKey: string): OpenwaOwnerReportChat {
  let chatId = chatKey;
  try {
    chatId = parseOpenwaThreadId(row.providerResourceId).chatId;
  } catch {
    chatId = chatKey;
  }
  const participants = Array.isArray(row.metadata.participants)
    ? row.metadata.participants.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.toLowerCase())
    : [];
  return { chatId, chatKey, label: row.label, participants };
}

export async function openwaOwnerReportChatKey(db: DbOrTransaction, endpoint: EndpointRef, originChatKey: string): Promise<string | null> {
  const origin = openwaChatKey(originChatKey);
  const row = await resourceOf(db, endpoint, origin);
  const parsed = openwaChatSettingsSchema.safeParse(row?.settings ?? {});
  const key = parsed.success ? (parsed.data.ownerReportChatKey ?? null) : null;
  return key && key !== origin ? key : null;
}

export async function openwaOwnerReportRoute(
  db: DbOrTransaction,
  endpoint: EndpointRef,
  originChatKey: string,
  audit?: { source: string; runId?: string | null; conversationId?: string | null },
): Promise<OpenwaOwnerReportChat | null> {
  const key = await openwaOwnerReportChatKey(db, endpoint, originChatKey);
  if (!key) return null;
  const row = await resourceOf(db, endpoint, key);
  const problem = problemOf(row);
  if (!problem) return chatOf(row!, key);
  if (audit)
    await recordOpenwaAudit(db, {
      companyId: endpoint.companyId,
      endpointId: endpoint.id,
      conversationId: audit.conversationId ?? null,
      chatKey: openwaChatKey(originChatKey),
      kind: "owner_report_fallback",
      actorKind: "system",
      actorRef: OPENWA_OWNER_REPORT_ACTOR_ID,
      runId: audit.runId ?? null,
      metadata: { destinationChatKey: key, reason: problem, source: audit.source },
    });
  return null;
}

export async function assertOpenwaOwnerReportChat(db: DbOrTransaction, endpoint: EndpointRef, chatKey: string, destinationKey: string): Promise<void> {
  const destination = openwaChatKey(destinationKey);
  const problem = destination === openwaChatKey(chatKey) ? "self" : problemOf(await resourceOf(db, endpoint, destination));
  if (problem)
    throw unprocessable(PROBLEM_MESSAGES[problem], { code: "openwa_owner_report_chat_invalid", reason: problem, ownerReportChatKey: destination });
}
