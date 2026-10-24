import {
  TERMINAL_MAX_UPLOAD_BYTES,
  terminalApiPaths,
  type CreateTerminalSessionRequest,
  type TerminalAttachToken,
  type TerminalSession,
  type TerminalUploadResult,
} from "@tickernelz/paperclip-pro-shared";
import { api, ApiError } from "./client";

const API_PREFIX = "/api";

function clientPath(path: string): string {
  return path.startsWith(`${API_PREFIX}/`) ? path.slice(API_PREFIX.length) : path;
}

export const terminalQueryKeys = {
  sessions: (companyId: string) => ["terminal-sessions", companyId] as const,
};

export function terminalUploadTooLargeError(file: Blob): ApiError | null {
  if (file.size <= TERMINAL_MAX_UPLOAD_BYTES) return null;
  const limitMb = Math.floor(TERMINAL_MAX_UPLOAD_BYTES / (1024 * 1024));
  return new ApiError(`File is larger than the ${limitMb} MB terminal upload limit.`, 413, null);
}

export const terminalApi = {
  list: (companyId: string) =>
    api.get<TerminalSession[]>(clientPath(terminalApiPaths.sessions(companyId)), { cache: "no-store" }),
  create: (companyId: string, body: CreateTerminalSessionRequest) =>
    api.post<TerminalSession>(clientPath(terminalApiPaths.sessions(companyId)), body),
  remove: (companyId: string, sessionId: string) =>
    api.delete<void>(clientPath(terminalApiPaths.session(companyId, sessionId))),
  createToken: (companyId: string, sessionId: string) =>
    api.post<TerminalAttachToken>(clientPath(terminalApiPaths.token(companyId, sessionId)), {}),
  upload: (companyId: string, sessionId: string, file: File) => {
    const tooLarge = terminalUploadTooLargeError(file);
    if (tooLarge) return Promise.reject(tooLarge);
    const form = new FormData();
    form.append("file", file, file.name);
    return api.postForm<TerminalUploadResult>(clientPath(terminalApiPaths.upload(companyId, sessionId)), form);
  },
  download: (companyId: string, sessionId: string, path: string) =>
    api.getBlob(`${clientPath(terminalApiPaths.download(companyId, sessionId))}?path=${encodeURIComponent(path)}`),
};
