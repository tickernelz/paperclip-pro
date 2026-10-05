import { and, eq, inArray } from "drizzle-orm";
import { chatConversations, chatEndpoints, issues, type Db } from "@tickernelz/paperclip-pro-db";
import { logActivity, publishActivity, type ActivityPublication } from "../activity-log.js";
import { issueService } from "../issues.js";

type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const OPENWA_CONVERSATION_REOPEN_STATUSES = ["in_review", "blocked", "done", "cancelled"] as const;

export interface OpenwaConversationReopenInput {
  companyId: string;
  issueId: string;
  actorUserId?: string | null;
  actorId: string;
  wake: string;
}

export interface OpenwaConversationReopenOptions {
  tx?: Db | DbTransaction;
  activityPublications?: ActivityPublication[];
}

/** Moves an OpenWA conversation issue left in a run-blocking status back to in_progress before a wake. */
export async function reopenOpenwaConversationIssue(
  db: Db,
  input: OpenwaConversationReopenInput,
  options: OpenwaConversationReopenOptions = {},
): Promise<string | null> {
  if (options.tx) return reopenIn(db, options.tx, input, options.activityPublications);
  const publications: ActivityPublication[] = [];
  const previous = await db.transaction((tx) => reopenIn(db, tx, input, publications));
  for (const publication of publications) publishActivity(publication);
  return previous;
}

async function reopenIn(
  db: Db,
  tx: Db | DbTransaction,
  input: OpenwaConversationReopenInput,
  activityPublications: ActivityPublication[] | undefined,
): Promise<string | null> {
  const [target] = await tx
    .select({ status: issues.status, identifier: issues.identifier, endpointId: chatEndpoints.id })
    .from(issues)
    .innerJoin(chatConversations, and(eq(chatConversations.companyId, issues.companyId), eq(chatConversations.issueId, issues.id)))
    .innerJoin(chatEndpoints, and(eq(chatEndpoints.companyId, chatConversations.companyId), eq(chatEndpoints.id, chatConversations.endpointId)))
    .where(
      and(
        eq(issues.companyId, input.companyId),
        eq(issues.id, input.issueId),
        eq(issues.originKind, "chat_channel"),
        eq(chatEndpoints.provider, "openwa"),
        inArray(issues.status, [...OPENWA_CONVERSATION_REOPEN_STATUSES]),
      ),
    )
    .limit(1)
    .for("update", { of: issues });
  if (!target) return null;
  const actorUserId = input.actorUserId ?? null;
  await issueService(db).update(
    input.issueId,
    { status: "in_progress", actorUserId, companyGuard: input.companyId },
    tx,
    activityPublications,
  );
  await logActivity(
    tx as Db,
    {
      companyId: input.companyId,
      actorType: actorUserId ? "user" : "system",
      actorId: actorUserId ?? input.actorId,
      action: "issue.updated",
      entityType: "issue",
      entityId: input.issueId,
      details: {
        identifier: target.identifier,
        status: "in_progress",
        source: "chat:openwa",
        wake: input.wake,
        endpointId: target.endpointId,
        _previous: { status: target.status },
      },
    },
    activityPublications,
  );
  return target.status;
}
