(function (root) {
  "use strict";

  var LB = root.LB;
  var protocol = LB.protocol;
  var tabsApi = LB.tabs;
  var D = protocol.DEFAULTS;
  var C = protocol.ERROR_CODES;

  function clampInt(value, fallback, min, max) {
    return LB.text.clampInt(value, fallback, min, max);
  }

  var budgetFor = LB.budget.budgetFor;

  async function targetTab(args) {
    return tabsApi.resolveTab(args || {});
  }

  function tierAllowed(tool, ctx) {
    if (!protocol.requiresFullTier(tool)) return;
    if (ctx.tier === "full") return;
    throw protocol.error(C.tierDenied, tool + " needs the full tier", "Ask the operator to switch this browser to full tier", false);
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

  async function assertNavigationAllowed(tab) {
    var stored = null;
    try {
      stored = await browser.storage.local.get(protocol.STORAGE_PAIRING);
    } catch (error) {
      stored = null;
    }
    var pairing = stored && stored[protocol.STORAGE_PAIRING] ? stored[protocol.STORAGE_PAIRING] : null;
    var paperclipOrigin = pairing && pairing.origin ? protocol.originOf(pairing.origin) : null;
    var current = tab && tab.url ? protocol.originOf(tab.url) : null;
    if (paperclipOrigin && current && paperclipOrigin === current) {
      throw protocol.error(
        C.navigationBlocked,
        "This tab belongs to Paperclip itself, so it is never navigated",
        "Call local_browser_open with a url; that always uses a fresh tab",
        false
      );
    }
    if (agentTabs[String(tab.tabId)]) return;
    var focused = await tabsApi.activeTab();
    if (focused && focused.tabId === tab.tabId) {
      throw protocol.error(
        C.navigationBlocked,
        "This is the tab the user is looking at, so it is left alone",
        "Call local_browser_open with a url; that always uses a fresh tab",
        false
      );
    }
  }

  async function ownAgentTab() {
    var ids = Object.keys(agentTabs);
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
      var stored = null;
      try {
        stored = await browser.storage.local.get(protocol.STORAGE_PAIRING);
      } catch (error) {
        stored = null;
      }
      var pairing = stored && stored[protocol.STORAGE_PAIRING] ? stored[protocol.STORAGE_PAIRING] : null;
      var paperclipOrigin = pairing && pairing.origin ? protocol.originOf(pairing.origin) : null;
      var current = candidate.url ? protocol.originOf(candidate.url) : null;
      if (paperclipOrigin && current && paperclipOrigin === current) continue;
      return tabsApi.summarize(candidate);
    }
    return null;
  }

  async function newAgentTab(url, active) {
    var tab = await browser.tabs.create({ url: url, active: active });
    rememberAgentTab(tab.id);
    return tab;
  }

  async function open(args, ctx) {
    var url = typeof args.url === "string" && args.url ? args.url : null;
    var tab = null;
    if (url) {
      var origin = protocol.originOf(url);
      if (!origin) {
        throw protocol.error(C.navigationBlocked, "open needs an absolute http or https URL", "Pass a full URL, for example https://example.com", false);
      }
    }
    try {
      if (url && typeof args.tabId === "number") {
        var explicit = await targetTab(args);
        await assertNavigationAllowed(explicit);
        await browser.tabs.update(explicit.tabId, { url: url });
        rememberAgentTab(explicit.tabId);
        tab = await browser.tabs.get(explicit.tabId);
      } else if (url) {
        var reusable = await ownAgentTab();
        if (reusable) {
          await browser.tabs.update(reusable.tabId, { url: url });
          tab = await browser.tabs.get(reusable.tabId);
        } else {
          tab = await newAgentTab(url, args.active === true);
        }
      } else if (args.newTab === true) {
        tab = await browser.tabs.create({ url: "about:blank", active: args.active === true });
      } else {
        var current = await targetTab(args);
        tab = await browser.tabs.get(current.tabId);
      }
    } catch (error) {
      throw protocol.error(C.navigationBlocked, "Firefox refused to open the tab: " + (error && error.message ? error.message : "unknown reason"), "Check the URL and retry", true);
    }
    if (args.active === true) await tabsApi.activate(tabsApi.summarize(tab));
    if (url) await tabsApi.waitForLoad(tab.id, D.navigateTimeoutMs);
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
    var timeoutMs = clampInt(args.timeoutMs, D.navigateTimeoutMs, 100, 120000);
    await tabsApi.waitForLoad(tab.tabId, timeoutMs);
    if (args.waitUntil === "networkidle") {
      try {
        await tabsApi.send(tab.tabId, "wait", { idle: true, timeoutMs: Math.min(timeoutMs, 8000) });
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
      timeoutMs: args.timeoutMs
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
      return { dataUrl: cropped.dataUrl, width: cropped.width, height: cropped.height, tabId: tab.tabId, fullPage: false };
    }

    if (args.fullPage === true) return fullPageShot(tab, viewport);

    var shot = await captureWithoutFocus(tab);
    return {
      dataUrl: shot.dataUrl,
      width: Math.round(viewport.width * viewport.dpr),
      height: Math.round(viewport.height * viewport.dpr),
      tabId: tab.tabId,
      fullPage: false
    };
  }

  async function fullPageShot(tab, viewport) {
    var total = Math.min(viewport.docHeight, viewport.height * 8);
    var frames = [];
    var y = 0;
    while (y < total) {
      await tabsApi.send(tab.tabId, "scrollTo", { x: viewport.scrollX, y: y });
      await tabsApi.sleep(140);
      var shot = await captureWithoutFocus(tab);
      frames.push({ dataUrl: shot.dataUrl, y: y });
      if (total <= viewport.height) break;
      y += viewport.height;
    }
    await tabsApi.send(tab.tabId, "scrollTo", { x: viewport.scrollX, y: viewport.scrollY });
    var composed = await tabsApi.send(tab.tabId, "stitch", {
      frames: frames,
      width: viewport.width,
      height: Math.max(total, viewport.height),
      dpr: viewport.dpr
    });
    return { dataUrl: composed.dataUrl, width: composed.width, height: composed.height, tabId: tab.tabId, fullPage: true };
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

  function cookieRecord(cookie) {
    var record = {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure === true,
      httpOnly: cookie.httpOnly === true,
      session: cookie.session === true,
      sameSite: cookie.sameSite || "no_restriction"
    };
    if (typeof cookie.expirationDate === "number") record.expirationDate = cookie.expirationDate;
    return record;
  }

  async function cookies(args, tab) {
    var url = typeof args.url === "string" && args.url ? args.url : tab.url;
    if (!protocol.originOf(url)) {
      throw protocol.error(C.protocolError, "Cookies need an http(s) url", "Pass url, or use a tab on a website", false);
    }
    if (args.op === "get") {
      var query = { url: url };
      if (args.name) query.name = args.name;
      var found = await browser.cookies.getAll(query);
      return { kind: "cookies", op: "get", url: url, cookies: found.map(cookieRecord) };
    }
    if (args.op === "set") {
      var writes = Array.isArray(args.entries) ? args.entries : [];
      if (!writes.length) {
        throw protocol.error(C.protocolError, "set needs entries", "Pass name and value pairs", false);
      }
      for (var i = 0; i < writes.length; i += 1) {
        await browser.cookies.set({ url: url, name: writes[i].name, value: writes[i].value });
      }
      return { kind: "cookies", op: "set", url: url, count: writes.length };
    }
    if (args.op === "clear") {
      var all = await browser.cookies.getAll({ url: url });
      var targets = args.name ? all.filter(function (cookie) { return cookie.name === args.name; }) : all;
      for (var j = 0; j < targets.length; j += 1) {
        await browser.cookies.remove({ url: url, name: targets[j].name });
      }
      return { kind: "cookies", op: "clear", url: url, count: targets.length };
    }
    throw protocol.error(C.protocolError, "Unknown storage op " + String(args.op), "Use get, set or clear", false);
  }

  async function storage(args, ctx) {
    var tab = await targetTab(args);
    if (args.kind === "cookies") return cookies(args, tab);
    return tabsApi.send(tab.tabId, "storage", { kind: args.kind, op: args.op, name: args.name, entries: args.entries });
  }

  async function network(args, ctx) {
    var tab = await targetTab(args);
    if (args.op === "clear") {
      LB.network.clear(tab.tabId);
      return { requests: [], total: 0, cleared: true };
    }
    return LB.network.list(tab.tabId, {
      limit: clampInt(args.limit, D.networkLimit, 1, D.networkMaxLimit),
      includeBodies: args.includeBodies === true,
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
    var tab = await targetTab(args);
    if (args.op === "save") {
      if (typeof args.downloadId !== "number") {
        throw protocol.error(C.protocolError, "save needs downloadId", "Call op list first", false);
      }
      return LB.downloads.save(args.downloadId);
    }
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
    return { ok: true, closed: "tab", tabId: tab.tabId };
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
    local_browser_close: close
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

  async function dispatch(tool, args, ctx) {
    if (tool === "local_browser_viewer") return viewer(args, ctx);
    if (tool === "local_browser_input") return input(args, ctx);
    var handler = HANDLERS[tool];
    if (!handler) {
      throw protocol.error(C.unsupported, "Unknown tool " + String(tool), "Reload the extension so it matches the server", false);
    }
    tierAllowed(tool, ctx);
    return handler(args || {}, ctx);
  }

  root.LB = root.LB || {};
  root.LB.tools = { dispatch: dispatch, budgetFor: budgetFor, HANDLERS: HANDLERS };
})(globalThis);
