import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { executionWorkspaces, issues, projects } from "@tickernelz/paperclip-pro-db";
import type { ExecutionWorkspace } from "@tickernelz/paperclip-pro-shared";
import { executionWorkspaceService } from "../services/execution-workspaces.js";
import type { GitCloseReadinessInspection } from "../services/execution-workspaces.js";
import {
  describeEmbeddedPostgres,
  resetCompanyIssueFixtures,
  seedCompanyWithBoardAccess,
  useEmbeddedPostgres,
} from "./helpers/route-test-harness.js";

describeEmbeddedPostgres("terminal workspace reaper git inspection", () => {
  const ctx = useEmbeddedPostgres("paperclip-sweep-git-inspection-", {
    resetEach: async (db) => {
      await db.delete(executionWorkspaces);
      await db.delete(issues);
      await db.delete(projects);
      await resetCompanyIssueFixtures(db);
    },
  });

  let inspectedPaths: string[] = [];

  beforeEach(() => {
    inspectedPaths = [];
  });

  const inspectGitCloseReadiness = vi.fn(
    async (workspace: ExecutionWorkspace): Promise<GitCloseReadinessInspection> => {
      const workspacePath = workspace.providerRef ?? workspace.cwd ?? "";
      inspectedPaths.push(workspacePath);
      return {
        git: {
          repoRoot: null,
          workspacePath,
          branchName: workspace.branchName,
          baseRef: workspace.baseRef,
          hasDirtyTrackedFiles: false,
          hasUntrackedFiles: false,
          dirtyEntryCount: 0,
          untrackedEntryCount: 0,
          aheadCount: 0,
          behindCount: 0,
          isMergedIntoBase: true,
          createdByRuntime: false,
        },
        warnings: [],
        statusInspectionSucceeded: true,
      };
    },
  );

  function reaper() {
    return executionWorkspaceService(ctx.db, { inspectGitCloseReadiness });
  }

  async function seedCandidates(paths: string[], overrides: { baseRef?: string }[] = []) {
    const company = await seedCompanyWithBoardAccess(ctx.db, "Reaper");
    const projectId = randomUUID();
    await ctx.db.insert(projects).values({
      id: projectId,
      companyId: company.companyId,
      name: "Reaper project",
      status: "in_progress",
    });
    for (const [index, workspacePath] of paths.entries()) {
      const executionWorkspaceId = randomUUID();
      const sourceIssueId = randomUUID();
      await ctx.db.insert(executionWorkspaces).values({
        id: executionWorkspaceId,
        companyId: company.companyId,
        projectId,
        mode: "isolated_workspace",
        strategyType: "local_fs",
        name: `workspace-${index}`,
        status: "active",
        cwd: workspacePath,
        providerRef: workspacePath,
        providerType: "local_fs",
        baseRef: overrides[index]?.baseRef ?? "main",
      });
      await ctx.db.insert(issues).values({
        id: sourceIssueId,
        companyId: company.companyId,
        projectId,
        title: `Delivered issue ${index}`,
        status: "done",
        priority: "medium",
        executionWorkspaceId,
      });
      await ctx.db
        .update(executionWorkspaces)
        .set({ sourceIssueId })
        .where(eq(executionWorkspaces.id, executionWorkspaceId));
    }
    return company;
  }

  it("inspects one shared workspace path once per sweep", async () => {
    await seedCandidates(Array.from({ length: 5 }, () => "/srv/paperclip/checkout"));

    const sweep = await reaper().sweepTerminalWorkspaces();

    expect(inspectedPaths).toEqual(["/srv/paperclip/checkout"]);
    expect(sweep).toMatchObject({ checked: 5, skippedCooldown: 5, archived: 0, skippedUndelivered: 0 });
  }, 30_000);

  it("inspects each distinct workspace path once per sweep", async () => {
    const paths = Array.from({ length: 82 }, (_unused, index) =>
      index % 2 === 0 ? "/srv/paperclip/alpha" : "/srv/paperclip/beta");
    await seedCandidates(paths);
    const service = reaper();

    const firstSweep = await service.sweepTerminalWorkspaces();
    const firstPageInspections = inspectedPaths.length;
    const secondSweep = await service.sweepTerminalWorkspaces();

    expect(firstSweep.checked).toBe(50);
    expect(firstSweep.skippedCooldown).toBe(firstSweep.checked);
    expect(secondSweep.skippedCooldown).toBe(secondSweep.checked);
    expect(firstSweep.checked + secondSweep.checked).toBeGreaterThanOrEqual(82);
    expect(inspectedPaths).toHaveLength(4);
    expect(firstPageInspections).toBe(2);
    expect(new Set(inspectedPaths)).toEqual(new Set(["/srv/paperclip/alpha", "/srv/paperclip/beta"]));
  }, 60_000);

  it("inspects a shared path separately for each base ref", async () => {
    await seedCandidates(
      Array.from({ length: 4 }, () => "/srv/paperclip/checkout"),
      [{ baseRef: "main" }, { baseRef: "main" }, { baseRef: "release" }, { baseRef: "release" }],
    );

    const sweep = await reaper().sweepTerminalWorkspaces();

    expect(inspectedPaths).toHaveLength(2);
    expect(sweep).toMatchObject({ checked: 4, skippedCooldown: 4 });
  }, 30_000);
});
