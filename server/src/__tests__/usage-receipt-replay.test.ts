import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { agents, companies, createDb, heartbeatRuns, runUsageReceipts } from "@tickernelz/wardmote-db";
import { startEmbeddedPostgresTestDatabase } from "@tickernelz/wardmote-db/test-embedded-postgres";
import { replayUsageReceipts } from "../services/usage-receipts.js";
import { RETIRED_ACCOUNTING_RECEIPT_SCHEMA } from "../services/retired-accounting-receipt-schema.js";

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;

beforeAll(async () => {
  database = await startEmbeddedPostgresTestDatabase("wardmote-usage-receipt-replay-");
  db = createDb(database.connectionString);
}, 120_000);

afterAll(async () => {
  await database?.cleanup();
});

describe("usage receipt spool replay", () => {
  it("replays a receipt spooled before the rename without changing it", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const runId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Receipts", issuePrefix: "RCP" });
    await db.insert(agents).values({ id: agentId, companyId, name: "Agent", adapterType: "codex_local" });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, status: "running" });
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "wardmote-receipt-spool-"));
    const envelope = {
      schema: RETIRED_ACCOUNTING_RECEIPT_SCHEMA, id: randomUUID(), companyId, runId, sourceId: randomUUID(), sequence: 1,
      receivedAt: new Date().toISOString(), adapterType: "codex_local",
      receipt: { usage: { inputTokens: 10, outputTokens: 2 }, complete: true },
    };
    await fs.writeFile(path.join(directory, `${envelope.id}.json`), JSON.stringify(envelope));

    await expect(replayUsageReceipts(db, directory)).resolves.toEqual({ replayed: 1, failed: 0 });
    const rows = await db.select().from(runUsageReceipts).where(eq(runUsageReceipts.runId, runId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.receiptJson.schema).toBe(RETIRED_ACCOUNTING_RECEIPT_SCHEMA);
    await expect(fs.readdir(directory)).resolves.toEqual([]);
    await fs.rm(directory, { recursive: true, force: true });
  }, 60_000);
});
