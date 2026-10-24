import { randomBytes } from "node:crypto";
import { constants as fsConstants, createReadStream, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
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
  savePastedImage(fileName: string, sourcePath: string): Promise<{ path: string; bytes: number }>;
  openDownload(requestedPath: string): Promise<TerminalFileRead>;
}

const PASTED_IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
};

export function pastedImageFileName(mimeType: string, now: number = Date.now()): string {
  const extension = PASTED_IMAGE_EXTENSIONS[mimeType.toLowerCase()];
  if (!extension) throw badRequest("Pasted file must be a PNG, JPEG, GIF, WebP or BMP image");
  return `pasted-image-${now}-${randomBytes(4).toString("hex")}.${extension}`;
}

export const PASTED_IMAGE_DIR_PREFIX = "paperclip-pasted";

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

const REMOTE_PASTED_IMAGE_SCRIPT = [
  'd="${TMPDIR:-/tmp}/' + PASTED_IMAGE_DIR_PREFIX + '-$(id -u)"',
  "umask 077",
  'mkdir -p "$d" || exit 1',
  '[ -d "$d" ] && [ ! -L "$d" ] && [ -O "$d" ] || exit 1',
  'case "$1" in */*|"") exit 2 ;; esac',
  "set -C",
  'cat > "$d/$1" || exit 1',
  'printf "%s" "$d/$1"',
].join("; ");

export function remotePastedImageCommand(fileName: string): string {
  return `sh -c ${shellQuote(REMOTE_PASTED_IMAGE_SCRIPT)} sh ${shellQuote(validateTerminalUploadFileName(fileName))}`;
}

async function ensurePrivateDirectory(directory: string): Promise<string> {
  await fs.mkdir(directory, { mode: 0o700 }).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== "EEXIST") throw err;
  });
  const stat = await fs.lstat(directory);
  const ownerOk = typeof process.getuid !== "function" || stat.uid === process.getuid();
  if (!stat.isDirectory() || stat.isSymbolicLink() || !ownerOk) {
    throw conflict("The pasted image directory is not a private directory owned by this user");
  }
  return directory;
}

export async function saveLocalPastedImage(
  fileName: string,
  sourcePath: string,
  root: string = tmpdir(),
): Promise<{ path: string; bytes: number }> {
  const name = validateTerminalUploadFileName(fileName);
  const uid = typeof process.getuid === "function" ? process.getuid() : "user";
  const directory = await ensurePrivateDirectory(path.join(root, `${PASTED_IMAGE_DIR_PREFIX}-${uid}`));
  const target = path.join(directory, name);
  const handle = await fs.open(
    target,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
    0o600,
  );
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
    savePastedImage(fileName, sourcePath) {
      return saveLocalPastedImage(fileName, sourcePath);
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
