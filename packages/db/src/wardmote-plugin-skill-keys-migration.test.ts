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

const MIGRATION_FILE = "0381_wardmote_plugin_skill_keys.sql";
const RETIRED = "paperclip";
const OLD_WIKI = `plugin/${RETIRED}ai-plugin-llm-wiki/`;
const NEW_WIKI = "plugin/wardmote-plugin-llm-wiki/";
const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function migrationHash() {
  const content = await fs.promises.readFile(new URL(`./migrations/${MIGRATION_FILE}`, import.meta.url), "utf8");
  return createHash("sha256").update(content).digest("hex");
}

const skillMarkdown = (key: string) => `---\nname: "Skill"\nkey: "${key}"\n---\n\n# Skill\n`;

describeEmbeddedPostgres("wardmote plugin skill keys migration", () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("re-keys first-party plugin skills, the distill skill and their references", async () => {
    const database = await startEmbeddedPostgresTestDatabase("wardmote-plugin-skill-keys-migration-");
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    cleanups.push(async () => sql.end());

    const companyId = randomUUID();
    const ingest = randomUUID();
    const distill = randomUUID();
    const sandbox = randomUUID();
    const thirdParty = randomUUID();
    const agent = randomUUID();
    const binding = randomUUID();
    const wikiPluginId = randomUUID();
    const oldDistill = `${OLD_WIKI}${RETIRED}-distill`;
    const thirdPartyKey = `plugin/${RETIRED}-community-notes/notes`;
    await sql`INSERT INTO "companies" ("id", "name", "issue_prefix") VALUES (${companyId}, 'Plugin skills', 'PSK')`;
    await sql`
      INSERT INTO "plugins" ("id", "plugin_key", "package_name", "version", "manifest_json")
      VALUES (${wikiPluginId}, 'wardmote.plugin-llm-wiki', 'wiki', '1.0.0', ${sql.json({ id: "wardmote.plugin-llm-wiki" })})
    `;
    await sql`SET session_replication_role = replica`;
    await sql`
      INSERT INTO "company_skills" ("id", "company_id", "key", "slug", "name", "markdown")
      VALUES
        (${ingest}, ${companyId}, ${`${OLD_WIKI}wiki-ingest`}, 'wiki-ingest', 'Wiki Ingest', ${skillMarkdown(`${OLD_WIKI}wiki-ingest`)}),
        (${distill}, ${companyId}, ${oldDistill}, ${`${RETIRED}-distill`}, 'Distill', ${skillMarkdown(oldDistill)}),
        (${sandbox}, ${companyId}, ${`plugin/${RETIRED}-daytona-sandbox-provider/setup`}, 'setup', 'Setup', ${skillMarkdown(`plugin/${RETIRED}-daytona-sandbox-provider/setup`)}),
        (${thirdParty}, ${companyId}, ${thirdPartyKey}, 'notes', 'Notes', ${skillMarkdown(thirdPartyKey)})
    `;
    await sql`
      INSERT INTO "agents" ("id", "company_id", "name", "adapter_type", "adapter_config")
      VALUES (${agent}, ${companyId}, 'Wiki Maintainer', 'omp_local', ${sql.json({ wardmoteSkillSync: { desiredSkills: [`${OLD_WIKI}wiki-ingest`, oldDistill, thirdPartyKey] } })})
    `;
    await sql`
      INSERT INTO "company_skill_policies" ("company_id", "revision", "default_effect", "rules")
      VALUES (${companyId}, 1, 'allow', ${sql.json([{ effect: "deny", subject: { type: "all_agents" }, resources: { skillKeys: [oldDistill, thirdPartyKey] } }])})
    `;
    await sql`
      INSERT INTO "plugin_managed_resources" ("id", "company_id", "plugin_id", "plugin_key", "resource_kind", "resource_key", "resource_id", "defaults_json")
      VALUES (${binding}, ${companyId}, ${wikiPluginId}, 'wardmote.plugin-llm-wiki', 'skill', ${`${RETIRED}-distill`}, ${distill}, ${sql.json({ skillKey: `${RETIRED}-distill`, slug: `${RETIRED}-distill`, canonicalKey: oldDistill })})
    `;
    await sql`SET session_replication_role = DEFAULT`;

    const hash = await migrationHash();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);

    const snapshot = async () => ({
      skills: new Map((await sql`SELECT "id", "key", "slug", "markdown" FROM "company_skills" WHERE "company_id" = ${companyId}`).map((row) => [row.id, [row.key, row.slug, row.markdown]])),
      agent: (await sql`SELECT "adapter_config" FROM "agents" WHERE "id" = ${agent}`)[0]?.adapter_config,
      rules: (await sql`SELECT "rules" FROM "company_skill_policies" WHERE "company_id" = ${companyId}`)[0]?.rules,
      binding: (await sql`SELECT "resource_key", "defaults_json" FROM "plugin_managed_resources" WHERE "id" = ${binding}`)[0],
    });
    const after = await snapshot();
    const newDistill = `${NEW_WIKI}wardmote-distill`;
    expect(after.skills.get(ingest)).toEqual([`${NEW_WIKI}wiki-ingest`, "wiki-ingest", skillMarkdown(`${NEW_WIKI}wiki-ingest`)]);
    expect(after.skills.get(distill)).toEqual([newDistill, "wardmote-distill", skillMarkdown(newDistill)]);
    expect(after.skills.get(sandbox)?.[0]).toBe("plugin/wardmote-daytona-sandbox-provider/setup");
    expect(after.skills.get(thirdParty)).toEqual([thirdPartyKey, "notes", skillMarkdown(thirdPartyKey)]);
    expect(after.agent).toEqual({ wardmoteSkillSync: { desiredSkills: [`${NEW_WIKI}wiki-ingest`, newDistill, thirdPartyKey] } });
    expect(after.rules).toEqual([{ effect: "deny", subject: { type: "all_agents" }, resources: { skillKeys: [newDistill, thirdPartyKey] } }]);
    expect(after.binding).toEqual({ resource_key: "wardmote-distill", defaults_json: { skillKey: "wardmote-distill", slug: "wardmote-distill", canonicalKey: newDistill } });

    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);
    expect(await snapshot()).toEqual(after);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
