(function (root) {
  "use strict";

  if (root.LB && root.LB.documentState && root.LB.documentState.installed) return;

  var NAVIGATION_TYPES = ["navigate", "reload", "back_forward", "prerender"];

  function token() {
    var cryptoApi = root.crypto;
    if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
    return "doc-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }

  function create(win) {
    var scope = win || root;
    var doc = scope.document || {};
    var perf = scope.performance || null;
    var state = {
      documentId: token(),
      restoredFromBfcache: false,
      hiddenByPagehide: false,
      frozen: false,
      requests: 0,
      xhr: 0,
      observing: false,
      installedAt: Date.now()
    };

    function count(entries) {
      for (var index = 0; index < entries.length; index += 1) {
        state.requests += 1;
        var initiator = entries[index] && entries[index].initiatorType;
        if (initiator === "xmlhttprequest" || initiator === "fetch") state.xhr += 1;
      }
    }

    function observe() {
      var Observer = scope.PerformanceObserver;
      if (typeof Observer !== "function") return;
      try {
        var observer = new Observer(function (list) { count(list.getEntries()); });
        observer.observe({ type: "resource", buffered: true });
        state.observing = true;
      } catch (error) {
        state.observing = false;
      }
    }

    function resourceEntries() {
      if (!perf || typeof perf.getEntriesByType !== "function") return [];
      try {
        return perf.getEntriesByType("resource") || [];
      } catch (error) {
        return [];
      }
    }

    function navigationEntry() {
      if (!perf || typeof perf.getEntriesByType !== "function") return null;
      try {
        var entries = perf.getEntriesByType("navigation") || [];
        return entries.length ? entries[0] : null;
      } catch (error) {
        return null;
      }
    }

    function navigationType() {
      if (state.restoredFromBfcache) return "back_forward";
      var entry = navigationEntry();
      var type = entry && entry.type;
      return NAVIGATION_TYPES.indexOf(type) !== -1 ? type : "unknown";
    }

    function loadedAt() {
      var origin = perf && typeof perf.timeOrigin === "number" ? perf.timeOrigin : state.installedAt;
      return Math.round(origin);
    }

    function listen(target, name, handler) {
      if (target && typeof target.addEventListener === "function") target.addEventListener(name, handler, true);
    }

    listen(scope, "pageshow", function (event) {
      state.hiddenByPagehide = false;
      state.frozen = false;
      if (event && event.persisted) state.restoredFromBfcache = true;
    });
    listen(scope, "pagehide", function () {
      state.hiddenByPagehide = true;
    });
    listen(doc, "freeze", function () {
      state.frozen = true;
    });
    listen(doc, "resume", function () {
      state.frozen = false;
    });
    observe();

    function read() {
      var prerendering = doc.prerendering === true;
      var reasons = [];
      if (state.restoredFromBfcache) reasons.push("restored_from_bfcache");
      if (state.hiddenByPagehide) reasons.push("page_hidden");
      if (state.frozen) reasons.push("frozen");
      if (prerendering) reasons.push("prerendering");
      var requests = state.requests;
      var xhr = state.xhr;
      if (!state.observing) {
        var entries = resourceEntries();
        requests = entries.length;
        xhr = entries.filter(function (entry) { return entry.initiatorType === "xmlhttprequest" || entry.initiatorType === "fetch"; }).length;
      }
      var loaded = loadedAt();
      var location = scope.location;
      return {
        documentId: state.documentId,
        url: location && typeof location.href === "string" ? location.href : String(doc.URL || ""),
        readyState: typeof doc.readyState === "string" ? doc.readyState : "unknown",
        visibilityState: typeof doc.visibilityState === "string" ? doc.visibilityState : "unknown",
        navigationType: navigationType(),
        restoredFromBfcache: state.restoredFromBfcache,
        wasDiscarded: doc.wasDiscarded === true,
        prerendering: prerendering,
        loadedAt: loaded,
        ageMs: Math.max(0, Date.now() - loaded),
        requestsSinceLoad: requests,
        xhrSinceLoad: xhr,
        stale: reasons.length > 0,
        staleReasons: reasons
      };
    }

    return { read: read, documentId: state.documentId };
  }

  root.LB = root.LB || {};
  var installed = create(root);
  root.LB.documentState = {
    installed: true,
    documentId: installed.documentId,
    read: installed.read,
    create: create
  };
})(globalThis);
