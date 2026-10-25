(function (root) {
  "use strict";

  var STORAGE_KEY = "lb.guards";
  var FALLBACK = { protectPaperclipTab: true, protectFocusedTab: true, networkBufferSize: 1000 };
  var FALLBACK_BUFFER = { min: 50, max: 20000 };

  var listeners = [];
  var cached = null;
  var version = 0;

  function spec() {
    var contract = root.LB.contract || {};
    return contract.guards || {};
  }

  function defaults() {
    return Object.assign({}, FALLBACK, spec().defaults || {});
  }

  function bufferBounds() {
    var bounds = spec().networkBufferSize || {};
    return {
      min: typeof bounds.min === "number" ? bounds.min : FALLBACK_BUFFER.min,
      max: typeof bounds.max === "number" ? bounds.max : FALLBACK_BUFFER.max
    };
  }

  function normalize(raw) {
    var base = defaults();
    var source = raw && typeof raw === "object" ? raw : {};
    var bounds = bufferBounds();
    var size = typeof source.networkBufferSize === "number" && Number.isFinite(source.networkBufferSize) ? Math.round(source.networkBufferSize) : base.networkBufferSize;
    return {
      protectPaperclipTab: typeof source.protectPaperclipTab === "boolean" ? source.protectPaperclipTab : base.protectPaperclipTab,
      protectFocusedTab: typeof source.protectFocusedTab === "boolean" ? source.protectFocusedTab : base.protectFocusedTab,
      networkBufferSize: Math.min(bounds.max, Math.max(bounds.min, size))
    };
  }

  function area() {
    var api = root.LB.ext && root.LB.ext.api;
    return api && api.storage && api.storage.local ? api.storage.local : null;
  }

  function same(a, b) {
    return a.protectPaperclipTab === b.protectPaperclipTab && a.protectFocusedTab === b.protectFocusedTab && a.networkBufferSize === b.networkBufferSize;
  }

  function publish(next) {
    var previous = cached;
    cached = next;
    version += 1;
    if (previous && same(previous, next)) return;
    listeners.slice().forEach(function (listener) {
      try {
        listener(next);
      } catch (error) {
        return;
      }
    });
  }

  function current() {
    return cached ? Object.assign({}, cached) : defaults();
  }

  function get() {
    var storage = area();
    if (!storage) return Promise.resolve(current());
    var started = version;
    return Promise.resolve(storage.get(STORAGE_KEY)).then(
      function (stored) {
        if (version !== started) return current();
        var next = normalize(stored ? stored[STORAGE_KEY] : null);
        cached = next;
        return Object.assign({}, next);
      },
      function () { return current(); }
    );
  }

  function set(patch) {
    return get().then(function (existing) {
      var next = normalize(Object.assign({}, existing, patch && typeof patch === "object" ? patch : {}));
      var storage = area();
      var payload = {};
      payload[STORAGE_KEY] = next;
      var write = storage ? Promise.resolve(storage.set(payload)) : Promise.resolve();
      return write.then(function () {
        publish(next);
        return Object.assign({}, next);
      });
    });
  }

  function onChange(listener) {
    if (typeof listener !== "function") return function () {};
    listeners.push(listener);
    return function () {
      listeners = listeners.filter(function (item) { return item !== listener; });
    };
  }

  function install() {
    var api = root.LB.ext && root.LB.ext.api;
    if (!api || !api.storage || !api.storage.onChanged || typeof api.storage.onChanged.addListener !== "function") return;
    api.storage.onChanged.addListener(function (changes, areaName) {
      if (areaName !== "local" || !changes || !changes[STORAGE_KEY]) return;
      publish(normalize(changes[STORAGE_KEY].newValue));
    });
  }

  root.LB = root.LB || {};
  root.LB.guards = {
    STORAGE_KEY: STORAGE_KEY,
    defaults: defaults,
    bounds: bufferBounds,
    normalize: normalize,
    current: current,
    get: get,
    set: set,
    onChange: onChange
  };
  install();
})(globalThis);
