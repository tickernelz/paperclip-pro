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

const MIGRATION_FILE = "0388_wardmote_identity_link_user_column.sql";
const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function migrationHash() {
  const content = await fs.promises.readFile(new URL(`./migrations/${MIGRATION_FILE}`, import.meta.url), "utf8");
  return createHash("sha256").update(content).digest("hex");
}

describeEmbeddedPostgres("wardmote identity link user column migration", () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("renames the identity link user column once and keeps its values", async () => {
    const database = await startEmbeddedPostgresTestDatabase("wardmote-identity-link-user-column-");
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    cleanups.push(async () => sql.end());

    await sql.unsafe(`ALTER TABLE "chat_identity_links" RENAME COLUMN "wardmote_user_id" TO "paperclip_user_id"`);
    const userColumns = async () =>
      (await sql<{ column_name: string }[]>`
        SELECT column_name::text FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'chat_identity_links' AND column_name LIKE '%_user_id'
        ORDER BY 1
      `).map((row) => row.column_name);
    expect(await userColumns()).toEqual(["paperclip_user_id"]);

    const hash = await migrationHash();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);
    expect(await userColumns()).toEqual(["wardmote_user_id"]);

    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);
    expect(await userColumns()).toEqual(["wardmote_user_id"]);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
