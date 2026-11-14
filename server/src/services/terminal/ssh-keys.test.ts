import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SshKeyError, generateSshKey, importSshKey, listSshKeys } from "./ssh-keys.js";

describe("ssh keys", () => {
  let dir: string;
  let sshDir: string;
  let scratch: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "ssh-keys-"));
    sshDir = path.join(dir, ".ssh");
    scratch = path.join(dir, "scratch");
    execFileSync("mkdir", ["-p", scratch]);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function makeKey(name: string, args: string[] = []) {
    const file = path.join(scratch, name);
    execFileSync("ssh-keygen", ["-q", "-N", "", "-C", "", ...args, "-f", file]);
    return file;
  }

  it("generates an ed25519 key with a private file mode and returns only public material", async () => {
    const key = await generateSshKey(sshDir, "wardmote_box", "box@wardmote");
    expect(key).toMatchObject({ name: "wardmote_box", path: "~/.ssh/wardmote_box", type: "ssh-ed25519", encrypted: false });
    expect((await fs.stat(path.join(sshDir, "wardmote_box"))).mode & 0o777).toBe(0o600);
    expect((await fs.stat(sshDir)).mode & 0o777).toBe(0o700);
    const listed = execFileSync("ssh-keygen", ["-lf", path.join(sshDir, "wardmote_box.pub")]).toString();
    expect(listed).toContain(key.fingerprint!);
    expect(JSON.stringify(key)).not.toContain("PRIVATE KEY");
    await expect(generateSshKey(sshDir, "wardmote_box", "x")).rejects.toMatchObject({ code: "exists" });
  });

  it("imports a pasted OpenSSH key, writes its public half, and never echoes the private key", async () => {
    const source = makeKey("pasted", ["-t", "ed25519"]);
    const privateKey = (await fs.readFile(source, "utf8")).replace(/\n/g, "\r\n");
    const key = await importSshKey(sshDir, "pasted", `  ${privateKey}  `);
    expect((await fs.stat(path.join(sshDir, "pasted"))).mode & 0o777).toBe(0o600);
    expect(await fs.readFile(path.join(sshDir, "pasted"), "utf8")).toBe(await fs.readFile(source, "utf8"));
    const expected = execFileSync("ssh-keygen", ["-lf", `${source}.pub`]).toString();
    expect(expected).toContain(key.fingerprint!);
    expect(key.encrypted).toBe(false);
    expect(JSON.stringify(key)).not.toContain("PRIVATE KEY");
    expect(await fs.readFile(path.join(sshDir, "pasted.pub"), "utf8")).toMatch(/^ssh-ed25519 \S+ pasted\n$/);
  });

  it("flags passphrase-protected keys", async () => {
    const source = path.join(scratch, "locked");
    execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "secret-pass", "-C", "", "-f", source]);
    const key = await importSshKey(sshDir, "locked", await fs.readFile(source, "utf8"));
    expect(key.encrypted).toBe(true);
    expect(key.fingerprint).not.toBeNull();
  });

  it("rejects text that is not exactly one private key and leaves no file behind", async () => {
    const one = await fs.readFile(makeKey("one", ["-t", "ed25519"]), "utf8");
    for (const text of ["hello", one.replace("OPENSSH", "OPENSSH\nProxyCommand"), `${one}${one}`, await fs.readFile(`${path.join(scratch, "one")}.pub`, "utf8")]) {
      await expect(importSshKey(sshDir, "bad", text)).rejects.toBeInstanceOf(SshKeyError);
    }
    await expect(fs.stat(path.join(sshDir, "bad"))).rejects.toThrow();
  });

  it("lists private keys with fingerprints and skips other ssh files", async () => {
    await generateSshKey(sshDir, "id_a", "a");
    await fs.copyFile(makeKey("rsa_old", ["-t", "rsa", "-b", "2048", "-m", "PEM"]), path.join(sshDir, "rsa_old"));
    await fs.writeFile(path.join(sshDir, "config"), "Host x\n");
    await fs.writeFile(path.join(sshDir, "known_hosts"), "x ssh-ed25519 AAAA\n");
    await fs.writeFile(path.join(sshDir, "notes.txt"), "-----BEGIN NOTHING-----\n");
    const listed = await listSshKeys(sshDir);
    expect(listed.keys.map((key) => key.name)).toEqual(["id_a", "rsa_old"]);
    expect(listed.keys[0]!.fingerprint).toMatch(/^SHA256:/);
    expect(listed.keys[1]).toMatchObject({ name: "rsa_old", fingerprint: null, encrypted: false });
    expect(await listSshKeys(path.join(dir, "missing"))).toEqual({ keys: [], sshDir: path.join(dir, "missing") });
  });
});
