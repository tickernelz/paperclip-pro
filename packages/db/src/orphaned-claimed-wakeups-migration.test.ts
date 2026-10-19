import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./test-embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const migration = readFileSync(new URL("./migrations/0350_finalize_orphaned_claimed_wakeups.sql", import.meta.url), "utf8");

(support.supported ? describe : describe.skip)("orphaned claimed wakeup repair migration", () => {
  it("finalizes claimed wakeups of terminal runs once and leaves live ones alone", async () => {
    const database = await startEmbeddedPostgresTestDatabase("paperclip-claimed-wakeup-repair-");
    const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    try {
      const companyId = randomUUID();
      const agentId = randomUUID();
      await sql`INSERT INTO companies (id, name, issue_prefix) VALUES (${companyId}, 'Wake repair', 'WKR')`;
      await sql`INSERT INTO agents (id, company_id, name, role, adapter_type) VALUES (${agentId}, ${companyId}, 'Agent', 'engineer', 'codex_local')`;
      const finishedAt = new Date("2026-10-16T16:28:00Z");
      const cases = [
        { key: "interrupted", runStatus: "interrupted", wake: "claimed", expected: "failed", link: "run_id" },
        { key: "interrupted-by-wake-id", runStatus: "interrupted", wake: "claimed", expected: "failed", link: "wakeup_request_id" },
        { key: "succeeded", runStatus: "succeeded", wake: "claimed", expected: "completed", link: "run_id" },
        { key: "cancelled", runStatus: "cancelled", wake: "claimed", expected: "cancelled", link: "run_id" },
        { key: "running", runStatus: "running", wake: "claimed", expected: "claimed", link: "run_id" },
        { key: "already-completed", runStatus: "interrupted", wake: "completed", expected: "completed", link: "run_id" },
      ];
      const wakeIds = new Map<string, string>();
      for (const c of cases) {
        const wakeId = randomUUID();
        const runId = randomUUID();
        wakeIds.set(c.key, wakeId);
        await sql`INSERT INTO agent_wakeup_requests (id, company_id, agent_id, source, status, claimed_at) VALUES (${wakeId}, ${companyId}, ${agentId}, 'automation', ${c.wake}, now())`;
        if (c.link === "run_id") {
          await sql`UPDATE agent_wakeup_requests SET run_id = ${runId} WHERE id = ${wakeId}`;
          await sql`INSERT INTO heartbeat_runs (id, company_id, agent_id, status, finished_at, error) VALUES (${runId}, ${companyId}, ${agentId}, ${c.runStatus}, ${c.runStatus === "running" ? null : finishedAt}, 'run terminalized by recovery backstop')`;
        } else {
          await sql`INSERT INTO heartbeat_runs (id, company_id, agent_id, status, finished_at, error, wakeup_request_id) VALUES (${runId}, ${companyId}, ${agentId}, ${c.runStatus}, ${finishedAt}, 'run terminalized by recovery backstop', ${wakeId})`;
        }
      }
      const orphanWakeId = randomUUID();
      await sql`INSERT INTO agent_wakeup_requests (id, company_id, agent_id, source, status) VALUES (${orphanWakeId}, ${companyId}, ${agentId}, 'automation', 'claimed')`;

      const snapshot = async () =>
        Object.fromEntries(
          (await sql`SELECT id, status, finished_at, error FROM agent_wakeup_requests WHERE company_id = ${companyId}`).map((row) => [row.id, row]),
        );
      const apply = async () => {
        for (const statement of migration.split("--> statement-breakpoint")) {
          if (statement.trim()) await sql.unsafe(statement);
        }
      };

      await apply();
      const first = await snapshot();
      for (const c of cases) expect(first[wakeIds.get(c.key)!].status).toBe(c.expected);
      expect(first[orphanWakeId].status).toBe("claimed");
      const repaired = first[wakeIds.get("interrupted")!];
      expect(new Date(repaired.finished_at).toISOString()).toBe(finishedAt.toISOString());
      expect(repaired.error).toBe("run terminalized by recovery backstop");
      expect(first[wakeIds.get("running")!].finished_at).toBeNull();

      await apply();
      expect(await snapshot()).toEqual(first);
    } finally {
      await sql.end();
      await database.cleanup();
    }
  }, 30_000);
});
