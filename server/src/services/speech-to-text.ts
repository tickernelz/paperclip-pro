import { randomUUID } from "node:crypto";
import { createWriteStream, openAsBlob } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  SPEECH_TO_TEXT_DEFAULT_KEY_ENV_VARS,
  SPEECH_TO_TEXT_PROVIDERS,
  type SpeechToTextCredentialStatus,
  SPEECH_TO_TEXT_CURATED_MODELS,
  SPEECH_TO_TEXT_DEFAULT_BASE_URLS,
  SPEECH_TO_TEXT_GOOGLE_SYNC_MAX_SECONDS,
  type SpeechToTextModelList,
  type SpeechToTextProvider,
  type SpeechToTextSegment,
  type SpeechToTextSettings,
  type SpeechToTextTranscript,
} from "@tickernelz/wardmote-shared";
import { getMaxAttachmentBytes } from "../attachment-types.js";
import { resolveAttachmentUploadTempDir } from "../attachment-upload.js";
import {
  googleAccessToken,
  GoogleCredentialsError,
  GoogleTokenError,
  loadGoogleServiceAccount,
} from "./speech-to-text-google-auth.js";
import { splitOggOpus } from "./ogg-opus-chunks.js";

export type SpeechToTextErrorCode =
  | "stt_disabled"
  | "stt_missing_key"
  | "stt_invalid_credentials"
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
  blob?: Blob;
  mime: string;
  filename: string;
  durationHintSeconds?: number | null;
  signal?: AbortSignal;
}

export type SpeechToTextResult = SpeechToTextTranscript;

export interface SpeechToTextOptions {
  settings: SpeechToTextSettings;
  spoolDir?: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface SpeechToTextModelListRequest {
  provider: SpeechToTextProvider;
  baseUrl: string;
  apiKeyEnvVar: string;
  google?: { location: string; projectId: string };
}

export interface SpeechToTextModelListOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export const SPEECH_TO_TEXT_REQUEST_TIMEOUT_MS = 120_000;
export const SPEECH_TO_TEXT_MODEL_LIST_TIMEOUT_MS = 15_000;
const RESPONSE_BYTE_LIMIT = 4 * 1024 * 1024;
const OPUS_GRANULE_RATE = 48_000;
export const GOOGLE_SYNC_MAX_AUDIO_BYTES = 7_500_000;

const ERROR_HTTP_STATUS: Record<SpeechToTextErrorCode, number> = {
  stt_disabled: 409,
  stt_missing_key: 503,
  stt_invalid_credentials: 503,
  stt_too_long: 413,
  stt_too_large: 413,
  stt_empty: 422,
  stt_timeout: 504,
  stt_rejected: 502,
  stt_unavailable: 503,
  stt_network: 502,
  stt_invalid_response: 502,
};

export function speechToTextErrorHttpStatus(code: SpeechToTextErrorCode): number {
  return ERROR_HTTP_STATUS[code];
}

export function speechToTextTranscriptionUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "") + "/audio/transcriptions";
}

function providerOrigin(provider: SpeechToTextProvider, baseUrl: string): string {
  return (baseUrl || SPEECH_TO_TEXT_DEFAULT_BASE_URLS[provider]).replace(/\/+$/, "").replace(/\/v1$/, "");
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

const OGG_HEAD_BYTES = 4096;
const OGG_TAIL_BYTES = 65_536;

async function oggOpusBlobDurationSeconds(audio: Blob): Promise<number | null> {
  if (audio.size <= OGG_HEAD_BYTES + OGG_TAIL_BYTES) return oggOpusDurationSeconds(Buffer.from(await audio.arrayBuffer()));
  const head = Buffer.from(await audio.slice(0, OGG_HEAD_BYTES).arrayBuffer());
  if (head.toString("latin1", 0, 4) !== "OggS" || head.indexOf("OpusHead", 0, "latin1") < 0) return null;
  const tail = Buffer.from(await audio.slice(audio.size - OGG_TAIL_BYTES).arrayBuffer());
  return oggOpusDurationSeconds(Buffer.concat([head, tail]));
}

async function spool(stream: Readable, limit: number, tempDir: string): Promise<{ audio: Blob; file: string }> {
  await mkdir(tempDir, { recursive: true });
  const file = path.join(tempDir, randomUUID() + ".stt");
  let total = 0;
  try {
    await pipeline(
      stream,
      async function* (source: AsyncIterable<Buffer | Uint8Array>) {
        for await (const chunk of source) {
          total += chunk.length;
          if (total > limit) throw new SpeechToTextError("stt_too_large", "Audio exceeds the " + limit + " byte speech-to-text limit");
          yield chunk;
        }
      },
      createWriteStream(file, { flags: "wx" }),
    );
    return { audio: await openAsBlob(file), file };
  } catch (error) {
    await rm(file, { force: true });
    throw error;
  }
}

export const GOOGLE_PARALLEL_PIECES = 3;

async function inOrder<T, R>(items: readonly T[], concurrency: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await run(items[index]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

async function requestJson(
  fetchImpl: typeof fetch,
  url: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: BodyInit },
  signal: AbortSignal,
): Promise<{ record: Record<string, unknown>; status: number }> {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal });
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
  const record = asRecord(parsed);
  if (!record) throw new SpeechToTextError("stt_invalid_response", "Speech-to-text response is not a JSON object", response.status);
  return { record, status: response.status };
}

function readApiKey(apiKeyEnvVar: string, env: Record<string, string | undefined> | undefined): string {
  const apiKey = apiKeyEnvVar ? (env ?? process.env)[apiKeyEnvVar] : undefined;
  if (!apiKey) throw new SpeechToTextError("stt_missing_key", "The speech-to-text API key environment variable is not set");
  return apiKey;
}

function primaryLanguage(language: string): string {
  return language === "multi" ? "" : language.split("-")[0].toLowerCase();
}

function typedAudio(audio: Blob, mime: string): Blob {
  return audio.type === mime ? audio : audio.slice(0, audio.size, mime);
}

function speakerLabel(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) return "Speaker " + (raw + 1);
  if (typeof raw !== "string" || !raw) return null;
  const numbered = /^speaker_(\d+)$/.exec(raw);
  return numbered ? "Speaker " + (Number(numbered[1]) + 1) : raw;
}

function groupSegments(pieces: Array<{ speaker: string | null; text: string }>): SpeechToTextSegment[] | undefined {
  const segments: SpeechToTextSegment[] = [];
  for (const piece of pieces) {
    const last = segments[segments.length - 1];
    if (last && (piece.speaker === null || piece.speaker === last.speaker)) last.text += piece.text;
    else if (piece.speaker !== null) segments.push({ speaker: piece.speaker, text: piece.text });
  }
  const trimmed = segments.map((segment) => ({ speaker: segment.speaker, text: segment.text.trim() })).filter((segment) => segment.text);
  return trimmed.length > 0 ? trimmed : undefined;
}

function transcript(text: string, language: unknown, segments: SpeechToTextSegment[] | undefined): SpeechToTextResult {
  const result: SpeechToTextResult = { text: text.trim() };
  if (typeof language === "string" && language) result.language = language;
  if (segments) result.segments = segments;
  return result;
}

type ProviderRequest = { url: string; headers: Record<string, string>; body: BodyInit };

interface ProviderAdapter {
  request(settings: SpeechToTextSettings, apiKey: string, audio: Blob, input: SpeechToTextInput, context: RequestContext): ProviderRequest | Promise<ProviderRequest>;
  parse(record: Record<string, unknown>, settings: SpeechToTextSettings, status: number): SpeechToTextResult;
}

interface RequestContext {
  fetchImpl: typeof fetch;
  signal: AbortSignal;
}

function googleSpeakerLabel(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  return /^\d+$/.test(raw) ? "Speaker " + raw : raw;
}

function googleOrigin(baseUrl: string, location: string): string {
  if (baseUrl) return baseUrl.replace(/\/+$/, "").replace(/\/v[12]$/, "");
  return location === "global" ? "https://speech.googleapis.com" : "https://" + location + "-speech.googleapis.com";
}

async function googleAuthorization(
  credentials: string,
  projectIdSetting: string,
  context: RequestContext,
): Promise<{ token: string; projectId: string }> {
  let account;
  try {
    account = await loadGoogleServiceAccount(credentials);
  } catch (error) {
    if (error instanceof GoogleCredentialsError) throw new SpeechToTextError("stt_invalid_credentials", error.message);
    throw error;
  }
  const projectId = projectIdSetting || account.projectId;
  if (!projectId) throw new SpeechToTextError("stt_invalid_credentials", "No Google Cloud project id is set and the service account key has none");
  try {
    return { token: await googleAccessToken(account, context.fetchImpl, context.signal), projectId };
  } catch (error) {
    if (error instanceof GoogleTokenError) {
      const code = error.status === null ? "stt_invalid_response" : error.status >= 500 || error.status === 429 ? "stt_unavailable" : "stt_rejected";
      throw new SpeechToTextError(code, error.message, error.status);
    }
    if (error instanceof GoogleCredentialsError) throw new SpeechToTextError("stt_invalid_credentials", error.message);
    if (isAbort(error)) throw new SpeechToTextError("stt_timeout", "Google token request timed out");
    throw new SpeechToTextError("stt_network", "Google token endpoint could not be reached");
  }
}

const openAiCompatible: ProviderAdapter = {
  request(settings, apiKey, audio, input) {
    const form = new FormData();
    form.append("file", typedAudio(audio, input.mime), input.filename);
    form.append("model", settings.model);
    form.append("response_format", "json");
    const language = primaryLanguage(settings.language);
    if (language) form.append("language", language);
    return {
      url: speechToTextTranscriptionUrl(settings.baseUrl),
      headers: { Authorization: "Bearer " + apiKey, Accept: "application/json" },
      body: form,
    };
  },
  parse(record, _settings, status) {
    if (typeof record.text !== "string")
      throw new SpeechToTextError("stt_invalid_response", "Speech-to-text response has no text", status);
    return transcript(record.text, record.language, undefined);
  },
};

const deepgram: ProviderAdapter = {
  request(settings, apiKey, audio, input) {
    const query = new URLSearchParams({ model: settings.model, punctuate: "true" });
    if (settings.deepgram.smartFormat) query.set("smart_format", "true");
    if (settings.language) query.set("language", settings.language);
    else query.set("detect_language", "true");
    if (settings.diarize) query.set("diarize_model", "latest");
    const keytermParam = settings.model.startsWith("nova-3") ? "keyterm" : "keywords";
    for (const term of settings.keyterms) query.append(keytermParam, term);
    return {
      url: providerOrigin("deepgram", settings.baseUrl) + "/v1/listen?" + query.toString(),
      headers: { Authorization: "Token " + apiKey, Accept: "application/json", "Content-Type": input.mime || "application/octet-stream" },
      body: audio,
    };
  },
  parse(record, settings, status) {
    const results = asRecord(record.results);
    const channel = Array.isArray(results?.channels) ? asRecord(results.channels[0]) : null;
    const alternative = channel && Array.isArray(channel.alternatives) ? asRecord(channel.alternatives[0]) : null;
    if (!alternative || typeof alternative.transcript !== "string")
      throw new SpeechToTextError("stt_invalid_response", "Speech-to-text response has no transcript", status);
    let segments: SpeechToTextSegment[] | undefined;
    if (settings.diarize && Array.isArray(alternative.words)) {
      segments = groupSegments(
        alternative.words.flatMap((entry, index) => {
          const word = asRecord(entry);
          const token = typeof word?.punctuated_word === "string" ? word.punctuated_word : typeof word?.word === "string" ? word.word : null;
          return token === null ? [] : [{ speaker: speakerLabel(word?.speaker), text: (index > 0 ? " " : "") + token }];
        }),
      );
    }
    return transcript(alternative.transcript, channel?.detected_language, segments);
  },
};

const elevenlabs: ProviderAdapter = {
  request(settings, apiKey, audio, input) {
    const form = new FormData();
    form.append("model_id", settings.model);
    form.append("file", typedAudio(audio, input.mime), input.filename);
    const language = primaryLanguage(settings.language);
    if (language) form.append("language_code", language);
    form.append("tag_audio_events", settings.elevenlabs.tagAudioEvents ? "true" : "false");
    form.append("diarize", settings.diarize ? "true" : "false");
    if (settings.diarize && settings.elevenlabs.numSpeakers !== null) form.append("num_speakers", String(settings.elevenlabs.numSpeakers));
    form.append("timestamps_granularity", settings.diarize ? "word" : "none");
    for (const term of settings.keyterms) form.append("keyterms", term);
    return {
      url: providerOrigin("elevenlabs", settings.baseUrl) + "/v1/speech-to-text",
      headers: { "xi-api-key": apiKey, Accept: "application/json" },
      body: form,
    };
  },
  parse(record, settings, status) {
    if (typeof record.text !== "string")
      throw new SpeechToTextError("stt_invalid_response", "Speech-to-text response has no text", status);
    let segments: SpeechToTextSegment[] | undefined;
    if (settings.diarize && Array.isArray(record.words)) {
      segments = groupSegments(
        record.words.flatMap((entry) => {
          const word = asRecord(entry);
          return typeof word?.text === "string" ? [{ speaker: speakerLabel(word.speaker_id), text: word.text }] : [];
        }),
      );
    }
    return transcript(record.text, record.language_code, segments);
  },
};

const google: ProviderAdapter = {
  async request(settings, credentials, audio, _input, context) {
    const { token, projectId } = await googleAuthorization(credentials, settings.google.projectId, context);
    const location = settings.google.location;
    const languageCodes = settings.language ? [settings.language, ...settings.google.alternativeLanguages] : ["auto"];
    const config: Record<string, unknown> = {
      autoDecodingConfig: {},
      model: settings.model,
      languageCodes,
      features: {
        enableAutomaticPunctuation: settings.google.autoPunctuation,
        ...(settings.diarize ? { diarizationConfig: {} } : {}),
      },
    };
    if (settings.keyterms.length > 0)
      config.adaptation = { phraseSets: [{ inlinePhraseSet: { phrases: settings.keyterms.map((value) => ({ value })) } }] };
    return {
      url:
        googleOrigin(settings.baseUrl, location) +
        "/v2/projects/" + encodeURIComponent(projectId) +
        "/locations/" + encodeURIComponent(location) +
        "/recognizers/_:recognize",
      headers: { Authorization: "Bearer " + token, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ config, content: Buffer.from(await audio.arrayBuffer()).toString("base64") }),
    };
  },
  parse(record, settings, status) {
    if (record.results !== undefined && !Array.isArray(record.results))
      throw new SpeechToTextError("stt_invalid_response", "Speech-to-text response results are not a list", status);
    const results = ((record.results as unknown[] | undefined) ?? []).map(asRecord);
    const texts: string[] = [];
    const pieces: Array<{ speaker: string | null; text: string }> = [];
    let language: unknown;
    for (const result of results) {
      const alternative = result && Array.isArray(result.alternatives) ? asRecord(result.alternatives[0]) : null;
      if (!alternative) continue;
      if (typeof alternative.transcript === "string" && alternative.transcript.trim()) texts.push(alternative.transcript.trim());
      language ??= result?.languageCode;
      if (settings.diarize && Array.isArray(alternative.words)) {
        for (const entry of alternative.words) {
          const word = asRecord(entry);
          if (typeof word?.word === "string")
            pieces.push({ speaker: googleSpeakerLabel(word.speakerLabel), text: " " + word.word });
        }
      }
    }
    return transcript(texts.join(" "), language, settings.diarize ? groupSegments(pieces) : undefined);
  },
};

const ADAPTERS: Record<SpeechToTextProvider, ProviderAdapter> = {
  openai_compatible: openAiCompatible,
  deepgram,
  elevenlabs,
  google,
};

export function formatSpeechToTextTranscript(result: SpeechToTextTranscript): string {
  const segments = result.segments ?? [];
  if (new Set(segments.map((segment) => segment.speaker)).size < 2) return result.text;
  return segments.map((segment) => segment.speaker + ": " + segment.text).join("\n");
}

export const GOOGLE_CHUNK_SECONDS = 55;

function isOggMime(mime: string): boolean {
  return /ogg|opus/i.test(mime);
}

export function speechToTextByteLimit(settings: SpeechToTextSettings, maxBytes?: number, mime = ""): number {
  return Math.min(
    maxBytes ?? getMaxAttachmentBytes(),
    getMaxAttachmentBytes(),
    settings.provider === "google" && !isOggMime(mime) ? GOOGLE_SYNC_MAX_AUDIO_BYTES : Number.POSITIVE_INFINITY,
  );
}

function blobOf(buffer: Buffer): Blob {
  return new Blob([new Uint8Array(buffer.buffer as ArrayBuffer, buffer.byteOffset, buffer.byteLength)]);
}

function mergeTranscripts(parts: SpeechToTextResult[]): SpeechToTextResult {
  if (parts.length === 1) return parts[0];
  const merged: SpeechToTextResult = { text: parts.map((part) => part.text).filter(Boolean).join(" ") };
  const language = parts.find((part) => part.language)?.language;
  if (language) merged.language = language;
  const segments = parts.flatMap((part) => part.segments ?? []);
  if (segments.length > 0) merged.segments = segments;
  return merged;
}

async function googlePieces(audio: Blob, measured: number | null): Promise<Blob[]> {
  if (measured === null || measured <= GOOGLE_CHUNK_SECONDS) {
    if (audio.size > GOOGLE_SYNC_MAX_AUDIO_BYTES)
      throw new SpeechToTextError("stt_too_large", "Audio exceeds the " + GOOGLE_SYNC_MAX_AUDIO_BYTES + " byte Google synchronous limit");
    return [audio];
  }
  const chunks = splitOggOpus(Buffer.from(await audio.arrayBuffer()), GOOGLE_CHUNK_SECONDS);
  if (!chunks) throw new SpeechToTextError("stt_too_long", "Google transcribes at most " + SPEECH_TO_TEXT_GOOGLE_SYNC_MAX_SECONDS + " seconds per request and this Ogg stream could not be split");
  if (chunks.some((chunk) => chunk.length > GOOGLE_SYNC_MAX_AUDIO_BYTES))
    throw new SpeechToTextError("stt_too_large", "An audio part exceeds the " + GOOGLE_SYNC_MAX_AUDIO_BYTES + " byte Google synchronous limit");
  return chunks.map(blobOf);
}

export async function transcribeAudio(input: SpeechToTextInput, options: SpeechToTextOptions): Promise<SpeechToTextResult> {
  const settings = options.settings;
  const provider = settings.provider ?? "openai_compatible";
  if (!settings.enabled || !settings.model || !settings.apiKeyEnvVar || (provider === "openai_compatible" && !settings.baseUrl))
    throw new SpeechToTextError("stt_disabled", "Speech-to-text is not enabled for this instance");
  const apiKey = readApiKey(settings.apiKeyEnvVar, options.env);
  const maxSeconds =
    provider === "google" && !isOggMime(input.mime) ? Math.min(settings.maxAudioSeconds, SPEECH_TO_TEXT_GOOGLE_SYNC_MAX_SECONDS) : settings.maxAudioSeconds;
  const limit = speechToTextByteLimit(settings, options.maxBytes, input.mime);
  if (input.durationHintSeconds != null && input.durationHintSeconds > maxSeconds)
    throw new SpeechToTextError("stt_too_long", "Audio is longer than " + maxSeconds + " seconds");
  let audio: Blob;
  let spooled: string | null = null;
  if (input.blob) audio = input.blob;
  else if (input.buffer) audio = blobOf(input.buffer);
  else if (input.stream) ({ audio, file: spooled } = await spool(input.stream, limit, options.spoolDir ?? resolveAttachmentUploadTempDir()));
  else throw new SpeechToTextError("stt_empty", "No audio was supplied");
  try {
    return await transcribeLoadedAudio(audio, input, options, apiKey, maxSeconds, limit);
  } finally {
    if (spooled) await rm(spooled, { force: true });
  }
}

async function transcribeLoadedAudio(
  audio: Blob,
  input: SpeechToTextInput,
  options: SpeechToTextOptions,
  apiKey: string,
  maxSeconds: number,
  limit: number,
): Promise<SpeechToTextResult> {
  const settings = options.settings;
  const provider = settings.provider ?? "openai_compatible";
  if (audio.size === 0) throw new SpeechToTextError("stt_empty", "No audio was supplied");
  if (audio.size > limit) throw new SpeechToTextError("stt_too_large", "Audio exceeds the " + limit + " byte speech-to-text limit");
  const measured = input.durationHintSeconds == null || provider === "google" ? await oggOpusBlobDurationSeconds(audio) : null;
  if (input.durationHintSeconds == null && measured !== null && measured > maxSeconds)
    throw new SpeechToTextError("stt_too_long", "Audio is longer than " + maxSeconds + " seconds");
  const pieces = provider === "google" ? await googlePieces(audio, measured) : [audio];
  const adapter = ADAPTERS[provider];
  const timeoutMs = options.timeoutMs ?? SPEECH_TO_TEXT_REQUEST_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const parts = await inOrder(pieces, GOOGLE_PARALLEL_PIECES, async (piece) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = input.signal ? AbortSignal.any([timeout, input.signal]) : timeout;
    const request = await adapter.request(settings, apiKey, piece, input, { fetchImpl, signal });
    const { record, status } = await requestJson(
      fetchImpl,
      request.url,
      { method: "POST", headers: request.headers, body: request.body },
      signal,
    );
    return adapter.parse(record, settings, status);
  });
  return mergeTranscripts(parts);
}

export async function speechToTextCredentialStatus(
  env: Record<string, string | undefined> = process.env,
): Promise<SpeechToTextCredentialStatus> {
  const entries = await Promise.all(
    SPEECH_TO_TEXT_PROVIDERS.map(async (provider) => {
      const envVar = SPEECH_TO_TEXT_DEFAULT_KEY_ENV_VARS[provider];
      const value = env[envVar];
      if (provider !== "google" || !value) return [provider, { envVar, set: Boolean(value) }] as const;
      try {
        const account = await loadGoogleServiceAccount(value);
        return [provider, { envVar, set: true, usable: true, projectId: account.projectId || null }] as const;
      } catch {
        return [provider, { envVar, set: true, usable: false, projectId: null }] as const;
      }
    }),
  );
  return Object.fromEntries(entries) as SpeechToTextCredentialStatus;
}

function curatedModels(provider: SpeechToTextProvider): SpeechToTextModelList {
  return { models: SPEECH_TO_TEXT_CURATED_MODELS[provider].map((id) => ({ id })), source: "curated" };
}

function uniqueSorted(ids: string[]): SpeechToTextModelList["models"] {
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right)).map((id) => ({ id }));
}

export async function listSpeechToTextModels(
  request: SpeechToTextModelListRequest,
  options: SpeechToTextModelListOptions = {},
): Promise<SpeechToTextModelList> {
  if (request.provider === "elevenlabs") return curatedModels("elevenlabs");
  if (request.provider === "openai_compatible" && !request.baseUrl)
    throw new SpeechToTextError("stt_disabled", "An OpenAI-compatible endpoint needs a base URL before its models can be listed");
  const apiKey = readApiKey(request.apiKeyEnvVar, options.env);
  const signal = AbortSignal.timeout(options.timeoutMs ?? SPEECH_TO_TEXT_MODEL_LIST_TIMEOUT_MS);
  const fetchImpl = options.fetchImpl ?? fetch;
  let ids: string[];
  if (request.provider === "google") {
    const location = request.google?.location || "us";
    const { token, projectId } = await googleAuthorization(apiKey, request.google?.projectId ?? "", { fetchImpl, signal });
    const { record, status } = await requestJson(
      fetchImpl,
      googleOrigin(request.baseUrl, location) + "/v2/projects/" + encodeURIComponent(projectId) + "/locations/" + encodeURIComponent(location),
      { method: "GET", headers: { Authorization: "Bearer " + token, Accept: "application/json" } },
      signal,
    );
    const models = asRecord(asRecord(asRecord(record.metadata)?.languages)?.models);
    if (!models) throw new SpeechToTextError("stt_invalid_response", "Google location metadata lists no models", status);
    ids = Object.values(models).flatMap((language) => Object.keys(asRecord(asRecord(language)?.modelFeatures) ?? {}));
    const locations = await requestJson(
      fetchImpl,
      googleOrigin(request.baseUrl, location) + "/v2/projects/" + encodeURIComponent(projectId) + "/locations",
      { method: "GET", headers: { Authorization: "Bearer " + token, Accept: "application/json" } },
      AbortSignal.timeout(options.timeoutMs ?? SPEECH_TO_TEXT_MODEL_LIST_TIMEOUT_MS),
    )
      .then(({ record: list }) =>
        Array.isArray(list.locations)
          ? list.locations.flatMap((entry) => {
              const id = asRecord(entry)?.locationId;
              return typeof id === "string" && /^[a-z][a-z0-9-]{1,39}$/.test(id) ? [id] : [];
            })
          : [],
      )
      .catch(() => []);
    if (ids.length > 0) return { models: uniqueSorted(ids), source: "provider", ...(locations.length > 0 ? { locations: [...new Set(locations)].sort() } : {}) };
  } else if (request.provider === "deepgram") {
    const { record, status } = await requestJson(
      fetchImpl,
      providerOrigin("deepgram", request.baseUrl) + "/v1/models",
      { method: "GET", headers: { Authorization: "Token " + apiKey, Accept: "application/json" } },
      signal,
    );
    if (!Array.isArray(record.stt)) throw new SpeechToTextError("stt_invalid_response", "Deepgram model list has no stt entries", status);
    ids = record.stt.flatMap((entry) => {
      const model = asRecord(entry);
      if (!model || model.batch === false) return [];
      const id = typeof model.canonical_name === "string" && model.canonical_name ? model.canonical_name : model.name;
      return typeof id === "string" && id ? [id] : [];
    });
  } else {
    const { record, status } = await requestJson(
      fetchImpl,
      request.baseUrl.replace(/\/+$/, "") + "/models",
      { method: "GET", headers: { Authorization: "Bearer " + apiKey, Accept: "application/json" } },
      signal,
    );
    if (!Array.isArray(record.data)) throw new SpeechToTextError("stt_invalid_response", "Model list has no data array", status);
    ids = record.data.flatMap((entry) => {
      const id = asRecord(entry)?.id;
      return typeof id === "string" && id ? [id] : [];
    });
  }
  return ids.length > 0 ? { models: uniqueSorted(ids), source: "provider" } : curatedModels(request.provider);
}
