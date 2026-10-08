import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { activityLog, assets, companies, createDb, instanceSettings } from "@tickernelz/paperclip-pro-db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { setAttachmentLimitSetting } from "../attachment-types.js";
import { errorHandler } from "../middleware/index.js";
import { assetRoutes } from "../routes/assets.js";
import { healthRoutes } from "../routes/health.js";
import { instanceSettingsRoutes } from "../routes/instance-settings.js";
import { createLocalDiskStorageProvider } from "../storage/local-disk-provider.js";
import { createStorageService } from "../storage/service.js";

const MB = 1024 * 1024;

describe("attachment size limit from instance settings", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let home = "";
  let companyId = "";

  beforeAll(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), "paperclip-attachment-limit-"));
    vi.stubEnv("PAPERCLIP_HOME", home);
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", "default");
    vi.stubEnv("PAPERCLIP_ATTACHMENT_MAX_BYTES", String(3 * MB));
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-attachment-limit-");
    db = createDb(tempDb.connectionString);
    const [company] = await db.insert(companies).values({ name: "Limits", issuePrefix: "LIM" }).returning();
    companyId = company!.id;
  }, 30_000);

  afterEach(async () => {
    setAttachmentLimitSetting(null);
    await db.delete(activityLog);
    await db.delete(assets);
    await db.delete(instanceSettings);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await tempDb?.cleanup();
    await rm(home, { recursive: true, force: true });
  });

  function app() {
    const instance = express();
    instance.use(express.json());
    instance.use((req, _res, next) => {
      req.actor = { type: "board", userId: "admin", source: "local_implicit", isInstanceAdmin: true, companyIds: [companyId] } as Express.Request["actor"];
      next();
    });
    instance.use("/api/health", healthRoutes(db));
    instance.use("/api", instanceSettingsRoutes(db));
    instance.use("/api", assetRoutes(db, createStorageService(createLocalDiskStorageProvider(path.join(home, "storage")))));
    instance.use(errorHandler);
    return instance;
  }

  function upload(server: express.Express, bytes: number) {
    return request(server)
      .post(`/api/companies/${companyId}/assets/images`)
      .attach("file", Buffer.alloc(bytes, 1), { filename: "blob.bin", contentType: "application/octet-stream" });
  }

  async function stagedUploads() {
    return readdir(path.join(home, "instances", "default", "data", "tmp", "uploads")).catch(() => []);
  }

  it("prefers the saved setting over the environment, falls back to it, and applies a change without a restart", async () => {
    const server = app();
    const initial = await request(server).get("/api/health");
    expect(initial.body.attachmentLimit).toEqual({ maxBytes: 3 * MB, source: "env" });

    await request(server).patch("/api/instance/settings/general").send({ attachmentMaxMegabytes: 5 }).expect(200);
    const afterPatch = await request(server).get("/api/health");
    expect(afterPatch.body.attachmentLimit).toEqual({ maxBytes: 5 * MB, source: "setting" });

    await upload(server, 4 * MB).expect(201);
    const tooLarge = await upload(server, 5 * MB + 1);
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body.error).toBe("File is larger than the 5 MB limit");
    expect(await stagedUploads()).toEqual([]);

    await request(server).patch("/api/instance/settings/general").send({ attachmentMaxMegabytes: 1 }).expect(200);
    const shrunk = await upload(server, 2 * MB);
    expect(shrunk.status).toBe(413);
    expect(shrunk.body.error).toBe("File is larger than the 1 MB limit");

    await request(server).patch("/api/instance/settings/general").send({ attachmentMaxMegabytes: null }).expect(200);
    const cleared = await request(server).get("/api/health");
    expect(cleared.body.attachmentLimit).toEqual({ maxBytes: 3 * MB, source: "env" });
    expect((await upload(server, 3 * MB + 1)).status).toBe(413);
  }, 60_000);

  it("rejects limits outside 1-500 MB and non-integers", async () => {
    const server = app();
    for (const value of [0, 501, 2.5, "10"]) {
      await request(server).patch("/api/instance/settings/general").send({ attachmentMaxMegabytes: value }).expect(400);
    }
    await request(server).patch("/api/instance/settings/general").send({ attachmentMaxMegabytes: 500 }).expect(200);
    const general = await request(server).get("/api/instance/settings/general");
    expect(general.body.attachmentMaxMegabytes).toBe(500);
  });
});
