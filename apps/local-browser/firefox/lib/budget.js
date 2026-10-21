(function (root) {
  "use strict";

  var protocol = root.LB && root.LB.protocol;
  var defaults = protocol ? protocol.DEFAULTS : {};
  var GRACE_MS = 5000;
  var DEFAULT_CALL_MS = typeof defaults.callTimeoutMs === "number" ? defaults.callTimeoutMs : 30000;
  var LONG_CALL_MS = 60000;
  var MAX_TIMEOUT_MS = 120000;
  var MAX_TOOL_TIMEOUT_MS = 60000;
  var NAVIGATE_MS = typeof defaults.navigateTimeoutMs === "number" ? defaults.navigateTimeoutMs : 15000;
  var WAIT_MS = typeof defaults.waitTimeoutMs === "number" ? defaults.waitTimeoutMs : 10000;

  function clampInt(value, fallback, min, max) {
    var number = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
    if (number < min) return min;
    if (number > max) return max;
    return number;
  }

  function budgetFor(tool, args) {
    var options = args || {};
    if (tool === "local_browser_navigate") return clampInt(options.timeoutMs, NAVIGATE_MS, 100, MAX_TIMEOUT_MS) + GRACE_MS;
    if (tool === "local_browser_wait") return clampInt(options.timeoutMs, WAIT_MS, 100, MAX_TIMEOUT_MS) + GRACE_MS;
    if (tool === "local_browser_evaluate") return clampInt(options.timeoutMs, DEFAULT_CALL_MS, 100, MAX_TOOL_TIMEOUT_MS) + GRACE_MS;
    if (tool === "local_browser_act") return clampInt(options.timeoutMs, DEFAULT_CALL_MS, 100, MAX_TOOL_TIMEOUT_MS) + GRACE_MS;
    if (tool === "local_browser_network") return LONG_CALL_MS;
    if (tool === "local_browser_upload") return LONG_CALL_MS;
    if (tool === "local_browser_download") return LONG_CALL_MS;
    return DEFAULT_CALL_MS;
  }

  root.LB = root.LB || {};
  root.LB.budget = {
    GRACE_MS: GRACE_MS,
    DEFAULT_CALL_MS: DEFAULT_CALL_MS,
    LONG_CALL_MS: LONG_CALL_MS,
    budgetFor: budgetFor
  };
})(globalThis);
