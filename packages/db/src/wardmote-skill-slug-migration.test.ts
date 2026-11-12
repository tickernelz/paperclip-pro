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

const MIGRATION_FILE = "0359_wardmote_bundled_skill_slugs.sql";
const RETIRED = "paperclip";
const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function migrationHash() {
  const content = await fs.promises.readFile(new URL(`./migrations/${MIGRATION_FILE}`, import.meta.url), "utf8");
  return createHash("sha256").update(content).digest("hex");
}

describeEmbeddedPostgres("wardmote bundled skill slug migration", () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("renames bundled skill slugs, their source kind and the agent skill-sync key exactly once", async () => {
    const database = await startEmbeddedPostgresTestDatabase("wardmote-skill-slug-migration-");
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, { max: 1 });
    cleanups.push(async () => sql.end());

    const companyId = randomUUID();
    const conflictCompanyId = randomUUID();
    const coreId = randomUUID();
    const slackId = randomUUID();
    const customId = randomUUID();
    const conflictLegacyId = randomUUID();
    const conflictCurrentId = randomUUID();
    const agentId = randomUUID();
    const plainAgentId = randomUUID();
    const scalarAgentId = randomUUID();
    const revisionId = randomUUID();

    await sql`
      INSERT INTO "companies" ("id", "name", "issue_prefix")
      VALUES (${companyId}, 'Skills', 'SKS'), (${conflictCompanyId}, 'Conflict', 'CFS')
    `;
    await sql`
      INSERT INTO "company_skills" ("id", "company_id", "key", "slug", "name", "markdown", "source_locator", "metadata")
      VALUES
        (${coreId}, ${companyId}, ${`tickernelz/wardmote/${RETIRED}`}, ${RETIRED}, ${RETIRED}, '# Core',
          ${`/opt/install/node_modules/@tickernelz/wardmote-server/skills/${RETIRED}`},
          ${sql.json({ skillKey: `tickernelz/wardmote/${RETIRED}`, sourceKind: `${RETIRED}_bundled`, extra: 1 })}),
        (${slackId}, ${companyId}, 'tickernelz/wardmote/slack', 'slack', 'slack', '# Slack', NULL,
          ${sql.json({ skillKey: "tickernelz/wardmote/slack", sourceKind: `${RETIRED}_bundled` })}),
        (${customId}, ${companyId}, ${`acme/tools/${RETIRED}`}, ${RETIRED}, ${RETIRED}, '# Custom', NULL, NULL),
        (${conflictLegacyId}, ${conflictCompanyId}, ${`tickernelz/wardmote/${RETIRED}-board`}, ${`${RETIRED}-board`}, ${`${RETIRED}-board`}, '# Board', NULL, NULL),
        (${conflictCurrentId}, ${conflictCompanyId}, 'tickernelz/wardmote/wardmote-board', 'wardmote-board', 'wardmote-board', '# Board', NULL, NULL)
    `;
    await sql`
      INSERT INTO "agents" ("id", "company_id", "name", "adapter_config")
      VALUES
        (${agentId}, ${companyId}, 'Agent', ${sql.json({
          model: "kept",
          [`${RETIRED}SkillSync`]: {
            desiredSkills: [
              `tickernelz/wardmote/${RETIRED}`,
              `${RETIRED}-converting-plans-to-tasks`,
              "tickernelz/wardmote/para-memory-files",
              `acme/tools/${RETIRED}`,
            ],
            mode: "replace",
          },
        })}),
        (${plainAgentId}, ${companyId}, 'Plain', ${sql.json({ model: "x" })}),
        (${scalarAgentId}, ${companyId}, 'Scalar', ${sql.json({ [`${RETIRED}SkillSync`]: { desiredSkills: "all" } })})
    `;
    await sql`
      INSERT INTO "agent_config_revisions" ("id", "company_id", "agent_id", "changed_keys", "before_config", "after_config")
      VALUES (${revisionId}, ${companyId}, ${agentId}, ${sql.json(["adapterConfig"])},
        ${sql.json({ name: "Agent", adapterConfig: { [`${RETIRED}SkillSync`]: { desiredSkills: [`tickernelz/wardmote/${RETIRED}-create-agent`] } } })},
        ${sql.json({ name: "Agent", adapterConfig: { model: "after" } })})
    `;

    const hash = await migrationHash();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);

    const skills = await sql<{ id: string; key: string; slug: string; name: string; source_locator: string | null; metadata: Record<string, unknown> | null }[]>`
      SELECT "id", "key", "slug", "name", "source_locator", "metadata" FROM "company_skills"
    `;
    const skillById = new Map(skills.map((row) => [row.id, row]));
    expect(skillById.get(coreId)).toMatchObject({
      key: "tickernelz/wardmote/wardmote",
      slug: "wardmote",
      name: "wardmote",
      source_locator: "/opt/install/node_modules/@tickernelz/wardmote-server/skills/wardmote",
      metadata: { skillKey: "tickernelz/wardmote/wardmote", sourceKind: "wardmote_bundled", extra: 1 },
    });
    expect(skillById.get(slackId)).toMatchObject({ key: "tickernelz/wardmote/slack", metadata: { skillKey: "tickernelz/wardmote/slack", sourceKind: "wardmote_bundled" } });
    expect(skillById.get(customId)).toMatchObject({ key: `acme/tools/${RETIRED}`, slug: RETIRED, name: RETIRED, metadata: null });
    expect(skillById.get(conflictLegacyId)?.key).toBe(`tickernelz/wardmote/${RETIRED}-board`);
    expect(skillById.get(conflictCurrentId)?.key).toBe("tickernelz/wardmote/wardmote-board");

    const agents = await sql<{ id: string; adapter_config: Record<string, any> }[]>`SELECT "id", "adapter_config" FROM "agents"`;
    const agentById = new Map(agents.map((row) => [row.id, row.adapter_config]));
    expect(agentById.get(agentId)).toEqual({
      model: "kept",
      wardmoteSkillSync: {
        desiredSkills: [
          "tickernelz/wardmote/wardmote",
          "wardmote-converting-plans-to-tasks",
          "tickernelz/wardmote/para-memory-files",
          `acme/tools/${RETIRED}`,
        ],
        mode: "replace",
      },
    });
    expect(agentById.get(plainAgentId)).toEqual({ model: "x" });
    expect(agentById.get(scalarAgentId)).toEqual({ wardmoteSkillSync: { desiredSkills: "all" } });

    const [revision] = await sql<{ before_config: Record<string, any>; after_config: Record<string, any> }[]>`
      SELECT "before_config", "after_config" FROM "agent_config_revisions" WHERE "id" = ${revisionId}
    `;
    expect(revision).toEqual({
      before_config: { name: "Agent", adapterConfig: { wardmoteSkillSync: { desiredSkills: ["tickernelz/wardmote/wardmote-create-agent"] } } },
      after_config: { name: "Agent", adapterConfig: { model: "after" } },
    });

    const snapshot = async () => ({
      skills: await sql`SELECT "id", "key", "slug", "name", "source_locator", "metadata", "updated_at" FROM "company_skills" ORDER BY "id"`,
      agents: await sql`SELECT "id", "adapter_config" FROM "agents" ORDER BY "id"`,
      revisions: await sql`SELECT "id", "before_config", "after_config" FROM "agent_config_revisions" ORDER BY "id"`,
    });
    const before = await snapshot();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);
    expect(await snapshot()).toEqual(before);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
