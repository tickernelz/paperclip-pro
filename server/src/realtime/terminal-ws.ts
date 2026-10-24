import type { IncomingMessage, Server as HttpServer } from "node:http";
import { createRequire } from "node:module";
import type { Duplex } from "node:stream";
import type { Db } from "@tickernelz/paperclip-pro-db";
import {
  TERMINAL_AUTH_TIMEOUT_MS,
  TERMINAL_WEBSOCKET_PATH,
  clampTerminalCols,
  clampTerminalRows,
  type TerminalErrorCode,
  type TerminalServerFrame,
} from "@tickernelz/paperclip-pro-shared";
import { logger } from "../middleware/logger.js";
import { logActivity, type LogActivityInput } from "../services/activity-log.js";
import {
  databaseTerminalActorLoader,
  terminalAccessDenial,
  type TerminalActorLoader,
} from "../services/terminal/access.js";
import {
  terminalSessionManager,
  type TerminalAttachTokenGrant,
  type TerminalSessionManager,
} from "../services/terminal/manager.js";
import { terminalOriginAllowed, type TerminalOriginPolicy } from "../services/terminal/origin.js";

interface TerminalSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  on(event: "message", listener: (data: unknown) => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "error", listener: (err: Error) => void): void;
}

export interface TerminalWebSocketServer {
  clients: Set<TerminalSocket>;
  on(event: "connection", listener: (socket: TerminalSocket, req: IncomingMessage) => void): void;
  close(callback?: (err?: Error) => void): void;
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, callback: (ws: TerminalSocket) => void): void;
  emit(event: "connection", ws: TerminalSocket, req: IncomingMessage): boolean;
}

export type TerminalRecheckScheduler = (run: () => Promise<void>, intervalMs: number) => () => void;

export interface TerminalWebSocketOptions {
  originPolicy: TerminalOriginPolicy;
  db?: Db;
  manager?: TerminalSessionManager;
  authTimeoutMs?: number;
  loadActor?: TerminalActorLoader;
  recordActivity?: (input: LogActivityInput) => Promise<unknown>;
  recheckIntervalMs?: number;
  scheduleRecheck?: TerminalRecheckScheduler;
}

interface IncomingMessageWithTerminal extends IncomingMessage {
  paperclipWebSocketHandled?: boolean;
}

interface AttachedConnection {
  grant: TerminalAttachTokenGrant;
  revoke(message: string): void;
}

const require = createRequire(import.meta.url);
const { WebSocket, WebSocketServer } = require("ws") as {
  WebSocket: { OPEN: number };
  WebSocketServer: new (opts: { noServer: boolean; maxPayload: number }) => TerminalWebSocketServer;
};

const TERMINAL_MAX_FRAME_BYTES = 4 * 1024 * 1024;
export const TERMINAL_PREAUTH_MAX_FRAME_BYTES = 16 * 1024;
export const TERMINAL_ACCESS_RECHECK_MS = 60_000;

const intervalScheduler: TerminalRecheckScheduler = (run, intervalMs) => {
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
};

function rawByteLength(raw: unknown): number {
  if (typeof raw === "string") return Buffer.byteLength(raw, "utf8");
  if (Buffer.isBuffer(raw)) return raw.length;
  if (raw instanceof ArrayBuffer) return raw.byteLength;
  if (Array.isArray(raw)) return raw.reduce((total: number, part: Buffer) => total + part.length, 0);
  return 0;
}

function decodeFrame(raw: unknown): Record<string, unknown> | null {
  let text: string;
  if (typeof raw === "string") text = raw;
  else if (Buffer.isBuffer(raw)) text = raw.toString("utf8");
  else if (raw instanceof ArrayBuffer) text = Buffer.from(raw).toString("utf8");
  else if (Array.isArray(raw)) text = Buffer.concat(raw as Buffer[]).toString("utf8");
  else return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readDimensions(frame: Record<string, unknown>): { cols: number; rows: number } | null {
  const { cols, rows } = frame;
  if (typeof cols !== "number" || typeof rows !== "number" || !Number.isFinite(cols) || !Number.isFinite(rows)) {
    return null;
  }
  return { cols: clampTerminalCols(cols), rows: clampTerminalRows(rows) };
}

function rejectUpgrade(socket: Duplex, statusLine: string, message: string) {
  if (socket.destroyed) return;
  try {
    socket.once("finish", () => socket.destroy());
    socket.end(`HTTP/1.1 ${statusLine}\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${message}`);
  } catch {
    socket.destroy();
  }
}

export function setupTerminalWebSocketServer(server: HttpServer, options: TerminalWebSocketOptions): TerminalWebSocketServer {
  const manager = options.manager ?? terminalSessionManager;
  const authTimeoutMs = options.authTimeoutMs ?? TERMINAL_AUTH_TIMEOUT_MS;
  const db = options.db;
  const loadActor = options.loadActor ?? (db ? databaseTerminalActorLoader(db) : null);
  const recordActivity = options.recordActivity ?? (db ? (input: LogActivityInput) => logActivity(db, input) : null);
  if (!loadActor || !recordActivity) {
    throw new Error("Terminal websocket needs a database or explicit actor loader and activity recorder");
  }
  const wss = new WebSocketServer({ noServer: true, maxPayload: TERMINAL_MAX_FRAME_BYTES });
  const attached = new Set<AttachedConnection>();

  const grantDenial = async (grant: TerminalAttachTokenGrant): Promise<string | null> => {
    try {
      const actor = await loadActor({
        userId: grant.userId,
        actorSource: grant.actorSource,
        authSessionId: grant.authSessionId,
      });
      return actor ? terminalAccessDenial(actor, grant.companyId, grant.kind) : "Terminal access could not be confirmed";
    } catch (err) {
      logger.warn({ err, sessionId: grant.sessionId }, "terminal access check failed");
      return "Terminal access could not be confirmed";
    }
  };

  let recheckRunning = false;
  const recheckAccess = async () => {
    if (recheckRunning) return;
    recheckRunning = true;
    try {
      await Promise.all(
        [...attached].map(async (connection) => {
          const denial = await grantDenial(connection.grant);
          if (denial && attached.has(connection)) connection.revoke(denial);
        }),
      );
    } finally {
      recheckRunning = false;
    }
  };
  const stopRecheck = (options.scheduleRecheck ?? intervalScheduler)(
    recheckAccess,
    options.recheckIntervalMs ?? TERMINAL_ACCESS_RECHECK_MS,
  );

  wss.on("connection", (socket) => {
    let target: TerminalAttachTokenGrant | null = null;
    let connection: AttachedConnection | null = null;
    let detach: (() => void) | null = null;
    let pendingResize: { cols: number; rows: number } | null = null;
    let authenticating = false;
    let closed = false;

    const send = (frame: TerminalServerFrame) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
    };
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearTimeout(authTimer);
      if (connection) attached.delete(connection);
      detach?.();
      detach = null;
    };
    const closeSocket = (code: number, reason: string) => {
      cleanup();
      if (socket.readyState === WebSocket.OPEN) socket.close(code, reason.slice(0, 120));
    };
    const fail = (code: TerminalErrorCode, message: string, closeCode = 1008) => {
      send({ type: "error", code, message });
      closeSocket(closeCode, code);
    };
    const authTimer = setTimeout(() => {
      if (!target) fail("auth_timeout", "Terminal authentication timed out");
    }, authTimeoutMs);

    const authenticate = async (frame: Record<string, unknown>) => {
      const token = typeof frame.token === "string" ? frame.token.trim() : "";
      const grant = token ? manager.consumeAttachToken(token) : null;
      if (!grant) {
        fail("auth_failed", "Terminal authentication failed");
        return;
      }
      authenticating = true;
      const denial = await grantDenial(grant);
      if (closed) return;
      if (denial) {
        fail("forbidden", denial);
        return;
      }
      clearTimeout(authTimer);
      target = grant;
      if (pendingResize) {
        manager.resize(grant.companyId, grant.sessionId, pendingResize.cols, pendingResize.rows);
        pendingResize = null;
      }
      const attachment = manager.attach(grant.companyId, grant.sessionId, {
        send: (frame) => {
          send(frame);
          if (frame.type === "error" && frame.code === "session_exited") closeSocket(1000, "session_closed");
        },
      });
      if (!attachment) {
        fail("not_found", "Terminal session not found");
        return;
      }
      detach = attachment.detach;
      connection = { grant, revoke: (message) => fail("forbidden", message) };
      attached.add(connection);
      recordActivity({
        companyId: grant.companyId,
        actorType: "user",
        actorId: grant.userId ?? "unknown-user",
        action: "terminal.session_attached",
        entityType: "terminal_session",
        entityId: grant.sessionId,
        details: { kind: grant.kind },
      }).catch((err: unknown) => {
        logger.warn({ err, sessionId: grant.sessionId }, "terminal attach activity write failed");
        fail("auth_failed", "Terminal attach could not be recorded", 1011);
      });
    };

    socket.on("message", (raw) => {
      if (closed) return;
      if (!target) {
        if (rawByteLength(raw) > TERMINAL_PREAUTH_MAX_FRAME_BYTES) {
          fail("bad_frame", "Terminal frame is too large before authentication", 1009);
          return;
        }
        const frame = decodeFrame(raw);
        if (frame?.type === "auth") {
          if (!authenticating) void authenticate(frame);
          return;
        }
        if (frame?.type === "resize") {
          const dimensions = readDimensions(frame);
          if (dimensions) {
            pendingResize = dimensions;
            return;
          }
        }
        fail("bad_frame", "Only auth and resize frames are accepted before authentication");
        return;
      }
      const frame = decodeFrame(raw);
      if (!frame) {
        send({ type: "error", code: "bad_frame", message: "Terminal frames must be JSON objects" });
        return;
      }
      switch (frame.type) {
        case "input":
          if (typeof frame.data === "string") {
            manager.write(target.companyId, target.sessionId, frame.data);
          } else {
            send({ type: "error", code: "bad_frame", message: "Input frames need string data" });
          }
          return;
        case "resize": {
          const dimensions = readDimensions(frame);
          if (dimensions) manager.resize(target.companyId, target.sessionId, dimensions.cols, dimensions.rows);
          else send({ type: "error", code: "bad_frame", message: "Resize frames need numeric cols and rows" });
          return;
        }
        case "ping":
          send({ type: "pong" });
          return;
        case "auth":
          return;
        default:
          send({ type: "error", code: "bad_frame", message: "Unsupported terminal frame" });
      }
    });
    socket.on("close", cleanup);
    socket.on("error", cleanup);
  });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const request = req as IncomingMessageWithTerminal;
    if (request.paperclipWebSocketHandled || !request.url) return;
    let pathname: string;
    try {
      pathname = new URL(request.url, "http://localhost").pathname;
    } catch {
      return;
    }
    if (pathname !== TERMINAL_WEBSOCKET_PATH) return;
    request.paperclipWebSocketHandled = true;
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
    if (!terminalOriginAllowed({ origin, host: req.headers.host }, options.originPolicy)) {
      rejectUpgrade(socket, "403 Forbidden", "Terminal websocket origin is not allowed");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  server.on("close", () => {
    stopRecheck();
    for (const client of wss.clients) client.terminate();
    wss.close();
    manager.shutdown();
  });

  return wss;
}
