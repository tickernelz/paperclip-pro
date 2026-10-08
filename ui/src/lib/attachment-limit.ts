import type { EffectiveAttachmentLimit } from "@tickernelz/paperclip-pro-shared";

const SIZE_UNITS = ["KB", "MB", "GB"] as const;

let knownLimit: EffectiveAttachmentLimit | null = null;

/** Formats a byte count like the server's formatAttachmentSize (1024-based, one decimal). */
export function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 bytes";
  if (bytes < 1024) return bytes === 1 ? "1 byte" : `${bytes} bytes`;
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < SIZE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1).replace(/\.0$/, "")} ${SIZE_UNITS[unitIndex]}`;
}

/** Records the server's effective upload limit as reported by /api/health. */
export function setAttachmentLimit(limit: EffectiveAttachmentLimit | null | undefined): void {
  if (!limit || !Number.isFinite(limit.maxBytes) || limit.maxBytes <= 0) return;
  knownLimit = { maxBytes: limit.maxBytes, source: limit.source };
}

/** The last upload limit reported by the server, or null before health has loaded. */
export function getAttachmentLimit(): EffectiveAttachmentLimit | null {
  return knownLimit;
}

export function resetAttachmentLimitForTests(): void {
  knownLimit = null;
}

/** The message shown when a file exceeds the upload limit. */
export function attachmentTooLargeMessage(maxBytes = knownLimit?.maxBytes): string {
  return maxBytes ? `File is larger than the ${formatAttachmentSize(maxBytes)} limit` : "File is larger than the upload size limit";
}

/** True when the file exceeds the known server limit. */
export function exceedsAttachmentLimit(file: Blob): boolean {
  return knownLimit !== null && file.size > knownLimit.maxBytes;
}
