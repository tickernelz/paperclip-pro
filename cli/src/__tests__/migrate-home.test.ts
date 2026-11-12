import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasLegacyInstall, migrateHomeCommand, rewriteLegacyStoreMarker, type MigrateHomeDependencies } from "../commands/migrate-home.js";
import { initializeInstallStore, resolveInstallStorePaths } from "../install-store.js";

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
    unitEnabled: async () => false,
    setUnitEnabled: vi.fn(async () => undefined),
    log: () => undefined,
    ...overrides,
  };
}

const legacyShimMarker = ["paperclip", "pro managed install shim v1"].join("-");
const legacyStoreMarker = `${["paperclip", "pro managed install store v1"].join("-")}\n`;
const legacyPathStart = `# >>> ${["paperclip", "pro"].join("-")} managed PATH >>>`;
const legacyPathEnd = `# <<< ${["paperclip", "pro"].join("-")} managed PATH <<<`;
function legacyShim(entrypoint: string): string {
  return `#!/bin/sh\n# ${legacyShimMarker}\nset -eu\nexec '/usr/bin/node' '${entrypoint}' "$@"\n`;
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
    fs.writeFileSync(unitPath, `ExecStart="${userHome}/.local/bin/paperclip-pro" run --instance "default"\nEnvironment="WARDMOTE_HOME=${legacy}"\nEnvironmentFile=-${legacy}/instances/default/service.env\n`);
  });

  afterEach(() => {
    fs.rmSync(userHome, { recursive: true, force: true });
  });

  it("moves the home, links the old path to it, and replaces the service unit under the new name", async () => {
    const reloadUnits = vi.fn(async () => undefined);
    const setUnitEnabled = vi.fn(async () => undefined);
    await migrateHomeCommand({}, deps({ reloadUnits, setUnitEnabled, unitEnabled: async (unit) => unit === path.basename(unitPath) }));
    expect(fs.readFileSync(path.join(target, "instances", "default", "config.json"), "utf8")).toBe("{}");
    expect(fs.lstatSync(legacy).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(legacy)).toBe(fs.realpathSync(target));
    expect(fs.existsSync(unitPath)).toBe(false);
    const nextUnit = path.join(path.dirname(unitPath), "wardmote.service");
    expect(fs.readFileSync(nextUnit, "utf8")).toBe(
      `ExecStart="${userHome}/.local/bin/wardmote" run --instance "default"\nEnvironment="WARDMOTE_HOME=${target}"\nEnvironmentFile=-${target}/instances/default/service.env\n`,
    );
    expect(setUnitEnabled.mock.calls).toEqual([[path.basename(unitPath), false], ["wardmote.service", true]]);
    expect(reloadUnits).toHaveBeenCalledTimes(2);
  });

  it("replaces the managed shims, store marker and PATH block, then is a no-op", async () => {
    const binDir = path.join(userHome, ".local", "bin");
    fs.mkdirSync(binDir, { recursive: true });
    const current = path.join(legacy, "cli", "current");
    fs.mkdirSync(path.join(legacy, "cli"), { recursive: true });
    fs.writeFileSync(path.join(legacy, "cli", ".managed-install"), legacyStoreMarker);
    fs.writeFileSync(path.join(binDir, path.basename(unitPath, ".service")), legacyShim(`${current}/node_modules/.bin/x`), { mode: 0o755 });
    fs.writeFileSync(path.join(binDir, "wardmote"), legacyShim(`${current}/node_modules/.bin/x`), { mode: 0o755 });
    fs.writeFileSync(path.join(userHome, ".bashrc"), `alias ll=ls\n${legacyPathStart}\nexport PATH="$HOME/.local/bin:$PATH"\n${legacyPathEnd}\n`);

    await migrateHomeCommand({}, deps());

    expect(fs.existsSync(path.join(binDir, path.basename(unitPath, ".service")))).toBe(false);
    const shim = fs.readFileSync(path.join(binDir, "wardmote"), "utf8");
    expect(shim).toContain("# wardmote managed install shim v1\n");
    expect(shim).toContain(`'${path.join(target, "cli", "current", "node_modules", ".bin", "wardmote")}'`);
    expect(fs.readFileSync(path.join(target, "cli", ".managed-install"), "utf8")).toBe("wardmote managed install store v1\n");
    expect(fs.readFileSync(path.join(userHome, ".bashrc"), "utf8")).toBe(
      'alias ll=ls\n# >>> wardmote managed PATH >>>\nexport PATH="$HOME/.local/bin:$PATH"\n# <<< wardmote managed PATH <<<\n',
    );

    const log = vi.fn();
    await migrateHomeCommand({}, deps({ log }));
    expect(log).toHaveBeenCalledWith("Nothing to migrate: this install already uses the Wardmote names.");
  });

  it("rewrites the retired store marker and replaces the shim when the home already uses the Wardmote name", async () => {
    fs.rmSync(legacy, { recursive: true });
    const binDir = path.join(userHome, ".local", "bin");
    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(path.join(target, "cli"), { recursive: true });
    fs.writeFileSync(path.join(target, "cli", ".managed-install"), legacyStoreMarker);
    const legacyShimPath = path.join(binDir, path.basename(unitPath, ".service"));
    fs.writeFileSync(legacyShimPath, legacyShim(`${target}/cli/current/node_modules/.bin/x`), { mode: 0o755 });

    await migrateHomeCommand({}, deps());

    expect(fs.readFileSync(path.join(target, "cli", ".managed-install"), "utf8")).toBe("wardmote managed install store v1\n");
    expect(fs.existsSync(legacyShimPath)).toBe(false);
    expect(fs.readFileSync(path.join(binDir, "wardmote"), "utf8"))
      .toContain(`'${path.join(target, "cli", "current", "node_modules", ".bin", "wardmote")}'`);
    expect(fs.existsSync(path.join(path.dirname(unitPath), "wardmote.service"))).toBe(true);
    initializeInstallStore(resolveInstallStorePaths({ wardmoteHome: target, homeDir: userHome }));
  });

  it("refuses an unrecognized store marker before replacing the unit or the shim", async () => {
    const binDir = path.join(userHome, ".local", "bin");
    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(path.join(legacy, "cli"), { recursive: true });
    fs.writeFileSync(path.join(legacy, "cli", ".managed-install"), "someone else's store\n");
    const legacyShimPath = path.join(binDir, path.basename(unitPath, ".service"));
    fs.writeFileSync(legacyShimPath, legacyShim(`${legacy}/cli/current/node_modules/.bin/x`), { mode: 0o755 });

    await expect(migrateHomeCommand({}, deps())).rejects.toThrow("unrecognized install store");

    expect(fs.lstatSync(legacy).isDirectory()).toBe(true);
    expect(fs.existsSync(unitPath)).toBe(true);
    expect(fs.existsSync(path.join(path.dirname(unitPath), "wardmote.service"))).toBe(false);
    expect(fs.existsSync(legacyShimPath)).toBe(true);
  });

  it("rewrites only an owned retired store marker", () => {
    const markerPath = path.join(userHome, "store", ".managed-install");
    fs.writeFileSync(path.dirname(markerPath), "not a directory");
    expect(rewriteLegacyStoreMarker(markerPath)).toBe(false);
    fs.rmSync(path.dirname(markerPath));
    fs.mkdirSync(path.dirname(markerPath));
    expect(rewriteLegacyStoreMarker(markerPath)).toBe(false);
    fs.writeFileSync(markerPath, "someone else's store\n");
    expect(rewriteLegacyStoreMarker(markerPath)).toBe(false);
    expect(fs.readFileSync(markerPath, "utf8")).toBe("someone else's store\n");
    fs.rmSync(markerPath);
    const real = path.join(userHome, "real-marker");
    fs.writeFileSync(real, legacyStoreMarker);
    fs.symlinkSync(real, markerPath);
    expect(rewriteLegacyStoreMarker(markerPath)).toBe(false);
    expect(fs.readFileSync(real, "utf8")).toBe(legacyStoreMarker);
    fs.rmSync(markerPath);
    fs.writeFileSync(markerPath, legacyStoreMarker);
    expect(rewriteLegacyStoreMarker(markerPath)).toBe(true);
    expect(fs.readFileSync(markerPath, "utf8")).toBe("wardmote managed install store v1\n");
    expect(fs.statSync(markerPath).mode & 0o777).toBe(0o600);
  });

  it("reports a retired-marker shim it cannot recognise once and does not loop on it", async () => {
    const binDir = path.join(userHome, ".local", "bin");
    fs.mkdirSync(binDir, { recursive: true });
    const odd = path.join(binDir, path.basename(unitPath, ".service"));
    fs.writeFileSync(odd, `#!/bin/sh\n# ${legacyShimMarker}\nexec node x "$@"\n`);
    const log = vi.fn();
    await migrateHomeCommand({}, deps({ log }));
    const lines = log.mock.calls.map(([line]) => String(line));
    expect(lines.some((line) => line.includes(`Left ${odd} in place`))).toBe(true);
    expect(lines.some((line) => line.includes("shim with"))).toBe(false);
    expect(fs.existsSync(odd)).toBe(true);
    expect(hasLegacyInstall(userHome, "linux")).toBe(false);
  });

  it("moves the unit's drop-in directory with it", async () => {
    const dropIns = `${unitPath}.d`;
    fs.mkdirSync(dropIns);
    fs.writeFileSync(path.join(dropIns, "memory.conf"), `[Service]\nMemoryMax=4G\nEnvironmentFile=-${legacy}/x.env\n`);
    await migrateHomeCommand({}, deps());
    expect(fs.existsSync(dropIns)).toBe(false);
    expect(fs.readFileSync(path.join(path.dirname(unitPath), "wardmote.service.d", "memory.conf"), "utf8"))
      .toBe(`[Service]\nMemoryMax=4G\nEnvironmentFile=-${target}/x.env\n`);
  });

  it("refuses a drop-in that is not a regular file before changing anything", async () => {
    const dropIns = `${unitPath}.d`;
    fs.mkdirSync(dropIns);
    fs.writeFileSync(path.join(dropIns, "memory.conf"), "[Service]\nMemoryMax=4G\n");
    fs.symlinkSync(path.join(userHome, "elsewhere.conf"), path.join(dropIns, "linked.conf"));
    const setUnitEnabled = vi.fn(async () => undefined);
    await expect(migrateHomeCommand({}, deps({ setUnitEnabled, unitEnabled: async () => true }))).rejects.toThrow("linked.conf is not a regular file");
    expect(setUnitEnabled).not.toHaveBeenCalled();
    expect(fs.lstatSync(legacy).isDirectory()).toBe(true);
    expect(fs.existsSync(unitPath)).toBe(true);
    expect(fs.readdirSync(dropIns).sort()).toEqual(["linked.conf", "memory.conf"]);
    expect(fs.existsSync(path.join(path.dirname(unitPath), "wardmote.service"))).toBe(false);
    expect(fs.existsSync(path.join(path.dirname(unitPath), "wardmote.service.d"))).toBe(false);
  });

  it("leaves a command it does not manage in place", async () => {
    const binDir = path.join(userHome, ".local", "bin");
    fs.mkdirSync(binDir, { recursive: true });
    const foreign = path.join(binDir, path.basename(unitPath, ".service"));
    fs.writeFileSync(foreign, "#!/bin/sh\necho mine\n");
    await migrateHomeCommand({}, deps());
    expect(fs.readFileSync(foreign, "utf8")).toBe("#!/bin/sh\necho mine\n");
    expect(fs.existsSync(path.join(binDir, "wardmote"))).toBe(false);
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
    await expect(migrateHomeCommand({}, deps({ env: { WARDMOTE_HOME: legacy } }))).rejects.toThrow("Unset it");
    fs.mkdirSync(target);
    await expect(migrateHomeCommand({}, deps())).rejects.toThrow("already exists");
    expect(fs.lstatSync(legacy).isDirectory()).toBe(true);
  });

  it("refuses when the new unit name is already taken", async () => {
    fs.writeFileSync(path.join(path.dirname(unitPath), "wardmote.service"), "");
    await expect(migrateHomeCommand({}, deps())).rejects.toThrow("already exists");
    expect(fs.lstatSync(legacy).isDirectory()).toBe(true);
  });

  it("migrates a launchd agent and its label on macOS", async () => {
    const plist = path.join(userHome, "Library", "LaunchAgents", "ing.paperclip.paperclip-pro.team-a.plist");
    fs.mkdirSync(path.dirname(plist), { recursive: true });
    fs.writeFileSync(plist, "<string>ing.paperclip.paperclip-pro.team-a</string>");
    await migrateHomeCommand({}, deps({ platform: "darwin" }));
    expect(fs.existsSync(plist)).toBe(false);
    expect(fs.readFileSync(path.join(path.dirname(plist), "com.tickernelz.wardmote.team-a.plist"), "utf8")).toBe("<string>com.tickernelz.wardmote.team-a</string>");
  });
});
