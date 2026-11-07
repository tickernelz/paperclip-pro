import { randomUUID } from "node:crypto";
import request from "supertest";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { activityLog, agentConfigRevisions, agents, companies } from "@tickernelz/paperclip-pro-db";
import { agentRoutes } from "../routes/agents.js";
import {
  describeEmbeddedPostgres,
  resetCompanyIssueFixtures,
  routeApp,
  seedCompanyWithBoardAccess,
  useEmbeddedPostgres,
  type BoardActor,
  type SeededCompany,
} from "./helpers/route-test-harness.js";

describeEmbeddedPostgres("agent defaults routes", () => {
  const ctx = useEmbeddedPostgres("paperclip-agent-defaults-", {
    resetEach: async (db) => {
      await db.delete(activityLog);
      await db.delete(agentConfigRevisions);
      await db.delete(agents);
      await resetCompanyIssueFixtures(db);
    },
  });

  async function seedAgent(company: SeededCompany, name: string, adapterConfig: Record<string, unknown>, adapterType = "omp_local") {
    const id = randomUUID();
    await ctx.db.insert(agents).values({ id, companyId: company.companyId, name, adapterType, adapterConfig });
    return id;
  }

  const appFor = (actor: BoardActor) => routeApp(ctx.db, actor, agentRoutes);
  const configOf = (id: string) =>
    ctx.db.select({ adapterConfig: agents.adapterConfig }).from(agents).where(eq(agents.id, id)).then((rows) => rows[0]?.adapterConfig);

  it("moves only agents still on the old default and keeps every agent's own value", async () => {
    const company = await seedCompanyWithBoardAccess(ctx.db, "Defaults apply");
    await ctx.db.update(companies).set({ agentDefaults: { model: "vendor/old", thinking: "high" } }).where(eq(companies.id, company.companyId));
    const follower = await seedAgent(company, "Follower", { model: "vendor/old", thinking: "high", cwd: "/w" });
    const own = await seedAgent(company, "Own", { model: "vendor/mine", thinking: "high" });
    const other = await seedAgent(company, "Other adapter", { model: "vendor/old" }, "process");

    const res = await request(appFor(company.actor))
      .put(`/api/companies/${company.companyId}/agent-defaults`)
      .send({ values: { model: "vendor/new", thinking: "high" } })
      .expect(200);

    expect(res.body).toMatchObject({ changedPaths: ["model"], following: 1, ownValues: 1, sessionKept: true });
    expect(await configOf(follower)).toEqual({ model: "vendor/new", thinking: "high", cwd: "/w" });
    expect(await configOf(own)).toEqual({ model: "vendor/mine", thinking: "high" });
    expect(await configOf(other)).toEqual({ model: "vendor/old" });
    const revisions = await ctx.db.select({ agentId: agentConfigRevisions.agentId, source: agentConfigRevisions.source }).from(agentConfigRevisions);
    expect(revisions).toEqual([{ agentId: follower, source: "agent_defaults" }]);
    const stored = await request(appFor(company.actor)).get(`/api/companies/${company.companyId}/agent-defaults`).expect(200);
    expect(stored.body.values).toEqual({ model: "vendor/new", thinking: "high" });
  });

  it("rejects credential keys, the subagent gate and wrong types without touching any agent", async () => {
    const company = await seedCompanyWithBoardAccess(ctx.db, "Defaults reject");
    const agent = await seedAgent(company, "Agent", { model: "vendor/old" });
    const res = await request(appFor(company.actor))
      .put(`/api/companies/${company.companyId}/agent-defaults`)
      .send({ values: { model: "vendor/new", env: { A: "1" }, thinking: "huge", timeoutSec: -5 } })
      .expect(422);
    expect(res.body.details).toEqual([
      "env is not an agent default.",
      "thinking must be one of: off, minimal, low, medium, high, xhigh, max.",
      "timeoutSec must be a whole number of seconds, 0 for no limit.",
    ]);
    expect(await configOf(agent)).toEqual({ model: "vendor/old" });
  });

  it("is board-only: an agent key cannot read or change company defaults", async () => {
    const company = await seedCompanyWithBoardAccess(ctx.db, "Defaults authz");
    const agentId = await seedAgent(company, "Agent", {});
    const agentActor = { type: "agent", agentId, companyId: company.companyId, source: "agent_key" } as unknown as BoardActor;
    await request(appFor(agentActor)).get(`/api/companies/${company.companyId}/agent-defaults`).expect(403);
    await request(appFor(agentActor)).put(`/api/companies/${company.companyId}/agent-defaults`).send({ values: { model: "x/y" } }).expect(403);
    const outsider = await seedCompanyWithBoardAccess(ctx.db, "Defaults outsider");
    await request(appFor(outsider.actor)).put(`/api/companies/${company.companyId}/agent-defaults`).send({ values: { model: "x/y" } }).expect(403);
  });

  it("starts a new OMP agent from the defaults; explicit values win", async () => {
    const company = await seedCompanyWithBoardAccess(ctx.db, "Defaults create");
    await ctx.db.update(companies).set({ agentDefaults: { model: "vendor/default", stylePreset: "fast" } }).where(eq(companies.id, company.companyId));
    const res = await request(appFor(company.actor))
      .post(`/api/companies/${company.companyId}/agents`)
      .send({ name: "New", adapterType: "omp_local", adapterConfig: { model: "vendor/explicit" } })
      .expect(201);
    expect(res.body.adapterConfig).toMatchObject({ model: "vendor/explicit", stylePreset: "fast" });
  });
});
