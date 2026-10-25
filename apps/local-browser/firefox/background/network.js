(function (root) {
  "use strict";

  var LB = root.LB;
  var ring = LB.ring;
  var protocol = LB.protocol;

  var BODY_BYTES = protocol.DEFAULTS.networkBodyBytes;
  var DEFAULT_LIMIT = protocol.DEFAULTS.networkLimit;
  var TEXTUAL = /(json|javascript|xml|html|text|css|x-www-form-urlencoded|graphql)/i;
  var BODY_TYPES = ["main_frame", "sub_frame", "xmlhttprequest", "other"];
  var TYPE_ALIASES = { fetch: ["xmlhttprequest"], xhr: ["xmlhttprequest"], document: ["main_frame", "sub_frame"] };
  var FILTER = { urls: ["<all_urls>"] };
  var FRESH_CAPTURE_MS = 2000;

  var buffers = new Map();
  var pending = new Map();
  var stats = new Map();
  var bufferSize = LB.guards ? LB.guards.current().networkBufferSize : 1000;
  var installed = { active: false, blocking: false, since: 0 };
  var syncing = Promise.resolve();

  function bufferFor(tabId) {
    var existing = buffers.get(tabId);
    if (existing) return existing;
    var created = ring.createRingBuffer({ max: bufferSize });
    buffers.set(tabId, created);
    return created;
  }

  function statsFor(tabId) {
    var existing = stats.get(tabId);
    if (existing) return existing;
    var created = { lastRequestAt: 0, requestsSinceLoad: 0, clearedAt: 0 };
    stats.set(tabId, created);
    return created;
  }

  function shouldCapture(details) {
    if (!details || typeof details.tabId !== "number" || details.tabId < 0) return false;
    return /^(https?|wss?):/i.test(details.url || "");
  }

  function isTextual(mimeType) {
    if (!mimeType) return true;
    return TEXTUAL.test(mimeType);
  }

  function base64Of(bytes) {
    var binary = "";
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      var slice = bytes.subarray(i, Math.min(i + chunk, bytes.length));
      binary += String.fromCharCode.apply(null, Array.prototype.slice.call(slice));
    }
    return btoa(binary);
  }

  function tapBody(entry, requestId) {
    if (typeof browser.webRequest.filterResponseData !== "function") return;
    var filter;
    try {
      filter = browser.webRequest.filterResponseData(requestId);
    } catch (error) {
      return;
    }
    filter.ondata = function (event) {
      if (entry.bytes < BODY_BYTES) {
        var room = BODY_BYTES - entry.bytes;
        var slice = event.data.byteLength > room ? event.data.slice(0, room) : event.data;
        entry.chunks.push(new Uint8Array(slice));
        entry.bytes += slice.byteLength;
        if (slice.byteLength < event.data.byteLength) entry.record.bodyTruncated = true;
      } else {
        entry.record.bodyTruncated = true;
      }
      try {
        filter.write(event.data);
      } catch (error) {
        return;
      }
    };
    filter.onstop = function () {
      attachBody(entry);
      try {
        filter.close();
      } catch (error) {
        return;
      }
    };
    filter.onerror = function () {
      try {
        filter.disconnect();
      } catch (error) {
        return;
      }
    };
  }

  function onBeforeRequest(details) {
    if (!shouldCapture(details)) return;
    var now = Date.now();
    var tabStats = statsFor(details.tabId);
    if (details.type === "main_frame") tabStats.requestsSinceLoad = 0;
    tabStats.requestsSinceLoad += 1;
    tabStats.lastRequestAt = now;
    var record = {
      id: String(details.requestId),
      url: details.url,
      method: details.method || "GET",
      status: 0,
      type: details.type || "other",
      startedAt: new Date(now).toISOString(),
      startedAtMs: now,
      durationMs: 0,
      mimeType: "",
      hasCookie: false,
      hasAuthorization: false
    };
    if (typeof details.originUrl === "string" && details.originUrl) record.initiator = details.originUrl;
    if (typeof details.frameId === "number") record.frameId = details.frameId;
    var entry = { tabId: details.tabId, record: record, chunks: [], bytes: 0 };
    pending.set(details.requestId, entry);
    if (installed.blocking && BODY_TYPES.indexOf(record.type) !== -1) tapBody(entry, details.requestId);
  }

  function onBeforeSendHeaders(details) {
    var entry = pending.get(details.requestId);
    if (!entry) return;
    var summary = LB.headers.summarize(details.requestHeaders || []);
    entry.record.requestHeaders = summary.requestHeaders;
    entry.record.hasCookie = summary.hasCookie;
    entry.record.hasAuthorization = summary.hasAuthorization;
  }

  function onHeadersReceived(details) {
    var entry = pending.get(details.requestId);
    if (!entry) return;
    entry.record.status = details.statusCode || 0;
    entry.record.responseHeaders = LB.headers.normalize(details.responseHeaders || []);
    var type = entry.record.responseHeaders["content-type"];
    if (type) entry.record.mimeType = String(type).split(";")[0].trim();
  }

  function attachBody(entry) {
    if (!entry.chunks.length) return;
    var bytes = new Uint8Array(entry.bytes);
    var offset = 0;
    for (var i = 0; i < entry.chunks.length; i += 1) {
      bytes.set(entry.chunks[i], offset);
      offset += entry.chunks[i].byteLength;
    }
    entry.chunks = [];
    if (isTextual(entry.record.mimeType)) {
      try {
        entry.record.body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return;
      } catch (error) {
        void error;
      }
    }
    entry.record.bodyBase64 = base64Of(bytes);
  }

  function finish(details, failure) {
    var entry = pending.get(details.requestId);
    if (!entry) return;
    pending.delete(details.requestId);
    var record = entry.record;
    if (!record.status && details.statusCode) record.status = details.statusCode;
    record.durationMs = Math.max(0, Date.now() - record.startedAtMs);
    if (typeof details.fromCache === "boolean") record.fromCache = details.fromCache;
    if (typeof details.ip === "string" && details.ip) record.ip = details.ip;
    if (failure) {
      record.failed = true;
      record.error = failure;
    }
    if (!record.body && !record.bodyBase64 && entry.chunks.length) attachBody(entry);
    bufferFor(entry.tabId).push(record);
  }

  function onCompleted(details) {
    finish(details, null);
  }

  function onErrorOccurred(details) {
    finish(details, typeof details.error === "string" && details.error ? details.error : "failed");
  }

  function listeners(blocking) {
    return [
      ["onBeforeRequest", onBeforeRequest, blocking ? ["blocking"] : null],
      ["onBeforeSendHeaders", onBeforeSendHeaders, ["requestHeaders"]],
      ["onHeadersReceived", onHeadersReceived, ["responseHeaders"]],
      ["onCompleted", onCompleted, null],
      ["onErrorOccurred", onErrorOccurred, null]
    ];
  }

  function webRequestApi() {
    var api = browser.webRequest;
    return api && api.onBeforeRequest && typeof api.onBeforeRequest.addListener === "function" ? api : null;
  }

  function removeAll() {
    var api = webRequestApi();
    if (!api) return;
    var all = listeners(false);
    for (var i = 0; i < all.length; i += 1) {
      var event = api[all[i][0]];
      if (!event || typeof event.removeListener !== "function") continue;
      try {
        event.removeListener(all[i][1]);
      } catch (error) {
        void error;
      }
    }
  }

  function addAll(blocking) {
    var api = webRequestApi();
    var all = listeners(blocking);
    for (var i = 0; i < all.length; i += 1) {
      var event = api[all[i][0]];
      if (!event) continue;
      if (all[i][2]) event.addListener(all[i][1], FILTER, all[i][2]);
      else event.addListener(all[i][1], FILTER);
    }
  }

  async function granted(id) {
    try {
      return await browser.permissions.contains({ permissions: [id] });
    } catch (error) {
      return false;
    }
  }

  async function syncNow() {
    var observe = await granted("webRequest");
    var blocking = observe && (await granted("webRequestBlocking"));
    if (!observe || !webRequestApi()) {
      if (installed.active) removeAll();
      pending.clear();
      installed = { active: false, blocking: false, since: 0 };
      return status();
    }
    if (installed.active && installed.blocking === blocking) return status();
    var since = installed.active ? installed.since : Date.now();
    removeAll();
    try {
      addAll(blocking);
    } catch (error) {
      removeAll();
      installed = { active: false, blocking: false, since: 0 };
      return status();
    }
    installed = { active: true, blocking: blocking, since: since };
    return status();
  }

  function sync() {
    syncing = syncing.then(syncNow, syncNow);
    return syncing;
  }

  function status() {
    return { capturing: installed.active, bodies: installed.blocking, since: installed.since };
  }

  function install() {
    if (browser.permissions && browser.permissions.onAdded && typeof browser.permissions.onAdded.addListener === "function") {
      browser.permissions.onAdded.addListener(function () {
        void sync();
      });
    }
    if (browser.permissions && browser.permissions.onRemoved && typeof browser.permissions.onRemoved.addListener === "function") {
      browser.permissions.onRemoved.addListener(function () {
        void sync();
      });
    }
    return sync();
  }

  function resize(size) {
    if (typeof size !== "number" || !Number.isFinite(size) || size < 1) return bufferSize;
    bufferSize = Math.floor(size);
    buffers.forEach(function (buffer) {
      buffer.setMax(bufferSize);
    });
    return bufferSize;
  }

  function typeMatcher(types) {
    if (!Array.isArray(types) || !types.length) return null;
    var wanted = {};
    for (var i = 0; i < types.length; i += 1) {
      var name = String(types[i]).toLowerCase();
      wanted[name] = true;
      var aliases = TYPE_ALIASES[name] || [];
      for (var j = 0; j < aliases.length; j += 1) wanted[aliases[j]] = true;
    }
    return function (type) {
      return wanted[String(type).toLowerCase()] === true;
    };
  }

  function captureSince(tabId) {
    var cleared = stats.has(tabId) ? stats.get(tabId).clearedAt : 0;
    return Math.max(installed.since || 0, cleared || 0);
  }

  function copyRecord(record, includeBodies, includeHeaders) {
    var copy = {
      id: record.id,
      url: record.url,
      method: record.method,
      status: record.status,
      type: record.type,
      startedAt: record.startedAt,
      durationMs: record.durationMs,
      mimeType: record.mimeType,
      hasCookie: record.hasCookie === true,
      hasAuthorization: record.hasAuthorization === true
    };
    if (record.failed) copy.failed = true;
    if (record.error) copy.error = record.error;
    if (typeof record.fromCache === "boolean") copy.fromCache = record.fromCache;
    if (record.initiator) copy.initiator = record.initiator;
    if (record.ip) copy.ip = record.ip;
    if (includeHeaders) {
      if (record.requestHeaders) copy.requestHeaders = record.requestHeaders;
      if (record.responseHeaders) copy.responseHeaders = record.responseHeaders;
    }
    if (includeBodies) {
      if (typeof record.body === "string") copy.body = record.body;
      if (typeof record.bodyBase64 === "string") copy.bodyBase64 = record.bodyBase64;
      if (record.bodyTruncated) copy.bodyTruncated = true;
    }
    return copy;
  }

  function list(tabId, options) {
    var opts = options || {};
    var includeBodies = opts.includeBodies === true;
    var includeHeaders = opts.includeHeaders !== false;
    var urlIncludes = typeof opts.urlIncludes === "string" && opts.urlIncludes ? opts.urlIncludes : null;
    var method = typeof opts.method === "string" && opts.method ? opts.method.toUpperCase() : null;
    var since = typeof opts.since === "number" && Number.isFinite(opts.since) ? opts.since : null;
    var typeOk = typeMatcher(opts.types);
    var limit = typeof opts.limit === "number" && opts.limit >= 1 ? Math.floor(opts.limit) : DEFAULT_LIMIT;
    var result = bufferFor(tabId).list({
      limit: limit,
      filter: function (record) {
        if (since !== null && record.startedAtMs < since) return false;
        if (typeOk && !typeOk(record.type)) return false;
        if (urlIncludes && record.url.indexOf(urlIncludes) === -1) return false;
        if (method && String(record.method).toUpperCase() !== method) return false;
        return true;
      }
    });
    var requests = result.items.map(function (record) {
      return copyRecord(record, includeBodies, includeHeaders);
    });
    var out = { requests: requests, total: result.total, capture: { mode: "continuous", since: captureSince(tabId) } };
    if (includeBodies && !installed.blocking) out.note = "Response bodies need the webRequestBlocking permission; rows carry no bodies";
    else if (!requests.length && installed.active && Date.now() - installed.since < FRESH_CAPTURE_MS) {
      out.note = "Capture just started; reload the page or repeat the action, then list again";
    }
    return out;
  }

  function dropPending(tabId) {
    var dropped = 0;
    pending.forEach(function (entry, id) {
      if (entry.tabId === tabId) {
        pending.delete(id);
        dropped += 1;
      }
    });
    return dropped;
  }

  function clear(tabId) {
    bufferFor(tabId).clear();
    var tabStats = statsFor(tabId);
    tabStats.clearedAt = Date.now();
    return dropPending(tabId);
  }

  function release(tabId) {
    var had = buffers.delete(tabId);
    stats.delete(tabId);
    return { released: had, pending: dropPending(tabId) };
  }

  function tabInfo(tabId) {
    var out = { capturing: installed.active };
    var tabStats = stats.get(tabId);
    if (tabStats && tabStats.lastRequestAt) {
      out.lastRequestAt = tabStats.lastRequestAt;
      out.requestsSinceLoad = tabStats.requestsSinceLoad;
    }
    return out;
  }

  function pendingCount() {
    return pending.size;
  }

  root.LB = root.LB || {};
  root.LB.network = {
    install: install,
    sync: sync,
    status: status,
    resize: resize,
    list: list,
    clear: clear,
    release: release,
    tabInfo: tabInfo,
    pendingCount: pendingCount,
    BODY_BYTES: BODY_BYTES
  };
})(globalThis);
