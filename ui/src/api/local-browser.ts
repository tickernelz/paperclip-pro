import type {
  LocalBrowserPairingStartResult,
  LocalBrowserSession,
  LocalBrowserSettings,
  LocalBrowserSettingsUpdate,
} from "@tickernelz/paperclip-pro-shared";
import { api } from "./client";

export interface LocalBrowserPairingStatus {
  status: "pending" | "paired" | "expired";
  sessionId?: string;
}

function scoped(path: string, companyId: string): string {
  return `${path}?${new URLSearchParams({ companyId }).toString()}`;
}

function sessionPath(sessionId: string, suffix = ""): string {
  return `/local-browser/sessions/${encodeURIComponent(sessionId)}${suffix}`;
}

export const localBrowserApi = {
  startPairing: (companyId: string, input: { client?: "chromium" | "firefox"; label?: string } = {}) =>
    api.post<LocalBrowserPairingStartResult>(scoped("/local-browser/pairing", companyId), input),
  pairingStatus: (companyId: string, code: string) =>
    api.get<LocalBrowserPairingStatus>(
      scoped(`/local-browser/pairing/${encodeURIComponent(code)}`, companyId),
      { cache: "no-store" },
    ),
  sessions: (companyId: string) =>
    api.get<{ sessions: LocalBrowserSession[] }>(scoped("/local-browser/sessions", companyId), {
      cache: "no-store",
    }),
  disconnect: (companyId: string, sessionId: string) =>
    api.delete<{ ok: true }>(scoped(sessionPath(sessionId), companyId)),
  openPermissions: (companyId: string, sessionId: string) =>
    api.post<{ ok: true }>(scoped(sessionPath(sessionId, "/open-permissions"), companyId), {}),
  settings: (companyId: string) =>
    api.get<LocalBrowserSettings>(scoped("/local-browser/settings", companyId), { cache: "no-store" }),
  saveSettings: (companyId: string, update: LocalBrowserSettingsUpdate) =>
    api.post<LocalBrowserSettings>(scoped("/local-browser/settings", companyId), update),
};
