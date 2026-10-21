(function (root) {
  "use strict";

  var CALL_GRACE_MS = 5000;
  var LONG_CALL_MS = 60000;
  var MAX_CALL_MS = 120000;
  var MAX_TOOL_CALL_MS = 60000;
  var DEFAULT_NAVIGATE_MS = 15000;
  var DEFAULT_WAIT_MS = 10000;
  var DEFAULT_CALL_MS = 30000;

  var LONG_CALL_TOOLS = { local_browser_network: true, local_browser_upload: true, local_browser_download: true };
  var TOOL_CALL_TOOLS = { local_browser_act: true, local_browser_evaluate: true };

  function clampInt(value, fallback, min, max) {
    var number = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
    if (number < min) return min;
    if (number > max) return max;
    return number;
  }

  function callBudget(tool, args) {
    var options = args && typeof args === "object" ? args : {};
    var requested = options.timeoutMs;
    if (tool === "local_browser_navigate") {
      return clampInt(requested, DEFAULT_NAVIGATE_MS, 100, MAX_CALL_MS) + CALL_GRACE_MS;
    }
    if (tool === "local_browser_wait") {
      return clampInt(requested, DEFAULT_WAIT_MS, 100, MAX_CALL_MS) + CALL_GRACE_MS;
    }
    if (TOOL_CALL_TOOLS[tool] === true) {
      return clampInt(requested, DEFAULT_CALL_MS, 100, MAX_TOOL_CALL_MS) + CALL_GRACE_MS;
    }
    if (LONG_CALL_TOOLS[tool] === true) return LONG_CALL_MS;
    return DEFAULT_CALL_MS;
  }

  root.LB = root.LB || {};
  function longCallTools() {
    return Object.keys(LONG_CALL_TOOLS);
  }

  function toolCallTools() {
    return Object.keys(TOOL_CALL_TOOLS);
  }

  root.LB.budget = {
    callBudget: callBudget,
    longCallTools: longCallTools,
    toolCallTools: toolCallTools,
    clampInt: clampInt,
    CALL_GRACE_MS: CALL_GRACE_MS,
    LONG_CALL_MS: LONG_CALL_MS,
    MAX_CALL_MS: MAX_CALL_MS,
    MAX_TOOL_CALL_MS: MAX_TOOL_CALL_MS,
    DEFAULT_NAVIGATE_MS: DEFAULT_NAVIGATE_MS,
    DEFAULT_WAIT_MS: DEFAULT_WAIT_MS,
    DEFAULT_CALL_MS: DEFAULT_CALL_MS
  };
})(globalThis);
