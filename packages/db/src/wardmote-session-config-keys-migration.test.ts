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

const MIGRATION_FILE = "0371_wardmote_session_config_keys.sql";
const OLD_PREFIX = ["__", ["paper", "clip"].join("")].join("");
const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function migrationHash() {
  const content = await fs.promises.readFile(new URL(`./migrations/${MIGRATION_FILE}`, import.meta.url), "utf8");
  return createHash("sha256").update(content).digest("hex");
}

describeEmbeddedPostgres("wardmote session config keys migration", () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("renames stored session config keys and keeps a newer key on conflict", async () => {
    const database = await startEmbeddedPostgresTestDatabase("wardmote-session-config-keys-migration-");
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
      INSERT INTO "agent_task_sessions" ("id", "company_id", "agent_id", "adapter_type", "task_key", "session_params_json")
      VALUES
        (${onlyOld}, ${companyId}, ${agentId}, 'omp_local', 'ZHA-1', ${sql.json({
          sessionId: "s-1",
          [`${OLD_PREFIX}ConfigFingerprint`]: "fp-1",
          [`${OLD_PREFIX}ConfiguredModel`]: "m-1",
          nested: { [`${OLD_PREFIX}ConfigFingerprint`]: "nested-stays" },
        })}),
        (${both}, ${companyId}, ${agentId}, 'omp_local', 'ZHA-2', ${sql.json({
          [`${OLD_PREFIX}ConfigFingerprint`]: "stale",
          __wardmoteConfigFingerprint: "current",
        })}),
        (${untouched}, ${companyId}, ${agentId}, 'omp_local', 'ZHA-3', ${sql.json({ sessionId: "s-3" })}),
        (${empty}, ${companyId}, ${agentId}, 'omp_local', 'ZHA-4', NULL)
    `;
    await sql`SET session_replication_role = DEFAULT`;

    const hash = await migrationHash();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);

    const snapshot = async () => sql<{ id: string; session_params_json: unknown }[]>`
      SELECT "id", "session_params_json" FROM "agent_task_sessions" WHERE "company_id" = ${companyId} ORDER BY "id"
    `;
    const rows = await snapshot();
    const byId = new Map(rows.map((row) => [row.id, row.session_params_json]));
    expect(byId.get(onlyOld)).toEqual({
      sessionId: "s-1",
      __wardmoteConfigFingerprint: "fp-1",
      __wardmoteConfiguredModel: "m-1",
      nested: { [`${OLD_PREFIX}ConfigFingerprint`]: "nested-stays" },
    });
    expect(byId.get(both)).toEqual({ __wardmoteConfigFingerprint: "current" });
    expect(byId.get(untouched)).toEqual({ sessionId: "s-3" });
    expect(byId.get(empty)).toBeNull();

    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);
    expect(await snapshot()).toEqual(rows);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
