(function (root) {
  "use strict";

  var LB = root.LB;
  var protocol = LB.protocol;
  var tabsApi = LB.tabs;
  var D = protocol.DEFAULTS;
  var C = protocol.ERROR_CODES;
  var PAGE = ["<all_urls>", "scripting"];
  var STITCH_RESERVE_MS = 1500;
  var PERMISSION_NOTE = "Ask the user to open the Paperclip Local Browser extension and press Allow.";
  var STATUS_NOTE =
    "Only the user can grant browser permissions. Call op request with the missing ids to queue them, then ask the user to press Allow in the extension.";

  var REQUIREMENTS = {
    local_browser_open: PAGE,
    local_browser_navigate: PAGE,
    local_browser_snapshot: PAGE,
    local_browser_act: PAGE,
    local_browser_read: PAGE,
    local_browser_screenshot: PAGE,
    local_browser_wait: PAGE,
    local_browser_evaluate: PAGE,
    local_browser_upload: PAGE,
    local_browser_download: ["downloads"],
    local_browser_viewer: ["<all_urls>"],
    local_browser_input: ["<all_urls>"]
  };

  function requirementsFor(tool, args) {
    if (tool === "local_browser_storage") return args.kind === "cookies" ? ["cookies", "<all_urls>"] : PAGE;
    if (tool === "local_browser_network") {
      if (args.op === "clear") return [];
      return args.includeBodies === true ? ["webRequest", "webRequestBlocking", "<all_urls>"] : ["webRequest", "<all_urls>"];
    }
    if (tool === "local_browser_context") return args.cookies === false ? [] : ["cookies"];
    if (tool === "local_browser_viewer" && args.op !== "start") return [];
    return REQUIREMENTS[tool] || [];
  }

  function clampInt(value, fallback, min, max) {
    return LB.text.clampInt(value, fallback, min, max);
  }

  function budgetOf(ctx) {
    return ctx && typeof ctx.budgetMs === "number" ? ctx.budgetMs : undefined;
  }

  function deadlineOf(ctx) {
    return ctx && typeof ctx.deadline === "number" ? ctx.deadline : Infinity;
  }

  async function targetTab(args) {
    return tabsApi.resolveTab(args || {});
  }

  async function sessions(args, ctx) {
    var tabs = await tabsApi.listTabs();
    var active = null;
    for (var i = 0; i < tabs.length; i += 1) {
      if (tabs[i].active) {
        active = tabs[i];
        break;
      }
    }
    var summary = {
      sessionId: ctx.sessionId,
      connectionId: ctx.sessionId,
      client: protocol.CLIENT,
      clientVersion: ctx.clientVersion,
      label: ctx.label,
      profileName: ctx.profileName || null,
      tier: ctx.tier || "refine",
      connectedAt: ctx.connectedAt || new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      tabs: tabs,
      controlledByViewer: ctx.controlledByViewer === true
    };
    return {
      sessionId: ctx.sessionId,
      client: protocol.CLIENT,
      clientVersion: ctx.clientVersion,
      label: ctx.label,
      tier: ctx.tier || "refine",
      tabs: tabs,
      activeTabId: active ? active.tabId : null,
      sessions: [summary]
    };
  }

  var agentTabs = {};

  function rememberAgentTab(tabId) {
    agentTabs[String(tabId)] = true;
  }

  function forgetAgentTab(tabId) {
    delete agentTabs[String(tabId)];
  }

  async function paperclipOrigin() {
    var stored = null;
    try {
      stored = await browser.storage.local.get(protocol.STORAGE_PAIRING);
    } catch (error) {
      stored = null;
    }
    var pairing = stored && stored[protocol.STORAGE_PAIRING] ? stored[protocol.STORAGE_PAIRING] : null;
    return pairing && pairing.origin ? protocol.originOf(pairing.origin) : null;
  }

  async function assertNavigationAllowed(tab) {
    var guards = LB.guards.current();
    if (guards.protectPaperclipTab !== false) {
      var own = await paperclipOrigin();
      var current = tab && tab.url ? protocol.originOf(tab.url) : null;
      if (own && current && own === current) {
        throw protocol.error(
          C.navigationBlocked,
          "This tab belongs to Paperclip itself, so it is never navigated",
          "Call local_browser_open with a url; that always uses a fresh tab. The user can turn this guard off in the extension's Agent guards.",
          false
        );
      }
    }
    if (agentTabs[String(tab.tabId)]) return;
    if (guards.protectFocusedTab === false) return;
    var focused = await tabsApi.activeTab();
    if (focused && focused.tabId === tab.tabId) {
      throw protocol.error(
        C.navigationBlocked,
        "This is the tab the user is looking at, so it is left alone",
        "Call local_browser_open with a url; that always uses a fresh tab. The user can turn this guard off in the extension's Agent guards.",
        false
      );
    }
  }

  async function ownAgentTab(store) {
    var ids = Object.keys(agentTabs);
    var own = null;
    var ownLoaded = false;
    for (var i = 0; i < ids.length; i += 1) {
      var candidate = null;
      try {
        candidate = await browser.tabs.get(Number(ids[i]));
      } catch (error) {
        forgetAgentTab(ids[i]);
        continue;
      }
      if (!candidate) {
        forgetAgentTab(ids[i]);
        continue;
      }
      if (store && (candidate.cookieStoreId || tabsApi.DEFAULT_STORE) !== store) continue;
      if (!store && candidate.incognito === true) continue;
      if (!ownLoaded) {
        own = await paperclipOrigin();
        ownLoaded = true;
      }
      var current = candidate.url ? protocol.originOf(candidate.url) : null;
      if (own && current && own === current) continue;
      return tabsApi.summarize(candidate);
    }
    return null;
  }

  async function privateWindow() {
    var windows = [];
    try {
      windows = await browser.windows.getAll({ windowTypes: ["normal"] });
    } catch (error) {
      windows = [];
    }
    for (var i = 0; i < windows.length; i += 1) {
      if (windows[i] && windows[i].incognito === true) return windows[i];
    }
    return null;
  }

  async function assertPrivateAllowed() {
    var allowed = false;
    try {
      allowed = await browser.extension.isAllowedIncognitoAccess();
    } catch (error) {
      allowed = false;
    }
    if (allowed) return;
    throw protocol.error(
      C.unsupported,
      "This extension is not allowed in private windows, so it cannot open one",
      "Ask the user to open about:addons, choose Paperclip Local Browser Bridge and set Run in Private Windows to Allow",
      false
    );
  }

  async function placementOf(args) {
    var store = typeof args.cookieStoreId === "string" && args.cookieStoreId ? args.cookieStoreId : null;
    var incognito = args.incognito === true || store === tabsApi.PRIVATE_STORE;
    if (incognito && store && store !== tabsApi.PRIVATE_STORE) {
      throw protocol.error(C.protocolError, "A private window always uses the firefox-private cookie store", "Pass incognito alone, or a container cookieStoreId without incognito", false);
    }
    if (store && !incognito && !(await tabsApi.containerExists(store))) {
      throw protocol.error(
        C.protocolError,
        "No cookie store " + store + " exists in this Firefox",
        "Call local_browser_context for a tab's cookieStoreId, or local_browser_api with contextualIdentities.query for the containers",
        false
      );
    }
    if (incognito) await assertPrivateAllowed();
    return {
      store: incognito ? tabsApi.PRIVATE_STORE : store,
      incognito: incognito,
      newWindow: args.newWindow === true,
      special: Boolean(store) || incognito || args.newWindow === true
    };
  }

  async function openWindow(url, placement, active) {
    var props = { url: url || "about:blank", focused: active === true };
    if (placement.incognito) props.incognito = true;
    else if (placement.store) props.cookieStoreId = placement.store;
    var created = await browser.windows.create(props);
    var tab = created && Array.isArray(created.tabs) && created.tabs[0] ? created.tabs[0] : null;
    if (!tab && created && typeof created.id === "number") {
      var inWindow = await browser.tabs.query({ windowId: created.id });
      tab = inWindow[0] || null;
    }
    if (!tab) throw new Error("the new window has no tab");
    return tab;
  }

  async function openTab(url, placement, active) {
    var props = { url: url || "about:blank", active: active === true };
    if (placement.incognito) {
      var win = await privateWindow();
      if (!win) return openWindow(url, placement, active);
      props.windowId = win.id;
    } else if (placement.store) {
      props.cookieStoreId = placement.store;
    }
    return browser.tabs.create(props);
  }

  async function open(args, ctx) {
    var url = typeof args.url === "string" && args.url ? args.url : null;
    if (url && !protocol.originOf(url)) {
      throw protocol.error(C.navigationBlocked, "open needs an absolute http or https URL", "Pass a full URL, for example https://example.com", false);
    }
    var placement = await placementOf(args);
    if (placement.special && typeof args.tabId === "number") {
      throw protocol.error(
        C.protocolError,
        "An existing tab cannot move to another cookie store or window",
        "Omit tabId to open a fresh tab with cookieStoreId, incognito or newWindow",
        false
      );
    }
    var tab = null;
    try {
      if (placement.newWindow) {
        tab = await openWindow(url, placement, args.active);
        rememberAgentTab(tab.id);
      } else if (url && typeof args.tabId === "number") {
        var explicit = await targetTab(args);
        await assertNavigationAllowed(explicit);
        await browser.tabs.update(explicit.tabId, { url: url });
        rememberAgentTab(explicit.tabId);
        tab = await browser.tabs.get(explicit.tabId);
      } else if (url) {
        var reusable = await ownAgentTab(placement.store);
        if (reusable) {
          await browser.tabs.update(reusable.tabId, { url: url });
          tab = await browser.tabs.get(reusable.tabId);
        } else {
          tab = await openTab(url, placement, args.active);
          rememberAgentTab(tab.id);
        }
      } else if (args.newTab === true || placement.special) {
        tab = await openTab(null, placement, args.active);
        rememberAgentTab(tab.id);
      } else {
        var current = await targetTab(args);
        tab = await browser.tabs.get(current.tabId);
      }
    } catch (error) {
      if (error && typeof error.code === "string" && typeof error.message === "string") throw error;
      throw protocol.error(C.navigationBlocked, "Firefox refused to open the tab: " + (error && error.message ? error.message : "unknown reason"), "Check the URL and retry", true);
    }
    if (args.active === true) await tabsApi.activate(tabsApi.summarize(tab));
    if (url) await tabsApi.waitForLoad(tab.id, LB.budget.innerTimeout(undefined, D.navigateTimeoutMs, budgetOf(ctx)));
    var summary = tabsApi.summarize(await browser.tabs.get(tab.id));
    var snapshot = null;
    try {
      snapshot = await tabsApi.send(summary.tabId, "snapshot", { maxNodes: D.snapshotNodes });
    } catch (error) {
      snapshot = null;
    }
    return { tab: summary, snapshot: snapshot };
  }

  async function navigate(args, ctx) {
    var tab = await targetTab(args);
    await assertNavigationAllowed(tab);
    var acted = false;
    try {
      if (typeof args.url === "string" && args.url) {
        if (!protocol.originOf(args.url)) {
          throw protocol.error(C.navigationBlocked, "navigate needs an absolute http or https URL", "Pass a full URL, or use back, forward or reload", false);
        }
        await browser.tabs.update(tab.tabId, { url: args.url });
        acted = true;
      } else if (args.back === true) {
        await browser.tabs.goBack(tab.tabId);
        acted = true;
      } else if (args.forward === true) {
        await browser.tabs.goForward(tab.tabId);
        acted = true;
      } else if (args.reload === true) {
        await browser.tabs.reload(tab.tabId);
        acted = true;
      }
    } catch (error) {
      if (error && error.code) throw error;
      throw protocol.error(C.navigationBlocked, "Firefox refused the navigation: " + (error && error.message ? error.message : "unknown reason"), "Check the URL and retry", true);
    }
    if (!acted) {
      throw protocol.error(C.protocolError, "navigate needs url, back, forward or reload", "Pass one of them", false);
    }
    var timeoutMs = LB.budget.innerTimeout(args.timeoutMs, D.navigateTimeoutMs, budgetOf(ctx));
    var started = Date.now();
    await tabsApi.waitForLoad(tab.tabId, timeoutMs);
    if (args.waitUntil === "networkidle") {
      try {
        await tabsApi.send(tab.tabId, "wait", { idle: true, timeoutMs: Math.max(100, timeoutMs - (Date.now() - started)) });
      } catch (error) {
        void error;
      }
    }
    return { tab: tabsApi.summarize(await browser.tabs.get(tab.tabId)) };
  }

  async function snapshot(args, ctx) {
    var tab = await targetTab(args);
    return tabsApi.send(tab.tabId, "snapshot", {
      selector: args.selector,
      maxNodes: args.maxNodes,
      includeText: args.includeText,
      includeHidden: args.includeHidden,
      cursor: args.cursor
    });
  }

  async function act(args, ctx) {
    var tab = await targetTab(args);
    return tabsApi.send(tab.tabId, "act", args);
  }

  async function read(args, ctx) {
    var tab = await targetTab(args);
    return tabsApi.send(tab.tabId, "read", {
      selector: args.selector,
      format: args.format,
      maxChars: args.maxChars
    });
  }

  async function wait(args, ctx) {
    var tab = await targetTab(args);
    return tabsApi.send(tab.tabId, "wait", {
      selector: args.selector,
      text: args.text,
      urlIncludes: args.urlIncludes,
      idle: args.idle,
      timeoutMs: LB.budget.innerTimeout(args.timeoutMs, D.waitTimeoutMs, budgetOf(ctx))
    });
  }

  async function captureWithoutFocus(tab) {
    if (tab.active === true) {
      return await tabsApi.captureVisible(tab.windowId);
    }
    var background = await LB.bidi.captureScreenshot(tab);
    if (background) return { dataUrl: background };
    throw protocol.error(
      C.unsupported,
      "This tab cannot be captured without bringing it to the front",
      "Ask the user to switch to that tab, or use local_browser_read instead",
      false
    );
  }

  async function documentOf(tabId) {
    try {
      return await tabsApi.send(tabId, "documentState", {});
    } catch (error) {
      return null;
    }
  }

  async function withDocument(tabId, result) {
    var state = await documentOf(tabId);
    if (state) result.document = state;
    return result;
  }

  async function screenshot(args, ctx) {
    var tab = await targetTab(args);
    var viewport = await tabsApi.send(tab.tabId, "viewport", {});

    if (typeof args.selector === "string" && args.selector) {
      var box = await tabsApi.send(tab.tabId, "box", { selector: args.selector });
      if (!(box.width > 0) || !(box.height > 0)) {
        throw protocol.error(C.elementMissing, "The element has no visible box", "Scroll it into view, then retry", true);
      }
      var frame = await captureWithoutFocus(tab);
      var cropped = await tabsApi.send(tab.tabId, "crop", {
        dataUrl: frame.dataUrl,
        x: Math.max(0, box.x),
        y: Math.max(0, box.y),
        width: box.width,
        height: box.height,
        dpr: box.dpr
      });
      return withDocument(tab.tabId, { dataUrl: cropped.dataUrl, width: cropped.width, height: cropped.height, tabId: tab.tabId, fullPage: false });
    }

    if (args.fullPage === true) return withDocument(tab.tabId, await fullPageShot(tab, viewport, ctx));

    var shot = await captureWithoutFocus(tab);
    return withDocument(tab.tabId, {
      dataUrl: shot.dataUrl,
      width: Math.round(viewport.width * viewport.dpr),
      height: Math.round(viewport.height * viewport.dpr),
      tabId: tab.tabId,
      fullPage: false
    });
  }

  async function fullPageShot(tab, viewport, ctx) {
    var dpr = viewport.dpr > 0 ? viewport.dpr : 1;
    var pageHeight = Math.max(viewport.docHeight || 0, viewport.height);
    var canvasHeight = Math.floor(D.canvasMaxPixels / dpr);
    var total = Math.min(pageHeight, canvasHeight);
    var deadline = deadlineOf(ctx) - STITCH_RESERVE_MS;
    var frames = [];
    var y = 0;
    var covered = 0;
    var outOfTime = false;
    while (covered < total) {
      if (frames.length && Date.now() > deadline) {
        outOfTime = true;
        break;
      }
      var at = await tabsApi.send(tab.tabId, "scrollTo", { x: viewport.scrollX, y: y });
      var actualY = at && typeof at.scrollY === "number" ? at.scrollY : y;
      await tabsApi.sleep(140);
      var shot = await captureWithoutFocus(tab);
      frames.push({ dataUrl: shot.dataUrl, y: actualY });
      covered = Math.max(covered, actualY + viewport.height);
      if (actualY < y) break;
      y = actualY + viewport.height;
    }
    await tabsApi.send(tab.tabId, "scrollTo", { x: viewport.scrollX, y: viewport.scrollY });
    var height = Math.max(viewport.height, Math.min(total, covered));
    var composed = await tabsApi.send(tab.tabId, "stitch", {
      frames: frames,
      width: viewport.width,
      height: height,
      dpr: dpr
    });
    var result = { dataUrl: composed.dataUrl, width: composed.width, height: composed.height, tabId: tab.tabId, fullPage: true };
    if (height < pageHeight) {
      result.truncated = true;
      result.capturedHeight = height;
      result.pageHeight = pageHeight;
      result.note = outOfTime
        ? "The call budget ran out before the bottom of the page; scroll and capture the rest, or raise the call limit"
        : "The page is taller than one browser canvas can hold; scroll and capture the rest";
    }
    return result;
  }

  function pageEvaluator(payload) {
    var AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    function serialize(value) {
      var type = typeof value;
      try {
        var json = JSON.stringify(value);
        if (json === undefined) return { value: null, type: type, note: "undefined" };
        return { value: JSON.parse(json), type: type };
      } catch (error) {
        return { value: null, type: type, note: "not serializable" };
      }
    }
    return new Promise(function (resolve) {
      var runner;
      try {
        runner = new AsyncFunction("return await (" + payload.expression + ");");
      } catch (error) {
        resolve({ value: null, type: "error", note: String((error && error.message) || error) });
        return;
      }
      var pending;
      try {
        pending = runner();
      } catch (error) {
        resolve({ value: null, type: "error", note: String((error && error.message) || error) });
        return;
      }
      Promise.resolve(pending).then(
        function (value) {
          resolve(serialize(value));
        },
        function (error) {
          resolve({ value: null, type: "error", note: String((error && error.message) || error) });
        }
      );
    });
  }

  async function evaluateLegacy(tab, args, world, cause) {
    var request = JSON.stringify({ expression: args.expression, world: world });
    var code = [
      "(function () {",
      "  var request = " + request + ";",
      "  var scope = request.world === 'MAIN' && window.wrappedJSObject ? window.wrappedJSObject : window;",
      "  return Promise.resolve().then(function () {",
      "    return scope.eval('(' + request.expression + ')');",
      "  }).then(function (value) {",
      "    try { return { value: JSON.parse(JSON.stringify(value === undefined ? null : value)), type: typeof value }; }",
      "    catch (error) { return { value: null, type: typeof value, note: 'not serializable' }; }",
      "  }, function (error) {",
      "    return { value: null, type: 'error', note: String((error && error.message) || error) };",
      "  });",
      "})()"
    ].join("\n");
    try {
      var results = await browser.tabs.executeScript(tab.tabId, { code: code, runAt: "document_idle" });
      return results && results[0] ? results[0] : { value: null, type: "undefined" };
    } catch (error) {
      throw protocol.error(
        C.unsupported,
        "This page does not accept injected JavaScript: " + (cause && cause.message ? cause.message : "blocked"),
        "Try a normal http or https tab, or use local_browser_read instead",
        false
      );
    }
  }

  async function evaluate(args, ctx) {
    var tab = await targetTab(args);
    var world = args.world === "isolated" ? "ISOLATED" : "MAIN";
    var failure = null;
    try {
      var results = await browser.scripting.executeScript({
        target: { tabId: tab.tabId },
        world: world,
        func: pageEvaluator,
        args: [{ expression: args.expression }]
      });
      var first = results && results[0];
      if (!first) throw new Error("The page returned no result");
      if (first.error) throw new Error((first.error && first.error.message) || "The page threw while evaluating");
      if (first.result === undefined) return { value: null, type: "undefined" };
      return first.result;
    } catch (error) {
      failure = error;
    }
    return evaluateLegacy(tab, args, world, failure);
  }

  async function storage(args, ctx) {
    var jarScope = args.kind === "cookies" && (args.allDomains === true || typeof args.domain === "string" || typeof args.url === "string");
    var tab = await targetTab(args).catch(function (error) {
      if (!jarScope) throw error;
      return { tabId: null, url: "" };
    });
    if (args.kind === "cookies") return LB.cookies.run(args, tab);
    return tabsApi.send(tab.tabId, "storage", { kind: args.kind, op: args.op, name: args.name, entries: args.entries });
  }

  async function network(args, ctx) {
    var tab = await targetTab(args);
    await LB.network.sync();
    if (args.op === "clear") {
      LB.network.clear(tab.tabId);
      return { requests: [], total: 0, cleared: true, capture: { mode: "continuous", since: Date.now() } };
    }
    return LB.network.list(tab.tabId, {
      limit: args.limit,
      includeBodies: args.includeBodies === true,
      includeHeaders: args.includeHeaders !== false,
      since: args.since,
      types: args.types,
      urlIncludes: args.urlIncludes,
      method: args.method
    });
  }

  async function upload(args, ctx) {
    var tab = await targetTab(args);
    var files = Array.isArray(args.files) ? args.files : [];
    if (!files.length) {
      throw protocol.error(C.unsupported, "No file bytes arrived with the call", "Attach the file to the task and retry", false);
    }
    var result = await tabsApi.send(tab.tabId, "upload", {
      ref: args.ref,
      selector: args.selector,
      files: files
    });
    return { ok: result.ok === true, count: result.count, selector: args.selector || null, tabId: tab.tabId };
  }

  async function download(args, ctx) {
    if (args.op === "save") {
      if (typeof args.downloadId !== "number") {
        throw protocol.error(C.protocolError, "save needs downloadId", "Call op list first", false);
      }
      return LB.downloads.save(args.downloadId);
    }
    var tab = await targetTab(args).catch(function () {
      return { tabId: null, url: "" };
    });
    return LB.downloads.list(tab);
  }

  async function close(args, ctx) {
    if (args.closeSession === true) {
      setTimeout(function () {
        LB.bridge.stop({ keepPairing: true, reason: "closed by the agent" });
      }, 80);
      return { ok: true, closed: "session" };
    }
    var tab = await targetTab(args);
    await browser.tabs.remove(tab.tabId);
    forgetAgentTab(tab.tabId);
    return { ok: true, closed: "tab", tabId: tab.tabId };
  }

  async function context(args, ctx) {
    var tab = await targetTab(args);
    var raw = await browser.tabs.get(tab.tabId);
    var store = typeof raw.cookieStoreId === "string" && raw.cookieStoreId ? raw.cookieStoreId : tabsApi.DEFAULT_STORE;
    var summary = tabsApi.summarize(raw);
    var cookies = args.cookies === false ? { storeId: store, url: summary.url, count: 0, items: [] } : await LB.cookies.forTab(summary, store);
    var contentScript = await tabsApi.probeAgent(summary);
    var state = contentScript === "connected" ? await documentOf(summary.tabId) : null;
    return {
      tab: summary,
      container: await tabsApi.container(store),
      cookies: cookies,
      document: state,
      contentScript: contentScript,
      network: LB.network.tabInfo(summary.tabId),
      access: await LB.access.snapshot()
    };
  }

  async function permissions(args, ctx) {
    var snapshot = await LB.access.snapshot();
    if (args.op === "status") return Object.assign({}, snapshot, { note: STATUS_NOTE });
    if (args.op !== "request") {
      throw protocol.error(C.protocolError, "permissions op must be status or request", "Pass op status or request", false);
    }
    var ids = Array.isArray(args.permissions) ? args.permissions : [];
    if (!ids.length) {
      throw protocol.error(C.protocolError, "request needs permissions", "Call op status to see what is missing", false);
    }
    var outcome = await LB.access.queue(ids, { tool: "local_browser_permissions", reason: args.reason });
    var after = await LB.access.snapshot();
    var note = outcome.queued.length ? PERMISSION_NOTE : "Nothing new to ask: every requested permission is already granted or not available.";
    var refused = (outcome.unknown || []).concat(outcome.unsupported || []);
    if (refused.length) note += " Not available in Firefox: " + refused.join(", ") + ".";
    return Object.assign({}, after, { requested: outcome.queued, alreadyGranted: outcome.alreadyGranted, note: note });
  }

  async function api(args, ctx) {
    return LB.apiCall.invoke(LB.ext.api, args.path, args.args);
  }

  async function ui(args, ctx) {
    var section = args.op === "open_permissions" ? "permissions" : args.op === "open_control_center" ? "overview" : null;
    if (!section) {
      throw protocol.error(C.protocolError, "ui op must be open_permissions or open_control_center", "Pass one of them", false);
    }
    var tab = await LB.ext.openControlCenter(section);
    return { ok: true, opened: section, tabId: tab && typeof tab.id === "number" ? tab.id : null };
  }

  var HANDLERS = {
    local_browser_sessions: sessions,
    local_browser_open: open,
    local_browser_navigate: navigate,
    local_browser_snapshot: snapshot,
    local_browser_act: act,
    local_browser_read: read,
    local_browser_screenshot: screenshot,
    local_browser_wait: wait,
    local_browser_evaluate: evaluate,
    local_browser_storage: storage,
    local_browser_network: network,
    local_browser_upload: upload,
    local_browser_download: download,
    local_browser_close: close,
    local_browser_context: context,
    local_browser_permissions: permissions,
    local_browser_api: api
  };

  async function viewer(args, ctx) {
    var op = args.op;
    if (op === "start") {
      var interval = clampInt(args.intervalMs, D.viewerIntervalMs, D.viewerMinIntervalMs, 10000);
      var tab = await targetTab(args);
      LB.bridge.startViewer(tab, interval);
      return { ok: true, started: true, intervalMs: interval, tabId: tab.tabId };
    }
    if (op === "stop") {
      LB.bridge.stopViewer();
      return { ok: true, started: false };
    }
    throw protocol.error(C.protocolError, "viewer op must be start or stop", "Pass op start or stop", false);
  }

  var lastInputMode = null;

  async function resetInputState(tab) {
    LB.bidi.resetInput();
    try {
      await tabsApi.send(tab.tabId, "inputReset", {});
    } catch (error) {
      void error;
    }
  }

  async function input(args, ctx) {
    var tab = await targetTab(args);
    var trusted = await LB.bidi.sendInput(tab, args);
    if (trusted.rejected) {
      throw protocol.error(
        C.protocolError,
        trusted.error || "The viewer input did not match the frozen schema",
        "Use kind mouse with action move, down or up; kind key with action down or up; or kind wheel",
        false
      );
    }
    if (trusted.available) {
      if (lastInputMode === "synthetic") await resetInputState(tab);
      lastInputMode = "trusted";
      var plan = trusted.plan;
      var trustedResult = { ok: true, mode: "trusted", synthetic: false, kind: plan.kind, action: plan.action, tabId: tab.tabId };
      if (plan.kind === "mouse") trustedResult.clicked = plan.clicked === true;
      if (plan.released && plan.released.length) trustedResult.released = plan.released;
      return trustedResult;
    }
    if (lastInputMode === "trusted") await resetInputState(tab);
    lastInputMode = "synthetic";
    var synthetic = await tabsApi.send(tab.tabId, "input", args);
    var syntheticResult = { ok: true, mode: "synthetic", synthetic: true, kind: synthetic.kind, action: synthetic.action, tabId: tab.tabId };
    if (synthetic.kind === "mouse") syntheticResult.clicked = synthetic.clicked === true;
    if (Array.isArray(synthetic.released) && synthetic.released.length) syntheticResult.released = synthetic.released;
    syntheticResult.note = trusted.error || "WebDriver BiDi is not reachable, so events are synthetic";
    return syntheticResult;
  }

  var INTERNAL = {
    local_browser_viewer: viewer,
    local_browser_input: input,
    local_browser_ui: ui
  };

  async function dispatch(tool, args, ctx) {
    var input = args && typeof args === "object" ? args : {};
    var handler = HANDLERS[tool] || INTERNAL[tool];
    if (!handler) {
      throw protocol.error(C.unsupported, "Unknown tool " + String(tool), "Reload the extension so it matches the server", false);
    }
    var needs = requirementsFor(tool, input);
    if (needs.length) {
      await LB.access.ensure(needs, { tool: tool, reason: "An agent called " + tool + " and the browser needs this permission first." });
    }
    return handler(input, ctx || {});
  }

  root.LB = root.LB || {};
  root.LB.tools = {
    dispatch: dispatch,
    requirementsFor: requirementsFor,
    HANDLERS: HANDLERS,
    INTERNAL: INTERNAL
  };
})(globalThis);
