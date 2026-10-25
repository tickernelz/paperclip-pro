(function (root) {
  "use strict";

  var LB = root.LB;
  var core = LB.bg.core;
  var ERROR = core.ERROR;
  var ToolFailure = core.ToolFailure;
  var WINDOW_MS = 1200;
  var BODY_IDLE_MS = 300000;
  var BODY_MATCH_MS = 5000;
  var DEFAULT_LIMIT = 200;
  var FILTER = { urls: ["<all_urls>"] };
  var TYPE_ALIASES = {
    fetch: ["xmlhttprequest", "fetch"],
    xhr: ["xmlhttprequest", "xhr"],
    document: ["main_frame", "sub_frame", "document"],
    stylesheet: ["stylesheet"],
    script: ["script"],
    image: ["image"],
    font: ["font"],
    media: ["media"],
    websocket: ["websocket"]
  };
  var CDP_TYPES = {
    Document: "main_frame",
    XHR: "xmlhttprequest",
    Fetch: "xmlhttprequest",
    Script: "script",
    Stylesheet: "stylesheet",
    Image: "image",
    Font: "font",
    Media: "media",
    WebSocket: "websocket",
    Ping: "ping",
    CSPViolationReport: "csp_report"
  };

  var ring = [];
  var inflight = new Map();
  var lastRequestAt = new Map();
  var loadStartedAt = new Map();
  var bodySessions = new Map();
  var listening = false;
  var captureSince = 0;
  var lastAccess = null;

  function bufferSize() {
    var guards = LB.guards.current();
    return guards && typeof guards.networkBufferSize === "number" ? guards.networkBufferSize : 1000;
  }

  function trim() {
    var max = bufferSize();
    while (ring.length > max) {
      var dropped = ring.shift();
      if (dropped && inflight.get(dropped.requestId) === dropped) inflight.delete(dropped.requestId);
    }
  }

  function push(row) {
    ring.push(row);
    if (typeof row.tabId === "number" && row.tabId >= 0) lastRequestAt.set(row.tabId, row.startedAtMs);
    trim();
  }

  function stampOf(details) {
    return typeof details.timeStamp === "number" && Number.isFinite(details.timeStamp) ? details.timeStamp : Date.now();
  }

  function onBeforeRequest(details) {
    var at = stampOf(details);
    var row = {
      requestId: String(details.requestId),
      url: details.url,
      method: details.method,
      type: details.type || "other",
      tabId: details.tabId,
      frameId: details.frameId,
      startedAt: new Date(at).toISOString(),
      startedAtMs: at,
      status: null,
      durationMs: null,
      hasCookie: false,
      hasAuthorization: false
    };
    if (typeof details.documentId === "string" && details.documentId) row.documentId = details.documentId;
    if (typeof details.initiator === "string" && details.initiator) row.initiator = details.initiator;
    if (details.type === "main_frame" && typeof details.tabId === "number") loadStartedAt.set(details.tabId, at);
    inflight.set(row.requestId, row);
    push(row);
  }

  function rowOf(details) {
    return inflight.get(String(details.requestId)) || null;
  }

  function onBeforeSendHeaders(details) {
    var row = rowOf(details);
    if (row) Object.assign(row, LB.headers.summarize(details.requestHeaders));
  }

  function mimeOf(headers) {
    var type = headers && headers["content-type"];
    return type ? String(type).split(";")[0].trim() : undefined;
  }

  function onHeadersReceived(details) {
    var row = rowOf(details);
    if (!row) return;
    row.status = typeof details.statusCode === "number" ? details.statusCode : row.status;
    row.responseHeaders = LB.headers.normalize(details.responseHeaders);
    var mime = mimeOf(row.responseHeaders);
    if (mime) row.mimeType = mime;
  }

  function finish(row, details) {
    var elapsed = stampOf(details) - row.startedAtMs;
    row.durationMs = Number.isFinite(elapsed) && elapsed >= 0 ? Math.round(elapsed) : null;
    if (inflight.get(row.requestId) === row) inflight.delete(row.requestId);
  }

  function onCompleted(details) {
    var row = rowOf(details);
    if (!row) return;
    if (typeof details.statusCode === "number") row.status = details.statusCode;
    if (typeof details.fromCache === "boolean") row.fromCache = details.fromCache;
    if (typeof details.ip === "string" && details.ip) row.ip = details.ip;
    finish(row, details);
  }

  function onErrorOccurred(details) {
    var row = rowOf(details);
    if (!row) return;
    row.error = String(details.error || "failed");
    if (typeof details.fromCache === "boolean") row.fromCache = details.fromCache;
    finish(row, details);
  }

  function addListener(event, fn, extra) {
    if (!event || typeof event.addListener !== "function") return;
    if (!extra) {
      event.addListener(fn, FILTER);
      return;
    }
    try {
      event.addListener(fn, FILTER, extra);
    } catch (error) {
      event.addListener(fn, FILTER, extra.filter(function (item) { return item !== "extraHeaders"; }));
    }
  }

  function install() {
    if (listening) return true;
    var api = chrome.webRequest;
    if (!api || !api.onBeforeRequest) return false;
    try {
      addListener(api.onBeforeRequest, onBeforeRequest);
      addListener(api.onBeforeSendHeaders, onBeforeSendHeaders, ["requestHeaders", "extraHeaders"]);
      addListener(api.onHeadersReceived, onHeadersReceived, ["responseHeaders", "extraHeaders"]);
      addListener(api.onCompleted, onCompleted);
      addListener(api.onErrorOccurred, onErrorOccurred);
    } catch (error) {
      return false;
    }
    listening = true;
    captureSince = Date.now();
    return true;
  }

  function setAccess(snapshot) {
    lastAccess = snapshot || null;
    if (granted("webRequest")) install();
  }

  function granted(id) {
    return Boolean(lastAccess && Array.isArray(lastAccess.granted) && lastAccess.granted.indexOf(id) !== -1);
  }

  function capturing() {
    return listening && granted("webRequest") && granted("<all_urls>");
  }

  function stats(tabId) {
    var result = { capturing: capturing() };
    if (lastRequestAt.has(tabId)) result.lastRequestAt = lastRequestAt.get(tabId);
    if (loadStartedAt.has(tabId)) {
      var started = loadStartedAt.get(tabId);
      result.requestsSinceLoad = ring.filter(function (row) {
        return row.tabId === tabId && row.startedAtMs >= started;
      }).length;
    }
    return result;
  }

  function typeMatcher(types) {
    if (!Array.isArray(types) || !types.length) return null;
    var wanted = new Set();
    types.forEach(function (type) {
      var key = String(type).toLowerCase();
      (TYPE_ALIASES[key] || [key]).forEach(function (alias) {
        wanted.add(alias);
      });
    });
    return function (row) {
      return wanted.has(String(row.type).toLowerCase());
    };
  }

  function select(tabId, args) {
    var rows = ring.filter(function (row) {
      return row.tabId === tabId;
    });
    if (typeof args.since === "number") rows = rows.filter(function (row) { return row.startedAtMs >= args.since; });
    if (args.urlIncludes) rows = rows.filter(function (row) { return String(row.url).includes(args.urlIncludes); });
    if (args.method) {
      var method = String(args.method).toUpperCase();
      rows = rows.filter(function (row) { return String(row.method).toUpperCase() === method; });
    }
    var matches = typeMatcher(args.types);
    if (matches) rows = rows.filter(matches);
    return rows;
  }

  function output(row, includeHeaders) {
    var out = {
      url: row.url,
      method: row.method,
      status: row.status,
      type: row.type,
      startedAt: row.startedAt,
      durationMs: row.durationMs,
      tabId: row.tabId,
      hasCookie: row.hasCookie === true,
      hasAuthorization: row.hasAuthorization === true
    };
    ["frameId", "documentId", "initiator", "mimeType", "fromCache", "ip", "error", "body", "bodyBase64"].forEach(function (key) {
      if (row[key] !== undefined) out[key] = row[key];
    });
    if (includeHeaders) {
      if (row.requestHeaders) out.requestHeaders = row.requestHeaders;
      if (row.responseHeaders) out.responseHeaders = row.responseHeaders;
    }
    return out;
  }

  function cdpRow(tabId, params, at) {
    var request = params.request || {};
    var row = {
      requestId: "cdp:" + params.requestId,
      cdpRequestId: params.requestId,
      url: request.url,
      method: request.method,
      type: CDP_TYPES[params.type] || String(params.type || "other").toLowerCase(),
      tabId: tabId,
      startedAt: new Date(at).toISOString(),
      startedAtMs: at,
      startedMono: params.timestamp,
      status: null,
      durationMs: null,
      hasCookie: false,
      hasAuthorization: false,
      finished: false
    };
    if (params.initiator && params.initiator.url) row.initiator = params.initiator.url;
    Object.assign(row, LB.headers.summarize(request.headers));
    return row;
  }

  function cdpListener(tabId, rows) {
    return function (source, method, params) {
      if (!source || source.tabId !== tabId || !params) return;
      if (method === "Network.requestWillBeSent") {
        var at = typeof params.wallTime === "number" ? Math.round(params.wallTime * 1000) : Date.now();
        rows.set(params.requestId, cdpRow(tabId, params, at));
        return;
      }
      var row = rows.get(params.requestId);
      if (!row) return;
      if (method === "Network.requestWillBeSentExtraInfo") {
        Object.assign(row, LB.headers.summarize(params.headers));
      } else if (method === "Network.responseReceived") {
        var response = params.response || {};
        row.status = response.status;
        if (response.mimeType) row.mimeType = response.mimeType;
        row.responseHeaders = LB.headers.normalize(response.headers);
        if (typeof response.fromDiskCache === "boolean") row.fromCache = response.fromDiskCache || response.fromServiceWorker === true;
        if (response.remoteIPAddress) row.ip = response.remoteIPAddress;
      } else if (method === "Network.loadingFinished") {
        var elapsed = (params.timestamp - row.startedMono) * 1000;
        row.durationMs = Number.isFinite(elapsed) && elapsed >= 0 ? Math.round(elapsed) : null;
        row.finished = true;
      } else if (method === "Network.loadingFailed") {
        row.error = String(params.errorText || "failed");
        row.finished = true;
      }
    };
  }

  async function enableNetwork(tabId) {
    await LB.bg.cdp.send(tabId, "Network.enable", { maxTotalBufferSize: 100000000, maxResourceBufferSize: 50000000 });
  }

  function debuggerRefused() {
    return new ToolFailure(
      ERROR.unsupported,
      "The browser would not attach its debugger to this tab",
      "Close DevTools or another debugging tool for this tab, then retry"
    );
  }

  async function collectWindow(tabId, windowMs) {
    var rows = new Map();
    var listener = cdpListener(tabId, rows);
    chrome.debugger.onEvent.addListener(listener);
    try {
      await LB.bg.cdp.borrow(tabId, async function () {
        await enableNetwork(tabId);
        await core.sleep(windowMs);
      });
    } catch (error) {
      throw debuggerRefused();
    } finally {
      chrome.debugger.onEvent.removeListener(listener);
    }
    return Array.from(rows.values());
  }

  function touchBodySession(session) {
    if (session.timer) clearTimeout(session.timer);
    session.timer = setTimeout(function () {
      void stopBodySession(session.tabId);
    }, BODY_IDLE_MS);
  }

  async function startBodySession(tabId) {
    var existing = bodySessions.get(tabId);
    if (existing) {
      touchBodySession(existing);
      return { session: existing, fresh: false };
    }
    try {
      await LB.bg.cdp.acquire(tabId, "network");
      await enableNetwork(tabId);
    } catch (error) {
      await LB.bg.cdp.release(tabId, "network").catch(function () {});
      throw debuggerRefused();
    }
    var session = { tabId: tabId, rows: new Map(), timer: null, listener: null };
    session.listener = cdpListener(tabId, session.rows);
    chrome.debugger.onEvent.addListener(session.listener);
    bodySessions.set(tabId, session);
    touchBodySession(session);
    return { session: session, fresh: true };
  }

  async function stopBodySession(tabId) {
    var session = bodySessions.get(tabId);
    if (!session) return;
    bodySessions.delete(tabId);
    if (session.timer) clearTimeout(session.timer);
    chrome.debugger.onEvent.removeListener(session.listener);
    await LB.bg.cdp.release(tabId, "network").catch(function () {});
  }

  function matchCdp(session, row) {
    if (row.cdpRequestId) return session.rows.get(row.cdpRequestId) || row;
    var best = null;
    var bestGap = Infinity;
    session.rows.forEach(function (candidate) {
      if (candidate.url !== row.url || String(candidate.method).toUpperCase() !== String(row.method).toUpperCase()) return;
      var gap = Math.abs(candidate.startedAtMs - row.startedAtMs);
      if (gap < bestGap && gap <= BODY_MATCH_MS) {
        best = candidate;
        bestGap = gap;
      }
    });
    return best;
  }

  async function attachBodies(tabId, rows, session) {
    for (var index = 0; index < rows.length; index += 1) {
      var source = matchCdp(session, rows[index]);
      if (!source || !source.finished || !source.cdpRequestId) continue;
      try {
        var body = await LB.bg.cdp.send(tabId, "Network.getResponseBody", { requestId: source.cdpRequestId });
        if (body.base64Encoded === true) rows[index].bodyBase64 = String(body.body || "");
        else rows[index].body = String(body.body || "");
      } catch (error) {}
    }
  }

  function clear(tabId) {
    ring = ring.filter(function (row) {
      if (row.tabId !== tabId) return true;
      if (inflight.get(row.requestId) === row) inflight.delete(row.requestId);
      return false;
    });
    lastRequestAt.delete(tabId);
  }

  async function list(tab, args) {
    var includeHeaders = args.includeHeaders !== false;
    var limit = typeof args.limit === "number" && args.limit > 0 ? Math.floor(args.limit) : LB.contract && LB.contract.limits ? LB.contract.limits.defaults.networkMaxEntries : DEFAULT_LIMIT;
    var notes = [];
    var capture;
    var started = null;
    if (args.includeBodies === true) {
      try {
        started = await startBodySession(tab.id);
      } catch (error) {
        notes.push("Response bodies need the debugger, which another tool holds on this tab; close DevTools and retry for bodies");
      }
    }
    if (capturing()) {
      capture = { mode: "continuous", since: captureSince };
    } else {
      var missing = ["webRequest", "<all_urls>"].filter(function (id) { return !granted(id); });
      if (missing.length) {
        await LB.access.queue(missing, { tool: "local_browser_network", reason: "Record every request with its headers continuously, not only during a short window" }).catch(function () {});
        notes.push("Continuous capture needs the " + missing.join(" and ") + " permission; the request is waiting in the extension for the user to press Allow");
      }
      var windowStart = Date.now();
      var collected = await collectWindow(tab.id, WINDOW_MS);
      collected.forEach(function (row) {
        row.finished = undefined;
        push(row);
      });
      capture = { mode: "window", since: windowStart, windowMs: WINDOW_MS };
    }
    var rows = select(tab.id, args);
    var total = rows.length;
    var picked = rows.slice(-limit);
    if (started) {
      var copies = picked.map(function (row) { return Object.assign({}, row); });
      await attachBodies(tab.id, copies, started.session);
      picked = copies;
      if (started.fresh && capture.mode === "continuous") {
        notes.push("Response bodies are recorded from now on; repeat the page action and list again to read them");
      }
    }
    var result = {
      requests: picked.map(function (row) { return output(row, includeHeaders); }),
      total: total,
      capture: capture
    };
    if (notes.length) result.note = notes.join(". ");
    return result;
  }

  function forgetTab(tabId) {
    clear(tabId);
    loadStartedAt.delete(tabId);
    var session = bodySessions.get(tabId);
    if (session) {
      bodySessions.delete(tabId);
      if (session.timer) clearTimeout(session.timer);
      chrome.debugger.onEvent.removeListener(session.listener);
    }
  }

  function onDebuggerDetached(tabId) {
    var session = bodySessions.get(tabId);
    if (!session) return;
    bodySessions.delete(tabId);
    if (session.timer) clearTimeout(session.timer);
    chrome.debugger.onEvent.removeListener(session.listener);
  }

  LB.bg = LB.bg || {};
  LB.bg.network = {
    WINDOW_MS: WINDOW_MS,
    install: install,
    setAccess: setAccess,
    capturing: capturing,
    stats: stats,
    list: list,
    clear: clear,
    forgetTab: forgetTab,
    onDebuggerDetached: onDebuggerDetached,
    rows: function () {
      return ring.slice();
    }
  };
})(globalThis);
