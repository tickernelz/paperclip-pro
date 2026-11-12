import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { InstanceUpdateStatus } from "@tickernelz/wardmote-shared";
import { errorHandler } from "../middleware/index.js";
import { instanceUpdateRoutes } from "../routes/instance-updates.js";
import type { WardmoteUpdateService } from "../services/wardmote-updates.js";

const STATUS: InstanceUpdateStatus = {
  currentVersion: "2026.1111.0",
  latestVersion: "2026.1112.0",
  updateAvailable: true,
  channel: "latest",
  checkEnabled: true,
  checkedAt: "2026-11-12T07:00:00.000Z",
  releaseNotesUrl: "https://github.com/tickernelz/wardmote/releases/tag/v2026.1112.0",
  install: { kind: "managed", command: "wardmote update --version 2026.1112.0" },
};

function createApp(actor: Record<string, unknown>) {
  const service: WardmoteUpdateService = {
    status: vi.fn(() => STATUS),
    refresh: vi.fn(async () => undefined),
    startPeriodicChecks: vi.fn(() => () => undefined),
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor as typeof req.actor;
    next();
  });
  app.use("/api", instanceUpdateRoutes(service));
  app.use(errorHandler);
  return { app, service };
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
