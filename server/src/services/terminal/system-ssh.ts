import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants, createReadStream, promises as fs, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { TerminalSshHost } from "@tickernelz/paperclip-pro-shared";
import { HttpError, badRequest, conflict, notFound, unprocessable } from "../../errors.js";
import {
  TERMINAL_UPLOAD_EXISTS_MESSAGE,
  remotePastedImageCommand,
  shellQuote,
  validateTerminalDownloadPath,
  validateTerminalUploadFileName,
  type TerminalFileAccess,
} from "./files.js";
import { buildLocalTerminalEnv, resolveLoginShell, spawnLocalTerminal, type TerminalProcess } from "./process.js";

export const SSH_FILE_TIMEOUT_MS = 60_000;

export const SSH_FILE_IDLE_TIMEOUT_MS = 120_000;

export const SSH_CONNECT_TIMEOUT_SECONDS = 15;

const SSH_EXIT_INVALID_NAME = 2;

const SSH_EXIT_NOT_FOUND = 3;

const SSH_EXIT_NOT_REGULAR = 4;

const SSH_EXIT_OUTSIDE_HOME = 5;

const SSH_EXIT_EXISTS = 17;

const UPLOAD_SCRIPT = [
  'cd "$HOME" || exit 1',
  'h=$(pwd -P)',
  'case "$1" in ""|*/*) exit 2 ;; esac',
  '[ -e "$h/$1" ] && exit 17',
  "set -C",
  'cat > "$h/$1" || exit 1',
  'printf "%s" "$h/$1"',
].join("; ");

const DOWNLOAD_STAT_SCRIPT = [
  'cd "$HOME" || exit 1',
  'h=$(pwd -P)',
  'case "/$1/" in */../*) exit 5 ;; esac',
  'case "$1" in /*) p="$1" ;; *) p="$h/$1" ;; esac',
  "n=0",
  'while [ -L "$p" ]; do n=$((n+1)); [ "$n" -gt 32 ] && exit 1; t=$(readlink -- "$p") || exit 1; case "$t" in /*) p="$t" ;; *) p="$(dirname -- "$p")/$t" ;; esac; done',
  'cd "$(dirname -- "$p")" 2>/dev/null || exit 3',
  'f="$(pwd -P)/$(basename -- "$p")"',
  'case "$f" in "$h"/*) : ;; *) exit 5 ;; esac',
  '[ -e "$f" ] || exit 3',
  '[ -f "$f" ] || exit 4',
  's=$(wc -c < "$f") || exit 1',
  'printf "%s\\n" "$f"',
  'printf "%s" "$s"',
].join("; ");

let sshBinaryCache: string | null = null;

export function resolveSshBinary(env: NodeJS.ProcessEnv = process.env): string {
  if (sshBinaryCache) return sshBinaryCache;
  for (const directory of (env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, "ssh");
    try {
      accessSync(candidate, fsConstants.X_OK);
      if (!statSync(candidate).isFile()) continue;
      sshBinaryCache = candidate;
      return candidate;
    } catch {
      continue;
    }
  }
  throw unprocessable("The OpenSSH client (ssh) was not found on the server PATH");
}

export function systemSshArgs(host: TerminalSshHost): string[] {
  if (host.source === "config") return ["--", host.name];
  return host.port === null ? ["--", host.destination] : ["-p", String(host.port), "--", host.destination];
}

function remoteArgs(host: TerminalSshHost, command: string): string[] {
  return [
    "-o",
    "BatchMode=yes",
    "-o",
    `ConnectTimeout=${SSH_CONNECT_TIMEOUT_SECONDS}`,
    ...systemSshArgs(host),
    command,
  ];
}

function sshEnv(): Record<string, string> {
  return buildLocalTerminalEnv(resolveLoginShell());
}

interface RemoteRun {
  stdout: string;
  stderr: string;
  code: number | null;
}

function runRemote(
  host: TerminalSshHost,
  command: string,
  options: { inputPath?: string; timeoutMs?: number } = {},
): Promise<RemoteRun> {
  const binary = resolveSshBinary();
  const timeoutMs = options.timeoutMs ?? SSH_FILE_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const child = spawn(binary, remoteArgs(host, command), {
      env: sshEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (err: HttpError | null, result?: RemoteRun) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(result!);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(unprocessable(`Remote ssh command timed out after ${Math.round(timeoutMs / 1000)} seconds`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = (stdout + chunk).slice(0, 64 * 1024);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(0, 4 * 1024);
    });
    child.on("error", (err: Error) => finish(unprocessable(`Could not run ssh: ${err.message}`)));
    child.on("close", (code) => finish(null, { stdout, stderr, code }));
    if (options.inputPath) {
      pipeline(createReadStream(options.inputPath), child.stdin).catch(() => undefined);
    } else {
      child.stdin.end();
    }
  });
}

function remoteFailure(result: RemoteRun, fallback: string): HttpError {
  if (result.code === SSH_EXIT_INVALID_NAME) {
    return badRequest("Upload file name must be a plain file name without directory parts");
  }
  if (result.code === SSH_EXIT_NOT_FOUND) return notFound("File not found");
  if (result.code === SSH_EXIT_NOT_REGULAR) return badRequest("Download path is not a file");
  if (result.code === SSH_EXIT_OUTSIDE_HOME) {
    return badRequest("Download path must stay inside the terminal directory");
  }
  if (result.code === SSH_EXIT_EXISTS) return conflict(TERMINAL_UPLOAD_EXISTS_MESSAGE);
  return unprocessable(result.stderr.trim() || fallback);
}

function streamRemoteFile(host: TerminalSshHost, remotePath: string): Readable {
  const binary = resolveSshBinary();
  const child = spawn(binary, remoteArgs(host, `cat -- ${shellQuote(remotePath)}`), {
    env: sshEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stream = child.stdout;
  let stderr = "";
  let idle: ReturnType<typeof setTimeout> | null = null;
  const cleanup = () => {
    if (idle) clearTimeout(idle);
    idle = null;
  };
  const resetIdle = () => {
    cleanup();
    idle = setTimeout(() => {
      child.kill("SIGKILL");
      stream.destroy(new Error("Remote ssh download stalled"));
    }, SSH_FILE_IDLE_TIMEOUT_MS);
  };
  resetIdle();
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(0, 4 * 1024);
  });
  stream.on("data", resetIdle);
  stream.pause();
  stream.on("end", cleanup);
  stream.on("close", () => {
    cleanup();
    if (!stream.readableEnded) child.kill("SIGKILL");
  });
  child.on("error", (err: Error) => stream.destroy(unprocessable(`Could not run ssh: ${err.message}`)));
  child.on("close", (code) => {
    cleanup();
    if (code !== 0 && !stream.readableEnded) {
      stream.destroy(
        unprocessable(stderr.trim() || `Remote download failed with exit code ${code ?? "unknown"}`),
      );
    }
  });
  return stream;
}

export function systemSshFiles(host: TerminalSshHost): TerminalFileAccess {
  return {
    async saveUpload(fileName, sourcePath) {
      const name = validateTerminalUploadFileName(fileName);
      const result = await runRemote(host, `sh -c ${shellQuote(UPLOAD_SCRIPT)} sh ${shellQuote(name)}`, {
        inputPath: sourcePath,
      });
      if (result.code !== 0) throw remoteFailure(result, "Remote upload failed");
      const remotePath = result.stdout.trim();
      if (!remotePath) throw unprocessable("Remote ssh did not report the uploaded path");
      const { size } = await fs.stat(sourcePath);
      return { path: remotePath, bytes: size };
    },
    async savePastedImage(fileName, sourcePath) {
      const result = await runRemote(host, remotePastedImageCommand(fileName), { inputPath: sourcePath });
      if (result.code !== 0) throw remoteFailure(result, "Remote image save failed");
      const remotePath = result.stdout.trim();
      if (!remotePath) throw unprocessable("Remote ssh did not report the saved image path");
      const { size } = await fs.stat(sourcePath);
      return { path: remotePath, bytes: size };
    },
    async openDownload(requestedPath) {
      const requested = validateTerminalDownloadPath(requestedPath);
      const resolved = await runRemote(
        host,
        `sh -c ${shellQuote(DOWNLOAD_STAT_SCRIPT)} sh ${shellQuote(requested)}`,
      );
      if (resolved.code !== 0) throw remoteFailure(resolved, "Remote download path could not be resolved");
      const [remotePath, sizeText] = resolved.stdout.split("\n");
      if (!remotePath || !sizeText) throw unprocessable("Remote ssh did not report the download path");
      const size = Number.parseInt(sizeText, 10);
      return {
        path: remotePath,
        size: Number.isFinite(size) ? size : 0,
        stream: streamRemoteFile(host, remotePath),
      };
    },
  };
}

export function startSystemSshTerminal(input: {
  host: TerminalSshHost;
  cols: number;
  rows: number;
}): { process: TerminalProcess; files: TerminalFileAccess } {
  const binary = resolveSshBinary();
  const terminal = spawnLocalTerminal({
    cwd: homedir(),
    cols: input.cols,
    rows: input.rows,
    shell: binary,
    args: systemSshArgs(input.host),
    env: sshEnv(),
  });
  return { process: terminal, files: systemSshFiles(input.host) };
}
