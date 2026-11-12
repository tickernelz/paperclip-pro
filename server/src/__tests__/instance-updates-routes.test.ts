import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { InstanceUpdateStatus } from "@tickernelz/wardmote-shared";
import { errorHandler } from "../middleware/index.js";
import { instanceUpdateRoutes } from "../routes/instance-updates.js";
import type { WardmoteUpdateService } from "../services/wardmote-updates.js";
import type { UpdateInstaller } from "../services/wardmote-update-install.js";

const STATUS: InstanceUpdateStatus = {
  currentVersion: "2026.1111.0",
  latestVersion: "2026.1112.0",
  updateAvailable: true,
  channel: "latest",
  checkEnabled: true,
  checkedAt: "2026-11-12T07:00:00.000Z",
  releaseNotesUrl: "https://github.com/tickernelz/wardmote/releases/tag/v2026.1112.0",
  install: { kind: "managed", command: "wardmote update --version 2026.1112.0", canInstall: true },
};

function createApp(actor: Record<string, unknown>) {
  const service: WardmoteUpdateService = {
    status: vi.fn(() => STATUS),
    refresh: vi.fn(async () => undefined),
    startPeriodicChecks: vi.fn(() => () => undefined),
  };
  const installer: UpdateInstaller = {
    current: vi.fn(() => null),
    start: vi.fn(async (input) => ({ id: "job-1", phase: input.mode === "wait" ? "waiting" : "installing", mode: input.mode }) as never),
    forceWaiting: vi.fn(async () => ({ id: "job-1", phase: "installing" }) as never),
    cancelWaiting: vi.fn(async () => ({ id: "job-1", phase: "cancelled" }) as never),
    resume: vi.fn(),
    stop: vi.fn(),
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor as typeof req.actor;
    next();
  });
  app.use("/api", instanceUpdateRoutes(service, installer));
  app.use(errorHandler);
  return { app, service, installer };
}

describe("GET /api/instance/updates", () => {
  it("returns the update status to a signed-in instance admin and to local trusted boards", async () => {
    for (const actor of [
      { type: "board", userId: "admin-1", source: "session", isInstanceAdmin: true },
      { type: "board", userId: "local-board", source: "local_implicit", isInstanceAdmin: false },
    ]) {
      const { app } = createApp(actor);
      const res = await request(app).get("/api/instance/updates");
      expect(res.status).toBe(200);
      expect(res.body).toEqual(STATUS);
    }
  });

  it("rejects board members who are not instance admins", async () => {
    const { app, service } = createApp({ type: "board", userId: "member-1", source: "session", isInstanceAdmin: false, companyIds: ["company-1"] });
    const res = await request(app).get("/api/instance/updates");
    expect(res.status).toBe(403);
    expect(service.status).not.toHaveBeenCalled();
  });

  it("rejects agent keys, including a company owner agent, and admin board API keys", async () => {
    for (const actor of [
      { type: "agent", agentId: "agent-1", companyId: "company-1", source: "agent_key" },
      { type: "agent", agentId: "ceo-1", companyId: "company-1", source: "agent_key", agentRole: "ceo" },
      { type: "board", userId: "admin-1", source: "board_key", isInstanceAdmin: true },
    ]) {
      const { app, service } = createApp(actor);
      const res = await request(app).get("/api/instance/updates");
      expect(res.status).toBe(403);
      expect(service.status).not.toHaveBeenCalled();
    }
  });
});

describe("update install routes", () => {
  it("lets a signed-in instance admin start, force, and cancel an update", async () => {
    const { app, installer } = createApp({ type: "board", userId: "admin-1", source: "session", isInstanceAdmin: true });
    const res = await request(app).post("/api/instance/updates/install").send({ version: "2026.1112.0", mode: "force" });
    expect(res.status).toBe(202);
    expect(installer.start).toHaveBeenCalledWith({ version: "2026.1112.0", mode: "force", trigger: "manual", requestedBy: { actorType: "user", actorId: "admin-1" } });
    expect((await request(app).post("/api/instance/updates/install/force").send({})).status).toBe(200);
    expect((await request(app).delete("/api/instance/updates/install")).status).toBe(200);
  });

  it("rejects a request without an explicit mode", async () => {
    const { app, installer } = createApp({ type: "board", userId: "admin-1", source: "session", isInstanceAdmin: true });
    expect((await request(app).post("/api/instance/updates/install").send({ version: "2026.1112.0" })).status).toBe(400);
    expect(installer.start).not.toHaveBeenCalled();
  });

  it("never lets members, agent keys, or board API keys start or steer an update", async () => {
    for (const actor of [
      { type: "board", userId: "member-1", source: "session", isInstanceAdmin: false },
      { type: "agent", agentId: "agent-1", companyId: "company-1", source: "agent_key" },
      { type: "agent", agentId: "ceo-1", companyId: "company-1", source: "agent_jwt", agentRole: "ceo" },
      { type: "board", userId: "admin-1", source: "board_key", isInstanceAdmin: true },
    ]) {
      const { app, installer } = createApp(actor);
      expect((await request(app).post("/api/instance/updates/install").send({ version: "2026.1112.0", mode: "force" })).status).toBe(403);
      expect((await request(app).post("/api/instance/updates/install/force").send({})).status).toBe(403);
      expect((await request(app).delete("/api/instance/updates/install")).status).toBe(403);
      expect(installer.start).not.toHaveBeenCalled();
      expect(installer.forceWaiting).not.toHaveBeenCalled();
      expect(installer.cancelWaiting).not.toHaveBeenCalled();
    }
  });
});
