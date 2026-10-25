(function (root) {
  "use strict";

  var CALL_GRACE_MS = 5000;
  var LONG_CALL_MS = 60000;
  var MAX_CALL_MS = 120000;
  var MAX_TOOL_CALL_MS = 60000;
  var DEFAULT_NAVIGATE_MS = 15000;
  var DEFAULT_WAIT_MS = 10000;
  var DEFAULT_CALL_MS = 30000;
  var DEFAULT_MARGIN_MS = 1000;
  var INNER_SLACK_MS = 250;
  var MIN_INNER_MS = 100;

  var LONG_CALL_TOOLS = { local_browser_network: true, local_browser_upload: true, local_browser_download: true };
  var TOOL_CALL_TOOLS = { local_browser_act: true, local_browser_evaluate: true };

  function clampInt(value, fallback, min, max) {
    var number = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
    if (number < min) return min;
    if (number > max) return max;
    return number;
  }

  function marginMs() {
    var contract = root.LB && root.LB.contract;
    var value = contract && contract.callDefaults ? contract.callDefaults.extensionBudgetMarginMs : undefined;
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : DEFAULT_MARGIN_MS;
  }

  function serverBudget(budgetMs) {
    if (typeof budgetMs !== "number" || !Number.isFinite(budgetMs) || budgetMs <= 0) return null;
    return Math.max(1, Math.floor(budgetMs) - marginMs());
  }

  function legacyBudget(tool, args) {
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

  function callBudget(tool, args, budgetMs) {
    var fromServer = serverBudget(budgetMs);
    return fromServer === null ? legacyBudget(tool, args) : fromServer;
  }

  function innerTimeout(requested, fallback, budget, legacyMax) {
    var wanted = typeof requested === "number" && Number.isFinite(requested) ? Math.floor(requested) : fallback;
    if (wanted < MIN_INNER_MS) wanted = MIN_INNER_MS;
    if (typeof budget === "number" && Number.isFinite(budget)) {
      return Math.max(MIN_INNER_MS, Math.min(wanted, budget - INNER_SLACK_MS));
    }
    return typeof legacyMax === "number" ? Math.min(wanted, legacyMax) : wanted;
  }

  function longCallTools() {
    return Object.keys(LONG_CALL_TOOLS);
  }

  function toolCallTools() {
    return Object.keys(TOOL_CALL_TOOLS);
  }

  root.LB = root.LB || {};
  root.LB.budget = {
    callBudget: callBudget,
    serverBudget: serverBudget,
    innerTimeout: innerTimeout,
    marginMs: marginMs,
    longCallTools: longCallTools,
    toolCallTools: toolCallTools,
    clampInt: clampInt,
    CALL_GRACE_MS: CALL_GRACE_MS,
    LONG_CALL_MS: LONG_CALL_MS,
    MAX_CALL_MS: MAX_CALL_MS,
    MAX_TOOL_CALL_MS: MAX_TOOL_CALL_MS,
    DEFAULT_NAVIGATE_MS: DEFAULT_NAVIGATE_MS,
    DEFAULT_WAIT_MS: DEFAULT_WAIT_MS,
    DEFAULT_CALL_MS: DEFAULT_CALL_MS,
    INNER_SLACK_MS: INNER_SLACK_MS
  };
})(globalThis);
