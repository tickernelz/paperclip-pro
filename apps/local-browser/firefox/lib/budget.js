(function (root) {
  "use strict";

  var protocol = root.LB && root.LB.protocol;
  var defaults = protocol ? protocol.DEFAULTS : {};
  var GRACE_MS = 5000;
  var LONG_CALL_MS = 60000;
  var MIN_BUDGET_MS = 250;
  var INNER_RESERVE_MS = 500;
  var MIN_TIMEOUT_MS = 100;
  var MARGIN_MS = positive(defaults.budgetMarginMs, 1000);
  var DEFAULT_CALL_MS = positive(defaults.callTimeoutMs, 30000);
  var NAVIGATE_MS = positive(defaults.navigateTimeoutMs, 15000);
  var WAIT_MS = positive(defaults.waitTimeoutMs, 10000);

  function positive(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  }

  function requested(value, fallback) {
    return Math.max(MIN_TIMEOUT_MS, positive(value, fallback));
  }

  function staticBudget(tool, options) {
    if (tool === "local_browser_navigate") return requested(options.timeoutMs, NAVIGATE_MS) + GRACE_MS;
    if (tool === "local_browser_wait") return requested(options.timeoutMs, WAIT_MS) + GRACE_MS;
    if (tool === "local_browser_evaluate" || tool === "local_browser_act") return requested(options.timeoutMs, DEFAULT_CALL_MS) + GRACE_MS;
    if (tool === "local_browser_network" || tool === "local_browser_upload" || tool === "local_browser_download") return LONG_CALL_MS;
    return DEFAULT_CALL_MS;
  }

  function budgetFor(tool, args, serverBudgetMs) {
    if (typeof serverBudgetMs === "number" && Number.isFinite(serverBudgetMs) && serverBudgetMs > 0) {
      return Math.max(MIN_BUDGET_MS, Math.floor(serverBudgetMs) - MARGIN_MS);
    }
    return staticBudget(tool, args || {});
  }

  function innerTimeout(value, fallback, budgetMs) {
    var wanted = requested(value, fallback);
    if (typeof budgetMs !== "number" || !Number.isFinite(budgetMs)) return wanted;
    return Math.max(MIN_TIMEOUT_MS, Math.min(wanted, Math.floor(budgetMs) - INNER_RESERVE_MS));
  }

  root.LB = root.LB || {};
  root.LB.budget = {
    GRACE_MS: GRACE_MS,
    MARGIN_MS: MARGIN_MS,
    DEFAULT_CALL_MS: DEFAULT_CALL_MS,
    LONG_CALL_MS: LONG_CALL_MS,
    MIN_BUDGET_MS: MIN_BUDGET_MS,
    INNER_RESERVE_MS: INNER_RESERVE_MS,
    budgetFor: budgetFor,
    innerTimeout: innerTimeout
  };
})(globalThis);
