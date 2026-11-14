import {
  TERMINAL_MAX_UPLOAD_BYTES,
  terminalApiPaths,
  type CreateSshKeyRequest,
  type CreateTerminalSessionRequest,
  type SshConfigHostSettings,
  type SshConnectionTarget,
  type SshConnectionTestResult,
  type SshKeyInfo,
  type SshKeyList,
  type TerminalAttachToken,
  type TerminalSession,
  type TerminalSshHostList,
  type TrustSshHostKeyRequest,
  type TrustSshHostKeyResult,
  type TerminalUploadResult,
} from "@tickernelz/wardmote-shared";
import { api, ApiError } from "./client";

const API_PREFIX = "/api";

function clientPath(path: string): string {
  return path.startsWith(`${API_PREFIX}/`) ? path.slice(API_PREFIX.length) : path;
}

export const terminalQueryKeys = {
  sessions: (companyId: string) => ["terminal-sessions", companyId] as const,
  sshHosts: (companyId: string) => ["terminal-ssh-hosts", companyId] as const,
  sshKeys: (companyId: string) => ["terminal-ssh-keys", companyId] as const,
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
  pasteImage: (companyId: string, sessionId: string, image: Blob) => {
    const tooLarge = terminalUploadTooLargeError(image);
    if (tooLarge) return Promise.reject(tooLarge);
    const form = new FormData();
    form.append("file", image, "pasted-image");
    return api.postForm<TerminalUploadResult>(clientPath(terminalApiPaths.pasteImage(companyId, sessionId)), form);
  },
  listSshHosts: (companyId: string) =>
    api.get<TerminalSshHostList>(clientPath(terminalApiPaths.sshHosts(companyId)), { cache: "no-store" }),
  moveSshHostToConfig: (companyId: string, hostId: string, body: SshConfigHostSettings) =>
    api.post<SshConfigHostSettings>(clientPath(terminalApiPaths.moveSshHostToConfig(companyId, hostId)), body),
  addConfigHost: (companyId: string, body: SshConfigHostSettings) =>
    api.post<SshConfigHostSettings>(clientPath(terminalApiPaths.sshConfigHosts(companyId)), body),
  updateConfigHost: (companyId: string, alias: string, body: SshConfigHostSettings) =>
    api.put<SshConfigHostSettings>(clientPath(terminalApiPaths.sshConfigHost(companyId, alias)), body),
  removeConfigHost: (companyId: string, alias: string) =>
    api.delete<void>(clientPath(terminalApiPaths.sshConfigHost(companyId, alias))),
  testConnection: (companyId: string, target: SshConnectionTarget) =>
    api.post<SshConnectionTestResult>(clientPath(terminalApiPaths.sshConfigTest(companyId)), target),
  trustHostKey: (companyId: string, body: TrustSshHostKeyRequest) =>
    api.post<TrustSshHostKeyResult>(clientPath(terminalApiPaths.sshConfigTrustHostKey(companyId)), body),
  listKeys: (companyId: string) =>
    api.get<SshKeyList>(clientPath(terminalApiPaths.sshKeys(companyId)), { cache: "no-store" }),
  createKey: (companyId: string, body: CreateSshKeyRequest) =>
    api.post<SshKeyInfo>(clientPath(terminalApiPaths.sshKeys(companyId)), body),
  download: (companyId: string, sessionId: string, path: string) =>
    api.getBlob(`${clientPath(terminalApiPaths.download(companyId, sessionId))}?path=${encodeURIComponent(path)}`),
};
