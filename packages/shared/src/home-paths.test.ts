import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveDefaultBackupDir,
  resolveDefaultEmbeddedPostgresDir,
  resolveDefaultLogsDir,
  resolveDefaultSecretsKeyFilePath,
  resolveDefaultStorageDir,
  resolvePaperclipConfigPathForInstance,
  resolvePaperclipInstanceRoot,
} from "./home-paths.js";

let userHome: string;

async function homePaths() {
  vi.resetModules();
  return import("./home-paths.js");
}

describe("default home", () => {
  beforeEach(() => {
    userHome = fs.mkdtempSync(path.join(os.tmpdir(), "wardmote-home-"));
    vi.spyOn(os, "homedir").mockReturnValue(userHome);
    vi.stubEnv("PAPERCLIP_HOME", "");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(userHome, { recursive: true, force: true });
  });

  it("starts a new install in ~/.wardmote", async () => {
    const { resolvePaperclipHomeDir } = await homePaths();
    expect(resolvePaperclipHomeDir()).toBe(path.join(userHome, ".wardmote"));
  });

  it("keeps an existing ~/.paperclip-pro without any action", async () => {
    fs.mkdirSync(path.join(userHome, ".paperclip-pro"));
    const { resolvePaperclipHomeDir } = await homePaths();
    expect(resolvePaperclipHomeDir()).toBe(path.join(userHome, ".paperclip-pro"));
  });

  it("uses ~/.wardmote once ~/.paperclip-pro is the migration link to it", async () => {
    fs.mkdirSync(path.join(userHome, ".wardmote"));
    fs.symlinkSync(path.join(userHome, ".wardmote"), path.join(userHome, ".paperclip-pro"));
    const { resolvePaperclipHomeDir } = await homePaths();
    expect(resolvePaperclipHomeDir()).toBe(path.join(userHome, ".wardmote"));
  });

  it("keeps a ~/.paperclip-pro link that points somewhere else", async () => {
    const elsewhere = path.join(userHome, "data");
    fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, path.join(userHome, ".paperclip-pro"));
    const { resolvePaperclipHomeDir } = await homePaths();
    expect(resolvePaperclipHomeDir()).toBe(path.join(userHome, ".paperclip-pro"));
  });

  it("lets an explicit home win", async () => {
    vi.stubEnv("PAPERCLIP_HOME", "/srv/wardmote");
    const { resolvePaperclipHomeDir } = await homePaths();
    expect(resolvePaperclipHomeDir()).toBe("/srv/wardmote");
  });

  it("resolves a config path under the absent home against the one that exists", async () => {
    fs.mkdirSync(path.join(userHome, ".paperclip-pro"));
    const { resolveHomeAwarePath } = await homePaths();
    expect(resolveHomeAwarePath("~/.wardmote/instances/default/db")).toBe(path.join(userHome, ".paperclip-pro/instances/default/db"));
    expect(resolveHomeAwarePath("~/.paperclip-pro/instances/default/db")).toBe(path.join(userHome, ".paperclip-pro/instances/default/db"));
    expect(resolveHomeAwarePath("/srv/db")).toBe("/srv/db");
  });

  it("leaves a config path alone when neither home exists", async () => {
    const { resolveHomeAwarePath } = await homePaths();
    expect(resolveHomeAwarePath("~/.wardmote/instances/default/db")).toBe(path.join(userHome, ".wardmote/instances/default/db"));
  });
});

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("home path resolution", () => {
  it("resolves config and runtime data directly under the instance root", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-home-paths-"));
    process.env.PAPERCLIP_HOME = home;
    delete process.env.PAPERCLIP_INSTANCE_ID;

    const instanceRoot = path.join(home, "instances", "default");
    expect(resolvePaperclipInstanceRoot()).toBe(instanceRoot);
    expect(resolvePaperclipConfigPathForInstance()).toBe(path.join(instanceRoot, "config.json"));
    expect(resolveDefaultEmbeddedPostgresDir()).toBe(path.join(instanceRoot, "db"));
    expect(resolveDefaultBackupDir()).toBe(path.join(instanceRoot, "data", "backups"));
    expect(resolveDefaultLogsDir()).toBe(path.join(instanceRoot, "logs"));
    expect(resolveDefaultStorageDir()).toBe(path.join(instanceRoot, "data", "storage"));
    expect(resolveDefaultSecretsKeyFilePath()).toBe(path.join(instanceRoot, "secrets", "master.key"));
  });
});
