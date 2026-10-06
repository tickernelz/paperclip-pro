/** Attachment content-type policy: every type is accepted unless `PAPERCLIP_ALLOWED_ATTACHMENT_TYPES` restricts it to comma-separated MIME patterns. */
export const ALLOW_ALL_ATTACHMENT_TYPES: readonly string[] = ["*"];

export const DEFAULT_ATTACHMENT_CONTENT_TYPE = "application/octet-stream";
export const SVG_CONTENT_TYPE = "image/svg+xml";
export const GENERIC_ATTACHMENT_CONTENT_TYPES: readonly string[] = [
  "application/octet-stream",
  "binary/octet-stream",
  "application/x-binary",
];
const ACTIVE_ATTACHMENT_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "text/html",
  "application/html",
  "application/xhtml+xml",
  SVG_CONTENT_TYPE,
  "text/xsl",
  "application/x-shockwave-flash",
  "multipart/x-mixed-replace",
]);
export const INLINE_ATTACHMENT_TYPES: readonly string[] = [
  "image/*",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/json",
  "text/csv",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-m4v",
];

/** Parse a comma-separated list of MIME type patterns; empty input allows every type. */
export function parseAllowedTypes(raw: string | undefined): string[] {
  if (!raw) return [...ALLOW_ALL_ATTACHMENT_TYPES];
  const parsed = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  return parsed.length > 0 ? parsed : [...ALLOW_ALL_ATTACHMENT_TYPES];
}

/**
 * Check whether `contentType` matches any entry in `allowedPatterns`.
 *
 * Supports exact matches ("application/pdf") and wildcard / prefix
 * patterns ("image/*", "application/vnd.openxmlformats-officedocument.*").
 */
export function matchesContentType(contentType: string, allowedPatterns: string[]): boolean {
  const ct = contentType.toLowerCase();
  return allowedPatterns.some((pattern) => {
    if (pattern === "*") return true;
    if (pattern.endsWith("/*") || pattern.endsWith(".*")) {
      return ct.startsWith(pattern.slice(0, -1));
    }
    return ct === pattern;
  });
}

const MIME_TOKEN = "[!#$%&'*+.^_`|~0-9a-z-]+";
const MIME_ESSENCE_PATTERN = new RegExp("^" + MIME_TOKEN + "/" + MIME_TOKEN + "$");
const MIME_CHARSET_PATTERN = new RegExp("^" + MIME_TOKEN + "$");

/** Lowercased RFC 7231 `type/subtype` essence of a Content-Type value; anything missing or malformed becomes `application/octet-stream`. */
export function normalizeContentType(contentType: string | null | undefined): string {
  const normalized = (contentType ?? "").split(";", 1)[0]!.trim().toLowerCase();
  return MIME_ESSENCE_PATTERN.test(normalized) ? normalized : DEFAULT_ATTACHMENT_CONTENT_TYPE;
}

export function inferOfficeAttachmentContentTypeFromFilename(
  filename: string | null | undefined,
): string | null {
  const lower = (filename ?? "").trim().toLowerCase();
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lower.endsWith(".pptx")) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".ppt")) return "application/vnd.ms-powerpoint";
  return null;
}

export function normalizeUploadAttachmentContentType(input: {
  contentType: string | null | undefined;
  originalFilename?: string | null;
  isAllowedContentType?: (contentType: string) => boolean;
}): string {
  const normalized = normalizeContentType(input.contentType);
  if (!GENERIC_ATTACHMENT_CONTENT_TYPES.includes(normalized)) return normalized;
  const inferred = inferOfficeAttachmentContentTypeFromFilename(input.originalFilename);
  if (!inferred) return normalized;
  if (input.isAllowedContentType && !input.isAllowedContentType(inferred)) return normalized;
  return inferred;
}

/** True for types a browser could execute as active content (markup, script, XML); these are only ever served as downloads. */
export function isActiveAttachmentContentType(contentType: string): boolean {
  const ct = normalizeContentType(contentType);
  return (
    ACTIVE_ATTACHMENT_CONTENT_TYPES.has(ct) ||
    ct.endsWith("+xml") ||
    ct.endsWith("/xml") ||
    ct.includes("javascript") ||
    ct.includes("ecmascript")
  );
}

/** Content type for serving a stored attachment: active content is downgraded to `application/octet-stream`. */
export function attachmentServingContentType(contentType: string | null | undefined): string {
  const essence = normalizeContentType(contentType);
  if (isActiveAttachmentContentType(essence)) return DEFAULT_ATTACHMENT_CONTENT_TYPE;
  const charset = (contentType ?? "")
    .split(";")
    .slice(1)
    .map((parameter) => parameter.trim().toLowerCase())
    .find((parameter) => parameter.startsWith("charset="))
    ?.slice("charset=".length);
  return charset && MIME_CHARSET_PATTERN.test(charset) ? `${essence}; charset=${charset}` : essence;
}

/** Serving type for a stored asset: sanitized SVG uploaded through the asset routes keeps `image/svg+xml`, everything else goes through {@link attachmentServingContentType}. */
export function assetServingContentType(asset: { companyId: string; objectKey: string; contentType: string | null | undefined }): string {
  const sanitizedSvg = normalizeContentType(asset.contentType) === SVG_CONTENT_TYPE
    && asset.objectKey.startsWith(`${asset.companyId}/assets/`);
  return sanitizedSvg ? SVG_CONTENT_TYPE : attachmentServingContentType(asset.contentType);
}

/** `Content-Disposition` value with an ASCII `filename` fallback and an RFC 5987 `filename*` for any other name. */
export function contentDispositionHeader(disposition: "inline" | "attachment", filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  if (fallback === filename) return `${disposition}; filename="${filename}"`;
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function isInlineAttachmentContentType(contentType: string): boolean {
  const essence = normalizeContentType(contentType);
  return !isActiveAttachmentContentType(essence) && matchesContentType(essence, [...INLINE_ATTACHMENT_TYPES]);
}

let allowedPatternsSource: string | undefined;
let allowedPatterns: string[] = parseAllowedTypes(undefined);

/** Whether the operator's `PAPERCLIP_ALLOWED_ATTACHMENT_TYPES` restriction (allow-all when unset) admits `contentType`. */
export function isAllowedContentType(contentType: string): boolean {
  const source = process.env.PAPERCLIP_ALLOWED_ATTACHMENT_TYPES;
  if (source !== allowedPatternsSource) {
    allowedPatternsSource = source;
    allowedPatterns = parseAllowedTypes(source);
  }
  return matchesContentType(normalizeContentType(contentType), allowedPatterns);
}

/**
 * The one attachment size ceiling for this deployment. Every upload path —
 * assets, task attachments, cases, and company import — bounds itself by this
 * value, so an operator raises or lowers the limit in exactly one place.
 */
export const MAX_ATTACHMENT_BYTES =
  Number(process.env.PAPERCLIP_ATTACHMENT_MAX_BYTES) || 10 * 1024 * 1024;

const ATTACHMENT_SIZE_UNITS: readonly string[] = ["KB", "MB", "GB"];

/**
 * Render a byte count the way a person reading an error message expects it:
 * 1024-based steps under the conventional consumer labels, at most one decimal
 * place, and no trailing ".0". The default cap renders as "10 MB" rather than
 * "10485760 bytes". Sub-kilobyte values stay in bytes so a tiny configured cap
 * does not collapse to "0 KB".
 */
export function formatAttachmentSize(bytes: number): string {
  // Defensive: the cap itself can never be negative or NaN (`Number(env) || default`
  // falls back on both), but never render "NaN bytes" at a user.
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 bytes";
  if (bytes < 1024) return bytes === 1 ? "1 byte" : `${bytes} bytes`;

  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < ATTACHMENT_SIZE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  // toFixed(1) then strip a trailing ".0": 10.5 -> "10.5", 10.0 -> "10".
  const rounded = value.toFixed(1).replace(/\.0$/, "");
  return `${rounded} ${ATTACHMENT_SIZE_UNITS[unitIndex]}`;
}
