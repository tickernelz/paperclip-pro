import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const modelCooldowns = pgTable(
  "model_cooldowns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    selector: text("selector").notNull(),
    cooldownUntil: timestamp("cooldown_until", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    sourceRunId: uuid("source_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companySelectorUq: uniqueIndex("model_cooldowns_company_selector_uq").on(table.companyId, table.selector),
    companyUntilIdx: index("model_cooldowns_company_until_idx").on(table.companyId, table.cooldownUntil),
  }),
);
