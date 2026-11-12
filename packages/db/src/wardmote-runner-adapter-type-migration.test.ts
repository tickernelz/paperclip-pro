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

const MIGRATION_FILE = "0362_wardmote_runner_adapter_type.sql";
const RETIRED_TYPE = "paperclip_runner";
const RETIRED_REASON = `${RETIRED_TYPE}_protocol`;
const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function migrationHash() {
  const content = await fs.promises.readFile(new URL(`./migrations/${MIGRATION_FILE}`, import.meta.url), "utf8");
  return createHash("sha256").update(content).digest("hex");
}

describeEmbeddedPostgres("wardmote runner adapter type migration", () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("moves stored runner adapter types and comment authorization reasons to the wardmote name exactly once", async () => {
    const database = await startEmbeddedPostgresTestDatabase("wardmote-runner-adapter-type-migration-");
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, { max: 1 });
    cleanups.push(async () => sql.end());

    const companyId = randomUUID();
    const runnerAgentId = randomUUID();
    const localAgentId = randomUUID();
    const movedSessionId = randomUUID();
    const conflictLegacySessionId = randomUUID();
    const conflictCurrentSessionId = randomUUID();
    const revisionId = randomUUID();
    const approvalId = randomUUID();
    const otherApprovalId = randomUUID();
    const issueId = randomUUID();
    const runnerCommentId = randomUUID();
    const otherCommentId = randomUUID();

    await sql`INSERT INTO "companies" ("id", "name", "issue_prefix") VALUES (${companyId}, 'Runner', 'RUN')`;
    await sql`
      INSERT INTO "agents" ("id", "company_id", "name", "adapter_type", "adapter_config")
      VALUES
        (${runnerAgentId}, ${companyId}, 'Runner', ${RETIRED_TYPE}, ${sql.json({ model: "kept" })}),
        (${localAgentId}, ${companyId}, 'Local', 'omp_local', ${sql.json({})})
    `;
    await sql`
      INSERT INTO "agent_runtime_state" ("agent_id", "company_id", "adapter_type")
      VALUES (${runnerAgentId}, ${companyId}, ${RETIRED_TYPE}), (${localAgentId}, ${companyId}, 'omp_local')
    `;
    await sql`
      INSERT INTO "agent_task_sessions" ("id", "company_id", "agent_id", "adapter_type", "task_key")
      VALUES
        (${movedSessionId}, ${companyId}, ${runnerAgentId}, ${RETIRED_TYPE}, 'issue:a'),
        (${conflictLegacySessionId}, ${companyId}, ${runnerAgentId}, ${RETIRED_TYPE}, 'issue:b'),
        (${conflictCurrentSessionId}, ${companyId}, ${runnerAgentId}, 'wardmote_runner', 'issue:b')
    `;
    await sql`
      INSERT INTO "agent_config_revisions" ("id", "company_id", "agent_id", "changed_keys", "before_config", "after_config")
      VALUES (${revisionId}, ${companyId}, ${runnerAgentId}, ${sql.json(["adapterType"])},
        ${sql.json({ name: "Runner", adapterType: "omp_local" })},
        ${sql.json({ name: "Runner", adapterType: RETIRED_TYPE, adapterConfig: { model: "kept" } })})
    `;
    await sql`
      INSERT INTO "approvals" ("id", "company_id", "type", "payload")
      VALUES
        (${approvalId}, ${companyId}, 'hire_agent', ${sql.json({ name: "Hire", adapterType: RETIRED_TYPE })}),
        (${otherApprovalId}, ${companyId}, 'hire_agent', ${sql.json({ name: "Other", adapterType: "omp_local" })})
    `;
    await sql`INSERT INTO "issues" ("id", "company_id", "title") VALUES (${issueId}, ${companyId}, 'Issue')`;
    await sql`
      INSERT INTO "issue_comments" ("id", "company_id", "issue_id", "body", "metadata")
      VALUES
        (${runnerCommentId}, ${companyId}, ${issueId}, 'runner', ${sql.json({ authorizationReason: RETIRED_REASON, kept: 1 })}),
        (${otherCommentId}, ${companyId}, ${issueId}, ${`mentions ${RETIRED_TYPE} in prose`}, ${sql.json({ authorizationReason: "allow_board" })})
    `;

    const hash = await migrationHash();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);

    const agents = await sql<{ id: string; adapter_type: string; adapter_config: Record<string, unknown> }[]>`
      SELECT "id", "adapter_type", "adapter_config" FROM "agents"
    `;
    expect(new Map(agents.map((row) => [row.id, row.adapter_type]))).toEqual(
      new Map([[runnerAgentId, "wardmote_runner"], [localAgentId, "omp_local"]]),
    );
    expect(agents.find((row) => row.id === runnerAgentId)?.adapter_config).toEqual({ model: "kept" });

    const runtime = await sql<{ agent_id: string; adapter_type: string }[]>`SELECT "agent_id", "adapter_type" FROM "agent_runtime_state"`;
    expect(new Map(runtime.map((row) => [row.agent_id, row.adapter_type]))).toEqual(
      new Map([[runnerAgentId, "wardmote_runner"], [localAgentId, "omp_local"]]),
    );

    const sessions = await sql<{ id: string; adapter_type: string }[]>`SELECT "id", "adapter_type" FROM "agent_task_sessions"`;
    expect(new Map(sessions.map((row) => [row.id, row.adapter_type]))).toEqual(
      new Map([
        [movedSessionId, "wardmote_runner"],
        [conflictLegacySessionId, RETIRED_TYPE],
        [conflictCurrentSessionId, "wardmote_runner"],
      ]),
    );

    const [revision] = await sql<{ before_config: unknown; after_config: unknown }[]>`
      SELECT "before_config", "after_config" FROM "agent_config_revisions" WHERE "id" = ${revisionId}
    `;
    expect(revision).toEqual({
      before_config: { name: "Runner", adapterType: "omp_local" },
      after_config: { name: "Runner", adapterType: "wardmote_runner", adapterConfig: { model: "kept" } },
    });

    const approvals = await sql<{ id: string; payload: Record<string, unknown> }[]>`SELECT "id", "payload" FROM "approvals"`;
    expect(new Map(approvals.map((row) => [row.id, row.payload]))).toEqual(
      new Map([
        [approvalId, { name: "Hire", adapterType: "wardmote_runner" }],
        [otherApprovalId, { name: "Other", adapterType: "omp_local" }],
      ]),
    );

    const comments = await sql<{ id: string; body: string; metadata: Record<string, unknown> }[]>`
      SELECT "id", "body", "metadata" FROM "issue_comments"
    `;
    expect(new Map(comments.map((row) => [row.id, [row.body, row.metadata]]))).toEqual(
      new Map([
        [runnerCommentId, ["runner", { authorizationReason: "wardmote_runner_protocol", kept: 1 }]],
        [otherCommentId, [`mentions ${RETIRED_TYPE} in prose`, { authorizationReason: "allow_board" }]],
      ]),
    );

    const snapshot = async () => ({
      agents: await sql`SELECT "id", "adapter_type", "adapter_config", "updated_at" FROM "agents" ORDER BY "id"`,
      runtime: await sql`SELECT * FROM "agent_runtime_state" ORDER BY "agent_id"`,
      sessions: await sql`SELECT * FROM "agent_task_sessions" ORDER BY "id"`,
      revisions: await sql`SELECT "id", "before_config", "after_config" FROM "agent_config_revisions" ORDER BY "id"`,
      approvals: await sql`SELECT "id", "payload" FROM "approvals" ORDER BY "id"`,
      comments: await sql`SELECT "id", "metadata" FROM "issue_comments" ORDER BY "id"`,
    });
    const before = await snapshot();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);
    expect(await snapshot()).toEqual(before);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
