import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../manifest.json", import.meta.url)), "utf8"));
const contract = JSON.parse(readFileSync(fileURLToPath(new URL("./protocol.contract.json", import.meta.url)), "utf8"));
const synced = JSON.parse(readFileSync(fileURLToPath(new URL("../../shared/.synced-files.json", import.meta.url)), "utf8"));

function position(list, file) {
  return list.indexOf(file);
}

function catalog(kind) {
  return contract.permissions.filter((entry) => entry.firefox === kind).map((entry) => entry.id);
}

test("required permissions are exactly the catalog's firefox required ids", () => {
  assert.deepEqual([...manifest.permissions].sort(), catalog("required").sort());
});

test("optional permissions are exactly the catalog's firefox optional ids, every website included", () => {
  assert.deepEqual([...manifest.optional_permissions].sort(), catalog("optional").sort());
  assert.ok(manifest.optional_permissions.includes("<all_urls>"));
  assert.equal(manifest.permissions.includes("<all_urls>"), false);
});

test("no catalog id unsupported in firefox is declared", () => {
  const declared = new Set([...manifest.permissions, ...manifest.optional_permissions]);
  for (const id of catalog("unsupported")) assert.equal(declared.has(id), false, id + " is unsupported in firefox");
});

test("the manifest uses the shared popup and control center", () => {
  assert.equal(manifest.browser_action.default_popup, "ui/popup.html");
  assert.deepEqual(manifest.options_ui, { page: "ui/control.html", open_in_tab: true });
  assert.equal(manifest.browser_specific_settings.gecko.id, "local-browser@paperclip.app");
  assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, "128.0");
});

test("the background loads the shared layer first in its documented order", () => {
  const scripts = manifest.background.scripts;
  assert.equal(position(scripts, "lib/contract.js"), 0);
  assert.equal(position(scripts, "lib/ext-api.js"), 1);
  for (const file of ["lib/access.js", "lib/guards.js", "lib/headers.js", "lib/api-call.js", "lib/pairing.js"]) {
    assert.ok(position(scripts, file) > position(scripts, "lib/ext-api.js"), file + " must load after ext-api");
    assert.ok(position(scripts, file) < position(scripts, "lib/protocol.js"), file + " must load before the firefox modules");
  }
});

test("budget.js loads after protocol.js", () => {
  const scripts = manifest.background.scripts;
  assert.ok(position(scripts, "lib/budget.js") > position(scripts, "lib/protocol.js"));
});

test("protocol.js leads the content scripts", () => {
  assert.equal(position(manifest.content_scripts[0].js, "lib/protocol.js"), 0);
});

test("the walker loads after text, refmap and cursor, which it captures at load", () => {
  const files = manifest.content_scripts[0].js;
  assert.ok(position(files, "lib/snapshot.js") > position(files, "lib/text.js"));
  assert.ok(position(files, "lib/snapshot.js") > position(files, "lib/refmap.js"));
  assert.ok(position(files, "lib/snapshot.js") > position(files, "lib/cursor.js"));
});

test("the document state tracker loads before the content agent", () => {
  const files = manifest.content_scripts[0].js;
  assert.ok(position(files, "lib/document-state.js") !== -1);
  assert.ok(position(files, "lib/document-state.js") < position(files, "content/agent.js"));
});

test("every synced shared file is present in the firefox folder", () => {
  for (const file of synced.files) {
    assert.ok(existsSync(fileURLToPath(new URL("../" + file, import.meta.url))), file + " is not synced");
  }
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
    manifest.options_ui.page,
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

test("the permissions the network and input paths ask for are requestable", () => {
  for (const permission of ["tabs", "scripting", "webRequest", "webRequestBlocking", "cookies", "downloads", "<all_urls>"]) {
    assert.ok(manifest.optional_permissions.includes(permission), permission + " is missing");
  }
});

test("the manifest is a persistent manifest v2 add-on with a pinned id", () => {
  assert.equal(manifest.manifest_version, 2);
  assert.equal(manifest.background.persistent, true);
  assert.match(manifest.browser_specific_settings.gecko.id, /@/);
  assert.ok(Number(manifest.browser_specific_settings.gecko.strict_min_version.split(".")[0]) >= 128);
});

function contentFilesFromSource() {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  createContext(sandbox);
  for (const file of ["lib/protocol.js", "background/tabs.js"]) {
    runInContext(readFileSync(fileURLToPath(new URL("../" + file, import.meta.url)), "utf8"), sandbox, { filename: file });
  }
  return JSON.parse(JSON.stringify(sandbox.LB.tabs.CONTENT_FILES));
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
    Date,
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
  assert.equal(typeof sandbox.LB.documentState.read, "function");
});

test("a CONTENT_FILES list that drops a module fails to boot instead of failing silently", () => {
  const full = contentFilesFromSource();
  const withoutInput = full.filter((file) => file !== "lib/input.js");
  assert.throws(() => bootContent(withoutInput), /createInputState|Cannot read properties of undefined/);
});
