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

const MIGRATION_FILE = "0366_wardmote_managed_environment_key.sql";
const LEGACY_KEY = ["managedBy", "Paperclip"].join("");
const LEGACY_DESCRIPTION = `Default execution environment for Paperclip runs on this machine.`;
const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function migrationHash() {
  const content = await fs.promises.readFile(new URL(`./migrations/${MIGRATION_FILE}`, import.meta.url), "utf8");
  return createHash("sha256").update(content).digest("hex");
}

describeEmbeddedPostgres("wardmote managed environment key migration", () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("moves the managed marker and default description, and keeps the managed sandbox unique", async () => {
    const database = await startEmbeddedPostgresTestDatabase("wardmote-managed-env-key-migration-");
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    cleanups.push(async () => sql.end());

    const [local] = await sql<{ id: string }[]>`SELECT "id" FROM "environments" WHERE "driver" = 'local'`;
    const localId = local!.id;
    const sandboxId = randomUUID();
    const tenantId = randomUUID();
    await sql`DROP INDEX IF EXISTS "environments_managed_sandbox_idx"`;
    await sql`
      UPDATE "environments"
      SET "description" = ${LEGACY_DESCRIPTION}, "metadata" = ${sql.json({ defaultForInstance: true, [LEGACY_KEY]: true })}
      WHERE "id" = ${localId}
    `;
    await sql`
      INSERT INTO "environments" ("id", "name", "description", "driver", "metadata")
      VALUES
        (${sandboxId}, 'Managed sandbox', 'Custom text', 'sandbox', ${sql.json({ [LEGACY_KEY]: true, managedSandboxProvider: "kubernetes" })}),
        (${tenantId}, 'Tenant sandbox', NULL, 'sandbox', ${sql.json({ owner: "tenant" })})
    `;

    const hash = await migrationHash();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);

    const rows = await sql<{ id: string; description: string | null; metadata: Record<string, unknown> }[]>`
      SELECT "id", "description", "metadata" FROM "environments"
    `;
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(localId)).toEqual({
      id: localId,
      description: "Default execution environment for Wardmote runs on this machine.",
      metadata: { defaultForInstance: true, managedByWardmote: true },
    });
    expect(byId.get(sandboxId)!.metadata).toEqual({ managedByWardmote: true, managedSandboxProvider: "kubernetes" });
    expect(byId.get(sandboxId)!.description).toBe("Custom text");
    expect(byId.get(tenantId)!.metadata).toEqual({ owner: "tenant" });

    await expect(sql`
      INSERT INTO "environments" ("name", "driver", "metadata")
      VALUES ('Second managed', 'sandbox', ${sql.json({ managedByWardmote: true })})
    `).rejects.toMatchObject({ constraint_name: "environments_managed_sandbox_idx" });

    const before = await sql`SELECT "id", "description", "metadata" FROM "environments" ORDER BY "id"`;
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);
    expect(await sql`SELECT "id", "description", "metadata" FROM "environments" ORDER BY "id"`).toEqual(before);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
