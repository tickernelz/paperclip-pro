import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Request, Response } from "express";
import multer from "multer";
import { resolvePaperclipInstanceRoot } from "./home-paths.js";
import { badRequest, payloadTooLarge } from "./errors.js";
import { formatAttachmentSize, getMaxAttachmentBytes } from "./attachment-types.js";

/** A multipart file streamed to a temp file under the instance data dir, with size and SHA-256 measured on the way in. */
export interface StagedUploadFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  path: string;
  size: number;
  sha256: string;
}

/** Temp directory for in-flight uploads; lives under the instance data dir so large files never land on a small /tmp. */
export function resolveAttachmentUploadTempDir(): string {
  return path.resolve(resolvePaperclipInstanceRoot(), "data", "tmp", "uploads");
}

function createStagingStorage(tempDir: string): multer.StorageEngine {
  return {
    _handleFile(_req, file, callback) {
      const target = path.join(tempDir, `${randomUUID()}.upload`);
      const hash = createHash("sha256");
      let size = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          hash.update(chunk);
          size += chunk.length;
          done(null, chunk);
        },
      });
      fs.mkdir(tempDir, { recursive: true })
        .then(() => pipeline(file.stream, meter, createWriteStream(target, { flags: "wx" })))
        .then(
          () => callback(null, { path: target, size, sha256: hash.digest("hex") } as Partial<Express.Multer.File>),
          (error: unknown) => {
            void fs.rm(target, { force: true }).finally(() => callback(error as Error));
          },
        );
    },
    _removeFile(_req, file, callback) {
      if (!file.path) return callback(null);
      fs.rm(file.path, { force: true }).then(() => callback(null), (error: Error) => callback(error));
    },
  };
}

/** Streams the multipart field `file` to a temp file under the current limit (413 above it); always pass the result to `removeStagedUpload`. */
export async function stageSingleFileUpload(
  req: Request,
  res: Response,
  options: { limitMessage: (limit: string) => string; maxBytes?: number; tempDir?: string },
): Promise<StagedUploadFile | null> {
  const maxBytes = options.maxBytes ?? getMaxAttachmentBytes();
  const upload = multer({
    storage: createStagingStorage(options.tempDir ?? resolveAttachmentUploadTempDir()),
    defParamCharset: "utf8",
    limits: { fileSize: maxBytes, files: 1 },
  }).single("file");
  try {
    await new Promise<void>((resolve, reject) => {
      upload(req, res, (err: unknown) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        throw payloadTooLarge(options.limitMessage(formatAttachmentSize(maxBytes)), {
          code: "attachment_too_large",
          maxBytes,
        });
      }
      throw badRequest(err.message);
    }
    throw err;
  }
  const file = (req as Request & { file?: StagedUploadFile }).file;
  return file ?? null;
}

/** Deletes a staged upload's temp file; safe to call after the file was moved into storage. */
export async function removeStagedUpload(file: StagedUploadFile | null | undefined): Promise<void> {
  if (file?.path) await fs.rm(file.path, { force: true });
}
