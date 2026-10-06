import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  agents,
  assets,
  chatActions,
  chatEndpoints,
  companies,
  createDb,
  issueAttachments,
  issueComments,
  issues,
  toolApplications,
  toolConnections,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import { SPEECH_TO_TEXT_DEFAULTS, type SpeechToTextSettings } from "@tickernelz/paperclip-pro-shared";
import { startEmbeddedPostgresTestDatabase } from "../helpers/embedded-postgres.js";
import { createLocalDiskStorageProvider } from "../../storage/local-disk-provider.js";
import { createStorageService } from "../../storage/service.js";
import { createOpenwaGatewayClient } from "../../services/openwa/gateway.js";
import { openwaMediaService, type OpenwaTranscriptReady } from "../../services/openwa/media.js";
import { normalizeOpenwaInbound, openwaDedupeKey } from "../../services/openwa/receiver.js";
import { SpeechToTextError, oggOpusDurationSeconds, transcribeAudio } from "../../services/speech-to-text.js";
import { instanceSettingsService } from "../../services/instance-settings.js";
import { instanceSettingsRoutes } from "../../routes/instance-settings.js";
import { errorHandler } from "../../middleware/index.js";
import { FAKE_OPENWA_KEY, FakeOpenwaGateway } from "./fake-gateway.js";

const SESSION_ID = "11111111-2222-4333-8444-555555555555";
const OWN_PHONE = "628111000111";
const PEER = "628222000222@c.us";
const STT_ENV = "OPENWA_TEST_STT_KEY";
const STT_SECRET = "sk-test-openwa-stt-secret-value";
const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(64, 7)]);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const VOICE = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(200, 3)]);

interface SttBehavior {
  status: number;
  delayMs: number;
  text: string;
}

class FakeSttServer {
  readonly requests: Array<{ authorization: string | undefined; model: string | null; filename: string | null; bytes: number }> = [];
  behavior: SttBehavior = { status: 200, delayMs: 0, text: "halo, tolong cek invoice nomor 42" };
  private server: Server | null = null;

  get baseUrl(): string {
    return "http://127.0.0.1:" + (this.server!.address() as AddressInfo).port + "/v1";
  }

  async start(): Promise<void> {
    this.server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const form = await new Response(Buffer.concat(chunks), {
        headers: { "content-type": req.headers["content-type"] ?? "" },
      }).formData();
      const file = form.get("file");
      this.requests.push({
        authorization: req.headers.authorization,
        model: typeof form.get("model") === "string" ? (form.get("model") as string) : null,
        filename: file instanceof File ? file.name : null,
        bytes: file instanceof File ? file.size : 0,
      });
      const { status, delayMs, text } = this.behavior;
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (res.destroyed) return;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(status === 200 ? { text, language: "id" } : { error: { message: "upstream exploded " + STT_SECRET } }));
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
  }

  async close(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}

describe.sequential("OpenWA media ingest and speech-to-text (embedded Postgres + fake gateway + fake STT)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let root: string;
  let storage: ReturnType<typeof createStorageService>;
  let gateway: FakeOpenwaGateway;
  let stt: FakeSttServer;
  const services: Array<ReturnType<typeof openwaMediaService>> = [];

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-openwa-media-");
    db = createDb(database.connectionString);
    root = await mkdtemp(path.join(tmpdir(), "openwa-media-"));
    storage = createStorageService(createLocalDiskStorageProvider(path.join(root, "storage")));
    gateway = new FakeOpenwaGateway({ sessionId: SESSION_ID, ownPhone: OWN_PHONE });
    await gateway.start();
    stt = new FakeSttServer();
    await stt.start();
  }, 60_000);
  afterEach(async () => {
    await Promise.all(services.splice(0).map((service) => service.shutdown()));
    gateway.media.clear();
    stt.behavior = { status: 200, delayMs: 0, text: "halo, tolong cek invoice nomor 42" };
    stt.requests.length = 0;
  });
  afterAll(async () => {
    await gateway?.close();
    await stt?.close();
    await database?.cleanup();
    if (root) await rm(root, { recursive: true, force: true });
  });

  function settings(overrides: Partial<SpeechToTextSettings> = {}): SpeechToTextSettings {
    return { enabled: true, baseUrl: stt.baseUrl, model: "whisper-test", apiKeyEnvVar: STT_ENV, maxAudioSeconds: 600, sttWaitSeconds: 5, ...overrides };
  }

  function service(options: { stt?: SpeechToTextSettings; mediaTimeoutMs?: number; maxBytes?: number; env?: Record<string, string | undefined> } = {}) {
    const created = openwaMediaService(db, {
      storage,
      speechToTextSettings: async () => options.stt ?? { ...SPEECH_TO_TEXT_DEFAULTS },
      env: options.env ?? { [STT_ENV]: STT_SECRET },
      mediaTimeoutMs: options.mediaTimeoutMs ?? 2_000,
      ...(options.maxBytes ? { maxBytes: options.maxBytes } : {}),
    });
    services.push(created);
    return created;
  }

  function client() {
    return createOpenwaGatewayClient({ baseUrl: gateway.baseUrl, apiKey: FAKE_OPENWA_KEY, sessionId: SESSION_ID });
  }

  async function seed() {
    const companyId = randomUUID();
    const endpointId = randomUUID();
    const issueId = randomUUID();
    const applicationId = randomUUID();
    const connectionId = randomUUID();
    const prefix = "M" + companyId.replaceAll("-", "").slice(0, 6).toUpperCase();
    const agentId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "OpenWA media", issuePrefix: prefix, requireBoardApprovalForNewAgents: false });
    await db.insert(agents).values({
      id: agentId, companyId, name: "OpenWA Agent", role: "engineer", status: "idle", adapterType: "paperclip_runner", adapterConfig: {}, runtimeConfig: {}, permissions: {},
    });
    await db.insert(toolApplications).values({
      id: applicationId, companyId, applicationKey: "chat:openwa:" + endpointId, name: "OpenWA", type: "chat", status: "active",
    });
    await db.insert(toolConnections).values({
      id: connectionId, companyId, applicationId, name: "OpenWA", uid: "chat-openwa-" + endpointId,
      connectionPurpose: "channel", transport: "chat_sdk", status: "active", enabled: true,
    });
    await db.insert(chatEndpoints).values({ id: endpointId, companyId, connectionId, provider: "openwa", publicId: randomUUID(), assignedAgentId: agentId, status: "active" });
    await db.insert(issues).values({ id: issueId, companyId, title: "WhatsApp chat", status: "todo", issueNumber: 1, identifier: prefix + "-1" });
    const [comment] = await db.insert(issueComments).values({ companyId, issueId, body: "inbound", authorType: "system" }).returning();
    return { endpoint: { id: endpointId, companyId }, issueId, commentId: comment!.id };
  }

  function event(input: { type: string; body?: string; media?: Record<string, unknown>; extra?: Record<string, unknown>; waMessageId?: string }) {
    const waMessageId = input.waMessageId ?? "false_" + PEER + "_3EB0" + randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
    const normalized = normalizeOpenwaInbound(
      {
        event: "message.received",
        sessionId: SESSION_ID,
        source: "live",
        data: {
          id: waMessageId, chatId: PEER, from: PEER, to: OWN_PHONE + "@c.us", body: input.body ?? "", type: input.type,
          timestamp: Math.floor(Date.now() / 1000), fromMe: false, isGroup: false, kind: "individual",
          ...(input.media ? { media: input.media } : {}), ...(input.extra ?? {}),
        },
      },
      OWN_PHONE + "@c.us",
      openwaDedupeKey(SESSION_ID, waMessageId)!,
      false,
    );
    return normalized!;
  }

  async function attachmentsOf(commentId: string) {
    return db
      .select({ id: issueAttachments.id, contentType: assets.contentType, byteSize: assets.byteSize, sha256: assets.sha256, filename: assets.originalFilename })
      .from(issueAttachments)
      .innerJoin(assets, eq(assets.id, issueAttachments.assetId))
      .where(eq(issueAttachments.issueCommentId, commentId));
  }

  async function mediaRecord(endpointId: string, waMessageId: string) {
    const [row] = await db
      .select()
      .from(chatActions)
      .where(and(eq(chatActions.endpointId, endpointId), eq(chatActions.providerActionId, "openwa_media:" + waMessageId)));
    return row;
  }

  it("stores an image and a document as attachments on the inbound comment and records the result", async () => {
    const target = await seed();
    const media = service();
    const image = event({ type: "image", media: { mimetype: "image/png", sizeBytes: PNG.length, omitted: true } });
    const document = event({ type: "document", media: { mimetype: "application/pdf", filename: "Invoice 42.pdf", omitted: true } });
    gateway.setMedia(PEER, image.waMessageId!, { body: PNG, contentType: "image/png" });
    gateway.setMedia(PEER, document.waMessageId!, { body: PDF, contentType: "application/octet-stream", filename: "ignored.bin" });

    const [imageResult] = await media.ingestOpenwaTriggerMedia({ ...target, client: client(), event: image });
    const [documentResult] = await media.ingestOpenwaTriggerMedia({ ...target, client: client(), event: document });

    expect(imageResult).toMatchObject({ kind: "image", status: "stored", reason: null, mime: "image/png", size: PNG.length });
    expect(documentResult).toMatchObject({ kind: "document", status: "stored", mime: "application/pdf", size: PDF.length, filename: "Invoice 42.pdf" });
    const stored = await attachmentsOf(target.commentId);
    expect(stored.map((row) => row.id).sort()).toEqual([imageResult!.attachmentId, documentResult!.attachmentId].sort());
    expect(stored.find((row) => row.id === imageResult!.attachmentId)).toMatchObject({
      contentType: "image/png", byteSize: PNG.length, sha256: createHash("sha256").update(PNG).digest("hex"),
    });
    const record = await mediaRecord(target.endpoint.id, image.waMessageId!);
    expect(record?.status).toBe("processed");
    expect((record?.payload as { items: unknown[] }).items).toEqual([imageResult]);
    expect(imageResult).not.toHaveProperty("transcriptStatus");
  });

  it("rejects a declared over-cap file without downloading it and a streamed over-cap file without storing it", async () => {
    const target = await seed();
    const media = service({ maxBytes: 1024 });
    const declared = event({ type: "video", media: { mimetype: "video/mp4", sizeBytes: 60 * 1024 * 1024, omitted: true } });
    gateway.setMedia(PEER, declared.waMessageId!, { body: Buffer.alloc(16), contentType: "video/mp4" });
    const streamed = event({ type: "document", media: { mimetype: "application/pdf", omitted: true } });
    gateway.setMedia(PEER, streamed.waMessageId!, { body: Buffer.alloc(4096, 1), contentType: "application/pdf", chunked: true });

    const [declaredResult] = await media.ingestOpenwaTriggerMedia({ ...target, client: client(), event: declared });
    const [streamedResult] = await media.ingestOpenwaTriggerMedia({ ...target, client: client(), event: streamed });

    expect(declaredResult).toMatchObject({ status: "rejected", reason: "too_large", limitBytes: 1024, attachmentId: null });
    expect(gateway.mediaRequests(declared.waMessageId!)).toBe(0);
    expect(streamedResult).toMatchObject({ status: "rejected", reason: "too_large", limitBytes: 1024, attachmentId: null });
    expect(gateway.mediaRequests(streamed.waMessageId!)).toBe(1);
    expect(await attachmentsOf(target.commentId)).toEqual([]);
  });

  it("stores a .bat program and an unknown binary as attachments with their original names", async () => {
    const target = await seed();
    const media = service();
    const script = Buffer.from("@echo off\r\necho halo\r\n");
    const bat = event({ type: "document", media: { mimetype: "application/x-msdos-program", filename: "pantat lutpi.bat", sizeBytes: script.length, omitted: true } });
    gateway.setMedia(PEER, bat.waMessageId!, { body: script, contentType: "application/x-msdos-program" });
    const binary = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0xff]);
    const unknown = event({ type: "document", media: { mimetype: "application/x-totally-unknown", filename: "payload", omitted: true } });
    gateway.setMedia(PEER, unknown.waMessageId!, { body: binary, contentType: "application/x-totally-unknown" });
    const untypedId = "false_" + PEER + "_3EB0UNTYPED0000001";
    gateway.setMedia(PEER, untypedId, { body: binary, contentType: "", filename: "blob.weird" });

    const [batResult] = await media.ingestOpenwaTriggerMedia({ ...target, client: client(), event: bat });
    const [unknownResult] = await media.ingestOpenwaTriggerMedia({ ...target, client: client(), event: unknown });
    const [untypedResult] = await media.fetchOpenwaMessageMedia({ ...target, client: client(), chatId: PEER, messageId: untypedId });

    expect(batResult).toMatchObject({ kind: "document", status: "stored", reason: null, mime: "application/x-msdos-program", filename: "pantat lutpi.bat", size: script.length });
    expect(unknownResult).toMatchObject({ kind: "document", status: "stored", reason: null, mime: "application/x-totally-unknown", filename: "payload", size: binary.length });
    expect(untypedResult).toMatchObject({ kind: "document", status: "stored", reason: null, mime: "application/octet-stream", filename: "blob.weird", size: binary.length });
    const stored = await attachmentsOf(target.commentId);
    expect(stored.find((row) => row.id === batResult!.attachmentId)).toMatchObject({
      contentType: "application/x-msdos-program", filename: "pantat lutpi.bat", sha256: createHash("sha256").update(script).digest("hex"),
    });
    expect(stored.find((row) => row.id === unknownResult!.attachmentId)).toMatchObject({ contentType: "application/x-totally-unknown", filename: "payload" });
    const [untypedRow] = await db.select({ assetId: issueAttachments.assetId, issueId: issueAttachments.issueId }).from(issueAttachments).where(eq(issueAttachments.id, untypedResult!.attachmentId!));
    expect(untypedRow?.issueId).toBe(target.issueId);
    const [untypedAsset] = await db.select().from(assets).where(eq(assets.id, untypedRow!.assetId));
    expect(untypedAsset).toMatchObject({ contentType: "application/octet-stream", originalFilename: "blob.weird" });
  });

  it("rejects a type outside PAPERCLIP_ALLOWED_ATTACHMENT_TYPES without downloading it when an operator restricts types", async () => {
    vi.stubEnv("PAPERCLIP_ALLOWED_ATTACHMENT_TYPES", "image/*,application/pdf");
    try {
      const target = await seed();
      const media = service();
      const bat = event({ type: "document", media: { mimetype: "application/x-msdos-program", filename: "pantat lutpi.bat", omitted: true } });
      gateway.setMedia(PEER, bat.waMessageId!, { body: Buffer.from("@echo off"), contentType: "application/x-msdos-program" });
      const [result] = await media.ingestOpenwaTriggerMedia({ ...target, client: client(), event: bat });
      expect(result).toMatchObject({ status: "rejected", reason: "unsupported_type", attachmentId: null });
      expect(gateway.mediaRequests(bat.waMessageId!)).toBe(0);
      expect(await attachmentsOf(target.commentId)).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("returns pending on a download timeout and the on-demand fetch later stores the same message once", async () => {
    const target = await seed();
    const media = service({ mediaTimeoutMs: 300 });
    const slow = event({ type: "image", media: { mimetype: "image/png", omitted: true } });
    gateway.setMedia(PEER, slow.waMessageId!, { body: PNG, contentType: "image/png", delayMs: 3_000 });

    const started = Date.now();
    const [pending] = await media.ingestOpenwaTriggerMedia({ ...target, client: client(), event: slow });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(pending).toMatchObject({ status: "pending", reason: "timeout", attachmentId: null });

    gateway.setMedia(PEER, slow.waMessageId!, { body: PNG, contentType: "image/png" });
    const [fetched] = await media.fetchOpenwaMessageMedia({ ...target, client: client(), chatId: PEER, messageId: slow.waMessageId! });
    expect(fetched).toMatchObject({ kind: "image", status: "stored", mime: "image/png", size: PNG.length });
    const [again] = await media.fetchOpenwaMessageMedia({ ...target, client: client(), chatId: PEER, messageId: slow.waMessageId! });
    expect(again).toEqual(fetched);
    expect(gateway.mediaRequests(slow.waMessageId!)).toBe(2);
    expect((await attachmentsOf(target.commentId)).map((row) => row.id)).toEqual([fetched!.attachmentId]);
  });

  it("fetches a non-trigger message on demand and attaches it to the issue", async () => {
    const target = await seed();
    const media = service();
    const messageId = "false_" + PEER + "_3EB0ONDEMAND000001";
    gateway.setMedia(PEER, messageId, { body: PDF, contentType: "application/pdf", filename: "report.pdf" });
    const [fetched] = await media.fetchOpenwaMessageMedia({ ...target, commentId: undefined, client: client(), chatId: PEER, messageId });
    expect(fetched).toMatchObject({ kind: "document", status: "stored", filename: "report.pdf", mime: "application/pdf" });
    const [row] = await db.select().from(issueAttachments).where(eq(issueAttachments.id, fetched!.attachmentId!));
    expect(row).toMatchObject({ issueId: target.issueId, issueCommentId: null });
  });

  it("transcribes a voice note when speech-to-text is enabled and stores the transcript as a derivative", async () => {
    const target = await seed();
    const media = service({ stt: settings() });
    const voice = event({ type: "voice", media: { mimetype: "audio/ogg; codecs=opus", sizeBytes: VOICE.length, omitted: true } });
    gateway.setMedia(PEER, voice.waMessageId!, { body: VOICE, contentType: "audio/ogg" });

    const [result] = await media.ingestOpenwaTriggerMedia({ ...target, client: client(), event: voice });

    expect(result).toMatchObject({ kind: "voice", status: "stored", mime: "audio/ogg", transcriptStatus: "done", transcript: "halo, tolong cek invoice nomor 42" });
    expect(stt.requests).toEqual([{ authorization: "Bearer " + STT_SECRET, model: "whisper-test", filename: expect.stringMatching(/\.ogg$/), bytes: VOICE.length }]);
    const stored = await attachmentsOf(target.commentId);
    expect(stored.map((row) => row.contentType).sort()).toEqual(["audio/ogg", "text/plain"]);
    const [derivative] = await db
      .select()
      .from(chatActions)
      .where(and(eq(chatActions.endpointId, target.endpoint.id), eq(chatActions.kind, "attachment_derivative")));
    expect(derivative?.payload).toMatchObject({ originalAttachmentId: result!.attachmentId, derivativeAttachmentId: result!.transcriptAttachmentId, kind: "voice_transcript" });
    expect(JSON.stringify(await mediaRecord(target.endpoint.id, voice.waMessageId!))).not.toContain(STT_SECRET);
  });

  it("keeps the audio and records transcript_unavailable when speech-to-text fails", async () => {
    const target = await seed();
    const media = service({ stt: settings() });
    stt.behavior = { status: 500, delayMs: 0, text: "" };
    const audio = event({ type: "audio", media: { mimetype: "audio/mpeg", omitted: true } });
    gateway.setMedia(PEER, audio.waMessageId!, { body: Buffer.alloc(512, 9), contentType: "audio/mpeg" });

    const [result] = await media.ingestOpenwaTriggerMedia({ ...target, client: client(), event: audio });

    expect(result).toMatchObject({ kind: "audio", status: "stored", transcriptStatus: "unavailable", transcriptError: "stt_unavailable" });
    expect(result).not.toHaveProperty("transcript");
    expect((await attachmentsOf(target.commentId)).map((row) => row.contentType)).toEqual(["audio/mpeg"]);
    expect(JSON.stringify(result)).not.toContain(STT_SECRET);
  });

  it("reports a missing API key environment variable without calling the endpoint", async () => {
    const target = await seed();
    const media = service({ stt: settings(), env: {} });
    const voice = event({ type: "voice", media: { mimetype: "audio/ogg", omitted: true } });
    gateway.setMedia(PEER, voice.waMessageId!, { body: VOICE, contentType: "audio/ogg" });
    const [result] = await media.ingestOpenwaTriggerMedia({ ...target, client: client(), event: voice });
    expect(result).toMatchObject({ status: "stored", transcriptStatus: "unavailable", transcriptError: "stt_missing_key" });
    expect(stt.requests).toHaveLength(0);
  });

  it("does not transcribe when speech-to-text is disabled", async () => {
    const target = await seed();
    const media = service({ stt: settings({ enabled: false }) });
    const voice = event({ type: "voice", media: { mimetype: "audio/ogg", omitted: true } });
    gateway.setMedia(PEER, voice.waMessageId!, { body: VOICE, contentType: "audio/ogg" });
    const [result] = await media.ingestOpenwaTriggerMedia({ ...target, client: client(), event: voice });
    expect(result).toMatchObject({ status: "stored", transcriptStatus: "disabled" });
    expect(stt.requests).toHaveLength(0);
    await expect(
      transcribeAudio({ buffer: VOICE, mime: "audio/ogg", filename: "v.ogg" }, { settings: settings({ enabled: false }), env: { [STT_ENV]: STT_SECRET } }),
    ).rejects.toMatchObject({ code: "stt_disabled" });
    expect(stt.requests).toHaveLength(0);
  });

  it("bounds the wake wait by sttWaitSeconds and delivers the late transcript through onTranscriptReady", async () => {
    const target = await seed();
    const media = service({ stt: settings({ sttWaitSeconds: 1 }) });
    stt.behavior = { status: 200, delayMs: 2_500, text: "late transcript" };
    const ready: OpenwaTranscriptReady[] = [];
    let resolveReady!: () => void;
    const delivered = new Promise<void>((resolve) => (resolveReady = resolve));
    media.onTranscriptReady((value) => {
      ready.push(value);
      resolveReady();
    });
    const voice = event({ type: "voice", media: { mimetype: "audio/ogg", omitted: true } });
    gateway.setMedia(PEER, voice.waMessageId!, { body: VOICE, contentType: "audio/ogg" });

    const started = Date.now();
    const [result] = await media.ingestOpenwaTriggerMedia({ ...target, client: client(), event: voice });
    const waited = Date.now() - started;

    expect(waited).toBeGreaterThanOrEqual(900);
    expect(waited).toBeLessThan(2_200);
    expect(result).toMatchObject({ status: "stored", transcriptStatus: "pending" });
    expect(result).not.toHaveProperty("transcript");
    await delivered;
    expect(ready).toEqual([
      expect.objectContaining({
        companyId: target.endpoint.companyId, endpointId: target.endpoint.id, issueId: target.issueId, commentId: target.commentId,
        waMessageId: voice.waMessageId, attachmentId: result!.attachmentId, transcriptStatus: "done", transcript: "late transcript",
      }),
    ]);
    const record = await mediaRecord(target.endpoint.id, voice.waMessageId!);
    expect((record?.payload as { items: Array<Record<string, unknown>> }).items[0]).toMatchObject({ transcriptStatus: "done", transcript: "late transcript" });
  });

  it("parses location and contact-card messages into structured data without fetching a file", async () => {
    const target = await seed();
    const media = service();
    const location = event({
      type: "location",
      extra: { location: { latitude: -6.2088, longitude: 106.8456, description: "Monas", address: "Jakarta Pusat", url: "https://maps.example.com/monas" } },
    });
    const vcard = [
      "BEGIN:VCARD", "VERSION:3.0", "N:Lovelace;Ada;;;", "FN:Ada Lovelace",
      "item1.TEL;waid=628123456789:+62 812-3456-789", "item1.X-ABLabel:Mobile", "TEL;TYPE=WORK:+62 21 555 0100", "END:VCARD",
    ].join("\n");
    const contact = event({ type: "contact", body: vcard });

    const locationResult = await media.ingestOpenwaTriggerMedia({ ...target, client: client(), event: location });
    const contactResult = await media.ingestOpenwaTriggerMedia({ ...target, client: client(), event: contact });

    expect(locationResult).toEqual([
      expect.objectContaining({
        kind: "location", status: "stored", attachmentId: null,
        location: { lat: -6.2088, lng: 106.8456, name: "Monas", address: "Jakarta Pusat", url: "https://maps.example.com/monas" },
      }),
    ]);
    expect(contactResult).toEqual([
      expect.objectContaining({ kind: "contact", status: "stored", attachmentId: null, contact: { vcard, name: "Ada Lovelace", numbers: ["628123456789", "62215550100"] } }),
    ]);
    expect(gateway.mediaRequests(location.waMessageId!) + gateway.mediaRequests(contact.waMessageId!)).toBe(0);
    expect(await attachmentsOf(target.commentId)).toEqual([]);
  });

  it("dedupes by (endpoint, waMessageId): a replayed trigger never downloads or stores twice", async () => {
    const target = await seed();
    const media = service();
    const image = event({ type: "image", media: { mimetype: "image/png", omitted: true } });
    gateway.setMedia(PEER, image.waMessageId!, { body: PNG, contentType: "image/png" });

    const first = await media.ingestOpenwaTriggerMedia({ ...target, client: client(), event: image });
    const second = await media.ingestOpenwaTriggerMedia({ ...target, client: client(), event: image });
    const concurrent = await Promise.all([
      media.ingestOpenwaTriggerMedia({ ...target, client: client(), event: image }),
      media.ingestOpenwaTriggerMedia({ ...target, client: client(), event: image }),
    ]);

    expect(second).toEqual(first);
    expect(concurrent).toEqual([first, first]);
    expect(gateway.mediaRequests(image.waMessageId!)).toBe(1);
    expect(await attachmentsOf(target.commentId)).toHaveLength(1);
    const rows = await db.select().from(chatActions).where(and(eq(chatActions.endpointId, target.endpoint.id), eq(chatActions.kind, "openwa_media")));
    expect(rows).toHaveLength(1);
  });

  it("refuses to attach media to an issue in another company", async () => {
    const target = await seed();
    const other = await seed();
    const media = service();
    const image = event({ type: "image", media: { mimetype: "image/png", omitted: true } });
    gateway.setMedia(PEER, image.waMessageId!, { body: PNG, contentType: "image/png" });
    await expect(
      media.ingestOpenwaTriggerMedia({ endpoint: target.endpoint, issueId: other.issueId, commentId: other.commentId, client: client(), event: image }),
    ).rejects.toThrow(/company/);
    expect(gateway.mediaRequests(image.waMessageId!)).toBe(0);
  });

  describe("speech-to-text client", () => {
    it("refuses audio longer than maxAudioSeconds without an HTTP call", async () => {
      const page = (granule: bigint) => {
        const header = Buffer.alloc(27);
        header.write("OggS", 0, "latin1");
        header.writeBigUInt64LE(granule, 6);
        return header;
      };
      const ogg = Buffer.concat([page(0n), Buffer.from("OpusHead"), Buffer.alloc(32), page(BigInt(48_000 * 700))]);
      expect(oggOpusDurationSeconds(ogg)).toBe(700);
      await expect(
        transcribeAudio({ buffer: ogg, mime: "audio/ogg", filename: "long.ogg" }, { settings: settings(), env: { [STT_ENV]: STT_SECRET } }),
      ).rejects.toMatchObject({ code: "stt_too_long" });
      await expect(
        transcribeAudio({ buffer: VOICE, mime: "audio/ogg", filename: "v.ogg", durationHintSeconds: 601 }, { settings: settings(), env: { [STT_ENV]: STT_SECRET } }),
      ).rejects.toBeInstanceOf(SpeechToTextError);
      expect(stt.requests).toHaveLength(0);
    });

    it("times out with a typed error", async () => {
      stt.behavior = { status: 200, delayMs: 1_000, text: "slow" };
      await expect(
        transcribeAudio({ buffer: VOICE, mime: "audio/ogg", filename: "v.ogg" }, { settings: settings(), env: { [STT_ENV]: STT_SECRET }, timeoutMs: 200 }),
      ).rejects.toMatchObject({ code: "stt_timeout" });
    });
  });

  describe("instance speechToText setting", () => {
    function app() {
      const server = express();
      server.use(express.json());
      server.use((req, _res, next) => {
        req.actor = { type: "board", userId: "local-board", source: "local_implicit", isInstanceAdmin: true } as typeof req.actor;
        next();
      });
      server.use("/api", instanceSettingsRoutes(db));
      server.use(errorHandler);
      return server;
    }

    it("round-trips through the API, never returns the key value and drives transcription", async () => {
      const previous = process.env[STT_ENV];
      process.env[STT_ENV] = STT_SECRET;
      try {
        const initial = await request(app()).get("/api/instance/settings/general");
        expect(initial.status).toBe(200);
        expect(initial.body.speechToText).toEqual(SPEECH_TO_TEXT_DEFAULTS);

        const next = settings({ sttWaitSeconds: 7 });
        const patched = await request(app()).patch("/api/instance/settings/general").send({ speechToText: next });
        expect(patched.status).toBe(200);
        expect(patched.body.speechToText).toEqual(next);
        const read = await request(app()).get("/api/instance/settings/general");
        expect(read.body.speechToText).toEqual(next);
        expect(JSON.stringify(patched.body) + JSON.stringify(read.body)).not.toContain(STT_SECRET);
        expect((await instanceSettingsService(db).getGeneral()).speechToText).toEqual(next);

        const target = await seed();
        const media = openwaMediaService(db, { storage });
        services.push(media);
        const voice = event({ type: "voice", media: { mimetype: "audio/ogg", omitted: true } });
        gateway.setMedia(PEER, voice.waMessageId!, { body: VOICE, contentType: "audio/ogg" });
        const [result] = await media.ingestOpenwaTriggerMedia({ ...target, client: client(), event: voice });
        expect(result).toMatchObject({ transcriptStatus: "done" });
        expect(stt.requests[0]?.authorization).toBe("Bearer " + STT_SECRET);
      } finally {
        if (previous === undefined) delete process.env[STT_ENV];
        else process.env[STT_ENV] = previous;
        await request(app()).patch("/api/instance/settings/general").send({ speechToText: SPEECH_TO_TEXT_DEFAULTS });
      }
    });

    it("rejects a stored key, an incomplete enable and a non-origin base URL", async () => {
      const invalid = [
        { ...SPEECH_TO_TEXT_DEFAULTS, apiKey: STT_SECRET },
        { ...SPEECH_TO_TEXT_DEFAULTS, apiKeyEnvVar: STT_SECRET },
        { ...SPEECH_TO_TEXT_DEFAULTS, enabled: true },
        { ...settings(), baseUrl: "https://api.example.com/v1/audio" },
        { ...settings(), baseUrl: "https://user:pass@api.example.com/v1" },
      ];
      for (const speechToText of invalid) {
        const response = await request(app()).patch("/api/instance/settings/general").send({ speechToText });
        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).not.toContain(STT_SECRET);
      }
      expect((await instanceSettingsService(db).getGeneral()).speechToText).toEqual(SPEECH_TO_TEXT_DEFAULTS);
      const origin = await request(app()).patch("/api/instance/settings/general").send({ speechToText: { ...SPEECH_TO_TEXT_DEFAULTS, baseUrl: "https://stt.example.com" } });
      expect(origin.status).toBe(200);
      await request(app()).patch("/api/instance/settings/general").send({ speechToText: SPEECH_TO_TEXT_DEFAULTS });
    });
  });
});
