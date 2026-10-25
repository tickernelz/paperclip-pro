(function (root) {
  "use strict";

  var PROTOCOL_VERSION = 1;
  var CLIENT = "chromium";
  var BRIDGE_PATH = "/api/local-browser/bridge";

  var ERROR_CODES = Object.freeze({
    notPaired: "local_browser_not_paired",
    extensionUnavailable: "local_browser_extension_unavailable",
    originDenied: "local_browser_origin_denied",
    tierDenied: "local_browser_tier_denied",
    tabMissing: "local_browser_tab_missing",
    refStale: "local_browser_ref_stale",
    elementMissing: "local_browser_element_missing",
    timeout: "local_browser_timeout",
    navigationBlocked: "local_browser_navigation_blocked",
    protocolError: "local_browser_protocol_error",
    resultTooLarge: "local_browser_result_too_large",
    unsupported: "local_browser_unsupported",
    permissionRequired: "local_browser_permission_required"
  });

  var DEFAULTS = Object.freeze({
    callTimeoutMs: 30000,
    snapshotNodes: 120,
    textChars: 8000,
    viewerIntervalMs: 1000,
    budgetMarginMs: 1000,
    waitTimeoutMs: 10000,
    navigateTimeoutMs: 15000
  });

  var FULL_TIER_TOOLS = Object.freeze([
    "local_browser_evaluate",
    "local_browser_storage",
    "local_browser_network",
    "local_browser_upload",
    "local_browser_download",
    "local_browser_api"
  ]);

  var INTERNAL_TOOLS = Object.freeze(["local_browser_viewer", "local_browser_input", "local_browser_ui"]);

  root.LB = root.LB || {};
  root.LB.protocol = {
    PROTOCOL_VERSION: PROTOCOL_VERSION,
    CLIENT: CLIENT,
    BRIDGE_PATH: BRIDGE_PATH,
    ERROR_CODES: ERROR_CODES,
    DEFAULTS: DEFAULTS,
    FULL_TIER_TOOLS: FULL_TIER_TOOLS,
    INTERNAL_TOOLS: INTERNAL_TOOLS
  };
})(globalThis);
