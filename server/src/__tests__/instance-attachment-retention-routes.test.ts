import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ATTACHMENT_RETENTION, type AttachmentRetentionReport } from "@tickernelz/paperclip-pro-shared";
import { errorHandler } from "../middleware/index.js";
import {
  instanceAttachmentRetentionRoutes,
  type AttachmentRetentionRouteService,
} from "../routes/instance-attachment-retention.js";

const REPORT: AttachmentRetentionReport = {
  mode: "preview",
  trigger: "manual",
  startedAt: "2026-10-08T00:00:00.000Z",
  finishedAt: "2026-10-08T00:00:01.000Z",
  settings: DEFAULT_ATTACHMENT_RETENTION,
  rules: [{ rule: "orphan_assets", count: 1, bytes: 10, sampleIds: ["a"] }],
  totalCount: 1,
  totalBytes: 10,
  failedCount: 0,
};

const ADMIN = { type: "board", userId: "admin-1", source: "session", isInstanceAdmin: true, companyIds: [] };
const MEMBER = { type: "board", userId: "member-1", source: "session", isInstanceAdmin: false, companyIds: ["c1"] };

function createService(): AttachmentRetentionRouteService {
  return {
    status: vi.fn().mockResolvedValue({ settings: DEFAULT_ATTACHMENT_RETENTION, lastRun: null }),
    preview: vi.fn().mockResolvedValue(REPORT),
    run: vi.fn().mockResolvedValue({ ...REPORT, mode: "run" }),
  };
}

function createApp(actor: Record<string, unknown>, service: AttachmentRetentionRouteService) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor as typeof req.actor;
    next();
  });
  app.use("/api", instanceAttachmentRetentionRoutes(service));
  app.use(errorHandler);
  return app;
}

describe("instance attachment retention routes", () => {
  it("returns the status to an instance admin", async () => {
    const service = createService();
    const res = await request(createApp(ADMIN, service)).get("/api/instance/attachment-retention");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ settings: DEFAULT_ATTACHMENT_RETENTION, lastRun: null });
  });

  it("previews unsaved settings without running", async () => {
    const service = createService();
    const settings = { enabled: true, orphanAfterDays: 3, closedTasks: { enabled: true, afterDays: 30 } };
    const res = await request(createApp(ADMIN, service))
      .post("/api/instance/attachment-retention/preview")
      .send({ settings });
    expect(res.status).toBe(200);
    expect(service.preview).toHaveBeenCalledWith(settings);
    expect(service.run).not.toHaveBeenCalled();
  });

  it("previews saved settings when the body is empty", async () => {
    const service = createService();
    const res = await request(createApp(ADMIN, service)).post("/api/instance/attachment-retention/preview");
    expect(res.status).toBe(200);
    expect(service.preview).toHaveBeenCalledWith(undefined);
  });

  it("rejects out-of-range preview settings", async () => {
    const service = createService();
    const res = await request(createApp(ADMIN, service))
      .post("/api/instance/attachment-retention/preview")
      .send({ settings: { enabled: true, orphanAfterDays: 0, closedTasks: { enabled: false, afterDays: 90 } } });
    expect(res.status).toBe(400);
    expect(service.preview).not.toHaveBeenCalled();
  });

  it("runs manually as the admin actor", async () => {
    const service = createService();
    const res = await request(createApp(ADMIN, service)).post("/api/instance/attachment-retention/run").send({});
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("run");
    expect(service.run).toHaveBeenCalledWith({ trigger: "manual", actor: { actorType: "user", actorId: "admin-1" } });
  });

  it("refuses every endpoint to non-admin board users", async () => {
    const service = createService();
    const app = createApp(MEMBER, service);
    expect((await request(app).get("/api/instance/attachment-retention")).status).toBe(403);
    expect((await request(app).post("/api/instance/attachment-retention/preview").send({})).status).toBe(403);
    expect((await request(app).post("/api/instance/attachment-retention/run").send({})).status).toBe(403);
    expect(service.status).not.toHaveBeenCalled();
    expect(service.preview).not.toHaveBeenCalled();
    expect(service.run).not.toHaveBeenCalled();
  });
});
