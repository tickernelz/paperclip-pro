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

const MIGRATION_FILE = "0374_wardmote_runner_question_key.sql";
const RETIRED_PREFIX = ["paper", "clip-runner-question:"].join("");
const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function migrationHash() {
  const content = await fs.promises.readFile(new URL(`./migrations/${MIGRATION_FILE}`, import.meta.url), "utf8");
  return createHash("sha256").update(content).digest("hex");
}

describeEmbeddedPostgres("wardmote runner question key migration", () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("moves runner question idempotency keys to the wardmote prefix and leaves other keys", async () => {
    const database = await startEmbeddedPostgresTestDatabase("wardmote-runner-question-key-migration-");
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    cleanups.push(async () => sql.end());

    const companyId = randomUUID();
    const issueId = randomUUID();
    const runId = randomUUID();
    const runnerQuestion = randomUUID();
    const otherKey = randomUUID();
    const noKey = randomUUID();
    await sql`SET session_replication_role = replica`;
    await sql`
      INSERT INTO "issue_thread_interactions" ("id", "company_id", "issue_id", "kind", "idempotency_key", "payload")
      VALUES
        (${runnerQuestion}, ${companyId}, ${issueId}, 'ask_user_questions', ${`${RETIRED_PREFIX}${runId}:request-1`}, '{}'::jsonb),
        (${otherKey}, ${companyId}, ${issueId}, 'ask_user_questions', 'card:plan:1', '{}'::jsonb),
        (${noKey}, ${companyId}, ${issueId}, 'request_confirmation', NULL, '{}'::jsonb)
    `;
    await sql`SET session_replication_role = DEFAULT`;

    const hash = await migrationHash();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);

    const snapshot = async () => new Map(
      (await sql`SELECT "id", "idempotency_key" FROM "issue_thread_interactions" WHERE "company_id" = ${companyId}`)
        .map((row) => [row.id, row.idempotency_key]),
    );
    const after = await snapshot();
    expect(after.get(runnerQuestion)).toBe(`wardmote-runner-question:${runId}:request-1`);
    expect(after.get(otherKey)).toBe("card:plan:1");
    expect(after.get(noKey)).toBeNull();

    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);
    expect(await snapshot()).toEqual(after);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
