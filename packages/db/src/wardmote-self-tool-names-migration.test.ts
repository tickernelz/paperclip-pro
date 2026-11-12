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

const MIGRATION_FILE = "0380_wardmote_self_tool_names.sql";
const RETIRED = "paperclip-self";
const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function migrationHash() {
  const content = await fs.promises.readFile(new URL(`./migrations/${MIGRATION_FILE}`, import.meta.url), "utf8");
  return createHash("sha256").update(content).digest("hex");
}

describeEmbeddedPostgres("wardmote self tool names migration", () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("renames self tool grants, policies and profile entries", async () => {
    const database = await startEmbeddedPostgresTestDatabase("wardmote-self-tool-names-migration-");
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    cleanups.push(async () => sql.end());

    const companyId = randomUUID();
    const profile = randomUUID();
    const entry = randomUUID();
    const otherEntry = randomUUID();
    const policy = randomUUID();
    const grant = randomUUID();
    await sql`INSERT INTO "companies" ("id", "name", "issue_prefix") VALUES (${companyId}, 'Self tools', 'STN')`;
    await sql`SET session_replication_role = replica`;
    await sql`INSERT INTO "tool_profiles" ("id", "company_id", "profile_key", "name") VALUES (${profile}, ${companyId}, 'profile', 'Profile')`;
    await sql`
      INSERT INTO "tool_profile_entries" ("id", "company_id", "profile_id", "selector_type", "tool_name", "conditions")
      VALUES
        (${entry}, ${companyId}, ${profile}, 'tool_name', ${`${RETIRED}:list_my_issues`}, ${sql.json({ context: { toolName: `${RETIRED}:get_issue_context` } })}),
        (${otherEntry}, ${companyId}, ${profile}, 'tool_name', 'mcp-remote-fixture:echo', NULL)
    `;
    await sql`
      INSERT INTO "tool_policies" ("id", "company_id", "name", "policy_type", "selectors")
      VALUES (${policy}, ${companyId}, 'deny self', 'deny', ${sql.json({ toolNames: [`${RETIRED}:get_issue_context`] })})
    `;
    await sql`
      INSERT INTO "principal_permission_grants" ("id", "company_id", "principal_type", "principal_id", "permission_key", "scope")
      VALUES (${grant}, ${companyId}, 'agent', 'agent-1', 'tools:use', ${sql.json({ allow: [`tool:${RETIRED}:list_my_issues`] })})
    `;
    await sql`SET session_replication_role = DEFAULT`;

    const hash = await migrationHash();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);

    const snapshot = async () => ({
      entries: new Map((await sql`SELECT "id", "tool_name", "conditions" FROM "tool_profile_entries" WHERE "company_id" = ${companyId}`).map((row) => [row.id, [row.tool_name, row.conditions]])),
      policy: (await sql`SELECT "selectors" FROM "tool_policies" WHERE "id" = ${policy}`)[0]?.selectors,
      grant: (await sql`SELECT "scope" FROM "principal_permission_grants" WHERE "id" = ${grant}`)[0]?.scope,
    });
    const after = await snapshot();
    expect(after.entries.get(entry)).toEqual(["wardmote-self:list_my_issues", { context: { toolName: "wardmote-self:get_issue_context" } }]);
    expect(after.entries.get(otherEntry)).toEqual(["mcp-remote-fixture:echo", null]);
    expect(after.policy).toEqual({ toolNames: ["wardmote-self:get_issue_context"] });
    expect(after.grant).toEqual({ allow: ["tool:wardmote-self:list_my_issues"] });

    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);
    expect(await snapshot()).toEqual(after);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
