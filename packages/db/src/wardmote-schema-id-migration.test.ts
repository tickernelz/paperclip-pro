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

const MIGRATION_FILE = "0367_wardmote_schema_ids.sql";
const OLD = ["paper", "clip"].join("");
const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function migrationHash() {
  const content = await fs.promises.readFile(new URL(`./migrations/${MIGRATION_FILE}`, import.meta.url), "utf8");
  return createHash("sha256").update(content).digest("hex");
}

describeEmbeddedPostgres("wardmote schema id migration", () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("renames the stored schema ids that readers compare, and leaves hashed native events alone", async () => {
    const database = await startEmbeddedPostgresTestDatabase("wardmote-schema-id-migration-");
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    cleanups.push(async () => sql.end());

    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const runId = randomUUID();
    const interactionId = randomUUID();
    const otherInteractionId = randomUUID();
    const decision = (prefix: string) => ({ schema: `${prefix}.run_presentation_decision.v1`, chosenSource: "none", commentId: null });
    await sql`INSERT INTO "companies" ("id", "name", "issue_prefix") VALUES (${companyId}, 'Schemas', 'SCH')`;
    await sql`INSERT INTO "agents" ("id", "company_id", "name") VALUES (${agentId}, ${companyId}, 'Agent')`;
    await sql`INSERT INTO "issues" ("id", "company_id", "title", "identifier") VALUES (${issueId}, ${companyId}, 'Schemas', 'SCH-1')`;
    await sql`
      INSERT INTO "heartbeat_runs" ("id", "company_id", "agent_id", "status", "result_json")
      VALUES (${runId}, ${companyId}, ${agentId}, 'succeeded', ${sql.json({
        presentationDecision: decision(OLD),
        nativeResult: { schema: `${OLD}.run_result.v1` },
      })})
    `;
    await sql`
      INSERT INTO "heartbeat_run_events" ("company_id", "run_id", "agent_id", "seq", "event_type", "payload", "source_payload_sha256")
      VALUES
        (${companyId}, ${runId}, ${agentId}, 1, 'presentation', ${sql.json({ presentationDecision: decision(OLD) })}, NULL),
        (${companyId}, ${runId}, ${agentId}, 2, 'presentation', ${sql.json({ presentationDecision: decision(OLD) })}, 'sha256-of-source')
    `;
    await sql`
      INSERT INTO "agent_instruction_working_copies" (
        "run_id", "company_id", "agent_id", "responsible_user_id", "entry_file", "base_hash", "local_root", "execution_root", "location", "receipt"
      )
      VALUES (${runId}, ${companyId}, ${agentId}, 'user', 'AGENTS.md', 'hash', '/local', '/exec', 'local',
        ${sql.json({ schema: `${OLD}.agent-files.v1`, files: ["AGENTS.md"] })})
    `;
    await sql`
      INSERT INTO "issue_thread_interactions" ("id", "company_id", "issue_id", "kind", "payload")
      VALUES
        (${interactionId}, ${companyId}, ${issueId}, 'ask_user_questions',
          ${sql.json({ version: 1, questions: [{ id: "q", prompt: "Proceed?" }], questionSet: { schema: `${OLD}.question_set.v1`, questions: [] } })}),
        (${otherInteractionId}, ${companyId}, ${issueId}, 'request_confirmation', ${sql.json({ prompt: "Ship?" })})
    `;

    const hash = await migrationHash();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);

    const [run] = await sql<{ result_json: Record<string, unknown> }[]>`SELECT "result_json" FROM "heartbeat_runs" WHERE "id" = ${runId}`;
    expect(run!.result_json).toEqual({
      presentationDecision: decision("wardmote"),
      nativeResult: { schema: `${OLD}.run_result.v1` },
    });
    const events = await sql<{ seq: number; payload: Record<string, unknown> }[]>`
      SELECT "seq"::int AS "seq", "payload" FROM "heartbeat_run_events" WHERE "run_id" = ${runId} ORDER BY "seq"
    `;
    expect(events).toEqual([
      { seq: 1, payload: { presentationDecision: decision("wardmote") } },
      { seq: 2, payload: { presentationDecision: decision(OLD) } },
    ]);
    const [copy] = await sql<{ receipt: Record<string, unknown> }[]>`SELECT "receipt" FROM "agent_instruction_working_copies" WHERE "run_id" = ${runId}`;
    expect(copy!.receipt).toEqual({ schema: "wardmote.agent-files.v1", files: ["AGENTS.md"] });
    const interactions = await sql<{ id: string; payload: Record<string, unknown> }[]>`
      SELECT "id", "payload" FROM "issue_thread_interactions" WHERE "issue_id" = ${issueId}
    `;
    expect(new Map(interactions.map((row) => [row.id, row.payload]))).toEqual(new Map([
      [interactionId, { version: 1, questions: [{ id: "q", prompt: "Proceed?" }], questionSet: { schema: "wardmote.question_set.v1", questions: [] } }],
      [otherInteractionId, { prompt: "Ship?" }],
    ]));

    const snapshot = async () => ({
      runs: await sql`SELECT "id", "result_json" FROM "heartbeat_runs" ORDER BY "id"`,
      events: await sql`SELECT "id", "payload" FROM "heartbeat_run_events" ORDER BY "id"`,
      copies: await sql`SELECT "run_id", "receipt" FROM "agent_instruction_working_copies" ORDER BY "run_id"`,
      interactions: await sql`SELECT "id", "payload" FROM "issue_thread_interactions" ORDER BY "id"`,
    });
    const before = await snapshot();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);
    expect(await snapshot()).toEqual(before);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
