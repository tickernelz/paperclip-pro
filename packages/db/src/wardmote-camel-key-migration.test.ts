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

const MIGRATION_FILE = "0363_wardmote_camel_keys.sql";
const OLD = "paper" + "clip";
const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function migrationHash() {
  const content = await fs.promises.readFile(new URL(`./migrations/${MIGRATION_FILE}`, import.meta.url), "utf8");
  return createHash("sha256").update(content).digest("hex");
}

describeEmbeddedPostgres("wardmote camelCase key migration", () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("renames stored camelCase keys in live rows and recent run context exactly once", async () => {
    const database = await startEmbeddedPostgresTestDatabase("wardmote-camel-key-migration-");
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, { max: 1 });
    cleanups.push(async () => sql.end());

    const companyId = randomUUID();
    const agentId = randomUUID();
    const builtInId = randomUUID();
    const sessionId = randomUUID();
    const openWakeId = randomUUID();
    const doneWakeId = randomUUID();
    const recentRunId = randomUUID();
    const oldRunId = randomUUID();
    const oldRedactedRunId = randomUUID();
    const revisionId = randomUUID();

    await sql`INSERT INTO "companies" ("id", "name", "issue_prefix") VALUES (${companyId}, 'Keys', 'KEY')`;
    await sql`
      INSERT INTO "instance_settings" ("singleton_key", "experimental")
      VALUES ('default', ${sql.json({ ["enable" + "Paper" + "clipDeveloperMode"]: true, other: 1 })})
      ON CONFLICT ("singleton_key") DO UPDATE SET "experimental" = excluded."experimental"
    `;
    await sql`
      INSERT INTO "agents" ("id", "company_id", "name", "adapter_config", "metadata")
      VALUES
        (${agentId}, ${companyId}, 'Agent', ${sql.json({ [`${OLD}Mcp`]: { enabled: true }, [`${OLD}McpToolsets`]: ["core"], env: { [`${OLD.toUpperCase()}_KEPT`]: "operator" }, nested: [{ [`${OLD}Wake`]: 1 }] })}, ${sql.json({})}),
        (${builtInId}, ${companyId}, 'Built in', ${sql.json({})}, ${sql.json({ [`${OLD}BuiltInAgent`]: { key: "reflection" } })})
    `;
    await sql`
      INSERT INTO "agent_config_revisions" ("id", "company_id", "agent_id", "changed_keys", "before_config", "after_config")
      VALUES (${revisionId}, ${companyId}, ${agentId}, ${sql.json(["adapterConfig"])},
        ${sql.json({ adapterConfig: { [`${OLD}McpToolsets`]: ["core"] } })}, ${sql.json({ adapterConfig: { model: "kept" } })})
    `;
    await sql`
      INSERT INTO "agent_task_sessions" ("id", "company_id", "agent_id", "adapter_type", "task_key", "session_params_json")
      VALUES (${sessionId}, ${companyId}, ${agentId}, 'omp_local', 'issue:a', ${sql.json({ [`${OLD}ConnectionInstructions`]: "text" })})
    `;
    await sql`
      INSERT INTO "agent_wakeup_requests" ("id", "company_id", "agent_id", "source", "status", "payload")
      VALUES
        (${openWakeId}, ${companyId}, ${agentId}, 'on_demand', 'queued', ${sql.json({ [`${OLD}AgentMessage`]: "hi" })}),
        (${doneWakeId}, ${companyId}, ${agentId}, 'on_demand', 'completed', ${sql.json({ [`${OLD}AgentMessage`]: "old" })})
    `;
    await sql`
      INSERT INTO "heartbeat_runs" ("id", "company_id", "agent_id", "status", "created_at", "context_snapshot")
      VALUES
        (${recentRunId}, ${companyId}, ${agentId}, 'succeeded', now(), ${sql.json({ [`${OLD}Openwa`]: { chat: 1 }, issueId: "i", [`${OLD}Wake`]: { reason: "x" } })}),
        (${oldRunId}, ${companyId}, ${agentId}, 'succeeded', now() - interval '30 days', ${sql.json({ [`${OLD}Wake`]: { reason: "y" } })}),
        (${oldRedactedRunId}, ${companyId}, ${agentId}, 'failed', now() - interval '30 days', ${sql.json({ [`${OLD}SecretRedactions`]: ["s"] })})
    `;

    const hash = await migrationHash();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);

    const [settings] = await sql<{ experimental: Record<string, unknown> }[]>`SELECT "experimental" FROM "instance_settings" WHERE "singleton_key" = 'default'`;
    expect(settings!.experimental).toEqual({ enableWardmoteDeveloperMode: true, other: 1 });

    const agents = new Map((await sql<{ id: string; adapter_config: unknown; metadata: unknown }[]>`SELECT "id", "adapter_config", "metadata" FROM "agents"`).map((row) => [row.id, row]));
    expect(agents.get(agentId)?.adapter_config).toEqual({
      wardmoteMcp: { enabled: true },
      wardmoteMcpToolsets: ["core"],
      env: { [`${OLD.toUpperCase()}_KEPT`]: "operator" },
      nested: [{ wardmoteWake: 1 }],
    });
    expect(agents.get(builtInId)?.metadata).toEqual({ wardmoteBuiltInAgent: { key: "reflection" } });

    const [revision] = await sql<{ before_config: unknown; after_config: unknown }[]>`SELECT "before_config", "after_config" FROM "agent_config_revisions" WHERE "id" = ${revisionId}`;
    expect(revision).toEqual({ before_config: { adapterConfig: { wardmoteMcpToolsets: ["core"] } }, after_config: { adapterConfig: { model: "kept" } } });

    const [session] = await sql<{ session_params_json: unknown }[]>`SELECT "session_params_json" FROM "agent_task_sessions" WHERE "id" = ${sessionId}`;
    expect(session!.session_params_json).toEqual({ wardmoteConnectionInstructions: "text" });

    const wakes = new Map((await sql<{ id: string; payload: unknown }[]>`SELECT "id", "payload" FROM "agent_wakeup_requests"`).map((row) => [row.id, row.payload]));
    expect(wakes.get(openWakeId)).toEqual({ wardmoteAgentMessage: "hi" });
    expect(wakes.get(doneWakeId)).toEqual({ [`${OLD}AgentMessage`]: "old" });

    const runs = new Map((await sql<{ id: string; context_snapshot: unknown }[]>`SELECT "id", "context_snapshot" FROM "heartbeat_runs"`).map((row) => [row.id, row.context_snapshot]));
    expect(runs.get(recentRunId)).toEqual({ wardmoteOpenwa: { chat: 1 }, issueId: "i", wardmoteWake: { reason: "x" } });
    expect(runs.get(oldRunId)).toEqual({ [`${OLD}Wake`]: { reason: "y" } });
    expect(runs.get(oldRedactedRunId)).toEqual({ wardmoteSecretRedactions: ["s"] });

    await expect(sql`
      INSERT INTO "agents" ("id", "company_id", "name", "metadata")
      VALUES (${randomUUID()}, ${companyId}, 'Duplicate', ${sql.json({ wardmoteBuiltInAgent: { key: "reflection" } })})
    `).rejects.toMatchObject({ code: "23505" });

    const snapshot = async () => ({
      settings: await sql`SELECT "experimental" FROM "instance_settings"`,
      agents: await sql`SELECT "id", "adapter_config", "metadata" FROM "agents" ORDER BY "id"`,
      revisions: await sql`SELECT "before_config", "after_config" FROM "agent_config_revisions"`,
      sessions: await sql`SELECT "session_params_json" FROM "agent_task_sessions"`,
      wakes: await sql`SELECT "id", "payload" FROM "agent_wakeup_requests" ORDER BY "id"`,
      runs: await sql`SELECT "id", "context_snapshot" FROM "heartbeat_runs" ORDER BY "id"`,
    });
    const before = await snapshot();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);
    expect(await snapshot()).toEqual(before);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
