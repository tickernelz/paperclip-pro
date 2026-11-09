import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { applyPendingMigrations } from "./client.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./test-embedded-postgres.js";

const MIGRATION_FILE = "0358_wardmote_bundled_skill_keys.sql";
const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function migrationHash() {
  const content = await fs.promises.readFile(new URL(`./migrations/${MIGRATION_FILE}`, import.meta.url), "utf8");
  return createHash("sha256").update(content).digest("hex");
}

describeEmbeddedPostgres("wardmote bundled skill key migration", () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("moves bundled skill keys and agent skill selections to the Wardmote prefix exactly once", async () => {
    const database = await startEmbeddedPostgresTestDatabase("wardmote-skill-key-migration-");
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, { max: 1 });
    cleanups.push(async () => sql.end());

    const companyId = randomUUID();
    const conflictCompanyId = randomUUID();
    const migratedSkillId = randomUUID();
    const customSkillId = randomUUID();
    const conflictLegacyId = randomUUID();
    const conflictCurrentId = randomUUID();
    const agentId = randomUUID();
    const untouchedAgentId = randomUUID();

    await sql`
      INSERT INTO "companies" ("id", "name", "issue_prefix")
      VALUES (${companyId}, 'Skills', 'SKL'), (${conflictCompanyId}, 'Conflict', 'CFL')
    `;
    await sql`
      INSERT INTO "company_skills" ("id", "company_id", "key", "slug", "name", "markdown", "metadata")
      VALUES
        (${migratedSkillId}, ${companyId}, 'paperclipai/paperclip/paperclip', 'paperclip', 'Core', '# Core',
          ${sql.json({ skillKey: "paperclipai/paperclip/paperclip", sourceKind: "paperclip_bundled" })}),
        (${customSkillId}, ${companyId}, 'acme/tools/reviewer', 'reviewer', 'Reviewer', '# Reviewer', NULL),
        (${conflictLegacyId}, ${conflictCompanyId}, 'paperclipai/paperclip/slack', 'slack', 'Slack', '# Slack', NULL),
        (${conflictCurrentId}, ${conflictCompanyId}, 'tickernelz/wardmote/slack', 'slack', 'Slack', '# Slack', NULL)
    `;
    await sql`
      INSERT INTO "agents" ("id", "company_id", "name", "adapter_config")
      VALUES
        (${agentId}, ${companyId}, 'Agent', ${sql.json({
          model: "kept",
          paperclipSkillSync: { desiredSkills: ["paperclipai/paperclip/paperclip", "acme/tools/reviewer", "tickernelz/wardmote/paperclip"] },
        })}),
        (${untouchedAgentId}, ${companyId}, 'Untouched', ${sql.json({ paperclipSkillSync: { desiredSkills: ["acme/tools/reviewer"] } })})
    `;

    const hash = await migrationHash();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);

    const skills = await sql<{ id: string; key: string; metadata: Record<string, unknown> | null }[]>`
      SELECT "id", "key", "metadata" FROM "company_skills" ORDER BY "id"
    `;
    const byId = new Map(skills.map((row) => [row.id, row]));
    expect(byId.get(migratedSkillId)).toMatchObject({
      key: "tickernelz/wardmote/paperclip",
      metadata: { skillKey: "tickernelz/wardmote/paperclip", sourceKind: "paperclip_bundled" },
    });
    expect(byId.get(customSkillId)?.key).toBe("acme/tools/reviewer");
    expect(byId.get(conflictLegacyId)?.key).toBe("paperclipai/paperclip/slack");
    expect(byId.get(conflictCurrentId)?.key).toBe("tickernelz/wardmote/slack");

    const [agent] = await sql<{ adapter_config: Record<string, any> }[]>`
      SELECT "adapter_config" FROM "agents" WHERE "id" = ${agentId}
    `;
    expect(agent!.adapter_config.model).toBe("kept");
    expect([...agent!.adapter_config.paperclipSkillSync.desiredSkills].sort()).toEqual([
      "acme/tools/reviewer",
      "tickernelz/wardmote/paperclip",
    ]);
    const [untouched] = await sql<{ adapter_config: Record<string, any> }[]>`
      SELECT "adapter_config" FROM "agents" WHERE "id" = ${untouchedAgentId}
    `;
    expect(untouched!.adapter_config.paperclipSkillSync.desiredSkills).toEqual(["acme/tools/reviewer"]);

    const before = await sql`SELECT "id", "key", "metadata", "updated_at" FROM "company_skills" ORDER BY "id"`;
    const agentsBefore = await sql`SELECT "id", "adapter_config" FROM "agents" ORDER BY "id"`;
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);
    expect(await sql`SELECT "id", "key", "metadata", "updated_at" FROM "company_skills" ORDER BY "id"`).toEqual(before);
    expect(await sql`SELECT "id", "adapter_config" FROM "agents" ORDER BY "id"`).toEqual(agentsBefore);
  });
});
