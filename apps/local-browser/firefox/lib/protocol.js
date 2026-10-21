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
    unsupported: "local_browser_unsupported"
  });

  var DEFAULTS = Object.freeze({
    callTimeoutMs: 30000,
    snapshotNodes: 120,
    snapshotMaxNodes: 400,
    textChars: 8000,
    textMaxChars: 40000,
    screenshotMaxBytes: 2 * 1024 * 1024,
    viewerIntervalMs: 1000,
    viewerMinIntervalMs: 500,
    waitTimeoutMs: 10000,
    navigateTimeoutMs: 15000,
    networkLimit: 50,
    networkMaxLimit: 200,
    networkBodyBytes: 65536,
    downloadMaxBytes: 2 * 1024 * 1024,
    heartbeatMs: 25000,
    heartbeatTimeoutMs: 75000
  });

  var FULL_TIER_TOOLS = Object.freeze([
    "local_browser_evaluate",
    "local_browser_storage",
    "local_browser_network",
    "local_browser_upload",
    "local_browser_download"
  ]);

  var INTERNAL_TOOLS = Object.freeze(["local_browser_viewer", "local_browser_input"]);

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
    "local_browser_close"
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

  function originAllowed(tier, allowedOrigins, rawUrl) {
    if (tier === "full") return true;
    var origin = originOf(rawUrl);
    if (!origin) return false;
    var rules = Array.isArray(allowedOrigins) ? allowedOrigins : [];
    var host = new URL(origin).host.toLowerCase();
    for (var i = 0; i < rules.length; i += 1) {
      var rule = String(rules[i] || "").trim().toLowerCase();
      if (!rule) continue;
      if (rule === "*") return true;
      if (rule.indexOf("*.") === 0) {
        var suffix = rule.slice(1);
        if (host.slice(-suffix.length) === suffix || host === suffix.slice(1)) return true;
        continue;
      }
      var normalized = originOf(rule) || rule;
      if (normalized === origin.toLowerCase()) return true;
    }
    return false;
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
    return payload;
  }

  function requiresFullTier(tool) {
    return FULL_TIER_TOOLS.indexOf(tool) !== -1;
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
    FULL_TIER_TOOLS: FULL_TIER_TOOLS,
    INTERNAL_TOOLS: INTERNAL_TOOLS,
    AGENT_TOOLS: AGENT_TOOLS,
    originOf: originOf,
    originAllowed: originAllowed,
    socketOrigin: socketOrigin,
    bridgeUrl: bridgeUrl,
    error: error,
    requiresFullTier: requiresFullTier
  };
})(globalThis);
