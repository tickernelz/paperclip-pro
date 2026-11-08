import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrateHomeCommand, type MigrateHomeDependencies } from "../commands/migrate-home.js";

let userHome: string;
let legacy: string;
let target: string;
let unitPath: string;

function deps(overrides: Partial<MigrateHomeDependencies> = {}): Partial<MigrateHomeDependencies> {
  return {
    userHomeDir: userHome,
    env: {},
    platform: "linux",
    serviceState: async () => "stopped",
    reloadUnits: vi.fn(async () => undefined),
    log: () => undefined,
    ...overrides,
  };
}

describe("migrate-home", () => {
  beforeEach(() => {
    userHome = fs.mkdtempSync(path.join(os.tmpdir(), "wardmote-migrate-"));
    legacy = path.join(userHome, ".paperclip-pro");
    target = path.join(userHome, ".wardmote");
    fs.mkdirSync(path.join(legacy, "instances", "default", "db"), { recursive: true });
    fs.writeFileSync(path.join(legacy, "instances", "default", "config.json"), "{}");
    unitPath = path.join(userHome, ".config", "systemd", "user", "paperclip-pro.service");
    fs.mkdirSync(path.dirname(unitPath), { recursive: true });
    fs.writeFileSync(unitPath, `Environment="PAPERCLIP_HOME=${legacy}"\nEnvironmentFile=-${legacy}/instances/default/service.env\n`);
  });

  afterEach(() => {
    fs.rmSync(userHome, { recursive: true, force: true });
  });

  it("moves the home, links the old path to it, and repoints the service unit", async () => {
    const reloadUnits = vi.fn(async () => undefined);
    await migrateHomeCommand({}, deps({ reloadUnits }));
    expect(fs.readFileSync(path.join(target, "instances", "default", "config.json"), "utf8")).toBe("{}");
    expect(fs.lstatSync(legacy).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(legacy)).toBe(fs.realpathSync(target));
    expect(fs.readFileSync(unitPath, "utf8")).toBe(`Environment="PAPERCLIP_HOME=${target}"\nEnvironmentFile=-${target}/instances/default/service.env\n`);
    expect(reloadUnits).toHaveBeenCalledTimes(1);
  });

  it("changes nothing on a dry run", async () => {
    await migrateHomeCommand({ dryRun: true }, deps());
    expect(fs.lstatSync(legacy).isDirectory()).toBe(true);
    expect(fs.existsSync(target)).toBe(false);
  });

  it("refuses while the service is active", async () => {
    await expect(migrateHomeCommand({}, deps({ serviceState: async () => "running" }))).rejects.toThrow("service paperclip-pro.service");
    expect(fs.lstatSync(legacy).isDirectory()).toBe(true);
  });

  it("refuses when the service state cannot be read", async () => {
    await expect(migrateHomeCommand({}, deps({ serviceState: async () => "unknown" }))).rejects.toThrow("state could not be read");
    expect(fs.lstatSync(legacy).isDirectory()).toBe(true);
  });

  it("checks launchd agents on macOS", async () => {
    const plist = path.join(userHome, "Library", "LaunchAgents", "ing.paperclip.paperclip-pro.plist");
    fs.mkdirSync(path.dirname(plist), { recursive: true });
    fs.writeFileSync(plist, "<plist/>");
    const seen: string[] = [];
    const serviceState = async (platform: NodeJS.Platform, definition: string) => {
      seen.push(`${platform}:${path.basename(definition)}`);
      return "running" as const;
    };
    await expect(migrateHomeCommand({}, deps({ platform: "darwin", serviceState }))).rejects.toThrow("service ing.paperclip.paperclip-pro.plist");
    expect(seen).toEqual(["darwin:ing.paperclip.paperclip-pro.plist"]);
  });

  it("refuses while the embedded database is running", async () => {
    fs.writeFileSync(path.join(legacy, "instances", "default", "db", "postmaster.pid"), `${process.pid}\n`);
    await expect(migrateHomeCommand({}, deps())).rejects.toThrow(`default (postgres pid ${process.pid})`);
    expect(fs.existsSync(target)).toBe(false);
  });

  it("refuses when the new home already exists or a home is pinned", async () => {
    await expect(migrateHomeCommand({}, deps({ env: { PAPERCLIP_HOME: legacy } }))).rejects.toThrow("Unset it");
    fs.mkdirSync(target);
    await expect(migrateHomeCommand({}, deps())).rejects.toThrow("already exists");
    expect(fs.lstatSync(legacy).isDirectory()).toBe(true);
  });

  it("refuses a second run", async () => {
    await migrateHomeCommand({}, deps());
    await expect(migrateHomeCommand({}, deps())).rejects.toThrow("already a link");
  });
});
