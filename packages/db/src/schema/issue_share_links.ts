import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { issues } from "./issues.js";

export const issueShareLinks = pgTable(
  "issue_share_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id"),
    createdByRunId: uuid("created_by_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByAgentId: uuid("revoked_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    revokedByUserId: text("revoked_by_user_id"),
  },
  (table) => ({
    tokenUq: uniqueIndex("issue_share_links_token_uq").on(table.token),
    activeIssueUq: uniqueIndex("issue_share_links_active_issue_uq").on(table.issueId).where(sql`${table.revokedAt} is null`),
    companyIssueIdx: index("issue_share_links_company_issue_idx").on(table.companyId, table.issueId),
  }),
);
