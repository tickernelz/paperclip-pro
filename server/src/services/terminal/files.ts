import { constants as fsConstants, createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { badRequest, conflict, notFound } from "../../errors.js";

export interface TerminalFileRead {
  path: string;
  size: number;
  stream: Readable;
}

export interface TerminalFileAccess {
  saveUpload(fileName: string, sourcePath: string): Promise<{ path: string; bytes: number }>;
  openDownload(requestedPath: string): Promise<TerminalFileRead>;
}

export const TERMINAL_UPLOAD_EXISTS_MESSAGE = "A file with that name already exists in the terminal directory";

export function validateTerminalUploadFileName(raw: string): string {
  const name = raw.trim();
  if (!name || name.length > 255 || name === "." || name === ".." || /[/\\\0]/.test(name)) {
    throw badRequest("Upload file name must be a plain file name without directory parts");
  }
  return name;
}

export function validateTerminalDownloadPath(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw badRequest("Query parameter path is required");
  }
  if (raw.includes("\0")) throw badRequest("Download path is invalid");
  return raw.trim();
}

export function isPathInside(root: string, candidate: string, pathApi: typeof path.posix | typeof path = path): boolean {
  const relative = pathApi.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !pathApi.isAbsolute(relative));
}

export function localTerminalFiles(cwd: string): TerminalFileAccess {
  return {
    async saveUpload(fileName, sourcePath) {
      const name = validateTerminalUploadFileName(fileName);
      const root = await fs.realpath(cwd);
      const target = path.join(root, name);
      const handle = await fs
        .open(
          target,
          fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
          0o644,
        )
        .catch((err: NodeJS.ErrnoException) => {
          if (err.code === "EEXIST" || err.code === "ELOOP") {
            throw conflict(TERMINAL_UPLOAD_EXISTS_MESSAGE);
          }
          throw err;
        });
      try {
        await pipeline(createReadStream(sourcePath), handle.createWriteStream());
      } catch (err) {
        await fs.rm(target, { force: true });
        throw err;
      } finally {
        await handle.close().catch(() => undefined);
      }
      const stat = await fs.stat(target);
      return { path: target, bytes: stat.size };
    },
    async openDownload(requestedPath) {
      const requested = validateTerminalDownloadPath(requestedPath);
      const root = await fs.realpath(cwd);
      const lexicalRoot = path.resolve(cwd);
      const resolved = path.resolve(lexicalRoot, requested);
      if (!isPathInside(lexicalRoot, resolved) && !isPathInside(root, resolved)) {
        throw badRequest("Download path must stay inside the terminal directory");
      }
      const real = await fs.realpath(resolved).catch(() => null);
      if (!real) throw notFound("File not found");
      if (!isPathInside(root, real)) {
        throw badRequest("Download path must stay inside the terminal directory");
      }
      const stat = await fs.stat(real);
      if (!stat.isFile()) throw badRequest("Download path is not a file");
      return { path: real, size: stat.size, stream: createReadStream(real) };
    },
  };
}
