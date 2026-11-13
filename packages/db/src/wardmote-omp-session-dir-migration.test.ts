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

const MIGRATION_FILE = "0387_wardmote_omp_session_dir.sql";
const RETIRED_ROOT = ["/home/operator/.omp", "paperclip", "sessions"].join("/");
const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function migrationHash() {
  const content = await fs.promises.readFile(new URL(`./migrations/${MIGRATION_FILE}`, import.meta.url), "utf8");
  return createHash("sha256").update(content).digest("hex");
}

describeEmbeddedPostgres("wardmote OMP session directory migration", () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("moves stored default OMP session directories to the Wardmote root and keeps other directories", async () => {
    const database = await startEmbeddedPostgresTestDatabase("wardmote-omp-session-dir-migration-");
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    cleanups.push(async () => sql.end());

    const companyId = randomUUID();
    const agentId = randomUUID();
    const retired = randomUUID();
    const custom = randomUUID();
    await sql`SET session_replication_role = replica`;
    await sql`
      INSERT INTO "agent_task_sessions" ("id", "company_id", "agent_id", "adapter_type", "task_key", "session_params_json")
      VALUES
        (${retired}, ${companyId}, ${agentId}, 'omp_local', 'a', ${sql.json({ sessionId: "s1", sessionDir: `${RETIRED_ROOT}/${agentId}`, cwd: "/work" })}),
        (${custom}, ${companyId}, ${agentId}, 'omp_local', 'b', ${sql.json({ sessionId: "s2", sessionDir: "/srv/omp-sessions/agent" })})
    `;
    await sql`SET session_replication_role = DEFAULT`;

    const hash = await migrationHash();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);

    const rows = async () => Object.fromEntries((await sql`SELECT "id", "session_params_json" FROM "agent_task_sessions" WHERE "company_id" = ${companyId}`).map((row) => [row.id, row.session_params_json]));
    const after = await rows();
    expect(after[retired]).toEqual({ sessionId: "s1", sessionDir: `/home/operator/.omp/wardmote/sessions/${agentId}`, cwd: "/work" });
    expect(after[custom]).toEqual({ sessionId: "s2", sessionDir: "/srv/omp-sessions/agent" });

    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);
    expect(await rows()).toEqual(after);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
