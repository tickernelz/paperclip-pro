import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../scripts/sync-local-browser-shared.mjs");

function workspace(t) {
  const root = mkdtempSync(path.join(tmpdir(), "lb-sync-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "scripts"));
  copyFileSync(script, path.join(root, "scripts", "sync-local-browser-shared.mjs"));
  const app = path.join(root, "apps", "local-browser");
  const put = (relative, body) => {
    const file = path.join(app, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
  };
  const read = (relative) => readFileSync(path.join(app, relative), "utf8");
  const has = (relative) => existsSync(path.join(app, relative));
  const run = (...args) => {
    const result = spawnSync(process.execPath, [path.join(root, "scripts", "sync-local-browser-shared.mjs"), ...args], { encoding: "utf8" });
    return { status: result.status, output: result.stdout + result.stderr };
  };
  return { root, app, put, read, has, run };
}

function seed(ws) {
  ws.put("shared/lib/a.js", "a1");
  ws.put("shared/ui/page.html", "<p>page</p>");
  ws.put("shared/lib/a.test.mjs", "test");
  ws.put("shared/README.md", "readme");
  ws.put("chromium/background/own.js", "chromium own");
  ws.put("chromium/lib/browser-only.js", "chromium lib own");
  ws.put("firefox/lib/browser-only.js", "firefox lib own");
}

const UNRELATED = {
  "chromium/background/own.js": "chromium own",
  "chromium/lib/browser-only.js": "chromium lib own",
  "firefox/lib/browser-only.js": "firefox lib own",
};

function assertUnrelatedIntact(ws) {
  for (const [file, body] of Object.entries(UNRELATED)) assert.equal(ws.read(file), body, file);
}

test("copies shared files into both browser trees and skips tests and docs", (t) => {
  const ws = workspace(t);
  seed(ws);
  assert.equal(ws.run("--check").status, 1);
  assert.equal(ws.run().status, 0);
  for (const browser of ["chromium", "firefox"]) {
    assert.equal(ws.read(browser + "/lib/a.js"), "a1");
    assert.equal(ws.read(browser + "/ui/page.html"), "<p>page</p>");
    assert.equal(ws.has(browser + "/lib/a.test.mjs"), false);
    assert.equal(ws.has(browser + "/README.md"), false);
  }
  assert.deepEqual(JSON.parse(ws.read("shared/.synced-files.json")).files, ["lib/a.js", "ui/page.html"]);
  assertUnrelatedIntact(ws);
  const check = ws.run("--check");
  assert.equal(check.status, 0, check.output);
});

test("--check fails on drifted, missing and stale-manifest copies without writing", (t) => {
  const ws = workspace(t);
  seed(ws);
  ws.run();
  ws.put("chromium/lib/a.js", "edited by hand");
  rmSync(path.join(ws.app, "firefox/ui/page.html"));
  ws.put("shared/lib/new.js", "new");
  const check = ws.run("--check");
  assert.equal(check.status, 1);
  assert.match(check.output, /drifted: apps\/local-browser\/chromium\/lib\/a\.js/);
  assert.match(check.output, /missing: apps\/local-browser\/firefox\/ui\/page\.html/);
  assert.match(check.output, /missing: apps\/local-browser\/chromium\/lib\/new\.js/);
  assert.match(check.output, /stale manifest/);
  assert.equal(ws.read("chromium/lib/a.js"), "edited by hand");
  assert.equal(ws.has("firefox/ui/page.html"), false);
  assert.equal(ws.has("chromium/lib/new.js"), false);
  assert.equal(ws.run().status, 0);
  assert.equal(ws.read("chromium/lib/a.js"), "a1");
  assert.equal(ws.read("firefox/ui/page.html"), "<p>page</p>");
  assert.equal(ws.read("firefox/lib/new.js"), "new");
  assert.equal(ws.run("--check").status, 0);
});

test("removes only previously synced files that left shared/", (t) => {
  const ws = workspace(t);
  seed(ws);
  ws.run();
  rmSync(path.join(ws.app, "shared/lib/a.js"));
  const check = ws.run("--check");
  assert.equal(check.status, 1);
  assert.match(check.output, /no longer shared but still present: apps\/local-browser\/chromium\/lib\/a\.js/);
  assert.match(check.output, /no longer shared but still present: apps\/local-browser\/firefox\/lib\/a\.js/);
  assert.equal(ws.has("chromium/lib/a.js"), true);
  assert.equal(ws.run().status, 0);
  assert.equal(ws.has("chromium/lib/a.js"), false);
  assert.equal(ws.has("firefox/lib/a.js"), false);
  assert.equal(ws.read("chromium/ui/page.html"), "<p>page</p>");
  assertUnrelatedIntact(ws);
  assert.deepEqual(JSON.parse(ws.read("shared/.synced-files.json")).files, ["ui/page.html"]);
  assert.equal(ws.run("--check").status, 0);
});

test("never deletes unrelated files, even when the manifest names them or escapes the tree", (t) => {
  const ws = workspace(t);
  seed(ws);
  writeFileSync(path.join(ws.root, "outside.txt"), "outside");
  ws.put("shared/.synced-files.json", JSON.stringify({ files: ["../../../outside.txt", "../chromium/background/own.js", "lib/a.js"] }));
  assert.equal(ws.run().status, 0);
  assert.equal(readFileSync(path.join(ws.root, "outside.txt"), "utf8"), "outside");
  assertUnrelatedIntact(ws);
  assert.equal(ws.read("firefox/lib/a.js"), "a1");
  ws.put("shared/lib/browser-only.js", "now shared");
  ws.run();
  rmSync(path.join(ws.app, "shared/lib/browser-only.js"));
  ws.put("chromium/lib/browser-only.js", "chromium lib own");
  ws.put("firefox/lib/browser-only.js", "firefox lib own");
  ws.put("shared/.synced-files.json", JSON.stringify({ files: ["lib/a.js", "ui/page.html"] }));
  assert.equal(ws.run().status, 0);
  assertUnrelatedIntact(ws);
});
