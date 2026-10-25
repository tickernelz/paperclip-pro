(function (root) {
  "use strict";

  var LB = root.LB;
  var protocol = LB.protocol;

  var CONTENT_FILES = [
    "lib/protocol.js",
    "lib/text.js",
    "lib/refmap.js",
    "lib/cursor.js",
    "lib/snapshot.js",
    "lib/markdown.js",
    "lib/dom-adapter.js",
    "lib/document-state.js",
    "lib/keys.js",
    "lib/input.js",
    "content/agent.js"
  ];

  var DEFAULT_STORE = "firefox-default";
  var PRIVATE_STORE = "firefox-private";
  var containers = new Map();

  function identitiesApi() {
    var api = browser.contextualIdentities;
    return api && typeof api.query === "function" ? api : null;
  }

  async function refreshContainers() {
    var api = identitiesApi();
    if (!api) return containers;
    var next = new Map();
    try {
      var list = await api.query({});
      for (var i = 0; i < (list || []).length; i += 1) {
        var identity = list[i];
        if (identity && identity.cookieStoreId) next.set(identity.cookieStoreId, { name: identity.name, color: identity.color });
      }
    } catch (error) {
      void error;
    }
    containers = next;
    return containers;
  }

  function installContainerWatchers(onChange) {
    var api = identitiesApi();
    if (!api) return;
    var names = ["onCreated", "onUpdated", "onRemoved"];
    for (var i = 0; i < names.length; i += 1) {
      var event = api[names[i]];
      if (!event || typeof event.addListener !== "function") continue;
      event.addListener(function () {
        void refreshContainers().then(function () {
          if (typeof onChange === "function") onChange();
        });
      });
    }
  }

  async function container(cookieStoreId) {
    var id = typeof cookieStoreId === "string" && cookieStoreId ? cookieStoreId : DEFAULT_STORE;
    var out = { cookieStoreId: id, isDefault: id === DEFAULT_STORE };
    if (id === DEFAULT_STORE) return out;
    if (id === PRIVATE_STORE) {
      out.name = "Private browsing";
      return out;
    }
    var api = identitiesApi();
    if (!api || typeof api.get !== "function") return out;
    try {
      var identity = await api.get(id);
      if (identity) {
        if (identity.name) out.name = identity.name;
        if (identity.color) out.color = identity.color;
        containers.set(id, { name: identity.name, color: identity.color });
      }
    } catch (error) {
      void error;
    }
    return out;
  }

  async function containerExists(cookieStoreId) {
    if (cookieStoreId === DEFAULT_STORE || cookieStoreId === PRIVATE_STORE) return true;
    var api = identitiesApi();
    if (!api || typeof api.get !== "function") return false;
    try {
      return Boolean(await api.get(cookieStoreId));
    } catch (error) {
      return false;
    }
  }

  function summarize(tab) {
    var out = {
      tabId: tab.id,
      title: tab.title || "",
      url: tab.url || "",
      active: tab.active === true,
      status: tab.status || "unknown"
    };
    if (typeof tab.windowId === "number" && tab.windowId >= 0) out.windowId = tab.windowId;
    if (typeof tab.cookieStoreId === "string" && tab.cookieStoreId) {
      out.cookieStoreId = tab.cookieStoreId;
      var known = containers.get(tab.cookieStoreId);
      if (known && known.name) out.containerName = known.name;
    }
    if (typeof tab.incognito === "boolean") out.incognito = tab.incognito;
    if (typeof tab.discarded === "boolean") out.discarded = tab.discarded;
    if (typeof tab.pinned === "boolean") out.pinned = tab.pinned;
    if (typeof tab.audible === "boolean") out.audible = tab.audible;
    return out;
  }

  async function listTabs() {
    var tabs = await browser.tabs.query({});
    var out = [];
    for (var i = 0; i < tabs.length; i += 1) {
      if (typeof tabs[i].id === "number" && tabs[i].id >= 0) out.push(summarize(tabs[i]));
    }
    return out;
  }

  async function resolveTab(args) {
    var wanted = args && typeof args.tabId === "number" ? args.tabId : null;
    if (wanted !== null) {
      try {
        return summarize(await browser.tabs.get(wanted));
      } catch (error) {
        throw protocol.error(protocol.ERROR_CODES.tabMissing, "Tab " + wanted + " is gone", "Call local_browser_sessions for the current tabs", true);
      }
    }
    var active = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    if (!active.length) active = await browser.tabs.query({ active: true });
    if (!active.length) {
      throw protocol.error(protocol.ERROR_CODES.tabMissing, "No active tab to drive", "Open a tab, or pass tabId from local_browser_sessions", true);
    }
    return summarize(active[0]);
  }

  async function activeTab() {
    var active = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    if (!active.length) active = await browser.tabs.query({ active: true });
    return active.length ? summarize(active[0]) : null;
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function waitForLoad(tabId, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = null;
      function listener(id, info) {
        if (id === tabId && info.status === "complete") finish(null);
      }
      function finish(error) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        browser.tabs.onUpdated.removeListener(listener);
        if (error) reject(error);
        else resolve();
      }
      timer = setTimeout(function () {
        finish(protocol.error(protocol.ERROR_CODES.timeout, "The page did not finish loading in " + timeoutMs + "ms", "Take a snapshot to see where it stopped", true));
      }, timeoutMs);
      browser.tabs.onUpdated.addListener(listener);
      setTimeout(function () {
        browser.tabs
          .get(tabId)
          .then(function (tab) {
            if (tab.status === "complete") finish(null);
          })
          .catch(function () {
            finish(protocol.error(protocol.ERROR_CODES.tabMissing, "Tab " + tabId + " closed while loading", "Call local_browser_sessions for the current tabs", true));
          });
      }, 60);
    });
  }

  async function ensureAgent(tabId) {
    try {
      await browser.tabs.sendMessage(tabId, { channel: "lb", op: "ping", args: {} }, { frameId: TOP_FRAME });
      return;
    } catch (error) {
      void error;
    }
    var injected = false;
    for (var i = 0; i < CONTENT_FILES.length; i += 1) {
      try {
        await browser.tabs.executeScript(tabId, { file: CONTENT_FILES[i], runAt: "document_idle" });
        injected = true;
      } catch (error) {
        injected = false;
        break;
      }
    }
    if (!injected) {
      throw protocol.error(
        protocol.ERROR_CODES.unsupported,
        "Firefox does not let an extension script this page",
        "Switch to a normal http or https tab; about:, addons.mozilla.org and PDF viewers are closed to extensions",
        false
      );
    }
    try {
      await browser.tabs.sendMessage(tabId, { channel: "lb", op: "ping", args: {} }, { frameId: TOP_FRAME });
    } catch (error) {
      throw protocol.error(protocol.ERROR_CODES.unsupported, "The page script did not answer after injection", "Reload the tab and retry", true);
    }
  }

  var TOP_FRAME = 0;

  async function probeAgent(tab) {
    try {
      var pong = await browser.tabs.sendMessage(tab.tabId, { channel: "lb", op: "ping", args: {} }, { frameId: TOP_FRAME });
      if (pong && pong.ok) return "connected";
    } catch (error) {
      void error;
    }
    if (!/^(https?|file):/i.test(String(tab.url || ""))) return "blocked";
    var host = false;
    try {
      host = await browser.permissions.contains({ origins: ["<all_urls>"] });
    } catch (error) {
      host = false;
    }
    return host ? "missing" : "blocked";
  }

  async function send(tabId, op, args) {
    await ensureAgent(tabId);
    var response;
    try {
      response = await browser.tabs.sendMessage(tabId, { channel: "lb", op: op, args: args || {} }, { frameId: TOP_FRAME });
    } catch (error) {
      throw protocol.error(
        protocol.ERROR_CODES.extensionUnavailable,
        error && error.message ? error.message : "The page did not answer",
        "Reload the tab and retry",
        true
      );
    }
    if (!response) {
      throw protocol.error(protocol.ERROR_CODES.protocolError, "The page returned no answer", "Reload the tab and retry", true);
    }
    if (response.ok) return response.result;
    throw response.error;
  }

  async function activate(tab) {
    if (!tab.active) await browser.tabs.update(tab.tabId, { active: true });
    try {
      await browser.windows.update(tab.windowId, { focused: true });
    } catch (error) {
      return;
    }
  }

  async function measureCapture(dataUrl) {
    if (typeof dataUrl !== "string" || !dataUrl) return null;
    try {
      var response = await fetch(dataUrl);
      var blob = await response.blob();
      var bitmap = await createImageBitmap(blob);
      var size = { width: bitmap.width, height: bitmap.height };
      if (typeof bitmap.close === "function") bitmap.close();
      return size;
    } catch (error) {
      return null;
    }
  }

  async function captureVisible(windowId) {
    var dataUrl;
    try {
      dataUrl = await browser.tabs.captureVisibleTab(windowId, { format: "png" });
    } catch (error) {
      throw protocol.error(
        protocol.ERROR_CODES.extensionUnavailable,
        error && error.message ? error.message : "Firefox refused the screenshot",
        "Bring the window to the front, or check that the tab is not a restricted page",
        true
      );
    }
    return { dataUrl: dataUrl };
  }

  root.LB = root.LB || {};
  root.LB.tabs = {
    CONTENT_FILES: CONTENT_FILES,
    DEFAULT_STORE: DEFAULT_STORE,
    PRIVATE_STORE: PRIVATE_STORE,
    refreshContainers: refreshContainers,
    installContainerWatchers: installContainerWatchers,
    container: container,
    containerExists: containerExists,
    probeAgent: probeAgent,
    summarize: summarize,
    listTabs: listTabs,
    resolveTab: resolveTab,
    activeTab: activeTab,
    waitForLoad: waitForLoad,
    ensureAgent: ensureAgent,
    send: send,
    activate: activate,
    measureCapture: measureCapture,
    captureVisible: captureVisible,
    sleep: sleep
  };
})(globalThis);
