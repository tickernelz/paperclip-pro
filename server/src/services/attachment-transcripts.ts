import { createHash } from "node:crypto";
import { openAsBlob } from "node:fs";
import type { SpeechToTextSettings } from "@tickernelz/wardmote-shared";
import { logger } from "../middleware/logger.js";
import type { StorageService } from "../storage/types.js";
import {
  SpeechToTextError,
  speechToTextByteLimit,
  transcribeAudio,
  type SpeechToTextResult,
} from "./speech-to-text.js";

const CACHE_NAMESPACE = "speech-to-text-cache";
const CACHE_READ_LIMIT = 4 * 1024 * 1024;

export function speechToTextConfigKey(settings: SpeechToTextSettings): string {
  const providerOptions =
    settings.provider === "deepgram" ? settings.deepgram : settings.provider === "elevenlabs" ? settings.elevenlabs : settings.provider === "google" ? settings.google : null;
  const relevant = [
    settings.provider,
    settings.baseUrl,
    settings.model,
    settings.language,
    settings.provider === "openai_compatible" ? false : settings.diarize,
    settings.provider === "openai_compatible" ? [] : settings.keyterms,
    providerOptions,
  ];
  return createHash("sha256").update(JSON.stringify(relevant)).digest("hex").slice(0, 32);
}

export function transcriptCacheObjectKey(companyId: string, sha256: string, settings: SpeechToTextSettings): string | null {
  if (!/^[a-f0-9]{64}$/i.test(sha256)) return null;
  return companyId + "/" + CACHE_NAMESPACE + "/" + sha256.toLowerCase() + "-" + speechToTextConfigKey(settings) + ".json";
}

async function readCached(storage: StorageService, companyId: string, objectKey: string): Promise<SpeechToTextResult | null> {
  const head = await storage.headObject(companyId, objectKey);
  if (!head.exists || (head.contentLength ?? 0) > CACHE_READ_LIMIT) return null;
  const object = await storage.getObject(companyId, objectKey);
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of object.stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      total += buffer.length;
      if (total > CACHE_READ_LIMIT) return null;
      chunks.push(buffer);
    }
  } finally {
    object.stream.destroy();
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Partial<SpeechToTextResult> | null;
  if (!parsed || typeof parsed.text !== "string") return null;
  const result: SpeechToTextResult = { text: parsed.text };
  if (typeof parsed.language === "string") result.language = parsed.language;
  if (Array.isArray(parsed.segments)) result.segments = parsed.segments.filter((segment) => typeof segment?.speaker === "string" && typeof segment?.text === "string");
  return result;
}

export async function withTranscriptCache(
  input: { storage?: StorageService | null; companyId: string; sha256: string; settings: SpeechToTextSettings },
  run: () => Promise<SpeechToTextResult>,
): Promise<{ result: SpeechToTextResult; cached: boolean }> {
  const objectKey = input.storage ? transcriptCacheObjectKey(input.companyId, input.sha256, input.settings) : null;
  if (!input.storage || !objectKey) return { result: await run(), cached: false };
  const storage = input.storage;
  const hit = await readCached(storage, input.companyId, objectKey).catch(() => null);
  if (hit) return { result: hit, cached: true };
  const result = await run();
  await storage
    .putFile({
      companyId: input.companyId,
      namespace: CACHE_NAMESPACE,
      objectKey,
      originalFilename: null,
      contentType: "application/json",
      body: Buffer.from(JSON.stringify(result), "utf8"),
    })
    .catch((error) => {
      logger.warn({ companyId: input.companyId, error: error instanceof Error ? error.name : "unknown" }, "speech-to-text transcript cache was not written");
    });
  return { result, cached: false };
}

export interface StoredAudio {
  companyId: string;
  objectKey: string;
  sha256: string;
  byteSize: number;
  contentType: string;
  originalFilename: string | null;
}

export async function transcribeStoredAudio(input: {
  storage: StorageService;
  file: StoredAudio;
  settings: SpeechToTextSettings;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<{ result: SpeechToTextResult; cached: boolean }> {
  const { storage, file, settings } = input;
  const byteLimit = speechToTextByteLimit(settings, undefined, file.contentType);
  if (file.byteSize > byteLimit)
    throw new SpeechToTextError("stt_too_large", "Audio exceeds the " + byteLimit + " byte speech-to-text limit");
  return withTranscriptCache({ storage, companyId: file.companyId, sha256: file.sha256, settings }, async () => {
    const localPath = storage.localPath ? await storage.localPath(file.companyId, file.objectKey) : null;
    const object = localPath ? null : await storage.getObject(file.companyId, file.objectKey);
    try {
      const audio = localPath ? { blob: await openAsBlob(localPath) } : { stream: object!.stream };
      return await transcribeAudio(
        { ...audio, mime: file.contentType, filename: file.originalFilename || "audio" },
        { settings, env: input.env, fetchImpl: input.fetchImpl },
      );
    } finally {
      object?.stream.destroy();
    }
  });
}
