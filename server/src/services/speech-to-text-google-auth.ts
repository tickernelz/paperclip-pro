import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

export const GOOGLE_CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
const TOKEN_REFRESH_MARGIN_MS = 60_000;

export interface GoogleServiceAccount {
  clientEmail: string;
  privateKey: string;
  privateKeyId: string;
  projectId: string;
  tokenUri: string;
}

export class GoogleCredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleCredentialsError";
  }
}

export class GoogleTokenError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = "GoogleTokenError";
    this.status = status;
  }
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function parseServiceAccount(raw: string): GoogleServiceAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new GoogleCredentialsError("Google credentials are not a service account JSON key");
  }
  const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const text = (key: string) => (typeof record[key] === "string" ? (record[key] as string) : "");
  if (record.type !== "service_account" || !text("client_email") || !text("private_key"))
    throw new GoogleCredentialsError("Google credentials must be a service account JSON key with client_email and private_key");
  return {
    clientEmail: text("client_email"),
    privateKey: text("private_key"),
    privateKeyId: text("private_key_id"),
    projectId: text("project_id"),
    tokenUri: text("token_uri") || DEFAULT_TOKEN_URI,
  };
}

export async function loadGoogleServiceAccount(value: string): Promise<GoogleServiceAccount> {
  const trimmed = value.trim();
  if (trimmed.startsWith("{")) return parseServiceAccount(trimmed);
  let raw: string;
  try {
    raw = await readFile(trimmed, "utf8");
  } catch {
    throw new GoogleCredentialsError("The Google service account key file could not be read");
  }
  return parseServiceAccount(raw);
}

function signedAssertion(account: GoogleServiceAccount, nowSeconds: number): string {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT", ...(account.privateKeyId ? { kid: account.privateKeyId } : {}) }));
  const claims = base64Url(
    JSON.stringify({ iss: account.clientEmail, scope: GOOGLE_CLOUD_PLATFORM_SCOPE, aud: account.tokenUri, iat: nowSeconds, exp: nowSeconds + 3600 }),
  );
  let signature: Buffer;
  try {
    signature = createSign("RSA-SHA256").update(header + "." + claims).sign(account.privateKey);
  } catch {
    throw new GoogleCredentialsError("The Google service account private key could not sign a token request");
  }
  return header + "." + claims + "." + base64Url(signature);
}

export async function googleAccessToken(
  account: GoogleServiceAccount,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  now: () => number = Date.now,
): Promise<string> {
  const cacheKey = account.clientEmail + "|" + account.privateKeyId + "|" + account.tokenUri;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - TOKEN_REFRESH_MARGIN_MS > now()) return cached.token;
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: signedAssertion(account, Math.floor(now() / 1000)),
  });
  const response = await fetchImpl(account.tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
    signal,
  });
  const raw = await response.text();
  if (!response.ok) throw new GoogleTokenError("Google token endpoint answered HTTP " + response.status, response.status);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new GoogleTokenError("Google token endpoint returned malformed JSON", null);
  }
  const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  if (typeof record.access_token !== "string" || !record.access_token)
    throw new GoogleTokenError("Google token endpoint returned no access token", null);
  const lifetimeSeconds = typeof record.expires_in === "number" && record.expires_in > 0 ? record.expires_in : 3600;
  tokenCache.set(cacheKey, { token: record.access_token, expiresAt: now() + lifetimeSeconds * 1000 });
  return record.access_token;
}
