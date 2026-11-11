import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@tickernelz/wardmote-db";
import {
  chatConversations,
  chatEndpoints,
  chatPublications,
} from "@tickernelz/wardmote-db";
import type { ExternalChannelBindingSummary } from "@tickernelz/wardmote-shared";
import { chatProviderConversationUrl } from "./chat-provider-links.js";

export async function getExternalChannelBindingSummary(
  db: Db,
  companyId: string,
  issueId: string,
): Promise<ExternalChannelBindingSummary | null> {
  const row = await db
    .select({
      conversation: chatConversations,
      endpoint: chatEndpoints,
      publicationState: chatPublications.state,
    })
    .from(chatConversations)
    .innerJoin(
      chatEndpoints,
      and(
        eq(chatEndpoints.companyId, chatConversations.companyId),
        eq(chatEndpoints.id, chatConversations.endpointId),
      ),
    )
    .leftJoin(
      chatPublications,
      and(
        eq(chatPublications.companyId, chatConversations.companyId),
        eq(chatPublications.conversationId, chatConversations.id),
      ),
    )
    .where(
      and(
        eq(chatConversations.companyId, companyId),
        eq(chatConversations.issueId, issueId),
      ),
    )
    .orderBy(desc(chatPublications.createdAt), desc(chatConversations.createdAt))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (!row) return null;
  // Retained Telegram DM URLs may predate the private-chat link correction.
  // Task banners and issue-detail bindings must open the current configured
  // bot, not the human username, without rewriting historical source evidence.
  const externalUrl =
    row.endpoint.provider === "telegram" && row.conversation.isDirectMessage
      ? chatProviderConversationUrl({
          provider: "telegram",
          botUsername: row.endpoint.botUsername,
          threadId: row.conversation.externalThreadId,
          providerMessageId: "",
          raw: { chat: { type: "private" } },
        })
      : row.conversation.providerUrl;
  return {
    endpointId: row.endpoint.id,
    provider: row.endpoint.provider,
    botLabel: row.endpoint.botDisplayName,
    externalLabel: row.conversation.externalLabel,
    externalUrl,
    conversationId: row.conversation.id,
    publicationState: row.publicationState ?? null,
    assignedAgentLocked: true,
  };
}
