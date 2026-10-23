import path from "node:path";

/**
 * Cache-Control override for non-hashed UI static files (everything outside
 * /assets, which is content-hashed and immutable). Three kinds of file must
 * always be revalidated:
 *
 * - `index.html` must never outlive the asset hashes it points at.
 * - `sw.js` is the browser's only channel for updating an installed service
 *   worker: clients re-fetch this exact URL to discover new worker code, so
 *   any cache TTL here delays every client's update by that long on top of
 *   the browser's own update timer.
 * - `downloads/*` are the browser-extension artifacts. Their filename never
 *   changes between releases, so a cached copy silently keeps an operator on
 *   an old extension build while the page reports the new one.
 *
 * Returns undefined for files where the middleware's default TTL applies.
 */
export function staticUiCacheControl(filePath: string): "no-cache" | undefined {
  const basename = path.basename(filePath);
  if (basename === "index.html" || basename === "sw.js") return "no-cache";
  const normalized = filePath.split(path.sep).join("/");
  return normalized.includes("/downloads/") ? "no-cache" : undefined;
}
