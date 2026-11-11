import type { Request } from "express";

export function isCrossSiteOAuthCallbackNavigation(req: Request): boolean {
  return req.get("sec-fetch-site") === "cross-site"
    && req.get("sec-fetch-mode") === "navigate";
}

export function oauthCallbackInterstitialHtml(continuePath?: string): string {
  const attribute = (continuePath ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;");
  // A meta refresh alone, not a script as well: the OAuth code is single-use, so
  // two racing follow-ups would let the loser render an expired-state error.
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="refresh" content="${continuePath === undefined ? "0" : `0;url=${attribute}`}"><title>Finishing connection</title></head><body><p>Finishing your connection…</p></body></html>`;
}

