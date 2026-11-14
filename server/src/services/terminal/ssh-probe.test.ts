import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SshConnectionTarget } from "@tickernelz/wardmote-shared";
import { SshConfigWriteError } from "./ssh-config-writer.js";
import { classifySshFailure, sshFingerprint, testSshConnection, trustSshHostKeys, type SshRunner } from "./ssh-probe.js";

const BLOB = "AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl";
const UNKNOWN = "No ED25519 host key is known for [203.0.113.10]:2222 and you have requested strict checking.\nHost key verification failed.\n";
const CHANGED = "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\nHost key verification failed.\n";

const target: SshConnectionTarget = {
  host: {
    alias: "box",
    hostName: "203.0.113.10",
    user: "deploy",
    port: 2222,
    identityFile: "~/.ssh/id_box",
    proxyJump: null,
    serverAliveInterval: null,
    serverAliveCountMax: null,
  },
};

function fakeSsh(script: (args: string[]) => { code: number | null; stderr: string; hostKeyLine?: string }) {
  const calls: string[][] = [];
  const run: SshRunner = async (args) => {
    calls.push(args);
    const outcome = script(args);
    const file = args.find((arg) => arg.startsWith("UserKnownHostsFile="))?.slice("UserKnownHostsFile=".length);
    if (file && outcome.hostKeyLine) await fs.writeFile(file, `${outcome.hostKeyLine}\n`);
    return { code: outcome.code, stderr: outcome.stderr, timedOut: false };
  };
  return { run, calls };
}

describe("ssh connection probe", () => {
  let dir: string;
  let knownHostsPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "ssh-probe-"));
    knownHostsPath = path.join(dir, "known_hosts");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("classifies the common ssh failures", () => {
    const status = (stderr: string, code: number | null = 255) => classifySshFailure({ code, stderr, timedOut: false });
    expect(status("", 0)).toBe("ok");
    expect(status(UNKNOWN)).toBe("host_key_unknown");
    expect(status(CHANGED)).toBe("host_key_changed");
    expect(status("deploy@203.0.113.10: Permission denied (publickey).")).toBe("auth_failed");
    expect(status("ssh: Could not resolve hostname nope.invalid: Name or service not known")).toBe("dns_failed");
    expect(status("ssh: connect to host 203.0.113.10 port 2222: Connection refused")).toBe("unreachable");
    expect(status("ssh: connect to host 203.0.113.10 port 2222: Connection timed out")).toBe("unreachable");
    expect(status('Load key "/home/u/.ssh/id_box": incorrect passphrase supplied to decrypt private key\nPermission denied (publickey).')).toBe("key_unusable");
    expect(status("kex_exchange_identification: something odd")).toBe("failed");
    expect(classifySshFailure({ code: null, stderr: "", timedOut: true })).toBe("timeout");
  });

  it("matches ssh-keygen's fingerprint format", () => {
    const keyFile = path.join(dir, "k.pub");
    rmSync(keyFile, { force: true });
    execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", path.join(dir, "k")]);
    const line = execFileSync("ssh-keygen", ["-lf", keyFile]).toString();
    const blob = (execFileSync("cat", [keyFile]).toString().split(" ")[1] ?? "").trim();
    expect(line).toContain(sshFingerprint(blob));
  });

  it("tests in batch mode with the draft options and reports an unknown host key with its fingerprint", async () => {
    const ssh = fakeSsh((args) =>
      args.includes("StrictHostKeyChecking=accept-new")
        ? { code: 255, stderr: "Permission denied (none).", hostKeyLine: `[203.0.113.10]:2222 ssh-ed25519 ${BLOB}` }
        : { code: 255, stderr: UNKNOWN },
    );
    const result = await testSshConnection(target, { run: ssh.run, knownHostsPath });
    expect(result).toMatchObject({ status: "host_key_unknown", hostKeys: [{ type: "ssh-ed25519", fingerprint: sshFingerprint(BLOB) }] });
    expect(ssh.calls[0]).toEqual([
      "-o", "BatchMode=yes", "-o", "ConnectTimeout=15",
      "-o", "HostName=203.0.113.10", "-o", "User=deploy", "-o", "Port=2222",
      "-o", "IdentityFile=~/.ssh/id_box", "-o", "IdentitiesOnly=yes",
      "--", "box", "true",
    ]);
    expect(ssh.calls[1]).toContain("PubkeyAuthentication=no");
    expect(ssh.calls.flat().some((arg) => /StrictHostKeyChecking=(no|off)/.test(arg))).toBe(false);
    await expect(fs.stat(knownHostsPath)).rejects.toThrow();
  });

  it("adds only the confirmed host key to known_hosts", async () => {
    await fs.writeFile(knownHostsPath, "github.com ssh-ed25519 AAAA\n");
    const ssh = fakeSsh((args) =>
      args.includes("StrictHostKeyChecking=accept-new")
        ? { code: 255, stderr: "", hostKeyLine: `[203.0.113.10]:2222 ssh-ed25519 ${BLOB}` }
        : { code: 255, stderr: UNKNOWN },
    );
    const result = await trustSshHostKeys(target, [sshFingerprint(BLOB)], { run: ssh.run, knownHostsPath });
    expect(result.added).toEqual([{ type: "ssh-ed25519", fingerprint: sshFingerprint(BLOB) }]);
    expect(await fs.readFile(knownHostsPath, "utf8")).toBe(`github.com ssh-ed25519 AAAA\n[203.0.113.10]:2222 ssh-ed25519 ${BLOB}\n`);
  });

  it("refuses to trust a key that differs from the confirmed fingerprint or replaces a changed key", async () => {
    const mismatch = fakeSsh((args) =>
      args.includes("StrictHostKeyChecking=accept-new")
        ? { code: 255, stderr: "", hostKeyLine: `[203.0.113.10]:2222 ssh-ed25519 ${BLOB}` }
        : { code: 255, stderr: UNKNOWN },
    );
    const other = `SHA256:${"A".repeat(43)}`;
    await expect(trustSshHostKeys(target, [other], { run: mismatch.run, knownHostsPath })).rejects.toBeInstanceOf(SshConfigWriteError);
    const changed = fakeSsh(() => ({ code: 255, stderr: CHANGED }));
    await expect(trustSshHostKeys(target, [sshFingerprint(BLOB)], { run: changed.run, knownHostsPath })).rejects.toThrow(/changed/);
    expect(changed.calls).toHaveLength(1);
    await expect(fs.stat(knownHostsPath)).rejects.toThrow();
  });

  it("writes nothing when the host key is already trusted", async () => {
    const known = fakeSsh(() => ({ code: 255, stderr: "Permission denied (publickey)." }));
    const result = await trustSshHostKeys({ alias: "box" }, [sshFingerprint(BLOB)], { run: known.run, knownHostsPath });
    expect(result.added).toEqual([]);
    await expect(fs.stat(knownHostsPath)).rejects.toThrow();
  });
});
