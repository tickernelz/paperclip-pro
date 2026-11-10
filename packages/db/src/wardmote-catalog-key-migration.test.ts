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

const MIGRATION_FILE = "0364_wardmote_catalog_keys.sql";
const LEGACY_OWNER = ["paper", "clipai"].join("");
const LEGACY_CATEGORY = ["paper", "clip-operations"].join("");
const LEGACY_CORE = ["paper", "clip-core"].join("");
const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function migrationHash() {
  const content = await fs.promises.readFile(new URL(`./migrations/${MIGRATION_FILE}`, import.meta.url), "utf8");
  return createHash("sha256").update(content).digest("hex");
}

describeEmbeddedPostgres("wardmote catalog key migration", () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("moves stored catalog keys, categories, and the bundled core folder to Wardmote names exactly once", async () => {
    const database = await startEmbeddedPostgresTestDatabase("wardmote-catalog-key-migration-");
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, { max: 1 });
    cleanups.push(async () => sql.end());

    const companyId = randomUUID();
    const conflictCompanyId = randomUUID();
    const catalogSkillId = randomUUID();
    const customSkillId = randomUUID();
    const conflictLegacyId = randomUUID();
    const conflictCurrentId = randomUUID();
    const agentId = randomUUID();
    const untouchedAgentId = randomUUID();
    const revisionId = randomUUID();
    const rootFolderId = randomUUID();
    const coreFolderId = randomUUID();
    const legacyKey = `${LEGACY_OWNER}/bundled/${LEGACY_CATEGORY}/task-planning`;
    const currentKey = "tickernelz/bundled/wardmote-operations/task-planning";

    await sql`
      INSERT INTO "companies" ("id", "name", "issue_prefix")
      VALUES (${companyId}, 'Catalog', 'CAT'), (${conflictCompanyId}, 'Conflict', 'CFL')
    `;
    await sql`
      INSERT INTO "folders" ("id", "company_id", "kind", "parent_id", "name", "slug", "system_key")
      VALUES
        (${rootFolderId}, ${companyId}, 'skill', NULL, 'Bundled', 'bundled', 'bundled'),
        (${coreFolderId}, ${companyId}, 'skill', ${rootFolderId}, 'Paperclip Core', ${LEGACY_CORE}, ${`bundled:${LEGACY_CORE}`})
    `;
    await sql`
      INSERT INTO "company_skills" ("id", "company_id", "key", "slug", "name", "markdown", "metadata")
      VALUES
        (${catalogSkillId}, ${companyId}, ${legacyKey}, 'task-planning', 'Task planning', '# Plan',
          ${sql.json({
            skillKey: legacyKey,
            sourceKind: "catalog",
            catalogId: `${LEGACY_OWNER}:bundled:${LEGACY_CATEGORY}:task-planning`,
            catalogKey: legacyKey,
            catalogCategory: LEGACY_CATEGORY,
            catalogPath: `bundled/${LEGACY_CATEGORY}/task-planning/SKILL.md`,
            note: `${LEGACY_OWNER}/paperclip stays`,
          })}),
        (${customSkillId}, ${companyId}, 'acme/tools/reviewer', 'reviewer', 'Reviewer', '# Reviewer', NULL),
        (${conflictLegacyId}, ${conflictCompanyId}, ${legacyKey}, 'task-planning', 'Task planning', '# Plan', NULL),
        (${conflictCurrentId}, ${conflictCompanyId}, ${currentKey}, 'task-planning', 'Task planning', '# Plan', NULL)
    `;
    await sql`
      INSERT INTO "agents" ("id", "company_id", "name", "adapter_config", "metadata")
      VALUES
        (${agentId}, ${companyId}, 'Agent', ${sql.json({
          model: "kept",
          wardmoteSkillSync: { desiredSkills: [legacyKey, "acme/tools/reviewer"] },
        })}, ${sql.json({ catalogTeam: { catalogKey: `${LEGACY_OWNER}/bundled/software-development/review` } })}),
        (${untouchedAgentId}, ${companyId}, 'Untouched', ${sql.json({ wardmoteSkillSync: { desiredSkills: ["acme/tools/reviewer"] } })}, NULL)
    `;
    await sql`
      INSERT INTO "agent_config_revisions" ("id", "company_id", "agent_id", "changed_keys", "before_config", "after_config")
      VALUES (${revisionId}, ${companyId}, ${agentId}, ${sql.json(["adapterConfig"])},
        ${sql.json({ adapterConfig: { wardmoteSkillSync: { desiredSkills: ["acme/tools/reviewer"] } } })},
        ${sql.json({ adapterConfig: { wardmoteSkillSync: { desiredSkills: [legacyKey] } } })})
    `;

    const hash = await migrationHash();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);

    const [folder] = await sql<{ name: string; slug: string; system_key: string }[]>`
      SELECT "name", "slug", "system_key" FROM "folders" WHERE "id" = ${coreFolderId}
    `;
    expect(folder).toEqual({ name: "Wardmote Core", slug: "wardmote-core", system_key: "bundled:wardmote-core" });

    const skills = await sql<{ id: string; key: string; metadata: Record<string, unknown> | null }[]>`
      SELECT "id", "key", "metadata" FROM "company_skills"
    `;
    const byId = new Map(skills.map((row) => [row.id, row]));
    expect(byId.get(catalogSkillId)).toEqual({
      id: catalogSkillId,
      key: currentKey,
      metadata: {
        skillKey: currentKey,
        sourceKind: "catalog",
        catalogId: "tickernelz:bundled:wardmote-operations:task-planning",
        catalogKey: currentKey,
        catalogCategory: "wardmote-operations",
        catalogPath: "bundled/wardmote-operations/task-planning/SKILL.md",
        note: `${LEGACY_OWNER}/paperclip stays`,
      },
    });
    expect(byId.get(customSkillId)?.key).toBe("acme/tools/reviewer");
    expect(byId.get(conflictLegacyId)?.key).toBe(legacyKey);
    expect(byId.get(conflictCurrentId)?.key).toBe(currentKey);

    const agents = await sql<{ id: string; adapter_config: Record<string, any>; metadata: Record<string, any> | null }[]>`
      SELECT "id", "adapter_config", "metadata" FROM "agents"
    `;
    const agentById = new Map(agents.map((row) => [row.id, row]));
    expect(agentById.get(agentId)!.adapter_config).toEqual({
      model: "kept",
      wardmoteSkillSync: { desiredSkills: [currentKey, "acme/tools/reviewer"] },
    });
    expect(agentById.get(agentId)!.metadata).toEqual({
      catalogTeam: { catalogKey: "tickernelz/bundled/software-development/review" },
    });
    expect(agentById.get(untouchedAgentId)!.adapter_config).toEqual({
      wardmoteSkillSync: { desiredSkills: ["acme/tools/reviewer"] },
    });

    const [revision] = await sql<{ before_config: Record<string, any>; after_config: Record<string, any> }[]>`
      SELECT "before_config", "after_config" FROM "agent_config_revisions" WHERE "id" = ${revisionId}
    `;
    expect(revision!.after_config).toEqual({ adapterConfig: { wardmoteSkillSync: { desiredSkills: [currentKey] } } });
    expect(revision!.before_config).toEqual({ adapterConfig: { wardmoteSkillSync: { desiredSkills: ["acme/tools/reviewer"] } } });

    const snapshot = async () => ({
      folders: await sql`SELECT * FROM "folders" ORDER BY "id"`,
      skills: await sql`SELECT "id", "key", "metadata", "updated_at" FROM "company_skills" ORDER BY "id"`,
      agents: await sql`SELECT "id", "adapter_config", "metadata" FROM "agents" ORDER BY "id"`,
      revisions: await sql`SELECT "id", "before_config", "after_config" FROM "agent_config_revisions" ORDER BY "id"`,
    });
    const before = await snapshot();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);
    expect(await snapshot()).toEqual(before);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
