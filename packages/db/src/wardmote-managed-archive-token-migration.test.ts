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

const MIGRATION_FILE = "0377_wardmote_managed_archive_token.sql";
const RETIRED_KEY = "_paperclipManagedArchiveToken";
const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function migrationHash() {
  const content = await fs.promises.readFile(new URL(`./migrations/${MIGRATION_FILE}`, import.meta.url), "utf8");
  return createHash("sha256").update(content).digest("hex");
}

describeEmbeddedPostgres("wardmote managed archive token migration", () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("moves the archive token to the new key and leaves other metadata", async () => {
    const database = await startEmbeddedPostgresTestDatabase("wardmote-managed-archive-token-migration-");
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    cleanups.push(async () => sql.end());

    const companyId = randomUUID();
    const archived = randomUUID();
    const active = randomUUID();
    const bare = randomUUID();
    const archivedBinding = randomUUID();
    const activeBinding = randomUUID();
    await sql`SET session_replication_role = replica`;
    await sql`
      INSERT INTO "environments" ("id", "name", "driver", "status", "metadata")
      VALUES
        (${archived}, 'archived', 'sandbox', 'archived', ${sql.json({ managedByWardmote: true, [RETIRED_KEY]: "token-1" })}),
        (${active}, 'active', 'ssh', 'active', ${sql.json({ owner: "operator" })}),
        (${bare}, 'bare', 'ssh', 'active', NULL)
    `;
    await sql`
      INSERT INTO "built_in_managed_resources" ("id", "company_id", "bundle_key", "resource_kind", "resource_key", "resource_id", "stock_version", "stock_hash", "defaults_json")
      VALUES
        (${archivedBinding}, ${companyId}, 'managed-environment', 'environment', 'managed-sandbox', ${archived}, 'v1', 'h1', ${sql.json({ status: "archived", [RETIRED_KEY]: "token-1" })}),
        (${activeBinding}, ${companyId}, 'managed-environment', 'environment', 'operator-sandbox', ${active}, 'v1', 'h2', ${sql.json({ status: "active" })})
    `;
    await sql`SET session_replication_role = DEFAULT`;

    const hash = await migrationHash();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);

    const snapshot = async () => ({
      environments: new Map((await sql`SELECT "id", "metadata" FROM "environments" WHERE "id" IN ${sql([archived, active, bare])}`).map((row) => [row.id, row.metadata])),
      bindings: new Map((await sql`SELECT "id", "defaults_json" FROM "built_in_managed_resources" WHERE "company_id" = ${companyId}`).map((row) => [row.id, row.defaults_json])),
    });
    const after = await snapshot();
    expect(after.environments.get(archived)).toEqual({ managedByWardmote: true, _wardmoteManagedArchiveToken: "token-1" });
    expect(after.environments.get(active)).toEqual({ owner: "operator" });
    expect(after.environments.get(bare)).toBeNull();
    expect(after.bindings.get(archivedBinding)).toEqual({ status: "archived", _wardmoteManagedArchiveToken: "token-1" });
    expect(after.bindings.get(activeBinding)).toEqual({ status: "active" });

    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);
    expect(await snapshot()).toEqual(after);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
