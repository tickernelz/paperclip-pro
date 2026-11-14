import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  SshConfigHostSettings,
  SshConnectionTarget,
  SshConnectionTestResult,
  SshConnectionTestStatus,
  SshHostKey,
  TrustSshHostKeyResult,
} from "@tickernelz/wardmote-shared";
import { SshConfigWriteError, resolveConfigWriteTarget, withSshFileLock, writeFileAtomically } from "./ssh-config-writer.js";
import { SSH_CONNECT_TIMEOUT_SECONDS, resolveSshBinary, sshEnv } from "./system-ssh.js";

export const SSH_PROBE_TIMEOUT_MS = (SSH_CONNECT_TIMEOUT_SECONDS + 10) * 1000;

export interface SshRunResult {
  code: number | null;
  stderr: string;
  timedOut: boolean;
}

export type SshRunner = (args: string[], timeoutMs: number) => Promise<SshRunResult>;

export interface SshProbeOptions {
  run?: SshRunner;
  knownHostsPath: string;
}

interface CapturedHostKey extends SshHostKey {
  line: string;
}

const MESSAGES: Record<SshConnectionTestStatus, string> = {
  ok: "Connected and signed in.",
  host_key_unknown: "This server is not trusted yet. Compare the fingerprint with the server, then trust it.",
  host_key_changed:
    "The server's host key changed since it was trusted. The server may have been reinstalled, or someone may be intercepting the connection. Check with the server owner, then fix known_hosts by hand.",
  auth_failed: "The server rejected the key. Add the public key to ~/.ssh/authorized_keys on the server, or pick another key.",
  dns_failed: "The host name could not be resolved.",
  unreachable: "The server could not be reached. Check the host, the port and any firewall.",
  timeout: `No answer within ${Math.round(SSH_PROBE_TIMEOUT_MS / 1000)} seconds.`,
  key_unusable: "The key file could not be used. It may need a passphrase, or its file permissions are too open.",
  failed: "The connection failed.",
};

export const defaultSshRunner: SshRunner = (args, timeoutMs) =>
  new Promise((resolve, reject) => {
    const child = spawn(resolveSshBinary(), args, { env: sshEnv(), stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-16 * 1024);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr, timedOut });
    });
  });

function hostOptions(host: SshConfigHostSettings): string[] {
  const options = [`HostName=${host.hostName}`];
  if (host.user !== null) options.push(`User=${host.user}`);
  if (host.port !== null) options.push(`Port=${host.port}`);
  if (host.identityFile !== null) options.push(`IdentityFile=${host.identityFile}`, "IdentitiesOnly=yes");
  if (host.proxyJump !== null) options.push(`ProxyJump=${host.proxyJump}`);
  return options.flatMap((option) => ["-o", option]);
}

export function sshTargetArgs(target: SshConnectionTarget): string[] {
  if ("alias" in target) return ["--", target.alias];
  return [...hostOptions(target.host), "--", target.host.alias];
}

function baseArgs(): string[] {
  return ["-o", "BatchMode=yes", "-o", `ConnectTimeout=${SSH_CONNECT_TIMEOUT_SECONDS}`];
}

const AUTH_DISABLED = [
  "PubkeyAuthentication=no",
  "PasswordAuthentication=no",
  "KbdInteractiveAuthentication=no",
  "GSSAPIAuthentication=no",
  "HostbasedAuthentication=no",
  "ControlMaster=no",
  "ControlPath=none",
].flatMap((option) => ["-o", option]);

export function classifySshFailure(result: SshRunResult): SshConnectionTestStatus {
  if (result.timedOut) return "timeout";
  if (result.code !== null && result.code !== 255) return "ok";
  const text = result.stderr;
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key for \S+ has changed/i.test(text)) return "host_key_changed";
  if (/Host key verification failed|No \S+ host key is known/i.test(text)) return "host_key_unknown";
  if (/Could not resolve hostname|Name or service not known|nodename nor servname/i.test(text)) return "dns_failed";
  if (/Load key .*:|bad permissions|UNPROTECTED PRIVATE KEY FILE|incorrect passphrase/i.test(text)) return "key_unusable";
  if (/Permission denied \(/i.test(text)) return "auth_failed";
  if (/Connection (timed out|refused|reset|closed)|Operation timed out|No route to host|Network is unreachable|banner exchange/i.test(text)) {
    return "unreachable";
  }
  return "failed";
}

function readableDetail(stderr: string): string | null {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").trimEnd())
    .filter((line) => line.trim() && !line.startsWith("Warning: Permanently added") && !/^[@ ]*$/.test(line));
  const text = lines.join("\n").trim();
  return text ? text.slice(-1000) : null;
}

export function sshFingerprint(blobBase64: string): string {
  return `SHA256:${createHash("sha256").update(Buffer.from(blobBase64, "base64")).digest("base64").replace(/=+$/, "")}`;
}

function parseKnownHostsLines(text: string): CapturedHostKey[] {
  const keys: CapturedHostKey[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [, type, blob] = line.split(/\s+/);
    if (!type || !blob || !/^[A-Za-z0-9+/]+=*$/.test(blob)) continue;
    keys.push({ type, fingerprint: sshFingerprint(blob), line });
  }
  return keys;
}

async function captureHostKeys(target: SshConnectionTarget, run: SshRunner): Promise<CapturedHostKey[]> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wardmote-hostkey-"));
  const file = path.join(dir, "known_hosts");
  if (/\s/.test(file)) {
    await fs.rm(dir, { recursive: true, force: true });
    throw new Error("The temp directory path contains spaces; ssh cannot use it for known_hosts");
  }
  try {
    await run(
      [
        ...baseArgs(),
        ...[
          "StrictHostKeyChecking=accept-new",
          `UserKnownHostsFile=${file}`,
          "GlobalKnownHostsFile=/dev/null",
          "HashKnownHosts=no",
          "UpdateHostKeys=no",
          "CheckHostIP=no",
        ].flatMap((option) => ["-o", option]),
        ...AUTH_DISABLED,
        ...sshTargetArgs(target),
        "true",
      ],
      SSH_PROBE_TIMEOUT_MS,
    );
    const text = await fs.readFile(file, "utf8").catch(() => "");
    return parseKnownHostsLines(text);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export async function testSshConnection(target: SshConnectionTarget, options: SshProbeOptions): Promise<SshConnectionTestResult> {
  const run = options.run ?? defaultSshRunner;
  const started = Date.now();
  const result = await run([...baseArgs(), ...sshTargetArgs(target), "true"], SSH_PROBE_TIMEOUT_MS);
  const status = classifySshFailure(result);
  let hostKeys: SshHostKey[] = [];
  let message = MESSAGES[status];
  if (status === "host_key_unknown") {
    const captured = await captureHostKeys(target, run).catch(() => []);
    hostKeys = captured.map(({ type, fingerprint }) => ({ type, fingerprint }));
    if (hostKeys.length === 0) message = `${message} Its host key could not be read, so add it to ${options.knownHostsPath} by hand.`;
  }
  return {
    status,
    message,
    detail: status === "ok" ? null : readableDetail(result.stderr),
    hostKeys,
    durationMs: Date.now() - started,
  };
}

export async function trustSshHostKeys(
  target: SshConnectionTarget,
  fingerprints: string[],
  options: SshProbeOptions,
): Promise<TrustSshHostKeyResult> {
  const run = options.run ?? defaultSshRunner;
  const state = classifySshFailure(await run([...baseArgs(), ...AUTH_DISABLED, ...sshTargetArgs(target), "true"], SSH_PROBE_TIMEOUT_MS));
  if (state === "host_key_changed") {
    throw new SshConfigWriteError("conflict", MESSAGES.host_key_changed);
  }
  if (state !== "host_key_unknown") return { added: [], knownHostsPath: options.knownHostsPath };
  const captured = await captureHostKeys(target, run);
  const wanted = new Set(fingerprints);
  const selected = captured.filter((key) => wanted.has(key.fingerprint));
  if (selected.length === 0 || selected.length !== wanted.size) {
    throw new SshConfigWriteError("conflict", "The server's host key no longer matches the fingerprint you checked. Test the connection again.");
  }
  const knownHostsPath = await resolveConfigWriteTarget(options.knownHostsPath);
  await withSshFileLock(knownHostsPath, async () => {
    const original = await fs.readFile(knownHostsPath, "utf8").catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return null;
      throw err;
    });
    const base = original ?? "";
    const separator = base === "" || base.endsWith("\n") ? "" : "\n";
    await writeFileAtomically(knownHostsPath, original, `${base}${separator}${selected.map((key) => key.line).join("\n")}\n`);
  });
  return { added: selected.map(({ type, fingerprint }) => ({ type, fingerprint })), knownHostsPath: options.knownHostsPath };
}
