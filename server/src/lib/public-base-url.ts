import type { Request } from "express";
import { runtimeCanonicalOrigin } from "../services/cloud-runtime-identity.js";

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
  const runtimeOrigin = runtimeCanonicalOrigin();
  if (runtimeOrigin) return runtimeOrigin;
  if (authPublicBaseUrl) return authPublicBaseUrl.replace(/\/+$/, "");
  return requestBaseUrl(req);
}
