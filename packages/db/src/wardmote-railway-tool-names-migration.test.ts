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

const MIGRATION_FILE = "0375_wardmote_railway_tool_names.sql";
const RETIRED_PREFIX = "paperclip-railway-";
const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function migrationHash() {
  const content = await fs.promises.readFile(new URL(`./migrations/${MIGRATION_FILE}`, import.meta.url), "utf8");
  return createHash("sha256").update(content).digest("hex");
}

describeEmbeddedPostgres("wardmote railway tool name migration", () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("renames Railway catalog entries and profile grants and leaves other tools", async () => {
    const database = await startEmbeddedPostgresTestDatabase("wardmote-railway-tool-names-migration-");
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    cleanups.push(async () => sql.end());

    const companyId = randomUUID();
    const connectionId = randomUUID();
    const profileId = randomUUID();
    const railwayEntry = randomUUID();
    const upstreamEntry = randomUUID();
    const railwayGrant = randomUUID();
    const upstreamGrant = randomUUID();
    await sql`SET session_replication_role = replica`;
    await sql`
      INSERT INTO "tool_catalog_entries" ("id", "company_id", "connection_id", "name", "tool_name", "version_hash")
      VALUES
        (${railwayEntry}, ${companyId}, ${connectionId}, ${`${RETIRED_PREFIX}read-logs`}, ${`${RETIRED_PREFIX}read-logs`}, 'h1'),
        (${upstreamEntry}, ${companyId}, ${connectionId}, 'list-services', 'list-services', 'h2')
    `;
    await sql`
      INSERT INTO "tool_profile_entries" ("id", "company_id", "profile_id", "selector_type", "tool_name")
      VALUES
        (${railwayGrant}, ${companyId}, ${profileId}, 'tool', ${`${RETIRED_PREFIX}restart`}),
        (${upstreamGrant}, ${companyId}, ${profileId}, 'tool', 'list-services')
    `;
    await sql`SET session_replication_role = DEFAULT`;

    const hash = await migrationHash();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);

    const snapshot = async () => ({
      catalog: new Map((await sql`SELECT "id", "name", "tool_name" FROM "tool_catalog_entries" WHERE "company_id" = ${companyId}`).map((row) => [row.id, [row.name, row.tool_name]])),
      grants: new Map((await sql`SELECT "id", "tool_name" FROM "tool_profile_entries" WHERE "company_id" = ${companyId}`).map((row) => [row.id, row.tool_name])),
    });
    const after = await snapshot();
    expect(after.catalog.get(railwayEntry)).toEqual(["wardmote-railway-read-logs", "wardmote-railway-read-logs"]);
    expect(after.catalog.get(upstreamEntry)).toEqual(["list-services", "list-services"]);
    expect(after.grants.get(railwayGrant)).toBe("wardmote-railway-restart");
    expect(after.grants.get(upstreamGrant)).toBe("list-services");

    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);
    expect(await snapshot()).toEqual(after);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
