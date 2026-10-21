import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

export const localBrowserConnections = pgTable(
  "local_browser_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    createdByUserId: text("created_by_user_id"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id),
    label: text("label").notNull(),
    client: text("client").notNull().default("chromium"),
    clientVersion: text("client_version").notNull().default(""),
    profileName: text("profile_name"),
    tier: text("tier").notNull().default("refine"),
    allowedOrigins: jsonb("allowed_origins").$type<string[]>().notNull().default([]),
    tokenHash: text("token_hash").notNull(),
    status: text("status").notNull().default("active"),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("local_browser_connections_token_uq").on(table.tokenHash),
    index("local_browser_connections_company_idx").on(table.companyId, table.createdAt),
  ],
);

export const localBrowserSettings = pgTable(
  "local_browser_settings",
  {
    companyId: uuid("company_id").primaryKey().references(() => companies.id),
    tier: text("tier").notNull().default("refine"),
    allowedOrigins: jsonb("allowed_origins").$type<string[]>().notNull().default([]),
    updatedByUserId: text("updated_by_user_id"),
    updatedByAgentId: uuid("updated_by_agent_id").references(() => agents.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);
