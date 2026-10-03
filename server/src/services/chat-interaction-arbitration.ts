import { and, eq, exists, inArray, ne, notExists, or, sql } from "drizzle-orm";

import type { Db } from "@tickernelz/paperclip-pro-db";
import {
  chatConversations,
  chatEndpoints,
  chatPublications,
  heartbeatRuns,
  issueThreadInteractions,
} from "@tickernelz/paperclip-pro-db";

type ChatInteractionArbitrationDb = Pick<Db, "select">;

/**
 * Returns whether a run has yielded its provider-visible response slot to a
 * native question or confirmation. A pending interaction authored by this
 * run's agent is authoritative even before its publication row is inserted.
 * System-authored completion reviews cannot be projected to a provider and
 * must not strand its working placeholder. Once resolved, the durable provider
 * prompt proves that the source run's prose remains internal.
 */
export async function hasChatRunOwnedProviderInteraction(
  db: ChatInteractionArbitrationDb,
  input: { companyId: string; issueId: string; runId: string },
): Promise<boolean> {
  const promptPublication = db
    .select({ id: chatPublications.id })
    .from(chatPublications)
    .where(
      and(
        eq(chatPublications.companyId, issueThreadInteractions.companyId),
        eq(chatPublications.issueId, issueThreadInteractions.issueId),
        sql`${chatPublications.payload} ->> 'interactionId' = ${issueThreadInteractions.id}::text`,
        sql`${chatPublications.idempotencyKey} = 'interaction:' || ${issueThreadInteractions.id}::text || ':' || ${chatPublications.endpointId}::text`,
        inArray(chatPublications.state, [
          "pending",
          "streaming",
          "published",
          "retry",
          "delivery_unknown",
        ]),
      ),
    );
  const conversationOf = (openwa: boolean) =>
    db
      .select({ id: chatConversations.id })
      .from(chatConversations)
      .innerJoin(
        chatEndpoints,
        and(
          eq(chatEndpoints.companyId, chatConversations.companyId),
          eq(chatEndpoints.id, chatConversations.endpointId),
          openwa ? eq(chatEndpoints.provider, "openwa") : ne(chatEndpoints.provider, "openwa"),
        ),
      )
      .where(
        and(
          eq(chatConversations.companyId, input.companyId),
          eq(chatConversations.issueId, input.issueId),
        ),
      );
  const rows = await db
    .select({ id: issueThreadInteractions.id })
    .from(issueThreadInteractions)
    .where(
      and(
        eq(issueThreadInteractions.companyId, input.companyId),
        eq(issueThreadInteractions.issueId, input.issueId),
        eq(issueThreadInteractions.sourceRunId, input.runId),
        or(notExists(conversationOf(true)), exists(conversationOf(false))),
        inArray(issueThreadInteractions.kind, [
          "ask_user_questions",
          "request_confirmation",
        ]),
        or(
          and(
            eq(issueThreadInteractions.status, "pending"),
            exists(
              db
                .select({ id: heartbeatRuns.id })
                .from(heartbeatRuns)
                .where(
                  and(
                    eq(heartbeatRuns.id, input.runId),
                    eq(heartbeatRuns.companyId, input.companyId),
                    eq(
                      heartbeatRuns.agentId,
                      issueThreadInteractions.createdByAgentId,
                    ),
                  ),
                ),
            ),
          ),
          exists(promptPublication),
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
