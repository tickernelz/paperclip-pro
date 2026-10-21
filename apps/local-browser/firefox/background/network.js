(function (root) {
  "use strict";

  var LB = root.LB;
  var ring = LB.ring;
  var protocol = LB.protocol;

  var buffers = new Map();
  var pending = new Map();
  var BODY_BYTES = protocol.DEFAULTS.networkBodyBytes;
  var TEXTUAL = /(json|javascript|xml|html|text|css|x-www-form-urlencoded|graphql)/i;
  var CAPTURE_TYPES = ["main_frame", "sub_frame", "xmlhttprequest", "other"];

  function bufferFor(tabId) {
    var existing = buffers.get(tabId);
    if (existing) return existing;
    var created = ring.createRingBuffer({ limit: protocol.DEFAULTS.networkLimit, max: protocol.DEFAULTS.networkMaxLimit });
    buffers.set(tabId, created);
    return created;
  }

  function shouldCapture(details) {
    if (!details || typeof details.tabId !== "number" || details.tabId < 0) return false;
    if (CAPTURE_TYPES.indexOf(details.type) === -1) return false;
    return /^https?:/i.test(details.url || "");
  }

  function isTextual(mimeType) {
    if (!mimeType) return true;
    return TEXTUAL.test(mimeType);
  }

  function base64Of(bytes) {
    var binary = "";
    for (var i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function onBeforeRequest(details) {
    if (!shouldCapture(details)) return;
    var record = {
      id: details.requestId,
      url: details.url,
      method: details.method || "GET",
      status: 0,
      type: details.type || "other",
      startedAt: new Date().toISOString(),
      durationMs: 0,
      mimeType: ""
    };
    var entry = {
      tabId: details.tabId,
      record: record,
      startedAt: Date.now(),
      chunks: [],
      bytes: 0,
      truncated: false,
      filter: null
    };
    pending.set(details.requestId, entry);
    if (typeof browser.webRequest.filterResponseData !== "function") return;
    var filter;
    try {
      filter = browser.webRequest.filterResponseData(details.requestId);
    } catch (error) {
      return;
    }
    entry.filter = filter;
    filter.ondata = function (event) {
      if (entry.bytes < BODY_BYTES) {
        var room = BODY_BYTES - entry.bytes;
        var slice = event.data.byteLength > room ? event.data.slice(0, room) : event.data;
        entry.chunks.push(new Uint8Array(slice));
        entry.bytes += slice.byteLength;
        if (slice.byteLength < event.data.byteLength) entry.truncated = true;
      } else {
        entry.truncated = true;
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
        entry.record.body = new TextDecoder("utf-8").decode(bytes);
      } catch (error) {
        entry.record.bodyBase64 = base64Of(bytes);
      }
      return;
    }
    entry.record.bodyBase64 = base64Of(bytes);
  }

  function onHeadersReceived(details) {
    var entry = pending.get(details.requestId);
    if (!entry) return;
    entry.record.status = details.statusCode || 0;
    var headers = details.responseHeaders || [];
    for (var i = 0; i < headers.length; i += 1) {
      if (String(headers[i].name).toLowerCase() === "content-type") {
        entry.record.mimeType = String(headers[i].value || "").split(";")[0].trim();
        break;
      }
    }
  }

  function finish(details, failed) {
    var entry = pending.get(details.requestId);
    if (!entry) return;
    pending.delete(details.requestId);
    if (!entry.record.status && details.statusCode) entry.record.status = details.statusCode;
    entry.record.durationMs = Math.max(0, Date.now() - entry.startedAt);
    if (failed) entry.record.failed = true;
    if (!entry.record.body && !entry.record.bodyBase64 && entry.chunks.length) attachBody(entry);
    bufferFor(entry.tabId).push(entry.record);
  }

  function onCompleted(details) {
    finish(details, false);
  }

  function onErrorOccurred(details) {
    finish(details, true);
  }

  function install() {
    var filter = { urls: ["<all_urls>"], types: CAPTURE_TYPES };
    browser.webRequest.onBeforeRequest.addListener(onBeforeRequest, filter, ["blocking"]);
    browser.webRequest.onHeadersReceived.addListener(onHeadersReceived, filter, ["responseHeaders"]);
    browser.webRequest.onCompleted.addListener(onCompleted, filter);
    browser.webRequest.onErrorOccurred.addListener(onErrorOccurred, filter);
  }

  function list(tabId, options) {
    var opts = options || {};
    var includeBodies = opts.includeBodies === true;
    var urlIncludes = typeof opts.urlIncludes === "string" && opts.urlIncludes ? opts.urlIncludes : null;
    var method = typeof opts.method === "string" && opts.method ? opts.method.toUpperCase() : null;
    var result = bufferFor(tabId).list({
      limit: opts.limit,
      filter: function (record) {
        if (urlIncludes && record.url.indexOf(urlIncludes) === -1) return false;
        if (method && String(record.method).toUpperCase() !== method) return false;
        return true;
      }
    });
    var requests = result.items.map(function (record) {
      var copy = {
        id: record.id,
        url: record.url,
        method: record.method,
        status: record.status,
        type: record.type,
        startedAt: record.startedAt,
        durationMs: record.durationMs,
        mimeType: record.mimeType
      };
      if (record.failed) copy.failed = true;
      if (includeBodies) {
        if (typeof record.body === "string") copy.body = record.body;
        if (typeof record.bodyBase64 === "string") copy.bodyBase64 = record.bodyBase64;
      }
      return copy;
    });
    return { requests: requests, total: result.total };
  }

  function clear(tabId) {
    bufferFor(tabId).clear();
    var dropped = 0;
    pending.forEach(function (entry, id) {
      if (entry.tabId === tabId) {
        pending.delete(id);
        dropped += 1;
      }
    });
    return dropped;
  }

  function pendingCount() {
    return pending.size;
  }

  function release(tabId) {
    var had = buffers.delete(tabId);
    var dropped = 0;
    pending.forEach(function (entry, id) {
      if (entry.tabId === tabId) {
        pending.delete(id);
        dropped += 1;
      }
    });
    return { released: had, pending: dropped };
  }

  root.LB = root.LB || {};
  root.LB.network = {
    install: install,
    list: list,
    clear: clear,
    release: release,
    pendingCount: pendingCount,
    BODY_BYTES: BODY_BYTES
  };
})(globalThis);
