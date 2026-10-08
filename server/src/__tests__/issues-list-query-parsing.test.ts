import { randomUUID } from "node:crypto";
import request from "supertest";
import { expect, it } from "vitest";
import { issueLabels, issues, labels } from "@tickernelz/paperclip-pro-db";
import { issueRoutes } from "../routes/issues.js";
import {
  describeEmbeddedPostgres,
  resetCompanyIssueFixtures,
  routeApp,
  seedCompanyWithBoardAccess,
  useEmbeddedPostgres,
} from "./helpers/route-test-harness.js";

/**
 * Regression coverage for https://github.com/paperclipai/paperclip/issues/4628.
 * Express's `qs` parser hands the list route either a string or an array for
 * `?status=`, and the route normalizes both shapes.
 */

describeEmbeddedPostgres("issue list status query parsing", () => {
  const ctx = useEmbeddedPostgres("paperclip-issues-list-query-parsing-", {
    resetEach: resetCompanyIssueFixtures,
  });

  async function listStatuses(query: string) {
    const company = await seedCompanyWithBoardAccess(ctx.db, "Status parsing");
    const companyId = company.companyId;
    await ctx.db.insert(issues).values([
      { id: randomUUID(), companyId, title: "Todo", status: "todo", priority: "medium" },
      { id: randomUUID(), companyId, title: "In progress", status: "in_progress", priority: "medium" },
      { id: randomUUID(), companyId, title: "Done", status: "done", priority: "medium" },
    ]);
    const res = await request(routeApp(ctx.db, company.actor, issueRoutes))
      .get(`/api/companies/${companyId}/issues${query}`)
      .expect(200);
    return (res.body as { status: string }[]).map((issue) => issue.status).sort();
  }

  it("accepts a single ?status=todo", async () => {
    expect(await listStatuses("?status=todo")).toEqual(["todo"]);
  });

  it("accepts comma-separated ?status=todo,in_progress", async () => {
    expect(await listStatuses("?status=todo,in_progress")).toEqual(["in_progress", "todo"]);
  });

  it("accepts repeated ?status=todo&status=in_progress", async () => {
    expect(await listStatuses("?status=todo&status=in_progress")).toEqual(["in_progress", "todo"]);
  });

  it("accepts mixed array and CSV ?status=todo,in_progress&status=done", async () => {
    expect(await listStatuses("?status=todo,in_progress&status=done"))
      .toEqual(["done", "in_progress", "todo"]);
  });

  it("returns every status when ?status is absent", async () => {
    expect(await listStatuses("")).toEqual(["done", "in_progress", "todo"]);
  });

  it("filters by priority CSV, any-of labelId CSV and creator, and rejects malformed values", async () => {
    const company = await seedCompanyWithBoardAccess(ctx.db, "Filter parsing");
    const companyId = company.companyId;
    const [bugLabel, uiLabel] = [randomUUID(), randomUUID()];
    await ctx.db.insert(labels).values([
      { id: bugLabel, companyId, name: "bug", color: "#ff0000" },
      { id: uiLabel, companyId, name: "ui", color: "#00ff00" },
    ]);
    await ctx.db.insert(issues).values([
      { id: randomUUID(), companyId, title: "Mine high", status: "todo", priority: "high", createdByUserId: company.userId },
      { id: randomUUID(), companyId, title: "Other low", status: "todo", priority: "low", createdByUserId: "user-other" },
      { id: randomUUID(), companyId, title: "Other critical", status: "todo", priority: "critical" },
    ]);
    const byTitle = Object.fromEntries((await ctx.db.select({ id: issues.id, title: issues.title }).from(issues)).map((row) => [row.title, row.id]));
    await ctx.db.insert(issueLabels).values([
      { companyId, issueId: byTitle["Mine high"]!, labelId: bugLabel },
      { companyId, issueId: byTitle["Other critical"]!, labelId: uiLabel },
    ]);
    const app = routeApp(ctx.db, company.actor, issueRoutes);
    const titles = async (query: Record<string, string>) =>
      ((await request(app).get(`/api/companies/${companyId}/issues`).query(query).expect(200)).body as { title: string }[])
        .map((issue) => issue.title).sort();

    expect(await titles({ priority: "high,critical" })).toEqual(["Mine high", "Other critical"]);
    expect(await titles({ labelId: `${bugLabel},${uiLabel}` })).toEqual(["Mine high", "Other critical"]);
    expect(await titles({ labelId: uiLabel })).toEqual(["Other critical"]);
    expect(await titles({ createdByUserId: "me" })).toEqual(["Mine high"]);
    expect(await titles({ createdByUserId: "user-other", priority: "low" })).toEqual(["Other low"]);
    await request(app).get(`/api/companies/${companyId}/issues`).query({ priority: "urgent" }).expect(400);
    await request(app).get(`/api/companies/${companyId}/issues`).query({ labelId: "not-a-uuid" }).expect(422);
    await request(app).get(`/api/companies/${companyId}/issues`).query({ createdByAgentId: "nope" }).expect(422);
  });
});
