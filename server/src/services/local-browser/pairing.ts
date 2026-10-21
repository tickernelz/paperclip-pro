import { randomBytes, randomUUID } from "node:crypto";
import {
  LOCAL_BROWSER_PAIRING_CODE_LENGTH,
  LOCAL_BROWSER_PAIRING_TTL_MS,
  type LocalBrowserClient,
  type LocalBrowserPairingStartResult,
} from "@tickernelz/paperclip-pro-shared";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface PairingRecord {
  code: string;
  companyId: string;
  createdByUserId: string | null;
  createdByAgentId: string | null;
  label: string | null;
  client: LocalBrowserClient | null;
  expiresAt: number;
  sessionId: string | null;
  claimedAt: number | null;
  consumedAt: number | null;
}

export type PairingStatus = "pending" | "paired" | "expired";

const pairings = new Map<string, PairingRecord>();

function mintCode(): string {
  const bytes = randomBytes(LOCAL_BROWSER_PAIRING_CODE_LENGTH);
  let code = "";
  for (let index = 0; index < LOCAL_BROWSER_PAIRING_CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET[bytes[index]! % CODE_ALPHABET.length];
  }
  return code;
}

function sweep(now: number) {
  for (const [code, record] of pairings) {
    if (record.expiresAt <= now && record.consumedAt === null) pairings.delete(code);
  }
}

export function createPairing(input: {
  companyId: string;
  createdByUserId?: string | null;
  createdByAgentId?: string | null;
  label?: string | null;
  client?: LocalBrowserClient | null;
  now?: number;
}): PairingRecord {
  const now = input.now ?? Date.now();
  sweep(now);
  let code = mintCode();
  while (pairings.has(code)) code = mintCode();
  const record: PairingRecord = {
    code,
    companyId: input.companyId,
    createdByUserId: input.createdByUserId ?? null,
    createdByAgentId: input.createdByAgentId ?? null,
    label: input.label ?? null,
    client: input.client ?? null,
    expiresAt: now + LOCAL_BROWSER_PAIRING_TTL_MS,
    sessionId: null,
    claimedAt: null,
    consumedAt: null,
  };
  pairings.set(code, record);
  return record;
}

export function readPairing(code: string, now = Date.now()): PairingRecord | null {
  const record = pairings.get(code.trim().toUpperCase());
  if (!record) return null;
  if (record.consumedAt !== null || record.claimedAt !== null) return null;
  if (record.expiresAt <= now) return null;
  return record;
}

export function pairingStatus(code: string, now = Date.now()): { status: PairingStatus; sessionId?: string } {
  const record = pairings.get(code.trim().toUpperCase());
  if (!record) return { status: "expired" };
  if (record.consumedAt !== null) return { status: "paired", sessionId: record.sessionId ?? undefined };
  if (record.expiresAt <= now) return { status: "expired" };
  return { status: "pending" };
}

export function pairingStatusForCompany(
  code: string,
  companyId: string,
  now = Date.now(),
): { status: PairingStatus; sessionId?: string } {
  const record = pairings.get(code.trim().toUpperCase());
  if (!record || record.companyId !== companyId) return { status: "expired" };
  return pairingStatus(code, now);
}

export function claimPairing(code: string, now = Date.now()): PairingRecord | null {
  const record = pairings.get(code.trim().toUpperCase());
  if (!record) return null;
  if (record.consumedAt !== null || record.claimedAt !== null) return null;
  if (record.expiresAt <= now) return null;
  record.claimedAt = now;
  return record;
}

export function releasePairingClaim(code: string): void {
  const record = pairings.get(code.trim().toUpperCase());
  if (!record || record.sessionId !== null) return;
  record.claimedAt = null;
}

export function finalizePairing(code: string, sessionId: string): boolean {
  const record = pairings.get(code.trim().toUpperCase());
  if (!record || record.claimedAt === null || record.consumedAt !== null) return false;
  record.consumedAt = Date.now();
  record.sessionId = sessionId;
  return true;
}

export function consumePairing(code: string, sessionId: string): boolean {
  const claimed = claimPairing(code);
  if (!claimed) return false;
  return finalizePairing(code, sessionId);
}

export function pairingResult(record: PairingRecord, connectUrls: string[]): LocalBrowserPairingStartResult {
  return {
    code: record.code,
    expiresAt: new Date(record.expiresAt).toISOString(),
    connectUrls,
  };
}

export function resetPairings(): void {
  pairings.clear();
}

export function pairingBridgeUrl(baseUrl: string, code: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/api/local-browser/bridge?code=${encodeURIComponent(code)}`;
}

export function newPairingNonce(): string {
  return randomUUID();
}
