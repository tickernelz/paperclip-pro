import type { Readable } from "node:stream";
import type { SpeechToTextSettings } from "@tickernelz/paperclip-pro-shared";
import { getMaxAttachmentBytes } from "../attachment-types.js";

export type SpeechToTextErrorCode =
  | "stt_disabled"
  | "stt_missing_key"
  | "stt_too_long"
  | "stt_too_large"
  | "stt_empty"
  | "stt_timeout"
  | "stt_rejected"
  | "stt_unavailable"
  | "stt_network"
  | "stt_invalid_response";

export class SpeechToTextError extends Error {
  readonly code: SpeechToTextErrorCode;
  readonly status: number | null;

  constructor(code: SpeechToTextErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = "SpeechToTextError";
    this.code = code;
    this.status = status;
  }
}

export interface SpeechToTextInput {
  stream?: Readable;
  buffer?: Buffer;
  mime: string;
  filename: string;
  durationHintSeconds?: number | null;
  signal?: AbortSignal;
}

export interface SpeechToTextResult {
  text: string;
  language?: string;
}

export interface SpeechToTextOptions {
  settings: SpeechToTextSettings;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

export const SPEECH_TO_TEXT_REQUEST_TIMEOUT_MS = 120_000;
const RESPONSE_BYTE_LIMIT = 1024 * 1024;
const OPUS_GRANULE_RATE = 48_000;

export function speechToTextTranscriptionUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "") + "/audio/transcriptions";
}

/** Reads the playback length of an Ogg Opus stream from its last page granule position. */
export function oggOpusDurationSeconds(body: Buffer): number | null {
  if (body.length < 27 || body.toString("latin1", 0, 4) !== "OggS") return null;
  if (body.indexOf("OpusHead", 0, "latin1") < 0) return null;
  for (let index = body.lastIndexOf("OggS", body.length - 27, "latin1"); index >= 0; index = body.lastIndexOf("OggS", index - 1, "latin1")) {
    if (index + 14 > body.length) continue;
    const granule = body.readBigUInt64LE(index + 6);
    if (granule === 0xffffffffffffffffn) continue;
    return Number(granule) / OPUS_GRANULE_RATE;
  }
  return null;
}

async function collect(stream: Readable, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.length;
    if (total > limit) {
      stream.destroy();
      throw new SpeechToTextError("stt_too_large", "Audio exceeds the " + limit + " byte speech-to-text limit");
    }
    chunks.push(buffer);
  }
  return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, total);
}

async function readBoundedText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > RESPONSE_BYTE_LIMIT) {
      await reader.cancel().catch(() => undefined);
      throw new SpeechToTextError("stt_invalid_response", "Speech-to-text response exceeds " + RESPONSE_BYTE_LIMIT + " bytes");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

/** Posts audio to the configured OpenAI-compatible /audio/transcriptions endpoint. */
export async function transcribeAudio(input: SpeechToTextInput, options: SpeechToTextOptions): Promise<SpeechToTextResult> {
  const settings = options.settings;
  if (!settings.enabled || !settings.baseUrl || !settings.model || !settings.apiKeyEnvVar)
    throw new SpeechToTextError("stt_disabled", "Speech-to-text is not enabled for this instance");
  const apiKey = (options.env ?? process.env)[settings.apiKeyEnvVar];
  if (!apiKey) throw new SpeechToTextError("stt_missing_key", "The speech-to-text API key environment variable is not set");
  const limit = Math.min(options.maxBytes ?? getMaxAttachmentBytes(), getMaxAttachmentBytes());
  if (input.durationHintSeconds != null && input.durationHintSeconds > settings.maxAudioSeconds)
    throw new SpeechToTextError("stt_too_long", "Audio is longer than " + settings.maxAudioSeconds + " seconds");
  let body: Buffer;
  if (input.buffer) body = input.buffer;
  else if (input.stream) body = await collect(input.stream, limit);
  else throw new SpeechToTextError("stt_empty", "No audio was supplied");
  if (body.length === 0) throw new SpeechToTextError("stt_empty", "No audio was supplied");
  if (body.length > limit) throw new SpeechToTextError("stt_too_large", "Audio exceeds the " + limit + " byte speech-to-text limit");
  if (input.durationHintSeconds == null) {
    const measured = oggOpusDurationSeconds(body);
    if (measured !== null && measured > settings.maxAudioSeconds)
      throw new SpeechToTextError("stt_too_long", "Audio is longer than " + settings.maxAudioSeconds + " seconds");
  }
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(body.buffer as ArrayBuffer, body.byteOffset, body.byteLength)], { type: input.mime }), input.filename);
  form.append("model", settings.model);
  form.append("response_format", "json");
  const timeout = AbortSignal.timeout(options.timeoutMs ?? SPEECH_TO_TEXT_REQUEST_TIMEOUT_MS);
  const signal = input.signal ? AbortSignal.any([timeout, input.signal]) : timeout;
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(speechToTextTranscriptionUrl(settings.baseUrl), {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, Accept: "application/json" },
      body: form,
      signal,
    });
  } catch (error) {
    if (isAbort(error)) throw new SpeechToTextError("stt_timeout", "Speech-to-text request timed out");
    throw new SpeechToTextError("stt_network", "Speech-to-text endpoint could not be reached");
  }
  let raw: string;
  try {
    raw = await readBoundedText(response);
  } catch (error) {
    if (error instanceof SpeechToTextError) throw error;
    if (isAbort(error)) throw new SpeechToTextError("stt_timeout", "Speech-to-text request timed out", response.status);
    throw new SpeechToTextError("stt_network", "Speech-to-text response was interrupted", response.status);
  }
  if (!response.ok) {
    const code = response.status >= 500 || response.status === 429 ? "stt_unavailable" : "stt_rejected";
    throw new SpeechToTextError(code, "Speech-to-text endpoint answered HTTP " + response.status, response.status);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SpeechToTextError("stt_invalid_response", "Speech-to-text endpoint returned malformed JSON", response.status);
  }
  const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  if (!record || typeof record.text !== "string")
    throw new SpeechToTextError("stt_invalid_response", "Speech-to-text response has no text", response.status);
  const language = typeof record.language === "string" && record.language ? record.language : undefined;
  return language ? { text: record.text.trim(), language } : { text: record.text.trim() };
}
