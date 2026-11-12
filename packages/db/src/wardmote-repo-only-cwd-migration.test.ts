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

const MIGRATION_FILE = "0373_wardmote_repo_only_cwd.sql";
const RETIRED_SENTINEL = "/__paperclip_repo_only__";
const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function migrationHash() {
  const content = await fs.promises.readFile(new URL(`./migrations/${MIGRATION_FILE}`, import.meta.url), "utf8");
  return createHash("sha256").update(content).digest("hex");
}

describeEmbeddedPostgres("wardmote repo-only cwd migration", () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("clears the retired repo-only cwd sentinel and keeps real paths", async () => {
    const database = await startEmbeddedPostgresTestDatabase("wardmote-repo-only-cwd-migration-");
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    cleanups.push(async () => sql.end());

    const companyId = randomUUID();
    const projectId = randomUUID();
    const repoOnly = randomUUID();
    const localPath = randomUUID();
    const executionRepoOnly = randomUUID();
    const executionLocal = randomUUID();
    await sql`SET session_replication_role = replica`;
    await sql`
      INSERT INTO "project_workspaces" ("id", "company_id", "project_id", "name", "cwd", "repo_url")
      VALUES
        (${repoOnly}, ${companyId}, ${projectId}, 'Repo only', ${RETIRED_SENTINEL}, 'https://example.test/repo.git'),
        (${localPath}, ${companyId}, ${projectId}, 'Local', '/srv/checkout', NULL)
    `;
    await sql`
      INSERT INTO "execution_workspaces" ("id", "company_id", "project_id", "mode", "strategy_type", "name", "cwd")
      VALUES
        (${executionRepoOnly}, ${companyId}, ${projectId}, 'shared_workspace', 'project_primary', 'Repo only', ${RETIRED_SENTINEL}),
        (${executionLocal}, ${companyId}, ${projectId}, 'shared_workspace', 'project_primary', 'Local', '/srv/checkout')
    `;
    await sql`SET session_replication_role = DEFAULT`;

    const hash = await migrationHash();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);

    const snapshot = async () => ({
      project: await sql`SELECT "id", "cwd", "repo_url" FROM "project_workspaces" WHERE "company_id" = ${companyId} ORDER BY "id"`,
      execution: await sql`SELECT "id", "cwd" FROM "execution_workspaces" WHERE "company_id" = ${companyId} ORDER BY "id"`,
    });
    const after = await snapshot();
    const project = new Map(after.project.map((row) => [row.id, row]));
    expect(project.get(repoOnly)).toMatchObject({ cwd: null, repo_url: "https://example.test/repo.git" });
    expect(project.get(localPath)).toMatchObject({ cwd: "/srv/checkout" });
    const execution = new Map(after.execution.map((row) => [row.id, row]));
    expect(execution.get(executionRepoOnly)).toMatchObject({ cwd: null });
    expect(execution.get(executionLocal)).toMatchObject({ cwd: "/srv/checkout" });

    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);
    expect(await snapshot()).toEqual(after);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
