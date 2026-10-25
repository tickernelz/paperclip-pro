(function (root) {
  "use strict";

  var NODE_NAME_MAX = 160;

  function collapse(value) {
    if (typeof value !== "string") return "";
    return value.replace(/\s+/g, " ").trim();
  }

  function truncate(value, max) {
    var limit = typeof max === "number" && max > 0 ? max : NODE_NAME_MAX;
    var source = value === null || value === undefined ? "" : String(value);
    if (source.length <= limit) return source;
    var cut = source.slice(0, limit - 1).replace(/\s+$/, "");
    return cut + "\u2026";
  }

  function normalizeName(value) {
    return truncate(collapse(value), NODE_NAME_MAX);
  }

  function clampInt(value, fallback, min, max) {
    var number = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
    if (number < min) return min;
    if (number > max) return max;
    return number;
  }

  root.LB = root.LB || {};
  root.LB.text = {
    NODE_NAME_MAX: NODE_NAME_MAX,
    collapse: collapse,
    truncate: truncate,
    normalizeName: normalizeName,
    clampInt: clampInt
  };
})(globalThis);
