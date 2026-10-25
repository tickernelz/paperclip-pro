(function (root) {
  "use strict";

  var PATH = /^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)+$/;
  var STORAGE_REFUSAL = {
    message: "is private to the extension because it holds the pairing secret.",
    hint: "Use local_browser_storage for page storage and cookies."
  };
  var INJECTION_REFUSAL = {
    message: "injects code into pages or reaches the extension's own runtime, so agents cannot call it.",
    hint: "Use local_browser_evaluate to run code in a page"
  };
  var BLOCKED = [
    { name: "storage", refusal: STORAGE_REFUSAL },
    { name: "scripting", refusal: INJECTION_REFUSAL },
    { name: "contentScripts", refusal: INJECTION_REFUSAL },
    { name: "userScripts", refusal: INJECTION_REFUSAL },
    { name: "runtime", refusal: INJECTION_REFUSAL },
    { name: "extension", refusal: INJECTION_REFUSAL },
    { name: "tabs.executeScript", refusal: INJECTION_REFUSAL }
  ];
  var MAX_ARGS = 20;
  var MAX_DEPTH = 64;
  var MAX_NODES = 200000;
  var TOOL = "local_browser_api";

  function fail(code, message, extra) {
    return Object.assign({ code: code, message: message }, extra || {});
  }

  function catalogIds() {
    var contract = root.LB.contract || {};
    var list = Array.isArray(contract.permissions) ? contract.permissions : [];
    return list.filter(function (item) { return item && item.kind === "api"; }).map(function (item) { return item.id; });
  }

  function permissionFor(path) {
    if (typeof path !== "string") return null;
    var segments = path.split(".");
    var ids = catalogIds();
    var pair = segments.slice(0, 2).join(".");
    if (ids.indexOf(pair) !== -1) return pair;
    return ids.indexOf(segments[0]) !== -1 ? segments[0] : null;
  }

  function refusalFor(path) {
    if (typeof path !== "string") return null;
    var segments = path.toLowerCase().split(".").map(function (segment) { return segment.trim(); });
    for (var index = 0; index < BLOCKED.length; index += 1) {
      var blocked = BLOCKED[index].name.toLowerCase().split(".");
      if (segments.slice(0, blocked.length).join(".") === blocked.join(".")) return BLOCKED[index];
    }
    return null;
  }

  function isBlocked(path) {
    return refusalFor(path) !== null;
  }

  function serialize(input, options) {
    var opts = options || {};
    var maxDepth = typeof opts.maxDepth === "number" ? opts.maxDepth : MAX_DEPTH;
    var budget = typeof opts.maxNodes === "number" ? opts.maxNodes : MAX_NODES;
    var ancestors = [];

    function walk(value, depth) {
      budget -= 1;
      if (budget < 0) return "[Truncated]";
      if (value === null || value === undefined) return null;
      var kind = typeof value;
      if (kind === "string" || kind === "boolean") return value;
      if (kind === "number") return Number.isFinite(value) ? value : String(value);
      if (kind === "bigint" || kind === "symbol") return String(value);
      if (kind === "function") return "[Function " + (value.name || "anonymous") + "]";
      if (depth >= maxDepth) return "[MaxDepth]";
      if (ancestors.indexOf(value) !== -1) return "[Circular]";
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
      if (value instanceof RegExp) return String(value);
      if (value instanceof Error) return { name: value.name, message: value.message };
      ancestors.push(value);
      try {
        if (value instanceof Map) {
          var pairs = [];
          value.forEach(function (entry, key) { pairs.push([walk(key, depth + 1), walk(entry, depth + 1)]); });
          return pairs;
        }
        if (value instanceof Set) {
          var items = [];
          value.forEach(function (entry) { items.push(walk(entry, depth + 1)); });
          return items;
        }
        if (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) return walk(new Uint8Array(value), depth);
        if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(value)) {
          if (typeof DataView !== "undefined" && value instanceof DataView) return walk(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), depth);
          var numbers = [];
          for (var cursor = 0; cursor < value.length; cursor += 1) {
            budget -= 1;
            if (budget < 0) {
              numbers.push("[Truncated]");
              break;
            }
            numbers.push(Number(value[cursor]));
          }
          return numbers;
        }
        if (Array.isArray(value)) {
          var out = [];
          for (var index = 0; index < value.length; index += 1) {
            if (budget < 0) {
              out.push("[Truncated]");
              break;
            }
            out.push(walk(value[index], depth + 1));
          }
          return out;
        }
        var record = {};
        var keys = Object.keys(value);
        for (var position = 0; position < keys.length; position += 1) {
          if (budget < 0) {
            record["[Truncated]"] = true;
            break;
          }
          var field;
          try {
            field = value[keys[position]];
          } catch (error) {
            field = "[Unreadable]";
          }
          if (field === undefined) continue;
          record[keys[position]] = walk(field, depth + 1);
        }
        return record;
      } finally {
        ancestors.pop();
      }
    }

    return { value: walk(input, 0), type: typeof input };
  }

  function ensurePermission(permission, access, reason) {
    if (!permission || !access || typeof access.ensure !== "function") return Promise.resolve();
    if (typeof access.availability === "function" && access.availability(permission) === "unsupported") return Promise.resolve();
    return access.ensure([permission], { tool: TOOL, reason: reason });
  }

  function invoke(base, path, args, options) {
    var opts = options || {};
    var access = opts.access !== undefined ? opts.access : root.LB.access;
    var blocked = refusalFor(path);
    if (blocked) {
      return Promise.reject(fail("local_browser_unsupported", "browser." + blocked.name + " " + blocked.refusal.message, {
        hint: blocked.refusal.hint
      }));
    }
    if (typeof path !== "string" || !PATH.test(path)) {
      return Promise.reject(fail("local_browser_protocol_error", "path must look like namespace.method, for example history.search."));
    }
    var list = args === undefined || args === null ? [] : args;
    if (!Array.isArray(list)) return Promise.reject(fail("local_browser_protocol_error", "args must be an array."));
    if (list.length > MAX_ARGS) return Promise.reject(fail("local_browser_protocol_error", "args takes at most " + MAX_ARGS + " items."));
    var permission = permissionFor(path);
    var reason = typeof opts.reason === "string" ? opts.reason : "An agent called browser." + path + ".";
    return ensurePermission(permission, access, reason).then(function () {
      var segments = path.split(".");
      var parent = null;
      var target = base;
      for (var index = 0; index < segments.length; index += 1) {
        if (target === null || target === undefined || (typeof target !== "object" && typeof target !== "function")) target = undefined;
        else {
          parent = target;
          target = target[segments[index]];
        }
        if (target === undefined) {
          var missing = segments.slice(0, index + 1).join(".");
          throw fail("local_browser_unsupported", "browser." + missing + " is not available in this browser.", permission ? {
            hint: "The " + permission + " permission is granted; reload the extension if the API still does not appear."
          } : { hint: "Check the API name against the browser's extension API reference." });
        }
      }
      if (typeof target !== "function") {
        if (list.length) throw fail("local_browser_protocol_error", "browser." + path + " is not a function; drop args to read it.");
        return serialize(target, opts);
      }
      return Promise.resolve()
        .then(function () { return target.apply(parent, list); })
        .then(
          function (value) { return serialize(value, opts); },
          function (error) {
            if (error && typeof error === "object" && typeof error.code === "string" && error.code.indexOf("local_browser_") === 0) throw error;
            var message = error && error.message ? error.message : String(error);
            throw fail("local_browser_protocol_error", "browser." + path + " failed: " + message);
          }
        );
    });
  }

  root.LB = root.LB || {};
  root.LB.apiCall = {
    PATH: PATH,
    MAX_ARGS: MAX_ARGS,
    permissionFor: permissionFor,
    isBlocked: isBlocked,
    serialize: serialize,
    invoke: invoke
  };
})(globalThis);
