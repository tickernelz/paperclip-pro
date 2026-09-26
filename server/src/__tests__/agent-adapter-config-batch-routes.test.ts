import { randomUUID } from "node:crypto";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { activityLog, agents } from "@tickernelz/paperclip-pro-db";
import type { AgentAdapterConfigBatchPreview } from "@tickernelz/paperclip-pro-shared";
import {
  registerServerAdapter,
  unregisterServerAdapter,
} from "../adapters/registry.js";
import type { ServerAdapterModule } from "../adapters/types.js";
import { agentRoutes } from "../routes/agents.js";
import { invalidateAdapterConfigSchema } from "../services/adapter-config-schema.js";
import {
  describeEmbeddedPostgres,
  resetCompanyIssueFixtures,
  routeApp,
  seedCompanyWithBoardAccess,
  useEmbeddedPostgres,
  type BoardActor,
  type SeededCompany,
} from "./helpers/route-test-harness.js";

const ADAPTER_TYPE = "batch_config_fake";
const OTHER_ADAPTER_TYPE = "batch_config_fake_thinkless";

function fakeAdapter(type: string, thinking: boolean): ServerAdapterModule {
  return {
    type,
    execute: async () => {
      throw new Error("not executed in this suite");
    },
    testEnvironment: async () => ({ status: "ok" as const, checks: [] }),
    getConfigSchema: async () => ({
      fields: [
        {
          key: "model",
          label: "Model",
          type: "combobox" as const,
          options: [
            { value: "vendor/fast", label: "Fast" },
            { value: "vendor/deep", label: "Deep" },
          ],
        },
        ...(thinking
          ? [
              {
                key: "thinking",
                label: "Thinking",
                type: "select" as const,
                options: [
                  { value: "low", label: "low" },
                  { value: "high", label: "high" },
                ],
              },
            ]
          : []),
        { key: "timeoutSec", label: "Timeout", type: "number" as const },
      ],
    }),
  } as unknown as ServerAdapterModule;
}

describeEmbeddedPostgres("batch agent adapter config routes", () => {
  const ctx = useEmbeddedPostgres("paperclip-agent-config-batch-", {
    resetEach: async (db) => {
      await db.delete(activityLog);
      await db.delete(agents);
      await resetCompanyIssueFixtures(db);
    },
  });

  beforeAll(() => {
    registerServerAdapter(fakeAdapter(ADAPTER_TYPE, true));
    registerServerAdapter(fakeAdapter(OTHER_ADAPTER_TYPE, false));
    invalidateAdapterConfigSchema(ADAPTER_TYPE);
    invalidateAdapterConfigSchema(OTHER_ADAPTER_TYPE);
  });

  afterAll(() => {
    unregisterServerAdapter(ADAPTER_TYPE);
    unregisterServerAdapter(OTHER_ADAPTER_TYPE);
  });

  async function seedAgent(
    company: SeededCompany,
    name: string,
    adapterConfig: Record<string, unknown> = {},
    adapterType = ADAPTER_TYPE,
  ) {
    const id = randomUUID();
    await ctx.db.insert(agents).values({
      id,
      companyId: company.companyId,
      name,
      adapterType,
      adapterConfig,
    });
    return id;
  }

  const appFor = (actor: BoardActor) => routeApp(ctx.db, actor, agentRoutes);

  const storedConfig = async (agentId: string) =>
    ctx.db
      .select({ adapterConfig: agents.adapterConfig })
      .from(agents)
      .where(eq(agents.id, agentId))
      .then((rows) => rows[0]?.adapterConfig ?? null);

  const auditRows = async (companyId: string, agentId: string) =>
    ctx.db
      .select({ action: activityLog.action, details: activityLog.details, actorType: activityLog.actorType })
      .from(activityLog)
      .where(and(eq(activityLog.companyId, companyId), eq(activityLog.entityId, agentId)));

  it("lists the fields two agents on the same adapter share", async () => {
    const company = await seedCompanyWithBoardAccess(ctx.db, "Batch preview");
    const first = await seedAgent(company, "First", { model: "vendor/fast" });
    const second = await seedAgent(company, "Second");
    const res = await request(appFor(company.actor))
      .post("/api/agents/batch/adapter-config/preview")
      .send({ agentIds: [first, second] })
      .expect(200);
    const preview = res.body as AgentAdapterConfigBatchPreview;
    expect(preview.fields.map((field) => field.key).sort()).toEqual(["model", "thinking"]);
    expect(preview.agents).toHaveLength(2);
    expect(preview.agents.every((agent) => agent.eligible)).toBe(true);
    expect(preview.agents.find((agent) => agent.agentId === first)?.current.model).toBe(
      "vendor/fast",
    );
  });

  it("offers only the fields every selected adapter exposes", async () => {
    const company = await seedCompanyWithBoardAccess(ctx.db, "Batch preview mixed");
    const first = await seedAgent(company, "First");
    const second = await seedAgent(company, "Second", {}, OTHER_ADAPTER_TYPE);
    const res = await request(appFor(company.actor))
      .post("/api/agents/batch/adapter-config/preview")
      .send({ agentIds: [first, second] })
      .expect(200);
    expect((res.body as AgentAdapterConfigBatchPreview).fields.map((f) => f.key)).toEqual([
      "model",
    ]);
  });

  it("applies the values to every agent and audits one row each", async () => {
    const company = await seedCompanyWithBoardAccess(ctx.db, "Batch apply");
    const first = await seedAgent(company, "First", { timeoutSec: 30 });
    const second = await seedAgent(company, "Second", { model: "vendor/deep", thinking: "high" });
    const res = await request(appFor(company.actor))
      .post("/api/agents/batch/adapter-config")
      .send({ agentIds: [first, second], values: { model: "vendor/deep", thinking: "high" } })
      .expect(200);
    expect(res.body.updated).toBe(1);
    expect(res.body.unchanged).toBe(1);
    expect(await storedConfig(first)).toEqual({
      timeoutSec: 30,
      model: "vendor/deep",
      thinking: "high",
    });
    const rows = await auditRows(company.companyId, first);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("agent.updated");
    expect(rows[0]?.actorType).toBe("user");
    expect((rows[0]?.details as { changedAdapterConfigKeys: string[] }).changedAdapterConfigKeys)
      .toEqual(["model", "thinking"]);
    expect(await auditRows(company.companyId, second)).toHaveLength(0);
  });

  it("clears a value with null", async () => {
    const company = await seedCompanyWithBoardAccess(ctx.db, "Batch clear");
    const agentId = await seedAgent(company, "First", { model: "vendor/deep", thinking: "high" });
    await request(appFor(company.actor))
      .post("/api/agents/batch/adapter-config")
      .send({ agentIds: [agentId], values: { thinking: null } })
      .expect(200);
    expect(await storedConfig(agentId)).toEqual({ model: "vendor/deep" });
  });

  it("rejects the whole batch when one value is invalid for one adapter", async () => {
    const company = await seedCompanyWithBoardAccess(ctx.db, "Batch invalid");
    const first = await seedAgent(company, "First");
    const second = await seedAgent(company, "Second", {}, OTHER_ADAPTER_TYPE);
    const res = await request(appFor(company.actor))
      .post("/api/agents/batch/adapter-config")
      .send({ agentIds: [first, second], values: { model: "vendor/deep", thinking: "high" } })
      .expect(422);
    expect(res.body.failures).toHaveLength(1);
    expect(res.body.failures[0].agentId).toBe(second);
    expect(await storedConfig(first)).toEqual({});
    expect(await auditRows(company.companyId, first)).toHaveLength(0);
  });

  it("rejects a value outside an enumerated field", async () => {
    const company = await seedCompanyWithBoardAccess(ctx.db, "Batch enum");
    const agentId = await seedAgent(company, "First");
    const res = await request(appFor(company.actor))
      .post("/api/agents/batch/adapter-config")
      .send({ agentIds: [agentId], values: { thinking: "ludicrous" } })
      .expect(422);
    expect(res.body.failures[0].message).toContain("must be one of");
    expect(await storedConfig(agentId)).toEqual({});
  });

  it("rejects a field the adapter does not publish", async () => {
    const company = await seedCompanyWithBoardAccess(ctx.db, "Batch unknown field");
    const agentId = await seedAgent(company, "First");
    const res = await request(appFor(company.actor))
      .post("/api/agents/batch/adapter-config")
      .send({ agentIds: [agentId], values: { timeoutSec: "30" } })
      .expect(422);
    expect(res.body.failures[0].key).toBe("timeoutSec");
  });

  it("hides an agent from another company behind a 404", async () => {
    const company = await seedCompanyWithBoardAccess(ctx.db, "Batch tenant a");
    const other = await seedCompanyWithBoardAccess(ctx.db, "Batch tenant b");
    const mine = await seedAgent(company, "Mine");
    const theirs = await seedAgent(other, "Theirs", { model: "vendor/fast" });
    await request(appFor(company.actor))
      .post("/api/agents/batch/adapter-config")
      .send({ agentIds: [mine, theirs], values: { model: "vendor/deep" } })
      .expect(404);
    expect(await storedConfig(theirs)).toEqual({ model: "vendor/fast" });
    expect(await storedConfig(mine)).toEqual({});
  });

  it("denies an agent actor without the company:agents capability", async () => {
    const company = await seedCompanyWithBoardAccess(ctx.db, "Batch agent actor");
    const target = await seedAgent(company, "Target");
    const caller = await seedAgent(company, "Caller");
    const agentActor = {
      type: "agent",
      agentId: caller,
      companyId: company.companyId,
      agentRole: "engineer",
      runId: randomUUID(),
      source: "agent_jwt",
    } as unknown as BoardActor;
    await request(appFor(agentActor))
      .post("/api/agents/batch/adapter-config")
      .send({ agentIds: [target], values: { model: "vendor/deep" } })
      .expect(403);
    expect(await storedConfig(target)).toEqual({});
  });
});
