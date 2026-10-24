import { createHmac } from "node:crypto";
import { createReadStream, readFileSync, promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { StringDecoder } from "node:string_decoder";
import { badRequest, conflict, notFound } from "../../errors.js";
import {
  TERMINAL_UPLOAD_EXISTS_MESSAGE,
  isPathInside,
  validateTerminalDownloadPath,
  validateTerminalUploadFileName,
  type TerminalFileAccess,
} from "./files.js";
import type { TerminalExit, TerminalProcess } from "./process.js";

export interface SshTerminalTarget {
  host: string;
  port: number;
  username: string;
  privateKey: string | null;
  knownHosts: string | null;
  strictHostKeyChecking: boolean;
  remoteCwd: string;
}

interface SftpStats {
  size: number;
  isFile(): boolean;
}

interface SftpSession {
  createWriteStream(remotePath: string, options: { flags: string; mode?: number }): Writable;
  realpath(remotePath: string, callback: (err: Error | null | undefined, absolute: string) => void): void;
  stat(remotePath: string, callback: (err: Error | null | undefined, stats: SftpStats) => void): void;
  lstat(remotePath: string, callback: (err: Error | null | undefined, stats: SftpStats) => void): void;
  createReadStream(remotePath: string): Readable;
  end(): void;
}

interface SshChannel {
  stderr: { on(event: "data", listener: (data: Buffer) => void): void };
  on(event: "data", listener: (data: Buffer) => void): void;
  on(event: "exit", listener: (code: number | null, signal?: string) => void): void;
  on(event: "close", listener: () => void): void;
  write(data: string): void;
  setWindow(rows: number, cols: number, height: number, width: number): void;
  close(): void;
}

interface SshClient {
  once(event: "ready", listener: () => void): void;
  once(event: "error", listener: (err: Error) => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  connect(config: Record<string, unknown>): void;
  exec(
    command: string,
    options: { pty: { term: string; cols: number; rows: number } },
    callback: (err: Error | undefined, channel: SshChannel) => void,
  ): void;
  sftp(callback: (err: Error | undefined, sftp: SftpSession) => void): void;
  end(): void;
  destroy?(): void;
}

const require = createRequire(import.meta.url);

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function hostPatternMatches(patterns: string, candidate: string): boolean {
  if (patterns.startsWith("|1|")) {
    const [, , salt, hash] = patterns.split("|");
    if (!salt || !hash) return false;
    const digest = createHmac("sha1", Buffer.from(salt, "base64")).update(candidate).digest("base64");
    return digest === hash;
  }
  let matched = false;
  for (const raw of patterns.split(",")) {
    const negated = raw.startsWith("!");
    const pattern = negated ? raw.slice(1) : raw;
    if (!pattern) continue;
    if (globToRegExp(pattern).test(candidate)) {
      if (negated) return false;
      matched = true;
    }
  }
  return matched;
}

export function knownHostsAcceptKey(knownHosts: string, host: string, port: number, key: Buffer): boolean {
  const candidate = port === 22 ? host : `[${host}]:${port}`;
  let accepted = false;
  for (const line of knownHosts.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const fields = trimmed.split(/\s+/);
    const marker = fields[0]?.startsWith("@") ? fields.shift() : null;
    if (marker === "@cert-authority") continue;
    const [patterns, , keyData] = fields;
    if (!patterns || !keyData) continue;
    if (!hostPatternMatches(patterns, candidate)) continue;
    if (!Buffer.from(keyData, "base64").equals(key)) continue;
    if (marker === "@revoked") return false;
    accepted = true;
  }
  return accepted;
}

function readDefaultKnownHosts(): string {
  try {
    return readFileSync(path.join(homedir(), ".ssh", "known_hosts"), "utf8");
  } catch {
    return "";
  }
}

class SshTerminalProcess implements TerminalProcess {
  private readonly decoder = new StringDecoder("utf8");
  private readonly dataListeners: Array<(data: string) => void> = [];
  private readonly exitListeners: Array<(exit: TerminalExit) => void> = [];
  private exit: TerminalExit = { exitCode: null, signal: null };
  private exited = false;

  constructor(private readonly client: SshClient, private readonly channel: SshChannel) {
    const forward = (data: Buffer) => {
      const text = this.decoder.write(data);
      if (text) for (const listener of this.dataListeners) listener(text);
    };
    channel.on("data", forward);
    channel.stderr.on("data", forward);
    channel.on("exit", (code, signal) => {
      this.exit = { exitCode: typeof code === "number" ? code : null, signal: signal ?? null };
    });
    channel.on("close", () => this.finish());
    client.on("close", () => this.finish());
    client.on("error", () => this.finish());
  }

  private finish() {
    if (this.exited) return;
    this.exited = true;
    const tail = this.decoder.end();
    if (tail) for (const listener of this.dataListeners) listener(tail);
    for (const listener of this.exitListeners) listener(this.exit);
    try {
      this.client.end();
    } catch {
      this.client.destroy?.();
    }
  }

  write(data: string): void {
    if (!this.exited) this.channel.write(data);
  }

  resize(cols: number, rows: number): void {
    if (!this.exited) this.channel.setWindow(rows, cols, 0, 0);
  }

  kill(): void {
    try {
      this.channel.close();
    } finally {
      this.finish();
    }
  }

  onData(listener: (data: string) => void): void {
    this.dataListeners.push(listener);
  }

  onExit(listener: (exit: TerminalExit) => void): void {
    this.exitListeners.push(listener);
  }
}

function openSftp(client: SshClient): Promise<SftpSession> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)));
  });
}

function sftpCall<T>(run: (callback: (err: Error | null | undefined, value: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    run((err, value) => (err ? reject(err) : resolve(value)));
  });
}

function sshTerminalFiles(client: SshClient, remoteCwd: string): TerminalFileAccess {
  const remote = path.posix;
  return {
    async saveUpload(fileName, sourcePath) {
      const name = validateTerminalUploadFileName(fileName);
      const sftp = await openSftp(client);
      try {
        const root = await sftpCall<string>((cb) => sftp.realpath(remoteCwd, cb));
        const target = remote.join(root, name);
        const existing = await sftpCall<SftpStats>((cb) => sftp.lstat(target, cb)).catch(() => null);
        if (existing) throw conflict(TERMINAL_UPLOAD_EXISTS_MESSAGE);
        await pipeline(createReadStream(sourcePath), sftp.createWriteStream(target, { flags: "wx", mode: 0o644 }));
        const { size } = await fs.stat(sourcePath);
        return { path: target, bytes: size };
      } finally {
        sftp.end();
      }
    },
    async openDownload(requestedPath) {
      const requested = validateTerminalDownloadPath(requestedPath);
      const sftp = await openSftp(client);
      try {
        const root = await sftpCall<string>((cb) => sftp.realpath(remoteCwd, cb));
        const resolved = remote.resolve(root, requested);
        if (!isPathInside(root, resolved, remote) && !isPathInside(remote.resolve(remoteCwd), resolved, remote)) {
          throw badRequest("Download path must stay inside the terminal directory");
        }
        const real = await sftpCall<string>((cb) => sftp.realpath(resolved, cb)).catch(() => null);
        if (!real) throw notFound("File not found");
        if (!isPathInside(root, real, remote)) {
          throw badRequest("Download path must stay inside the terminal directory");
        }
        const stats = await sftpCall<SftpStats>((cb) => sftp.stat(real, cb)).catch(() => null);
        if (!stats) throw notFound("File not found");
        if (!stats.isFile()) throw badRequest("Download path is not a file");
        const stream = sftp.createReadStream(real);
        stream.once("close", () => sftp.end());
        stream.once("error", () => sftp.end());
        return { path: real, size: stats.size, stream };
      } catch (err) {
        sftp.end();
        throw err;
      }
    },
  };
}

export async function connectSshTerminal(
  target: SshTerminalTarget,
  size: { cols: number; rows: number },
): Promise<{ process: TerminalProcess; files: TerminalFileAccess }> {
  const { Client } = require("ssh2") as { Client: new () => SshClient };
  const client = new Client();
  const knownHosts = target.strictHostKeyChecking ? (target.knownHosts ?? readDefaultKnownHosts()) : null;
  await new Promise<void>((resolve, reject) => {
    client.once("ready", () => resolve());
    client.once("error", reject);
    client.connect({
      host: target.host,
      port: target.port,
      username: target.username,
      ...(target.privateKey ? { privateKey: target.privateKey } : {}),
      hostVerifier: (key: Buffer) =>
        knownHosts === null ? true : knownHostsAcceptKey(knownHosts, target.host, target.port, key),
      readyTimeout: 20_000,
      keepaliveInterval: 15_000,
      keepaliveCountMax: 3,
    });
  });
  const command = `cd ${shellQuote(target.remoteCwd)} 2>/dev/null; exec "\${SHELL:-/bin/sh}" -l`;
  const channel = await new Promise<SshChannel>((resolve, reject) => {
    client.exec(command, { pty: { term: "xterm-256color", cols: size.cols, rows: size.rows } }, (err, stream) =>
      err ? reject(err) : resolve(stream),
    );
  }).catch((err: unknown) => {
    client.end();
    throw err;
  });
  return { process: new SshTerminalProcess(client, channel), files: sshTerminalFiles(client, target.remoteCwd) };
}
