import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  TERMINAL_ATTACH_TOKEN_TTL_MS,
  TERMINAL_IDLE_KILL_MS,
  TERMINAL_SCROLLBACK_ROWS,
  clampTerminalCols,
  clampTerminalRows,
  type TerminalServerFrame,
  type TerminalSession,
  type TerminalSessionKind,
} from "@tickernelz/paperclip-pro-shared";
import { conflict } from "../../errors.js";
import { logger } from "../../middleware/logger.js";
import type { TerminalFileAccess } from "./files.js";
import type { TerminalExit, TerminalProcess } from "./process.js";
import { TerminalScreen } from "./screen.js";

export const TERMINAL_MAX_SESSIONS_PER_USER = 16;
export const TERMINAL_MAX_SESSIONS_PER_COMPANY = 64;

const TERMINAL_OUTPUT_DRAIN_BYTES = 256 * 1024;

export interface TerminalClock {
  now(): number;
}

export interface TerminalClient {
  send(frame: TerminalServerFrame): void;
}

export interface TerminalSessionManagerOptions {
  clock?: TerminalClock;
  idleKillMs?: number;
  scrollbackRows?: number;
  tokenTtlMs?: number;
  reapIntervalMs?: number;
  maxSessionsPerUser?: number;
  maxSessionsPerCompany?: number;
}

export interface RegisterTerminalSessionInput {
  companyId: string;
  kind: TerminalSessionKind;
  title: string;
  cwd: string | null;
  issueId: string | null;
  environmentId: string | null;
  sshHost?: string | null;
  cols: number;
  rows: number;
  createdByUserId: string | null;
  process: TerminalProcess;
  files: TerminalFileAccess;
}

export interface TerminalTokenHolder {
  userId: string | null;
  actorSource: string;
  authSessionId: string | null;
}

export interface TerminalAttachTokenGrant extends TerminalTokenHolder {
  sessionId: string;
  companyId: string;
  kind: TerminalSessionKind;
}

interface ManagedTerminalSession {
  id: string;
  companyId: string;
  kind: TerminalSessionKind;
  title: string;
  cwd: string | null;
  issueId: string | null;
  environmentId: string | null;
  sshHost: string | null;
  createdByUserId: string | null;
  cols: number;
  rows: number;
  status: "running" | "exited";
  exit: TerminalExit | null;
  closing: boolean;
  processExited: boolean;
  createdAt: number;
  lastActivityAt: number;
  idleSince: number | null;
  clients: Map<TerminalClient, ManagedTerminalClient>;
  screen: TerminalScreen;
  queue: Promise<void>;
  pending: string;
  draining: boolean;
  exitBroadcast: boolean;
  process: TerminalProcess;
  files: TerminalFileAccess;
}

interface ManagedTerminalClient {
  synced: boolean;
}

interface StoredAttachToken extends TerminalAttachTokenGrant {
  expiresAt: number;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const systemClock: TerminalClock = { now: () => Date.now() };

export class TerminalSessionManager {
  private readonly sessions = new Map<string, ManagedTerminalSession>();
  private readonly tokens = new Map<string, StoredAttachToken>();
  private readonly clock: TerminalClock;
  private readonly idleKillMs: number;
  private readonly scrollbackRows: number;
  private readonly tokenTtlMs: number;
  private readonly reapIntervalMs: number;
  private readonly maxSessionsPerUser: number;
  private readonly maxSessionsPerCompany: number;
  private reapTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: TerminalSessionManagerOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.idleKillMs = options.idleKillMs ?? TERMINAL_IDLE_KILL_MS;
    this.scrollbackRows = options.scrollbackRows ?? TERMINAL_SCROLLBACK_ROWS;
    this.tokenTtlMs = options.tokenTtlMs ?? TERMINAL_ATTACH_TOKEN_TTL_MS;
    this.reapIntervalMs = options.reapIntervalMs ?? 60_000;
    this.maxSessionsPerUser = options.maxSessionsPerUser ?? TERMINAL_MAX_SESSIONS_PER_USER;
    this.maxSessionsPerCompany = options.maxSessionsPerCompany ?? TERMINAL_MAX_SESSIONS_PER_COMPANY;
  }

  private ensureReaper() {
    if (this.reapTimer || this.reapIntervalMs <= 0) return;
    this.reapTimer = setInterval(() => this.reapIdle(), this.reapIntervalMs);
    this.reapTimer.unref?.();
  }

  private stopReaperWhenEmpty() {
    if (this.sessions.size > 0 || !this.reapTimer) return;
    clearInterval(this.reapTimer);
    this.reapTimer = null;
  }

  private snapshot(session: ManagedTerminalSession): TerminalSession {
    return {
      id: session.id,
      companyId: session.companyId,
      kind: session.kind,
      title: session.title,
      cwd: session.cwd,
      issueId: session.issueId,
      environmentId: session.environmentId,
      status: session.status,
      exitCode: session.exit?.exitCode ?? null,
      cols: session.cols,
      rows: session.rows,
      attachedClients: session.clients.size,
      createdAt: new Date(session.createdAt).toISOString(),
      lastActivityAt: new Date(session.lastActivityAt).toISOString(),
      createdByUserId: session.createdByUserId,
      sshHost: session.sshHost,
    };
  }

  private broadcast(session: ManagedTerminalSession, frame: TerminalServerFrame) {
    for (const [client, state] of [...session.clients]) {
      if (!state.synced) continue;
      try {
        client.send(frame);
      } catch {
        session.clients.delete(client);
      }
    }
  }

  private broadcastAll(session: ManagedTerminalSession, frame: TerminalServerFrame) {
    for (const client of [...session.clients.keys()]) {
      try {
        client.send(frame);
      } catch {
        session.clients.delete(client);
      }
    }
  }

  private enqueue(session: ManagedTerminalSession, task: () => void | Promise<void>) {
    session.queue = session.queue.then(task).catch((err: unknown) => {
      logger.warn({ err, terminalSessionId: session.id }, "terminal session task failed");
    });
  }

  private queueOutput(session: ManagedTerminalSession, data: string) {
    if (data) session.pending += data;
    if (session.draining) return;
    session.draining = true;
    this.enqueue(session, () => this.drainOutput(session));
  }

  private async flushOutput(session: ManagedTerminalSession, budget: number) {
    let remaining = budget;
    while (session.pending) {
      const data = session.pending;
      session.pending = "";
      remaining -= data.length;
      await session.screen.write(data);
      this.broadcast(session, { type: "output", data });
      if (remaining <= 0) return;
    }
  }

  private async drainOutput(session: ManagedTerminalSession) {
    try {
      await this.flushOutput(session, TERMINAL_OUTPUT_DRAIN_BYTES);
    } finally {
      session.draining = false;
      if (session.pending) this.queueOutput(session, "");
    }
  }

  private isLive(session: ManagedTerminalSession): boolean {
    return session.status === "running" && !session.closing;
  }

  capacityDenial(companyId: string, userId: string | null): string | null {
    const live = [...this.sessions.values()].filter((session) => this.isLive(session));
    if (live.filter((session) => session.companyId === companyId).length >= this.maxSessionsPerCompany) {
      return `This company already has ${this.maxSessionsPerCompany} open terminal sessions; close one before opening another`;
    }
    if (userId && live.filter((session) => session.createdByUserId === userId).length >= this.maxSessionsPerUser) {
      return `You already have ${this.maxSessionsPerUser} open terminal sessions; close one before opening another`;
    }
    return null;
  }

  register(input: RegisterTerminalSessionInput): TerminalSession {
    const denial = this.capacityDenial(input.companyId, input.createdByUserId);
    if (denial) {
      input.process.kill();
      throw conflict(denial);
    }
    const now = this.clock.now();
    const cols = clampTerminalCols(input.cols);
    const rows = clampTerminalRows(input.rows);
    const session: ManagedTerminalSession = {
      id: randomUUID(),
      companyId: input.companyId,
      kind: input.kind,
      title: input.title,
      cwd: input.cwd,
      issueId: input.issueId,
      environmentId: input.environmentId,
      sshHost: input.sshHost ?? null,
      createdByUserId: input.createdByUserId,
      cols,
      rows,
      status: "running",
      exit: null,
      closing: false,
      processExited: false,
      createdAt: now,
      lastActivityAt: now,
      idleSince: now,
      clients: new Map(),
      screen: new TerminalScreen(cols, rows, this.scrollbackRows),
      queue: Promise.resolve(),
      pending: "",
      draining: false,
      exitBroadcast: false,
      process: input.process,
      files: input.files,
    };
    input.process.onData((data) => {
      session.lastActivityAt = this.clock.now();
      this.queueOutput(session, data);
    });
    input.process.onExit((exit) => {
      session.processExited = true;
      if (session.status !== "exited") {
        session.status = "exited";
        session.exit = exit;
        session.lastActivityAt = this.clock.now();
        this.enqueue(session, async () => {
          await this.flushOutput(session, Number.POSITIVE_INFINITY);
          session.exitBroadcast = true;
          this.broadcast(session, { type: "exit", exitCode: exit.exitCode, signal: exit.signal });
        });
      }
      if (session.closing) this.forget(session);
    });
    this.sessions.set(session.id, session);
    this.ensureReaper();
    return this.snapshot(session);
  }

  private find(companyId: string, sessionId: string): ManagedTerminalSession | null {
    const session = this.sessions.get(sessionId);
    return session && session.companyId === companyId ? session : null;
  }

  private findOpen(companyId: string, sessionId: string): ManagedTerminalSession | null {
    const session = this.find(companyId, sessionId);
    return session && !session.closing ? session : null;
  }

  list(companyId: string): TerminalSession[] {
    return [...this.sessions.values()]
      .filter((session) => session.companyId === companyId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((session) => this.snapshot(session));
  }

  get(companyId: string, sessionId: string): TerminalSession | null {
    const session = this.find(companyId, sessionId);
    return session ? this.snapshot(session) : null;
  }

  files(companyId: string, sessionId: string): TerminalFileAccess | null {
    return this.findOpen(companyId, sessionId)?.files ?? null;
  }

  kill(companyId: string, sessionId: string): TerminalSession | null {
    const session = this.findOpen(companyId, sessionId);
    if (!session) return null;
    this.destroy(session, "session_closed");
    return this.snapshot(session);
  }

  private forget(session: ManagedTerminalSession) {
    if (this.sessions.get(session.id) === session) this.sessions.delete(session.id);
    session.screen.dispose();
    this.stopReaperWhenEmpty();
  }

  private destroy(session: ManagedTerminalSession, reason: string) {
    session.closing = true;
    for (const [hash, token] of this.tokens) {
      if (token.sessionId === session.id) this.tokens.delete(hash);
    }
    if (session.status === "running") {
      session.status = "exited";
      session.exit = { exitCode: null, signal: null };
      session.exitBroadcast = true;
      this.broadcastAll(session, { type: "exit", exitCode: null, signal: null });
    }
    this.broadcastAll(session, { type: "error", code: "session_exited", message: `Terminal session closed: ${reason}` });
    session.clients.clear();
    session.process.kill();
    if (session.processExited) this.forget(session);
  }

  mintAttachToken(
    companyId: string,
    sessionId: string,
    holder: TerminalTokenHolder,
  ): { token: string; expiresAt: Date } | null {
    const session = this.findOpen(companyId, sessionId);
    if (!session) return null;
    this.purgeExpiredTokens();
    const token = randomBytes(32).toString("base64url");
    const expiresAt = this.clock.now() + this.tokenTtlMs;
    this.tokens.set(hashToken(token), {
      sessionId,
      companyId,
      kind: session.kind,
      userId: holder.userId,
      actorSource: holder.actorSource,
      authSessionId: holder.authSessionId,
      expiresAt,
    });
    return { token, expiresAt: new Date(expiresAt) };
  }

  consumeAttachToken(token: string): TerminalAttachTokenGrant | null {
    const hash = hashToken(token);
    const stored = this.tokens.get(hash);
    if (!stored) return null;
    this.tokens.delete(hash);
    if (stored.expiresAt <= this.clock.now()) return null;
    if (!this.findOpen(stored.companyId, stored.sessionId)) return null;
    return {
      sessionId: stored.sessionId,
      companyId: stored.companyId,
      kind: stored.kind,
      userId: stored.userId,
      actorSource: stored.actorSource,
      authSessionId: stored.authSessionId,
    };
  }

  private purgeExpiredTokens() {
    const now = this.clock.now();
    for (const [hash, token] of this.tokens) {
      if (token.expiresAt <= now) this.tokens.delete(hash);
    }
  }

  attach(companyId: string, sessionId: string, client: TerminalClient): { session: TerminalSession; detach: () => void } | null {
    const session = this.findOpen(companyId, sessionId);
    if (!session) return null;
    const state: ManagedTerminalClient = { synced: false };
    session.clients.set(client, state);
    session.idleSince = null;
    const snapshot = this.snapshot(session);
    client.send({ type: "ready", session: snapshot });
    this.enqueue(session, () => this.replay(session, client, state));
    let attached = true;
    return {
      session: snapshot,
      detach: () => {
        if (!attached) return;
        attached = false;
        session.clients.delete(client);
        if (session.clients.size === 0) session.idleSince = this.clock.now();
      },
    };
  }

  private replay(session: ManagedTerminalSession, client: TerminalClient, state: ManagedTerminalClient) {
    if (session.clients.get(client) !== state) return;
    state.synced = true;
    try {
      client.send({ type: "replay", data: session.screen.serialize() });
      if (session.exitBroadcast) {
        client.send({ type: "exit", exitCode: session.exit?.exitCode ?? null, signal: session.exit?.signal ?? null });
      }
    } catch {
      session.clients.delete(client);
    }
  }

  write(companyId: string, sessionId: string, data: string): boolean {
    const session = this.findOpen(companyId, sessionId);
    if (!session || session.status !== "running") return false;
    session.lastActivityAt = this.clock.now();
    session.process.write(data);
    return true;
  }

  resize(companyId: string, sessionId: string, cols: number, rows: number): boolean {
    const session = this.findOpen(companyId, sessionId);
    if (!session || session.status !== "running") return false;
    session.cols = clampTerminalCols(cols);
    session.rows = clampTerminalRows(rows);
    session.process.resize(session.cols, session.rows);
    this.enqueue(session, () => session.screen.resize(session.cols, session.rows));
    return true;
  }

  reapIdle(): string[] {
    const now = this.clock.now();
    const reaped: string[] = [];
    for (const session of [...this.sessions.values()]) {
      if (session.closing || session.clients.size > 0 || session.idleSince === null) continue;
      if (now - session.idleSince < this.idleKillMs) continue;
      reaped.push(session.id);
      this.destroy(session, "idle_timeout");
    }
    this.purgeExpiredTokens();
    return reaped;
  }

  shutdown(): void {
    for (const session of [...this.sessions.values()]) {
      if (!session.closing) this.destroy(session, "server_shutdown");
    }
    this.tokens.clear();
  }
}

export const terminalSessionManager = new TerminalSessionManager();
