import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { applyPendingMigrations } from "./client.js";
import {
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./test-embedded-postgres.js";

const MIGRATION_FILE = "0386_wardmote_acpx_permission_mode.sql";
const RETIRED_MODE = ["approve", "paperclip"].join("-");
const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function migrationHash() {
  const content = await fs.promises.readFile(new URL(`./migrations/${MIGRATION_FILE}`, import.meta.url), "utf8");
  return createHash("sha256").update(content).digest("hex");
}

describeEmbeddedPostgres("wardmote ACPX permission mode migration", () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("keeps agents and their config history on the automatic Wardmote actions mode", async () => {
    const database = await startEmbeddedPostgresTestDatabase("wardmote-acpx-permission-mode-migration-");
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    cleanups.push(async () => sql.end());

    const companyId = randomUUID();
    const retiredAgent = randomUUID();
    const readsAgent = randomUUID();
    const revision = randomUUID();
    await sql`SET session_replication_role = replica`;
    await sql`
      INSERT INTO "agents" ("id", "company_id", "name", "adapter_config")
      VALUES
        (${retiredAgent}, ${companyId}, 'retired', ${sql.json({ provider: "acpx", acpxPermissionMode: RETIRED_MODE })}),
        (${readsAgent}, ${companyId}, 'reads', ${sql.json({ provider: "acpx", acpxPermissionMode: "approve-reads" })})
    `;
    await sql`
      INSERT INTO "agent_config_revisions" ("id", "company_id", "agent_id", "before_config", "after_config")
      VALUES (${revision}, ${companyId}, ${retiredAgent},
        ${sql.json({ adapterConfig: { acpxPermissionMode: "approve-all" } })},
        ${sql.json({ adapterConfig: { acpxPermissionMode: RETIRED_MODE } })})
    `;
    await sql`SET session_replication_role = DEFAULT`;

    const hash = await migrationHash();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);

    const snapshot = async () => ({
      agents: Object.fromEntries((await sql`SELECT "id", "adapter_config" FROM "agents" WHERE "company_id" = ${companyId}`).map((row) => [row.id, row.adapter_config])),
      revisions: (await sql`SELECT "before_config", "after_config" FROM "agent_config_revisions" WHERE "id" = ${revision}`)[0],
    });
    const after = await snapshot();
    expect(after.agents[retiredAgent]).toEqual({ provider: "acpx", acpxPermissionMode: "approve-wardmote" });
    expect(after.agents[readsAgent]).toEqual({ provider: "acpx", acpxPermissionMode: "approve-reads" });
    expect(after.revisions.before_config).toEqual({ adapterConfig: { acpxPermissionMode: "approve-all" } });
    expect(after.revisions.after_config).toEqual({ adapterConfig: { acpxPermissionMode: "approve-wardmote" } });

    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);
    expect(await snapshot()).toEqual(after);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
