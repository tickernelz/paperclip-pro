(function (root) {
  "use strict";

  var DECIMAL = /^\d+$/;
  var MAX_OFFSET = 1000000;

  function toOffset(value) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
    if (value > MAX_OFFSET) return null;
    return value;
  }

  function decodeBase64Url(raw) {
    if (typeof atob !== "function") return null;
    var normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
    while (normalized.length % 4 !== 0) normalized += "=";
    try {
      return atob(normalized);
    } catch (error) {
      return null;
    }
  }

  function parseCursor(raw) {
    if (raw === undefined || raw === null || raw === "") {
      return { provided: false, valid: true, offset: 0, shape: "none" };
    }
    if (typeof raw === "number") {
      var numeric = toOffset(raw);
      return numeric === null
        ? { provided: true, valid: false, offset: 0, shape: "number" }
        : { provided: true, valid: true, offset: numeric, shape: "number" };
    }
    if (typeof raw !== "string") return { provided: true, valid: false, offset: 0, shape: "unknown" };
    var trimmed = raw.trim();
    if (!trimmed) return { provided: false, valid: true, offset: 0, shape: "none" };
    if (DECIMAL.test(trimmed)) {
      var decimal = toOffset(Number(trimmed));
      return decimal === null
        ? { provided: true, valid: false, offset: 0, shape: "decimal" }
        : { provided: true, valid: true, offset: decimal, shape: "decimal" };
    }
    var decoded = decodeBase64Url(trimmed);
    if (decoded === null) return { provided: true, valid: false, offset: 0, shape: "unknown" };
    var parsed;
    try {
      parsed = JSON.parse(decoded);
    } catch (error) {
      return { provided: true, valid: false, offset: 0, shape: "base64" };
    }
    if (!parsed || typeof parsed !== "object") return { provided: true, valid: false, offset: 0, shape: "base64" };
    var fromEnvelope = toOffset(parsed.o);
    if (fromEnvelope === null) return { provided: true, valid: false, offset: 0, shape: "base64" };
    return { provided: true, valid: true, offset: fromEnvelope, shape: "base64" };
  }

  function nextCursor(offset, emitted, total) {
    var base = typeof offset === "number" && offset > 0 ? offset : 0;
    var count = typeof emitted === "number" && emitted > 0 ? emitted : 0;
    var walked = typeof total === "number" && total >= 0 ? total : 0;
    if (count === 0) return null;
    var consumed = base + count;
    if (consumed >= walked) return null;
    return String(consumed);
  }

  function isStale(offset, total) {
    if (typeof offset !== "number" || offset <= 0) return false;
    return typeof total === "number" && offset >= total;
  }

  root.LB = root.LB || {};
  root.LB.cursor = {
    parseCursor: parseCursor,
    nextCursor: nextCursor,
    isStale: isStale,
    MAX_OFFSET: MAX_OFFSET
  };
})(globalThis);
