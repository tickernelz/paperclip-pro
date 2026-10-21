(function (root) {
  "use strict";

  var REF_PATTERN = /^e(\d+)$/;

  function formatRef(index) {
    return "e" + String(index);
  }

  function parseRef(ref) {
    if (typeof ref !== "string") return null;
    var match = REF_PATTERN.exec(ref.trim());
    if (!match) return null;
    var value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0) return null;
    return value;
  }

  function createRefMap(options) {
    var opts = options || {};
    var isDetached =
      typeof opts.isDetached === "function"
        ? opts.isDetached
        : function (element) {
            return !element || element.isConnected === false;
          };
    var byRef = new Map();
    var byElement = new WeakMap();
    var next = 1;

    function reset() {
      byRef = new Map();
      byElement = new WeakMap();
      next = 1;
    }

    function assign(element) {
      if (!element) return null;
      var existing = byElement.get(element);
      if (existing && byRef.get(existing) === element) return existing;
      var ref = formatRef(next);
      next += 1;
      byRef.set(ref, element);
      byElement.set(element, ref);
      return ref;
    }

    function resolve(ref) {
      var element = byRef.get(ref);
      if (!element) return { ok: false, reason: "missing" };
      if (isDetached(element)) {
        byRef.delete(ref);
        return { ok: false, reason: "stale" };
      }
      return { ok: true, element: element };
    }

    function prune() {
      var dropped = 0;
      byRef.forEach(function (element, ref) {
        if (isDetached(element)) {
          byRef.delete(ref);
          dropped += 1;
        }
      });
      return dropped;
    }

    function size() {
      return byRef.size;
    }

    function peek() {
      return next - 1;
    }

    return {
      assign: assign,
      resolve: resolve,
      reset: reset,
      prune: prune,
      size: size,
      last: peek
    };
  }

  root.LB = root.LB || {};
  root.LB.refmap = {
    formatRef: formatRef,
    parseRef: parseRef,
    createRefMap: createRefMap
  };
})(globalThis);
