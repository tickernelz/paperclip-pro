(function (root) {
  "use strict";

  var LB = root.LB;
  var ERROR = LB.protocol.ERROR_CODES;
  var CODE_PREFIX = /^local_browser_/;
  var CONTENT_FILES = [
    "lib/protocol.js",
    "lib/text.js",
    "lib/refmap.js",
    "lib/cursor.js",
    "lib/snapshot.js",
    "lib/markdown.js",
    "lib/dom-adapter.js",
    "lib/document-state.js",
    "lib/hit.js",
    "content.js"
  ];

  class ToolFailure extends Error {
    constructor(code, message, hint, retryable, permissions) {
      super(message);
      this.code = code;
      this.hint = hint;
      this.retryable = retryable;
      if (Array.isArray(permissions)) this.permissions = permissions;
    }
  }

  function toolError(code, message, hint, retryable, permissions) {
    var error = { code: code, message: message };
    if (hint) error.hint = hint;
    if (typeof retryable === "boolean") error.retryable = retryable;
    if (Array.isArray(permissions) && permissions.length) error.permissions = permissions.slice();
    return error;
  }

  function siteAccessDenied(message) {
    return /cannot access contents of|missing host permission|no host permissions for cookies|extension manifest must request permission|Cannot access a chrome-extension|not allowed to access|cannot be scripted/i.test(
      message
    );
  }

  function knownCode(error) {
    return Boolean(error && typeof error === "object" && typeof error.code === "string" && CODE_PREFIX.test(error.code));
  }

  function messageOf(error) {
    if (error && typeof error === "object" && typeof error.message === "string" && error.message) return error.message;
    return String(error || "Unknown browser error");
  }

  function toToolError(error) {
    var message = messageOf(error);
    if (knownCode(error) && error.code === ERROR.permissionRequired) {
      return toolError(error.code, message, error.hint, error.retryable !== false, error.permissions);
    }
    if (siteAccessDenied(message)) {
      return toolError(
        ERROR.originDenied,
        "This browser blocks the extension from that page, so nothing was read or changed",
        "Grant site access in the Paperclip Local Browser extension (Allow all), or open a regular website, then retry",
        true
      );
    }
    if (knownCode(error)) return toolError(error.code, message, error.hint, error.retryable, error.permissions);
    return toolError(ERROR.protocolError, message, undefined, true);
  }

  function fromContentError(error) {
    if (!error || typeof error !== "object") {
      return new ToolFailure(ERROR.protocolError, "The page returned an unreadable error");
    }
    return new ToolFailure(error.code || ERROR.protocolError, error.message || "The page refused the call", error.hint, error.retryable);
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function clampInt(value, fallback, min, max) {
    var number = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
    if (number < min) return min;
    if (number > max) return max;
    return number;
  }

  function originOf(rawUrl) {
    try {
      return new URL(rawUrl).origin;
    } catch (error) {
      return null;
    }
  }

  function defaultLabel() {
    var agent = (root.navigator && root.navigator.userAgent) || "";
    if (agent.includes("Edg/")) return "Edge";
    if (agent.includes("OPR/")) return "Opera";
    return "Chrome";
  }

  function isNoReceiver(error) {
    var message = String((error && error.message) || error || "");
    return message.includes("Receiving end does not exist") || message.includes("Could not establish connection");
  }

  function toBase64(buffer) {
    var bytes = new Uint8Array(buffer);
    var binary = "";
    var chunk = 0x8000;
    for (var index = 0; index < bytes.length; index += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
    }
    return btoa(binary);
  }

  async function blobToDataUrl(blob) {
    var buffer = await blob.arrayBuffer();
    return "data:" + (blob.type || "application/octet-stream") + ";base64," + toBase64(buffer);
  }

  function withTimeout(promise, timeoutMs, message) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new ToolFailure(ERROR.timeout, message || "The browser did not answer in " + timeoutMs + " ms", "Retry, or reload the tab", true));
      }, timeoutMs);
      promise.then(
        function (value) {
          clearTimeout(timer);
          resolve(value);
        },
        function (error) {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  LB.bg = LB.bg || {};
  LB.bg.core = {
    ERROR: ERROR,
    DEFAULTS: LB.protocol.DEFAULTS,
    CONTENT_FILES: CONTENT_FILES,
    ToolFailure: ToolFailure,
    toolError: toolError,
    toToolError: toToolError,
    fromContentError: fromContentError,
    siteAccessDenied: siteAccessDenied,
    sleep: sleep,
    messageOf: messageOf,
    clampInt: clampInt,
    originOf: originOf,
    defaultLabel: defaultLabel,
    isNoReceiver: isNoReceiver,
    toBase64: toBase64,
    blobToDataUrl: blobToDataUrl,
    withTimeout: withTimeout
  };
})(globalThis);
