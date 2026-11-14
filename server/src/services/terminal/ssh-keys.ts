import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { SshKeyInfo, SshKeyList } from "@tickernelz/wardmote-shared";
import { SSH_KEY_NAME_PATTERN } from "./schema.js";
import { sshFingerprint } from "./ssh-probe.js";
import { sshEnv } from "./system-ssh.js";

const execFileAsync = promisify(execFile);

const MAX_KEY_FILE_BYTES = 32 * 1024;
const MAX_LISTED_KEYS = 200;
const KEYGEN_TIMEOUT_MS = 20_000;
const OPENSSH_MAGIC = "openssh-key-v1\0";
const PRIVATE_KEY_PATTERN = /^-----BEGIN ((?:[A-Z0-9]+ )?)PRIVATE KEY-----\n([A-Za-z0-9+/=:,\- \n]+)\n-----END \1PRIVATE KEY-----\n$/;

export type SshKeyErrorCode = "exists" | "invalid" | "failed";

export class SshKeyError extends Error {
  constructor(
    readonly code: SshKeyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SshKeyError";
  }
}

interface PrivateKeyFacts {
  encrypted: boolean;
  publicLine: string | null;
}

function readSshString(buffer: Buffer, offset: number): { value: Buffer; next: number } | null {
  if (offset + 4 > buffer.length) return null;
  const length = buffer.readUInt32BE(offset);
  const start = offset + 4;
  if (length > buffer.length - start) return null;
  return { value: buffer.subarray(start, start + length), next: start + length };
}

function openSshFacts(body: string): PrivateKeyFacts | null {
  const buffer = Buffer.from(body.replace(/\s+/g, ""), "base64");
  if (buffer.subarray(0, OPENSSH_MAGIC.length).toString("latin1") !== OPENSSH_MAGIC) return null;
  const cipher = readSshString(buffer, OPENSSH_MAGIC.length);
  const kdf = cipher && readSshString(buffer, cipher.next);
  const kdfOptions = kdf && readSshString(buffer, kdf.next);
  if (!cipher || !kdfOptions || kdfOptions.next + 4 > buffer.length) return null;
  if (buffer.readUInt32BE(kdfOptions.next) !== 1) return null;
  const publicBlob = readSshString(buffer, kdfOptions.next + 4);
  const type = publicBlob && readSshString(publicBlob.value, 0);
  if (!publicBlob || !type || !/^[a-z0-9@.-]+$/.test(type.value.toString("latin1"))) return null;
  return {
    encrypted: cipher.value.toString("latin1") !== "none",
    publicLine: `${type.value.toString("latin1")} ${publicBlob.value.toString("base64")}`,
  };
}

function privateKeyFacts(text: string): PrivateKeyFacts | null {
  if ((text.match(/-----BEGIN /g) ?? []).length !== 1) return null;
  const match = PRIVATE_KEY_PATTERN.exec(text);
  if (!match) return null;
  if (match[1] === "OPENSSH ") return openSshFacts(match[2]!);
  return { encrypted: match[1] === "ENCRYPTED " || /Proc-Type:\s*4,ENCRYPTED/.test(match[2]!), publicLine: null };
}

function normalizePrivateKey(text: string): string {
  return `${text.replace(/\r\n?/g, "\n").trim()}\n`;
}

function parsePublicLine(line: string | null): { type: string; blob: string; comment: string | null } | null {
  if (!line) return null;
  const [type, blob, ...comment] = line.trim().split(/\s+/);
  if (!type || !blob || !/^[A-Za-z0-9+/]+=*$/.test(blob)) return null;
  return { type, blob, comment: comment.length > 0 ? comment.join(" ") : null };
}

async function readSmallFile(file: string): Promise<string | null> {
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat?.isFile() || stat.size > MAX_KEY_FILE_BYTES) return null;
  return fs.readFile(file, "utf8").catch(() => null);
}

function keyInfo(name: string, facts: PrivateKeyFacts, publicText: string | null): SshKeyInfo {
  const fromFile = parsePublicLine(publicText);
  const fromKey = parsePublicLine(facts.publicLine);
  const publicKey = fromFile ?? fromKey;
  return {
    name,
    path: `~/.ssh/${name}`,
    type: publicKey?.type ?? null,
    fingerprint: publicKey ? sshFingerprint(publicKey.blob) : null,
    comment: fromFile?.comment ?? null,
    encrypted: facts.encrypted,
    publicKey: publicKey ? [publicKey.type, publicKey.blob, publicKey.comment].filter(Boolean).join(" ") : null,
  };
}

function isCandidateName(name: string): boolean {
  return SSH_KEY_NAME_PATTERN.test(name) && !name.endsWith(".pub") && !name.includes(".wardmote-") && !name.startsWith("known_hosts");
}

async function describeKey(sshDir: string, name: string): Promise<SshKeyInfo | null> {
  const text = await readSmallFile(path.join(sshDir, name));
  if (!text || !text.trimStart().startsWith("-----BEGIN ")) return null;
  const facts = privateKeyFacts(normalizePrivateKey(text));
  if (!facts) return null;
  return keyInfo(name, facts, await readSmallFile(path.join(sshDir, `${name}.pub`)));
}

export async function listSshKeys(sshDir: string): Promise<SshKeyList> {
  const entries = await fs.readdir(sshDir, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return [];
    throw err;
  });
  const names = entries
    .filter((entry) => entry.isFile() && isCandidateName(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, MAX_LISTED_KEYS);
  const keys = (await Promise.all(names.map((name) => describeKey(sshDir, name)))).filter(
    (key): key is SshKeyInfo => key !== null,
  );
  return { keys, sshDir };
}

async function assertFree(sshDir: string, name: string) {
  for (const file of [name, `${name}.pub`]) {
    if (await fs.lstat(path.join(sshDir, file)).catch(() => null)) {
      throw new SshKeyError("exists", `~/.ssh/${file} already exists. Pick another name.`);
    }
  }
}

async function runKeygen(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("ssh-keygen", args, {
      env: sshEnv(),
      timeout: KEYGEN_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
    });
    return stdout;
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr?.trim();
    throw new SshKeyError("failed", stderr ? `ssh-keygen failed: ${stderr.slice(-300)}` : "ssh-keygen failed");
  }
}

export async function generateSshKey(sshDir: string, name: string, comment: string): Promise<SshKeyInfo> {
  await fs.mkdir(sshDir, { recursive: true, mode: 0o700 });
  await assertFree(sshDir, name);
  await runKeygen(["-q", "-t", "ed25519", "-N", "", "-C", comment, "-f", path.join(sshDir, name)]);
  const info = await describeKey(sshDir, name);
  if (!info) throw new SshKeyError("failed", "ssh-keygen did not produce a readable key");
  return info;
}

export async function importSshKey(sshDir: string, name: string, privateKey: string): Promise<SshKeyInfo> {
  const text = normalizePrivateKey(privateKey);
  const facts = privateKeyFacts(text);
  if (!facts) {
    throw new SshKeyError("invalid", "That is not a private key. Paste the whole file, from -----BEGIN to -----END.");
  }
  await fs.mkdir(sshDir, { recursive: true, mode: 0o700 });
  await assertFree(sshDir, name);
  const keyPath = path.join(sshDir, name);
  try {
    await fs.writeFile(keyPath, text, { mode: 0o600, flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") throw new SshKeyError("exists", `~/.ssh/${name} already exists. Pick another name.`);
    throw err;
  }
  let publicLine = facts.publicLine;
  if (!publicLine && !facts.encrypted) {
    try {
      publicLine = (await runKeygen(["-y", "-P", "", "-f", keyPath])).trim().split("\n")[0] ?? null;
    } catch {
      await fs.unlink(keyPath).catch(() => undefined);
      throw new SshKeyError("invalid", "ssh-keygen could not read that private key.");
    }
  }
  const publicKey = parsePublicLine(publicLine);
  if (publicKey) {
    await fs.writeFile(path.join(sshDir, `${name}.pub`), `${publicKey.type} ${publicKey.blob} ${name}\n`, { mode: 0o644, flag: "wx" });
  }
  const info = await describeKey(sshDir, name);
  if (!info) throw new SshKeyError("failed", "The key was saved but could not be read back");
  return info;
}
