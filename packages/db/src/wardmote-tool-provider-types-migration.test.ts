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

const MIGRATION_FILE = "0372_wardmote_tool_provider_types.sql";
const OLD = ["paper", "clip"].join("");
const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function migrationHash() {
  const content = await fs.promises.readFile(new URL(`./migrations/${MIGRATION_FILE}`, import.meta.url), "utf8");
  return createHash("sha256").update(content).digest("hex");
}

describeEmbeddedPostgres("wardmote tool provider type migration", () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("renames stored plugin application types, keys, connection types, and invocation provider types", async () => {
    const database = await startEmbeddedPostgresTestDatabase("wardmote-tool-provider-types-migration-");
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    cleanups.push(async () => sql.end());

    const companyId = randomUUID();
    const pluginApp = randomUUID();
    const restApp = randomUUID();
    const pluginConnection = randomUUID();
    const restConnection = randomUUID();
    const invocations = {
      self: randomUUID(),
      plugin: randomUUID(),
      slack: randomUUID(),
      rest: randomUUID(),
    };
    await sql`INSERT INTO "companies" ("id", "name", "issue_prefix") VALUES (${companyId}, 'Tool Provider Types', ${`T${companyId.replace(/-/g, "").toUpperCase()}`})`;
    await sql`SET session_replication_role = replica`;
    await sql`
      INSERT INTO "tool_applications" ("id", "company_id", "application_key", "name", "type")
      VALUES
        (${pluginApp}, ${companyId}, ${`${OLD}_plugin:wardmote.llm-wiki`}, 'LLM Wiki', ${`${OLD}_plugin`}),
        (${restApp}, ${companyId}, 'rest:github', 'GitHub', 'rest_api')
    `;
    await sql`
      INSERT INTO "tool_connections" ("id", "company_id", "application_id", "name", "uid", "transport", "config", "transport_config")
      VALUES
        (${pluginConnection}, ${companyId}, ${pluginApp}, 'Plugin', ${randomUUID()}, 'local_stdio',
          ${sql.json({ pluginKey: "wardmote.llm-wiki", type: `${OLD}_plugin` })},
          ${sql.json({ pluginKey: "wardmote.llm-wiki", type: `${OLD}_plugin` })}),
        (${restConnection}, ${companyId}, ${restApp}, 'Rest', ${randomUUID()}, 'rest_api', ${sql.json({ type: "rest_api" })}, ${sql.json({})})
    `;
    await sql`
      INSERT INTO "tool_invocations" ("id", "company_id", "tool_name", "provider_type", "application_key")
      VALUES
        (${invocations.self}, ${companyId}, 'list_my_issues', ${`${OLD}_self`}, NULL),
        (${invocations.plugin}, ${companyId}, 'wiki_search', ${`${OLD}_plugin`}, ${`${OLD}_plugin:wardmote.llm-wiki`}),
        (${invocations.slack}, ${companyId}, 'slack_post', ${`${OLD}_slack_chat`}, NULL),
        (${invocations.rest}, ${companyId}, 'get_repo', 'mcp_http', 'rest:github')
    `;
    await sql`SET session_replication_role = DEFAULT`;

    const hash = await migrationHash();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);

    const snapshot = async () => ({
      applications: await sql`SELECT "id", "application_key", "type" FROM "tool_applications" WHERE "company_id" = ${companyId} ORDER BY "id"`,
      connections: await sql`SELECT "id", "config", "transport_config" FROM "tool_connections" WHERE "company_id" = ${companyId} ORDER BY "id"`,
      invocations: await sql`SELECT "id", "provider_type", "application_key" FROM "tool_invocations" WHERE "company_id" = ${companyId} ORDER BY "id"`,
    });
    const after = await snapshot();
    const app = new Map(after.applications.map((row) => [row.id, row]));
    expect(app.get(pluginApp)).toMatchObject({ application_key: "wardmote_plugin:wardmote.llm-wiki", type: "wardmote_plugin" });
    expect(app.get(restApp)).toMatchObject({ application_key: "rest:github", type: "rest_api" });
    const connection = new Map(after.connections.map((row) => [row.id, row]));
    expect(connection.get(pluginConnection)).toMatchObject({
      config: { pluginKey: "wardmote.llm-wiki", type: "wardmote_plugin" },
      transport_config: { pluginKey: "wardmote.llm-wiki", type: "wardmote_plugin" },
    });
    expect(connection.get(restConnection)).toMatchObject({ config: { type: "rest_api" }, transport_config: {} });
    const invocation = new Map(after.invocations.map((row) => [row.id, row]));
    expect(invocation.get(invocations.self)).toMatchObject({ provider_type: "wardmote_self", application_key: null });
    expect(invocation.get(invocations.plugin)).toMatchObject({
      provider_type: "wardmote_plugin",
      application_key: "wardmote_plugin:wardmote.llm-wiki",
    });
    expect(invocation.get(invocations.slack)).toMatchObject({ provider_type: "wardmote_slack_chat" });
    expect(invocation.get(invocations.rest)).toMatchObject({ provider_type: "mcp_http", application_key: "rest:github" });

    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);
    expect(await snapshot()).toEqual(after);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
