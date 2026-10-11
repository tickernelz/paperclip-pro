import { DEFAULT_ATTACHMENT_MAX_MEGABYTES, type EffectiveAttachmentLimit } from "@tickernelz/paperclip-pro-shared";
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

const MAGIC_SIGNATURES: ReadonlyArray<{ mime: string; extension: string; offset: number; signature: readonly number[] }> = [
  { mime: "application/pdf", extension: "pdf", offset: 0, signature: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  { mime: "image/png", extension: "png", offset: 0, signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/jpeg", extension: "jpg", offset: 0, signature: [0xff, 0xd8, 0xff] },
  { mime: "image/gif", extension: "gif", offset: 0, signature: [0x47, 0x49, 0x46, 0x38] },
  { mime: "image/webp", extension: "webp", offset: 8, signature: [0x57, 0x45, 0x42, 0x50] },
  { mime: "application/zip", extension: "zip", offset: 0, signature: [0x50, 0x4b, 0x03, 0x04] },
  { mime: "application/gzip", extension: "gz", offset: 0, signature: [0x1f, 0x8b] },
  { mime: "audio/ogg", extension: "ogg", offset: 0, signature: [0x4f, 0x67, 0x67, 0x53] },
  { mime: "audio/mpeg", extension: "mp3", offset: 0, signature: [0x49, 0x44, 0x33] },
  { mime: "image/heic", extension: "heic", offset: 4, signature: [0x66, 0x74, 0x79, 0x70] },
  { mime: "video/mp4", extension: "mp4", offset: 4, signature: [0x66, 0x74, 0x79, 0x70] },
];

const EXTENSION_TO_CONTENT_TYPE: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  webm: "video/webm",
  mov: "video/quicktime",
  ogg: "audio/ogg",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
  zip: "application/zip",
  gz: "application/gzip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  ppt: "application/vnd.ms-powerpoint",
};

/** Filename extension (no dot) a content type maps to, or null when there is no reliable mapping. */
export function attachmentExtensionForContentType(contentType: string | null | undefined): string | null {
  const essence = normalizeContentType(contentType);
  const mapped = Object.entries(EXTENSION_TO_CONTENT_TYPE).find(([, mime]) => mime === essence);
  return mapped ? mapped[0]! : null;
}

/** Content type an extension implies, or null for an unknown or absent extension. */
export function contentTypeForExtension(extension: string | null | undefined): string | null {
  return EXTENSION_TO_CONTENT_TYPE[(extension ?? "").trim().replace(/^\./, "").toLowerCase()] ?? null;
}

/** Identifies a file from its leading magic bytes; null when the head matches no known signature. */
export function sniffAttachmentContentType(body: Buffer | Uint8Array): { contentType: string; extension: string } | null {
  const bytes = body instanceof Uint8Array ? body : Buffer.from(body);
  for (const candidate of MAGIC_SIGNATURES) {
    const signature = candidate.signature;
    if (bytes.length < candidate.offset + signature.length) continue;
    let matches = true;
    for (let index = 0; index < signature.length; index += 1) {
      if (bytes[candidate.offset + index] !== signature[index]) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    if (candidate.extension === "zip") {
      const head = bytes.subarray(0, 512).toString("latin1");
      const marker = head.includes("word/") ? "docx" : head.includes("xl/") ? "xlsx" : head.includes("ppt/") ? "pptx" : null;
      if (marker) return { contentType: EXTENSION_TO_CONTENT_TYPE[marker]!, extension: marker };
    }
    return { contentType: candidate.mime, extension: candidate.extension };
  }
  return null;
}

/** True when a filename's extension is absent or the placeholder `.bin` that carries no type information. */
export function isPlaceholderAttachmentFilename(filename: string | null | undefined): boolean {
  const leaf = (filename ?? "").trim();
  if (!leaf) return true;
  if (!leaf.includes(".")) return true;
  return leaf.slice(leaf.lastIndexOf(".") + 1).toLowerCase() === "bin";
}

/**
 * Replaces a placeholder content type and a `.bin`/extension-less filename with
 * the identity the bytes themselves prove. A real filename and a real declared
 * type both survive untouched; a name whose extension contradicts the bytes is
 * corrected. The result is never `.bin`.
 */
export function resolveAttachmentIdentity(input: {
  contentType: string | null | undefined;
  filename: string | null | undefined;
  body?: Buffer | Uint8Array | null;
}): { contentType: string; filename: string } {
  const declared = normalizeContentType(input.contentType);
  const sniffed = input.body ? sniffAttachmentContentType(input.body) : null;
  const extension = attachmentExtensionForContentType(sniffed?.contentType ?? declared);
  if (!extension) return { contentType: declared, filename: (input.filename ?? "").trim() };
  if (!isPlaceholderAttachmentFilename(input.filename)) {
    if (sniffed && sniffed.contentType !== declared && declared === DEFAULT_ATTACHMENT_CONTENT_TYPE)
      return { contentType: sniffed.contentType, filename: (input.filename ?? "").trim() };
    return { contentType: declared, filename: (input.filename ?? "").trim() };
  }
  const leaf = (input.filename ?? "").trim();
  const stem = leaf && leaf.includes(".") ? leaf.slice(0, leaf.lastIndexOf(".")) : leaf;
  const name = stem ? stem + "." + extension : "file." + extension;
  return { contentType: sniffed?.contentType ?? contentTypeForExtension(extension) ?? declared, filename: name };
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

const BYTES_PER_MEGABYTE = 1024 * 1024;
let attachmentLimitSettingMegabytes: number | null = null;

/** Caches the saved Instance Settings limit; called whenever general settings are read or written. */
export function setAttachmentLimitSetting(megabytes: number | null | undefined): void {
  attachmentLimitSettingMegabytes =
    typeof megabytes === "number" && Number.isSafeInteger(megabytes) && megabytes > 0 ? megabytes : null;
}

/** The attachment size ceiling in force now: saved setting, else PAPERCLIP_ATTACHMENT_MAX_BYTES, else 100 MB. */
export function getEffectiveAttachmentLimit(): EffectiveAttachmentLimit {
  if (attachmentLimitSettingMegabytes !== null) {
    return { maxBytes: attachmentLimitSettingMegabytes * BYTES_PER_MEGABYTE, source: "setting" };
  }
  const fromEnv = Number(process.env.PAPERCLIP_ATTACHMENT_MAX_BYTES);
  if (Number.isSafeInteger(fromEnv) && fromEnv > 0) return { maxBytes: fromEnv, source: "env" };
  return { maxBytes: DEFAULT_ATTACHMENT_MAX_MEGABYTES * BYTES_PER_MEGABYTE, source: "default" };
}

/** The one attachment size ceiling every upload, read and handoff path bounds itself by. */
export function getMaxAttachmentBytes(): number {
  return getEffectiveAttachmentLimit().maxBytes;
}

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
