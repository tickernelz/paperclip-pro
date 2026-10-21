(function (root) {
  "use strict";

  var MIN_DELAY_MS = 250;

  function number(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function unit(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0.5;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }

  function computeDelay(attempt, options) {
    var opts = options || {};
    var baseMs = number(opts.baseMs, 1000);
    var maxMs = number(opts.maxMs, 30000);
    var factor = number(opts.factor, 2);
    var jitter = typeof opts.jitter === "number" && opts.jitter >= 0 ? Math.min(opts.jitter, 1) : 0.25;
    var random = typeof opts.random === "function" ? unit(opts.random()) : unit(Math.random());
    var step = Math.min(maxMs, baseMs * Math.pow(factor, Math.max(0, Math.floor(attempt || 0))));
    var spread = step * jitter;
    var delay = step - spread + 2 * spread * random;
    return Math.max(MIN_DELAY_MS, Math.min(maxMs, Math.round(delay)));
  }

  root.LB = root.LB || {};
  root.LB.backoff = { computeDelay: computeDelay, MIN_DELAY_MS: MIN_DELAY_MS };
})(globalThis);
