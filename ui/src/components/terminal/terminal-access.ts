import { ApiError } from "@/api/client";
import type { CurrentBoardAccess } from "@/api/access";

const TERMINAL_ORIGIN_UNTRUSTED = "terminal_origin_untrusted";

export function canOpenLocalTerminal(boardAccess: CurrentBoardAccess | undefined): boolean {
  if (!boardAccess) return false;
  return boardAccess.source === "local_implicit" || boardAccess.isInstanceAdmin;
}

function bodyText(body: unknown, key: string): string | null {
  if (!body || typeof body !== "object") return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : null;
}

export function terminalAccessErrorMessage(
  error: unknown,
  fallback: string,
  pageOrigin: string = window.location.origin,
): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Sign in to a board session to use the terminal.";
    if (error.status === 403 && bodyText(error.body, "code") === TERMINAL_ORIGIN_UNTRUSTED) {
      const remediation = bodyText(error.body, "remediation");
      return `The address you opened (${pageOrigin}) is not trusted for the terminal.${remediation ? ` ${remediation}` : ""}`;
    }
    if (error.status === 403) return `Terminal access is limited to board operators. ${error.message}`;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
