import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import {
  assets,
  chatActions,
  chatEndpoints,
  issueAttachments,
  issues,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import type { SpeechToTextSettings } from "@tickernelz/paperclip-pro-shared";
import {
  MAX_ATTACHMENT_BYTES,
  isAllowedContentType,
  normalizeContentType,
  normalizeUploadAttachmentContentType,
} from "../../attachment-types.js";
import { logger } from "../../middleware/logger.js";
import type { StorageService } from "../../storage/types.js";
import { issueService } from "../issues.js";
import { instanceSettingsService } from "../instance-settings.js";
import { SpeechToTextError, transcribeAudio, type SpeechToTextErrorCode } from "../speech-to-text.js";
import { OpenwaGatewayError, type OpenwaGatewayClient } from "./gateway.js";
import type { OpenwaInboundEvent } from "./receiver.js";

type EndpointRow = typeof chatEndpoints.$inferSelect;
type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type OpenwaMediaKind = "image" | "video" | "audio" | "voice" | "document" | "sticker" | "location" | "contact";
export type OpenwaMediaStatus = "stored" | "pending" | "rejected";
export type OpenwaMediaReason =
  | "timeout"
  | "gateway_unavailable"
  | "too_large"
  | "unsupported_type"
  | "empty"
  | "unavailable"
  | "storage_unavailable";
export type OpenwaTranscriptStatus = "done" | "pending" | "unavailable" | "disabled";

export interface OpenwaLocation {
  lat: number;
  lng: number;
  name: string | null;
  address: string | null;
  url: string | null;
}

export interface OpenwaContactCard {
  vcard: string;
  name: string | null;
  numbers: string[];
}

export interface OpenwaIngestedMedia {
  kind: OpenwaMediaKind;
  waMessageId: string;
  status: OpenwaMediaStatus;
  reason: OpenwaMediaReason | null;
  attachmentId: string | null;
  mime: string | null;
  size: number | null;
  filename: string | null;
  transcriptStatus?: OpenwaTranscriptStatus;
  transcript?: string;
  transcriptTruncated?: boolean;
  transcriptError?: SpeechToTextErrorCode;
  transcriptAttachmentId?: string | null;
  location?: OpenwaLocation;
  contact?: OpenwaContactCard;
}

export interface OpenwaTranscriptReady {
  companyId: string;
  endpointId: string;
  issueId: string;
  commentId: string | null;
  deliveryId: string | null;
  chatId: string;
  waMessageId: string;
  attachmentId: string;
  transcriptStatus: "done" | "unavailable";
  transcript?: string;
  transcriptError?: SpeechToTextErrorCode;
  transcriptAttachmentId: string | null;
}

export type OpenwaTranscriptListener = (ready: OpenwaTranscriptReady) => void | Promise<void>;

export interface OpenwaMediaServiceOptions {
  storage?: StorageService;
  speechToTextSettings?: () => Promise<SpeechToTextSettings>;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  mediaTimeoutMs?: number;
  maxBytes?: number;
}

export interface OpenwaTriggerMediaInput {
  endpoint: Pick<EndpointRow, "id" | "companyId">;
  client: OpenwaGatewayClient;
  issueId: string;
  commentId: string;
  deliveryId?: string | null;
  event: OpenwaInboundEvent;
}

export interface OpenwaMessageMediaInput {
  endpoint: Pick<EndpointRow, "id" | "companyId">;
  client: OpenwaGatewayClient;
  issueId: string;
  chatId: string;
  messageId: string;
  commentId?: string | null;
}

export const OPENWA_MEDIA_FETCH_TIMEOUT_MS = 30_000;
export const OPENWA_MEDIA_ACTION_KIND = "openwa_media";
export const OPENWA_TRANSCRIPT_PAYLOAD_LIMIT = 20_000;
const MEDIA_CLAIM_STALE_MS = 120_000;
const VCARD_LIMIT = 16 * 1024;
const DOWNLOADABLE_KINDS = new Set<OpenwaMediaKind>(["image", "video", "audio", "voice", "document", "sticker"]);
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/webm": "webm",
  "audio/wav": "wav",
  "application/pdf": "pdf",
  "text/plain": "txt",
};

interface MediaRecordPayload {
  version: 1;
  issueId: string;
  commentId: string | null;
  chatId: string;
  waMessageId: string;
  items: OpenwaIngestedMedia[];
}

interface Descriptor {
  kind: OpenwaMediaKind;
  mime: string | null;
  declaredSize: number | null;
  filename: string | null;
}

interface Downloaded {
  body: Buffer;
  contentType: string;
  filename: string | null;
}

class DownloadDeadline extends Error {
  constructor() {
    super("OpenWA media download deadline elapsed");
    this.name = "DownloadDeadline";
  }
}

class DownloadTooLarge extends Error {
  constructor() {
    super("OpenWA media exceeds the attachment limit");
    this.name = "DownloadTooLarge";
  }
}

function sanitizeFilename(value: string | null | undefined): string | null {
  if (!value) return null;
  const leaf = value.replaceAll("\\", "/").split("/").pop()?.trim();
  return leaf ? leaf.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255) : null;
}

function mediaKindOf(type: string, mime: string | null): OpenwaMediaKind | null {
  switch (type) {
    case "image":
    case "video":
    case "audio":
    case "voice":
    case "document":
    case "sticker":
    case "location":
    case "contact":
      return type;
    case "ptt":
      return "voice";
    case "vcard":
    case "multi_vcard":
      return "contact";
  }
  if (!mime) return null;
  return kindFromMime(mime);
}

function kindFromMime(mime: string): OpenwaMediaKind {
  const essence = normalizeContentType(mime);
  if (essence.startsWith("image/")) return "image";
  if (essence.startsWith("video/")) return "video";
  if (essence.startsWith("audio/")) return "audio";
  return "document";
}

function isAudioKind(kind: OpenwaMediaKind): boolean {
  return kind === "audio" || kind === "voice";
}

function fallbackFilename(kind: OpenwaMediaKind, contentType: string, waMessageId: string): string {
  const suffix = createHash("sha256").update(waMessageId).digest("hex").slice(0, 10);
  return kind + "-" + suffix + "." + (EXTENSIONS[contentType] ?? "bin");
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseOpenwaLocation(source: Record<string, unknown> | null): OpenwaLocation | null {
  if (!source) return null;
  const lat = finiteNumber(source.latitude) ?? finiteNumber(source.lat);
  const lng = finiteNumber(source.longitude) ?? finiteNumber(source.lng);
  if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return {
    lat,
    lng,
    name: text(source.description) ?? text(source.name),
    address: text(source.address),
    url: text(source.url),
  };
}

function vcardValue(line: string): string {
  const index = line.indexOf(":");
  return index < 0 ? "" : line.slice(index + 1).trim();
}

export function parseOpenwaVcards(source: string): OpenwaContactCard[] {
  const cards = source.match(/BEGIN:VCARD[\s\S]*?END:VCARD/gi) ?? [];
  return cards.map((card) => {
    const vcard = card.length > VCARD_LIMIT ? card.slice(0, VCARD_LIMIT) : card;
    const lines = card.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
    let name: string | null = null;
    let structured: string | null = null;
    const numbers: string[] = [];
    for (const line of lines) {
      const property = line.slice(0, line.indexOf(":") < 0 ? line.length : line.indexOf(":")).replace(/^item\d+\./i, "");
      const key = property.split(";", 1)[0]!.toUpperCase();
      if (key === "FN" && !name) name = vcardValue(line) || null;
      else if (key === "N" && !structured) {
        const parts = vcardValue(line).split(";").map((part) => part.trim()).filter(Boolean);
        structured = parts.length ? [...parts.slice(1), parts[0]].join(" ") : null;
      } else if (key === "TEL") {
        const waid = /waid=(\d{5,20})/i.exec(property)?.[1];
        const digits = waid ?? vcardValue(line).replace(/\D/g, "");
        if (digits.length >= 5 && digits.length <= 20 && !numbers.includes(digits)) numbers.push(digits);
      }
    }
    return { vcard, name: name ?? structured, numbers };
  });
}

function contactSources(event: OpenwaInboundEvent): string {
  const parts: string[] = [];
  if (event.body.includes("BEGIN:VCARD")) parts.push(event.body);
  const vcards = event.raw.vCards;
  if (Array.isArray(vcards)) for (const card of vcards) if (typeof card === "string") parts.push(card);
  return parts.join("\n");
}

function triggerDescriptors(event: OpenwaInboundEvent): Descriptor[] {
  const kind = mediaKindOf(event.type, event.media?.mimetype ?? null);
  if (!kind) return [];
  if (kind === "location" || kind === "contact") return [{ kind, mime: null, declaredSize: null, filename: null }];
  return [
    {
      kind,
      mime: event.media?.mimetype ?? null,
      declaredSize: event.media?.sizeBytes ?? null,
      filename: event.media?.filename ?? null,
    },
  ];
}

function boundTranscript(value: string): { transcript: string; transcriptTruncated?: true } {
  return value.length > OPENWA_TRANSCRIPT_PAYLOAD_LIMIT
    ? { transcript: value.slice(0, OPENWA_TRANSCRIPT_PAYLOAD_LIMIT), transcriptTruncated: true }
    : { transcript: value };
}

function sleep(ms: number): { promise: Promise<"elapsed">; cancel(): void } {
  let timer: NodeJS.Timeout | null = null;
  const promise = new Promise<"elapsed">((resolve) => {
    timer = setTimeout(() => resolve("elapsed"), ms);
    timer.unref?.();
  });
  return { promise, cancel: () => timer && clearTimeout(timer) };
}

async function collect(stream: Readable, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.length;
    if (total > limit) {
      stream.destroy();
      throw new DownloadTooLarge();
    }
    chunks.push(buffer);
  }
  return chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks, total);
}

function gatewayFailure(error: unknown): { status: "pending" | "rejected"; reason: OpenwaMediaReason } {
  if (error instanceof DownloadDeadline) return { status: "pending", reason: "timeout" };
  if (error instanceof DownloadTooLarge) return { status: "rejected", reason: "too_large" };
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))
    return { status: "pending", reason: "timeout" };
  if (error instanceof OpenwaGatewayError) {
    if (error.code === "payload_too_large") return { status: "rejected", reason: "too_large" };
    if (error.code === "gateway_unavailable" && /timed out/.test(error.message)) return { status: "pending", reason: "timeout" };
    if (["gateway_unavailable", "gateway_error", "rate_limited", "retry_after", "uncertain"].includes(error.code))
      return { status: "pending", reason: "gateway_unavailable" };
    return { status: "rejected", reason: "unavailable" };
  }
  return { status: "pending", reason: "gateway_unavailable" };
}

/** Trigger media ingest and on-demand media fetch for OpenWA, with optional speech-to-text. */
export function openwaMediaService(db: Db, options: OpenwaMediaServiceOptions = {}) {
  const maxBytes = Math.min(options.maxBytes ?? MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_BYTES);
  const mediaTimeoutMs = options.mediaTimeoutMs ?? OPENWA_MEDIA_FETCH_TIMEOUT_MS;
  const settingsSource =
    options.speechToTextSettings ?? (async () => (await instanceSettingsService(db).getGeneral()).speechToText);
  const listeners = new Set<OpenwaTranscriptListener>();
  const background = new Set<Promise<void>>();
  const controllers = new Set<AbortController>();
  let stopped = false;

  interface Scope {
    companyId: string;
    endpointId: string;
    issueId: string;
    commentId: string | null;
    deliveryId: string | null;
    chatId: string;
    waMessageId: string;
  }

  function providerActionId(waMessageId: string): string {
    return "openwa_media:" + waMessageId;
  }

  async function assertIssueScope(scope: Scope): Promise<void> {
    const [issue] = await db
      .select({ id: issues.id })
      .from(issues)
      .where(and(eq(issues.companyId, scope.companyId), eq(issues.id, scope.issueId)))
      .limit(1);
    if (!issue) throw new Error("OpenWA media target issue is not in the endpoint's company");
  }

  type Claim =
    | { claimed: true; id: string; previous: OpenwaIngestedMedia[]; commentId: string | null }
    | { claimed: false; items: OpenwaIngestedMedia[]; settled: boolean };

  async function claim(scope: Scope, retryUnsettled: boolean): Promise<Claim> {
    const payload: MediaRecordPayload = {
      version: 1,
      issueId: scope.issueId,
      commentId: scope.commentId,
      chatId: scope.chatId,
      waMessageId: scope.waMessageId,
      items: [],
    };
    const [inserted] = await db
      .insert(chatActions)
      .values({
        companyId: scope.companyId,
        endpointId: scope.endpointId,
        deliveryId: scope.deliveryId,
        kind: OPENWA_MEDIA_ACTION_KIND,
        providerActionId: providerActionId(scope.waMessageId),
        payload: payload as unknown as Record<string, unknown>,
        status: "processing",
        updatedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: chatActions.id });
    if (inserted) return { claimed: true, id: inserted.id, previous: [], commentId: scope.commentId };
    const [existing] = await db
      .select()
      .from(chatActions)
      .where(
        and(
          eq(chatActions.companyId, scope.companyId),
          eq(chatActions.endpointId, scope.endpointId),
          eq(chatActions.providerActionId, providerActionId(scope.waMessageId)),
        ),
      )
      .limit(1);
    if (!existing || existing.kind !== OPENWA_MEDIA_ACTION_KIND)
      throw new Error("OpenWA media record conflicts with another chat action");
    const existingPayload = existing.payload as unknown as MediaRecordPayload;
    const items = (existingPayload.items ?? []) as OpenwaIngestedMedia[];
    if (existingPayload.issueId !== scope.issueId) return { claimed: false, items, settled: true };
    const stale =
      existing.status === "failed" ||
      (existing.status === "processing" && existing.updatedAt.getTime() <= Date.now() - MEDIA_CLAIM_STALE_MS);
    const retryable = existing.status === "processed" && retryUnsettled && items.some((item) => item.status === "pending");
    if (!stale && !retryable) return { claimed: false, items, settled: existing.status === "processed" };
    const [reclaimed] = await db
      .update(chatActions)
      .set({ status: "processing", updatedAt: new Date() })
      .where(
        and(
          eq(chatActions.companyId, scope.companyId),
          eq(chatActions.id, existing.id),
          eq(chatActions.status, existing.status),
          eq(chatActions.updatedAt, existing.updatedAt),
        ),
      )
      .returning({ id: chatActions.id });
    if (!reclaimed) return { claimed: false, items, settled: false };
    return { claimed: true, id: existing.id, previous: items, commentId: existingPayload.commentId ?? scope.commentId };
  }

  async function finalize(scope: Scope, id: string, items: OpenwaIngestedMedia[]): Promise<void> {
    const payload: MediaRecordPayload = {
      version: 1,
      issueId: scope.issueId,
      commentId: scope.commentId,
      chatId: scope.chatId,
      waMessageId: scope.waMessageId,
      items,
    };
    await db
      .update(chatActions)
      .set({ status: "processed", payload: payload as unknown as Record<string, unknown>, updatedAt: new Date() })
      .where(and(eq(chatActions.companyId, scope.companyId), eq(chatActions.id, id)));
  }

  async function release(scope: Scope, id: string): Promise<void> {
    await db
      .update(chatActions)
      .set({ status: "failed", updatedAt: new Date() })
      .where(and(eq(chatActions.companyId, scope.companyId), eq(chatActions.id, id)))
      .catch(() => undefined);
  }

  async function download(client: OpenwaGatewayClient, chatId: string, messageId: string): Promise<Downloaded> {
    let stream: Readable | null = null;
    let expired = false;
    let timer: NodeJS.Timeout | null = null;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        expired = true;
        stream?.destroy();
        reject(new DownloadDeadline());
      }, mediaTimeoutMs);
      timer.unref?.();
    });
    const work = (async () => {
      const media = await client.downloadMedia({ chatId, messageId, maxBytes, timeoutMs: mediaTimeoutMs });
      stream = media.stream;
      if (expired) {
        media.stream.destroy();
        throw new DownloadDeadline();
      }
      if (media.contentLength !== null && media.contentLength > maxBytes) {
        media.stream.destroy();
        throw new DownloadTooLarge();
      }
      const body = await collect(media.stream, maxBytes);
      return { body, contentType: media.contentType, filename: media.filename };
    })();
    work.catch(() => undefined);
    try {
      return await Promise.race([work, deadline]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function storeFile(
    scope: Scope,
    input: { body: Buffer; contentType: string; filename: string },
  ): Promise<{ attachmentId: string; sha256: string }> {
    const storage = options.storage!;
    const sha256 = createHash("sha256").update(input.body).digest("hex");
    if (scope.commentId) {
      const [existing] = await db
        .select({ id: issueAttachments.id })
        .from(issueAttachments)
        .innerJoin(assets, and(eq(assets.companyId, issueAttachments.companyId), eq(assets.id, issueAttachments.assetId)))
        .where(
          and(
            eq(issueAttachments.companyId, scope.companyId),
            eq(issueAttachments.issueId, scope.issueId),
            eq(issueAttachments.issueCommentId, scope.commentId),
            eq(assets.sha256, sha256),
            eq(assets.byteSize, input.body.length),
            eq(assets.contentType, input.contentType),
            eq(assets.originalFilename, input.filename),
          ),
        )
        .limit(1);
      if (existing) return { attachmentId: existing.id, sha256 };
    }
    const stored = await storage.putFile({
      companyId: scope.companyId,
      namespace: "issues/" + scope.issueId,
      originalFilename: input.filename,
      contentType: input.contentType,
      body: input.body,
    });
    try {
      const row = await issueService(db).createAttachment({
        issueId: scope.issueId,
        issueCommentId: scope.commentId,
        provider: stored.provider,
        objectKey: stored.objectKey,
        contentType: stored.contentType,
        byteSize: stored.byteSize,
        sha256: stored.sha256,
        originalFilename: stored.originalFilename,
        createdByUserId: null,
      });
      return { attachmentId: row.id, sha256: stored.sha256 };
    } catch (error) {
      await storage.deleteObject(scope.companyId, stored.objectKey).catch(() => undefined);
      throw error;
    }
  }

  async function persistTranscript(
    scope: Scope,
    source: { attachmentId: string; sha256: string; filename: string },
    transcript: string,
  ): Promise<string | null> {
    if (!options.storage || !transcript || !isAllowedContentType("text/plain")) return null;
    const body = Buffer.from(transcript, "utf8");
    const base = source.filename.replace(/\.[^.]+$/, "");
    const derivative = await storeFile(scope, {
      body,
      contentType: "text/plain",
      filename: (base + " (transcript).txt").slice(0, 255),
    });
    await db
      .insert(chatActions)
      .values({
        companyId: scope.companyId,
        endpointId: scope.endpointId,
        deliveryId: scope.deliveryId,
        kind: "attachment_derivative",
        providerActionId: "openwa-voice_transcript:" + scope.waMessageId + ":" + source.attachmentId,
        payload: {
          originalAttachmentId: source.attachmentId,
          derivativeAttachmentId: derivative.attachmentId,
          originalSha256: source.sha256,
          derivativeSha256: derivative.sha256,
          kind: "voice_transcript",
        },
        status: "processed",
      })
      .onConflictDoNothing();
    return derivative.attachmentId;
  }

  async function applyLateTranscript(
    scope: Scope,
    attachmentId: string,
    patch: Pick<OpenwaIngestedMedia, "transcriptStatus" | "transcript" | "transcriptTruncated" | "transcriptError" | "transcriptAttachmentId">,
  ): Promise<void> {
    await db.transaction(async (tx: DbTransaction) => {
      const [row] = await tx
        .select({ id: chatActions.id, payload: chatActions.payload })
        .from(chatActions)
        .where(
          and(
            eq(chatActions.companyId, scope.companyId),
            eq(chatActions.endpointId, scope.endpointId),
            eq(chatActions.providerActionId, providerActionId(scope.waMessageId)),
          ),
        )
        .for("update")
        .limit(1);
      if (!row) return;
      const payload = row.payload as unknown as MediaRecordPayload;
      const items = (payload.items ?? []).map((item) =>
        item.attachmentId === attachmentId && item.transcriptStatus === "pending" ? { ...item, ...patch } : item,
      );
      await tx
        .update(chatActions)
        .set({ payload: { ...payload, items } as unknown as Record<string, unknown>, updatedAt: new Date() })
        .where(and(eq(chatActions.companyId, scope.companyId), eq(chatActions.id, row.id)));
    });
  }

  async function emit(ready: OpenwaTranscriptReady): Promise<void> {
    for (const listener of listeners) {
      try {
        await listener(ready);
      } catch (error) {
        logger.warn(
          { endpointId: ready.endpointId, issueId: ready.issueId, error: error instanceof Error ? error.name : "unknown" },
          "OpenWA transcript listener failed",
        );
      }
    }
  }

  async function transcribe(
    scope: Scope,
    item: OpenwaIngestedMedia,
    audio: { body: Buffer; contentType: string; filename: string; sha256: string },
    settingsPromise: Promise<SpeechToTextSettings>,
    finalized: Promise<void>,
  ): Promise<void> {
    let settings: SpeechToTextSettings;
    try {
      settings = await settingsPromise;
    } catch {
      item.transcriptStatus = "unavailable";
      item.transcriptError = "stt_unavailable";
      return;
    }
    if (!settings.enabled) {
      item.transcriptStatus = "disabled";
      return;
    }
    const controller = new AbortController();
    controllers.add(controller);
    const source = { attachmentId: item.attachmentId!, sha256: audio.sha256, filename: audio.filename };
    const attempt = (async () => {
      try {
        const result = await transcribeAudio(
          { buffer: audio.body, mime: audio.contentType, filename: audio.filename, signal: controller.signal },
          { settings, env: options.env, fetchImpl: options.fetchImpl, maxBytes },
        );
        const transcriptAttachmentId = await persistTranscript(scope, source, result.text).catch((error) => {
          logger.warn(
            { endpointId: scope.endpointId, issueId: scope.issueId, error: error instanceof Error ? error.name : "unknown" },
            "OpenWA transcript derivative was not stored",
          );
          return null;
        });
        return { ok: true as const, text: result.text, transcriptAttachmentId };
      } catch (error) {
        const code: SpeechToTextErrorCode = error instanceof SpeechToTextError ? error.code : "stt_network";
        return { ok: false as const, code };
      } finally {
        controllers.delete(controller);
      }
    })();
    const wait = sleep(settings.sttWaitSeconds * 1000);
    const first = await Promise.race([attempt, wait.promise]);
    wait.cancel();
    if (first !== "elapsed") {
      if (first.ok) {
        Object.assign(item, { transcriptStatus: "done" as const, transcriptAttachmentId: first.transcriptAttachmentId, ...boundTranscript(first.text) });
      } else {
        item.transcriptStatus = "unavailable";
        item.transcriptError = first.code;
      }
      return;
    }
    item.transcriptStatus = "pending";
    const late = (async () => {
      const outcome = await attempt;
      await finalized.catch(() => undefined);
      const patch = outcome.ok
        ? { transcriptStatus: "done" as const, transcriptAttachmentId: outcome.transcriptAttachmentId, ...boundTranscript(outcome.text) }
        : { transcriptStatus: "unavailable" as const, transcriptError: outcome.code };
      await applyLateTranscript(scope, item.attachmentId!, patch);
      await emit({
        companyId: scope.companyId,
        endpointId: scope.endpointId,
        issueId: scope.issueId,
        commentId: scope.commentId,
        deliveryId: scope.deliveryId,
        chatId: scope.chatId,
        waMessageId: scope.waMessageId,
        attachmentId: item.attachmentId!,
        transcriptStatus: patch.transcriptStatus,
        ...(outcome.ok ? { transcript: outcome.text } : { transcriptError: outcome.code }),
        transcriptAttachmentId: outcome.ok ? outcome.transcriptAttachmentId : null,
      });
    })().catch((error) => {
      logger.warn(
        { endpointId: scope.endpointId, issueId: scope.issueId, error: error instanceof Error ? error.name : "unknown" },
        "OpenWA late transcript was not recorded",
      );
    });
    background.add(late);
    void late.finally(() => background.delete(late));
  }

  async function processDownloadable(
    scope: Scope,
    client: OpenwaGatewayClient,
    descriptor: Descriptor,
    settings: () => Promise<SpeechToTextSettings>,
    finalized: Promise<void>,
  ): Promise<OpenwaIngestedMedia> {
    const declaredMime = descriptor.mime ? normalizeContentType(descriptor.mime) : null;
    const item: OpenwaIngestedMedia = {
      kind: descriptor.kind,
      waMessageId: scope.waMessageId,
      status: "rejected",
      reason: null,
      attachmentId: null,
      mime: declaredMime,
      size: descriptor.declaredSize,
      filename: sanitizeFilename(descriptor.filename),
      ...(isAudioKind(descriptor.kind) ? { transcriptStatus: "unavailable" as const } : {}),
    };
    if (descriptor.declaredSize !== null && descriptor.declaredSize > maxBytes) return { ...item, reason: "too_large" };
    if (declaredMime && declaredMime !== "application/octet-stream") {
      const candidate = normalizeUploadAttachmentContentType({
        contentType: declaredMime,
        originalFilename: item.filename,
        isAllowedContentType,
      });
      if (!isAllowedContentType(candidate)) return { ...item, reason: "unsupported_type" };
    }
    if (!options.storage) return { ...item, reason: "storage_unavailable" };
    let downloaded: Downloaded;
    try {
      downloaded = await download(client, scope.chatId, scope.waMessageId);
    } catch (error) {
      const failure = gatewayFailure(error);
      if (isAudioKind(descriptor.kind) && failure.status === "pending") item.transcriptStatus = "pending";
      return { ...item, ...failure };
    }
    if (downloaded.body.length === 0) return { ...item, reason: "empty" };
    const filename =
      item.filename ?? sanitizeFilename(downloaded.filename) ?? fallbackFilename(descriptor.kind, declaredMime ?? normalizeContentType(downloaded.contentType), scope.waMessageId);
    const contentType = normalizeUploadAttachmentContentType({
      contentType: declaredMime && declaredMime !== "application/octet-stream" ? declaredMime : downloaded.contentType,
      originalFilename: filename,
      isAllowedContentType,
    });
    const sized = { ...item, mime: contentType, size: downloaded.body.length, filename };
    if (!isAllowedContentType(contentType)) return { ...sized, reason: "unsupported_type" };
    const kind = descriptor.kind === "document" && !descriptor.mime ? kindFromMime(contentType) : descriptor.kind;
    let stored: { attachmentId: string; sha256: string };
    try {
      stored = await storeFile(scope, { body: downloaded.body, contentType, filename });
    } catch (error) {
      logger.warn(
        { endpointId: scope.endpointId, issueId: scope.issueId, error: error instanceof Error ? error.name : "unknown" },
        "OpenWA media was not stored",
      );
      return { ...sized, reason: "storage_unavailable" };
    }
    const result: OpenwaIngestedMedia = {
      ...sized,
      kind,
      status: "stored",
      reason: null,
      attachmentId: stored.attachmentId,
      ...(isAudioKind(kind) ? { transcriptStatus: "unavailable" as const } : {}),
    };
    if (isAudioKind(kind) && contentType.startsWith("audio/"))
      await transcribe(scope, result, { body: downloaded.body, contentType, filename, sha256: stored.sha256 }, settings(), finalized);
    return result;
  }

  async function run(
    scope: Scope,
    client: OpenwaGatewayClient,
    descriptors: Descriptor[],
    structured: OpenwaIngestedMedia[],
    retryUnsettled: boolean,
  ): Promise<OpenwaIngestedMedia[]> {
    if (stopped) throw new Error("OpenWA media service is shut down");
    if (descriptors.length) await assertIssueScope(scope);
    const claimed = await claim(scope, retryUnsettled);
    if (!claimed.claimed) {
      if (claimed.items.length || claimed.settled) return claimed.items;
      return [
        ...descriptors.map((descriptor) => ({
          kind: descriptor.kind,
          waMessageId: scope.waMessageId,
          status: "pending" as const,
          reason: "gateway_unavailable" as const,
          attachmentId: null,
          mime: descriptor.mime ? normalizeContentType(descriptor.mime) : null,
          size: descriptor.declaredSize,
          filename: sanitizeFilename(descriptor.filename),
          ...(isAudioKind(descriptor.kind) ? { transcriptStatus: "pending" as const } : {}),
        })),
        ...structured,
      ];
    }
    let markFinalized!: () => void;
    let markFailed!: (error: unknown) => void;
    const finalized = new Promise<void>((resolve, reject) => {
      markFinalized = resolve;
      markFailed = reject;
    });
    finalized.catch(() => undefined);
    let settingsPromise: Promise<SpeechToTextSettings> | null = null;
    const settings = () => (settingsPromise ??= settingsSource());
    scope = { ...scope, commentId: claimed.commentId };
    try {
      const keep = claimed.previous.filter((item) => item.status !== "pending");
      const retried: Descriptor[] = claimed.previous
        .filter((item) => item.status === "pending" && DOWNLOADABLE_KINDS.has(item.kind))
        .map((item) => ({ kind: item.kind, mime: item.mime, declaredSize: item.size, filename: item.filename }));
      const todo = keep.some((item) => DOWNLOADABLE_KINDS.has(item.kind)) ? [] : retried.length ? retried : descriptors;
      const items = [
        ...keep,
        ...(await Promise.all(todo.map((descriptor) => processDownloadable(scope, client, descriptor, settings, finalized)))),
        ...(keep.some((item) => !DOWNLOADABLE_KINDS.has(item.kind)) ? [] : structured),
      ];
      await finalize(scope, claimed.id, items);
      markFinalized();
      return items;
    } catch (error) {
      markFailed(error);
      await release(scope, claimed.id);
      throw error;
    }
  }

  return {
    /** Downloads and attaches a trigger message's media to its inbound comment, once per (endpoint, WhatsApp message). */
    async ingestOpenwaTriggerMedia(input: OpenwaTriggerMediaInput): Promise<OpenwaIngestedMedia[]> {
      const descriptors = triggerDescriptors(input.event);
      if (!descriptors.length) return [];
      const waMessageId = input.event.waMessageId ?? input.event.dedupeKey;
      const structured: OpenwaIngestedMedia[] = [];
      const downloadable: Descriptor[] = [];
      for (const descriptor of descriptors) {
        if (descriptor.kind === "location") {
          const location = parseOpenwaLocation(input.event.location);
          structured.push({
            kind: "location",
            waMessageId,
            status: location ? "stored" : "rejected",
            reason: location ? null : "unavailable",
            attachmentId: null,
            mime: null,
            size: null,
            filename: null,
            ...(location ? { location } : {}),
          });
        } else if (descriptor.kind === "contact") {
          const cards = parseOpenwaVcards(contactSources(input.event));
          if (!cards.length)
            structured.push({ kind: "contact", waMessageId, status: "rejected", reason: "unavailable", attachmentId: null, mime: null, size: null, filename: null });
          for (const contact of cards)
            structured.push({ kind: "contact", waMessageId, status: "stored", reason: null, attachmentId: null, mime: null, size: null, filename: null, contact });
        } else if (!input.event.waMessageId) {
          structured.push({
            kind: descriptor.kind,
            waMessageId,
            status: "rejected",
            reason: "unavailable",
            attachmentId: null,
            mime: descriptor.mime ? normalizeContentType(descriptor.mime) : null,
            size: descriptor.declaredSize,
            filename: sanitizeFilename(descriptor.filename),
            ...(isAudioKind(descriptor.kind) ? { transcriptStatus: "unavailable" as const } : {}),
          });
        } else downloadable.push(descriptor);
      }
      const scope: Scope = {
        companyId: input.endpoint.companyId,
        endpointId: input.endpoint.id,
        issueId: input.issueId,
        commentId: input.commentId,
        deliveryId: input.deliveryId ?? null,
        chatId: input.event.chatId,
        waMessageId,
      };
      return run(scope, input.client, downloadable, structured, false);
    },

    /** Fetches one message's media on demand (openwa_get_media), reusing an earlier stored copy when present. */
    async fetchOpenwaMessageMedia(input: OpenwaMessageMediaInput): Promise<OpenwaIngestedMedia[]> {
      const scope: Scope = {
        companyId: input.endpoint.companyId,
        endpointId: input.endpoint.id,
        issueId: input.issueId,
        commentId: input.commentId ?? null,
        deliveryId: null,
        chatId: input.chatId,
        waMessageId: input.messageId,
      };
      return run(scope, input.client, [{ kind: "document", mime: null, declaredSize: null, filename: null }], [], true);
    },

    /** Registers a callback for transcripts that finish after the wake was released; returns an unsubscribe function. */
    onTranscriptReady(listener: OpenwaTranscriptListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async shutdown(): Promise<void> {
      stopped = true;
      for (const controller of controllers) controller.abort();
      await Promise.allSettled([...background]);
      listeners.clear();
    },
  };
}

export type OpenwaMediaService = ReturnType<typeof openwaMediaService>;
