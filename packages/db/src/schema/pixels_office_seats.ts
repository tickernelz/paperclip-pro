import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";

export const pixelsOfficeSeats = pgTable(
  "pixels_office_seats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    characterIndex: integer("character_index").notNull().default(0),
    seatId: text("seat_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyAgentIdx: uniqueIndex("pixels_office_seats_company_agent_idx").on(table.companyId, table.agentId),
    companyIdx: index("pixels_office_seats_company_idx").on(table.companyId),
  }),
);
