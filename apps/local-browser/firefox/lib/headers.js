(function (root) {
  "use strict";

  function decodeBinary(bytes) {
    if (!bytes) return "";
    var list = Array.isArray(bytes) ? bytes : Array.prototype.slice.call(bytes);
    var out = "";
    for (var index = 0; index < list.length; index += 1) out += String.fromCharCode(list[index] & 255);
    return out;
  }

  function add(record, name, value) {
    if (typeof name !== "string" || !name) return;
    var key = name.toLowerCase();
    var text = value === undefined || value === null ? "" : String(value);
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      record[key] = record[key] + (key === "set-cookie" ? "\n" : ", ") + text;
    } else {
      record[key] = text;
    }
  }

  function normalize(input) {
    var record = {};
    if (!input) return record;
    if (Array.isArray(input)) {
      for (var index = 0; index < input.length; index += 1) {
        var header = input[index];
        if (Array.isArray(header)) add(record, header[0], header[1]);
        else if (header && typeof header === "object") add(record, header.name, header.value !== undefined ? header.value : decodeBinary(header.binaryValue));
      }
      return record;
    }
    if (typeof input.forEach === "function" && typeof input.get === "function") {
      input.forEach(function (value, name) { add(record, name, value); });
      return record;
    }
    if (typeof input === "object") {
      Object.keys(input).forEach(function (name) {
        var value = input[name];
        if (Array.isArray(value)) value.forEach(function (part) { add(record, name, part); });
        else add(record, name, value);
      });
    }
    return record;
  }

  function present(record, name) {
    return Object.prototype.hasOwnProperty.call(record, name) && record[name] !== "";
  }

  function hasCookie(headers) {
    return present(normalize(headers), "cookie");
  }

  function hasAuthorization(headers) {
    var record = normalize(headers);
    return present(record, "authorization") || present(record, "proxy-authorization");
  }

  function summarize(requestHeaders) {
    var record = normalize(requestHeaders);
    return {
      requestHeaders: record,
      hasCookie: present(record, "cookie"),
      hasAuthorization: present(record, "authorization") || present(record, "proxy-authorization")
    };
  }

  root.LB = root.LB || {};
  root.LB.headers = {
    normalize: normalize,
    hasCookie: hasCookie,
    hasAuthorization: hasAuthorization,
    summarize: summarize
  };
})(globalThis);
