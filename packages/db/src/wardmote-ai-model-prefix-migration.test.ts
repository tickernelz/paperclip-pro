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

const MIGRATION_FILE = "0376_wardmote_ai_model_prefix.sql";
const RETIRED_PREFIX = "paperclip/";
const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function migrationHash() {
  const content = await fs.promises.readFile(new URL(`./migrations/${MIGRATION_FILE}`, import.meta.url), "utf8");
  return createHash("sha256").update(content).digest("hex");
}

describeEmbeddedPostgres("wardmote AI model prefix migration", () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("renames managed OpenCode model ids and leaves other harnesses", async () => {
    const database = await startEmbeddedPostgresTestDatabase("wardmote-ai-model-prefix-migration-");
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    cleanups.push(async () => sql.end());

    const companyId = randomUUID();
    const runnerOpencode = randomUUID();
    const legacyOpencode = randomUUID();
    const runnerCodex = randomUUID();
    const ompAgent = randomUUID();
    const openrouterAgent = randomUUID();
    const config = (provider: string | null, model: string) =>
      sql.json(provider ? { provider, model, cwd: "/work" } : { model, cwd: "/work" });
    await sql`SET session_replication_role = replica`;
    await sql`
      INSERT INTO "agents" ("id", "company_id", "name", "adapter_type", "adapter_config")
      VALUES
        (${runnerOpencode}, ${companyId}, 'runner-opencode', 'wardmote_runner', ${config("opencode", `${RETIRED_PREFIX}private-model`)}),
        (${legacyOpencode}, ${companyId}, 'legacy-opencode', 'opencode_local', ${config(null, `${RETIRED_PREFIX}gpt-5`)}),
        (${runnerCodex}, ${companyId}, 'runner-codex', 'wardmote_runner', ${config("codex", `${RETIRED_PREFIX}raw-id`)}),
        (${ompAgent}, ${companyId}, 'omp', 'omp_local', ${config(null, `${RETIRED_PREFIX}custom-provider-model`)}),
        (${openrouterAgent}, ${companyId}, 'openrouter', 'wardmote_runner', ${config("opencode", "openrouter/anthropic/claude-sonnet-4.6")})
    `;
    await sql`SET session_replication_role = DEFAULT`;

    const hash = await migrationHash();
    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);

    const snapshot = async () =>
      new Map((await sql`SELECT "id", "adapter_config" FROM "agents" WHERE "company_id" = ${companyId}`).map((row) => [row.id, row.adapter_config]));
    const after = await snapshot();
    expect(after.get(runnerOpencode)).toEqual({ provider: "opencode", model: "wardmote/private-model", cwd: "/work" });
    expect(after.get(legacyOpencode)).toEqual({ model: "wardmote/gpt-5", cwd: "/work" });
    expect(after.get(runnerCodex)).toEqual({ provider: "codex", model: `${RETIRED_PREFIX}raw-id`, cwd: "/work" });
    expect(after.get(ompAgent)).toEqual({ model: `${RETIRED_PREFIX}custom-provider-model`, cwd: "/work" });
    expect(after.get(openrouterAgent)).toEqual({ provider: "opencode", model: "openrouter/anthropic/claude-sonnet-4.6", cwd: "/work" });

    await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${hash}`;
    await applyPendingMigrations(database.connectionString);
    expect(await snapshot()).toEqual(after);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
