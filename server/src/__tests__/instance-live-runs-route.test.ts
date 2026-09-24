import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hoistModuleGraph } from "./helpers/hoist-module-graph.js";

const mockInstanceSettingsService = vi.hoisted(() => ({
  get: vi.fn(),
  getGeneral: vi.fn(),
  getExperimental: vi.fn(),
  update: vi.fn(),
  updateGeneral: vi.fn(),
  updateExperimental: vi.fn(),
  listCompanyIds: vi.fn(),
}));
const mockHeartbeatService = vi.hoisted(() => ({
  computeTaskDrain: vi.fn(),
  applyTaskDrain: vi.fn(),
  stopTaskDrain: vi.fn(),
  getTaskDrainStatus: vi.fn(),
  listActiveRunExecutionIds: vi.fn(),
}));
const mockEnvironmentService = vi.hoisted(() => ({
  getById: vi.fn(),
  findManagedSandboxEnvironment: vi.fn(),
  update: vi.fn(),
}));
const mockCompanyService = vi.hoisted(() => ({ getById: vi.fn(), update: vi.fn() }));

function registerModuleMocks() {
  vi.doMock("../services/index.js", () => ({
    companyService: () => mockCompanyService,
    heartbeatService: () => mockHeartbeatService,
    instanceSettingsService: () => mockInstanceSettingsService,
    logActivity: vi.fn(),
    publishActivity: vi.fn(),
  }));
  vi.doMock("../services/environments.js", () => ({
    environmentService: () => mockEnvironmentService,
  }));
}

let selectedRows: unknown[] = [];
const whereSpy = vi.fn();
const mockDb = {
  transaction: vi.fn(),
  select: vi.fn(() => ({
    from: () => ({
      where: (condition: unknown) => {
        whereSpy(condition);
        return Promise.resolve(selectedRows);
      },
    }),
  })),
};

describe("instance live-runs route", () => {
  const routeModules = hoistModuleGraph(registerModuleMocks, async () => {
    const [{ errorHandler }, { instanceSettingsRoutes }] = await Promise.all([
      vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
      vi.importActual<typeof import("../routes/instance-settings.js")>("../routes/instance-settings.js"),
    ]);
    return { errorHandler, instanceSettingsRoutes };
  });

  function createApp() {
    const { errorHandler, instanceSettingsRoutes } = routeModules.value;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = { type: "board", userId: "u1", source: "local_implicit", isInstanceAdmin: true } as any;
      next();
    });
    app.use("/api", instanceSettingsRoutes(mockDb as any));
    app.use(errorHandler);
    return app;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    selectedRows = [];
    mockHeartbeatService.getTaskDrainStatus.mockReturnValue({
      draining: false,
      startedAt: null,
      expiresAt: null,
      activeRuns: 0,
      pendingWakes: 0,
      quiescent: true,
    });
    mockHeartbeatService.listActiveRunExecutionIds.mockReturnValue([]);
  });

  it("names the issue behind every run this process is executing", async () => {
    mockHeartbeatService.listActiveRunExecutionIds.mockReturnValue(["run_a", "run_b"]);
    mockHeartbeatService.getTaskDrainStatus.mockReturnValue({
      draining: false, startedAt: null, expiresAt: null, activeRuns: 2, pendingWakes: 1, quiescent: false,
    });
    selectedRows = [
      { id: "run_a", companyId: "co_1", agentId: "ag_1", status: "running", startedAt: null, issueId: "ZHA-21" },
      { id: "run_b", companyId: "co_1", agentId: "ag_2", status: "running", startedAt: null, issueId: "ZHA-7" },
    ];
    const res = await request(createApp()).get("/api/instance/live-runs");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.pendingWakes).toBe(1);
    expect(res.body.runs.map((run: { issueId: string }) => run.issueId)).toEqual(["ZHA-21", "ZHA-7"]);
  });

  it("reports an idle instance without querying the run table", async () => {
    const res = await request(createApp()).get("/api/instance/live-runs");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ count: 0, runs: [], draining: false });
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("still lists a run the database no longer describes", async () => {
    mockHeartbeatService.listActiveRunExecutionIds.mockReturnValue(["run_gone"]);
    selectedRows = [];
    const res = await request(createApp()).get("/api/instance/live-runs");
    expect(res.body.count).toBe(1);
    expect(res.body.runs).toEqual([
      { id: "run_gone", companyId: null, agentId: null, status: null, startedAt: null, issueId: null },
    ]);
  });

  it("surfaces the live drain state so a restart can confirm admission", async () => {
    mockHeartbeatService.getTaskDrainStatus.mockReturnValue({
      draining: true, startedAt: null, expiresAt: null, activeRuns: 0, pendingWakes: 0, quiescent: true,
    });
    const res = await request(createApp()).get("/api/instance/live-runs");
    expect(res.body.draining).toBe(true);
  });
});
