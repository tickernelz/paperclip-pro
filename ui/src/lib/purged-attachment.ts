import type { IssueAttachment } from "@tickernelz/paperclip-pro-shared";

const PURGEABLE_CONTENT_PATH_RE =
  /^\/api\/(?:attachments\/[^/?#]+|assets\/[^/?#]+|public\/share\/[^/?#]+\/assets\/[^/?#]+)\/content\/?$/;

export const PURGED_AT_HEADER = "X-Paperclip-Purged-At";

export interface PurgedContent {
  purgedAt: string | null;
}

const probes = new Map<string, Promise<PurgedContent | null>>();

function sameOriginPath(src: string): string | null {
  const origin = typeof window !== "undefined" && window.location ? window.location.origin : "http://localhost";
  try {
    const url = new URL(src, origin);
    if (url.origin !== origin) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

/** True for same-origin attachment or asset content URLs that retention can purge. */
export function isPurgeableContentPath(src: string | null | undefined): src is string {
  if (!src) return false;
  const path = sameOriginPath(src);
  return path !== null && PURGEABLE_CONTENT_PATH_RE.test(path);
}

/** Calendar date (UTC, YYYY-MM-DD) of a purge timestamp, or null when unparseable. */
export function purgedDateLabel(purgedAt: string | Date | null | undefined): string | null {
  if (!purgedAt) return null;
  const date = purgedAt instanceof Date ? purgedAt : new Date(purgedAt);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/** The tombstone text shown in place of a file removed by retention. */
export function purgedFileText(purgedAt: string | Date | null | undefined): string {
  const date = purgedDateLabel(purgedAt);
  return date ? `File removed by retention (${date})` : "File removed by retention";
}

/** HEADs a content URL once and reports whether retention removed it. */
export function probePurgedContent(src: string): Promise<PurgedContent | null> {
  const path = sameOriginPath(src);
  if (!path || !PURGEABLE_CONTENT_PATH_RE.test(path)) return Promise.resolve(null);
  const cached = probes.get(path);
  if (cached) return cached;
  const probe = fetch(path, { method: "HEAD", credentials: "include", cache: "no-store" })
    .then((res) => (res.status === 410 ? { purgedAt: res.headers.get(PURGED_AT_HEADER) } : null))
    .catch(() => null);
  probes.set(path, probe);
  probe.then((result) => {
    if (result === null) probes.delete(path);
  });
  return probe;
}

export function resetPurgedContentProbesForTests(): void {
  probes.clear();
}

/** Maps every known content path of purged attachments to its purge time. */
export function purgedContentPaths(attachments: Iterable<Pick<IssueAttachment, "contentPath" | "purgedAt">>): Map<string, string> {
  const result = new Map<string, string>();
  for (const attachment of attachments) {
    if (!attachment.purgedAt || !attachment.contentPath) continue;
    const path = sameOriginPath(attachment.contentPath);
    if (!path) continue;
    const purgedAt = attachment.purgedAt instanceof Date ? attachment.purgedAt.toISOString() : String(attachment.purgedAt);
    result.set(path, purgedAt);
  }
  return result;
}

/** Looks up a content URL in a purged-path map. */
export function lookupPurgedPath(paths: Map<string, string>, src: string | null | undefined): string | null {
  if (!src || paths.size === 0) return null;
  const path = sameOriginPath(src);
  return path ? paths.get(path) ?? null : null;
}
