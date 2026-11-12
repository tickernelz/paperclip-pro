import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWardmoteUpdateService, resolveWardmoteInstallKind } from "../services/wardmote-updates.js";

let homeDir: string;
beforeEach(() => { homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "zha5799-updates-")); });
afterEach(() => { fs.rmSync(homeDir, { recursive: true, force: true }); });

function writeManifest(manifest: Record<string, unknown>) {
  fs.mkdirSync(path.join(homeDir, "cli"), { recursive: true });
  fs.writeFileSync(path.join(homeDir, "cli", "install.json"), JSON.stringify(manifest));
}

function service(overrides: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; now?: () => number; configCheckEnabled?: () => boolean } = {}) {
  return createWardmoteUpdateService({
    env: overrides.env ?? { WARDMOTE_SERVICE_MANAGED: "1" },
    homeDir,
    currentVersion: "2026.1111.0",
    fetchImpl: overrides.fetchImpl,
    now: overrides.now ?? (() => Date.UTC(2026, 10, 12)),
    configCheckEnabled: overrides.configCheckEnabled ?? (() => true),
    inContainer: () => false,
    serverModulePath: "/home/u/.wardmote/cli/installs/npm/2026.1111.0/node_modules/@tickernelz/wardmote-server/dist/services/wardmote-updates.js",
  });
}

describe("wardmote update service", () => {
  it("reports a newer version on the install channel with release notes and the manual command", async () => {
    writeManifest({ source: "npm", channel: "latest" });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ latest: "2026.1112.0" })));
    const updates = service({ fetchImpl });
    expect(updates.status().updateAvailable).toBe(false);
    await updates.refresh();
    expect(updates.status()).toMatchObject({
      currentVersion: "2026.1111.0",
      latestVersion: "2026.1112.0",
      updateAvailable: true,
      channel: "latest",
      releaseNotesUrl: "https://github.com/tickernelz/wardmote/releases/tag/v2026.1112.0",
      install: { kind: "managed", command: "wardmote update --version 2026.1112.0" },
    });
  });

  it("reuses the 24 hour cache instead of asking the registry again", async () => {
    writeManifest({ source: "npm", channel: "latest" });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ latest: "2026.1112.0" })));
    await service({ fetchImpl }).refresh();
    await service({ fetchImpl, now: () => Date.UTC(2026, 10, 12, 23) }).refresh();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("knows the cached newest version right after a restart, before any network check", async () => {
    writeManifest({ source: "npm", channel: "latest" });
    fs.writeFileSync(path.join(homeDir, "cli", "update-check.json"), JSON.stringify({ checkedAt: Date.UTC(2026, 10, 12), latest: "2026.1112.0", channel: "latest" }));
    const fetchImpl = vi.fn(async () => new Response("{}"));
    expect(service({ fetchImpl }).status()).toMatchObject({ latestVersion: "2026.1112.0", updateAvailable: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stays silent and shows no update when the registry is unreachable", async () => {
    const updates = service({ fetchImpl: vi.fn(async () => { throw new TypeError("fetch failed"); }) });
    await expect(updates.refresh()).resolves.toBeUndefined();
    expect(updates.status()).toMatchObject({ latestVersion: null, updateAvailable: false, checkedAt: null });
  });

  it("never contacts the registry when the deployment switch or config disables checks", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ latest: "2026.1112.0" })));
    for (const updates of [service({ fetchImpl, env: { WARDMOTE_UPDATE_CHECK: "0" } }), service({ fetchImpl, configCheckEnabled: () => false })]) {
      await updates.refresh();
      expect(updates.startPeriodicChecks()).toBeTypeOf("function");
      expect(updates.status()).toMatchObject({ checkEnabled: false, updateAvailable: false });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("follows the canary channel of a canary install", async () => {
    writeManifest({ source: "npm", channel: "canary" });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ latest: "2026.1111.0", canary: "2026.1112.0-canary.3" })));
    const updates = service({ fetchImpl });
    await updates.refresh();
    expect(updates.status()).toMatchObject({ channel: "canary", latestVersion: "2026.1112.0-canary.3", updateAvailable: true });
  });
});

describe("resolveWardmoteInstallKind", () => {
  const npmPath = "/x/node_modules/@tickernelz/wardmote-server/dist/services/wardmote-updates.js";
  it("tells managed service, foreground managed, docker, npm, and source installs apart", () => {
    expect(resolveWardmoteInstallKind({ env: { WARDMOTE_SERVICE_MANAGED: "1" }, manifest: { source: "npm" }, inContainer: false, serverModulePath: npmPath })).toBe("managed");
    expect(resolveWardmoteInstallKind({ env: {}, manifest: { source: "npm" }, inContainer: false, serverModulePath: npmPath })).toBe("managed_foreground");
    expect(resolveWardmoteInstallKind({ env: { WARDMOTE_SERVICE_MANAGED: "1" }, manifest: { source: "npm" }, inContainer: true, serverModulePath: npmPath })).toBe("docker");
    expect(resolveWardmoteInstallKind({ env: { WARDMOTE_SERVICE_MANAGED: "1" }, manifest: { source: "git" }, inContainer: false, serverModulePath: npmPath })).toBe("source");
    expect(resolveWardmoteInstallKind({ env: {}, manifest: null, inContainer: false, serverModulePath: npmPath })).toBe("npm");
    expect(resolveWardmoteInstallKind({ env: {}, manifest: null, inContainer: false, serverModulePath: "/repo/server/src/services/wardmote-updates.ts" })).toBe("source");
  });
});
