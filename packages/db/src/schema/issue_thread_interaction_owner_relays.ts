import type { IssueThreadInteractionOwnerRelayChannel } from "@tickernelz/paperclip-pro-shared";
import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { issueThreadInteractions } from "./issue_thread_interactions.js";
import { issues } from "./issues.js";

export const issueThreadInteractionOwnerRelays = pgTable(
  "issue_thread_interaction_owner_relays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    interactionId: uuid("interaction_id").notNull().references(() => issueThreadInteractions.id, { onDelete: "cascade" }),
    channel: text("channel").$type<IssueThreadInteractionOwnerRelayChannel>().notNull(),
    ownerMessageRef: text("owner_message_ref").notNull(),
    claimKey: text("claim_key").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    relayedByAgentId: uuid("relayed_by_agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    messageClaimUq: uniqueIndex("issue_thread_interaction_owner_relays_message_claim_uq").on(
      table.companyId,
      table.channel,
      table.ownerMessageRef,
      table.claimKey,
    ),
    interactionIdx: index("issue_thread_interaction_owner_relays_interaction_idx").on(table.interactionId),
  }),
);
