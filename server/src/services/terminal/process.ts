import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { constants as osConstants, homedir, userInfo } from "node:os";
import type { IPty } from "@lydell/node-pty";

export interface TerminalExit {
  exitCode: number | null;
  signal: string | null;
}

export interface TerminalProcess {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(listener: (data: string) => void): void;
  onExit(listener: (exit: TerminalExit) => void): void;
}

const require = createRequire(import.meta.url);
let ptyModule: typeof import("@lydell/node-pty") | null = null;

function loadPty(): typeof import("@lydell/node-pty") {
  ptyModule ??= require("@lydell/node-pty") as typeof import("@lydell/node-pty");
  return ptyModule;
}

export const TERMINAL_KILL_GRACE_MS = 2_000;

const INHERITED_ENV_KEYS = [
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "PATH",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "XDG_RUNTIME_DIR",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "DBUS_SESSION_BUS_ADDRESS",
  "DISPLAY",
  "WAYLAND_DISPLAY",
] as const;

export function resolveLoginShell(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.SHELL?.trim();
  if (fromEnv) return fromEnv;
  try {
    const fromPasswd = userInfo().shell?.trim();
    if (fromPasswd) return fromPasswd;
  } catch {
    return "/bin/bash";
  }
  return "/bin/bash";
}

export function buildLocalTerminalEnv(shell: string, source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of INHERITED_ENV_KEYS) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) env[key] = value;
  }
  env.HOME ??= homedir();
  env.SHELL = shell;
  env.PATH ??= "/usr/local/bin:/usr/bin:/bin";
  env.LANG ??= "C.UTF-8";
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  return env;
}

function signalName(signal: number | undefined): string | null {
  if (!signal) return null;
  const entry = Object.entries(osConstants.signals).find(([, value]) => value === signal);
  return entry ? entry[0] : String(signal);
}

function sendSignal(target: number, signal: NodeJS.Signals) {
  try {
    process.kill(target, signal);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ESRCH" && code !== "EPERM") throw err;
  }
}

export function listTerminalSessionMembers(sessionLeaderPid: number): number[] {
  if (process.platform !== "linux") return [];
  let entries: string[];
  try {
    entries = readdirSync("/proc");
  } catch {
    return [];
  }
  const members: number[] = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (pid === sessionLeaderPid) continue;
    let stat: string;
    try {
      stat = readFileSync(`/proc/${entry}/stat`, "utf8");
    } catch {
      continue;
    }
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    if (Number(fields[3]) === sessionLeaderPid) members.push(pid);
  }
  return members;
}

export function signalTerminalSession(sessionLeaderPid: number, signal: NodeJS.Signals) {
  const members = listTerminalSessionMembers(sessionLeaderPid);
  sendSignal(-sessionLeaderPid, signal);
  for (const pid of members) sendSignal(pid, signal);
}

export class PtyTerminalProcess implements TerminalProcess {
  private killRequested = false;

  constructor(
    private readonly pty: IPty,
    private readonly killGraceMs: number = TERMINAL_KILL_GRACE_MS,
  ) {}

  get pid(): number {
    return this.pty.pid;
  }

  write(data: string): void {
    this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    this.pty.resize(cols, rows);
  }

  kill(): void {
    if (this.killRequested) return;
    this.killRequested = true;
    const pid = this.pty.pid;
    signalTerminalSession(pid, "SIGHUP");
    const timer = setTimeout(() => signalTerminalSession(pid, "SIGKILL"), this.killGraceMs);
    timer.unref?.();
  }

  onData(listener: (data: string) => void): void {
    this.pty.onData(listener);
  }

  onExit(listener: (exit: TerminalExit) => void): void {
    this.pty.onExit(({ exitCode, signal }) => {
      listener({ exitCode: signal ? null : exitCode, signal: signalName(signal) });
    });
  }
}

export function spawnLocalTerminal(input: {
  cwd: string;
  cols: number;
  rows: number;
  shell?: string;
  args?: string[];
  env?: Record<string, string>;
}): PtyTerminalProcess {
  const shell = input.shell ?? resolveLoginShell();
  const pty = loadPty().spawn(shell, input.args ?? ["-l"], {
    name: "xterm-256color",
    cols: input.cols,
    rows: input.rows,
    cwd: input.cwd,
    env: input.env ?? buildLocalTerminalEnv(shell),
  });
  return new PtyTerminalProcess(pty);
}
