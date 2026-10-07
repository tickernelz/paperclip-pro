import { and, eq } from "drizzle-orm";
import type { Db } from "@tickernelz/paperclip-pro-db";
import { agents, companies, companyMemberships, issueComments, issues } from "@tickernelz/paperclip-pro-db";
import { extractUserMentionIds } from "@tickernelz/paperclip-pro-shared";
import { listIssueInboxUserIds } from "../issues.js";
import type { NotificationContext, NotificationTrigger } from "./classify.js";

const ISSUE_AUDIENCE_KINDS = new Set(["comment", "assignment", "review"]);

export async function listCompanyBoardUserIds(db: Db, companyId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: companyMemberships.principalId })
    .from(companyMemberships)
    .where(
      and(
        eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.status, "active"),
      ),
    );
  return [...new Set(rows.map((row) => row.userId))];
}

export async function loadNotificationContext(db: Db, trigger: NotificationTrigger): Promise<NotificationContext | null> {
  const { companyId, agentId, issueId, commentId } = trigger;
  const [company, agent, issue, issueInboxUserIds, comment, boardUserIds] = await Promise.all([
    db
      .select({ issuePrefix: companies.issuePrefix })
      .from(companies)
      .where(eq(companies.id, companyId))
      .then((rows) => rows[0] ?? null),
    agentId
      ? db
          .select({ name: agents.name })
          .from(agents)
          .where(and(eq(agents.id, agentId), eq(agents.companyId, companyId)))
          .then((rows) => rows[0] ?? null)
      : null,
    issueId
      ? db
          .select({ identifier: issues.identifier, title: issues.title })
          .from(issues)
          .where(and(eq(issues.id, issueId), eq(issues.companyId, companyId)))
          .then((rows) => rows[0] ?? null)
      : null,
    issueId && ISSUE_AUDIENCE_KINDS.has(trigger.kind) ? listIssueInboxUserIds(db, companyId, issueId) : [],
    commentId
      ? db
          .select({ body: issueComments.body })
          .from(issueComments)
          .where(and(eq(issueComments.id, commentId), eq(issueComments.companyId, companyId)))
          .then((rows) => rows[0] ?? null)
      : null,
    listCompanyBoardUserIds(db, companyId),
  ]);
  if (!company) return null;
  return {
    issuePrefix: company.issuePrefix,
    agentName: agent?.name ?? null,
    issue,
    issueInboxUserIds,
    mentionedUserIds: comment ? extractUserMentionIds(comment.body) : [],
    boardUserIds,
  };
}
