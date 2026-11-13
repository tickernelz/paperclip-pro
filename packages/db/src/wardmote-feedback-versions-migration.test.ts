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

const MIGRATION_FILE = "0383_wardmote_feedback_versions.sql";
const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function migrationHash() {
  const content = await fs.promises.readFile(new URL(`./migrations/${MIGRATION_FILE}`, import.meta.url), "utf8");
  return createHash("sha256").update(content).digest("hex");
}

describeEmbeddedPostgres("wardmote feedback versions migration", () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("defaults new feedback exports to the wardmote envelope versions", async () => {
    const database = await startEmbeddedPostgresTestDatabase("wardmote-feedback-versions-migration-");
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    cleanups.push(async () => sql.end());

    await sql`ALTER TABLE "feedback_exports" ALTER COLUMN "schema_version" SET DEFAULT 'retired-envelope'`;
    const hash = await migrationHash();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);

    const exportId = randomUUID();
    await sql`SET session_replication_role = replica`;
    await sql`
      INSERT INTO "feedback_exports" ("id", "company_id", "feedback_vote_id", "issue_id", "author_user_id", "target_type", "target_id", "vote", "target_summary")
      VALUES (${exportId}, ${randomUUID()}, ${randomUUID()}, ${randomUUID()}, 'user-1', 'issue_comment', 'comment-1', 'up', '{}')
    `;
    await sql`SET session_replication_role = DEFAULT`;
    const [row] = await sql`SELECT "schema_version", "bundle_version", "payload_version" FROM "feedback_exports" WHERE "id" = ${exportId}`;
    expect(row).toEqual({
      schema_version: "wardmote-feedback-envelope-v2",
      bundle_version: "wardmote-feedback-bundle-v2",
      payload_version: "wardmote-feedback-v1",
    });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
