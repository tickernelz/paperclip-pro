import { and, eq, inArray } from "drizzle-orm";
import { chatConversations, chatEndpoints, issues, type Db } from "@tickernelz/paperclip-pro-db";
import { HttpError } from "../../errors.js";
import { logger } from "../../middleware/logger.js";
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

/** Moves an OpenWA conversation issue left in a run-blocking status back to in_progress before a wake; never throws the wake away. */
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
  const actor = { actorType: actorUserId ? ("user" as const) : ("system" as const), actorId: actorUserId ?? input.actorId };
  const details = { identifier: target.identifier, source: "chat:openwa", wake: input.wake, endpointId: target.endpointId };
  const refused = await trySetStatus(db, tx, input, "in_progress", actorUserId, activityPublications);
  if (!refused) {
    await logActivity(
      tx as Db,
      {
        companyId: input.companyId,
        ...actor,
        action: "issue.updated",
        entityType: "issue",
        entityId: input.issueId,
        details: { ...details, status: "in_progress", _previous: { status: target.status } },
      },
      activityPublications,
    );
    return target.status;
  }
  const unresolvedBlockerIssueIds = unresolvedBlockers(refused);
  logger.warn(
    { err: refused, companyId: input.companyId, issueId: input.issueId, wake: input.wake, unresolvedBlockerIssueIds },
    "OpenWA conversation issue could not move to in_progress; the wake proceeds",
  );
  const parked =
    unresolvedBlockerIssueIds.length > 0 &&
    target.status !== "blocked" &&
    !(await trySetStatus(db, tx, input, "blocked", actorUserId, activityPublications));
  await logActivity(
    tx as Db,
    {
      companyId: input.companyId,
      ...actor,
      action: parked ? "issue.updated" : "issue.chat_reopen_refused",
      entityType: "issue",
      entityId: input.issueId,
      details: {
        ...details,
        status: parked ? "blocked" : target.status,
        reopenRefused: unresolvedBlockerIssueIds.length > 0 ? "unresolved_blockers" : "update_failed",
        unresolvedBlockerIssueIds,
        _previous: { status: target.status },
      },
    },
    activityPublications,
  );
  return target.status;
}

async function trySetStatus(
  db: Db,
  tx: Db | DbTransaction,
  input: OpenwaConversationReopenInput,
  status: "in_progress" | "blocked",
  actorUserId: string | null,
  activityPublications: ActivityPublication[] | undefined,
): Promise<unknown> {
  const publications: ActivityPublication[] = [];
  try {
    await tx.transaction((savepoint) =>
      issueService(db).update(input.issueId, { status, actorUserId, companyGuard: input.companyId }, savepoint, publications),
    );
  } catch (error) {
    return error;
  }
  activityPublications?.push(...publications);
  return null;
}

function unresolvedBlockers(error: unknown): string[] {
  if (!(error instanceof HttpError) || error.status !== 422) return [];
  const ids = (error.details as { unresolvedBlockerIssueIds?: unknown } | undefined)?.unresolvedBlockerIssueIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}
