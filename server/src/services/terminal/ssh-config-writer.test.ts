import { mkdtempSync, rmSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SshConfigHostSettings } from "@tickernelz/wardmote-shared";
import { SSH_CONFIG_ALLOWED_OPTIONS, sshConfigHostInputSchema } from "./schema.js";
import { SshConfigWriteError, renderManagedBlock, sshConfigWriter } from "./ssh-config-writer.js";

const HANDWRITTEN = [
  "# my global defaults",
  "ServerAliveInterval 60",
  "",
  "# work box",
  "Host work",
  "    HostName 10.1.1.1",
  "    User me",
  "",
  "Host *",
  "    AddKeysToAgent yes",
  "",
].join("\n");

function host(alias: string, overrides: Partial<SshConfigHostSettings> = {}): SshConfigHostSettings {
  return {
    alias,
    hostName: "203.0.113.10",
    user: "deploy",
    port: 2222,
    identityFile: null,
    proxyJump: null,
    serverAliveInterval: 30,
    serverAliveCountMax: null,
    ...overrides,
  };
}

async function rejection(promise: Promise<unknown>): Promise<SshConfigWriteError> {
  const err = await promise.then(
    () => null,
    (error: unknown) => error,
  );
  expect(err).toBeInstanceOf(SshConfigWriteError);
  return err as SshConfigWriteError;
}

describe("ssh config writer", () => {
  let home: string;
  let sshDir: string;
  let configPath: string;

  beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), "ssh-config-writer-"));
    sshDir = path.join(home, ".ssh");
    configPath = path.join(sshDir, "config");
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const writer = () => sshConfigWriter({ configPath, now: () => new Date("2026-11-14T10:00:00Z"), lockWaitMs: 200 });

  it("creates ~/.ssh and the config with private modes when neither exists", async () => {
    await writer().add(host("box"));
    expect((await fs.stat(sshDir)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(configPath)).mode & 0o777).toBe(0o600);
    expect(await fs.readFile(configPath, "utf8")).toBe(renderManagedBlock(host("box")));
    expect((await fs.readdir(sshDir)).filter((name) => name.includes("wardmote-backup"))).toEqual([]);
  });

  it("inserts before the first Host block and keeps every handwritten byte", async () => {
    await fs.mkdir(sshDir, { recursive: true });
    await fs.writeFile(configPath, HANDWRITTEN);
    await writer().add(host("box"));
    const text = await fs.readFile(configPath, "utf8");
    const block = renderManagedBlock(host("box"));
    expect(text).toBe(HANDWRITTEN.replace("# work box\n", `${block}\n# work box\n`));
    expect(text.indexOf("ServerAliveInterval 60")).toBeLessThan(text.indexOf("Host box"));
  });

  it("updates and removes only its own block, restoring the original bytes", async () => {
    await fs.mkdir(sshDir, { recursive: true });
    await fs.writeFile(configPath, HANDWRITTEN);
    const instance = writer();
    await instance.add(host("box"));
    await instance.update("box", host("box", { user: "root", port: null }));
    const once = await fs.readFile(configPath, "utf8");
    await instance.update("box", host("box", { user: "root", port: null }));
    expect(await fs.readFile(configPath, "utf8")).toBe(once);
    expect(once).toContain("    User root\n");
    expect(once).not.toContain("Port 2222");
    expect((await instance.readManaged()).map((block) => block.settings)).toEqual([host("box", { user: "root", port: null })]);
    await instance.remove("box");
    expect(await fs.readFile(configPath, "utf8")).toBe(HANDWRITTEN);
  });

  it("renames a managed host and refuses to edit or remove handwritten hosts", async () => {
    await fs.mkdir(sshDir, { recursive: true });
    await fs.writeFile(configPath, HANDWRITTEN);
    const instance = writer();
    await instance.add(host("box"));
    await instance.update("box", host("box2"));
    expect((await instance.readManaged()).map((block) => block.alias)).toEqual(["box2"]);
    expect((await rejection(instance.update("work", host("work")))).code).toBe("not_found");
    expect((await rejection(instance.remove("work"))).code).toBe("not_found");
  });

  it("rejects duplicate aliases from the config, included files and saved hosts, ignoring case", async () => {
    await fs.mkdir(path.join(sshDir, "conf.d"), { recursive: true });
    await fs.writeFile(path.join(sshDir, "conf.d", "extra"), "Host included\n    HostName 10.2.2.2\n");
    await fs.writeFile(configPath, `Include conf.d/*\n\n${HANDWRITTEN}`);
    const instance = writer();
    expect((await rejection(instance.add(host("WORK")))).code).toBe("duplicate_alias");
    expect((await rejection(instance.add(host("included")))).code).toBe("duplicate_alias");
    expect((await rejection(instance.add(host("legacy"), { reservedAliases: ["Legacy"] }))).code).toBe("duplicate_alias");
    await instance.add(host("box"));
    expect((await rejection(instance.add(host("box")))).code).toBe("duplicate_alias");
  });

  it("rejects wildcard, negated and dash-led aliases", async () => {
    for (const alias of ["*", "web*", "web?", "!web", "-oProxyCommand=x", "two words", ""]) {
      expect((await rejection(writer().add(host(alias)))).code).toBe("invalid");
    }
  });

  it("only accepts whitelisted options and rejects injected lines", async () => {
    const injected = [
      { ...host("box"), proxyCommand: "nc %h %p" },
      { ...host("box"), localCommand: "touch /tmp/x" },
      { ...host("box"), match: "exec true" },
      { ...host("box"), include: "/etc/passwd" },
      host("box", { hostName: "10.0.0.1\nProxyCommand nc %h %p" }),
      host("box", { user: "me ProxyCommand=x" }),
      host("box", { user: "me\tx" }),
      host("box", { hostName: "-oProxyCommand=x" }),
      host("box", { identityFile: "/etc/ssh/ssh_host_ed25519_key" }),
      host("box", { identityFile: "~/.ssh/../../etc/passwd" }),
      host("box", { proxyJump: "a,b" }),
    ];
    for (const input of injected) {
      expect(sshConfigHostInputSchema.safeParse(input).success).toBe(false);
      expect((await rejection(writer().add(input as SshConfigHostSettings))).code).toBe("invalid");
    }
    await expect(fs.stat(configPath)).rejects.toThrow();
    const keywords = renderManagedBlock(host("box", { identityFile: "~/.ssh/id_ed25519", proxyJump: "jump", serverAliveCountMax: 3 }))
      .split("\n")
      .filter((line) => line.startsWith("    "))
      .map((line) => line.trim().split(" ")[0]);
    expect(keywords.every((keyword) => (SSH_CONFIG_ALLOWED_OPTIONS as readonly string[]).includes(keyword))).toBe(true);
    expect(SSH_CONFIG_ALLOWED_OPTIONS).toEqual([
      "HostName",
      "User",
      "Port",
      "IdentityFile",
      "IdentitiesOnly",
      "ProxyJump",
      "ServerAliveInterval",
      "ServerAliveCountMax",
    ]);
  });

  it("checks that the key file and the jump host exist", async () => {
    await fs.mkdir(sshDir, { recursive: true });
    await fs.writeFile(configPath, HANDWRITTEN);
    expect((await rejection(writer().add(host("box", { identityFile: "~/.ssh/missing" })))).code).toBe("invalid");
    expect((await rejection(writer().add(host("box", { proxyJump: "nowhere" })))).code).toBe("invalid");
    await fs.writeFile(path.join(sshDir, "id_box"), "key", { mode: 0o600 });
    await writer().add(host("box", { identityFile: "~/.ssh/id_box", proxyJump: "work" }));
    const text = await fs.readFile(configPath, "utf8");
    expect(text).toContain("    IdentityFile ~/.ssh/id_box\n    IdentitiesOnly yes\n    ProxyJump work\n");
  });

  it("treats a managed block edited by hand as read-only", async () => {
    const instance = writer();
    await instance.add(host("box"));
    const text = await fs.readFile(configPath, "utf8");
    await fs.writeFile(configPath, text.replace("    User deploy\n", "    User deploy\n    ProxyCommand nc %h %p\n"));
    expect((await instance.readManaged())[0]).toMatchObject({ alias: "box", settings: null });
    expect((await rejection(instance.update("box", host("box")))).code).toBe("not_managed");
    expect((await rejection(instance.remove("box"))).code).toBe("not_managed");
  });

  it("refuses to rename or remove a host another managed host jumps through", async () => {
    const instance = writer();
    await instance.add(host("jump"));
    await instance.add(host("inner", { proxyJump: "jump" }));
    expect((await rejection(instance.remove("jump"))).code).toBe("invalid");
    expect((await rejection(instance.update("jump", host("jump2")))).code).toBe("invalid");
  });

  it("writes through a symlinked config without replacing the link", async () => {
    const dotfiles = path.join(home, "dotfiles");
    await fs.mkdir(dotfiles, { recursive: true });
    await fs.mkdir(sshDir, { recursive: true });
    await fs.writeFile(path.join(dotfiles, "ssh_config"), HANDWRITTEN);
    await fs.symlink(path.join(dotfiles, "ssh_config"), configPath);
    await writer().add(host("box"));
    expect((await fs.lstat(configPath)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(path.join(dotfiles, "ssh_config"), "utf8")).toContain("Host box");
  });

  it("backs up an existing config once per writer before its first change", async () => {
    await fs.mkdir(sshDir, { recursive: true });
    await fs.writeFile(configPath, HANDWRITTEN);
    const instance = writer();
    await instance.add(host("one"));
    await instance.add(host("two"));
    const backups = (await fs.readdir(sshDir)).filter((name) => name.startsWith("config.wardmote-backup-"));
    expect(backups).toEqual(["config.wardmote-backup-20261114T100000Z"]);
    const backup = path.join(sshDir, backups[0]!);
    expect(await fs.readFile(backup, "utf8")).toBe(HANDWRITTEN);
    expect((await fs.stat(backup)).mode & 0o777).toBe(0o600);
  });

  it("serialises concurrent writes so none is lost", async () => {
    const instance = writer();
    await Promise.all(["a1", "a2", "a3", "a4"].map((alias) => instance.add(host(alias))));
    expect((await sshConfigWriter({ configPath }).readManaged()).map((block) => block.alias).sort()).toEqual(["a1", "a2", "a3", "a4"]);
    expect((await fs.readdir(sshDir)).filter((name) => name.endsWith(".lock") || name.endsWith(".tmp"))).toEqual([]);
  });

  it("serialises writers in different processes through the lock file", async () => {
    await fs.mkdir(sshDir, { recursive: true });
    await fs.writeFile(`${configPath}.wardmote.lock`, "4242");
    expect((await rejection(writer().add(host("box")))).code).toBe("locked");
  });
});
