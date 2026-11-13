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

const MIGRATION_FILE = "0382_wardmote_work_product_provider.sql";
const RETIRED = "paperclip";
const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function migrationHash() {
  const content = await fs.promises.readFile(new URL(`./migrations/${MIGRATION_FILE}`, import.meta.url), "utf8");
  return createHash("sha256").update(content).digest("hex");
}

describeEmbeddedPostgres("wardmote work product provider migration", () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("renames attachment artifact providers and smoke screenshot refs and leaves other providers", async () => {
    const database = await startEmbeddedPostgresTestDatabase("wardmote-work-product-provider-migration-");
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    cleanups.push(async () => sql.end());

    const companyId = randomUUID();
    const issueId = randomUUID();
    const artifact = randomUUID();
    const pullRequest = randomUUID();
    const runId = randomUUID();
    const step = randomUUID();
    const otherStep = randomUUID();
    const attachmentId = randomUUID();
    await sql`INSERT INTO "companies" ("id", "name", "issue_prefix") VALUES (${companyId}, 'Work products', 'WPP')`;
    await sql`SET session_replication_role = replica`;
    await sql`
      INSERT INTO "issue_work_products" ("id", "company_id", "issue_id", "type", "provider", "external_id", "title", "status")
      VALUES
        (${artifact}, ${companyId}, ${issueId}, 'artifact', ${RETIRED}, ${attachmentId}, 'report.pdf', 'active'),
        (${pullRequest}, ${companyId}, ${issueId}, 'pull_request', 'github', '42', 'PR', 'active')
    `;
    await sql`
      INSERT INTO "smoke_run_steps" ("id", "company_id", "run_id", "path", "scenario_step", "status", "screenshot_artifact_ref")
      VALUES
        (${step}, ${companyId}, ${runId}, 'browser', 'open', 'passed', ${sql.json({ provider: RETIRED, attachmentId })}),
        (${otherStep}, ${companyId}, ${runId}, 'browser', 'close', 'passed', NULL)
    `;
    await sql`SET session_replication_role = DEFAULT`;

    const hash = await migrationHash();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);

    const snapshot = async () => ({
      products: new Map((await sql`SELECT "id", "provider" FROM "issue_work_products" WHERE "company_id" = ${companyId}`).map((row) => [row.id, row.provider])),
      steps: new Map((await sql`SELECT "id", "screenshot_artifact_ref" FROM "smoke_run_steps" WHERE "company_id" = ${companyId}`).map((row) => [row.id, row.screenshot_artifact_ref])),
    });
    const after = await snapshot();
    expect(after.products.get(artifact)).toBe("wardmote");
    expect(after.products.get(pullRequest)).toBe("github");
    expect(after.steps.get(step)).toEqual({ provider: "wardmote", attachmentId });
    expect(after.steps.get(otherStep)).toBeNull();

    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);
    expect(await snapshot()).toEqual(after);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
