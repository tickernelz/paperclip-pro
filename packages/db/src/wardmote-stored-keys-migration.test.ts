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

const MIGRATION_FILE = "0384_wardmote_stored_keys.sql";
const RETIRED_CREATE_TASK_PREFIX = "paperclip-runner:create-task:";
const RETIRED_SMOKE_LAB_PREFIX = "paperclip.smoke-lab.";
const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function migrationHash() {
  const content = await fs.promises.readFile(new URL(`./migrations/${MIGRATION_FILE}`, import.meta.url), "utf8");
  return createHash("sha256").update(content).digest("hex");
}

describeEmbeddedPostgres("wardmote stored keys migration", () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("moves runner create-task origins and smoke-lab keys to wardmote and leaves other values", async () => {
    const database = await startEmbeddedPostgresTestDatabase("wardmote-stored-keys-migration-");
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    cleanups.push(async () => sql.end());

    const companyId = randomUUID();
    const runnerChild = randomUUID();
    const manualIssue = randomUUID();
    const smokeApp = randomUUID();
    const otherApp = randomUUID();
    const smokeProfile = randomUUID();
    await sql`SET session_replication_role = replica`;
    await sql`
      INSERT INTO "issues" ("id", "company_id", "title", "origin_id")
      VALUES
        (${runnerChild}, ${companyId}, 'child', ${`${RETIRED_CREATE_TASK_PREFIX}issue-1:key-1`}),
        (${manualIssue}, ${companyId}, 'manual', 'github:acme/repo:issue:7')
    `;
    await sql`
      INSERT INTO "tool_applications" ("id", "company_id", "name", "type", "application_key")
      VALUES
        (${smokeApp}, ${companyId}, 'smoke', 'mcp', ${`${RETIRED_SMOKE_LAB_PREFIX}http-fixture`}),
        (${otherApp}, ${companyId}, 'other', 'mcp', 'acme.tools')
    `;
    await sql`
      INSERT INTO "tool_profiles" ("id", "company_id", "profile_key", "name")
      VALUES (${smokeProfile}, ${companyId}, ${`${RETIRED_SMOKE_LAB_PREFIX}profile`}, 'smoke')
    `;
    await sql`SET session_replication_role = DEFAULT`;

    const hash = await migrationHash();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);

    const snapshot = async () => ({
      issues: Object.fromEntries((await sql`SELECT "id", "origin_id" FROM "issues" WHERE "company_id" = ${companyId}`).map((row) => [row.id, row.origin_id])),
      apps: Object.fromEntries((await sql`SELECT "id", "application_key" FROM "tool_applications" WHERE "company_id" = ${companyId}`).map((row) => [row.id, row.application_key])),
      profiles: Object.fromEntries((await sql`SELECT "id", "profile_key" FROM "tool_profiles" WHERE "company_id" = ${companyId}`).map((row) => [row.id, row.profile_key])),
    });
    const after = await snapshot();
    expect(after.issues[runnerChild]).toBe("wardmote-runner:create-task:issue-1:key-1");
    expect(after.issues[manualIssue]).toBe("github:acme/repo:issue:7");
    expect(after.apps[smokeApp]).toBe("wardmote.smoke-lab.http-fixture");
    expect(after.apps[otherApp]).toBe("acme.tools");
    expect(after.profiles[smokeProfile]).toBe("wardmote.smoke-lab.profile");

    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);
    expect(await snapshot()).toEqual(after);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
