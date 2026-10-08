import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  assets,
  companies,
  createDb,
  goals,
  instanceSettings,
  issueAttachments,
  issueComments,
  issueWorkProducts,
  issues,
} from "@tickernelz/paperclip-pro-db";
import { DEFAULT_ATTACHMENT_RETENTION, type AttachmentRetentionSettings } from "@tickernelz/paperclip-pro-shared";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { assetRoutes } from "../routes/assets.js";
import { issueRoutes } from "../routes/issues.js";
import { createLocalDiskStorageProvider } from "../storage/local-disk-provider.js";
import { createStorageService } from "../storage/service.js";
import type { StorageService } from "../storage/types.js";
import { attachmentRetentionService } from "../services/attachment-retention.js";
import { instanceSettingsService } from "../services/instance-settings.js";

const support = await getEmbeddedPostgresTestSupport();
const describePg = support.supported ? describe : describe.skip;

const DAY_MS = 24 * 60 * 60 * 1000;
const OLD = new Date(Date.now() - 30 * DAY_MS);
const VERY_OLD = new Date(Date.now() - 200 * DAY_MS);

const SETTINGS: AttachmentRetentionSettings = {
  enabled: true,
  orphanAfterDays: 7,
  closedTasks: { enabled: true, afterDays: 90 },
};

describePg("attachment retention", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;
  let storageRoot: string;
  let storage: StorageService;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-attachment-retention-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(issueWorkProducts);
    await db.delete(issueComments);
    await db.delete(issueAttachments);
    await db.delete(assets);
    await db.delete(goals);
    await db.delete(issues);
    await db.delete(companies);
    await db.delete(instanceSettings);
    await fs.rm(storageRoot, { recursive: true, force: true });
  });

  afterAll(async () => tempDb?.cleanup());

  async function writeObject(objectKey: string, mtime: Date, body = "payload") {
    const filePath = path.join(storageRoot, objectKey);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, body);
    await fs.utimes(filePath, mtime, mtime);
    return filePath;
  }

  async function seed() {
    storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "attachment-retention-"));
    storage = createStorageService(createLocalDiskStorageProvider(storageRoot));
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Retention",
      issuePrefix: "R" + companyId.slice(0, 6).toUpperCase(),
      requireBoardApprovalForNewAgents: false,
    });

    const openIssueId = randomUUID();
    const doneIssueId = randomUUID();
    const recentDoneIssueId = randomUUID();
    const undatedDoneIssueId = randomUUID();
    await db.insert(issues).values([
      { id: openIssueId, companyId, title: "Open", status: "in_progress" },
      { id: doneIssueId, companyId, title: "Done long ago", status: "done", completedAt: VERY_OLD },
      { id: recentDoneIssueId, companyId, title: "Done recently", status: "done", completedAt: OLD },
      { id: undatedDoneIssueId, companyId, title: "Done without date", status: "done", completedAt: null },
    ]);

    async function asset(namespace: string, createdAt: Date) {
      const id = randomUUID();
      const objectKey = companyId + "/" + namespace + "/2026/01/01/" + id + "-file.png";
      await writeObject(objectKey, createdAt);
      await db.insert(assets).values({
        id,
        companyId,
        provider: "local_disk",
        objectKey,
        contentType: "image/png",
        byteSize: 7,
        sha256: "a".repeat(64),
        originalFilename: "file.png",
        createdAt,
        updatedAt: createdAt,
      });
      return { id, objectKey };
    }

    async function attachment(issueId: string, namespace = "issues/" + issueId) {
      const stored = await asset(namespace, VERY_OLD);
      const id = randomUUID();
      await db.insert(issueAttachments).values({ id, companyId, issueId, assetId: stored.id });
      return { id, assetId: stored.id, objectKey: stored.objectKey };
    }

    const orphanObjectOld = companyId + "/issues/" + openIssueId + "/2026/01/01/stray-old.txt";
    const orphanObjectYoung = companyId + "/issues/" + openIssueId + "/2026/01/01/stray-young.txt";
    const orphanTmpYoung = companyId + "/issues/" + openIssueId + "/2026/01/01/upload.png.tmp-1-abc";
    const avatarObject = "generated-agent-avatars/v1/palette/idle-64-1.png";
    await writeObject(orphanObjectOld, OLD);
    await writeObject(orphanObjectYoung, new Date());
    await writeObject(orphanTmpYoung, new Date());
    await writeObject(avatarObject, VERY_OLD);

    const orphanAsset = await asset("assets/issues/drafts", OLD);
    const youngAsset = await asset("assets/issues/drafts", new Date());
    const commentReferencedAsset = await asset("assets/goals/drafts", OLD);
    const goalReferencedAsset = await asset("assets/goals/drafts", OLD);
    const agentAsset = await asset("assets/agents/" + randomUUID() + "/instructions/AGENTS.md", OLD);
    const panelAttachment = await attachment(openIssueId);

    const closedAttachment = await attachment(doneIssueId);
    const closedReferencedFromOpen = await attachment(doneIssueId);
    const closedDeliverable = await attachment(doneIssueId);
    const recentClosedAttachment = await attachment(recentDoneIssueId);
    const undatedClosedAttachment = await attachment(undatedDoneIssueId);

    await db.insert(issueComments).values([
      {
        companyId,
        issueId: openIssueId,
        body: "See ![shot](/api/assets/" + commentReferencedAsset.id + "/content) and [log](/api/attachments/" + closedReferencedFromOpen.id + "/content)",
      },
    ]);
    await db.insert(goals).values({
      companyId,
      title: "Goal",
      description: "![cover](/api/assets/" + goalReferencedAsset.id + "/content)",
    });
    await db.insert(issueWorkProducts).values({
      companyId,
      issueId: doneIssueId,
      type: "artifact",
      provider: "paperclip",
      externalId: closedDeliverable.id,
      title: "Deliverable",
      status: "active",
      metadata: { attachmentId: closedDeliverable.id },
    });

    return {
      companyId,
      openIssueId,
      doneIssueId,
      orphanObjectOld,
      orphanObjectYoung,
      orphanTmpYoung,
      avatarObject,
      orphanAsset,
      youngAsset,
      commentReferencedAsset,
      goalReferencedAsset,
      agentAsset,
      panelAttachment,
      closedAttachment,
      closedReferencedFromOpen,
      closedDeliverable,
      recentClosedAttachment,
      undatedClosedAttachment,
    };
  }

  async function exists(objectKey: string) {
    return fs.stat(path.join(storageRoot, objectKey)).then(() => true, () => false);
  }

  async function purgedAt(assetId: string) {
    const [row] = await db.select({ purgedAt: assets.purgedAt }).from(assets).where(eq(assets.id, assetId));
    return row?.purgedAt ?? null;
  }

  function contentApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = { type: "board", userId: "local-board", source: "local_implicit", companyIds: [], isInstanceAdmin: true };
      next();
    });
    app.use("/api", assetRoutes(db, storage));
    app.use("/api", issueRoutes(db, storage));
    app.use(errorHandler);
    return app;
  }

  function rule(report: { rules: { rule: string; count: number; bytes: number; sampleIds: string[] }[] }, name: string) {
    return report.rules.find((entry) => entry.rule === name)!;
  }

  it("previews exactly the old unreferenced files and deletes nothing", async () => {
    const f = await seed();
    const service = attachmentRetentionService(db, { storage });

    const report = await service.preview(SETTINGS);

    expect(report.mode).toBe("preview");
    expect(rule(report, "orphan_objects").sampleIds).toEqual([f.orphanObjectOld]);
    expect(rule(report, "orphan_assets").sampleIds).toEqual([f.orphanAsset.id]);
    expect(rule(report, "closed_tasks").sampleIds).toEqual([f.closedAttachment.id]);
    expect(report.totalCount).toBe(3);
    expect(report.totalBytes).toBe(7 * 3);

    for (const key of [f.orphanObjectOld, f.orphanObjectYoung, f.orphanTmpYoung, f.avatarObject, f.orphanAsset.objectKey, f.closedAttachment.objectKey]) {
      expect(await exists(key)).toBe(true);
    }
    expect(await purgedAt(f.orphanAsset.id)).toBeNull();
    expect(await purgedAt(f.closedAttachment.assetId)).toBeNull();
  });

  it("skips the closed-task rule unless it is enabled", async () => {
    await seed();
    const service = attachmentRetentionService(db, { storage });

    const report = await service.preview({ ...SETTINGS, closedTasks: { enabled: false, afterDays: 90 } });

    expect(rule(report, "closed_tasks").count).toBe(0);
    expect(rule(report, "orphan_assets").count).toBe(1);
  });

  it("runs the purge, tombstones assets, logs activity and serves 410 afterwards", async () => {
    const f = await seed();
    await instanceSettingsService(db).updateGeneral({ attachmentRetention: { ...SETTINGS, enabled: false } });
    const service = attachmentRetentionService(db, { storage });

    const report = await service.run({ trigger: "manual", actor: { actorType: "user", actorId: "admin-1" } });

    expect(report.mode).toBe("run");
    expect(report.totalCount).toBe(3);
    expect(report.failedCount).toBe(0);
    expect(await exists(f.orphanObjectOld)).toBe(false);
    expect(await exists(f.orphanAsset.objectKey)).toBe(false);
    expect(await exists(f.closedAttachment.objectKey)).toBe(false);
    for (const key of [
      f.orphanObjectYoung,
      f.orphanTmpYoung,
      f.avatarObject,
      f.youngAsset.objectKey,
      f.commentReferencedAsset.objectKey,
      f.goalReferencedAsset.objectKey,
      f.agentAsset.objectKey,
      f.panelAttachment.objectKey,
      f.closedReferencedFromOpen.objectKey,
      f.closedDeliverable.objectKey,
      f.recentClosedAttachment.objectKey,
      f.undatedClosedAttachment.objectKey,
    ]) {
      expect(await exists(key)).toBe(true);
    }
    expect(await purgedAt(f.orphanAsset.id)).toBeInstanceOf(Date);
    expect(await purgedAt(f.closedAttachment.assetId)).toBeInstanceOf(Date);
    expect(await purgedAt(f.panelAttachment.assetId)).toBeNull();
    const attachmentRows = await db.select({ id: issueAttachments.id }).from(issueAttachments).where(eq(issueAttachments.id, f.closedAttachment.id));
    expect(attachmentRows).toHaveLength(1);

    const activity = await db.select().from(activityLog).where(eq(activityLog.action, "attachment.retention_purged"));
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ companyId: f.companyId, entityType: "company", entityId: f.companyId, actorType: "user", actorId: "admin-1" });
    expect(activity[0]!.details).toMatchObject({
      trigger: "manual",
      totalBytes: 21,
      rules: {
        orphan_objects: { count: 1, bytes: 7 },
        orphan_assets: { count: 1, bytes: 7 },
        closed_tasks: { count: 1, bytes: 7 },
      },
    });

    const status = await attachmentRetentionService(db, { storage }).status();
    expect(status.lastRun).toMatchObject({ mode: "run", trigger: "manual", totalCount: 3 });

    const app = contentApp();
    const assetResponse = await request(app).get("/api/assets/" + f.orphanAsset.id + "/content");
    expect(assetResponse.status).toBe(410);
    expect(assetResponse.headers["x-paperclip-purged-at"]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(assetResponse.body).toMatchObject({ code: "attachment_purged" });
    expect(assetResponse.body.error).toMatch(/^File removed by retention \(\d{4}-\d{2}-\d{2}\)$/);

    const attachmentResponse = await request(app).get("/api/attachments/" + f.closedAttachment.id + "/content");
    expect(attachmentResponse.status).toBe(410);
    expect(attachmentResponse.body).toMatchObject({ code: "attachment_purged", purgedAt: attachmentResponse.headers["x-paperclip-purged-at"] });

    const listing = await request(app).get("/api/issues/" + f.doneIssueId + "/attachments");
    expect(listing.status).toBe(200);
    const purgedEntry = listing.body.find((entry: { id: string }) => entry.id === f.closedAttachment.id);
    expect(purgedEntry.purgedAt).toEqual(expect.any(String));

    const second = await service.preview(SETTINGS);
    expect(second.totalCount).toBe(0);
  });

  it("scheduled tick does nothing while retention is disabled", async () => {
    const f = await seed();
    await instanceSettingsService(db).updateGeneral({ attachmentRetention: { ...SETTINGS, enabled: false } });
    const service = attachmentRetentionService(db, { storage });

    expect(await service.scheduledTick()).toBeNull();

    expect(await exists(f.orphanObjectOld)).toBe(true);
    expect(await purgedAt(f.orphanAsset.id)).toBeNull();
    expect((await service.status()).lastRun).toBeNull();
    expect(DEFAULT_ATTACHMENT_RETENTION.enabled).toBe(false);
  });

  it("scheduled tick runs once a day while retention is enabled", async () => {
    const f = await seed();
    await instanceSettingsService(db).updateGeneral({ attachmentRetention: SETTINGS });
    const service = attachmentRetentionService(db, { storage });

    const first = await service.scheduledTick();
    const second = await service.scheduledTick();

    expect(first).toMatchObject({ mode: "run", trigger: "scheduled", totalCount: 3 });
    expect(second).toBeNull();
    expect(await exists(f.orphanObjectOld)).toBe(false);
    const activity = await db.select().from(activityLog).where(eq(activityLog.action, "attachment.retention_purged"));
    expect(activity[0]).toMatchObject({ actorType: "system", actorId: "attachment_retention" });
  });
});
