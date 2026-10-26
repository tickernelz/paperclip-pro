(function (root) {
  "use strict";

  var LB = root.LB;
  var core = LB.bg.core;
  var ERROR = core.ERROR;
  var ToolFailure = core.ToolFailure;
  var REGULAR_STORE = "0";
  var INCOGNITO_STORE = "1";
  var INCOGNITO_HINT = "Open chrome://extensions, click Details on Paperclip Local Browser, turn on Allow in Incognito, then retry";
  var GUARD_HINT = "Call local_browser_open with a url; that always uses a fresh tab. The user can turn this guard off in the extension's Agent guards section";
  var agentTabs = new Set();

  async function cookieStores() {
    var stores = new Map();
    if (!chrome.cookies || typeof chrome.cookies.getAllCookieStores !== "function") return stores;
    try {
      var list = await chrome.cookies.getAllCookieStores();
      for (var index = 0; index < (list || []).length; index += 1) {
        var store = list[index];
        for (var tab = 0; tab < (store.tabIds || []).length; tab += 1) stores.set(store.tabIds[tab], String(store.id));
      }
    } catch (error) {}
    return stores;
  }

  function storeIdOf(tab, stores) {
    if (stores && stores.has(tab.id)) return stores.get(tab.id);
    return tab.incognito === true ? INCOGNITO_STORE : REGULAR_STORE;
  }

  function tabInfo(tab, stores) {
    var info = {
      tabId: tab.id,
      windowId: tab.windowId,
      title: tab.title || "",
      url: tab.url || "",
      active: tab.active === true,
      status: tab.status || "unknown",
      cookieStoreId: storeIdOf(tab, stores),
      incognito: tab.incognito === true,
      discarded: tab.discarded === true,
      pinned: tab.pinned === true,
      audible: tab.audible === true
    };
    if (typeof tab.frozen === "boolean") info.frozen = tab.frozen;
    if (typeof info.windowId !== "number" || info.windowId < 0) delete info.windowId;
    return info;
  }

  async function describe(tab) {
    return tabInfo(tab, await cookieStores());
  }

  async function listTabs() {
    var tabs = await chrome.tabs.query({});
    var stores = await cookieStores();
    return tabs
      .filter(function (tab) {
        return typeof tab.id === "number" && tab.id >= 0;
      })
      .map(function (tab) {
        return tabInfo(tab, stores);
      });
  }

  async function focusedTab() {
    var focused = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return focused && focused[0] ? focused[0] : null;
  }

  async function resolveTab(args) {
    if (typeof args.tabId === "number") {
      var tab = await chrome.tabs.get(args.tabId).catch(function () {
        return null;
      });
      if (!tab) {
        throw new ToolFailure(ERROR.tabMissing, "Tab " + args.tabId + " is gone", "Call local_browser_sessions for the current tabs");
      }
      return tab;
    }
    var focused = await focusedTab();
    if (focused) return focused;
    var any = await chrome.tabs.query({ active: true });
    if (any && any[0]) return any[0];
    throw new ToolFailure(ERROR.tabMissing, "No active tab in the paired browser", "Open a tab, then retry");
  }

  function sendToTab(tabId, payload, timeoutMs, frameId) {
    var options = typeof frameId === "number" ? { frameId: frameId } : {};
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new ToolFailure(ERROR.timeout, "The page did not answer in " + timeoutMs + " ms", "Retry, or reload the tab", true));
      }, timeoutMs);
      chrome.tabs.sendMessage(tabId, payload, options, function (response) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        var lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        if (!response) {
          reject(new Error("The page returned no response"));
          return;
        }
        if (response.ok === false) {
          reject(core.fromContentError(response.error));
          return;
        }
        resolve(response.result);
      });
    });
  }

  async function injectContentScript(tabId) {
    await chrome.scripting.executeScript({ target: { tabId: tabId }, files: core.CONTENT_FILES });
  }

  async function rpc(tabId, op, args, timeoutMs) {
    var payload = { type: "lb:rpc", op: op, args: args || {}, tabId: tabId };
    var budget = typeof timeoutMs === "number" ? timeoutMs : 15000;
    try {
      return await sendToTab(tabId, payload, budget, 0);
    } catch (error) {
      if (!core.isNoReceiver(error)) throw error;
      await injectContentScript(tabId).catch(function () {});
      try {
        return await sendToTab(tabId, payload, budget, 0);
      } catch (retryError) {
        if (!core.isNoReceiver(retryError)) throw retryError;
        return await sendToTab(tabId, payload, budget);
      }
    }
  }

  function scriptable(url) {
    return /^(https?|file|ftp):/i.test(String(url || "")) && !/^https:\/\/chrome(webstore)?\.google\.com\/webstore/i.test(String(url || ""));
  }

  async function documentProbe(tab, timeoutMs) {
    var budget = typeof timeoutMs === "number" ? timeoutMs : 3000;
    var payload = { type: "lb:rpc", op: "documentState", args: {}, tabId: tab.id };
    try {
      return { contentScript: "connected", document: (await sendToTab(tab.id, payload, budget, 0)) || null };
    } catch (error) {
      if (!core.isNoReceiver(error)) return { contentScript: "connected", document: null };
    }
    if (!scriptable(tab.url)) return { contentScript: "blocked", document: null };
    try {
      await injectContentScript(tab.id);
    } catch (error) {
      return { contentScript: "blocked", document: null };
    }
    try {
      return { contentScript: "connected", document: (await sendToTab(tab.id, payload, budget, 0)) || null };
    } catch (error) {
      return { contentScript: "missing", document: null };
    }
  }

  async function documentOf(tabId, timeoutMs) {
    try {
      var state = await rpc(tabId, "documentState", {}, typeof timeoutMs === "number" ? timeoutMs : 3000);
      return state || null;
    } catch (error) {
      return null;
    }
  }

  async function waitForTab(tabId, waitUntil, timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    var mode = waitUntil || "load";
    while (Date.now() < deadline) {
      var tab = await chrome.tabs.get(tabId).catch(function () {
        return null;
      });
      if (!tab) throw new ToolFailure(ERROR.tabMissing, "The tab closed while loading", "Open the page again");
      if (tab.status === "complete") {
        if (mode !== "networkidle") return tab;
        var remaining = Math.max(200, deadline - Date.now());
        var idle = await rpc(tabId, "wait", { idle: true, timeoutMs: Math.min(3000, remaining) }, Math.min(6000, remaining + 1000)).catch(function () {
          return { matched: true };
        });
        if (idle && idle.matched !== false) return tab;
      }
      await core.sleep(120);
    }
    throw new ToolFailure(ERROR.timeout, "The page did not settle in " + timeoutMs + " ms", "Retry with a longer timeoutMs", true);
  }

  async function trySnapshot(tabId, args, timeoutMs) {
    try {
      return await rpc(tabId, "snapshot", args || {}, typeof timeoutMs === "number" ? timeoutMs : 15000);
    } catch (error) {
      return null;
    }
  }

  async function paperclipOrigins() {
    var stored = (await LB.bg.bridge.readPairing()) || {};
    var origins = new Set();
    var paired = core.originOf(stored.origin);
    if (paired) origins.add(paired);
    return origins;
  }

  async function isPaperclipTab(tab) {
    var origins = await paperclipOrigins();
    var current = core.originOf(tab.url);
    return Boolean(current && origins.has(current));
  }

  async function assertNavigationAllowed(tab) {
    var guards = LB.guards.current();
    if (guards.protectPaperclipTab !== false && (await isPaperclipTab(tab))) {
      throw new ToolFailure(ERROR.navigationBlocked, "This tab belongs to Paperclip itself, so it is never navigated", GUARD_HINT);
    }
    if (agentTabs.has(tab.id)) return;
    if (guards.protectFocusedTab === false) return;
    var focused = await focusedTab();
    if (focused && focused.id === tab.id) {
      throw new ToolFailure(ERROR.navigationBlocked, "This is the tab the user is looking at, so it is left alone", GUARD_HINT);
    }
  }

  async function ownAgentTab(incognito) {
    var ids = Array.from(agentTabs);
    for (var index = 0; index < ids.length; index += 1) {
      var tab = await chrome.tabs.get(ids[index]).catch(function () {
        return null;
      });
      if (!tab) {
        agentTabs.delete(ids[index]);
        continue;
      }
      if ((tab.incognito === true) !== incognito) continue;
      if (await isPaperclipTab(tab)) continue;
      return tab;
    }
    return null;
  }

  function adopt(tab) {
    if (tab && typeof tab.id === "number") agentTabs.add(tab.id);
    return tab;
  }

  function wantsIncognito(args) {
    if (args.cookieStoreId === undefined || args.cookieStoreId === null) return args.incognito === true;
    var store = String(args.cookieStoreId);
    if (store === INCOGNITO_STORE) {
      if (args.incognito === false) {
        throw new ToolFailure(ERROR.protocolError, "Cookie store 1 is the incognito store, so incognito cannot be false", "Drop incognito or pick store 0");
      }
      return true;
    }
    if (store === REGULAR_STORE) {
      if (args.incognito === true) {
        throw new ToolFailure(ERROR.protocolError, "Cookie store 0 is the regular store, so incognito cannot be true", "Drop cookieStoreId or pick store 1");
      }
      return false;
    }
    throw new ToolFailure(
      ERROR.unsupported,
      "Chromium has no cookie store " + store + "; it only has the regular store 0 and the incognito store 1",
      "Pass incognito:true for the private jar, or omit cookieStoreId"
    );
  }

  async function assertIncognitoAllowed() {
    var allowed = false;
    try {
      allowed = Boolean(await chrome.extension.isAllowedIncognitoAccess());
    } catch (error) {
      allowed = false;
    }
    if (!allowed) {
      throw new ToolFailure(ERROR.unsupported, "This extension is not allowed in incognito windows, so no private tab was opened", INCOGNITO_HINT);
    }
  }

  async function windowTab(created) {
    if (created && Array.isArray(created.tabs) && created.tabs[0]) return created.tabs[0];
    var tabs = await chrome.tabs.query({ windowId: created.id });
    if (tabs && tabs[0]) return tabs[0];
    throw new ToolFailure(ERROR.tabMissing, "The new window opened without a tab", "Retry local_browser_open");
  }

  async function openWindow(url, incognito, active, outcome) {
    var props = { incognito: incognito, focused: active === true };
    if (url) props.url = url;
    var tab = adopt(await windowTab(await chrome.windows.create(props)));
    outcome.note = incognito
      ? "No private window was open, so a new private window was created for this tab"
      : "No regular window was open, so a new window was created for this tab";
    return tab;
  }

  async function hostWindowId(incognito) {
    if (!chrome.windows || typeof chrome.windows.getAll !== "function") return null;
    var windows = await chrome.windows.getAll({ windowTypes: ["normal"] }).catch(function () {
      return [];
    });
    var matching = (windows || []).filter(function (candidate) {
      return candidate && typeof candidate.id === "number" && (candidate.incognito === true) === incognito;
    });
    if (matching.length === 0) return null;
    var focused = matching.find(function (candidate) {
      return candidate.focused === true;
    });
    if (focused) return focused.id;
    if (typeof chrome.windows.getLastFocused === "function") {
      var last = await chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(function () {
        return null;
      });
      var known = last && matching.find(function (candidate) {
        return candidate.id === last.id;
      });
      if (known) return known.id;
    }
    return matching[0].id;
  }

  async function createInHostWindow(args, incognito, outcome) {
    var windowId = await hostWindowId(incognito);
    if (windowId === null) return await openWindow(args.url, incognito, args.active, outcome);
    var props = { active: args.active === true, windowId: windowId };
    if (args.url) props.url = args.url;
    return adopt(await chrome.tabs.create(props));
  }

  async function openTab(args, outcome) {
    var incognito = wantsIncognito(args);
    if (incognito) await assertIncognitoAllowed();
    if (args.url && typeof args.tabId === "number") {
      var target = await resolveTab(args);
      if ((target.incognito === true) !== incognito && (args.incognito !== undefined || args.cookieStoreId !== undefined)) {
        throw new ToolFailure(ERROR.protocolError, "Tab " + target.id + " is in the other cookie jar", "Omit tabId to open a fresh tab in the jar you asked for");
      }
      await assertNavigationAllowed(target);
      return adopt(await chrome.tabs.update(target.id, { url: args.url }));
    }
    if (args.url) {
      var reusable = await ownAgentTab(incognito);
      if (reusable) return await chrome.tabs.update(reusable.id, { url: args.url });
      return await createInHostWindow(args, incognito, outcome);
    }
    if (incognito) {
      var existing = await ownAgentTab(true);
      if (existing) return existing;
      return await createInHostWindow(args, true, outcome);
    }
    var tab = await resolveTab(args);
    if (args.active === true) await chrome.tabs.update(tab.id, { active: true });
    return tab;
  }

  function forget(tabId) {
    agentTabs.delete(tabId);
  }

  LB.bg = LB.bg || {};
  LB.bg.tabs = {
    REGULAR_STORE: REGULAR_STORE,
    INCOGNITO_STORE: INCOGNITO_STORE,
    agentTabs: agentTabs,
    cookieStores: cookieStores,
    storeIdOf: storeIdOf,
    tabInfo: tabInfo,
    describe: describe,
    listTabs: listTabs,
    focusedTab: focusedTab,
    resolveTab: resolveTab,
    sendToTab: sendToTab,
    injectContentScript: injectContentScript,
    rpc: rpc,
    scriptable: scriptable,
    documentProbe: documentProbe,
    documentOf: documentOf,
    waitForTab: waitForTab,
    trySnapshot: trySnapshot,
    isPaperclipTab: isPaperclipTab,
    assertNavigationAllowed: assertNavigationAllowed,
    ownAgentTab: ownAgentTab,
    openTab: openTab,
    forget: forget
  };
})(globalThis);
