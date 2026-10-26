(function (root) {
  "use strict";

  var LB = root.LB;
  var core = LB.bg.core;
  var ERROR = core.ERROR;
  var DEFAULTS = core.DEFAULTS;
  var ToolFailure = core.ToolFailure;
  var SITE = ["<all_urls>", "scripting"];
  var PERMISSION_NOTE = "Ask the user to open the Paperclip Local Browser extension and press Allow.";
  var TRUSTED_ACTIONS = { click: true, dblclick: true, hover: true, check: true, uncheck: true, type: true, press: true };
  var COVERED_NOTE = "Another element covers this target, so force ran page events on the target itself instead of a real click that would hit the cover";
  var REFUSED_NOTE = "Trusted input is off for this tab: Chrome refused the debugger (DevTools may be open on it), so page events ran instead";

  function tabs() {
    return LB.bg.tabs;
  }

  async function toolSessions() {
    var list = await tabs().listTabs();
    var stored = (await LB.bg.bridge.readPairing()) || {};
    var summary = {
      sessionId: stored.sessionId || null,
      client: LB.protocol.CLIENT,
      clientVersion: LB.bg.bridge.clientVersion(),
      label: stored.label || core.defaultLabel(),
      tier: stored.tier || "refine",
      tabs: list
    };
    return Object.assign({}, summary, { sessions: [summary] });
  }

  async function toolOpen(args, call) {
    var outcome = {};
    var tab = await tabs().openTab(args, outcome);
    await tabs().waitForTab(tab.id, "load", call.inner(undefined, DEFAULTS.navigateTimeoutMs));
    var fresh = await chrome.tabs.get(tab.id);
    var snapshot = await tabs().trySnapshot(tab.id, {}, call.pageTimeout(15000));
    var opened = { tab: await tabs().describe(fresh), snapshot: snapshot };
    if (outcome.note) opened.note = outcome.note;
    return opened;
  }

  async function pageIdentity(tabId) {
    var results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function () {
        return String(performance.timeOrigin) + " " + location.href;
      }
    });
    return results && results[0] && typeof results[0].result === "string" ? results[0].result : null;
  }

  async function historyStep(tabId, action, timeoutMs) {
    try {
      if (action === "back") await chrome.tabs.goBack(tabId);
      else await chrome.tabs.goForward(tabId);
      return;
    } catch (error) {
      var reason = core.messageOf(error);
      var before = await pageIdentity(tabId).catch(function () {
        return null;
      });
      if (!before) {
        throw new ToolFailure(ERROR.navigationBlocked, "The browser could not go " + action + " in this tab: " + reason, "Open the url with local_browser_open instead");
      }
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: function (delta) {
          history.go(delta);
        },
        args: [action === "back" ? -1 : 1]
      });
      var deadline = Date.now() + Math.min(timeoutMs, 5000);
      while (Date.now() < deadline) {
        await core.sleep(120);
        var now = await pageIdentity(tabId).catch(function () {
          return null;
        });
        if (now && now !== before) return;
      }
      throw new ToolFailure(ERROR.navigationBlocked, "There is no page to go " + action + " to in this tab", "Open the url with local_browser_open instead");
    }
  }

  async function toolNavigate(args, call) {
    var tab = await tabs().resolveTab(args);
    await tabs().assertNavigationAllowed(tab);
    var timeoutMs = call.inner(args.timeoutMs, DEFAULTS.navigateTimeoutMs, 120000);
    var action = args.url ? "url" : args.back ? "back" : args.forward ? "forward" : args.reload ? "reload" : null;
    if (!action) throw new ToolFailure(ERROR.protocolError, "navigate needs url, back, forward or reload");
    if (action === "back" || action === "forward") {
      await historyStep(tab.id, action, timeoutMs);
    } else {
      try {
        if (action === "url") await chrome.tabs.update(tab.id, { url: args.url });
        else await chrome.tabs.reload(tab.id);
      } catch (error) {
        throw new ToolFailure(ERROR.navigationBlocked, "The browser could not " + action + " this tab: " + core.messageOf(error), "Open the url with local_browser_open instead");
      }
    }
    await tabs().waitForTab(tab.id, args.waitUntil || "load", timeoutMs);
    return { tab: await tabs().describe(await chrome.tabs.get(tab.id)) };
  }

  async function toolSnapshot(args, call) {
    var tab = await tabs().resolveTab(args);
    return await tabs().rpc(
      tab.id,
      "snapshot",
      { selector: args.selector, maxNodes: args.maxNodes, includeText: args.includeText, includeHidden: args.includeHidden, cursor: args.cursor },
      call.pageTimeout(20000)
    );
  }

  function actResult(tab, args, result, input, note) {
    var out = {
      ok: result && result.ok !== false,
      url: (result && result.url) || tab.url || "",
      title: (result && result.title) || tab.title || "",
      changed: Boolean(result && result.changed),
      input: input
    };
    if (note) out.note = note;
    if (args.force === true) out.forced = true;
    return out;
  }

  async function syntheticAct(tab, args, timeoutMs, note) {
    var result = await tabs().rpc(tab.id, "act", args, timeoutMs);
    return actResult(tab, args, result, "synthetic", note);
  }

  function trustedRefusal(reason) {
    return new ToolFailure(
      ERROR.unsupported,
      "Trusted input is unavailable for this tab: " + reason,
      "Close DevTools on that tab and keep the debugging bar Chrome shows, or pass input auto to fall back to page events"
    );
  }

  async function settleAct(tab, prepared, timeoutMs) {
    var settled = await tabs()
      .rpc(tab.id, "actSettle", { url: prepared.url, mutations: prepared.mutations }, timeoutMs)
      .catch(function () {
        return null;
      });
    if (settled) return settled;
    var fresh = await chrome.tabs.get(tab.id).catch(function () {
      return tab;
    });
    return { ok: true, url: fresh.url || "", title: fresh.title || "", changed: true };
  }

  async function toolAct(args, call) {
    var tab = await tabs().resolveTab(args);
    var timeoutMs = call.inner(args.timeoutMs, 15000, 60000);
    var mode = args.input || "auto";
    if (mode === "synthetic") return await syntheticAct(tab, args, timeoutMs);
    if (TRUSTED_ACTIONS[args.action] !== true) {
      return await syntheticAct(tab, args, timeoutMs, mode === "trusted" ? args.action + " always runs as page events" : undefined);
    }
    var prepared = await tabs().rpc(tab.id, "actPrepare", args, timeoutMs);
    if (prepared.covered) return await syntheticAct(tab, args, timeoutMs, COVERED_NOTE);
    try {
      await LB.bg.input.ensureDebugger(tab.id);
    } catch (error) {
      if (mode === "trusted") throw trustedRefusal("the browser refused to attach the debugger");
      return await syntheticAct(tab, args, timeoutMs, REFUSED_NOTE);
    }
    try {
      await LB.bg.input.runSteps(tab.id, LB.bg.input.actSteps(args, prepared));
    } catch (error) {
      if (mode === "trusted" || error.dispatched !== 0) throw error;
      return await syntheticAct(tab, args, timeoutMs, REFUSED_NOTE);
    }
    return actResult(tab, args, await settleAct(tab, prepared, timeoutMs), "trusted");
  }

  async function toolRead(args, call) {
    var tab = await tabs().resolveTab(args);
    return await tabs().rpc(tab.id, "read", { selector: args.selector, format: args.format, maxChars: args.maxChars }, call.pageTimeout(20000));
  }

  async function toolWait(args, call) {
    var tab = await tabs().resolveTab(args);
    if (!args.selector && !args.text && !args.urlIncludes && !args.idle) {
      throw new ToolFailure(ERROR.protocolError, "wait needs selector, text, urlIncludes or idle");
    }
    var timeoutMs = call.fromServer
      ? Math.max(100, Math.min(typeof args.timeoutMs === "number" ? Math.floor(args.timeoutMs) : DEFAULTS.waitTimeoutMs, call.budget - 1000))
      : core.clampInt(args.timeoutMs, DEFAULTS.waitTimeoutMs, 100, 120000);
    var pageArgs = Object.assign({}, args, { timeoutMs: timeoutMs });
    return await tabs().rpc(tab.id, "wait", pageArgs, call.fromServer ? call.pageTimeout(timeoutMs + 5000) : timeoutMs + 5000);
  }

  async function pageEvaluate(expression, awaitPromise) {
    function safeClone(input) {
      if (input === undefined) return { value: null, type: "undefined", note: "not serializable" };
      if (input === null) return { value: null, type: "null" };
      try {
        return { value: JSON.parse(JSON.stringify(input)), type: typeof input };
      } catch (error) {
        return { value: null, type: typeof input, note: "not serializable" };
      }
    }
    try {
      var raw = (0, eval)(expression);
      if (raw && typeof raw.then === "function") {
        if (!awaitPromise) return { value: null, type: "promise", note: "not serializable" };
        return safeClone(await raw);
      }
      return safeClone(raw);
    } catch (error) {
      return { __lbError: String((error && error.message) || error) };
    }
  }

  async function toolEvaluate(args) {
    var tab = await tabs().resolveTab(args);
    var frames;
    try {
      frames = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: args.world === "isolated" ? "ISOLATED" : "MAIN",
        args: [args.expression, args.awaitPromise === true],
        func: pageEvaluate
      });
    } catch (error) {
      throw new ToolFailure(
        ERROR.unsupported,
        "This page refused injected code: " + String((error && error.message) || error),
        "Retry with world:isolated, or use local_browser_act instead"
      );
    }
    var outcome = frames && frames[0] ? frames[0].result : null;
    if (outcome && outcome.__lbError) {
      throw new ToolFailure(
        ERROR.unsupported,
        "The page blocked the expression: " + outcome.__lbError,
        "Some sites block eval through their content security policy; retry with world:isolated"
      );
    }
    return outcome;
  }

  async function toolNetwork(args) {
    var tab = await tabs().resolveTab(args);
    if (args.op === "clear") {
      LB.bg.network.clear(tab.id);
      return { requests: [], total: 0, cleared: true };
    }
    return await LB.bg.network.list(tab, args);
  }

  async function toolClose(args) {
    if (args.closeSession === true) {
      LB.bg.bridge.closeAfterCall();
      return { ok: true, closed: "session", sessionId: args.sessionId || null };
    }
    var tab = await tabs().resolveTab(args);
    await chrome.tabs.remove(tab.id);
    return { ok: true, closed: "tab", tabId: tab.id };
  }

  async function toolContext(args, call) {
    var tab = await tabs().resolveTab(args);
    var stores = await tabs().cookieStores();
    var info = tabs().tabInfo(tab, stores);
    var storeId = info.cookieStoreId;
    var probe = await tabs().documentProbe(tab, Math.min(3000, call.pageTimeout(3000)));
    var cookies = args.cookies === false ? { storeId: storeId, url: info.url, count: 0, items: [] } : await LB.bg.cookies.tabCookies(tab, storeId);
    return {
      tab: info,
      container: {
        cookieStoreId: storeId,
        name: storeId === tabs().INCOGNITO_STORE ? "Incognito" : "Default",
        isDefault: storeId === tabs().REGULAR_STORE
      },
      cookies: cookies,
      document: probe.document,
      contentScript: probe.contentScript,
      network: LB.bg.network.stats(tab.id),
      access: await LB.access.snapshot()
    };
  }

  async function toolPermissions(args) {
    if (args.op === "request") {
      var queued = await LB.access.queue(args.permissions || [], { tool: "local_browser_permissions", reason: args.reason });
      var after = await LB.access.snapshot();
      var notes = [];
      if (queued.queued.length) notes.push(PERMISSION_NOTE);
      else notes.push("Nothing new to request.");
      if (queued.unsupported && queued.unsupported.length) notes.push("This browser cannot grant " + queued.unsupported.join(", ") + ".");
      if (queued.unknown && queued.unknown.length) notes.push("Unknown permission ids: " + queued.unknown.join(", ") + ".");
      return Object.assign({}, after, { requested: queued.queued, alreadyGranted: queued.alreadyGranted, note: notes.join(" ") });
    }
    var snapshot = await LB.access.snapshot();
    var note = snapshot.missing.length
      ? "Call op request with the missing ids you need; the user approves them in the extension."
      : "Every permission this browser supports is granted.";
    return Object.assign({}, snapshot, { note: note });
  }

  async function toolApi(args) {
    return await LB.apiCall.invoke(LB.ext.api, args.path, Array.isArray(args.args) ? args.args : []);
  }

  async function toolUi(args) {
    if (args.op !== "open_permissions" && args.op !== "open_control_center") {
      throw new ToolFailure(ERROR.protocolError, "ui op must be open_permissions or open_control_center");
    }
    var tab = await LB.ext.openControlCenter(args.op === "open_permissions" ? "permissions" : "overview");
    return { ok: true, tabId: tab && typeof tab.id === "number" ? tab.id : null };
  }

  function site() {
    return SITE;
  }

  var HANDLERS = {
    local_browser_sessions: { run: toolSessions },
    local_browser_open: { run: toolOpen, needs: site },
    local_browser_navigate: { run: toolNavigate, needs: site },
    local_browser_snapshot: { run: toolSnapshot, needs: site },
    local_browser_act: { run: toolAct, needs: site },
    local_browser_read: { run: toolRead, needs: site },
    local_browser_screenshot: { run: LB.bg.screenshot.toolScreenshot, needs: site },
    local_browser_wait: { run: toolWait, needs: site },
    local_browser_evaluate: { run: toolEvaluate, needs: site },
    local_browser_storage: { run: LB.bg.cookies.toolStorage, needs: LB.bg.cookies.requirements },
    local_browser_network: { run: toolNetwork },
    local_browser_upload: { run: LB.bg.downloads.toolUpload, needs: site },
    local_browser_download: { run: LB.bg.downloads.toolDownload, needs: LB.bg.downloads.requirements },
    local_browser_close: { run: toolClose },
    local_browser_context: { run: toolContext },
    local_browser_permissions: { run: toolPermissions },
    local_browser_api: { run: toolApi },
    local_browser_viewer: { run: LB.bg.viewer.toolViewer, quiet: true },
    local_browser_input: { run: LB.bg.input.toolInput },
    local_browser_ui: { run: toolUi, quiet: true }
  };

  function handler(tool) {
    return Object.prototype.hasOwnProperty.call(HANDLERS, tool) ? HANDLERS[tool] : null;
  }

  function requirements(tool, args) {
    var entry = handler(tool);
    return entry && entry.needs ? entry.needs(args) : [];
  }

  async function ensureAccess(tool, args) {
    var ids = requirements(tool, args);
    if (!ids.length) return;
    await LB.access.ensure(ids, { tool: tool, reason: tool + " needs this to work on the page" });
  }

  LB.bg = LB.bg || {};
  LB.bg.tools = {
    handler: handler,
    names: function () {
      return Object.keys(HANDLERS);
    },
    requirements: requirements,
    ensureAccess: ensureAccess,
    toolContext: toolContext,
    toolPermissions: toolPermissions
  };
})(globalThis);
