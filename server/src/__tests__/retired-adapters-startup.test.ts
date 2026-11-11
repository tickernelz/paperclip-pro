import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb } from "@tickernelz/wardmote-db";
import { RETIRED_ADAPTER_TYPES } from "@tickernelz/wardmote-shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { reconcileBuiltInAgentsOnStartup } from "../services/built-in-agents.js";
import { agentService } from "../services/agents.js";
import { evaluateAgentInvokability } from "../services/agent-invokability.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres retired adapter tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("stored agents with a removed adapter type", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("wardmote-retired-adapters-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("survives startup reconciliation, keeps the rows intact, and lists them as blocked legacy agents", async () => {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Legacy",
      issuePrefix: `L${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    const legacyRows = RETIRED_ADAPTER_TYPES.map((adapterType, index) => ({
      id: randomUUID(),
      companyId,
      name: `Legacy ${index}`,
      role: "engineer" as const,
      status: "idle" as const,
      adapterType,
      adapterConfig: { model: `saved-model-${index}`, env: { KEEP: { type: "plain", value: adapterType } } },
    }));
    const ompId = randomUUID();
    await db.insert(agents).values([
      ...legacyRows,
      { id: ompId, companyId, name: "Omp", role: "engineer", status: "idle", adapterType: "omp_local" },
    ]);

    const startup = await reconcileBuiltInAgentsOnStartup(db);
    expect(startup.companyFailures).toBe(0);

    const listed = await agentService(db).list(companyId);
    for (const row of legacyRows) {
      const [stored] = await db.select().from(agents).where(eq(agents.id, row.id));
      expect(stored).toMatchObject({ adapterType: row.adapterType, adapterConfig: row.adapterConfig, status: "idle" });
      const agent = listed.find((candidate) => candidate.id === row.id);
      expect(agent?.adapterType).toBe(row.adapterType);
      const verdict = evaluateAgentInvokability(agent!, listed);
      expect(verdict).toMatchObject({ invokable: false, reason: "adapter_retired" });
    }
    const omp = listed.find((candidate) => candidate.id === ompId);
    expect(evaluateAgentInvokability(omp!, listed)).toEqual({ invokable: true });
  });
});
