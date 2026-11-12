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

const MIGRATION_FILE = "0369_wardmote_chat_state_key.sql";
const OLD_KEY = "paperclip:github-webhook-recovery:v1";
const NEW_KEY = "wardmote:github-webhook-recovery:v1";
const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function migrationHash() {
  const content = await fs.promises.readFile(new URL(`./migrations/${MIGRATION_FILE}`, import.meta.url), "utf8");
  return createHash("sha256").update(content).digest("hex");
}

describeEmbeddedPostgres("wardmote chat state key migration", () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("renames the stored GitHub recovery key and keeps a newer key on conflict", async () => {
    const database = await startEmbeddedPostgresTestDatabase("wardmote-chat-state-key-migration-");
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    cleanups.push(async () => sql.end());

    const companyId = randomUUID();
    const onlyOld = randomUUID();
    const both = randomUUID();
    await sql`SET session_replication_role = replica`;
    await sql`
      INSERT INTO "chat_sdk_state" ("company_id", "endpoint_id", "state_key", "value")
      VALUES
        (${companyId}, ${onlyOld}, ${OLD_KEY}, ${sql.json({ cursor: "old-only" })}),
        (${companyId}, ${onlyOld}, 'other:key', ${sql.json({ keep: true })}),
        (${companyId}, ${both}, ${OLD_KEY}, ${sql.json({ cursor: "stale" })}),
        (${companyId}, ${both}, ${NEW_KEY}, ${sql.json({ cursor: "current" })})
    `;
    await sql`SET session_replication_role = DEFAULT`;

    const hash = await migrationHash();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);

    const snapshot = async () => sql<{ endpoint_id: string; state_key: string; value: unknown }[]>`
      SELECT "endpoint_id", "state_key", "value" FROM "chat_sdk_state" ORDER BY "endpoint_id", "state_key"
    `;
    const rows = await snapshot();
    expect(rows.filter((row) => row.endpoint_id === onlyOld).map((row) => [row.state_key, row.value])).toEqual([
      ["other:key", { keep: true }],
      [NEW_KEY, { cursor: "old-only" }],
    ]);
    expect(rows.filter((row) => row.endpoint_id === both).map((row) => [row.state_key, row.value])).toEqual([
      [NEW_KEY, { cursor: "current" }],
    ]);

    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);
    expect(await snapshot()).toEqual(rows);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
