import { and, eq } from "drizzle-orm";
import type { Db } from "@tickernelz/paperclip-pro-db";
import { assets, issueAttachments } from "@tickernelz/paperclip-pro-db";
import { isUuidLike } from "@tickernelz/paperclip-pro-shared";
import { assetService } from "../assets.js";
import { getStorageService } from "../../storage/index.js";
import type { StorageService } from "../../storage/types.js";
import { localBrowserFailure } from "./errors.js";

const DATA_URL = /^data:([^;,]+)?(;base64)?,(.*)$/s;

export interface DecodedDataUrl {
  contentType: string;
  bytes: Buffer;
}

export function decodeDataUrl(dataUrl: string): DecodedDataUrl | null {
  if (typeof dataUrl !== "string" || dataUrl.length === 0) return null;
  const match = DATA_URL.exec(dataUrl);
  if (!match) return null;
  const contentType = (match[1] ?? "application/octet-stream").trim().toLowerCase();
  const isBase64 = match[2] === ";base64";
  const payload = match[3] ?? "";
  let bytes: Buffer;
  if (isBase64) {
    const normalized = payload.replace(/\s+/g, "");
    if (normalized.length === 0 || !/^[A-Za-z0-9+/_-]*={0,2}$/.test(normalized)) return null;
    bytes = Buffer.from(normalized, "base64");
  } else {
    try {
      bytes = Buffer.from(decodeURIComponent(payload), "utf8");
    } catch {
      return null;
    }
  }
  if (bytes.length === 0) return null;
  return { contentType, bytes };
}

async function readStreamBytes(stream: NodeJS.ReadableStream, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > limit) {
      throw localBrowserFailure("local_browser_result_too_large", `Attachment is larger than the ${limit} byte limit`, {
        status: 413,
      });
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export async function storeLocalBrowserAttachment(
  db: Db,
  input: {
    companyId: string;
    namespace: string;
    originalFilename: string;
    contentType: string;
    bytes: Buffer;
    createdByUserId: string | null;
    createdByAgentId: string | null;
    runId: string | null;
    issueId: string | null;
    storage?: StorageService;
  },
): Promise<{ attachmentId: string; byteSize: number; originalFilename: string; contentType: string }> {
  const storage = input.storage ?? getStorageService();
  const stored = await storage.putFile({
    companyId: input.companyId,
    namespace: input.namespace,
    originalFilename: input.originalFilename,
    contentType: input.contentType,
    body: input.bytes,
  });
  const asset = await assetService(db).create(input.companyId, {
    provider: stored.provider,
    objectKey: stored.objectKey,
    contentType: stored.contentType,
    byteSize: stored.byteSize,
    sha256: stored.sha256,
    originalFilename: stored.originalFilename,
    createdByAgentId: input.createdByAgentId,
    createdByUserId: input.createdByUserId,
  });
  if (input.issueId && isUuidLike(input.issueId)) {
    await db
      .insert(issueAttachments)
      .values({
        companyId: input.companyId,
        issueId: input.issueId,
        assetId: asset.id,
        originatingRunId: input.runId && isUuidLike(input.runId) ? input.runId : null,
      })
      .onConflictDoNothing();
  }
  return {
    attachmentId: asset.id,
    byteSize: stored.byteSize,
    originalFilename: stored.originalFilename ?? input.originalFilename,
    contentType: stored.contentType,
  };
}

export async function readTaskAttachment(
  db: Db,
  input: { companyId: string; attachmentId: string; issueId?: string | null; storage?: StorageService; maxBytes: number },
): Promise<{ bytes: Buffer; contentType: string; originalFilename: string }> {
  const [row] = await db
    .select({
      objectKey: assets.objectKey,
      contentType: assets.contentType,
      originalFilename: assets.originalFilename,
      issueId: issueAttachments.issueId,
    })
    .from(issueAttachments)
    .innerJoin(assets, eq(issueAttachments.assetId, assets.id))
    .where(and(eq(issueAttachments.companyId, input.companyId), eq(issueAttachments.id, input.attachmentId)))
    .limit(1);
  if (!row) {
    throw localBrowserFailure("local_browser_unsupported", "Attachment is not part of this company's task attachments", {
      status: 404,
    });
  }
  if (input.issueId && row.issueId !== input.issueId) {
    throw localBrowserFailure("local_browser_unsupported", "Attachment belongs to a different task", { status: 404 });
  }
  const storage = input.storage ?? getStorageService();
  const object = await storage.getObject(input.companyId, row.objectKey);
  const bytes = await readStreamBytes(object.stream, input.maxBytes);
  return {
    bytes,
    contentType: row.contentType || object.contentType || "application/octet-stream",
    originalFilename: row.originalFilename ?? "attachment",
  };
}
