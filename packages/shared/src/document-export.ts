const DOCUMENT_EXPORT_FALLBACK_SLUG = "document";
const DOCUMENT_EXPORT_SLUG_MAX_LENGTH = 80;

const DOCUMENT_FORMAT_EXTENSIONS: Record<string, string> = {
  markdown: "md",
  html: "html",
  json: "json",
  text: "txt",
};

export function documentExportSlug(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, DOCUMENT_EXPORT_SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");
  return slug || DOCUMENT_EXPORT_FALLBACK_SLUG;
}

export function documentExportExtension(format: string | null | undefined): string {
  return DOCUMENT_FORMAT_EXTENSIONS[(format ?? "").trim().toLowerCase()] ?? "md";
}

export function documentExportFileName(title: string, extension: string): string {
  const normalized = extension.replace(/^\.+/, "").toLowerCase() || "md";
  return `${documentExportSlug(title)}.${normalized}`;
}
