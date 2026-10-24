export const TERMINAL_WEBSOCKET_PATH = "/api/terminal/ws";

export const TERMINAL_AUTH_TIMEOUT_MS = 10_000;

export const TERMINAL_ATTACH_TOKEN_TTL_MS = 60_000;

export const TERMINAL_IDLE_KILL_MS = 24 * 60 * 60 * 1000;

export const TERMINAL_SCROLLBACK_BYTES = 2 * 1024 * 1024;

export const TERMINAL_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export const TERMINAL_MIN_COLS = 2;

export const TERMINAL_MAX_COLS = 1000;

export const TERMINAL_MIN_ROWS = 1;

export const TERMINAL_MAX_ROWS = 500;

export type TerminalSessionKind = "local" | "ssh";

export type TerminalSessionStatus = "running" | "exited";

export interface TerminalSession {
  id: string;
  companyId: string;
  kind: TerminalSessionKind;
  title: string;
  cwd: string | null;
  issueId: string | null;
  environmentId: string | null;
  status: TerminalSessionStatus;
  exitCode: number | null;
  cols: number;
  rows: number;
  attachedClients: number;
  createdAt: string;
  lastActivityAt: string;
  createdByUserId: string | null;
}

export interface CreateTerminalSessionRequest {
  kind: TerminalSessionKind;
  issueId?: string;
  environmentId?: string;
  cols?: number;
  rows?: number;
  title?: string;
}

export interface TerminalAttachToken {
  sessionId: string;
  token: string;
  expiresAt: string;
  websocketPath: string;
}

export interface TerminalUploadResult {
  path: string;
  bytes: number;
}

export type TerminalClientFrame =
  | { type: "auth"; token: string }
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "ping" };

export type TerminalServerFrame =
  | { type: "ready"; session: TerminalSession }
  | { type: "replay"; data: string }
  | { type: "output"; data: string }
  | { type: "exit"; exitCode: number | null; signal: string | null }
  | { type: "error"; code: TerminalErrorCode; message: string }
  | { type: "pong" };

export type TerminalErrorCode =
  | "auth_timeout"
  | "auth_failed"
  | "not_found"
  | "forbidden"
  | "bad_frame"
  | "spawn_failed"
  | "session_exited";

export const terminalApiPaths = {
  sessions: (companyId: string) => `/api/companies/${encodeURIComponent(companyId)}/terminal/sessions`,
  session: (companyId: string, sessionId: string) =>
    `/api/companies/${encodeURIComponent(companyId)}/terminal/sessions/${encodeURIComponent(sessionId)}`,
  token: (companyId: string, sessionId: string) =>
    `/api/companies/${encodeURIComponent(companyId)}/terminal/sessions/${encodeURIComponent(sessionId)}/token`,
  upload: (companyId: string, sessionId: string) =>
    `/api/companies/${encodeURIComponent(companyId)}/terminal/sessions/${encodeURIComponent(sessionId)}/upload`,
  download: (companyId: string, sessionId: string) =>
    `/api/companies/${encodeURIComponent(companyId)}/terminal/sessions/${encodeURIComponent(sessionId)}/download`,
} as const;

export const clampTerminalCols = (value: number): number =>
  Math.min(TERMINAL_MAX_COLS, Math.max(TERMINAL_MIN_COLS, Math.floor(value)));

export const clampTerminalRows = (value: number): number =>
  Math.min(TERMINAL_MAX_ROWS, Math.max(TERMINAL_MIN_ROWS, Math.floor(value)));
