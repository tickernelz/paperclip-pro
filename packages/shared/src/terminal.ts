export const TERMINAL_WEBSOCKET_PATH = "/api/terminal/ws";

export const TERMINAL_AUTH_TIMEOUT_MS = 10_000;

export const TERMINAL_ATTACH_TOKEN_TTL_MS = 60_000;

export const TERMINAL_IDLE_KILL_MS = 24 * 60 * 60 * 1000;

export const TERMINAL_SCROLLBACK_ROWS = 2_000;

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
  sshHost: string | null;
}

export interface CreateTerminalSessionRequest {
  kind: TerminalSessionKind;
  issueId?: string;
  environmentId?: string;
  sshHostId?: string;
  cols?: number;
  rows?: number;
  title?: string;
}

export type TerminalSshHostSource = "config" | "saved";

export interface SshConfigHostSettings {
  alias: string;
  hostName: string;
  user: string | null;
  port: number | null;
  identityFile: string | null;
  proxyJump: string | null;
  serverAliveInterval: number | null;
  serverAliveCountMax: number | null;
}

export interface TerminalSshHost {
  id: string;
  source: TerminalSshHostSource;
  name: string;
  destination: string;
  port: number | null;
  managed?: boolean;
  settings?: SshConfigHostSettings | null;
}

export interface SshKeyInfo {
  name: string;
  path: string;
  type: string | null;
  fingerprint: string | null;
  comment: string | null;
  encrypted: boolean | null;
  publicKey: string | null;
}

export interface SshKeyList {
  keys: SshKeyInfo[];
  sshDir: string;
}

export type CreateSshKeyRequest =
  | { mode: "generate"; name: string; comment?: string }
  | { mode: "import"; name: string; privateKey: string };

export type SshConnectionTarget = { alias: string } | { host: SshConfigHostSettings };

export type SshConnectionTestStatus =
  | "ok"
  | "host_key_unknown"
  | "host_key_changed"
  | "auth_failed"
  | "dns_failed"
  | "unreachable"
  | "timeout"
  | "key_unusable"
  | "failed";

export interface SshHostKey {
  type: string;
  fingerprint: string;
}

export interface SshConnectionTestResult {
  status: SshConnectionTestStatus;
  message: string;
  detail: string | null;
  hostKeys: SshHostKey[];
  durationMs: number;
}

export interface TrustSshHostKeyRequest {
  target: SshConnectionTarget;
  fingerprints: string[];
}

export interface TrustSshHostKeyResult {
  added: SshHostKey[];
  knownHostsPath: string;
}

export interface TerminalSshHostList {
  hosts: TerminalSshHost[];
  configPath: string;
  configError: string | null;
}

export interface CreateTerminalSshHostRequest {
  name: string;
  destination: string;
  port?: number;
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
  pasteImage: (companyId: string, sessionId: string) =>
    `/api/companies/${encodeURIComponent(companyId)}/terminal/sessions/${encodeURIComponent(sessionId)}/paste-image`,
  sshHosts: (companyId: string) => `/api/companies/${encodeURIComponent(companyId)}/terminal/ssh-hosts`,
  sshHost: (companyId: string, hostId: string) =>
    `/api/companies/${encodeURIComponent(companyId)}/terminal/ssh-hosts/${encodeURIComponent(hostId)}`,
  moveSshHostToConfig: (companyId: string, hostId: string) =>
    `/api/companies/${encodeURIComponent(companyId)}/terminal/ssh-hosts/${encodeURIComponent(hostId)}/move-to-config`,
  sshConfigHosts: (companyId: string) => `/api/companies/${encodeURIComponent(companyId)}/terminal/ssh-config/hosts`,
  sshConfigHost: (companyId: string, alias: string) =>
    `/api/companies/${encodeURIComponent(companyId)}/terminal/ssh-config/hosts/${encodeURIComponent(alias)}`,
  sshConfigTest: (companyId: string) => `/api/companies/${encodeURIComponent(companyId)}/terminal/ssh-config/test`,
  sshConfigTrustHostKey: (companyId: string) =>
    `/api/companies/${encodeURIComponent(companyId)}/terminal/ssh-config/trust-host-key`,
  sshKeys: (companyId: string) => `/api/companies/${encodeURIComponent(companyId)}/terminal/ssh-keys`,
  download: (companyId: string, sessionId: string) =>
    `/api/companies/${encodeURIComponent(companyId)}/terminal/sessions/${encodeURIComponent(sessionId)}/download`,
} as const;

export const clampTerminalCols = (value: number): number =>
  Math.min(TERMINAL_MAX_COLS, Math.max(TERMINAL_MIN_COLS, Math.floor(value)));

export const clampTerminalRows = (value: number): number =>
  Math.min(TERMINAL_MAX_ROWS, Math.max(TERMINAL_MIN_ROWS, Math.floor(value)));
