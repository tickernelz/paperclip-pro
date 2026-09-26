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
import { ISSUE_MODEL_OVERRIDE_SUBTREE_MAX_DEPTH } from "../services/issue-model-override-inheritance.js";
import {
  describeEmbeddedPostgres,
  resetCompanyIssueFixtures,
  routeApp,
  seedCompanyWithBoardAccess,
  useEmbeddedPostgres,
  type SeededCompany,
} from "./helpers/route-test-harness.js";

const ADAPTER_TYPE = "run_model_override_inheritance_fake";

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
        options: [{ value: "vendor/deep", label: "Deep" }],
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
    ],
  }),
} as unknown as ServerAdapterModule;

interface Seeded extends SeededCompany {
  agentId: string;
  rootIssueId: string;
}

describeEmbeddedPostgres("per-task model override inheritance", () => {
  const ctx = useEmbeddedPostgres("paperclip-run-model-inheritance-", {
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

  async function seed(): Promise<Seeded> {
    const company = await seedCompanyWithBoardAccess(ctx.db, "Override inheritance");
    const agentId = randomUUID();
    const rootIssueId = randomUUID();
    await ctx.db.insert(agents).values({
      id: agentId,
      companyId: company.companyId,
      name: "Runner",
      adapterType: ADAPTER_TYPE,
      adapterConfig: {},
    });
    await ctx.db.insert(issues).values({
      id: rootIssueId,
      companyId: company.companyId,
      title: "Root",
      status: "todo",
      priority: "medium",
      assigneeAgentId: agentId,
    });
    return { ...company, agentId, rootIssueId };
  }

  const appFor = (seeded: Seeded) => routeApp(ctx.db, seeded.actor, issueRoutes);

  const put = (seeded: Seeded, issueId: string, body: Record<string, unknown>) =>
    request(appFor(seeded)).put(`/api/issues/${issueId}/model-override`).send(body);

  const storedOverrides = async (issueId: string) =>
    ctx.db
      .select({ value: issues.assigneeAdapterOverrides })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0]?.value ?? null);

  async function insertChild(
    seeded: Seeded,
    parentId: string,
    overrides: Record<string, unknown> | null = null,
  ) {
    const id = randomUUID();
    await ctx.db.insert(issues).values({
      id,
      companyId: seeded.companyId,
      title: `Child of ${parentId}`,
      status: "todo",
      priority: "medium",
      assigneeAgentId: seeded.agentId,
      parentId,
      ...(overrides ? { assigneeAdapterOverrides: overrides } : {}),
    });
    return id;
  }

  it("defaults the switches to inherit new subtasks only", async () => {
    const seeded = await seed();
    const res = await put(seeded, seeded.rootIssueId, { model: "vendor/deep" }).expect(200);
    const view = res.body as IssueRunModelOverrideView;
    expect(view.inheritance).toEqual({
      inheritToSubtasks: true,
      subtaskScope: "new",
      inherited: false,
      sourceIssueId: null,
    });
    expect(view.propagation).toBeNull();
  });

  it("persists switched-off inheritance and reports it back", async () => {
    const seeded = await seed();
    await put(seeded, seeded.rootIssueId, {
      model: "vendor/deep",
      inheritToSubtasks: false,
    }).expect(200);
    const res = await request(appFor(seeded))
      .get(`/api/issues/${seeded.rootIssueId}/model-override`)
      .expect(200);
    expect((res.body as IssueRunModelOverrideView).inheritance.inheritToSubtasks).toBe(
      false,
    );
  });

  it("gives a newly created child the parent's override", async () => {
    const seeded = await seed();
    await put(seeded, seeded.rootIssueId, { model: "vendor/deep", thinking: "high" }).expect(
      200,
    );
    const child = await request(appFor(seeded))
      .post(`/api/issues/${seeded.rootIssueId}/children`)
      .send({ title: "Child", assigneeAgentId: seeded.agentId })
      .expect(201);
    expect(await storedOverrides(child.body.issue?.id ?? child.body.id)).toEqual({
      adapterConfig: { model: "vendor/deep", thinking: "high" },
      modelOverrideInheritance: {
        inheritToSubtasks: true,
        subtaskScope: "new",
        inherited: true,
        sourceIssueId: seeded.rootIssueId,
      },
    });
  });

  it("does not give a new child anything when inheritance is off", async () => {
    const seeded = await seed();
    await put(seeded, seeded.rootIssueId, {
      model: "vendor/deep",
      inheritToSubtasks: false,
    }).expect(200);
    const child = await request(appFor(seeded))
      .post(`/api/issues/${seeded.rootIssueId}/children`)
      .send({ title: "Child", assigneeAgentId: seeded.agentId })
      .expect(201);
    expect(await storedOverrides(child.body.issue?.id ?? child.body.id)).toBeNull();
  });

  it("keeps a child's own create-time override instead of the parent's", async () => {
    const seeded = await seed();
    await put(seeded, seeded.rootIssueId, { model: "vendor/deep" }).expect(200);
    const child = await request(appFor(seeded))
      .post(`/api/issues/${seeded.rootIssueId}/children`)
      .send({
        title: "Child",
        assigneeAgentId: seeded.agentId,
        modelOverride: { model: "custom/child-model" },
      })
      .expect(201);
    const stored = await storedOverrides(child.body.issue?.id ?? child.body.id);
    expect((stored as { adapterConfig: { model: string } }).adapterConfig.model).toBe(
      "custom/child-model",
    );
  });

  it("rejects a create-time override the adapter does not enumerate", async () => {
    const seeded = await seed();
    await request(appFor(seeded))
      .post(`/api/issues/${seeded.rootIssueId}/children`)
      .send({
        title: "Child",
        assigneeAgentId: seeded.agentId,
        modelOverride: { thinking: "ludicrous" },
      })
      .expect(422);
  });

  it("walks the existing subtree when the scope includes existing subtasks", async () => {
    const seeded = await seed();
    const child = await insertChild(seeded, seeded.rootIssueId);
    const grandchild = await insertChild(seeded, child);
    const res = await put(seeded, seeded.rootIssueId, {
      model: "vendor/deep",
      subtaskScope: "new_and_existing",
    }).expect(200);
    const view = res.body as IssueRunModelOverrideView;
    expect(view.propagation).toMatchObject({ applied: 2, skipped: 0, limitReached: false });
    expect(await storedOverrides(grandchild)).toEqual({
      adapterConfig: { model: "vendor/deep" },
      modelOverrideInheritance: {
        inheritToSubtasks: true,
        subtaskScope: "new_and_existing",
        inherited: true,
        sourceIssueId: seeded.rootIssueId,
      },
    });
  });

  it("leaves a subtask that owns an explicit override untouched", async () => {
    const seeded = await seed();
    const explicitChild = await insertChild(seeded, seeded.rootIssueId, {
      adapterConfig: { model: "custom/pinned" },
    });
    const under = await insertChild(seeded, explicitChild);
    const res = await put(seeded, seeded.rootIssueId, {
      model: "vendor/deep",
      subtaskScope: "new_and_existing",
    }).expect(200);
    expect((res.body as IssueRunModelOverrideView).propagation).toMatchObject({
      applied: 0,
      skipped: 1,
    });
    expect(await storedOverrides(explicitChild)).toEqual({
      adapterConfig: { model: "custom/pinned" },
    });
    expect(await storedOverrides(under)).toBeNull();
  });

  it("propagates a clear to the inherited subtree", async () => {
    const seeded = await seed();
    const child = await insertChild(seeded, seeded.rootIssueId);
    await put(seeded, seeded.rootIssueId, {
      model: "vendor/deep",
      subtaskScope: "new_and_existing",
    }).expect(200);
    expect(await storedOverrides(child)).not.toBeNull();
    await put(seeded, seeded.rootIssueId, {
      model: null,
      subtaskScope: "new_and_existing",
    }).expect(200);
    const stored = (await storedOverrides(child)) as Record<string, unknown> | null;
    expect(stored?.adapterConfig).toBeUndefined();
  });

  it("does not walk the subtree when inheritance is off", async () => {
    const seeded = await seed();
    const child = await insertChild(seeded, seeded.rootIssueId);
    const res = await put(seeded, seeded.rootIssueId, {
      model: "vendor/deep",
      subtaskScope: "new_and_existing",
      inheritToSubtasks: false,
    }).expect(200);
    expect((res.body as IssueRunModelOverrideView).propagation).toBeNull();
    expect(await storedOverrides(child)).toBeNull();
  });

  it("stops at the depth limit and reports it", async () => {
    const seeded = await seed();
    let parent = seeded.rootIssueId;
    const chain: string[] = [];
    for (let depth = 0; depth < ISSUE_MODEL_OVERRIDE_SUBTREE_MAX_DEPTH + 2; depth += 1) {
      parent = await insertChild(seeded, parent);
      chain.push(parent);
    }
    const res = await put(seeded, seeded.rootIssueId, {
      model: "vendor/deep",
      subtaskScope: "new_and_existing",
    }).expect(200);
    const propagation = (res.body as IssueRunModelOverrideView).propagation;
    expect(propagation?.applied).toBe(ISSUE_MODEL_OVERRIDE_SUBTREE_MAX_DEPTH);
    expect(propagation?.limitReached).toBe(true);
    expect(await storedOverrides(chain[ISSUE_MODEL_OVERRIDE_SUBTREE_MAX_DEPTH])).toBeNull();
  });
});
