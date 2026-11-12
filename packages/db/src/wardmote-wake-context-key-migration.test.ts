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

const MIGRATION_FILE = "0370_wardmote_wake_context_key.sql";
const OLD_KEY = "_paperclipWakeContext";
const NEW_KEY = "_wardmoteWakeContext";
const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function migrationHash() {
  const content = await fs.promises.readFile(new URL(`./migrations/${MIGRATION_FILE}`, import.meta.url), "utf8");
  return createHash("sha256").update(content).digest("hex");
}

describeEmbeddedPostgres("wardmote wake context key migration", () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("renames the wake context key on terminal and open requests and keeps a newer key on conflict", async () => {
    const database = await startEmbeddedPostgresTestDatabase("wardmote-wake-context-key-migration-");
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    cleanups.push(async () => sql.end());

    const companyId = randomUUID();
    const agentId = randomUUID();
    const onlyOld = randomUUID();
    const both = randomUUID();
    const untouched = randomUUID();
    const empty = randomUUID();
    await sql`SET session_replication_role = replica`;
    await sql`
      INSERT INTO "agent_wakeup_requests" ("id", "company_id", "agent_id", "source", "status", "payload")
      VALUES
        (${onlyOld}, ${companyId}, ${agentId}, 'automation', 'completed', ${sql.json({ issueId: "i-1", [OLD_KEY]: { issueId: "i-1", wakeCommentIds: ["c-1"] } })}),
        (${both}, ${companyId}, ${agentId}, 'automation', 'queued', ${sql.json({ [OLD_KEY]: { issueId: "stale" }, [NEW_KEY]: { issueId: "current" } })}),
        (${untouched}, ${companyId}, ${agentId}, 'automation', 'completed', ${sql.json({ issueId: "i-2" })}),
        (${empty}, ${companyId}, ${agentId}, 'automation', 'cancelled', NULL)
    `;
    await sql`SET session_replication_role = DEFAULT`;

    const hash = await migrationHash();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);

    const snapshot = async () => sql<{ id: string; payload: unknown }[]>`
      SELECT "id", "payload" FROM "agent_wakeup_requests" WHERE "company_id" = ${companyId} ORDER BY "id"
    `;
    const rows = await snapshot();
    const byId = new Map(rows.map((row) => [row.id, row.payload]));
    expect(byId.get(onlyOld)).toEqual({ issueId: "i-1", [NEW_KEY]: { issueId: "i-1", wakeCommentIds: ["c-1"] } });
    expect(byId.get(both)).toEqual({ [NEW_KEY]: { issueId: "current" } });
    expect(byId.get(untouched)).toEqual({ issueId: "i-2" });
    expect(byId.get(empty)).toBeNull();

    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);
    expect(await snapshot()).toEqual(rows);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
