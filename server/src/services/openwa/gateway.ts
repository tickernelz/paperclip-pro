import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { Ajv, type ValidateFunction } from "ajv";
import { getMaxAttachmentBytes } from "../../attachment-types.js";
import {
  OPENWA_OPERATIONS,
  type OpenwaOperation,
} from "@tickernelz/paperclip-pro-shared/openwa-operations";

export type OpenwaGatewayErrorCode =
  | "unavailable_on_engine"
  | "unavailable_without_admin_key"
  | "retry_after"
  | "rate_limited"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "bad_request"
  | "payload_too_large"
  | "gateway_unavailable"
  | "gateway_error"
  | "uncertain"
  | "invalid_response";

export class OpenwaGatewayError extends Error {
  readonly code: OpenwaGatewayErrorCode;
  readonly operationId: string | null;
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;
  readonly pacing: boolean;

  constructor(
    code: OpenwaGatewayErrorCode,
    message: string,
    options: {
      operationId?: string | null;
      status?: number | null;
      retryAfterSeconds?: number | null;
      pacing?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "OpenwaGatewayError";
    this.code = code;
    this.operationId = options.operationId ?? null;
    this.status = options.status ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    this.pacing = options.pacing ?? false;
  }
}

export interface OpenwaGatewayClientOptions {
  baseUrl: string;
  apiKey: string;
  sessionId: string;
  adminApiKey?: string | null;
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetchImpl?: typeof fetch;
}

export interface OpenwaCallOptions {
  timeoutMs?: number;
  maxBytes?: number;
  useAdminKey?: boolean;
}

export interface OpenwaMediaDownload {
  contentType: string;
  contentLength: number | null;
  filename: string | null;
  stream: Readable;
}

export type OpenwaCallResult =
  | { kind: "json"; status: number; data: unknown }
  | { kind: "text"; status: number; data: string }
  | { kind: "empty"; status: number }
  | { kind: "binary"; status: number; media: OpenwaMediaDownload };

export type OpenwaKeyRequirement = "none" | "operator" | "admin" | "admin_preferred";

export interface OpenwaHealth {
  status: string;
  timestamp: string;
  version?: string;
}

export interface OpenwaKeyValidation {
  valid: boolean;
  role?: "admin" | "operator" | "viewer";
  engineType?: string;
}

export type OpenwaSessionStatus =
  | "created"
  | "initializing"
  | "qr_ready"
  | "authenticating"
  | "ready"
  | "disconnected"
  | "action_required"
  | "failed";

export interface OpenwaSession {
  id: string;
  name: string;
  status: OpenwaSessionStatus;
  phone?: string | null;
  pushName?: string | null;
  connectedAt?: string | null;
  lastActive?: string | null;
  createdAt: string;
  updatedAt: string;
  lastError?: string | null;
  restriction?: Record<string, unknown> | null;
  engineLoaded: boolean;
}

export interface OpenwaSendResult {
  messageId: string;
  timestamp: number;
}

export interface OpenwaActionResult {
  success?: boolean;
  [key: string]: unknown;
}

export interface OpenwaStoredMessage {
  id: string;
  sessionId: string;
  waMessageId?: string | null;
  chatId: string;
  chatName?: string | null;
  author?: string | null;
  from: string;
  to: string;
  body?: string | null;
  type: string;
  direction: "incoming" | "outgoing";
  timestamp?: number | null;
  metadata?: Record<string, unknown> | null;
  mediaPath?: string | null;
  mediaMimetype?: string | null;
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  createdAt: string;
}

export interface OpenwaStoredMessagePage {
  messages: OpenwaStoredMessage[];
  total: number;
}

export interface OpenwaHistoryMessage {
  id: string;
  from: string;
  to: string;
  chatId: string;
  body: string;
  type: string;
  timestamp: number;
  fromMe: boolean;
  isGroup: boolean;
  kind: "individual" | "group" | "channel" | "status" | "broadcast" | "unknown";
  author?: string;
  mentionedIds?: string[];
  isLidSender?: boolean;
  senderPhone?: string | null;
  contact?: Record<string, unknown>;
  media?: Record<string, unknown>;
  quotedMessage?: Record<string, unknown>;
  location?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface OpenwaGroupParticipant {
  id: string;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
  [key: string]: unknown;
}

export interface OpenwaGroup {
  id: string;
  name: string;
  description?: string;
  owner?: string;
  createdAt?: number;
  participants: OpenwaGroupParticipant[];
  linkedParentJID?: string | null;
  isReadOnly?: boolean;
  announce?: boolean;
  locked?: boolean;
  ephemeralSeconds?: number;
  memberAddMode?: "all" | "admins";
}

export interface OpenwaGroupSummary {
  id: string;
  name: string;
  linkedParentJID?: string | null;
}

export interface OpenwaContactPhone {
  contactId: string;
  phone: string | null;
}

export interface OpenwaApiKeyCreated {
  id: string;
  name: string;
  role: "admin" | "operator" | "viewer";
  allowedSessions?: string[] | null;
  apiKey: string;
}

export interface OpenwaChatSummary {
  id: string;
  name?: string | null;
  isGroup?: boolean;
  timestamp?: number | null;
  [key: string]: unknown;
}

export interface OpenwaNumberCheck {
  number: string;
  exists: boolean;
  whatsappId: string | null;
}

export type OpenwaMediaKind = "image" | "video" | "audio" | "document" | "sticker";

export interface OpenwaSendMediaInput {
  kind: OpenwaMediaKind;
  chatId: string;
  url?: string;
  base64?: string;
  mimetype?: string;
  filename?: string;
  caption?: string;
  mentions?: string[];
  quotedMessageId?: string;
  ptt?: boolean;
}

export interface OpenwaGatewayClient {
  readonly sessionId: string;
  readonly hasAdminKey: boolean;
  call(operationId: string, args?: Record<string, unknown>, options?: OpenwaCallOptions): Promise<OpenwaCallResult>;
  health(): Promise<OpenwaHealth>;
  openApiVersion(): Promise<string>;
  validateKey(which?: "operator" | "admin"): Promise<OpenwaKeyValidation>;
  listSessions(): Promise<OpenwaSession[]>;
  listAllSessions(): Promise<OpenwaSession[]>;
  getSession(): Promise<OpenwaSession>;
  createApiKey(input: { name: string; role: "viewer" | "operator" | "admin"; allowedSessions: string[] }): Promise<OpenwaApiKeyCreated>;
  revokeApiKey(id: string): Promise<void>;
  listChats(input?: { limit?: number; offset?: number }): Promise<OpenwaChatSummary[]>;
  sendText(input: {
    chatId: string;
    text: string;
    mentions?: string[];
    quotedMessageId?: string;
    linkPreview?: boolean;
  }): Promise<OpenwaSendResult>;
  sendMedia(input: OpenwaSendMediaInput): Promise<OpenwaSendResult>;
  reply(input: { chatId: string; quotedMessageId: string; text: string; mentions?: string[] }): Promise<OpenwaSendResult>;
  react(input: { chatId: string; messageId: string; emoji: string }): Promise<OpenwaActionResult>;
  typing(input: { chatId: string; state: "typing" | "recording" | "paused" }): Promise<OpenwaActionResult>;
  listStoredMessages(input: {
    after?: string | null;
    limit: number;
    chatId?: string;
    inlineMedia: boolean;
  }): Promise<OpenwaStoredMessagePage>;
  chatHistory(input: {
    chatId: string;
    limit: number;
    deep: boolean;
    includeMedia: boolean;
    timeoutMs?: number;
  }): Promise<OpenwaHistoryMessage[]>;
  getGroup(groupId: string): Promise<OpenwaGroup>;
  listGroups(input?: { limit?: number; offset?: number }): Promise<OpenwaGroupSummary[]>;
  contactPhone(contactId: string): Promise<OpenwaContactPhone>;
  checkNumber(number: string): Promise<OpenwaNumberCheck>;
  downloadMedia(input: {
    chatId: string;
    messageId: string;
    maxBytes: number;
    timeoutMs?: number;
  }): Promise<OpenwaMediaDownload>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_JSON_RESPONSE_BYTES = 64 * 1024 * 1024;
const JSON_ENVELOPE_HEADROOM_BYTES = 1024 * 1024;

/** JSON responses can carry media inline as base64, so their cap is the attachment limit plus base64 and envelope overhead. */
export function openwaJsonResponseLimit(maxAttachmentBytes = getMaxAttachmentBytes()): number {
  return Math.max(MIN_JSON_RESPONSE_BYTES, 4 * Math.ceil(maxAttachmentBytes / 3) + JSON_ENVELOPE_HEADROOM_BYTES);
}
const ERROR_BODY_LIMIT = 64 * 1024;
const OPENAPI_DOCUMENT_LIMIT = 8 * 1024 * 1024;
const ERROR_MESSAGE_LIMIT = 500;
const PACING_CODE = "SEND_PACING_LIMITED";
const CONNECT_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EADDRNOTAVAIL",
  "UND_ERR_CONNECT_TIMEOUT",
]);
const MEDIA_OPERATION_BY_KIND: Record<OpenwaMediaKind, string> = {
  image: "MessageController_sendImage",
  video: "MessageController_sendVideo",
  audio: "MessageController_sendAudio",
  document: "MessageController_sendDocument",
  sticker: "MessageController_sendSticker",
};

const operationsById: ReadonlyMap<string, OpenwaOperation> = new Map(
  OPENWA_OPERATIONS.map((operation) => [operation.id, operation]),
);
const validators = new Map<string, ValidateFunction>();
let ajv: Ajv | null = null;

export function openwaOperation(operationId: string): OpenwaOperation | undefined {
  return operationsById.get(operationId);
}

/** Which credential an operation is sent with: "admin_preferred" uses the admin key when configured, else the operator key. */
export function openwaKeyRequirement(operation: OpenwaOperation): OpenwaKeyRequirement {
  if (operation.auth !== "api_key") return "none";
  if (operation.requiresUnscopedKey) return "admin";
  if (operation.requiredRole === "admin") return "admin_preferred";
  return "operator";
}

function validatorFor(operation: OpenwaOperation): ValidateFunction {
  const cached = validators.get(operation.id);
  if (cached) return cached;
  ajv ??= new Ajv({ allErrors: false, strict: true });
  const compiled = ajv.compile(operation.args);
  validators.set(operation.id, compiled);
  return compiled;
}

/** Validates arguments against the operation's manifest schema; returns the error text or null. */
export function openwaOperationArgsError(operation: OpenwaOperation, args: Record<string, unknown>): string | null {
  const validate = validatorFor(operation);
  return validate(args) ? null : (ajv as Ajv).errorsText(validate.errors, { dataVar: "args" });
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.max(0, Math.ceil(Number(trimmed)));
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

function causeCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function filenameFromDisposition(value: string | null): string | null {
  if (!value) return null;
  const star = value.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
    } catch {
      return null;
    }
  }
  const plain = value.match(/filename\s*=\s*("([^"]*)"|[^;]+)/i);
  if (!plain) return null;
  return (plain[2] ?? plain[1]).trim() || null;
}

function contentLength(response: Response): number | null {
  const header = response.headers.get("content-length");
  if (!header) return null;
  const parsed = Number(header);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function createOpenwaGatewayClient(options: OpenwaGatewayClientOptions): OpenwaGatewayClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const apiKey = options.apiKey;
  const adminApiKey = options.adminApiKey || null;
  const sessionId = options.sessionId;
  const encodedSessionId = encodeURIComponent(sessionId);
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes;
  const fetchImpl = options.fetchImpl ?? fetch;
  const secrets = [apiKey, adminApiKey].filter((value): value is string => typeof value === "string" && value.length > 0);

  function scrub(text: string): string {
    let out = text;
    for (const secret of secrets) if (out.includes(secret)) out = out.split(secret).join("[redacted]");
    return out.length > ERROR_MESSAGE_LIMIT ? out.slice(0, ERROR_MESSAGE_LIMIT) + "…" : out;
  }

  function fail(
    code: OpenwaGatewayErrorCode,
    message: string,
    extra: { operationId?: string | null; status?: number | null; retryAfterSeconds?: number | null; pacing?: boolean } = {},
  ): OpenwaGatewayError {
    return new OpenwaGatewayError(code, scrub(message), extra);
  }

  async function readBounded(response: Response, limit: number, operationId: string | null): Promise<Uint8Array> {
    const declared = contentLength(response);
    if (declared !== null && declared > limit) {
      await response.body?.cancel().catch(() => undefined);
      throw fail("payload_too_large", "OpenWA response of " + declared + " bytes exceeds the " + limit + " byte limit", {
        operationId,
        status: response.status,
      });
    }
    if (!response.body) return new Uint8Array(0);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw fail("payload_too_large", "OpenWA response exceeds the " + limit + " byte limit", {
          operationId,
          status: response.status,
        });
      }
      chunks.push(value);
    }
    if (chunks.length === 1) return chunks[0];
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }

  async function errorFromResponse(response: Response, operation: OpenwaOperation | null): Promise<OpenwaGatewayError> {
    const operationId = operation?.id ?? null;
    const status = response.status;
    let body: Record<string, unknown> | null = null;
    let raw = "";
    try {
      raw = new TextDecoder().decode(await readBounded(response, ERROR_BODY_LIMIT, operationId));
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
    } catch {
      body = null;
    }
    const detail = body?.message;
    const gatewayMessage = Array.isArray(detail)
      ? detail.filter((item) => typeof item === "string").join("; ")
      : typeof detail === "string"
        ? detail
        : raw.slice(0, ERROR_MESSAGE_LIMIT);
    const label = (operationId ?? "OpenWA request") + " failed with HTTP " + status + (gatewayMessage ? ": " + gatewayMessage : "");
    const headerRetry = parseRetryAfter(response.headers.get("retry-after"));
    const extra = { operationId, status };
    if (status === 429) {
      if (body?.code === PACING_CODE) {
        const seconds = typeof body.retryAfterSeconds === "number" ? Math.max(0, Math.ceil(body.retryAfterSeconds)) : headerRetry;
        return fail("retry_after", label, { ...extra, retryAfterSeconds: seconds, pacing: true });
      }
      return fail("rate_limited", label, { ...extra, retryAfterSeconds: headerRetry });
    }
    if (status === 501) return fail("unavailable_on_engine", label, extra);
    if (status === 401) return fail("unauthorized", label, extra);
    if (status === 403) return fail("forbidden", label, extra);
    if (status === 404) return fail("not_found", label, extra);
    if (status === 409) return fail("conflict", label, extra);
    if (status === 413) return fail("payload_too_large", label, extra);
    if (status === 502 || status === 503 || status === 504) {
      return fail("gateway_unavailable", label, { ...extra, retryAfterSeconds: headerRetry });
    }
    if (status >= 500) return fail("gateway_error", label, extra);
    return fail("bad_request", label, extra);
  }

  function transportError(error: unknown, operation: OpenwaOperation | null, mutating: boolean): OpenwaGatewayError {
    const operationId = operation?.id ?? null;
    const code = causeCode(error);
    const label = operationId ?? "OpenWA request";
    if (code && CONNECT_ERROR_CODES.has(code)) {
      return fail("gateway_unavailable", label + " could not reach the OpenWA gateway (" + code + ")", { operationId });
    }
    if (mutating) {
      const reason = isTimeout(error) ? "timed out" : "lost its connection" + (code ? " (" + code + ")" : "");
      return fail("uncertain", label + " " + reason + " after it was sent; the outcome is unknown", { operationId });
    }
    const reason = isTimeout(error) ? "timed out" : "failed" + (code ? " (" + code + ")" : "");
    return fail("gateway_unavailable", label + " " + reason, { operationId });
  }

  function mediaFrom(response: Response, limit: number, operationId: string): OpenwaMediaDownload {
    const declared = contentLength(response);
    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    const filename = filenameFromDisposition(response.headers.get("content-disposition"));
    if (declared !== null && declared > limit) {
      void response.body?.cancel().catch(() => undefined);
      throw fail("payload_too_large", "OpenWA media of " + declared + " bytes exceeds the " + limit + " byte limit", {
        operationId,
        status: response.status,
      });
    }
    if (!response.body) return { contentType, contentLength: 0, filename, stream: Readable.from([]) };
    let received = 0;
    const limited = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          received += chunk.byteLength;
          if (received > limit) {
            controller.error(
              fail("payload_too_large", "OpenWA media exceeds the " + limit + " byte limit", {
                operationId,
                status: response.status,
              }),
            );
            return;
          }
          controller.enqueue(chunk);
        },
      }),
    );
    return {
      contentType,
      contentLength: declared,
      filename,
      stream: Readable.fromWeb(limited as unknown as NodeWebReadableStream<Uint8Array>),
    };
  }

  function keyFor(operation: OpenwaOperation, useAdminKey: boolean): string | null {
    const requirement = useAdminKey && operation.auth === "api_key" ? "admin" : openwaKeyRequirement(operation);
    if (requirement === "none") return null;
    if (requirement === "operator") return apiKey;
    if (adminApiKey) return adminApiKey;
    if (requirement === "admin_preferred") return apiKey;
    throw fail(
      "unavailable_without_admin_key",
      operation.id + " needs an unscoped admin key, and no admin key is configured",
      { operationId: operation.id },
    );
  }

  function buildRequest(
    operation: OpenwaOperation,
    args: Record<string, unknown>,
    useAdminKey = false,
  ): { url: string; init: RequestInit } {
    let path = operation.path;
    if (operation.sessionParam === "path") path = path.replace("{sessionId}", encodedSessionId);
    for (const name of operation.pathParams) {
      path = path.replace("{" + name + "}", encodeURIComponent(String(args[name])));
    }
    const query = new URLSearchParams();
    if (operation.sessionParam === "query") query.set("sessionId", sessionId);
    for (const name of operation.queryParams) {
      const value = args[name];
      if (value !== undefined && value !== null) query.set(name, String(value));
    }
    const search = query.toString();
    const url = baseUrl + path + (search ? "?" + search : "");
    const headers: Record<string, string> = {};
    const key = keyFor(operation, useAdminKey);
    if (key) headers["X-API-Key"] = key;
    let body: BodyInit | undefined;
    if (operation.bodyMode === "json") {
      const payload: Record<string, unknown> = {};
      for (const name of operation.bodyParams) if (args[name] !== undefined) payload[name] = args[name];
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(payload);
    } else if (operation.bodyMode === "multipart") {
      const form = new FormData();
      for (const name of operation.bodyParams) {
        const value = args[name];
        if (value === undefined) continue;
        if (operation.fileParams.includes(name)) form.append(name, new Blob([Buffer.from(String(value), "base64")]), name);
        else form.append(name, typeof value === "string" ? value : JSON.stringify(value));
      }
      body = form;
    }
    if (operation.response === "json" || operation.response === "none") headers.Accept = "application/json";
    return { url, init: { method: operation.method, headers, body } };
  }

  async function call(
    operationId: string,
    args: Record<string, unknown> = {},
    callOptions: OpenwaCallOptions = {},
  ): Promise<OpenwaCallResult> {
    const operation = operationsById.get(operationId);
    if (!operation) throw fail("bad_request", "Unknown OpenWA operation " + JSON.stringify(operationId));
    const validate = validatorFor(operation);
    if (!validate(args)) {
      const message = (ajv as Ajv).errorsText(validate.errors, { dataVar: "args" });
      throw fail("bad_request", operation.id + " rejected its arguments: " + message, { operationId: operation.id });
    }
    const { url, init } = buildRequest(operation, args, callOptions.useAdminKey === true);
    const mutating = operation.category !== "read";
    let response: Response;
    try {
      response = await fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(callOptions.timeoutMs ?? defaultTimeoutMs),
      });
    } catch (error) {
      throw transportError(error, operation, mutating);
    }
    if (!response.ok) throw await errorFromResponse(response, operation);
    const status = response.status;
    const limit = callOptions.maxBytes ?? maxResponseBytes ?? (operation.response === "binary" ? getMaxAttachmentBytes() : openwaJsonResponseLimit());
    if (operation.response === "binary") return { kind: "binary", status, media: mediaFrom(response, limit, operation.id) };
    let bytes: Uint8Array;
    try {
      bytes = await readBounded(response, limit, operation.id);
    } catch (error) {
      if (error instanceof OpenwaGatewayError) throw error;
      throw transportError(error, operation, mutating);
    }
    if (bytes.byteLength === 0) return { kind: "empty", status };
    const text = new TextDecoder().decode(bytes);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("json")) return { kind: "text", status, data: text };
    try {
      return { kind: "json", status, data: JSON.parse(text) };
    } catch {
      throw fail("invalid_response", operation.id + " returned malformed JSON", { operationId: operation.id, status });
    }
  }

  async function json<T>(operationId: string, args: Record<string, unknown> = {}, callOptions?: OpenwaCallOptions): Promise<T> {
    const result = await call(operationId, args, callOptions);
    if (result.kind !== "json") {
      throw fail("invalid_response", operationId + " returned no JSON body", { operationId, status: result.status });
    }
    return result.data as T;
  }

  async function openApiVersion(): Promise<string> {
    let response: Response;
    try {
      response = await fetchImpl(baseUrl + "/api/docs-json", {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(defaultTimeoutMs),
      });
    } catch (error) {
      throw transportError(error, null, false);
    }
    if (!response.ok) throw await errorFromResponse(response, null);
    const bytes = await readBounded(response, OPENAPI_DOCUMENT_LIMIT, null);
    let version: unknown;
    try {
      version = (JSON.parse(new TextDecoder().decode(bytes)) as { info?: { version?: unknown } }).info?.version;
    } catch {
      throw fail("invalid_response", "OpenWA OpenAPI document is malformed JSON");
    }
    if (typeof version !== "string" || !version) throw fail("invalid_response", "OpenWA OpenAPI document has no info.version");
    return version;
  }

  async function validateKey(which: "operator" | "admin" = "operator"): Promise<OpenwaKeyValidation> {
    const key = which === "admin" ? adminApiKey : apiKey;
    if (!key) {
      throw fail("unavailable_without_admin_key", "No admin key is configured", {
        operationId: "AuthValidateController_validate",
      });
    }
    const operationId = "AuthValidateController_validate";
    let response: Response;
    try {
      response = await fetchImpl(baseUrl + "/api/auth/validate", {
        method: "POST",
        headers: { "X-API-Key": key, Accept: "application/json" },
        signal: AbortSignal.timeout(defaultTimeoutMs),
      });
    } catch (error) {
      throw transportError(error, operationsById.get(operationId) ?? null, false);
    }
    if (response.status === 401) {
      await response.body?.cancel().catch(() => undefined);
      return { valid: false };
    }
    if (!response.ok) throw await errorFromResponse(response, operationsById.get(operationId) ?? null);
    const bytes = await readBounded(response, ERROR_BODY_LIMIT, operationId);
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw fail("invalid_response", operationId + " returned malformed JSON", { operationId, status: response.status });
    }
    if (!parsed || typeof parsed !== "object" || typeof (parsed as { valid?: unknown }).valid !== "boolean") {
      throw fail("invalid_response", operationId + " returned an unexpected body", { operationId, status: response.status });
    }
    return parsed as OpenwaKeyValidation;
  }

  return {
    sessionId,
    hasAdminKey: adminApiKey !== null,
    call,
    health: () => json<OpenwaHealth>("HealthController_check"),
    openApiVersion,
    validateKey,
    listSessions: () => json<OpenwaSession[]>("SessionController_findAll"),
    listAllSessions: () => json<OpenwaSession[]>("SessionController_findAll", {}, { useAdminKey: true }),
    getSession: () => json<OpenwaSession>("SessionController_findOne"),
    createApiKey: (input) => json<OpenwaApiKeyCreated>("AuthController_create", { name: input.name, role: input.role, allowedSessions: input.allowedSessions }),
    revokeApiKey: async (id) => {
      await call("AuthController_revoke", { id });
    },
    listChats: (input = {}) => {
      const args: Record<string, unknown> = {};
      if (input.limit !== undefined) args.limit = String(input.limit);
      if (input.offset !== undefined) args.offset = String(input.offset);
      return json<OpenwaChatSummary[]>("SessionController_getChats", args);
    },
    sendText: (input) => json<OpenwaSendResult>("MessageController_sendText", { ...input }),
    async sendMedia(input) {
      const { kind, ...rest } = input;
      if ((rest.url === undefined) === (rest.base64 === undefined)) {
        throw fail("bad_request", "sendMedia needs exactly one of url or base64", {
          operationId: MEDIA_OPERATION_BY_KIND[kind] ?? null,
        });
      }
      if (rest.ptt !== undefined && kind !== "audio") {
        throw fail("bad_request", "ptt is only valid for audio", { operationId: MEDIA_OPERATION_BY_KIND[kind] });
      }
      return json<OpenwaSendResult>(MEDIA_OPERATION_BY_KIND[kind], { ...rest });
    },
    reply: (input) => json<OpenwaSendResult>("MessageController_reply", { ...input }),
    react: (input) => json<OpenwaActionResult>("MessageController_react", { ...input }),
    typing: (input) => json<OpenwaActionResult>("SessionController_sendChatState", { ...input }),
    listStoredMessages: (input) => {
      const args: Record<string, unknown> = { limit: input.limit, inlineMedia: input.inlineMedia };
      if (input.after) args.after = input.after;
      if (input.chatId) args.chatId = input.chatId;
      return json<OpenwaStoredMessagePage>("MessageController_getMessages", args);
    },
    chatHistory: (input) =>
      json<OpenwaHistoryMessage[]>(
        "MessageController_getChatHistory",
        { chatId: input.chatId, limit: input.limit, deep: input.deep, includeMedia: input.includeMedia },
        input.timeoutMs === undefined ? undefined : { timeoutMs: input.timeoutMs },
      ),
    getGroup: (groupId) => json<OpenwaGroup>("GroupController_findOne", { groupId }),
    listGroups: (input = {}) => {
      const args: Record<string, unknown> = {};
      if (input.limit !== undefined) args.limit = String(input.limit);
      if (input.offset !== undefined) args.offset = String(input.offset);
      return json<OpenwaGroupSummary[]>("SessionController_getGroups", args);
    },
    contactPhone: (contactId) => json<OpenwaContactPhone>("ContactController_resolvePhone", { contactId }),
    checkNumber: (number) => json<OpenwaNumberCheck>("ContactController_checkNumber", { number }),
    async downloadMedia(input) {
      const result = await call(
        "MessageController_getChatMedia",
        { chatId: input.chatId, messageId: input.messageId },
        { maxBytes: input.maxBytes, timeoutMs: input.timeoutMs },
      );
      if (result.kind !== "binary") {
        throw fail("invalid_response", "MessageController_getChatMedia returned no media stream", {
          operationId: "MessageController_getChatMedia",
          status: result.status,
        });
      }
      return result.media;
    },
  };
}
