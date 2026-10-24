import type { ITheme } from "@xterm/xterm";
import type { TerminalErrorCode, TerminalServerFrame } from "@tickernelz/paperclip-pro-shared";

export const TERMINAL_RECONNECT_BASE_DELAY_MS = 500;
export const TERMINAL_RECONNECT_MAX_DELAY_MS = 30_000;

const FATAL_ERROR_CODES: ReadonlySet<TerminalErrorCode> = new Set(["not_found", "forbidden", "spawn_failed", "session_exited"]);

export function isFatalTerminalError(code: TerminalErrorCode): boolean {
  return FATAL_ERROR_CODES.has(code);
}

export function reconnectDelayMs(attempt: number, baseDelayMs: number = TERMINAL_RECONNECT_BASE_DELAY_MS): number {
  return Math.min(TERMINAL_RECONNECT_MAX_DELAY_MS, baseDelayMs * 2 ** Math.max(0, attempt));
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  return typeof value[key] === "string" ? value[key] as string : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseTerminalServerFrame(raw: unknown): TerminalServerFrame | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const frame = parsed as Record<string, unknown>;
  switch (frame.type) {
    case "ready":
      return frame.session && typeof frame.session === "object"
        ? { type: "ready", session: frame.session as Extract<TerminalServerFrame, { type: "ready" }>["session"] }
        : null;
    case "replay":
    case "output": {
      const data = stringField(frame, "data");
      return data === null ? null : { type: frame.type, data };
    }
    case "exit":
      return { type: "exit", exitCode: nullableNumber(frame.exitCode), signal: stringField(frame, "signal") };
    case "error": {
      const code = stringField(frame, "code") as TerminalErrorCode | null;
      return code ? { type: "error", code, message: stringField(frame, "message") ?? "Terminal error." } : null;
    }
    case "pong":
      return { type: "pong" };
    default:
      return null;
  }
}

function cssVariable(style: CSSStyleDeclaration, name: string): string | undefined {
  const value = style.getPropertyValue(name).trim();
  return value.length > 0 ? value : undefined;
}

export function resolveTerminalTheme(element: Element): ITheme {
  const style = window.getComputedStyle(element);
  const entries: Array<[keyof ITheme, string | undefined]> = [
    ["background", cssVariable(style, "--background")],
    ["foreground", cssVariable(style, "--foreground")],
    ["cursor", cssVariable(style, "--primary")],
    ["cursorAccent", cssVariable(style, "--background")],
    ["selectionBackground", cssVariable(style, "--ring")],
    ["selectionForeground", cssVariable(style, "--background")],
  ];
  return Object.fromEntries(entries.filter((entry) => entry[1] !== undefined)) as ITheme;
}

export function resolveTerminalFont(element: Element): { fontFamily?: string; fontSize?: number } {
  const style = window.getComputedStyle(element);
  const fontSize = Number.parseFloat(style.fontSize);
  return {
    fontFamily: cssVariable(style, "--font-mono"),
    fontSize: Number.isFinite(fontSize) && fontSize > 0 ? fontSize : undefined,
  };
}

export function downloadFileName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? "download";
}
