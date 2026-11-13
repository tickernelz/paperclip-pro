import type { Readable } from "node:stream";
import {
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
import {
  googleAccessToken,
  GoogleCredentialsError,
  GoogleTokenError,
  loadGoogleServiceAccount,
} from "./speech-to-text-google-auth.js";

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
  mime: string;
  filename: string;
  durationHintSeconds?: number | null;
  signal?: AbortSignal;
}

export type SpeechToTextResult = SpeechToTextTranscript;

export interface SpeechToTextOptions {
  settings: SpeechToTextSettings;
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

function audioBlob(body: Buffer, mime: string): Blob {
  return new Blob([new Uint8Array(body.buffer as ArrayBuffer, body.byteOffset, body.byteLength)], { type: mime });
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
  request(settings: SpeechToTextSettings, apiKey: string, body: Buffer, input: SpeechToTextInput, context: RequestContext): ProviderRequest | Promise<ProviderRequest>;
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
  request(settings, apiKey, body, input) {
    const form = new FormData();
    form.append("file", audioBlob(body, input.mime), input.filename);
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
  request(settings, apiKey, body, input) {
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
      body: new Uint8Array(body.buffer as ArrayBuffer, body.byteOffset, body.byteLength),
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
  request(settings, apiKey, body, input) {
    const form = new FormData();
    form.append("model_id", settings.model);
    form.append("file", audioBlob(body, input.mime), input.filename);
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
  async request(settings, credentials, body, _input, context) {
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
      body: JSON.stringify({ config, content: body.toString("base64") }),
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

export async function transcribeAudio(input: SpeechToTextInput, options: SpeechToTextOptions): Promise<SpeechToTextResult> {
  const settings = options.settings;
  const provider = settings.provider ?? "openai_compatible";
  if (!settings.enabled || !settings.model || !settings.apiKeyEnvVar || (provider === "openai_compatible" && !settings.baseUrl))
    throw new SpeechToTextError("stt_disabled", "Speech-to-text is not enabled for this instance");
  const apiKey = readApiKey(settings.apiKeyEnvVar, options.env);
  const maxSeconds = provider === "google" ? Math.min(settings.maxAudioSeconds, SPEECH_TO_TEXT_GOOGLE_SYNC_MAX_SECONDS) : settings.maxAudioSeconds;
  const limit = Math.min(
    options.maxBytes ?? getMaxAttachmentBytes(),
    getMaxAttachmentBytes(),
    provider === "google" ? GOOGLE_SYNC_MAX_AUDIO_BYTES : Number.POSITIVE_INFINITY,
  );
  if (input.durationHintSeconds != null && input.durationHintSeconds > maxSeconds)
    throw new SpeechToTextError("stt_too_long", "Audio is longer than " + maxSeconds + " seconds");
  let body: Buffer;
  if (input.buffer) body = input.buffer;
  else if (input.stream) body = await collect(input.stream, limit);
  else throw new SpeechToTextError("stt_empty", "No audio was supplied");
  if (body.length === 0) throw new SpeechToTextError("stt_empty", "No audio was supplied");
  if (body.length > limit) throw new SpeechToTextError("stt_too_large", "Audio exceeds the " + limit + " byte speech-to-text limit");
  if (input.durationHintSeconds == null) {
    const measured = oggOpusDurationSeconds(body);
    if (measured !== null && measured > maxSeconds)
      throw new SpeechToTextError("stt_too_long", "Audio is longer than " + maxSeconds + " seconds");
  }
  const adapter = ADAPTERS[provider];
  const timeout = AbortSignal.timeout(options.timeoutMs ?? SPEECH_TO_TEXT_REQUEST_TIMEOUT_MS);
  const signal = input.signal ? AbortSignal.any([timeout, input.signal]) : timeout;
  const fetchImpl = options.fetchImpl ?? fetch;
  const request = await adapter.request(settings, apiKey, body, input, { fetchImpl, signal });
  const { record, status } = await requestJson(
    fetchImpl,
    request.url,
    { method: "POST", headers: request.headers, body: request.body },
    signal,
  );
  return adapter.parse(record, settings, status);
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
