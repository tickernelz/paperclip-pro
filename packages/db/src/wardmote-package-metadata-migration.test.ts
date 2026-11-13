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

const MIGRATION_FILE = "0385_wardmote_package_metadata.sql";
const RETIRED_KEY = "paperclip";
const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function migrationHash() {
  const content = await fs.promises.readFile(new URL(`./migrations/${MIGRATION_FILE}`, import.meta.url), "utf8");
  return createHash("sha256").update(content).digest("hex");
}

describeEmbeddedPostgres("wardmote package metadata migration", () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("moves the catalog metadata block of agents and skills to the wardmote key", async () => {
    const database = await startEmbeddedPostgresTestDatabase("wardmote-package-metadata-migration-");
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    cleanups.push(async () => sql.end());

    const companyId = randomUUID();
    const catalogAgent = randomUUID();
    const bothAgent = randomUUID();
    const plainAgent = randomUUID();
    const catalogSkill = randomUUID();
    const plainSkill = randomUUID();
    await sql`SET session_replication_role = replica`;
    await sql`
      INSERT INTO "agents" ("id", "company_id", "name", "metadata")
      VALUES
        (${catalogAgent}, ${companyId}, 'catalog', ${sql.json({ [RETIRED_KEY]: { catalogTeam: { teamId: "team-a" } }, note: "kept" })}),
        (${bothAgent}, ${companyId}, 'both', ${sql.json({ [RETIRED_KEY]: { catalogTeam: { teamId: "old" } }, wardmote: { catalogTeam: { teamId: "new" } } })}),
        (${plainAgent}, ${companyId}, 'plain', ${sql.json({ note: "plain" })})
    `;
    await sql`
      INSERT INTO "company_skills" ("id", "company_id", "key", "slug", "name", "markdown", "metadata")
      VALUES
        (${catalogSkill}, ${companyId}, 'team/review', 'review', 'review', '# review', ${sql.json({ [RETIRED_KEY]: { catalog: { sourceRef: "sha256:abc" } } })}),
        (${plainSkill}, ${companyId}, 'team/plain', 'plain', 'plain', '# plain', ${sql.json({ sourceKind: "local" })})
    `;
    await sql`SET session_replication_role = DEFAULT`;

    const hash = await migrationHash();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);

    const snapshot = async () => ({
      agents: Object.fromEntries((await sql`SELECT "id", "metadata" FROM "agents" WHERE "company_id" = ${companyId}`).map((row) => [row.id, row.metadata])),
      skills: Object.fromEntries((await sql`SELECT "id", "metadata" FROM "company_skills" WHERE "company_id" = ${companyId}`).map((row) => [row.id, row.metadata])),
    });
    const after = await snapshot();
    expect(after.agents[catalogAgent]).toEqual({ wardmote: { catalogTeam: { teamId: "team-a" } }, note: "kept" });
    expect(after.agents[bothAgent]).toEqual({ wardmote: { catalogTeam: { teamId: "new" } } });
    expect(after.agents[plainAgent]).toEqual({ note: "plain" });
    expect(after.skills[catalogSkill]).toEqual({ wardmote: { catalog: { sourceRef: "sha256:abc" } } });
    expect(after.skills[plainSkill]).toEqual({ sourceKind: "local" });

    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);
    expect(await snapshot()).toEqual(after);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
