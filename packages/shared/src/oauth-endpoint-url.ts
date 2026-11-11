
export type OAuthEndpointKind = "authorization" | "token" | "registration" | "metadata";

export type OAuthEndpointUrlRejection =
  | "missing"
  | "malformed"
  | "unsupported_scheme"
  | "insecure_transport"
  | "embedded_credentials"
  | "fragment";

export interface OAuthEndpointUrlOptions {
  /**
   * Allow `http:` for loopback hosts. Only true under an explicit
   * local-development policy — never for a public deployment.
   */
  allowInsecureLoopback?: boolean;
  allowInsecureOrigins?: string[];
}

export type OAuthEndpointUrlCheck =
  | { ok: true; url: string; host: string }
  | { ok: false; reason: OAuthEndpointUrlRejection };

/** `127.0.0.0/8` — the whole loopback range, not just `127.0.0.1`. */
function isLoopbackIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4) return false;
  if (!parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return false;
  return parts[0] === "127";
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1") return true;
  const mapped = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped?.[1]) return isLoopbackIpv4(mapped[1]);
  return isLoopbackIpv4(host);
}

function normalizedOrigin(value: string): string | null {
  try {
    const origin = new URL(value).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

function insecureTransportAllowed(parsed: URL, options: OAuthEndpointUrlOptions): boolean {
  if (options.allowInsecureLoopback && isLoopbackHost(parsed.hostname)) return true;
  return (options.allowInsecureOrigins ?? []).some((origin) => normalizedOrigin(origin) === parsed.origin);
}

export function checkOAuthEndpointUrl(
  value: unknown,
  options: OAuthEndpointUrlOptions = {},
): OAuthEndpointUrlCheck {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, reason: "missing" };
  }
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: "unsupported_scheme" };
  }
  // A `javascript:`/`data:` URL has no host, and neither does something like
  // `http:relative` — without an authority there is no origin to trust.
  if (!parsed.hostname) return { ok: false, reason: "malformed" };
  if (parsed.protocol === "http:" && !insecureTransportAllowed(parsed, options)) {
    return { ok: false, reason: "insecure_transport" };
  }
  if (parsed.username || parsed.password) return { ok: false, reason: "embedded_credentials" };
  if (parsed.hash) return { ok: false, reason: "fragment" };
  return { ok: true, url: parsed.toString(), host: parsed.host };
}

export function isSafeOAuthEndpointUrl(value: unknown, options: OAuthEndpointUrlOptions = {}): boolean {
  return checkOAuthEndpointUrl(value, options).ok;
}

const KIND_LABELS: Record<OAuthEndpointKind, string> = {
  authorization: "sign-in",
  token: "token",
  registration: "client registration",
  metadata: "metadata",
};

/**
 * A UI-safe explanation for a rejected endpoint. Never echoes the URL, because
 * the string came from the remote server and may itself be the attack.
 */
export function oauthEndpointUrlRejectionMessage(
  kind: OAuthEndpointKind,
  reason: OAuthEndpointUrlRejection,
): string {
  const label = KIND_LABELS[kind];
  switch (reason) {
    case "missing":
      return `This server did not provide a ${label} address.`;
    case "malformed":
      return `This server's ${label} address is not a valid URL, so Wardmote stopped.`;
    case "unsupported_scheme":
      return `This server's ${label} address does not use https, so Wardmote stopped.`;
    case "insecure_transport":
      return `This server's ${label} address is not secure (https), so Wardmote stopped.`;
    case "embedded_credentials":
      return `This server's ${label} address hides a different site behind a username, so Wardmote stopped.`;
    case "fragment":
      return `This server's ${label} address is malformed for sign-in, so Wardmote stopped.`;
  }
}

/**
 * The host to show an operator before they are sent to an authorization page.
 * `null` when the value is not a usable URL — callers should be refusing to
 * navigate at that point anyway.
 */
export function oauthEndpointDisplayHost(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return new URL(value.trim()).host || null;
  } catch {
    return null;
  }
}
