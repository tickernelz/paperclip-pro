import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";

export const issueAutonomyWindows = pgTable(
  "issue_autonomy_windows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    rootIssueId: uuid("root_issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    grantedByUserId: text("granted_by_user_id").notNull(),
    grantedVia: text("granted_via").$type<"whatsapp" | "paperclip">().notNull(),
    status: text("status").$type<"live" | "revoked" | "expired">().notNull().default("live"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    maxAccepts: integer("max_accepts"),
    acceptCount: integer("accept_count").notNull().default(0),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedByUserId: text("closed_by_user_id"),
  },
  (table) => [
    check("issue_autonomy_windows_granted_via_check", sql`${table.grantedVia} in ('whatsapp', 'paperclip')`),
    check("issue_autonomy_windows_status_check", sql`${table.status} in ('live', 'revoked', 'expired')`),
    index("issue_autonomy_windows_company_status_expires_idx").on(table.companyId, table.status, table.expiresAt),
    index("issue_autonomy_windows_company_root_status_idx").on(table.companyId, table.rootIssueId, table.status),
  ],
);
