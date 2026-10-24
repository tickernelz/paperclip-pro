import { ApiError } from "@/api/client";
import type { CurrentBoardAccess } from "@/api/access";

export function canOpenLocalTerminal(boardAccess: CurrentBoardAccess | undefined): boolean {
  if (!boardAccess) return false;
  return boardAccess.source === "local_implicit" || boardAccess.isInstanceAdmin;
}

export function terminalAccessErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Sign in to a board session to use the terminal.";
    if (error.status === 403) return `Terminal access is limited to board operators. ${error.message}`;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
