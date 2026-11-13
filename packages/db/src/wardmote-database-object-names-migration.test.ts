import { createHash } from "node:crypto";
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { applyPendingMigrations } from "./client.js";
import {
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./test-embedded-postgres.js";

const MIGRATION_FILE = "0388_wardmote_database_object_names.sql";
const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function migrationHash() {
  const content = await fs.promises.readFile(new URL(`./migrations/${MIGRATION_FILE}`, import.meta.url), "utf8");
  return createHash("sha256").update(content).digest("hex");
}

describeEmbeddedPostgres("wardmote database object names migration", () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("renames the identity link column, status trigger and trigger functions once", async () => {
    const database = await startEmbeddedPostgresTestDatabase("wardmote-database-object-names-");
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    cleanups.push(async () => sql.end());

    await sql.unsafe(`
      ALTER TABLE "chat_identity_links" RENAME COLUMN "wardmote_user_id" TO "paperclip_user_id";
      ALTER FUNCTION wardmote_bump_issue_status_version() RENAME TO paperclip_bump_issue_status_version;
      ALTER TRIGGER wardmote_issue_status_version_trigger ON "issues" RENAME TO paperclip_issue_status_version_trigger;
      ALTER FUNCTION wardmote_keep_operation_privacy_sources() RENAME TO paperclip_keep_operation_privacy_sources;
    `);

    const names = async () => {
      const [row] = await sql<{ columns: string[]; triggers: string[]; functions: string[] }[]>`
        SELECT
          ARRAY(SELECT column_name::text FROM information_schema.columns
            WHERE table_schema = current_schema() AND table_name = 'chat_identity_links' AND column_name LIKE '%_user_id' ORDER BY 1) AS columns,
          ARRAY(SELECT tgname::text FROM pg_trigger WHERE tgrelid = 'issues'::regclass AND tgname LIKE '%_issue_status_version_trigger' ORDER BY 1) AS triggers,
          ARRAY(SELECT proname::text FROM pg_proc WHERE proname LIKE '%_bump_issue_status_version' OR proname LIKE '%_keep_operation_privacy_sources' ORDER BY 1) AS functions
      `;
      return row;
    };
    const expected = {
      columns: ["wardmote_user_id"],
      triggers: ["wardmote_issue_status_version_trigger"],
      functions: ["wardmote_bump_issue_status_version", "wardmote_keep_operation_privacy_sources"],
    };

    const hash = await migrationHash();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);
    expect(await names()).toEqual(expected);

    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);
    expect(await names()).toEqual(expected);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
