import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultSshConfigPath, parseSavedSshHostId, readSshConfigHosts, savedSshHostId } from "./ssh-hosts.js";

describe("readSshConfigHosts", () => {
  let dir: string;
  let configPath: string;

  function write(name: string, text: string) {
    const file = path.join(dir, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
    return file;
  }

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "ssh-config-"));
    configPath = path.join(dir, "config");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports no hosts and no error when the config file is missing", async () => {
    const result = await readSshConfigHosts({ configPath });
    expect(result).toEqual({ hosts: [], configPath, configError: null });
  });

  it("lists literal aliases with hostname, user and port", async () => {
    write("config", [
      "# comment",
      "Host web db",
      "  HostName 10.0.0.5",
      "  User deploy",
      "  Port 2222",
      "",
      "Host bare",
      "  ForwardAgent yes",
    ].join("\n"));
    const result = await readSshConfigHosts({ configPath });
    expect(result.configError).toBeNull();
    expect(result.hosts).toEqual([
      { id: "config:bare", source: "config", name: "bare", destination: "bare", port: null },
      { id: "config:db", source: "config", name: "db", destination: "deploy@10.0.0.5", port: 2222 },
      { id: "config:web", source: "config", name: "web", destination: "deploy@10.0.0.5", port: 2222 },
    ]);
  });

  it("skips wildcard, negated and dash aliases", async () => {
    write("config", ["Host *", "  User everyone", "Host box?", "  User q", "Host !nope", "Host -danger", "Host good"].join("\n"));
    const result = await readSshConfigHosts({ configPath });
    expect(result.hosts.map((host) => host.name)).toEqual(["good"]);
    expect(result.hosts[0]?.destination).toBe("good");
  });

  it("does not list hosts declared inside a Match block", async () => {
    write("config", ["Host before", "Match host inside", "  HostName inside.test", "Host after", "  HostName after.test"].join("\n"));
    const result = await readSshConfigHosts({ configPath });
    expect(result.hosts.map((host) => host.name)).toEqual(["after", "before"]);
    expect(result.hosts.find((host) => host.name === "after")?.destination).toBe("after.test");
  });

  it("accepts key=value syntax, quoted values and inline comments", async () => {
    write("config", ['Host=kv', 'HostName="kv.internal"', "User=ops # trailing comment", "Port=2200", "Host plain # note"].join("\n"));
    const result = await readSshConfigHosts({ configPath });
    expect(result.hosts).toEqual([
      { id: "config:kv", source: "config", name: "kv", destination: "ops@kv.internal", port: 2200 },
      { id: "config:plain", source: "config", name: "plain", destination: "plain", port: null },
    ]);
  });

  it("keeps the first value for each alias and ignores later duplicates", async () => {
    write("config", [
      "Host twin",
      "  HostName first.test",
      "  HostName second.test",
      "  User first-user",
      "Host twin",
      "  HostName third.test",
    ].join("\n"));
    const result = await readSshConfigHosts({ configPath });
    expect(result.hosts).toEqual([
      { id: "config:twin", source: "config", name: "twin", destination: "first-user@first.test", port: null },
    ]);
  });

  it("follows Include directives with relative paths and globs", async () => {
    write("config", ["Include hosts/*.conf", "Include missing.conf", "Host main", "  HostName main.test"].join("\n"));
    write("hosts/b.conf", ["Host beta", "  HostName beta.test", "  Port 2201"].join("\n"));
    write("hosts/a.conf", ["Host alpha", "  User root", "  HostName alpha.test"].join("\n"));
    const result = await readSshConfigHosts({ configPath });
    expect(result.hosts).toEqual([
      { id: "config:alpha", source: "config", name: "alpha", destination: "root@alpha.test", port: null },
      { id: "config:beta", source: "config", name: "beta", destination: "beta.test", port: 2201 },
      { id: "config:main", source: "config", name: "main", destination: "main.test", port: null },
    ]);
  });

  it("includes absolute paths and ignores hosts inside a Match block", async () => {
    const included = write("extra.conf", ["Host extra", "  HostName extra.test"].join("\n"));
    write("config", ["Host local", "  HostName local.test", `Include ${included}`].join("\n"));
    const result = await readSshConfigHosts({ configPath });
    expect(result.hosts.map((host) => host.name)).toEqual(["extra", "local"]);
  });

  it("reports a configError when the config cannot be read", async () => {
    mkdirSync(configPath);
    const result = await readSshConfigHosts({ configPath });
    expect(result.configError).toBeTruthy();
    expect(result.hosts).toEqual([]);
  });

  it("defaults the config path to ~/.ssh/config", () => {
    expect(defaultSshConfigPath("/home/tester")).toBe(path.join("/home/tester", ".ssh", "config"));
  });
});

describe("saved ssh host ids", () => {
  it("round-trips a saved uuid and rejects config ids", () => {
    const uuid = "5b1f3a52-5b6f-4a41-9c39-1f2d3e4a5b6c";
    expect(savedSshHostId(uuid)).toBe(`saved:${uuid}`);
    expect(parseSavedSshHostId(savedSshHostId(uuid))).toBe(uuid);
    expect(parseSavedSshHostId("config:web")).toBeNull();
    expect(parseSavedSshHostId("saved:not-a-uuid")).toBeNull();
  });
});
