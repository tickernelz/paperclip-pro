(function (root) {
  "use strict";

  var DEFAULT_MAX = 1000;

  function positiveInt(value, fallback) {
    var number = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
    return number < 1 ? 1 : number;
  }

  function createRingBuffer(options) {
    var opts = options || {};
    var max = positiveInt(opts.max, DEFAULT_MAX);
    var items = [];

    function trim() {
      if (items.length > max) items.splice(0, items.length - max);
    }

    function push(entry) {
      items.push(entry);
      trim();
      return items.length;
    }

    function setMax(next) {
      max = positiveInt(next, max);
      trim();
      return max;
    }

    function list(query) {
      var q = query || {};
      var predicate = typeof q.filter === "function" ? q.filter : null;
      var matched = [];
      for (var i = 0; i < items.length; i += 1) {
        if (!predicate || predicate(items[i])) matched.push(items[i]);
      }
      var total = matched.length;
      var take = q.limit === undefined || q.limit === null ? total : positiveInt(q.limit, total);
      return { items: matched.slice(Math.max(0, total - take)), total: total };
    }

    function last() {
      return items.length ? items[items.length - 1] : null;
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

    return { push: push, list: list, last: last, clear: clear, size: size, setMax: setMax, maxOf: maxOf };
  }

  root.LB = root.LB || {};
  root.LB.ring = { DEFAULT_MAX: DEFAULT_MAX, createRingBuffer: createRingBuffer };
})(globalThis);
