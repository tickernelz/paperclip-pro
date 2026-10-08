import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageService } from "../storage/types.js";

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  getByIdentifier: vi.fn(),
  createAttachment: vi.fn(),
  getAttachmentById: vi.fn(),
}));
const mockCompanyService = vi.hoisted(() => ({
  getById: vi.fn(),
}));
const mockWorkProductService = vi.hoisted(() => ({
  createForIssue: vi.fn(),
  getById: vi.fn(),
  update: vi.fn(),
}));
const mockAccessService = vi.hoisted(() => ({
  decide: vi.fn(async () => ({
    allowed: true,
    explanation: "Allowed by test mock",
  })),
  canUser: vi.fn(),
  hasPermission: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn(async () => undefined));

function registerRouteMocks() {
  vi.doMock("@tickernelz/paperclip-pro-shared/telemetry", () => ({
    trackAgentTaskCompleted: vi.fn(),
    trackErrorHandlerCrash: vi.fn(),
  }));

  vi.doMock("../telemetry.js", () => ({
    getTelemetryClient: vi.fn(() => ({ track: vi.fn() })),
  }));

  vi.doMock("../services/issues.js", () => ({
    issueService: () => mockIssueService,
  }));

  vi.doMock("../services/activity-log.js", () => ({
    logActivity: mockLogActivity,
  }));

  vi.doMock("../services/index.js", () => ({
    accessService: () => mockAccessService,
    agentService: () => ({
      getById: vi.fn(),
    }),
    companySkillService: () => ({}),
    companyService: () => mockCompanyService,
    documentAnnotationService: () => ({ remapOpenThreadsForDocument: async () => [] }),
    documentService: () => ({}),
    executionWorkspaceService: () => ({}),
    feedbackService: () => ({
      listIssueVotesForUser: vi.fn(async () => []),
      saveIssueVote: vi.fn(async () => ({ vote: null, consentEnabledNow: false, sharingEnabled: false })),
    }),
    goalService: () => ({}),
    heartbeatService: () => ({
      wakeup: vi.fn(async () => undefined),
      reportRunActivity: vi.fn(async () => undefined),
      getRun: vi.fn(async () => null),
      getActiveRunForAgent: vi.fn(async () => null),
      cancelRun: vi.fn(async () => null),
    }),
    instanceSettingsService: () => ({
      get: vi.fn(async () => ({
        id: "instance-settings-1",
        general: {
          censorUsernameInLogs: false,
          feedbackDataSharingPreference: "prompt",
        },
      })),
      listCompanyIds: vi.fn(async () => ["company-1"]),
    }),
    issueApprovalService: () => ({}),
    issueReferenceService: () => ({
      deleteDocumentSource: async () => undefined,
      diffIssueReferenceSummary: () => ({
        addedReferencedIssues: [],
        removedReferencedIssues: [],
        currentReferencedIssues: [],
      }),
      emptySummary: () => ({ outbound: [], inbound: [] }),
      listIssueReferenceSummary: async () => ({ outbound: [], inbound: [] }),
      syncComment: async () => undefined,
      syncDocument: async () => undefined,
      syncIssue: async () => undefined,
    }),
    issueThreadInteractionService: () => ({
      listForIssue: vi.fn(async () => []),
      expireRequestConfirmationsSupersededByComment: vi.fn(async () => []),
      expireStaleRequestConfirmationsForIssueDocument: vi.fn(async () => []),
    }),
    issueRecoveryActionService: () => ({
      getActiveForIssue: vi.fn(async () => null),
      listActiveForIssues: vi.fn(async () => new Map()),
    }),
    issueService: () => mockIssueService,
    logActivity: mockLogActivity,
    projectService: () => ({}),
    routineService: () => ({
      syncRunStatusForIssue: vi.fn(async () => undefined),
    }),
    workProductService: () => mockWorkProductService,
  }));
}

type TestStorageService = StorageService & {
  __calls: {
    putFile?: {
      companyId: string;
      namespace: string;
      originalFilename?: string | null;
      contentType: string;
      body: Buffer;
      byteSize?: number;
      sha256?: string;
    };
  };
};

function createStorageService(body = Buffer.from("test"), options: { failPut?: boolean } = {}): TestStorageService {
  const calls: TestStorageService["__calls"] = {};
  return {
    provider: "local_disk",
    __calls: calls,
    putFile: async (input) => {
      if (!("sourcePath" in input)) throw new Error("uploads must hand storage a staged file");
      const stagedBytes = await readFile(input.sourcePath);
      calls.putFile = { ...input, body: stagedBytes };
      if (options.failPut) throw new Error("storage unavailable");
      return {
      provider: "local_disk",
      objectKey: `${input.namespace}/${input.originalFilename ?? "upload"}`,
      contentType: input.contentType,
      byteSize: input.byteSize,
      sha256: input.sha256,
      originalFilename: input.originalFilename,
      };
    },
    getObject: vi.fn(async (_companyId, _objectKey, options) => {
      const range = options?.range;
      const streamBody = range ? body.subarray(range.start, range.end + 1) : body;
      return {
        stream: Readable.from(streamBody),
        contentLength: streamBody.length,
      };
    }),
    headObject: vi.fn(),
    deleteObject: vi.fn(),
  };
}

async function createApp(storage: StorageService, options?: { companyIds?: string[]; source?: string }) {
  const [{ errorHandler }, { issueRoutes }] = await Promise.all([
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
    vi.importActual<typeof import("../routes/issues.js")>("../routes/issues.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "local-board",
      companyIds: options?.companyIds ?? ["company-1"],
      source: options?.source ?? "local_implicit",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", issueRoutes({} as any, storage));
  app.use(errorHandler);
  return app;
}

function makeAttachment(contentType: string, originalFilename: string) {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: "attachment-1",
    companyId: "company-1",
    issueId: "11111111-1111-4111-8111-111111111111",
    issueCommentId: null,
    assetId: "asset-1",
    provider: "local_disk",
    objectKey: `issues/issue-1/${originalFilename}`,
    contentType,
    byteSize: 4,
    sha256: "sha256-sample",
    originalFilename,
    createdByAgentId: null,
    createdByUserId: "local-board",
    createdAt: now,
    updatedAt: now,
  };
}

function parseBinaryResponse(res: IncomingMessage, callback: (error: Error | null, body?: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
  res.on("error", callback);
}

describe("getMaxAttachmentBytes", () => {
  it("reads the deployment-level attachment cap from the environment on every call", async () => {
    const { getMaxAttachmentBytes } = await import("../attachment-types.js");
    vi.stubEnv("PAPERCLIP_ATTACHMENT_MAX_BYTES", "5");
    try {
      expect(getMaxAttachmentBytes()).toBe(5);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

let uploadHome: string;

async function stagedUploads() {
  return readdir(path.join(uploadHome, "instances", "default", "data", "tmp", "uploads")).catch(() => []);
}

describe("issue attachment routes", () => {
  beforeAll(async () => {
    uploadHome = await mkdtemp(path.join(os.tmpdir(), "paperclip-upload-home-"));
  });

  afterAll(async () => {
    await rm(uploadHome, { recursive: true, force: true });
  });

  afterEach(async () => {
    const { setAttachmentLimitSetting } = await import("../attachment-types.js");
    setAttachmentLimitSetting(null);
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.stubEnv("PAPERCLIP_HOME", uploadHome);
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", "default");
    vi.stubEnv("PAPERCLIP_ATTACHMENT_MAX_BYTES", "");
    vi.resetModules();
    vi.doUnmock("@tickernelz/paperclip-pro-shared/telemetry");
    vi.doUnmock("../telemetry.js");
    vi.doUnmock("../services/issues.js");
    vi.doUnmock("../services/index.js");
    vi.doUnmock("../services/activity-log.js");
    vi.doUnmock("../routes/issues.js");
    vi.doUnmock("../routes/authz.js");
    vi.doUnmock("../middleware/index.js");
    registerRouteMocks();
    vi.clearAllMocks();
    mockAccessService.decide.mockResolvedValue({
      allowed: true,
      explanation: "Allowed by test mock",
    });
    mockLogActivity.mockResolvedValue(undefined);
    mockIssueService.getById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      projectId: null,
      parentId: null,
      status: "todo",
      assigneeAgentId: null,
      assigneeUserId: null,
      identifier: "PAP-1",
    });
    mockCompanyService.getById.mockResolvedValue({
      id: "company-1",
    });
    mockWorkProductService.createForIssue.mockReset();
    mockWorkProductService.getById.mockReset();
    mockWorkProductService.update.mockReset();
  });

  it("accepts zip uploads for issue attachments", async () => {
    const storage = createStorageService();
    mockIssueService.getById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "PAP-1",
    });
    mockIssueService.createAttachment.mockResolvedValue(makeAttachment("application/zip", "bundle.zip"));

    const app = await createApp(storage);
    const res = await request(app)
      .post("/api/companies/company-1/issues/11111111-1111-4111-8111-111111111111/attachments")
      .attach("file", Buffer.from("zip"), { filename: "bundle.zip", contentType: "application/zip" });

    expect([200, 201]).toContain(res.status);
    const putFileCall = storage.__calls.putFile;
    expect(putFileCall).toMatchObject({
      companyId: "company-1",
      namespace: "issues/11111111-1111-4111-8111-111111111111",
      originalFilename: "bundle.zip",
      contentType: "application/zip",
    });
    expect(putFileCall?.body.toString()).toBe("zip");
    expect(putFileCall).toMatchObject({ byteSize: 3, sha256: createHash("sha256").update("zip").digest("hex") });
    expect(mockIssueService.createAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: "11111111-1111-4111-8111-111111111111",
        contentType: "application/zip",
        originalFilename: "bundle.zip",
      }),
    );
    expect(res.body.contentType).toBe("application/zip");
  });

  it("streams a 12 MB upload under the default limit and removes the staged temp file", async () => {
    const storage = createStorageService();
    mockIssueService.createAttachment.mockResolvedValue(makeAttachment("application/octet-stream", "big.bin"));
    const payload = Buffer.alloc(12 * 1024 * 1024, 7);

    const app = await createApp(storage);
    const res = await request(app)
      .post("/api/companies/company-1/issues/11111111-1111-4111-8111-111111111111/attachments")
      .attach("file", payload, { filename: "big.bin", contentType: "application/octet-stream" });

    expect(res.status).toBe(201);
    expect(storage.__calls.putFile).toMatchObject({
      byteSize: payload.length,
      sha256: createHash("sha256").update(payload).digest("hex"),
    });
    expect(storage.__calls.putFile?.body.equals(payload)).toBe(true);
    expect(await stagedUploads()).toEqual([]);
  });

  it("removes the staged temp file when storage fails", async () => {
    const storage = createStorageService(Buffer.from("test"), { failPut: true });

    const app = await createApp(storage);
    const res = await request(app)
      .post("/api/companies/company-1/issues/11111111-1111-4111-8111-111111111111/attachments")
      .attach("file", Buffer.from("payload"), { filename: "x.txt", contentType: "text/plain" });

    expect(res.status).toBe(500);
    expect(storage.__calls.putFile?.body.toString()).toBe("payload");
    expect(mockIssueService.createAttachment).not.toHaveBeenCalled();
    expect(await stagedUploads()).toEqual([]);
  });

  it("removes a newly stored object when attachment registration is rejected", async () => {
    const storage = createStorageService();
    const { HttpError } = await vi.importActual<
      typeof import("../errors.js")
    >("../errors.js");
    mockIssueService.createAttachment.mockRejectedValue(
      new HttpError(422, "Attachment selection limit reached", {
        code: "chat_attachment_selection_limit_exceeded",
      }),
    );

    const app = await createApp(storage);
    const res = await request(app)
      .post(
        "/api/companies/company-1/issues/11111111-1111-4111-8111-111111111111/attachments",
      )
      .attach("file", Buffer.from("overflow"), {
        filename: "overflow.txt",
        contentType: "text/plain",
      });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      error: "Attachment selection limit reached",
      details: { code: "chat_attachment_selection_limit_exceeded" },
    });
    expect(storage.deleteObject).toHaveBeenCalledWith(
      "company-1",
      "issues/11111111-1111-4111-8111-111111111111/overflow.txt",
    );
  });

  it("retains a stored object when attachment registration has an ambiguous server error", async () => {
    const storage = createStorageService();
    mockIssueService.createAttachment.mockRejectedValue(
      new Error("connection lost after commit"),
    );

    const app = await createApp(storage);
    await request(app)
      .post(
        "/api/companies/company-1/issues/11111111-1111-4111-8111-111111111111/attachments",
      )
      .attach("file", Buffer.from("ambiguous"), {
        filename: "ambiguous.txt",
        contentType: "text/plain",
      })
      .expect(500);

    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it("accepts default video uploads for issue attachments", async () => {
    const storage = createStorageService();
    mockIssueService.getById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "PAP-1",
    });
    mockIssueService.createAttachment.mockResolvedValue(makeAttachment("video/mp4", "clip.mp4"));

    const app = await createApp(storage);
    const res = await request(app)
      .post("/api/companies/company-1/issues/11111111-1111-4111-8111-111111111111/attachments")
      .attach("file", Buffer.from("mp4"), { filename: "clip.mp4", contentType: "video/mp4" });

    expect(res.status).toBe(201);
    expect(storage.__calls.putFile).toMatchObject({
      contentType: "video/mp4",
      originalFilename: "clip.mp4",
    });
    expect(res.body).toMatchObject({
      contentType: "video/mp4",
      contentPath: "/api/attachments/attachment-1/content",
      openPath: "/api/attachments/attachment-1/content",
      downloadPath: "/api/attachments/attachment-1/content?download=1",
    });
  });

  it("accepts arbitrary upload content types while preserving the stored MIME type", async () => {
    const storage = createStorageService();
    mockIssueService.getById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "PAP-1",
    });
    mockIssueService.createAttachment.mockResolvedValue(makeAttachment("application/x-msdownload", "payload.exe"));

    const app = await createApp(storage);
    const res = await request(app)
      .post("/api/companies/company-1/issues/11111111-1111-4111-8111-111111111111/attachments")
      .attach("file", Buffer.from("exe"), { filename: "payload.exe", contentType: "application/x-msdownload" });

    expect(res.status).toBe(201);
    expect(storage.__calls.putFile).toMatchObject({
      contentType: "application/x-msdownload",
      originalFilename: "payload.exe",
    });
    expect(mockIssueService.createAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: "application/x-msdownload",
        originalFilename: "payload.exe",
      }),
    );
    expect(res.body.contentType).toBe("application/x-msdownload");
  });

  it.each([
    ["application/x-msdos-program", "pantat lutpi.bat", "application/x-msdos-program"],
    ["application/x-msdownload", "setup.exe", "application/x-msdownload"],
    ["application/vnd.android.package-archive", "app.apk", "application/vnd.android.package-archive"],
    ["", "mystery.unknownext", "application/octet-stream"],
  ])("stores a %s upload of %s", async (uploadType, filename, storedType) => {
    const storage = createStorageService();
    mockIssueService.getById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "PAP-1",
    });
    mockIssueService.createAttachment.mockResolvedValue(makeAttachment(storedType, filename));

    const app = await createApp(storage);
    const res = await request(app)
      .post("/api/companies/company-1/issues/11111111-1111-4111-8111-111111111111/attachments")
      .attach("file", Buffer.from("@echo off"), uploadType ? { filename, contentType: uploadType } : { filename });

    expect(res.status).toBe(201);
    expect(storage.__calls.putFile).toMatchObject({ contentType: storedType, originalFilename: filename });
    expect(mockIssueService.createAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: storedType, originalFilename: filename }),
    );
  });

  it("accepts Office uploads with official MIME types for issue attachments", async () => {
    const contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const storage = createStorageService();
    mockIssueService.getById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "PAP-1",
    });
    mockIssueService.createAttachment.mockResolvedValue(makeAttachment(contentType, "raw-data.xlsx"));

    const app = await createApp(storage);
    const res = await request(app)
      .post("/api/companies/company-1/issues/11111111-1111-4111-8111-111111111111/attachments")
      .attach("file", Buffer.from("xlsx"), { filename: "raw-data.xlsx", contentType });

    expect(res.status).toBe(201);
    expect(storage.__calls.putFile).toMatchObject({
      contentType,
      originalFilename: "raw-data.xlsx",
    });
    expect(mockIssueService.createAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType,
        originalFilename: "raw-data.xlsx",
      }),
    );
  });

  it("infers Office MIME types for generic binary issue attachment uploads", async () => {
    const contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const storage = createStorageService();
    mockIssueService.getById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "PAP-1",
    });
    mockIssueService.createAttachment.mockResolvedValue(makeAttachment(contentType, "raw-data.xlsx"));

    const app = await createApp(storage);
    const res = await request(app)
      .post("/api/companies/company-1/issues/11111111-1111-4111-8111-111111111111/attachments")
      .attach("file", Buffer.from("xlsx"), {
        filename: "raw-data.xlsx",
        contentType: "application/octet-stream",
      });

    expect(res.status).toBe(201);
    expect(storage.__calls.putFile).toMatchObject({
      contentType,
      originalFilename: "raw-data.xlsx",
    });
    expect(mockIssueService.createAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType,
        originalFilename: "raw-data.xlsx",
      }),
    );
  });

  it("preserves generic binary uploads when the filename is not a known Office document", async () => {
    const storage = createStorageService();
    mockIssueService.getById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "PAP-1",
    });
    mockIssueService.createAttachment.mockResolvedValue(makeAttachment("application/octet-stream", "payload.bin"));

    const app = await createApp(storage);
    const res = await request(app)
      .post("/api/companies/company-1/issues/11111111-1111-4111-8111-111111111111/attachments")
      .attach("file", Buffer.from("bin"), { filename: "payload.bin", contentType: "application/octet-stream" });

    expect(res.status).toBe(201);
    expect(storage.__calls.putFile).toMatchObject({
      contentType: "application/octet-stream",
      originalFilename: "payload.bin",
    });
    expect(mockIssueService.createAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: "application/octet-stream",
        originalFilename: "payload.bin",
      }),
    );
    expect(res.body.contentType).toBe("application/octet-stream");
  });

  it("bounds an issue attachment by the saved instance limit with a 413", async () => {
    const storage = createStorageService();
    mockIssueService.getById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "PAP-1",
    });
    mockIssueService.createAttachment.mockResolvedValue(makeAttachment("application/octet-stream", "large.bin"));
    const { setAttachmentLimitSetting } = await import("../attachment-types.js");
    setAttachmentLimitSetting(5);

    const app = await createApp(storage);
    const res = await request(app)
      .post("/api/companies/company-1/issues/11111111-1111-4111-8111-111111111111/attachments")
      .attach("file", Buffer.alloc(5 * 1024 * 1024 + 1), {
        filename: "large.bin",
        contentType: "application/octet-stream",
      });

    expect(res.status).toBe(413);
    expect(res.body.error).toBe("File is larger than the 5 MB limit");
    expect(storage.__calls.putFile).toBeUndefined();
    expect(await stagedUploads()).toEqual([]);
    // The deployment cap is the only limit left. The route no longer reads a
    // per-company override, so it never loads the company to size an upload.
    expect(mockCompanyService.getById).not.toHaveBeenCalled();
  });

  it.each([
    ["text/html", "report.html"],
    ["image/svg+xml", "diagram.svg"],
    ["application/xhtml+xml", "page.xhtml"],
    ["application/javascript", "payload.js"],
  ])("serves active %s attachments as octet-stream downloads with nosniff", async (contentType, filename) => {
    const storage = createStorageService();
    mockIssueService.getAttachmentById.mockResolvedValue(makeAttachment(contentType, filename));

    const app = await createApp(storage);
    const res = await request(app)
      .get("/api/attachments/attachment-1/content")
      .buffer(true)
      .parse(parseBinaryResponse);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/octet-stream");
    expect(res.headers["content-disposition"]).toBe(`attachment; filename="${filename}"`);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toBe("sandbox; default-src 'none'");
  });

  it.each(["image/png, text/html", "image/png text/html", "image/png,text/html; charset=utf-8", "image", "image/png/html"])(
    "serves a malformed stored type %j as an octet-stream download",
    async (contentType) => {
      const storage = createStorageService();
      mockIssueService.getAttachmentById.mockResolvedValue(makeAttachment(contentType, "chart.png"));

      const app = await createApp(storage);
      const res = await request(app)
        .get("/api/attachments/attachment-1/content")
        .buffer(true)
        .parse(parseBinaryResponse);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("application/octet-stream");
      expect(res.headers["content-disposition"]).toBe('attachment; filename="chart.png"');
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["content-security-policy"]).toBe("sandbox; default-src 'none'");
    },
  );

  it("keeps safe image attachments inline with their stored type", async () => {
    const storage = createStorageService();
    mockIssueService.getAttachmentById.mockResolvedValue(makeAttachment("image/png", "chart.png"));

    const app = await createApp(storage);
    const res = await request(app)
      .get("/api/attachments/attachment-1/content")
      .buffer(true)
      .parse(parseBinaryResponse);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["content-disposition"]).toBe('inline; filename="chart.png"');
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toBeUndefined();
  });

  it("serves arbitrary binary attachments as downloads with nosniff", async () => {
    const storage = createStorageService();
    mockIssueService.getAttachmentById.mockResolvedValue(makeAttachment("application/x-msdownload", "payload.exe"));

    const app = await createApp(storage);
    const res = await request(app)
      .get("/api/attachments/attachment-1/content")
      .buffer(true)
      .parse(parseBinaryResponse);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/x-msdownload");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="payload.exe"');
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("declares utf-8 for inline markdown attachments", async () => {
    const storage = createStorageService(Buffer.from("# Hello\n"));
    mockIssueService.getAttachmentById.mockResolvedValue({
      ...makeAttachment("text/markdown", "notes.md"),
      byteSize: 8,
    });

    const app = await createApp(storage);
    const res = await request(app).get("/api/attachments/attachment-1/content");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/markdown; charset=utf-8");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("keeps the charset declaration on forced markdown downloads", async () => {
    const storage = createStorageService(Buffer.from("# Hello\n"));
    mockIssueService.getAttachmentById.mockResolvedValue({
      ...makeAttachment("text/markdown", "notes.md"),
      byteSize: 8,
    });

    const app = await createApp(storage);
    const res = await request(app).get("/api/attachments/attachment-1/content?download=1");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/markdown; charset=utf-8");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="notes.md"');
  });

  it("keeps image attachments inline for previews", async () => {
    const storage = createStorageService();
    mockIssueService.getAttachmentById.mockResolvedValue(makeAttachment("image/png", "preview.png"));

    const app = await createApp(storage);
    const res = await request(app).get("/api/attachments/attachment-1/content");

    expect(res.status).toBe(200);
    expect([
      undefined,
      'inline; filename="preview.png"',
    ]).toContain(res.headers["content-disposition"]);
  });

  it.each([
    {
      filename: '猫 "chart"; 100%.png',
      contentType: "image/png",
      filenameParameters: String.raw`filename="? \"chart\"; 100%.png"; filename*=UTF-8''%E7%8C%AB%20%22chart%22%3B%20100%25.png`,
    },
    {
      filename: 'report "final"; 100%.pdf',
      contentType: "application/pdf",
      filenameParameters: String.raw`filename="report \"final\"; 100%.pdf"`,
    },
  ].flatMap((file) => [false, true].flatMap((download) =>
    [false, true].map((range) => ({ ...file, download, range })),
  )))("preserves disposition filenames: $filename (download=$download, range=$range)", async ({
    filename, contentType, filenameParameters, download, range,
  }) => {
    const bytes = Buffer.from([0, 255, 128, 10, 13, 42]);
    const storage = createStorageService(bytes);
    mockIssueService.getAttachmentById.mockResolvedValue({
      ...makeAttachment(contentType, filename),
      byteSize: bytes.length,
    });
    const app = await createApp(storage);
    const downloadRequest = request(app)
      .get(`/api/attachments/attachment-1/content${download ? "?download=1" : ""}`)
      .buffer(true)
      .parse(parseBinaryResponse);
    if (range) downloadRequest.set("Range", "bytes=1-3");
    const res = await downloadRequest;

    expect(res.status).toBe(range ? 206 : 200);
    expect(res.headers["content-disposition"]).toBe(`${download ? "attachment" : "inline"}; ${filenameParameters}`);
    expect(res.headers["content-type"]).toBe(contentType);
    expect(res.headers["content-length"]).toBe(String(range ? 3 : bytes.length));
    expect(res.headers["accept-ranges"]).toBe("bytes");
    expect(res.headers["content-range"]).toBe(range ? "bytes 1-3/6" : undefined);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.body).toEqual(range ? bytes.subarray(1, 4) : bytes);
  });

  it("serves video attachments inline with byte-range support", async () => {
    const storage = createStorageService(Buffer.from("abcdef"));
    mockIssueService.getAttachmentById.mockResolvedValue({
      ...makeAttachment("video/mp4", "clip.mp4"),
      byteSize: 6,
    });

    const app = await createApp(storage);
    const res = await request(app)
      .get("/api/attachments/attachment-1/content")
      .set("Range", "bytes=1-3");

    expect(res.status).toBe(206);
    expect(res.headers["content-type"]).toContain("video/mp4");
    expect(res.headers["accept-ranges"]).toBe("bytes");
    expect(res.headers["content-range"]).toBe("bytes 1-3/6");
    expect(res.headers["content-length"]).toBe("3");
    expect(res.headers["content-disposition"]).toBe('inline; filename="clip.mp4"');
    expect(Buffer.from(res.body).toString("utf8")).toBe("bcd");
    expect(storage.getObject).toHaveBeenCalledWith(
      "company-1",
      "issues/issue-1/clip.mp4",
      { range: { start: 1, end: 3 } },
    );
  });

  it("serves mp4 attachments inline when stored with a generic binary content type", async () => {
    const storage = createStorageService(Buffer.from("abcdef"));
    mockIssueService.getAttachmentById.mockResolvedValue({
      ...makeAttachment("application/octet-stream", "clip.mp4"),
      byteSize: 6,
    });

    const app = await createApp(storage);
    const res = await request(app)
      .get("/api/attachments/attachment-1/content")
      .set("Range", "bytes=1-3");

    expect(res.status).toBe(206);
    expect(res.headers["content-type"]).toContain("video/mp4");
    expect(res.headers["content-disposition"]).toBe('inline; filename="clip.mp4"');
    expect(res.headers["content-range"]).toBe("bytes 1-3/6");
    expect(Buffer.from(res.body).toString("utf8")).toBe("bcd");
  });

  it("forces video downloads when the download path is requested", async () => {
    const storage = createStorageService();
    mockIssueService.getAttachmentById.mockResolvedValue(makeAttachment("video/webm", "clip.webm"));

    const app = await createApp(storage);
    const res = await request(app).get("/api/attachments/attachment-1/content?download=1");

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toBe('attachment; filename="clip.webm"');
  });

  it("rejects invalid byte ranges without streaming the object", async () => {
    const storage = createStorageService();
    mockIssueService.getAttachmentById.mockResolvedValue(makeAttachment("video/mp4", "clip.mp4"));

    const app = await createApp(storage);
    const res = await request(app)
      .get("/api/attachments/attachment-1/content")
      .set("Range", "bytes=99-100");

    expect(res.status).toBe(416);
    expect(res.headers["content-range"]).toBe("bytes */4");
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it("rejects cross-company attachment content reads", async () => {
    const storage = createStorageService();
    mockIssueService.getAttachmentById.mockResolvedValue(makeAttachment("video/mp4", "clip.mp4"));

    const app = await createApp(storage, { companyIds: ["company-2"], source: "session" });
    const res = await request(app).get("/api/attachments/attachment-1/content");

    // Cross-tenant reads return 404 (not 403) so the status code cannot be
    // used as an existence oracle for other tenants' attachment ids.
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Attachment not found");
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it("rejects same-company attachment content reads outside the parent issue boundary", async () => {
    const storage = createStorageService();
    mockIssueService.getAttachmentById.mockResolvedValue(makeAttachment("video/mp4", "clip.mp4"));
    mockAccessService.decide.mockResolvedValue({
      allowed: false,
      explanation: "Denied by test mock",
    });

    const app = await createApp(storage);
    const res = await request(app).get("/api/attachments/attachment-1/content");

    expect(res.status).toBe(403);
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it("canonicalizes paperclip artifact metadata before creating a work product", async () => {
    const storage = createStorageService();
    const issue = {
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "PAP-1",
      projectId: null,
    };
    mockIssueService.getById.mockResolvedValue(issue);
    mockIssueService.getAttachmentById.mockResolvedValue({
      ...makeAttachment("video/mp4", "clip.mp4"),
      id: "22222222-2222-4222-8222-222222222222",
      byteSize: 6,
      issueId: issue.id,
    });
    mockWorkProductService.createForIssue.mockResolvedValue({
      id: "work-product-1",
      issueId: issue.id,
      companyId: issue.companyId,
      type: "artifact",
      provider: "paperclip",
      title: "Clip",
      metadata: null,
    });

    const app = await createApp(storage);
    const res = await request(app)
      .post(`/api/issues/${issue.id}/work-products`)
      .send({
        type: "artifact",
        provider: "paperclip",
        title: "Clip",
        metadata: {
          attachmentId: "22222222-2222-4222-8222-222222222222",
          contentType: "video/mp4",
          byteSize: 6,
          contentPath: "https://evil.example/clip.mp4",
          openPath: "javascript:alert(1)",
          downloadPath: "javascript:alert(2)",
          originalFilename: "clip.mp4",
        },
      });

    expect(res.status).toBe(201);
    expect(mockWorkProductService.createForIssue).toHaveBeenCalledWith(
      issue.id,
      issue.companyId,
      expect.objectContaining({
        type: "artifact",
        provider: "paperclip",
        metadata: {
          attachmentId: "22222222-2222-4222-8222-222222222222",
          contentType: "video/mp4",
          byteSize: 6,
          contentPath: "/api/attachments/22222222-2222-4222-8222-222222222222/content",
          openPath: "/api/attachments/22222222-2222-4222-8222-222222222222/content",
          downloadPath: "/api/attachments/22222222-2222-4222-8222-222222222222/content?download=1",
          originalFilename: "clip.mp4",
        },
      }),
    );
  });

  it("rejects paperclip artifact metadata that references another issue's attachment", async () => {
    const storage = createStorageService();
    const issue = {
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "PAP-1",
      projectId: null,
    };
    mockIssueService.getById.mockResolvedValue(issue);
    mockIssueService.getAttachmentById.mockResolvedValue({
      ...makeAttachment("video/mp4", "clip.mp4"),
      id: "22222222-2222-4222-8222-222222222222",
      issueId: "different-issue",
    });

    const app = await createApp(storage);
    const res = await request(app)
      .post(`/api/issues/${issue.id}/work-products`)
      .send({
        type: "artifact",
        provider: "paperclip",
        title: "Clip",
        metadata: {
          attachmentId: "22222222-2222-4222-8222-222222222222",
        },
      });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("Attachment artifact must reference an attachment on the same issue");
    expect(mockWorkProductService.createForIssue).not.toHaveBeenCalled();
  });

  it("canonicalizes paperclip artifact metadata on work product updates", async () => {
    const storage = createStorageService();
    const issue = {
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "PAP-1",
      projectId: null,
    };
    mockWorkProductService.getById.mockResolvedValue({
      id: "work-product-1",
      issueId: issue.id,
      companyId: issue.companyId,
      type: "artifact",
      provider: "paperclip",
      title: "Clip",
      metadata: null,
    });
    mockIssueService.getById.mockResolvedValue(issue);
    mockIssueService.getAttachmentById.mockResolvedValue({
      ...makeAttachment("video/webm", "clip.webm"),
      id: "22222222-2222-4222-8222-222222222222",
      issueId: issue.id,
      byteSize: 8,
    });
    mockWorkProductService.update.mockResolvedValue({
      id: "work-product-1",
      issueId: issue.id,
      companyId: issue.companyId,
      type: "artifact",
      provider: "paperclip",
      title: "Clip",
      metadata: null,
    });

    const app = await createApp(storage);
    const res = await request(app)
      .patch("/api/work-products/work-product-1")
      .send({
        metadata: {
          attachmentId: "22222222-2222-4222-8222-222222222222",
          openPath: "javascript:alert(1)",
        },
      });

    expect(res.status).toBe(200);
    expect(mockWorkProductService.update).toHaveBeenCalledWith(
      "work-product-1",
      expect.objectContaining({
        metadata: {
          attachmentId: "22222222-2222-4222-8222-222222222222",
          contentType: "video/webm",
          byteSize: 8,
          contentPath: "/api/attachments/22222222-2222-4222-8222-222222222222/content",
          openPath: "/api/attachments/22222222-2222-4222-8222-222222222222/content",
          downloadPath: "/api/attachments/22222222-2222-4222-8222-222222222222/content?download=1",
          originalFilename: "clip.webm",
        },
      }),
    );
  });
});
