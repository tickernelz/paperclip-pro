(function (root) {
  "use strict";

  var PROTOCOL_VERSION = 1;
  var CLIENT = "firefox";
  var BRIDGE_PATH = "/api/local-browser/bridge";
  var STORAGE_PAIRING = "lb.pairing";
  var STORAGE_BIDI = "lb.bidi";
  var DEFAULT_BIDI_PORT = 9222;
  var DEFAULT_LABEL = "Firefox";
  var CURSOR_PATTERN = /^\d+$/;

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

  var CAPABILITIES = Object.freeze([
    "cookies.v2",
    "permissions.v1",
    "context.v1",
    "network.headers",
    "tabs.container",
    "document.state",
    "api.v1",
    "act.force",
    "budget.v1",
    "act.input"
  ]);

  var DEFAULTS = Object.freeze({
    callTimeoutMs: 30000,
    snapshotNodes: 120,
    textChars: 8000,
    viewerIntervalMs: 1000,
    viewerMinIntervalMs: 500,
    waitTimeoutMs: 10000,
    navigateTimeoutMs: 15000,
    budgetMarginMs: 1000,
    networkLimit: 200,
    networkBodyBytes: 1048576,
    screenshotJpegAboveBytes: 2097152,
    canvasMaxPixels: 32767,
    heartbeatMs: 25000,
    heartbeatTimeoutMs: 75000
  });

  var INTERNAL_TOOLS = Object.freeze(["local_browser_viewer", "local_browser_input", "local_browser_ui"]);

  var AGENT_TOOLS = Object.freeze([
    "local_browser_sessions",
    "local_browser_open",
    "local_browser_navigate",
    "local_browser_snapshot",
    "local_browser_act",
    "local_browser_read",
    "local_browser_screenshot",
    "local_browser_wait",
    "local_browser_evaluate",
    "local_browser_storage",
    "local_browser_network",
    "local_browser_upload",
    "local_browser_download",
    "local_browser_close",
    "local_browser_context",
    "local_browser_permissions",
    "local_browser_api"
  ]);

  function originOf(rawUrl) {
    try {
      var parsed = new URL(String(rawUrl));
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
      return parsed.origin;
    } catch (error) {
      return null;
    }
  }

  function socketOrigin(origin) {
    var parsed;
    try {
      parsed = new URL(String(origin));
    } catch (error) {
      return null;
    }
    if (parsed.protocol === "https:") return "wss://" + parsed.host;
    if (parsed.protocol === "http:") return "ws://" + parsed.host;
    return null;
  }

  function bridgeUrl(origin, query) {
    var socket = socketOrigin(origin);
    if (!socket) return null;
    var params = new URLSearchParams();
    var keys = Object.keys(query || {});
    for (var i = 0; i < keys.length; i += 1) {
      var value = query[keys[i]];
      if (value === undefined || value === null || value === "") continue;
      params.set(keys[i], String(value));
    }
    var suffix = params.toString();
    return socket + BRIDGE_PATH + (suffix ? "?" + suffix : "");
  }

  function error(code, message, hintOrExtra, retryable) {
    var payload = { code: code, message: message };
    var extra = hintOrExtra && typeof hintOrExtra === "object" ? hintOrExtra : null;
    var hint = extra ? extra.hint : typeof hintOrExtra === "string" ? hintOrExtra : null;
    if (typeof hint === "string" && hint) payload.hint = hint;
    var canRetry = extra ? extra.retryable : retryable;
    if (typeof canRetry === "boolean") payload.retryable = canRetry;
    if (extra && Array.isArray(extra.permissions) && extra.permissions.length) payload.permissions = extra.permissions.slice();
    return payload;
  }

  root.LB = root.LB || {};
  root.LB.protocol = {
    PROTOCOL_VERSION: PROTOCOL_VERSION,
    CLIENT: CLIENT,
    BRIDGE_PATH: BRIDGE_PATH,
    STORAGE_PAIRING: STORAGE_PAIRING,
    STORAGE_BIDI: STORAGE_BIDI,
    DEFAULT_BIDI_PORT: DEFAULT_BIDI_PORT,
    DEFAULT_LABEL: DEFAULT_LABEL,
    CURSOR_PATTERN: CURSOR_PATTERN,
    ERROR_CODES: ERROR_CODES,
    DEFAULTS: DEFAULTS,
    CAPABILITIES: CAPABILITIES,
    INTERNAL_TOOLS: INTERNAL_TOOLS,
    AGENT_TOOLS: AGENT_TOOLS,
    originOf: originOf,
    socketOrigin: socketOrigin,
    bridgeUrl: bridgeUrl,
    error: error
  };
})(globalThis);
