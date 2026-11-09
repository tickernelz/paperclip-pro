import type { Request } from "express";

export function requestBaseUrl(req: Request) {
  const forwardedProto = req.header("x-forwarded-proto");
  const proto = forwardedProto?.split(",")[0]?.trim() || req.protocol || "http";
  const host =
    req.header("x-forwarded-host")?.split(",")[0]?.trim() || req.header("host");
  if (!host) return "";
  return `${proto}://${host}`;
}

/** Public origin for links handed to people outside the board. */
export function resolveBaseUrl(req: Request, authPublicBaseUrl?: string): string {
  if (authPublicBaseUrl) return authPublicBaseUrl.replace(/\/+$/, "");
  return requestBaseUrl(req);
}

export function runtimePublicOrigin(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidate = ["WARDMOTE_PUBLIC_URL", "WARDMOTE_AUTH_PUBLIC_BASE_URL", "WARDMOTE_API_URL"]
    .map((key) => env[key]?.trim())
    .find((value) => value);
  if (!candidate) return null;
  try {
    return new URL(candidate).origin;
  } catch {
    return null;
  }
}
