import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../manifest.json", import.meta.url)), "utf8"));

function position(list, file) {
  return list.indexOf(file);
}

test("protocol.js loads first so every module can read its defaults", () => {
  assert.equal(position(manifest.background.scripts, "lib/protocol.js"), 0);
  assert.equal(position(manifest.content_scripts[0].js, "lib/protocol.js"), 0);
});

test("budget.js loads after protocol.js", () => {
  const scripts = manifest.background.scripts;
  assert.ok(position(scripts, "lib/budget.js") > position(scripts, "lib/protocol.js"));
});

test("the walker loads after text and refmap, which it captures at load", () => {
  const files = manifest.content_scripts[0].js;
  assert.ok(position(files, "lib/snapshot.js") > position(files, "lib/text.js"));
  assert.ok(position(files, "lib/snapshot.js") > position(files, "lib/refmap.js"));
});

test("the content agent loads last", () => {
  const files = manifest.content_scripts[0].js;
  assert.equal(position(files, "content/agent.js"), files.length - 1);
});

test("the background entry loads last", () => {
  const scripts = manifest.background.scripts;
  assert.equal(position(scripts, "background/index.js"), scripts.length - 1);
});

test("every manifest script reference exists", () => {
  const root = new URL("../", import.meta.url);
  const referenced = [
    ...manifest.background.scripts,
    ...manifest.content_scripts.flatMap((entry) => entry.js),
    manifest.browser_action.default_popup,
    ...Object.values(manifest.icons),
  ];
  for (const file of referenced) {
    assert.doesNotThrow(() => readFileSync(fileURLToPath(new URL(file, root))), file + " is missing");
  }
});

test("no test or helper module is shipped in the manifest", () => {
  const shipped = [...manifest.background.scripts, ...manifest.content_scripts.flatMap((entry) => entry.js)];
  for (const file of shipped) {
    assert.equal(file.includes(".test."), false, file + " is a test file");
    assert.equal(file.includes("test-dom"), false, file + " is a test helper");
  }
});

test("the content script covers every url and runs in all frames", () => {
  const entry = manifest.content_scripts[0];
  assert.deepEqual(entry.matches, ["<all_urls>"]);
  assert.equal(entry.all_frames, true);
  assert.equal(entry.run_at, "document_idle");
});

test("the permissions the network and input paths need are declared", () => {
  for (const permission of ["tabs", "storage", "scripting", "webRequest", "webRequestBlocking", "cookies", "downloads", "<all_urls>"]) {
    assert.ok(manifest.permissions.includes(permission), permission + " is missing");
  }
});

test("the manifest is a persistent manifest v2 add-on with a pinned id", () => {
  assert.equal(manifest.manifest_version, 2);
  assert.equal(manifest.background.persistent, true);
  assert.match(manifest.browser_specific_settings.gecko.id, /@/);
  assert.ok(Number(manifest.browser_specific_settings.gecko.strict_min_version.split(".")[0]) >= 128);
});

function contentFilesFromSource() {
  const source = readFileSync(fileURLToPath(new URL("../background/tabs.js", import.meta.url)), "utf8");
  const match = /var CONTENT_FILES = \[([\s\S]*?)\];/.exec(source);
  assert.ok(match, "background/tabs.js must declare CONTENT_FILES");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

function bootContent(files) {
  const sandbox = {
    URL,
    URLSearchParams,
    TextDecoder,
    TextEncoder,
    setTimeout,
    clearTimeout,
    console,
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    performance: { getEntriesByType: () => [] },
    MutationObserver: class {
      observe() {}
    },
    Event: class {},
    KeyboardEvent: class {},
    MouseEvent: class {},
    PointerEvent: class {},
    WheelEvent: class {},
    localStorage: { length: 0, key: () => null, getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} },
    sessionStorage: { length: 0, key: () => null, getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} },
    DataTransfer: class {
      constructor() {
        this.files = [];
        this.items = { add: () => {} };
      }
    },
    File: class {},
    FileReader: class {},
    OffscreenCanvas: class {},
    createImageBitmap: async () => ({ close() {} }),
    fetch: async () => {
      throw new Error("offline");
    },
  };
  sandbox.browser = { runtime: { onMessage: { addListener: () => {} } } };
  sandbox.window = {
    innerWidth: 800,
    innerHeight: 600,
    devicePixelRatio: 1,
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
    getSelection: () => null,
    scrollBy() {},
    scrollTo() {},
    addEventListener() {},
  };
  sandbox.document = {
    title: "",
    readyState: "complete",
    documentElement: { scrollWidth: 800, scrollHeight: 600 },
    body: null,
    createElement: () => ({}),
    createRange: () => ({ selectNodeContents() {} }),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    elementFromPoint: () => null,
    execCommand: () => false,
    getElementsByTagName: () => [],
    addEventListener() {},
  };
  sandbox.location = { href: "https://example.test/" };
  sandbox.globalThis = sandbox;
  createContext(sandbox);
  for (const file of files) {
    runInContext(readFileSync(fileURLToPath(new URL("../" + file, import.meta.url)), "utf8"), sandbox, { filename: file });
  }
  return sandbox;
}

test("CONTENT_FILES is the manifest content script list verbatim, in order", () => {
  assert.deepEqual(contentFilesFromSource(), manifest.content_scripts[0].js);
});

test("injecting exactly CONTENT_FILES boots the agent with every module it needs", () => {
  const sandbox = bootContent(contentFilesFromSource());
  assert.equal(typeof sandbox.LB.input.createInputState, "function", "LB.input must exist after injection");
  assert.equal(typeof sandbox.LB.cursor.parseCursor, "function", "LB.cursor must exist after injection");
  assert.equal(typeof sandbox.LB.snapshot.buildSnapshot, "function");
  assert.equal(typeof sandbox.LB.dom.adapter.url, "function");
  assert.equal(typeof sandbox.LB.markdown.renderMarkdown, "function");
  assert.equal(typeof sandbox.LB.keys.resolve, "function");
});

test("a CONTENT_FILES list that drops a module fails to boot instead of failing silently", () => {
  const full = contentFilesFromSource();
  const withoutInput = full.filter((file) => file !== "lib/input.js");
  assert.throws(() => bootContent(withoutInput), /createInputState|Cannot read properties of undefined/);
});
