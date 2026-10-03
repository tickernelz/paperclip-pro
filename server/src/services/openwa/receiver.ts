import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import {
  OpenwaGatewayError,
  type OpenwaGatewayClient,
  type OpenwaStoredMessage,
} from "./gateway.js";
import {
  openwaChatKey,
  openwaMessageKeyId,
  type OpenwaOutboundRecord,
  type OpenwaOutboundRegistry,
} from "./outbound.js";
import {
  readOpenwaCursor,
  writeOpenwaCursor,
  type OpenwaIngestCursor,
  type OpenwaState,
} from "./state.js";

export const OPENWA_SUBSCRIBED_EVENTS = [
  "message.received",
  "message.sent",
  "message.ack",
  "message.revoked",
  "message.edited",
  "message.reaction",
  "group.join",
  "group.leave",
  "group.update",
  "session.status",
  "session.restriction",
] as const;
export type OpenwaEventName = (typeof OPENWA_SUBSCRIBED_EVENTS)[number];

const EVENT_NAMES: ReadonlySet<string> = new Set(OPENWA_SUBSCRIBED_EVENTS);
const DEFAULT_LIVE_BUFFER_LIMIT = 10_000;
const CATCH_UP_PAGE_SIZE = 100;
const CATCH_UP_MAX_ROWS = 2_000;
const CATCH_UP_MAX_AGE_SECONDS = 24 * 60 * 60;
const CURSOR_SLACK_SECONDS = 120;
const CURSOR_COMMIT_INTERVAL_MS = 2_000;
const CURSOR_COMMIT_EVENTS = 200;
const SEEN_KEYS_LIMIT = 20_000;
const SUBSCRIBE_TIMEOUT_MS = 10_000;
const CATCH_UP_RESTARTS = 3;
const FATAL_SOCKET_CODES = new Set(["UNAUTHORIZED", "FORBIDDEN_SESSION", "INVALID_SESSION"]);
const FATAL_GATEWAY_CODES: ReadonlySet<string> = new Set(["unauthorized", "forbidden", "not_found"]);

export function isFatalOpenwaReceiverError(error: unknown): boolean {
  if (error instanceof OpenwaReceiverError) return error.fatal;
  return error instanceof OpenwaGatewayError && FATAL_GATEWAY_CODES.has(error.code);
}

export interface OpenwaIngressEvent {
  readonly event: OpenwaEventName;
  readonly sessionId: string;
  readonly data: Record<string, unknown>;
  readonly source: "live" | "catch_up";
  readonly rowUuid?: string;
}

export type OpenwaReceiverErrorCode = "credentials" | "session" | "protocol" | "network" | "ownership";

export class OpenwaReceiverError extends Error {
  constructor(
    readonly code: OpenwaReceiverErrorCode,
    message: string,
    readonly fatal: boolean,
  ) {
    super(message);
    this.name = "OpenwaReceiverError";
  }
}

export interface OpenwaSocketHandlers {
  connected(): void;
  disconnected(reason: string): void;
  frame(frame: unknown): void;
  refused(message: string): void;
}

export interface OpenwaEventSocket {
  open(handlers: OpenwaSocketHandlers): void;
  send(message: Record<string, unknown>): void;
  reconnect(): void;
  stable(): void;
  close(): void;
}

export function createOpenwaEventSocket(input: {
  baseUrl: string;
  apiKey: string;
  reconnectDelayMs?: number;
  reconnectDelayMaxMs?: number;
}): OpenwaEventSocket {
  let socket: Socket | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  const base = input.reconnectDelayMs ?? 1_000;
  const max = input.reconnectDelayMaxMs ?? 30_000;
  const later = () => {
    if (closed || retry) return;
    const delay = Math.min(max, base * 2 ** Math.min(attempts++, 10)) * (0.5 + Math.random() / 2);
    retry = setTimeout(() => {
      retry = null;
      if (!closed) socket?.connect();
    }, delay);
    retry.unref?.();
  };
  return {
    open(handlers) {
      socket = io(input.baseUrl.replace(/\/+$/, "") + "/events", {
        auth: { apiKey: input.apiKey },
        transports: ["websocket"],
        autoConnect: false,
        reconnection: true,
        reconnectionDelay: base,
        reconnectionDelayMax: max,
        randomizationFactor: 0.5,
        timeout: 20_000,
      });
      socket.on("connect", () => handlers.connected());
      socket.on("disconnect", (reason) => {
        handlers.disconnected(reason);
        if (reason === "io server disconnect") later();
      });
      socket.on("connect_error", (error) => {
        if (!socket || socket.active) return;
        if (/unauthori|forbidden|invalid/i.test(error.message)) handlers.refused(error.message);
        else later();
      });
      socket.on("message", (frame: unknown) => handlers.frame(frame));
      socket.connect();
    },
    send(message) {
      socket?.emit("message", message);
    },
    reconnect() {
      if (closed || !socket) return;
      socket.disconnect();
      later();
    },
    stable() {
      attempts = 0;
    },
    close() {
      closed = true;
      if (retry) clearTimeout(retry);
      retry = null;
      socket?.removeAllListeners();
      socket?.disconnect();
      socket = null;
    },
  };
}

export interface OpenwaReceiverStats {
  liveEvents: number;
  catchUpRows: number;
  processed: number;
  duplicates: number;
  bufferOverflows: number;
  truncatedCatchUps: number;
  cursorCommits: number;
}

export interface OpenwaReceiverOptions {
  gateway: OpenwaGatewayClient;
  socket: OpenwaEventSocket;
  state: OpenwaState;
  sessionId: string;
  intakeAfter: number;
  liveBufferLimit?: number;
  cursorCommitIntervalMs?: number;
  now?: () => number;
  assertOwned(): Promise<void>;
  admit(event: OpenwaIngressEvent, dedupeKey: string | null): Promise<void>;
  failure(error: unknown): Promise<void>;
  beforeCatchUp?(): Promise<void>;
  live?(): Promise<void>;
  commitCursor?(cursor: OpenwaIngestCursor): Promise<void>;
}

export function openwaDedupeKey(sessionId: string, waMessageId: string | null, rowUuid?: string | null): string | null {
  if (waMessageId) return "openwa:" + sessionId + ":" + waMessageId;
  if (rowUuid) return "openwa:" + sessionId + ":row:" + rowUuid;
  return null;
}

function isMessageEvent(event: OpenwaEventName): boolean {
  return event === "message.received" || event === "message.sent";
}

function stringField(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" && value ? value : null;
}

function epochSeconds(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
}

function remember(set: Set<string>, value: string): void {
  set.add(value);
  if (set.size > SEEN_KEYS_LIMIT) {
    const oldest = set.values().next().value;
    if (oldest !== undefined) set.delete(oldest);
  }
}

function storedTimestamp(row: OpenwaStoredMessage): number {
  return epochSeconds(row.timestamp) ?? Math.floor(Date.parse(row.createdAt) / 1000);
}

function storedRowEvent(sessionId: string, row: OpenwaStoredMessage): OpenwaIngressEvent {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const data: Record<string, unknown> = {
    ...metadata,
    id: row.waMessageId ?? null,
    chatId: row.chatId,
    from: row.from,
    to: row.to,
    author: row.author ?? undefined,
    body: row.body ?? "",
    type: row.type,
    timestamp: storedTimestamp(row),
    fromMe: row.direction === "outgoing",
    isGroup: row.chatId.endsWith("@g.us"),
    status: row.status,
    ...(row.mediaMimetype ? { media: { mimetype: row.mediaMimetype, omitted: true } } : {}),
  };
  return {
    event: row.direction === "outgoing" ? "message.sent" : "message.received",
    sessionId,
    data,
    source: "catch_up",
    rowUuid: row.id,
  };
}

export class OpenwaReceiver {
  readonly stats: OpenwaReceiverStats = {
    liveEvents: 0,
    catchUpRows: 0,
    processed: 0,
    duplicates: 0,
    bufferOverflows: 0,
    truncatedCatchUps: 0,
    cursorCommits: 0,
  };
  private stopped = false;
  private started = false;
  private epoch = 0;
  private live = false;
  private buffer: OpenwaIngressEvent[] = [];
  private overflowed = false;
  private chain: Promise<void> = Promise.resolve();
  private subscribeRequest: { id: string; epoch: number; timer: ReturnType<typeof setTimeout> } | null = null;
  private readonly seen = new Set<string>();
  private cursor: OpenwaIngestCursor | null = null;
  private cursorLoaded = false;
  private uncommitted = 0;
  private commitTimer?: ReturnType<typeof setInterval>;
  private readonly now: () => number;

  constructor(private readonly options: OpenwaReceiverOptions) {
    this.now = options.now ?? Date.now;
  }

  start(): void {
    if (this.stopped || this.started) return;
    this.started = true;
    this.commitTimer = setInterval(() => {
      if (this.uncommitted > 0 && !this.stopped) this.enqueue(() => this.commit(true));
    }, this.options.cursorCommitIntervalMs ?? CURSOR_COMMIT_INTERVAL_MS);
    this.commitTimer.unref?.();
    this.options.socket.open({
      connected: () => this.onConnected(),
      disconnected: () => this.onDisconnected(),
      frame: (frame) => this.onFrame(frame),
      refused: (message) => this.fail(new OpenwaReceiverError("credentials", "OpenWA refused the event socket: " + message, true)),
    });
  }

  private onConnected(): void {
    if (this.stopped) return;
    const epoch = ++this.epoch;
    this.live = false;
    this.buffer = [];
    this.overflowed = false;
    if (this.subscribeRequest) clearTimeout(this.subscribeRequest.timer);
    const id = randomUUID();
    const timer = setTimeout(() => {
      if (this.subscribeRequest?.id !== id || this.stopped) return;
      this.subscribeRequest = null;
      this.options.socket.reconnect();
    }, SUBSCRIBE_TIMEOUT_MS);
    timer.unref?.();
    this.subscribeRequest = { id, epoch, timer };
    this.options.socket.send({
      type: "subscribe",
      sessionId: this.options.sessionId,
      events: [...OPENWA_SUBSCRIBED_EVENTS],
      requestId: id,
    });
  }

  private onDisconnected(): void {
    this.live = false;
    this.epoch++;
    if (this.subscribeRequest) clearTimeout(this.subscribeRequest.timer);
    this.subscribeRequest = null;
  }

  private onFrame(frame: unknown): void {
    if (this.stopped || !frame || typeof frame !== "object") return;
    const value = frame as Record<string, unknown>;
    if (value.type === "subscribed") {
      const request = this.subscribeRequest;
      if (!request || value.requestId !== request.id) return;
      clearTimeout(request.timer);
      this.subscribeRequest = null;
      this.enqueue(() => this.recover(request.epoch));
      return;
    }
    if (value.type === "error") {
      const code = typeof value.code === "string" ? value.code : "UNKNOWN";
      const message = "OpenWA event socket error " + code;
      if (FATAL_SOCKET_CODES.has(code))
        this.fail(new OpenwaReceiverError(code === "UNAUTHORIZED" ? "credentials" : "session", message, true));
      else if (value.requestId && this.subscribeRequest?.id === value.requestId)
        this.fail(new OpenwaReceiverError("protocol", message, true));
      return;
    }
    if (value.type !== "event") return;
    const payload = value.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload.event !== "string" || !EVENT_NAMES.has(payload.event)) return;
    if (payload.sessionId !== this.options.sessionId) return;
    const data = payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>) : {};
    const event: OpenwaIngressEvent = {
      event: payload.event as OpenwaEventName,
      sessionId: this.options.sessionId,
      data,
      source: "live",
    };
    this.stats.liveEvents++;
    if (this.live) {
      this.enqueue(() => this.process(event));
      return;
    }
    if (this.overflowed) return;
    if (this.buffer.length >= (this.options.liveBufferLimit ?? DEFAULT_LIVE_BUFFER_LIMIT)) {
      this.buffer = [];
      this.overflowed = true;
      this.stats.bufferOverflows++;
      return;
    }
    this.buffer.push(event);
  }

  private enqueue(task: () => Promise<void>): void {
    this.chain = this.chain.then(async () => {
      if (this.stopped) return;
      try {
        await task();
      } catch (error) {
        await this.fail(error);
      }
    });
  }

  private async recover(epoch: number): Promise<void> {
    await this.options.beforeCatchUp?.();
    for (;;) {
      if (this.stopped || epoch !== this.epoch) return;
      this.overflowed = false;
      await this.catchUp();
      while (!this.stopped && epoch === this.epoch && this.buffer.length && !this.overflowed) {
        const pending = this.buffer;
        this.buffer = [];
        for (const event of pending) {
          if (this.stopped || epoch !== this.epoch) return;
          await this.process(event);
        }
      }
      if (this.stopped || epoch !== this.epoch) return;
      if (!this.overflowed) {
        this.live = true;
        this.options.socket.stable();
        await this.options.live?.();
        return;
      }
      this.buffer = [];
    }
  }

  async catchUp(): Promise<void> {
    const { gateway, sessionId, intakeAfter } = this.options;
    await this.options.assertOwned();
    const cursor = await this.loadCursor();
    for (let restart = 0; ; restart++) {
      const rows: OpenwaStoredMessage[] = [];
      let truncated = false;
      let after: string | null = null;
      try {
        const nowSeconds = Math.floor(this.now() / 1000);
        const floor = Math.max(
          nowSeconds - CATCH_UP_MAX_AGE_SECONDS,
          cursor ? cursor.timestamp - CURSOR_SLACK_SECONDS : Math.floor(intakeAfter / 1000),
        );
        const cursorKey = cursor?.waMessageId ? openwaMessageKeyId(cursor.waMessageId) : null;
        walk: for (;;) {
          if (this.stopped) return;
          const page = await gateway.listStoredMessages({ after, limit: CATCH_UP_PAGE_SIZE, inlineMedia: false });
          if (!page || !Array.isArray(page.messages))
            throw new OpenwaReceiverError("protocol", "OpenWA returned an invalid stored-message page", false);
          for (const row of page.messages) {
            if (cursor && (row.id === cursor.rowId || (cursorKey && row.waMessageId && openwaMessageKeyId(row.waMessageId) === cursorKey)))
              break walk;
            if (storedTimestamp(row) < floor) break walk;
            if (rows.length >= CATCH_UP_MAX_ROWS) {
              truncated = true;
              break walk;
            }
            rows.push(row);
          }
          if (page.messages.length < CATCH_UP_PAGE_SIZE) break;
          after = page.messages[page.messages.length - 1].id;
        }
      } catch (error) {
        if (
          error instanceof OpenwaGatewayError &&
          error.code === "bad_request" &&
          after &&
          restart < CATCH_UP_RESTARTS
        )
          continue;
        throw error;
      }
      if (truncated) this.stats.truncatedCatchUps++;
      for (let index = rows.length - 1; index >= 0; index--) {
        if (this.stopped) return;
        const row = rows[index];
        if (storedTimestamp(row) * 1000 < intakeAfter) continue;
        this.stats.catchUpRows++;
        await this.process(storedRowEvent(sessionId, row));
      }
      return;
    }
  }

  private async loadCursor(): Promise<OpenwaIngestCursor | null> {
    if (!this.cursorLoaded) {
      this.cursor = await readOpenwaCursor(this.options.state, this.options.sessionId);
      this.cursorLoaded = true;
    }
    return this.cursor;
  }

  private async process(event: OpenwaIngressEvent): Promise<void> {
    await this.options.assertOwned();
    const message = isMessageEvent(event.event);
    const waMessageId = message ? stringField(event.data, "id") : null;
    const key = message ? openwaDedupeKey(event.sessionId, waMessageId, event.rowUuid) : null;
    const seenKey = waMessageId ? "k:" + openwaMessageKeyId(waMessageId) : key;
    if (seenKey && this.seen.has(seenKey)) {
      this.stats.duplicates++;
      return;
    }
    await this.options.admit(event, key);
    this.stats.processed++;
    if (!key) return;
    if (seenKey) remember(this.seen, seenKey);
    const timestamp = epochSeconds(event.data.timestamp);
    if (timestamp === null) return;
    if (this.cursor && this.cursor.timestamp > timestamp) return;
    this.cursor = {
      schema: 1,
      sessionId: event.sessionId,
      waMessageId,
      rowId: event.rowUuid ?? null,
      timestamp,
    };
    this.uncommitted++;
    if (this.uncommitted >= CURSOR_COMMIT_EVENTS) await this.commit(true);
  }

  private async commit(fenced: boolean): Promise<void> {
    const cursor = this.cursor;
    if (!cursor || this.uncommitted === 0) return;
    if (fenced) await this.options.assertOwned();
    const count = this.uncommitted;
    if (this.options.commitCursor) await this.options.commitCursor(cursor);
    else await writeOpenwaCursor(this.options.state, this.options.sessionId, cursor);
    this.uncommitted -= count;
    this.stats.cursorCommits++;
  }

  private async fail(error: unknown): Promise<void> {
    if (this.stopped) return;
    if (error instanceof OpenwaReceiverError && error.code === "ownership") {
      this.halt();
      return;
    }
    if (isFatalOpenwaReceiverError(error)) this.halt();
    else {
      this.live = false;
      this.epoch++;
      this.options.socket.reconnect();
    }
    await this.options.failure(error).catch(() => undefined);
  }

  private halt(): void {
    this.stopped = true;
    if (this.commitTimer) clearInterval(this.commitTimer);
    if (this.subscribeRequest) clearTimeout(this.subscribeRequest.timer);
    this.subscribeRequest = null;
    this.options.socket.close();
  }

  async close(): Promise<void> {
    const wasStopped = this.stopped;
    this.halt();
    await this.chain.catch(() => undefined);
    if (wasStopped && !this.uncommitted) return;
    await this.commit(false).catch(() => undefined);
  }
}

export interface OpenwaMediaMeta {
  mimetype: string | null;
  filename: string | null;
  sizeBytes: number | null;
  omitted: boolean;
}

export interface OpenwaInboundEvent {
  readonly source: "live" | "catch_up";
  readonly event: "message.received" | "message.sent";
  readonly sessionId: string;
  readonly waMessageId: string | null;
  readonly rowUuid: string | null;
  readonly dedupeKey: string;
  readonly chatId: string;
  readonly chatKey: string;
  readonly chatKind: "dm" | "group";
  readonly from: string;
  readonly author: string | null;
  readonly senderJid: string;
  readonly senderPhone: string | null;
  readonly isLidSender: boolean;
  readonly fromMe: boolean;
  readonly phoneTyped: boolean;
  readonly degraded: boolean;
  readonly body: string;
  readonly type: string;
  readonly timestamp: number;
  readonly mentionedIds: readonly string[];
  readonly quoted: { id: string; body: string | null } | null;
  readonly media: OpenwaMediaMeta | null;
  readonly location: Record<string, unknown> | null;
  readonly contact: Record<string, unknown> | null;
  readonly raw: Record<string, unknown>;
}

export interface OpenwaInboundContext {
  readonly companyId: string;
  readonly endpointId: string;
  readonly outbound: OpenwaOutboundRegistry;
}

export type OpenwaInboundHandler = (event: OpenwaInboundEvent, ctx: OpenwaInboundContext) => Promise<void>;

export interface OpenwaGroupEvent {
  readonly event: "group.join" | "group.leave" | "group.update";
  readonly sessionId: string;
  readonly groupId: string;
  readonly actorId: string | null;
  readonly participantIds: readonly string[];
  readonly changes: Record<string, unknown> | null;
  readonly timestamp: number | null;
  readonly source: "live";
}

export type OpenwaGroupHandler = (event: OpenwaGroupEvent, ctx: OpenwaInboundContext) => Promise<void>;

export type OpenwaSessionHealth =
  | { kind: "status"; status: string; healthy: boolean }
  | { kind: "restriction"; active: boolean; restrictionKind: string | null; code: string | null; expiresAt: string | null; healthy: boolean };

export type OpenwaSessionHealthHandler = (health: OpenwaSessionHealth, ctx: OpenwaInboundContext) => Promise<void>;

export interface OpenwaDispatchStats {
  inbound: number;
  connectorEchoes: number;
  failClosedInbound: number;
  failClosedGroup: number;
  unsupportedChats: number;
  invalidMessages: number;
  acks: number;
  sessionHealth: number;
  ignoredEvents: number;
}

const UNSUPPORTED_CHAT_SUFFIXES = ["@broadcast", "@newsletter"];

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function phoneOf(jid: string | null): string | null {
  if (!jid) return null;
  const match = /^(\d{5,20})@(?:c\.us|s\.whatsapp\.net)$/.exec(jid);
  return match ? match[1] : null;
}

function mentionsFromBody(body: string): string[] {
  const ids = new Set<string>();
  for (const match of body.matchAll(/@(\d{5,20})\b/g)) ids.add(match[1] + "@c.us");
  return [...ids];
}

export function normalizeOpenwaInbound(
  event: OpenwaIngressEvent,
  ownJid: string,
  dedupeKey: string,
  phoneTyped: boolean,
): OpenwaInboundEvent | null {
  const data = event.data;
  const chatId = stringField(data, "chatId") ?? stringField(data, "from");
  if (!chatId || UNSUPPORTED_CHAT_SUFFIXES.some((suffix) => chatId.endsWith(suffix))) return null;
  const kind = stringField(data, "kind");
  if (kind && kind !== "individual" && kind !== "group") return null;
  const degraded = event.source === "catch_up";
  const fromMe = data.fromMe === true;
  const chatKind = chatId.endsWith("@g.us") ? "group" : "dm";
  const from = stringField(data, "from") ?? chatId;
  const author = stringField(data, "author");
  const senderJid = fromMe ? ownJid : chatKind === "group" ? (author ?? from) : from;
  const isLidSender = typeof data.isLidSender === "boolean" ? data.isLidSender : senderJid.endsWith("@lid");
  const senderPhone = fromMe
    ? phoneOf(ownJid)
    : (typeof data.senderPhone === "string" && data.senderPhone ? data.senderPhone.replace(/\D/g, "") || null : null) ??
      phoneOf(senderJid);
  const body = typeof data.body === "string" ? data.body : "";
  const mentionedIds = Array.isArray(data.mentionedIds)
    ? data.mentionedIds.filter((id): id is string => typeof id === "string")
    : degraded
      ? mentionsFromBody(body)
      : [];
  const quotedSource = record(data.quotedMessage) ?? record(data.quotedMsg);
  const quotedId = quotedSource ? (stringField(quotedSource, "id") ?? stringField(quotedSource, "messageId")) : null;
  const mediaSource = record(data.media);
  const timestamp = epochSeconds(data.timestamp);
  if (timestamp === null) return null;
  return {
    source: event.source,
    event: event.event === "message.sent" ? "message.sent" : "message.received",
    sessionId: event.sessionId,
    waMessageId: stringField(data, "id"),
    rowUuid: event.rowUuid ?? null,
    dedupeKey,
    chatId,
    chatKey: openwaChatKey(chatId),
    chatKind,
    from,
    author,
    senderJid,
    senderPhone,
    isLidSender,
    fromMe,
    phoneTyped,
    degraded,
    body,
    type: stringField(data, "type") ?? "unknown",
    timestamp,
    mentionedIds,
    quoted: quotedId
      ? { id: quotedId, body: quotedSource && typeof quotedSource.body === "string" ? quotedSource.body : null }
      : null,
    media: mediaSource
      ? {
          mimetype: stringField(mediaSource, "mimetype"),
          filename: stringField(mediaSource, "filename"),
          sizeBytes: typeof mediaSource.sizeBytes === "number" ? mediaSource.sizeBytes : null,
          omitted: mediaSource.omitted === true || typeof mediaSource.data !== "string",
        }
      : null,
    location: record(data.location),
    contact: record(data.contact),
    raw: data,
  };
}

export interface OpenwaDispatcher {
  readonly stats: OpenwaDispatchStats;
  dispatch(event: OpenwaIngressEvent, dedupeKey: string | null): Promise<void>;
}

export function createOpenwaDispatcher(input: {
  companyId: string;
  endpointId: string;
  ownJid: string;
  outbound: OpenwaOutboundRegistry;
  onInbound?: OpenwaInboundHandler;
  onGroup?: OpenwaGroupHandler;
  onSessionHealth: OpenwaSessionHealthHandler;
  onConnectorEcho?(event: OpenwaIngressEvent, record: OpenwaOutboundRecord): void;
}): OpenwaDispatcher {
  const stats: OpenwaDispatchStats = {
    inbound: 0,
    connectorEchoes: 0,
    failClosedInbound: 0,
    failClosedGroup: 0,
    unsupportedChats: 0,
    invalidMessages: 0,
    acks: 0,
    sessionHealth: 0,
    ignoredEvents: 0,
  };
  const ctx: OpenwaInboundContext = { companyId: input.companyId, endpointId: input.endpointId, outbound: input.outbound };
  async function message(event: OpenwaIngressEvent, dedupeKey: string | null): Promise<void> {
    if (!dedupeKey) {
      stats.invalidMessages++;
      return;
    }
    const data = event.data;
    const fromMe = data.fromMe === true || event.event === "message.sent";
    let phoneTyped = false;
    if (fromMe) {
      const chatId = stringField(data, "chatId") ?? stringField(data, "to");
      const echo = chatId
        ? await input.outbound.matchEcho(input.endpointId, {
            waMessageId: stringField(data, "id"),
            chatKey: openwaChatKey(chatId),
            body: typeof data.body === "string" ? data.body : "",
          })
        : null;
      if (echo) {
        stats.connectorEchoes++;
        input.onConnectorEcho?.(event, echo);
        return;
      }
      phoneTyped = true;
    }
    const normalized = normalizeOpenwaInbound({ ...event, data: { ...data, fromMe } }, input.ownJid, dedupeKey, phoneTyped);
    if (!normalized) {
      stats.unsupportedChats++;
      return;
    }
    stats.inbound++;
    if (!input.onInbound) {
      stats.failClosedInbound++;
      return;
    }
    await input.onInbound(normalized, ctx);
  }
  return {
    stats,
    async dispatch(event, dedupeKey) {
      switch (event.event) {
        case "message.received":
        case "message.sent":
          return message(event, dedupeKey);
        case "message.ack": {
          const waMessageId = stringField(event.data, "messageId") ?? stringField(event.data, "id");
          const status = stringField(event.data, "status");
          if (!waMessageId || !status) return;
          stats.acks++;
          await input.outbound.applyAck(input.endpointId, { waMessageId, status });
          return;
        }
        case "session.status": {
          const status = stringField(event.data, "status");
          if (!status) return;
          stats.sessionHealth++;
          await input.onSessionHealth({ kind: "status", status, healthy: status === "ready" }, ctx);
          return;
        }
        case "session.restriction": {
          const active = event.data.active === true;
          stats.sessionHealth++;
          await input.onSessionHealth(
            {
              kind: "restriction",
              active,
              restrictionKind: stringField(event.data, "kind"),
              code: stringField(event.data, "code"),
              expiresAt: stringField(event.data, "expiresAt"),
              healthy: !active,
            },
            ctx,
          );
          return;
        }
        case "group.join":
        case "group.leave":
        case "group.update": {
          const groupId = stringField(event.data, "groupId");
          if (!groupId) return;
          if (!input.onGroup) {
            stats.failClosedGroup++;
            return;
          }
          await input.onGroup(
            {
              event: event.event,
              sessionId: event.sessionId,
              groupId,
              actorId: stringField(event.data, "actorId"),
              participantIds: Array.isArray(event.data.participantIds)
                ? event.data.participantIds.filter((id): id is string => typeof id === "string")
                : [],
              changes: record(event.data.changes),
              timestamp: epochSeconds(event.data.timestamp),
              source: "live",
            },
            ctx,
          );
          return;
        }
        default:
          stats.ignoredEvents++;
      }
    },
  };
}
