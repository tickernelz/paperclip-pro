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

const MIGRATION_FILE = "0378_wardmote_tool_template_keys.sql";
const RETIRED = "paperclip";
const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function migrationHash() {
  const content = await fs.promises.readFile(new URL(`./migrations/${MIGRATION_FILE}`, import.meta.url), "utf8");
  return createHash("sha256").update(content).digest("hex");
}

describeEmbeddedPostgres("wardmote tool template keys migration", () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("renames built-in template ids, example keys and pages keys, and moves colliding custom templates aside", async () => {
    const database = await startEmbeddedPostgresTestDatabase("wardmote-tool-template-keys-migration-");
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    cleanups.push(async () => sql.end());

    const companyId = randomUUID();
    const otherCompanyId = randomUUID();
    const id = () => randomUUID();
    const app = { gallery: id(), example: id(), pages: id(), legacyPages: id(), otherPages: id(), otherWardmotePages: id() };
    const conn = { cognee: id(), custom: id(), example: id(), pages: id(), otherPages: id() };
    const slot = { builtIn: id(), custom: id() };
    const profile = id();
    const binding = id();
    const entry = id();
    const customTemplate = id();

    await sql`
      INSERT INTO "companies" ("id", "name", "issue_prefix")
      VALUES (${companyId}, 'Template keys', 'TKA'), (${otherCompanyId}, 'Other', 'TKB')
    `;
    await sql`SET session_replication_role = replica`;
    await sql`
      INSERT INTO "tool_applications" ("id", "company_id", "name", "type", "application_key", "metadata")
      VALUES
        (${app.gallery}, ${companyId}, 'Cognee', 'mcp', 'cognee', '{}'),
        (${app.example}, ${companyId}, 'Example', 'mcp', ${`${RETIRED}.examples.safe-read-only-todo-kv`}, ${sql.json({ source: `${RETIRED}_example`, exampleId: "safe-read-only-todo-kv" })}),
        (${app.pages}, ${companyId}, 'Pages', 'mcp', ${`${RETIRED}.pages`}, '{}'),
        (${app.legacyPages}, ${companyId}, 'Pages legacy', 'mcp', ${`pages.${RETIRED}`}, '{}'),
        (${app.otherPages}, ${otherCompanyId}, 'Pages', 'mcp', ${`pages.${RETIRED}`}, '{}'),
        (${app.otherWardmotePages}, ${otherCompanyId}, 'Wardmote pages', 'mcp', 'wardmote-pages', '{}')
    `;
    await sql`
      INSERT INTO "tool_stdio_command_templates" ("id", "company_id", "template_key", "name", "command")
      VALUES (${customTemplate}, ${companyId}, 'wardmote.cognee-cloud', 'Custom', 'node')
    `;
    await sql`
      INSERT INTO "tool_connections" ("id", "company_id", "application_id", "name", "uid", "transport", "config", "transport_config")
      VALUES
        (${conn.cognee}, ${companyId}, ${app.gallery}, 'cognee', 'cognee/cognee-1', 'local_stdio', ${sql.json({ templateId: `${RETIRED}.cognee-cloud` })}, ${sql.json({ templateId: `${RETIRED}.cognee-cloud` })}),
        (${conn.custom}, ${companyId}, ${app.gallery}, 'custom', 'custom/custom-1', 'local_stdio', ${sql.json({ templateId: "wardmote.cognee-cloud" })}, ${sql.json({ templateId: "wardmote.cognee-cloud" })}),
        (${conn.example}, ${companyId}, ${app.example}, 'example', ${`${RETIRED}/wardmote-example-12345678`}, 'local_stdio', ${sql.json({ templateId: `${RETIRED}.synthetic-todo-kv` })}, ${sql.json({ templateId: `${RETIRED}.synthetic-todo-kv` })}),
        (${conn.pages}, ${companyId}, ${app.legacyPages}, 'pages', 'pages/pages-1', 'mcp_remote', '{}', '{}'),
        (${conn.otherPages}, ${otherCompanyId}, ${app.otherPages}, 'pages', 'pages/pages-2', 'mcp_remote', ${sql.json({ connectionType: "custom" })}, '{}')
    `;
    await sql`
      INSERT INTO "tool_runtime_slots" ("id", "company_id", "slot_key", "provider", "provider_ref", "command_template_key", "metadata")
      VALUES
        (${slot.builtIn}, ${companyId}, 'slot-1', ${RETIRED}, ${`template:${RETIRED}.cognee-cloud`}, ${`${RETIRED}.cognee-cloud`}, ${sql.json({ templateId: `${RETIRED}.cognee-cloud` })}),
        (${slot.custom}, ${companyId}, 'slot-2', 'local', 'template:wardmote.cognee-cloud', 'wardmote.cognee-cloud', '{}')
    `;
    await sql`
      INSERT INTO "tool_profiles" ("id", "company_id", "profile_key", "name", "metadata")
      VALUES (${profile}, ${companyId}, ${`${RETIRED}.examples.safe-read-only-todo-kv.profile`}, 'Example', ${sql.json({ source: `${RETIRED}_example` })})
    `;
    await sql`
      INSERT INTO "tool_profile_bindings" ("id", "company_id", "profile_id", "target_type", "target_id", "metadata")
      VALUES (${binding}, ${companyId}, ${profile}, 'company', ${companyId}, ${sql.json({ source: `${RETIRED}_example`, safeDefault: true })})
    `;
    await sql`
      INSERT INTO "tool_profile_entries" ("id", "company_id", "profile_id", "selector_type", "conditions")
      VALUES (${entry}, ${companyId}, ${profile}, 'catalog_entry', ${sql.json({ source: `${RETIRED}_example` })})
    `;
    await sql`SET session_replication_role = DEFAULT`;

    const hash = await migrationHash();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);

    const companies = [companyId, otherCompanyId];
    const snapshot = async () => ({
      applications: new Map((await sql`SELECT "id", "application_key", "metadata" FROM "tool_applications" WHERE "company_id" IN ${sql(companies)}`).map((row) => [row.id, [row.application_key, row.metadata]])),
      connections: new Map((await sql`SELECT "id", "uid", "config", "transport_config" FROM "tool_connections" WHERE "company_id" IN ${sql(companies)}`).map((row) => [row.id, [row.uid, row.config, row.transport_config]])),
      slots: new Map((await sql`SELECT "id", "provider", "provider_ref", "command_template_key", "metadata" FROM "tool_runtime_slots" WHERE "company_id" = ${companyId}`).map((row) => [row.id, [row.provider, row.provider_ref, row.command_template_key, row.metadata]])),
      templates: (await sql`SELECT "template_key" FROM "tool_stdio_command_templates" WHERE "company_id" = ${companyId}`).map((row) => row.template_key),
      profileKey: (await sql`SELECT "profile_key", "metadata" FROM "tool_profiles" WHERE "id" = ${profile}`)[0],
      binding: (await sql`SELECT "metadata" FROM "tool_profile_bindings" WHERE "id" = ${binding}`)[0]?.metadata,
      entry: (await sql`SELECT "conditions" FROM "tool_profile_entries" WHERE "id" = ${entry}`)[0]?.conditions,
    });
    const after = await snapshot();

    expect(after.templates).toEqual(["wardmote.cognee-cloud.custom"]);
    expect(after.connections.get(conn.custom)).toEqual(["custom/custom-1", { templateId: "wardmote.cognee-cloud.custom" }, { templateId: "wardmote.cognee-cloud.custom" }]);
    expect(after.connections.get(conn.cognee)).toEqual(["cognee/cognee-1", { templateId: "wardmote.cognee-cloud" }, { templateId: "wardmote.cognee-cloud" }]);
    expect(after.slots.get(slot.custom)).toEqual(["local", "template:wardmote.cognee-cloud", "wardmote.cognee-cloud.custom", {}]);
    expect(after.slots.get(slot.builtIn)).toEqual(["wardmote", "template:wardmote.cognee-cloud", "wardmote.cognee-cloud", { templateId: "wardmote.cognee-cloud" }]);

    expect(after.applications.get(app.example)).toEqual(["wardmote.examples.safe-read-only-todo-kv", { source: "wardmote_example", exampleId: "safe-read-only-todo-kv" }]);
    expect(after.connections.get(conn.example)).toEqual(["wardmote/wardmote-example-12345678", { templateId: "wardmote.synthetic-todo-kv" }, { templateId: "wardmote.synthetic-todo-kv" }]);
    expect(after.profileKey).toEqual({ profile_key: "wardmote.examples.safe-read-only-todo-kv.profile", metadata: { source: "wardmote_example" } });
    expect(after.binding).toEqual({ source: "wardmote_example", safeDefault: true });
    expect(after.entry).toEqual({ source: "wardmote_example" });

    expect(after.applications.get(app.pages)?.[0]).toBe("wardmote-pages");
    expect(after.applications.get(app.legacyPages)?.[0]).toBe(`pages.${RETIRED}`);
    expect(after.connections.get(conn.pages)?.[1]).toEqual({ connectionType: "pages" });
    expect(after.applications.get(app.otherPages)?.[0]).toBe(`pages.${RETIRED}`);
    expect(after.applications.get(app.otherWardmotePages)?.[0]).toBe("wardmote-pages");
    expect(after.connections.get(conn.otherPages)?.[1]).toEqual({ connectionType: "custom" });

    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);
    expect(await snapshot()).toEqual(after);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
