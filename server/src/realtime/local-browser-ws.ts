import { createRequire } from "node:module";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { eq } from "drizzle-orm";
import type { Db } from "@tickernelz/paperclip-pro-db";
import { localBrowserConnections } from "@tickernelz/paperclip-pro-db";
import {
  LOCAL_BROWSER_PROTOCOL_VERSION,
  LOCAL_BROWSER_SCREENSHOT_MAX_BYTES,
  localBrowserBridgeFrameSchema,
  localBrowserExtensionEventFrameSchema,
  type LocalBrowserExtensionEventFrame,
  type LocalBrowserTab,
  type LocalBrowserViewerEvent,
} from "@tickernelz/paperclip-pro-shared";
import { logger } from "../middleware/logger.js";
import { localBrowserFailure } from "../services/local-browser/errors.js";
import {
  claimPairing,
  finalizePairing,
  releasePairingClaim,
  type PairingRecord,
} from "../services/local-browser/pairing.js";
import {
  findSessionByTokenHash,
  getSession,
  hashSessionToken,
  mintSessionToken,
  publishViewerPayload,
  registerSession,
  removeSession,
  takePendingCall,
  touchSession,
  updateSessionTabs,
} from "../services/local-browser/registry.js";
import { localBrowserService } from "../services/local-browser/service.js";
import type { BridgeSocket, LiveSession } from "../services/local-browser/types.js";

const require = createRequire(import.meta.url);
const { WebSocket, WebSocketServer } = require("ws") as {
  WebSocket: { OPEN: number };
  WebSocketServer: new (opts: { noServer: boolean }) => WsServer;
};

interface WsServer {
  clients: Set<BridgeSocket>;
  on(event: "connection", listener: (socket: BridgeSocket, req: IncomingMessage) => void): void;
  on(event: "close", listener: () => void): void;
  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    callback: (ws: BridgeSocket) => void,
  ): void;
  emit(event: "connection", ws: BridgeSocket, req: IncomingMessage): boolean;
  close(): void;
}

interface IncomingMessageWithBridge extends IncomingMessage {
  paperclipWebSocketHandled?: boolean;
}

export const LOCAL_BROWSER_BRIDGE_PATH = "/api/local-browser/bridge";
export const LOCAL_BROWSER_PING_INTERVAL_MS = 25_000;
export const LOCAL_BROWSER_SILENCE_LIMIT_MS = 75_000;
export const LOCAL_BROWSER_HELLO_TIMEOUT_MS = 15_000;

const MAX_VIEWER_DATA_URL_CHARS = Math.ceil((LOCAL_BROWSER_SCREENSHOT_MAX_BYTES * 4) / 3) + 256;

export function toViewerEvent(frame: LocalBrowserExtensionEventFrame): LocalBrowserViewerEvent | null {
  if (frame.event === "frame") {
    if (frame.data.dataUrl.length > MAX_VIEWER_DATA_URL_CHARS) return null;
    return { type: "frame", ...frame.data };
  }
  if (frame.event !== "state") return null;
  const { tabId, message } = frame.data;
  return {
    type: "state",
    state: frame.data.state,
    ...(tabId === undefined ? {} : { tabId }),
    ...(message === undefined ? {} : { message }),
  };
}

export function readExtensionEvent(frame: { event: string; data: unknown }): LocalBrowserExtensionEventFrame | null {
  const parsed = localBrowserExtensionEventFrameSchema.safeParse({
    type: "event",
    event: frame.event,
    data: frame.data,
  });
  return parsed.success ? parsed.data : null;
}

function isWritableUpgradeSocket(socket: Duplex) {
  const state = socket as Duplex & { writable?: boolean; writableEnded?: boolean; writableDestroyed?: boolean };
  return !socket.destroyed && state.writable !== false && !state.writableEnded && !state.writableDestroyed;
}

function rejectUpgrade(socket: Duplex, statusLine: string, message: string) {
  const safe = message.replace(/[\r\n]+/g, " ").trim();
  if (!isWritableUpgradeSocket(socket)) {
    if (!socket.destroyed) socket.destroy();
    return;
  }
  try {
    socket.once("finish", () => {
      if (!socket.destroyed) socket.destroy();
    });
    socket.end("HTTP/1.1 " + statusLine + "\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n" + safe);
  } catch {
    if (!socket.destroyed) socket.destroy();
  }
}

function sendFrame(socket: BridgeSocket, frame: unknown): boolean {
  if (socket.readyState !== WebSocket.OPEN) return false;
  try {
    socket.send(JSON.stringify(frame));
    return true;
  } catch {
    return false;
  }
}

function closeSocket(socket: BridgeSocket, code: number, reason: string) {
  try {
    socket.close(code, reason);
  } catch {
    socket.terminate();
  }
}

function readFrame(data: unknown) {
  const text = typeof data === "string" ? data : Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = localBrowserBridgeFrameSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

export type LocalBrowserWebSocketServer = WsServer & { closeAllSessions(): void };

export interface LocalBrowserWebSocketOptions {
  service?: ReturnType<typeof localBrowserService>;
  pingIntervalMs?: number;
  silenceLimitMs?: number;
  helloTimeoutMs?: number;
}

export function setupLocalBrowserWebSocketServer(
  server: HttpServer,
  db: Db,
  options: LocalBrowserWebSocketOptions = {},
) {
  const service = options.service ?? localBrowserService(db);
  const pingIntervalMs = options.pingIntervalMs ?? LOCAL_BROWSER_PING_INTERVAL_MS;
  const silenceLimitMs = options.silenceLimitMs ?? LOCAL_BROWSER_SILENCE_LIMIT_MS;
  const helloTimeoutMs = options.helloTimeoutMs ?? LOCAL_BROWSER_HELLO_TIMEOUT_MS;
  const wss = new WebSocketServer({ noServer: true });
  const socketBySession = new Map<string, BridgeSocket>();
  const sessionBySocket = new Map<BridgeSocket, string>();
  const pairingByRequest = new WeakMap<IncomingMessage, PairingRecord>();

  const closeConnectionRow = (connectionId: string, status: string, extra: Record<string, unknown> = {}) =>
    db
      .update(localBrowserConnections)
      .set({ status, lastSeenAt: new Date(), updatedAt: new Date(), ...extra })
      .where(eq(localBrowserConnections.id, connectionId))
      .catch((error: unknown) => {
        logger.warn({ err: error, connectionId }, "local browser connection row could not be closed");
      });

  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const [sessionId, socket] of socketBySession) {
      const session = getSession(sessionId);
      if (!session) {
        socketBySession.delete(sessionId);
        sessionBySocket.delete(socket);
        closeSocket(socket, 1001, "session gone");
        continue;
      }
      if (now - session.lastSeenAt.getTime() > silenceLimitMs) {
        logger.warn({ sessionId }, "local browser bridge silent past the limit, terminating");
        socketBySession.delete(sessionId);
        sessionBySocket.delete(socket);
        void closeConnectionRow(session.connectionId, "closed", { closedAt: new Date() });
        removeSession(sessionId, "terminated");
        socket.terminate();
        continue;
      }
      sendFrame(socket, { type: "ping", at: new Date(now).toISOString() });
    }
  }, pingIntervalMs);
  heartbeat.unref?.();

  wss.on("close", () => {
    clearInterval(heartbeat);
    socketBySession.clear();
  });

  const closeAllSessions = () => {
    clearInterval(heartbeat);
    for (const [sessionId, socket] of socketBySession) {
      const connectionId = getSession(sessionId)?.connectionId ?? null;
      if (connectionId) void closeConnectionRow(connectionId, "closed", { closedAt: new Date() });
      removeSession(sessionId, "server_shutdown");
      socket.terminate();
    }
    socketBySession.clear();
    sessionBySocket.clear();
  };
  (wss as LocalBrowserWebSocketServer).closeAllSessions = closeAllSessions;

  if (typeof server.on !== "function") return wss as LocalBrowserWebSocketServer;

  server.on("close", () => {
    closeAllSessions();
    wss.close();
  });

  async function startSession(
    socket: BridgeSocket,
    url: URL,
    hello: Extract<ReturnType<typeof readFrame>, { type: "hello" }>,
    pairing: PairingRecord | null,
  ): Promise<boolean> {
    const token = url.searchParams.get("session");
    if (hello.protocol !== LOCAL_BROWSER_PROTOCOL_VERSION) {
      sendFrame(socket, {
        type: "result",
        id: "hello",
        ok: false,
        error: localBrowserFailure(
          "local_browser_protocol_error",
          "The extension speaks protocol " + hello.protocol + ", this server speaks " + LOCAL_BROWSER_PROTOCOL_VERSION,
        ).toToolError(),
      });
      closeSocket(socket, 1008, "protocol mismatch");
      return false;
    }

    let companyId: string;
    let connectionId: string;
    let createdByUserId: string | null;
    let createdByAgentId: string | null;
    let sessionToken: string;
    let tokenHash: string;
    let settings: Awaited<ReturnType<typeof service.getSettings>> | null = null;

    if (pairing) {
      companyId = pairing.companyId;
      createdByUserId = pairing.createdByUserId;
      createdByAgentId = pairing.createdByAgentId;
      sessionToken = mintSessionToken();
      tokenHash = hashSessionToken(sessionToken);
      settings = await service.getSettings(companyId);
      const label = (hello.label || pairing.label || "Paired browser").slice(0, 80);
      const [row] = await db
        .insert(localBrowserConnections)
        .values({
          companyId,
          createdByUserId,
          createdByAgentId,
          label,
          client: hello.client,
          clientVersion: hello.clientVersion.slice(0, 40),
          profileName: hello.profileName,
          tier: settings.tier,
          allowedOrigins: settings.allowedOrigins,
          tokenHash,
          status: "active",
        })
        .returning({ id: localBrowserConnections.id });
      if (!row) {
        closeSocket(socket, 1011, "connection could not be created");
        return false;
      }
      connectionId = row.id;
    } else if (token) {
      tokenHash = hashSessionToken(token);
      const [row] = await db
        .select({
          id: localBrowserConnections.id,
          companyId: localBrowserConnections.companyId,
          createdByUserId: localBrowserConnections.createdByUserId,
          createdByAgentId: localBrowserConnections.createdByAgentId,
          closedAt: localBrowserConnections.closedAt,
        })
        .from(localBrowserConnections)
        .where(eq(localBrowserConnections.tokenHash, tokenHash))
        .limit(1);
      if (!row || row.closedAt) {
        closeSocket(socket, 1008, "session token is not usable");
        return false;
      }
      companyId = row.companyId;
      connectionId = row.id;
      createdByUserId = row.createdByUserId;
      createdByAgentId = row.createdByAgentId;
      sessionToken = token;
      const stale = findSessionByTokenHash(tokenHash);
      if (stale) {
        socketBySession.delete(stale.sessionId);
        sessionBySocket.delete(stale.socket);
        removeSession(stale.sessionId, "disconnected");
      }
    } else {
      closeSocket(socket, 1008, "pairing code or session token required");
      return false;
    }

    settings ??= await service.getSettings(companyId);
    const session = registerSession({
      socket,
      companyId,
      connectionId,
      createdByUserId,
      createdByAgentId,
      client: hello.client,
      clientVersion: hello.clientVersion.slice(0, 40),
      label: (hello.label || "Paired browser").slice(0, 80),
      profileName: hello.profileName,
      tabs: hello.tabs as LocalBrowserTab[],
      tier: settings.tier,
      allowedOrigins: settings.allowedOrigins,
      tokenHash,
    });
    socketBySession.set(session.sessionId, socket);
    sessionBySocket.set(socket, session.sessionId);
    if (pairing && !finalizePairing(pairing.code, session.sessionId)) {
      socketBySession.delete(session.sessionId);
      sessionBySocket.delete(socket);
      removeSession(session.sessionId, "disconnected");
      void closeConnectionRow(connectionId, "closed", { closedAt: new Date() });
      closeSocket(socket, 1008, "pairing code was already used");
      return false;
    }
    await db
      .update(localBrowserConnections)
      .set({
        status: "active",
        client: hello.client,
        clientVersion: hello.clientVersion.slice(0, 40),
        profileName: hello.profileName,
        label: (hello.label || "Paired browser").slice(0, 80),
        tier: settings.tier,
        allowedOrigins: settings.allowedOrigins,
        connectedAt: new Date(),
        lastSeenAt: new Date(),
        updatedAt: new Date(),
        closedAt: null,
      })
      .where(eq(localBrowserConnections.id, connectionId));
    sendFrame(socket, {
      type: "hello_ack",
      sessionId: session.sessionId,
      sessionToken,
      tier: session.tier,
      allowedOrigins: session.allowedOrigins,
    });
    return true;
  }

  function attachSession(socket: BridgeSocket, url: URL, pairing: PairingRecord | null) {
    let settled = false;
    let finalized = false;
    const releaseUnusedClaim = () => {
      if (pairing && !finalized) releasePairingClaim(pairing.code);
    };
    const helloTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      closeSocket(socket, 1008, "hello timeout");
    }, helloTimeoutMs);
    helloTimer.unref?.();

    socket.on("message", (data: unknown) => {
      const frame = readFrame(data);
      if (!frame) return;
      if (frame.type === "hello") {
        if (settled) return;
        settled = true;
        clearTimeout(helloTimer);
        void startSession(socket, url, frame, pairing)
          .then((done) => {
            finalized = done;
            releaseUnusedClaim();
          })
          .catch((error) => {
            logger.warn({ err: error }, "local browser bridge handshake failed");
            releaseUnusedClaim();
            closeSocket(socket, 1011, "handshake failed");
          });
        return;
      }
      const sessionId = sessionBySocket.get(socket);
      const live = sessionId ? getSession(sessionId) : null;
      if (!live) return;
      touchSession(live);
      if (frame.type === "result") {
        const call = takePendingCall(live, frame.id);
        if (!call) return;
        if (frame.ok) {
          call.resolve(frame.result ?? null);
          return;
        }
        const error = frame.error;
        call.reject(
          localBrowserFailure(
            error?.code ?? "local_browser_protocol_error",
            error?.message ?? "The extension could not complete the call",
            {
              retryable: error?.retryable ?? false,
              ...(error?.hint ? { hint: error.hint } : {}),
              status: undefined,
            },
          ),
        );
        return;
      }
      if (frame.type === "event") {
        const extensionEvent = readExtensionEvent(frame);
        if (!extensionEvent) return;
        if (extensionEvent.event === "tabs") {
          updateSessionTabs(live, extensionEvent.data.tabs);
          return;
        }
        const viewerEvent = toViewerEvent(extensionEvent);
        if (viewerEvent) publishViewerPayload(live, viewerEvent);
      }
    });

    socket.on("close", () => {
      clearTimeout(helloTimer);
      releaseUnusedClaim();
      const sessionId = sessionBySocket.get(socket);
      sessionBySocket.delete(socket);
      if (!sessionId) return;
      const session = getSession(sessionId);
      socketBySession.delete(sessionId);
      const connectionId = session?.connectionId ?? null;
      removeSession(sessionId, "disconnected");
      if (!connectionId) return;
      void db
        .update(localBrowserConnections)
        .set({ status: "disconnected", lastSeenAt: new Date(), updatedAt: new Date() })
        .where(eq(localBrowserConnections.id, connectionId))
        .catch(() => {});
    });

    socket.on("error", (error: Error) => {
      logger.warn({ err: error }, "local browser bridge socket error");
    });
  }

  wss.on("connection", (socket: BridgeSocket, req: IncomingMessage) => {
    const request = req as IncomingMessageWithBridge;
    if (!request.url) {
      closeSocket(socket, 1008, "missing url");
      return;
    }
    const url = new URL(request.url, "http://localhost");
    attachSession(socket, url, pairingByRequest.get(request) ?? null);
    pairingByRequest.delete(request);
  });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const request = req as IncomingMessageWithBridge;
    if (request.paperclipWebSocketHandled || !request.url) return;
    const url = new URL(request.url, "http://localhost");
    if (url.pathname !== LOCAL_BROWSER_BRIDGE_PATH) return;
    request.paperclipWebSocketHandled = true;

    const code = url.searchParams.get("code");
    const token = url.searchParams.get("session");
    if (!code && !token) {
      rejectUpgrade(socket, "400 Bad Request", "pairing code or session token required");
      return;
    }
    if (code) {
      const claimed = claimPairing(code);
      if (!claimed) {
        rejectUpgrade(socket, "403 Forbidden", "pairing code is unknown, expired or already used");
        return;
      }
      pairingByRequest.set(req, claimed);
    }
    wss.handleUpgrade(req, socket, head, (ws: BridgeSocket) => {
      wss.emit("connection", ws, request);
    });
  });

  return wss as LocalBrowserWebSocketServer;
}

export const localBrowserWebSocketInternals = {
  readFrame,
  readExtensionEvent,
  toViewerEvent,
  sendFrame,
  closeSocket,
  rejectUpgrade,
  isWritableUpgradeSocket,
};
