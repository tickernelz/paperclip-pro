import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Server as SocketServer, type Socket } from "socket.io";
import type { OpenwaStoredMessage } from "../../services/openwa/gateway.js";

export const FAKE_OPENWA_KEY = "owa_k1_fake_operator_key_for_tests_only";

export interface FakeSendFailure {
  status?: number;
  body?: unknown;
  dropResponseAfterStore?: boolean;
  delayMs?: number;
}

export interface FakeStoredRow extends OpenwaStoredMessage {
  sequence: number;
}

export interface FakeGatewayOptions {
  sessionId: string;
  ownPhone: string;
  restLatencyMs?: number;
}

export class FakeOpenwaGateway {
  readonly sessionId: string;
  readonly ownJid: string;
  restLatencyMs: number;
  readonly rows: FakeStoredRow[] = [];
  readonly sends: Array<{ chatId: string; text: string; messageId: string | null }> = [];
  readonly requests: Array<{ method: string; path: string; query: Record<string, string> }> = [];
  readonly subscriptions: Array<{ sessionId: string; events: string[] }> = [];
  readonly groups = new Map<string, { id: string; name: string; participants: Array<{ id: string; isAdmin?: boolean }> }>();
  readonly chats: Array<{ id: string; name?: string; timestamp?: number }> = [];
  private readonly sendFailures: FakeSendFailure[] = [];
  private http: HttpServer | null = null;
  private io: SocketServer | null = null;
  private port = 0;
  private sequence = 0;
  private waCounter = 0;
  private acceptSockets = true;
  private readonly subscribed = new Set<Socket>();
  private connectedWaiters: Array<() => void> = [];
  private subscribedWaiters: Array<() => void> = [];

  constructor(options: FakeGatewayOptions) {
    this.sessionId = options.sessionId;
    this.ownJid = options.ownPhone + "@c.us";
    this.restLatencyMs = options.restLatencyMs ?? 0;
  }

  get baseUrl(): string {
    return "http://127.0.0.1:" + this.port;
  }

  get subscriberCount(): number {
    return this.subscribed.size;
  }

  async start(): Promise<void> {
    this.http = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.http!.listen(this.port, "127.0.0.1", resolve));
    this.port = (this.http.address() as AddressInfo).port;
    this.attachSocket();
  }

  private attachSocket(): void {
    this.io = new SocketServer(this.http!, { transports: ["websocket"] });
    const events = this.io.of("/events");
    events.use((socket, next) => {
      if (!this.acceptSockets) return next(new Error("gateway restarting"));
      if ((socket.handshake.auth as { apiKey?: string })?.apiKey !== FAKE_OPENWA_KEY) return next(new Error("UNAUTHORIZED"));
      next();
    });
    events.on("connection", (socket) => {
      for (const resolve of this.connectedWaiters.splice(0)) resolve();
      socket.on("message", (frame: { type?: string; sessionId?: string; events?: string[]; requestId?: string }) => {
        if (frame?.type !== "subscribe") return;
        if (frame.sessionId !== this.sessionId) {
          socket.emit("message", { type: "error", code: "FORBIDDEN_SESSION", requestId: frame.requestId });
          return;
        }
        this.subscriptions.push({ sessionId: frame.sessionId, events: [...(frame.events ?? [])] });
        this.subscribed.add(socket);
        socket.emit("message", { type: "subscribed", sessionId: frame.sessionId, events: frame.events, requestId: frame.requestId });
        for (const resolve of this.subscribedWaiters.splice(0)) resolve();
      });
      socket.on("disconnect", () => this.subscribed.delete(socket));
    });
  }

  waitForSubscription(): Promise<void> {
    if (this.subscribed.size) return Promise.resolve();
    return new Promise((resolve) => this.subscribedWaiters.push(resolve));
  }

  killSocket(): void {
    this.acceptSockets = false;
    for (const socket of this.subscribed) socket.disconnect(true);
    this.subscribed.clear();
    for (const socket of this.io?.of("/events").sockets.values() ?? []) socket.disconnect(true);
  }

  restartSocket(): void {
    this.acceptSockets = true;
  }

  failNextSend(failure: FakeSendFailure): void {
    this.sendFailures.push(failure);
  }

  nextWaMessageId(fromMe: boolean, chatId: string): string {
    return (fromMe ? "true_" : "false_") + chatId + "_3EB0" + String(++this.waCounter).padStart(16, "0");
  }

  inbound(input: {
    chatId: string;
    from?: string;
    author?: string;
    body?: string;
    fromMe?: boolean;
    waMessageId?: string | null;
    timestamp?: number;
    emit?: boolean;
    store?: boolean;
    extra?: Record<string, unknown>;
  }): FakeStoredRow {
    const sequence = ++this.sequence;
    const fromMe = input.fromMe === true;
    const waMessageId = input.waMessageId === undefined ? this.nextWaMessageId(fromMe, input.chatId) : input.waMessageId;
    const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
    const row: FakeStoredRow = {
      id: randomUUID(),
      sessionId: this.sessionId,
      waMessageId,
      chatId: input.chatId,
      from: fromMe ? this.ownJid : (input.from ?? input.chatId),
      to: fromMe ? input.chatId : this.ownJid,
      author: input.author ?? null,
      body: input.body ?? "seq:" + sequence,
      type: "text",
      direction: fromMe ? "outgoing" : "incoming",
      timestamp,
      metadata: null,
      mediaPath: null,
      mediaMimetype: null,
      status: fromMe ? "sent" : "delivered",
      createdAt: new Date(timestamp * 1000).toISOString(),
      sequence,
    };
    if (input.store !== false) this.rows.push(row);
    if (input.emit !== false)
      this.emit(fromMe ? "message.sent" : "message.received", {
        id: waMessageId,
        chatId: row.chatId,
        from: row.from,
        to: row.to,
        author: row.author ?? undefined,
        body: row.body,
        type: "text",
        timestamp,
        fromMe,
        isGroup: row.chatId.endsWith("@g.us"),
        kind: row.chatId.endsWith("@g.us") ? "group" : "individual",
        ...(input.extra ?? {}),
      });
    return row;
  }

  emit(event: string, data: Record<string, unknown>): void {
    for (const socket of this.subscribed)
      socket.emit("message", {
        type: "event",
        timestamp: new Date().toISOString(),
        payload: { event, sessionId: this.sessionId, data },
      });
  }

  async close(): Promise<void> {
    this.subscribed.clear();
    await new Promise<void>((resolve) => (this.io ? this.io.close(() => resolve()) : resolve()));
    await new Promise<void>((resolve) => (this.http?.listening ? this.http.close(() => resolve()) : resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", this.baseUrl);
    const query = Object.fromEntries(url.searchParams);
    this.requests.push({ method: req.method ?? "GET", path: url.pathname, query });
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    if (this.restLatencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.restLatencyMs));
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers["x-api-key"] !== FAKE_OPENWA_KEY) return reply(401, { message: "Unauthorized" });
    const prefix = "/api/sessions/" + this.sessionId;
    if (req.method === "GET" && url.pathname === prefix + "/messages") return this.listMessages(query, reply);
    if (req.method === "POST" && url.pathname === prefix + "/messages/send-text") {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as { chatId: string; text: string };
      return this.sendText(body, reply, res);
    }
    if (req.method === "POST" && url.pathname === prefix + "/chats/typing") return reply(201, { success: true });
    if (req.method === "GET" && url.pathname.startsWith(prefix + "/groups/")) {
      const group = this.groups.get(decodeURIComponent(url.pathname.slice((prefix + "/groups/").length)));
      return group ? reply(200, group) : reply(404, { message: "Group not found" });
    }
    if (req.method === "GET" && url.pathname === prefix + "/chats") return reply(200, this.chats);
    reply(404, { message: "Not found" });
  }

  private listMessages(query: Record<string, string>, reply: (status: number, body: unknown) => void): void {
    let rows = [...this.rows].sort((a, b) => b.sequence - a.sequence);
    if (query.chatId) rows = rows.filter((row) => row.chatId === query.chatId);
    if (query.after) {
      const index = rows.findIndex((row) => row.id === query.after);
      if (index < 0) return reply(400, { message: "Unknown cursor" });
      rows = rows.slice(index + 1);
    }
    const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 100);
    reply(200, {
      messages: rows.slice(0, limit).map(({ sequence: _sequence, ...row }) => row),
      total: this.rows.length,
    });
  }

  private async sendText(
    body: { chatId: string; text: string },
    reply: (status: number, body: unknown) => void,
    res: ServerResponse,
  ): Promise<void> {
    const failure = this.sendFailures.shift();
    if (failure?.delayMs) await new Promise((resolve) => setTimeout(resolve, failure.delayMs));
    if (failure?.status) {
      this.sends.push({ chatId: body.chatId, text: body.text, messageId: null });
      return reply(failure.status, failure.body ?? { message: "send failed" });
    }
    const row = this.inbound({ chatId: body.chatId, body: body.text, fromMe: true });
    this.sends.push({ chatId: body.chatId, text: body.text, messageId: row.waMessageId ?? null });
    if (failure?.dropResponseAfterStore) {
      res.socket?.destroy();
      return;
    }
    reply(201, { messageId: row.waMessageId, timestamp: row.timestamp });
  }
}
