(function (root) {
  "use strict";

  var DEFAULT_LIMIT = 50;
  var MAX_LIMIT = 200;

  function clampLimit(value, fallback) {
    var fallbackValue = typeof fallback === "number" && Number.isFinite(fallback) ? Math.floor(fallback) : DEFAULT_LIMIT;
    var number = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallbackValue;
    if (number < 1) return 1;
    if (number > MAX_LIMIT) return MAX_LIMIT;
    return number;
  }

  function createRingBuffer(options) {
    var opts = options || {};
    var max = clampLimit(opts.max, MAX_LIMIT);
    var limit = clampLimit(opts.limit, DEFAULT_LIMIT);
    var items = [];

    function push(entry) {
      items.push(entry);
      if (items.length > max) items.splice(0, items.length - max);
      return items.length;
    }

    function setLimit(next) {
      limit = clampLimit(next, limit);
      return limit;
    }

    function list(query) {
      var q = query || {};
      var take = clampLimit(q.limit, limit);
      var predicate = typeof q.filter === "function" ? q.filter : null;
      var matched = [];
      for (var i = 0; i < items.length; i += 1) {
        if (!predicate || predicate(items[i])) matched.push(items[i]);
      }
      var total = matched.length;
      var start = Math.max(0, total - take);
      return { items: matched.slice(start), total: total };
    }

    function clear() {
      items = [];
    }

    function size() {
      return items.length;
    }

    function maxOf() {
      return max;
    }

    function limitOf() {
      return limit;
    }

    return {
      push: push,
      list: list,
      clear: clear,
      size: size,
      setLimit: setLimit,
      maxOf: maxOf,
      limitOf: limitOf
    };
  }

  root.LB = root.LB || {};
  root.LB.ring = {
    DEFAULT_LIMIT: DEFAULT_LIMIT,
    MAX_LIMIT: MAX_LIMIT,
    clampLimit: clampLimit,
    createRingBuffer: createRingBuffer
  };
})(globalThis);
