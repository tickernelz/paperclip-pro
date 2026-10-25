import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { backgroundFiles, chromiumDir, manifest } from "./harness.test.mjs";

const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
new vm.Script(readFileSync(path.join(chromiumDir, "lib", "contract.js"), "utf8")).runInContext(sandbox);
const catalog = JSON.parse(JSON.stringify(sandbox.LB.contract.permissions));

function ids(availability, kind) {
  return catalog.filter((entry) => entry.chromium === availability && entry.kind === kind).map((entry) => entry.id);
}

function exists(file) {
  return existsSync(path.join(chromiumDir, file));
}

test("required permissions are exactly the catalog's chromium required ids", () => {
  assert.deepEqual([...manifest.permissions].sort(), ids("required", "api").sort());
});

test("optional permissions are exactly the catalog's chromium optional api ids", () => {
  assert.deepEqual([...manifest.optional_permissions].sort(), ids("optional", "api").sort());
  assert.deepEqual(manifest.optional_host_permissions, ids("optional", "origin"));
  assert.deepEqual(manifest.optional_host_permissions, ["<all_urls>"]);
  assert.equal(manifest.host_permissions, undefined, "site access stays optional");
});

test("no unsupported catalog id is declared", () => {
  const declared = new Set([...manifest.permissions, ...manifest.optional_permissions]);
  for (const id of ids("unsupported", "api")) assert.equal(declared.has(id), false, id);
});

test("the manifest is MV3 version 1.1.0 with the shared popup and control center", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "1.1.0");
  assert.equal(manifest.action.default_popup, "ui/popup.html");
  assert.deepEqual(manifest.options_ui, { page: "ui/control.html", open_in_tab: true });
  assert.equal(manifest.background.type, "module");
  assert.equal(manifest.background.service_worker, "background/index.js");
});

test("icons are real PNG files at 16, 32, 48 and 128", () => {
  assert.deepEqual(Object.keys(manifest.icons).sort(), ["128", "16", "32", "48"]);
  for (const [size, file] of Object.entries(manifest.icons)) {
    const bytes = readFileSync(path.join(chromiumDir, file));
    assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG", file);
    assert.equal(bytes.readUInt32BE(16), Number(size), file + " width");
    assert.equal(bytes.readUInt32BE(20), Number(size), file + " height");
  }
});

test("every file the manifest and the service worker reference exists", () => {
  const referenced = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_ui.page,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon || {}),
    ...manifest.content_scripts.flatMap((entry) => entry.js),
    ...backgroundFiles(),
  ];
  for (const file of referenced) assert.equal(exists(file), true, file + " is missing");
});

test("the UI pages reference only files that exist", () => {
  for (const page of ["ui/popup.html", "ui/control.html"]) {
    const html = readFileSync(path.join(chromiumDir, page), "utf8");
    for (const match of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) {
      const target = path.join(path.dirname(page), match[1]);
      assert.equal(exists(target), true, page + " references missing " + target);
    }
  }
});
