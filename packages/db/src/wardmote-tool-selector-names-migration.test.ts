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

const MIGRATION_FILE = "0379_wardmote_tool_selector_names.sql";
const RETIRED = "paperclip";
const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function migrationHash() {
  const content = await fs.promises.readFile(new URL(`./migrations/${MIGRATION_FILE}`, import.meta.url), "utf8");
  return createHash("sha256").update(content).digest("hex");
}

describeEmbeddedPostgres("wardmote tool selector names migration", () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("keeps policies, profile conditions and tool grants pointing at renamed tools and applications", async () => {
    const database = await startEmbeddedPostgresTestDatabase("wardmote-tool-selector-names-migration-");
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    cleanups.push(async () => sql.end());

    const companyId = randomUUID();
    const keptPagesCompanyId = randomUUID();
    const denyRailway = randomUUID();
    const pagesPolicy = randomUUID();
    const keptPagesPolicy = randomUUID();
    const unrelatedPolicy = randomUUID();
    const profile = randomUUID();
    const entry = randomUUID();
    const toolGrant = randomUUID();
    const otherGrant = randomUUID();
    await sql`
      INSERT INTO "companies" ("id", "name", "issue_prefix")
      VALUES (${companyId}, 'Selectors', 'TSA'), (${keptPagesCompanyId}, 'Kept pages', 'TSB')
    `;
    await sql`SET session_replication_role = replica`;
    await sql`
      INSERT INTO "tool_applications" ("id", "company_id", "name", "type", "application_key")
      VALUES (${randomUUID()}, ${keptPagesCompanyId}, 'Pages', 'mcp', ${`pages.${RETIRED}`})
    `;
    await sql`
      INSERT INTO "tool_policies" ("id", "company_id", "name", "policy_type", "selectors", "conditions")
      VALUES
        (${denyRailway}, ${companyId}, 'deny railway', 'deny', ${sql.json({ toolNames: [`${RETIRED}-railway-restart`, "list-services"] })}, ${sql.json({ context: { toolName: `${RETIRED}-railway-read-logs` } })}),
        (${pagesPolicy}, ${companyId}, 'pages', 'deny', ${sql.json({ applicationKeys: [`${RETIRED}.pages`, `${RETIRED}.examples.safe-read-only-todo-kv`] })}, NULL),
        (${keptPagesPolicy}, ${keptPagesCompanyId}, 'kept pages', 'deny', ${sql.json({ applicationKey: `pages.${RETIRED}` })}, NULL),
        (${unrelatedPolicy}, ${companyId}, 'unrelated', 'deny', ${sql.json({ toolName: "railway-restart" })}, NULL)
    `;
    await sql`
      INSERT INTO "tool_profiles" ("id", "company_id", "profile_key", "name")
      VALUES (${profile}, ${companyId}, 'profile', 'Profile')
    `;
    await sql`
      INSERT INTO "tool_profile_entries" ("id", "company_id", "profile_id", "selector_type", "conditions")
      VALUES (${entry}, ${companyId}, ${profile}, 'tool_name', ${sql.json({ actor: { toolName: `${RETIRED}-railway-restart` } })})
    `;
    await sql`
      INSERT INTO "principal_permission_grants" ("id", "company_id", "principal_type", "principal_id", "permission_key", "scope")
      VALUES
        (${toolGrant}, ${companyId}, 'agent', 'agent-1', 'tools:use', ${sql.json({ allow: [`tool:${RETIRED}-railway-restart`], applicationKey: `${RETIRED}.pages` })}),
        (${otherGrant}, ${companyId}, 'agent', 'agent-1', 'issues:read', ${sql.json({ note: `${RETIRED}-railway-restart` })})
    `;
    await sql`SET session_replication_role = DEFAULT`;

    const hash = await migrationHash();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);

    const snapshot = async () => ({
      policies: new Map((await sql`SELECT "id", "selectors", "conditions" FROM "tool_policies" WHERE "company_id" IN ${sql([companyId, keptPagesCompanyId])}`).map((row) => [row.id, [row.selectors, row.conditions]])),
      entry: (await sql`SELECT "conditions" FROM "tool_profile_entries" WHERE "id" = ${entry}`)[0]?.conditions,
      grants: new Map((await sql`SELECT "id", "scope" FROM "principal_permission_grants" WHERE "company_id" = ${companyId}`).map((row) => [row.id, row.scope])),
    });
    const after = await snapshot();
    expect(after.policies.get(denyRailway)).toEqual([
      { toolNames: ["wardmote-railway-restart", "list-services"] },
      { context: { toolName: "wardmote-railway-read-logs" } },
    ]);
    expect(after.policies.get(pagesPolicy)).toEqual([{ applicationKeys: ["wardmote-pages", "wardmote.examples.safe-read-only-todo-kv"] }, null]);
    expect(after.policies.get(keptPagesPolicy)).toEqual([{ applicationKey: `pages.${RETIRED}` }, null]);
    expect(after.policies.get(unrelatedPolicy)).toEqual([{ toolName: "railway-restart" }, null]);
    expect(after.entry).toEqual({ actor: { toolName: "wardmote-railway-restart" } });
    expect(after.grants.get(toolGrant)).toEqual({ allow: ["tool:wardmote-railway-restart"], applicationKey: "wardmote-pages" });
    expect(after.grants.get(otherGrant)).toEqual({ note: `${RETIRED}-railway-restart` });

    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);
    expect(await snapshot()).toEqual(after);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
