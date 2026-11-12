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

const MIGRATION_FILE = "0365_wardmote_plugin_ids.sql";
const LEGACY_WIKI_KEY = "paperclipai.plugin-llm-wiki";
const LEGACY_DIFF_KEY = "paperclip.workspace-diff";
const LEGACY_DAYTONA_KEY = "paperclip.daytona-sandbox-provider";
const LEGACY_NAMESPACE = "plugin_llm_wiki_8f50da974f";
const CURRENT_NAMESPACE = "plugin_llm_wiki_1e554e7667";
const LEGACY_CHECKSUM = "fc392bf90771b716053de451810ea196c7aa8ab44478fcd18803928384da41d3";
const CURRENT_CHECKSUM = "106b2c36f71a3f0faa31a6a53e8455a3f5b9e1fac13b72c497fea4cb432c714a";
const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function migrationHash() {
  const content = await fs.promises.readFile(new URL(`./migrations/${MIGRATION_FILE}`, import.meta.url), "utf8");
  return createHash("sha256").update(content).digest("hex");
}

function pluginMigrationChecksum(file: string) {
  const content = fs.readFileSync(new URL(`../../plugins/plugin-llm-wiki/migrations/${file}`, import.meta.url), "utf8");
  return createHash("sha256").update(content).digest("hex");
}

describeEmbeddedPostgres("wardmote plugin id migration", () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("pins the rewritten checksum to the shipped llm-wiki migration", () => {
    expect(pluginMigrationChecksum("001_llm_wiki.sql")).toBe(CURRENT_CHECKSUM);
  });

  it("moves installed plugins, their namespace schema and stored references to Wardmote ids exactly once", async () => {
    const database = await startEmbeddedPostgresTestDatabase("wardmote-plugin-id-migration-");
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    cleanups.push(async () => sql.end());

    const companyId = randomUUID();
    const wikiPluginId = randomUUID();
    const diffPluginId = randomUUID();
    const currentDiffPluginId = randomUUID();
    const thirdPartyPluginId = randomUUID();
    const issueId = randomUUID();
    const environmentId = randomUUID();

    await sql`INSERT INTO "companies" ("id", "name", "issue_prefix") VALUES (${companyId}, 'Plugins', 'PLG')`;
    await sql`
      INSERT INTO "plugins" ("id", "plugin_key", "package_name", "version", "manifest_json")
      VALUES
        (${wikiPluginId}, ${LEGACY_WIKI_KEY}, 'wiki', '1.0.0', ${sql.json({ id: LEGACY_WIKI_KEY, displayName: "Wiki" })}),
        (${diffPluginId}, ${LEGACY_DIFF_KEY}, 'diff-old', '1.0.0', ${sql.json({ id: LEGACY_DIFF_KEY })}),
        (${currentDiffPluginId}, 'wardmote.workspace-diff', 'diff', '1.0.0', ${sql.json({ id: "wardmote.workspace-diff" })}),
        (${thirdPartyPluginId}, 'paperclip.acme-tools', 'acme', '1.0.0', ${sql.json({ id: "paperclip.acme-tools" })})
    `;
    await sql.unsafe(`CREATE SCHEMA "${LEGACY_NAMESPACE}"`);
    await sql.unsafe(`CREATE TABLE "${LEGACY_NAMESPACE}".wiki_pages (id integer PRIMARY KEY)`);
    await sql.unsafe(`INSERT INTO "${LEGACY_NAMESPACE}".wiki_pages (id) VALUES (7)`);
    await sql`
      INSERT INTO "plugin_database_namespaces" ("plugin_id", "plugin_key", "namespace_name")
      VALUES (${wikiPluginId}, ${LEGACY_WIKI_KEY}, ${LEGACY_NAMESPACE})
    `;
    await sql`
      INSERT INTO "plugin_migrations" ("plugin_id", "plugin_key", "namespace_name", "migration_key", "checksum", "plugin_version", "status")
      VALUES
        (${wikiPluginId}, ${LEGACY_WIKI_KEY}, ${LEGACY_NAMESPACE}, '001_llm_wiki.sql', ${LEGACY_CHECKSUM}, '1.0.0', 'applied'),
        (${wikiPluginId}, ${LEGACY_WIKI_KEY}, ${LEGACY_NAMESPACE}, '009_local_edit.sql', 'local-edit-checksum', '1.0.0', 'applied')
    `;
    await sql`
      INSERT INTO "plugin_managed_resources" ("company_id", "plugin_id", "plugin_key", "resource_kind", "resource_key", "resource_id")
      VALUES (${companyId}, ${wikiPluginId}, ${LEGACY_WIKI_KEY}, 'project', 'llm-wiki', ${randomUUID()})
    `;
    await sql`
      INSERT INTO "issues" ("id", "company_id", "title", "origin_kind")
      VALUES (${issueId}, ${companyId}, 'Wiki operation', ${`plugin:${LEGACY_WIKI_KEY}:operation`})
    `;
    await sql`
      INSERT INTO "environments" ("id", "name", "driver", "config")
      VALUES (${environmentId}, 'Sandbox', 'plugin', ${sql.json({ pluginKey: LEGACY_DAYTONA_KEY, driverKey: "daytona" })})
    `;

    const hash = await migrationHash();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);

    const pluginRows = await sql<{ id: string; plugin_key: string; manifest_json: Record<string, unknown> }[]>`
      SELECT "id", "plugin_key", "manifest_json" FROM "plugins"
    `;
    const pluginById = new Map(pluginRows.map((row) => [row.id, row]));
    expect(pluginById.get(wikiPluginId)).toMatchObject({
      plugin_key: "wardmote.plugin-llm-wiki",
      manifest_json: { id: "wardmote.plugin-llm-wiki", displayName: "Wiki" },
    });
    expect(pluginById.get(diffPluginId)?.plugin_key).toBe(LEGACY_DIFF_KEY);
    expect(pluginById.get(thirdPartyPluginId)?.plugin_key).toBe("paperclip.acme-tools");

    const schemas = await sql<{ nspname: string }[]>`
      SELECT nspname FROM pg_namespace WHERE nspname IN (${LEGACY_NAMESPACE}, ${CURRENT_NAMESPACE})
    `;
    expect(schemas.map((row) => row.nspname)).toEqual([CURRENT_NAMESPACE]);
    expect(await sql.unsafe(`SELECT id FROM "${CURRENT_NAMESPACE}".wiki_pages`)).toEqual([{ id: 7 }]);
    expect(await sql`SELECT "plugin_key", "namespace_name" FROM "plugin_database_namespaces"`).toEqual([
      { plugin_key: "wardmote.plugin-llm-wiki", namespace_name: CURRENT_NAMESPACE },
    ]);
    expect(await sql`
      SELECT "migration_key", "plugin_key", "namespace_name", "checksum" FROM "plugin_migrations" ORDER BY "migration_key"
    `).toEqual([
      { migration_key: "001_llm_wiki.sql", plugin_key: "wardmote.plugin-llm-wiki", namespace_name: CURRENT_NAMESPACE, checksum: CURRENT_CHECKSUM },
      { migration_key: "009_local_edit.sql", plugin_key: "wardmote.plugin-llm-wiki", namespace_name: CURRENT_NAMESPACE, checksum: "local-edit-checksum" },
    ]);
    expect(await sql`SELECT "plugin_key" FROM "plugin_managed_resources"`).toEqual([{ plugin_key: "wardmote.plugin-llm-wiki" }]);
    expect(await sql`SELECT "origin_kind" FROM "issues" WHERE "id" = ${issueId}`).toEqual([
      { origin_kind: "plugin:wardmote.plugin-llm-wiki:operation" },
    ]);
    expect(await sql`SELECT "config" FROM "environments" WHERE "id" = ${environmentId}`).toEqual([
      { config: { pluginKey: "wardmote.daytona-sandbox-provider", driverKey: "daytona" } },
    ]);

    const snapshot = async () => ({
      plugins: await sql`SELECT "id", "plugin_key", "manifest_json", "updated_at" FROM "plugins" ORDER BY "id"`,
      namespaces: await sql`SELECT * FROM "plugin_database_namespaces" ORDER BY "id"`,
      migrations: await sql`SELECT * FROM "plugin_migrations" ORDER BY "id"`,
      resources: await sql`SELECT * FROM "plugin_managed_resources" ORDER BY "id"`,
      issues: await sql`SELECT "id", "origin_kind" FROM "issues" ORDER BY "id"`,
      environments: await sql`SELECT "id", "config" FROM "environments" ORDER BY "id"`,
    });
    const before = await snapshot();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);
    expect(await snapshot()).toEqual(before);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
