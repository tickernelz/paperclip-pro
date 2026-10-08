import type { NextFunction, Request, Response } from "express";
import { documentExportFileName, isMarkdownAttachmentContent } from "@tickernelz/paperclip-pro-shared";
import type { StorageService } from "../storage/types.js";
import {
  assetServingContentType,
  attachmentServingContentType,
  contentDispositionHeader,
  GENERIC_ATTACHMENT_CONTENT_TYPES,
  isInlineAttachmentContentType,
  normalizeContentType,
} from "../attachment-types.js";
import { renderDocumentPdf } from "../services/document-pdf.js";

const GENERIC_RESPONSE_ATTACHMENT_CONTENT_TYPES = new Set(
  GENERIC_ATTACHMENT_CONTENT_TYPES,
);

function inferVideoContentTypeFromFilename(
  filename: string | null | undefined,
): string | null {
  const lower = (filename ?? "").toLowerCase();
  if (lower.endsWith(".mp4") || lower.endsWith(".m4v")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (
    lower.endsWith(".mov") ||
    lower.endsWith(".qt") ||
    lower.endsWith(".quicktime")
  )
    return "video/quicktime";
  return null;
}

function resolveAttachmentResponseContentType(input: {
  storedContentType: string | null | undefined;
  objectContentType?: string | null;
  originalFilename?: string | null;
}) {
  const storedContentType = normalizeContentType(
    input.storedContentType || input.objectContentType,
  );
  if (!GENERIC_RESPONSE_ATTACHMENT_CONTENT_TYPES.has(storedContentType))
    return storedContentType;
  return (
    inferVideoContentTypeFromFilename(input.originalFilename) ??
    storedContentType
  );
}

type ParsedAttachmentRange =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "range"; start: number; end: number };

function parseAttachmentRangeHeader(
  raw: string | undefined,
  contentLength: number,
): ParsedAttachmentRange {
  if (!raw) return { kind: "none" };
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0)
    return { kind: "invalid" };

  const prefix = "bytes=";
  if (!raw.toLowerCase().startsWith(prefix)) return { kind: "invalid" };
  const spec = raw.slice(prefix.length).trim();
  if (!spec || spec.includes(",")) return { kind: "invalid" };

  const [startRaw, endRaw] = spec.split("-", 2);
  if (endRaw === undefined) return { kind: "invalid" };

  if (startRaw === "") {
    const suffixLength = Number.parseInt(endRaw, 10);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0)
      return { kind: "invalid" };
    const start = Math.max(contentLength - suffixLength, 0);
    return { kind: "range", start, end: contentLength - 1 };
  }

  const start = Number.parseInt(startRaw, 10);
  if (!Number.isSafeInteger(start) || start < 0 || start >= contentLength)
    return { kind: "invalid" };
  const end = endRaw === "" ? contentLength - 1 : Number.parseInt(endRaw, 10);
  if (!Number.isSafeInteger(end) || end < start) return { kind: "invalid" };
  return { kind: "range", start, end: Math.min(end, contentLength - 1) };
}

/** Answers 410 for a file whose stored object was removed by attachment retention; returns false otherwise. */
export function sendPurgedContent(res: Response, purgedAt: Date | string | null | undefined): boolean {
  if (!purgedAt) return false;
  const iso = new Date(purgedAt).toISOString();
  res.setHeader("X-Paperclip-Purged-At", iso);
  res.setHeader("Cache-Control", "private, no-store");
  res.status(410).json({
    error: `File removed by retention (${iso.slice(0, 10)})`,
    code: "attachment_purged",
    purgedAt: iso,
  });
  return true;
}

export interface ServableAttachment {
  companyId: string;
  objectKey: string;
  contentType: string | null;
  byteSize: number;
  originalFilename: string | null;
  purgedAt?: Date | string | null;
}

/** Streams an issue attachment with the any-type serving headers. */
export async function serveAttachmentContent(input: {
  storage: StorageService;
  attachment: ServableAttachment;
  rangeHeader: string | undefined;
  download: boolean;
  res: Response;
  next: NextFunction;
}) {
  const { attachment, res, next } = input;
  if (sendPurgedContent(res, attachment.purgedAt)) return;
  const contentLength = attachment.byteSize;
  const range = parseAttachmentRangeHeader(input.rangeHeader, contentLength);
  res.setHeader("Accept-Ranges", "bytes");
  if (range.kind === "invalid") {
    res.setHeader("Content-Range", `bytes */${contentLength}`);
    res.status(416).end();
    return;
  }

  const object = await input.storage.getObject(
    attachment.companyId,
    attachment.objectKey,
    range.kind === "range"
      ? { range: { start: range.start, end: range.end } }
      : undefined,
  );
  const responseContentType = attachmentServingContentType(
    resolveAttachmentResponseContentType({
      storedContentType: attachment.contentType,
      objectContentType: object.contentType,
      originalFilename: attachment.originalFilename,
    }),
  );
  const isMarkdownResponse = isMarkdownAttachmentContent({
    contentType: responseContentType,
    originalFilename: attachment.originalFilename,
  });
  res.attachment(attachment.originalFilename ?? "attachment");
  res.setHeader(
    "Content-Type",
    isMarkdownResponse
      ? `${responseContentType}; charset=utf-8`
      : responseContentType,
  );
  res.setHeader("Cache-Control", "private, max-age=60");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const disposition = input.download
    ? "attachment"
    : isInlineAttachmentContentType(responseContentType)
      ? "inline"
      : "attachment";
  if (disposition === "attachment") {
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
  }
  res.setHeader(
    "Content-Disposition",
    String(res.getHeader("Content-Disposition")).replace(/^attachment;/, `${disposition};`),
  );

  object.stream.on("error", (err) => {
    next(err);
  });
  if (range.kind === "range") {
    const rangeLength = range.end - range.start + 1;
    res.status(206);
    res.setHeader("Content-Length", String(rangeLength));
    res.setHeader(
      "Content-Range",
      `bytes ${range.start}-${range.end}/${contentLength}`,
    );
    object.stream.pipe(res);
    return;
  }

  res.setHeader(
    "Content-Length",
    String(contentLength || object.contentLength || 0),
  );
  object.stream.pipe(res);
}

export interface ServableAsset {
  companyId: string;
  objectKey: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  originalFilename: string | null;
  purgedAt?: Date | string | null;
}

/** Streams a stored asset with the any-type serving headers. */
export async function serveAssetContent(input: {
  storage: StorageService;
  asset: ServableAsset;
  rangeHeader: string | undefined;
  parseRange: (size: number) => ReturnType<Request["range"]>;
  res: Response;
  next: NextFunction;
}) {
  const { asset, res, next } = input;
  if (sendPurgedContent(res, asset.purgedAt)) return;
  const rawRange = input.rangeHeader;
  const rangeSyntax = rawRange && /^bytes=(\d*)-(\d*)$/i.exec(rawRange);
  const emptyRead = asset.byteSize === 0 && rangeSyntax?.[1] === "0";
  const ranges = rawRange && !emptyRead ? input.parseRange(asset.byteSize) : undefined;
  res.setHeader("Accept-Ranges", "bytes");
  if (/^[a-f0-9]{64}$/.test(asset.sha256)) res.setHeader("ETag", `"${asset.sha256}"`);
  if (rawRange && (!rangeSyntax || (!rangeSyntax[1] && !rangeSyntax[2])
    || (!emptyRead && (!Array.isArray(ranges) || ranges.length !== 1)))) {
    res.setHeader("Content-Range", `bytes */${asset.byteSize}`);
    res.status(416).end();
    return;
  }
  const range = Array.isArray(ranges) ? ranges[0] : undefined;
  const object = await input.storage.getObject(asset.companyId, asset.objectKey, range ? { range } : undefined);
  const responseContentType = assetServingContentType({
    companyId: asset.companyId,
    objectKey: asset.objectKey,
    contentType: asset.contentType || object.contentType,
  });
  const inlineSafe = isInlineAttachmentContentType(responseContentType);
  res.setHeader("Content-Type", responseContentType);
  res.setHeader("Content-Length", String(range ? range.end - range.start + 1 : asset.byteSize || object.contentLength || 0));
  if (range) {
    res.status(206);
    res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${asset.byteSize}`);
  }
  res.setHeader("Cache-Control", "private, max-age=60");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!inlineSafe) {
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
  }
  res.setHeader(
    "Content-Disposition",
    contentDispositionHeader(inlineSafe ? "inline" : "attachment", asset.originalFilename ?? "asset"),
  );

  object.stream.on("error", (err) => {
    next(err);
  });
  res.on("close", () => object.stream.destroy());
  object.stream.pipe(res);
}

export async function sendIssueDocumentPdf(input: {
  res: Response;
  issue: { id: string; identifier: string | null };
  document: { key: string; title: string | null; body?: string | null; latestRevisionNumber: number | null };
}) {
  const { res, issue, document } = input;
  const title = document.title?.trim() || document.key;
  const pdf = await renderDocumentPdf({
    title,
    markdown: document.body ?? "",
    issueIdentifier: issue.identifier ?? String(issue.id ?? ""),
    revisionNumber: document.latestRevisionNumber ?? 1,
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="' + documentExportFileName(title, "pdf") + '"',
  );
  res.setHeader("Content-Length", String(pdf.byteLength));
  res.end(pdf);
}
