import { afterEach, describe, it, expect, vi } from "vitest";
import {
  ALLOW_ALL_ATTACHMENT_TYPES,
  assetServingContentType,
  attachmentServingContentType,
  contentDispositionHeader,
  formatAttachmentSize,
  INLINE_ATTACHMENT_TYPES,
  inferOfficeAttachmentContentTypeFromFilename,
  isActiveAttachmentContentType,
  isAllowedContentType,
  isInlineAttachmentContentType,
  matchesContentType,
  MAX_ATTACHMENT_BYTES,
  normalizeContentType,
  normalizeUploadAttachmentContentType,
  parseAllowedTypes,
} from "../attachment-types.js";

describe("parseAllowedTypes", () => {
  it("allows every type when input is undefined", () => {
    expect(parseAllowedTypes(undefined)).toEqual([...ALLOW_ALL_ATTACHMENT_TYPES]);
  });

  it("allows every type when input is empty string", () => {
    expect(parseAllowedTypes("")).toEqual([...ALLOW_ALL_ATTACHMENT_TYPES]);
    expect(parseAllowedTypes(" , ")).toEqual([...ALLOW_ALL_ATTACHMENT_TYPES]);
  });

  it("parses comma-separated types", () => {
    expect(parseAllowedTypes("image/*,application/pdf")).toEqual([
      "image/*",
      "application/pdf",
    ]);
  });

  it("trims whitespace", () => {
    expect(parseAllowedTypes(" image/png , application/pdf ")).toEqual([
      "image/png",
      "application/pdf",
    ]);
  });

  it("lowercases entries", () => {
    expect(parseAllowedTypes("Application/PDF")).toEqual(["application/pdf"]);
  });

  it("filters empty segments", () => {
    expect(parseAllowedTypes("image/png,,application/pdf,")).toEqual([
      "image/png",
      "application/pdf",
    ]);
  });
});

describe("matchesContentType", () => {
  it("matches exact types", () => {
    const patterns = ["application/pdf", "image/png"];
    expect(matchesContentType("application/pdf", patterns)).toBe(true);
    expect(matchesContentType("image/png", patterns)).toBe(true);
    expect(matchesContentType("text/plain", patterns)).toBe(false);
  });

  it("matches /* wildcard patterns", () => {
    const patterns = ["image/*"];
    expect(matchesContentType("image/png", patterns)).toBe(true);
    expect(matchesContentType("image/jpeg", patterns)).toBe(true);
    expect(matchesContentType("image/svg+xml", patterns)).toBe(true);
    expect(matchesContentType("application/pdf", patterns)).toBe(false);
  });

  it("matches .* wildcard patterns", () => {
    const patterns = ["application/vnd.openxmlformats-officedocument.*"];
    expect(
      matchesContentType(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        patterns,
      ),
    ).toBe(true);
    expect(
      matchesContentType(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        patterns,
      ),
    ).toBe(true);
    expect(matchesContentType("application/pdf", patterns)).toBe(false);
  });

  it("is case-insensitive", () => {
    const patterns = ["application/pdf"];
    expect(matchesContentType("APPLICATION/PDF", patterns)).toBe(true);
    expect(matchesContentType("Application/Pdf", patterns)).toBe(true);
  });

  it("combines exact and wildcard patterns", () => {
    const patterns = ["image/*", "application/pdf", "text/*"];
    expect(matchesContentType("image/webp", patterns)).toBe(true);
    expect(matchesContentType("application/pdf", patterns)).toBe(true);
    expect(matchesContentType("text/csv", patterns)).toBe(true);
    expect(matchesContentType("application/zip", patterns)).toBe(false);
  });

  it("handles plain * as allow-all wildcard", () => {
    const patterns = ["*"];
    expect(matchesContentType("image/png", patterns)).toBe(true);
    expect(matchesContentType("application/pdf", patterns)).toBe(true);
    expect(matchesContentType("text/plain", patterns)).toBe(true);
    expect(matchesContentType("application/zip", patterns)).toBe(true);
  });

});

describe("isAllowedContentType", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts any content type when no operator restriction is configured", () => {
    vi.stubEnv("PAPERCLIP_ALLOWED_ATTACHMENT_TYPES", "");
    for (const contentType of [
      "application/x-msdos-program",
      "application/x-msdownload",
      "application/vnd.android.package-archive",
      "application/octet-stream",
      "application/x-unknown-thing",
      "text/html",
      "image/svg+xml",
      "audio/ogg",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]) {
      expect(isAllowedContentType(contentType)).toBe(true);
    }
  });

  it("enforces PAPERCLIP_ALLOWED_ATTACHMENT_TYPES when an operator sets it", () => {
    vi.stubEnv("PAPERCLIP_ALLOWED_ATTACHMENT_TYPES", "image/*,application/pdf");
    expect(isAllowedContentType("image/png")).toBe(true);
    expect(isAllowedContentType("application/pdf")).toBe(true);
    expect(isAllowedContentType("application/x-msdos-program")).toBe(false);
    expect(isAllowedContentType("application/octet-stream")).toBe(false);
    vi.unstubAllEnvs();
    vi.stubEnv("PAPERCLIP_ALLOWED_ATTACHMENT_TYPES", "");
    expect(isAllowedContentType("application/x-msdos-program")).toBe(true);
  });
});

describe("normalizeContentType", () => {
  it("lowercases and trims explicit types", () => {
    expect(normalizeContentType(" Application/Zip ")).toBe("application/zip");
  });

  it("normalizes provider Content-Type header parameters to the MIME essence", () => {
    expect(normalizeContentType(" Text/Plain ; charset=utf-8 ")).toBe(
      "text/plain",
    );
    expect(normalizeContentType("image/svg+xml; charset=utf-8")).toBe(
      "image/svg+xml",
    );
  });

  it("falls back to octet-stream for values outside the RFC 7231 type/subtype grammar", () => {
    for (const value of ["image/png, text/html", "image/png text/html", "image/png,text/html; charset=utf-8", "image", "image/", "/png", "image/png/html", "image/p\u00e9g", "image/png\r\nx-evil: 1"]) {
      expect(normalizeContentType(value)).toBe("application/octet-stream");
    }
    expect(normalizeContentType("application/vnd.ms-excel")).toBe("application/vnd.ms-excel");
    expect(normalizeContentType("application/x-msdos-program")).toBe("application/x-msdos-program");
  });

  it("falls back to octet-stream when the type is missing", () => {
    expect(normalizeContentType(undefined)).toBe("application/octet-stream");
    expect(normalizeContentType("")).toBe("application/octet-stream");
  });
});

describe("inferOfficeAttachmentContentTypeFromFilename", () => {
  it("infers common Office content types from filenames", () => {
    expect(inferOfficeAttachmentContentTypeFromFilename("notes.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(inferOfficeAttachmentContentTypeFromFilename("raw-data.xlsx")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(inferOfficeAttachmentContentTypeFromFilename("deck.pptx")).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    expect(inferOfficeAttachmentContentTypeFromFilename("legacy.doc")).toBe("application/msword");
    expect(inferOfficeAttachmentContentTypeFromFilename("legacy.xls")).toBe("application/vnd.ms-excel");
    expect(inferOfficeAttachmentContentTypeFromFilename("legacy.ppt")).toBe("application/vnd.ms-powerpoint");
  });

  it("does not infer unknown extensions", () => {
    expect(inferOfficeAttachmentContentTypeFromFilename("payload.bin")).toBeNull();
    expect(inferOfficeAttachmentContentTypeFromFilename(undefined)).toBeNull();
  });
});

describe("normalizeUploadAttachmentContentType", () => {
  it("keeps explicit content types unchanged", () => {
    expect(
      normalizeUploadAttachmentContentType({
        contentType: "application/pdf",
        originalFilename: "raw-data.xlsx",
      }),
    ).toBe("application/pdf");
  });

  it("infers Office content type for generic binary uploads", () => {
    expect(
      normalizeUploadAttachmentContentType({
        contentType: "application/octet-stream",
        originalFilename: "raw-data.xlsx",
      }),
    ).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  });

  it("keeps generic binary uploads generic when the inferred Office type is not allowed", () => {
    expect(
      normalizeUploadAttachmentContentType({
        contentType: "application/octet-stream",
        originalFilename: "raw-data.xlsx",
        isAllowedContentType: (contentType) => contentType === "application/octet-stream",
      }),
    ).toBe("application/octet-stream");
  });

  it("stores a malformed declared type as octet-stream", () => {
    expect(
      normalizeUploadAttachmentContentType({
        contentType: "image/png, text/html",
        originalFilename: "chart.png",
      }),
    ).toBe("application/octet-stream");
  });

  it("keeps generic binary uploads generic for unknown filenames", () => {
    expect(
      normalizeUploadAttachmentContentType({
        contentType: "application/octet-stream",
        originalFilename: "payload.bin",
      }),
    ).toBe("application/octet-stream");
  });
});

describe("isInlineAttachmentContentType", () => {
  it("allows the configured inline-safe types", () => {
    for (const contentType of ["image/png", "application/pdf", "text/plain", "video/mp4"]) {
      expect(isInlineAttachmentContentType(contentType)).toBe(true);
    }
  });

  it("rejects potentially unsafe or binary download types", () => {
    expect(INLINE_ATTACHMENT_TYPES).not.toContain("text/html");
    expect(isInlineAttachmentContentType("text/html")).toBe(false);
    expect(isInlineAttachmentContentType("image/svg+xml")).toBe(false);
    expect(isInlineAttachmentContentType("Image/SVG+XML; charset=utf-8")).toBe(false);
    expect(isInlineAttachmentContentType("application/zip")).toBe(false);
    expect(isInlineAttachmentContentType("application/x-msdos-program")).toBe(false);
  });
});

describe("attachmentServingContentType", () => {
  it("downgrades browser-executable content to octet-stream", () => {
    for (const contentType of [
      "text/html",
      "text/html; charset=utf-8",
      "application/xhtml+xml",
      "image/svg+xml",
      "application/javascript",
      "text/javascript",
      "application/xml",
      "text/xml",
      "application/rss+xml",
    ]) {
      expect(isActiveAttachmentContentType(contentType)).toBe(true);
      expect(attachmentServingContentType(contentType)).toBe("application/octet-stream");
    }
  });

  it("downgrades malformed stored types instead of passing them to the browser", () => {
    expect(attachmentServingContentType("image/png, text/html")).toBe("application/octet-stream");
    expect(attachmentServingContentType("image/png; charset=\"x, text/html\"")).toBe("image/png");
    expect(isInlineAttachmentContentType("image/png, text/html")).toBe(false);
    expect(assetServingContentType({ companyId: "c", objectKey: "c/assets/companies/logo.svg", contentType: "image/svg+xml" })).toBe("image/svg+xml");
    expect(assetServingContentType({ companyId: "c", objectKey: "c/issues/i/logo.svg", contentType: "image/svg+xml" })).toBe("application/octet-stream");
    expect(assetServingContentType({ companyId: "c", objectKey: "c/assets/companies/logo.png", contentType: "image/png, text/html" })).toBe("application/octet-stream");
  });

  it("keeps passive types and falls back to octet-stream when empty", () => {
    expect(attachmentServingContentType("application/x-msdos-program")).toBe("application/x-msdos-program");
    expect(attachmentServingContentType("text/plain; charset=utf-8")).toBe("text/plain; charset=utf-8");
    expect(attachmentServingContentType("image/png")).toBe("image/png");
    expect(attachmentServingContentType("")).toBe("application/octet-stream");
    expect(attachmentServingContentType(null)).toBe("application/octet-stream");
    expect(isActiveAttachmentContentType("application/json")).toBe(false);
  });
});

describe("contentDispositionHeader", () => {
  it("keeps plain ASCII names as a single quoted filename", () => {
    expect(contentDispositionHeader("attachment", "pantat lutpi.bat")).toBe('attachment; filename="pantat lutpi.bat"');
  });

  it("adds an RFC 5987 filename* and an ASCII fallback for other names", () => {
    expect(contentDispositionHeader("inline", "r\u00e9sum\u00e9 (1).pdf")).toBe(
      "inline; filename=\"r_sum_ (1).pdf\"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%281%29.pdf",
    );
    expect(contentDispositionHeader("attachment", 'a"b\\c.txt')).toBe(
      "attachment; filename=\"a_b_c.txt\"; filename*=UTF-8''a%22b%5Cc.txt",
    );
  });
});

describe("formatAttachmentSize", () => {
  it("renders the default deployment cap as a round megabyte figure", () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(10 * 1024 * 1024);
    expect(formatAttachmentSize(MAX_ATTACHMENT_BYTES)).toBe("10 MB");
  });

  it("keeps one decimal place for fractional sizes and drops a trailing .0", () => {
    expect(formatAttachmentSize(10.5 * 1024 * 1024)).toBe("10.5 MB");
    expect(formatAttachmentSize(1024 * 1024)).toBe("1 MB");
    expect(formatAttachmentSize(2.25 * 1024 * 1024)).toBe("2.3 MB");
  });

  it("renders sub-megabyte values in kilobytes", () => {
    expect(formatAttachmentSize(1024)).toBe("1 KB");
    expect(formatAttachmentSize(512 * 1024)).toBe("512 KB");
    expect(formatAttachmentSize(1536)).toBe("1.5 KB");
  });

  it("steps up to gigabytes for very large caps", () => {
    expect(formatAttachmentSize(2 * 1024 * 1024 * 1024)).toBe("2 GB");
  });

  it("keeps sub-kilobyte values in bytes rather than collapsing to 0 KB", () => {
    expect(formatAttachmentSize(10)).toBe("10 bytes");
    expect(formatAttachmentSize(1)).toBe("1 byte");
    expect(formatAttachmentSize(1023)).toBe("1023 bytes");
  });

  it("never renders a nonsense figure for a degenerate input", () => {
    expect(formatAttachmentSize(0)).toBe("0 bytes");
    expect(formatAttachmentSize(-1)).toBe("0 bytes");
    expect(formatAttachmentSize(Number.NaN)).toBe("0 bytes");
  });
});
