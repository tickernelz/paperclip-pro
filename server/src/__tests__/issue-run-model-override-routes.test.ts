import { randomUUID } from "node:crypto";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { activityLog, agents, issues } from "@tickernelz/paperclip-pro-db";
import type { IssueRunModelOverrideView } from "@tickernelz/paperclip-pro-shared";
import {
  registerServerAdapter,
  unregisterServerAdapter,
} from "../adapters/registry.js";
import type { ServerAdapterModule } from "../adapters/types.js";
import { issueRoutes } from "../routes/issues.js";
import { invalidateAdapterConfigSchema } from "../services/adapter-config-schema.js";
import {
  describeEmbeddedPostgres,
  resetCompanyIssueFixtures,
  routeApp,
  seedCompanyWithBoardAccess,
  useEmbeddedPostgres,
  type SeededCompany,
} from "./helpers/route-test-harness.js";

const ADAPTER_TYPE = "run_model_override_fake";

const fakeAdapter = {
  type: ADAPTER_TYPE,
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
        default: "vendor/default-model",
        options: [
          { value: "vendor/fast", label: "Fast", group: "vendor" },
          { value: "vendor/deep", label: "Deep", group: "vendor" },
        ],
      },
      {
        key: "thinking",
        label: "Thinking",
        type: "select" as const,
        options: [
          { value: "low", label: "low" },
          { value: "high", label: "high" },
        ],
      },
      { key: "timeoutSec", label: "Timeout", type: "number" as const },
    ],
  }),
} as unknown as ServerAdapterModule;

interface Seeded extends SeededCompany {
  agentId: string;
  issueId: string;
}

describeEmbeddedPostgres("per-task adapter model override routes", () => {
  const ctx = useEmbeddedPostgres("paperclip-run-model-override-", {
    resetEach: async (db) => {
      await db.delete(activityLog);
      await db.delete(issues);
      await db.delete(agents);
      await resetCompanyIssueFixtures(db);
    },
  });

  beforeAll(() => {
    registerServerAdapter(fakeAdapter);
    invalidateAdapterConfigSchema(ADAPTER_TYPE);
  });

  afterAll(() => {
    unregisterServerAdapter(ADAPTER_TYPE);
  });

  async function seed(adapterConfig: Record<string, unknown> = {}): Promise<Seeded> {
    const company = await seedCompanyWithBoardAccess(ctx.db, "Model override");
    const agentId = randomUUID();
    const issueId = randomUUID();
    await ctx.db.insert(agents).values({
      id: agentId,
      companyId: company.companyId,
      name: "Runner",
      adapterType: ADAPTER_TYPE,
      adapterConfig,
    });
    await ctx.db.insert(issues).values({
      id: issueId,
      companyId: company.companyId,
      title: "Task",
      status: "todo",
      priority: "medium",
      assigneeAgentId: agentId,
    });
    return { ...company, agentId, issueId };
  }

  const appFor = (seeded: Seeded) => routeApp(ctx.db, seeded.actor, issueRoutes);

  const put = (seeded: Seeded, body: Record<string, unknown>) =>
    request(appFor(seeded)).put(`/api/issues/${seeded.issueId}/model-override`).send(body);

  const storedOverrides = async (seeded: Seeded) =>
    ctx.db
      .select({ value: issues.assigneeAdapterOverrides })
      .from(issues)
      .where(eq(issues.id, seeded.issueId))
      .then((rows) => rows[0]?.value ?? null);

  const field = (view: IssueRunModelOverrideView, key: string) =>
    view.fields.find((entry) => entry.key === key);

  it("reports the agent default as the effective value with no override", async () => {
    const seeded = await seed({ thinking: "low" });
    const res = await request(appFor(seeded))
      .get(`/api/issues/${seeded.issueId}/model-override`)
      .expect(200);
    const view = res.body as IssueRunModelOverrideView;
    expect(view.supported).toBe(true);
    expect(field(view, "model")?.agentDefault).toBe("vendor/default-model");
    expect(field(view, "model")?.override).toBeNull();
    expect(field(view, "model")?.effective).toBe("vendor/default-model");
    expect(field(view, "thinking")?.effective).toBe("low");
    expect(view.fields.map((entry) => entry.key)).toEqual(["model", "thinking"]);
  });

  it("stores the override on the issue and reports it as effective", async () => {
    const seeded = await seed({ model: "vendor/default-model" });
    const res = await put(seeded, { model: "vendor/deep", thinking: "high" }).expect(200);
    const view = res.body as IssueRunModelOverrideView;
    expect(field(view, "model")?.effective).toBe("vendor/deep");
    expect(field(view, "thinking")?.override).toBe("high");
    expect(await storedOverrides(seeded)).toEqual({
      adapterConfig: { model: "vendor/deep", thinking: "high" },
    });
  });

  it("never writes the override into the agent's stored adapter config", async () => {
    const seeded = await seed({ model: "vendor/default-model" });
    await put(seeded, { model: "vendor/deep", thinking: "high" }).expect(200);
    const agent = await ctx.db
      .select({ adapterConfig: agents.adapterConfig })
      .from(agents)
      .where(eq(agents.id, seeded.agentId))
      .then((rows) => rows[0]);
    expect(agent?.adapterConfig).toEqual({ model: "vendor/default-model" });
  });

  it("clears one override with null and keeps the other", async () => {
    const seeded = await seed();
    await put(seeded, { model: "vendor/deep", thinking: "high" }).expect(200);
    const res = await put(seeded, { model: null }).expect(200);
    const view = res.body as IssueRunModelOverrideView;
    expect(field(view, "model")?.override).toBeNull();
    expect(field(view, "thinking")?.override).toBe("high");
    expect(await storedOverrides(seeded)).toEqual({
      adapterConfig: { thinking: "high" },
    });
  });

  it("drops the column value when every override is cleared", async () => {
    const seeded = await seed();
    await put(seeded, { model: "vendor/deep", thinking: "high" }).expect(200);
    await put(seeded, { model: null, thinking: null }).expect(200);
    expect(await storedOverrides(seeded)).toBeNull();
  });

  it("preserves unrelated per-issue adapter settings", async () => {
    const seeded = await seed();
    await ctx.db
      .update(issues)
      .set({
        assigneeAdapterOverrides: {
          adapterConfig: { workspaceStrategy: { type: "git_worktree" } },
          useProjectWorkspace: true,
        },
      })
      .where(eq(issues.id, seeded.issueId));
    await put(seeded, { thinking: "high" }).expect(200);
    expect(await storedOverrides(seeded)).toEqual({
      adapterConfig: {
        workspaceStrategy: { type: "git_worktree" },
        thinking: "high",
      },
      useProjectWorkspace: true,
    });
  });

  it("rejects a thinking level the adapter does not enumerate", async () => {
    const seeded = await seed();
    const res = await put(seeded, { thinking: "ludicrous" }).expect(422);
    expect(res.body.error).toContain("must be one of");
    expect(await storedOverrides(seeded)).toBeNull();
  });

  it("accepts a free-text model the adapter does not enumerate", async () => {
    const seeded = await seed();
    const res = await put(seeded, { model: "custom/experimental" }).expect(200);
    expect(field(res.body as IssueRunModelOverrideView, "model")?.override).toBe(
      "custom/experimental",
    );
  });

  it("rejects an empty model instead of storing a blank override", async () => {
    const seeded = await seed();
    await put(seeded, { model: "   " }).expect(422);
    expect(await storedOverrides(seeded)).toBeNull();
  });

  it("rejects keys outside the model and thinking override", async () => {
    const seeded = await seed();
    await put(seeded, { timeoutSec: "5" }).expect(400);
    expect(await storedOverrides(seeded)).toBeNull();
  });

  it("reports the control as unsupported when the task has no agent assignee", async () => {
    const seeded = await seed();
    await ctx.db
      .update(issues)
      .set({ assigneeAgentId: null })
      .where(eq(issues.id, seeded.issueId));
    const res = await request(appFor(seeded))
      .get(`/api/issues/${seeded.issueId}/model-override`)
      .expect(200);
    const view = res.body as IssueRunModelOverrideView;
    expect(view.supported).toBe(false);
    expect(view.fields).toEqual([]);
  });
});
