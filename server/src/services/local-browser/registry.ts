import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  LOCAL_BROWSER_LIMIT_DEFAULTS,
  type LocalBrowserAccess,
  type LocalBrowserGuards,
  type LocalBrowserSession,
  type LocalBrowserSettings,
  type LocalBrowserTab,
  type LocalBrowserTier,
} from "@tickernelz/paperclip-pro-shared";
import { closeActivity, reconcileActivityWithTabs } from "./activity.js";
import { localBrowserFailure } from "./errors.js";
import type { BridgeSocket, LiveSession, PendingCall, ViewerListener, ViewerPayload } from "./types.js";

const sessions = new Map<string, LiveSession>();
const sessionIdByTokenHash = new Map<string, string>();

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function mintSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function registerSession(input: {
  socket: BridgeSocket;
  companyId: string;
  connectionId: string;
  createdByUserId: string | null;
  createdByAgentId: string | null;
  client: LiveSession["client"];
  clientVersion: string;
  capabilities?: string[];
  label: string;
  profileName: string | null;
  tabs: LocalBrowserTab[];
  tier: LocalBrowserTier;
  allowedOrigins: string[];
  limits?: LocalBrowserSettings["limits"];
  access?: LocalBrowserAccess | null;
  guards?: LocalBrowserGuards | null;
  tokenHash: string;
  sessionId?: string;
  now?: Date;
}): LiveSession {
  const now = input.now ?? new Date();
  const sessionId = input.sessionId ?? randomUUID();
  const session: LiveSession = {
    sessionId,
    connectionId: input.connectionId,
    companyId: input.companyId,
    createdByUserId: input.createdByUserId,
    createdByAgentId: input.createdByAgentId,
    socket: input.socket,
    client: input.client,
    clientVersion: input.clientVersion,
    capabilities: input.capabilities ?? [],
    label: input.label,
    profileName: input.profileName,
    tabs: input.tabs,
    tier: input.tier,
    allowedOrigins: input.allowedOrigins,
    limits: input.limits ?? { ...LOCAL_BROWSER_LIMIT_DEFAULTS },
    access: input.access ?? null,
    guards: input.guards ?? null,
    connectedAt: now,
    lastSeenAt: now,
    pending: new Map(),
    viewers: new Set(),
    activity: null,
    operatingCalls: 0,
  };
  sessions.set(sessionId, session);
  sessionIdByTokenHash.set(input.tokenHash, sessionId);
  return session;
}

export function getSession(sessionId: string): LiveSession | null {
  return sessions.get(sessionId) ?? null;
}

export function findSessionByTokenHash(tokenHash: string): LiveSession | null {
  const sessionId = sessionIdByTokenHash.get(tokenHash);
  if (!sessionId) return null;
  return sessions.get(sessionId) ?? null;
}

export function liveSessionsForCompany(companyId: string): LiveSession[] {
  return [...sessions.values()]
    .filter((session) => session.companyId === companyId)
    .sort((left, right) => left.connectedAt.getTime() - right.connectedAt.getTime());
}

export function liveSessionsForAgent(companyId: string, agentId: string): LiveSession[] {
  return liveSessionsForCompany(companyId).filter((session) => session.createdByAgentId === agentId);
}

export function touchSession(session: LiveSession, now = new Date()): void {
  session.lastSeenAt = now;
}

export function updateSessionTabs(session: LiveSession, tabs: LocalBrowserTab[]): void {
  session.tabs = tabs;
  reconcileActivityWithTabs(session);
}

export function updateSessionSettings(session: LiveSession, settings: LocalBrowserSettings): void {
  session.tier = settings.tier;
  session.allowedOrigins = settings.allowedOrigins;
  session.limits = settings.limits;
}

export function updateSessionAccess(session: LiveSession, access: LocalBrowserAccess): void {
  session.access = access;
}

export function updateSessionGuards(session: LiveSession, guards: LocalBrowserGuards): void {
  session.guards = guards;
}

export function nextCallId(): string {
  return randomUUID();
}

export function addPendingCall(session: LiveSession, call: PendingCall): void {
  session.pending.set(call.id, call);
}

export function takePendingCall(session: LiveSession, id: string): PendingCall | null {
  const call = session.pending.get(id);
  if (!call) return null;
  session.pending.delete(id);
  clearTimeout(call.timer);
  return call;
}

export function failPendingCalls(session: LiveSession, error: unknown): void {
  for (const call of [...session.pending.values()]) {
    session.pending.delete(call.id);
    clearTimeout(call.timer);
    call.reject(error);
  }
}

export function removeSession(sessionId: string, reason: "closed" | "disconnected" | "terminated" | "server_shutdown"): LiveSession | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  sessions.delete(sessionId);
  for (const [tokenHash, mapped] of sessionIdByTokenHash) {
    if (mapped === sessionId) sessionIdByTokenHash.delete(tokenHash);
  }
  failPendingCalls(
    session,
    localBrowserFailure(
      "local_browser_extension_unavailable",
      reason === "closed"
        ? "The paired browser was closed"
        : "The browser extension disconnected",
      {
        retryable: true,
        hint: "Reconnect the browser extension, then call local_browser_sessions to confirm it is live.",
      },
    ),
  );
  for (const listener of [...session.viewers]) {
    listener({ type: "state", state: "disconnected", message: reason === "closed" ? "Browser session closed" : "Browser disconnected" });
  }
  session.viewers.clear();
  closeActivity(session);
  return session;
}

export function subscribeViewer(session: LiveSession, listener: ViewerListener): () => void {
  session.viewers.add(listener);
  return () => {
    session.viewers.delete(listener);
  };
}

export function publishViewerPayload(session: LiveSession, payload: ViewerPayload): void {
  for (const listener of [...session.viewers]) {
    try {
      listener(payload);
    } catch {
      session.viewers.delete(listener);
    }
  }
}

export function viewerCount(session: LiveSession): number {
  return session.viewers.size;
}

export function toPublicSession(session: LiveSession): LocalBrowserSession {
  const view: LocalBrowserSession = {
    sessionId: session.sessionId,
    connectionId: session.connectionId,
    client: session.client,
    clientVersion: session.clientVersion,
    label: session.label,
    profileName: session.profileName,
    ownerUserId: session.createdByUserId,
    tier: session.tier,
    connectedAt: session.connectedAt.toISOString(),
    lastSeenAt: session.lastSeenAt.toISOString(),
    tabs: session.tabs,
    controlledByViewer: session.viewers.size > 0,
    agentActivity: session.activity,
    capabilities: [...session.capabilities],
    ...(session.access ? { access: session.access } : {}),
    ...(session.guards ? { guards: session.guards } : {}),
  };
  return view;
}

export function resetSessions(): void {
  for (const session of [...sessions.values()]) {
    failPendingCalls(session, localBrowserFailure("local_browser_extension_unavailable", "Server restarted", { retryable: true }));
  }
  sessions.clear();
  sessionIdByTokenHash.clear();
}
