import { createHash } from "node:crypto";
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { applyPendingMigrations } from "./client.js";
import { RETIRED_MIGRATION_LOCK_KEY } from "./retired-migration-lock.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./test-embedded-postgres.js";

const MIGRATION_FILE = "0328_private_task_access.sql";
const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

describeEmbeddedPostgres("migration lock", () => {
  it("waits for a migrator from before the rename that holds the retired lock", async () => {
    const database = await startEmbeddedPostgresTestDatabase("wardmote-migration-lock-");
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    cleanups.push(async () => sql.end());
    const content = await fs.promises.readFile(new URL(`./migrations/${MIGRATION_FILE}`, import.meta.url), "utf8");
    const hash = createHash("sha256").update(content).digest("hex");
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await sql`DROP TRIGGER IF EXISTS heartbeat_runs_set_scope_kind ON heartbeat_runs`;

    await sql`SELECT pg_advisory_lock(hashtextextended(${RETIRED_MIGRATION_LOCK_KEY}, 0))`;
    let settled = false;
    const contender = applyPendingMigrations(database.connectionString).finally(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(settled).toBe(false);
    expect(await sql`SELECT hash FROM drizzle.__drizzle_migrations WHERE hash = ${hash}`).toHaveLength(0);

    await sql`SELECT pg_advisory_unlock(hashtextextended(${RETIRED_MIGRATION_LOCK_KEY}, 0))`;
    await contender;
    expect(await sql`SELECT hash FROM drizzle.__drizzle_migrations WHERE hash = ${hash}`).toHaveLength(1);
  }, 60_000);
});
