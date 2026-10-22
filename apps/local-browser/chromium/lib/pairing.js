(function (root) {
  "use strict";

  var BRIDGE_PATH = "/api/local-browser/bridge";
  var CODE = /^[A-Za-z0-9]{4,32}$/;
  var HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
  var LOCAL_HOSTS = { localhost: true, "127.0.0.1": true, "0.0.0.0": true, "::1": true };
  var SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//;

  function splitHost(value) {
    var hostPart = String(value || "").split("/")[0].toLowerCase();
    var port = "";
    var hostname = hostPart;
    var colon = hostPart.lastIndexOf(":");
    if (colon > -1 && !hostPart.startsWith("[")) {
      hostname = hostPart.slice(0, colon);
      port = hostPart.slice(colon + 1);
      if (!/^[0-9]{1,5}$/.test(port)) return null;
    }
    if (!hostname || !HOST.test(hostname)) return null;
    return { hostname: hostname, hostPart: port ? hostname + ":" + port : hostname };
  }

  function normalizeOrigin(raw) {
    var value = String(raw == null ? "" : raw).trim().replace(/[?#].*$/, "").replace(/\/+$/, "");
    if (!value) return null;
    var scheme = SCHEME.exec(value);
    if (scheme) {
      var name = scheme[1].toLowerCase();
      if (name !== "http" && name !== "https" && name !== "ws" && name !== "wss") return null;
      var rest = value.slice(scheme[0].length);
      var parsed = splitHost(rest);
      if (!parsed) return null;
      var secure = name === "https" || name === "wss";
      return (secure ? "https://" : "http://") + parsed.hostPart;
    }
    var plain = splitHost(value);
    if (!plain) return null;
    return (LOCAL_HOSTS[plain.hostname] ? "http://" : "https://") + plain.hostPart;
  }

  function codeFrom(value) {
    var text = String(value == null ? "" : value).trim();
    return CODE.test(text) ? text : null;
  }

  function readCode(text) {
    var direct = codeFrom(text);
    if (direct) return direct;
    var query = /[?&](?:code|pairing)=([A-Za-z0-9]{4,32})(?:[&#]|$)/.exec(text);
    return query ? query[1] : null;
  }

  function parsePairingInput(raw) {
    var text = String(raw == null ? "" : raw).trim();
    if (!text) return { origin: null, code: null, needsCode: false, reason: "Paste the pairing link from Paperclip" };
    var bare = codeFrom(text);
    if (bare) return { origin: null, code: bare, needsCode: false, reason: null };
    var code = readCode(text);
    var originPart = text.replace(/[?#].*$/, "");
    var origin = normalizeOrigin(originPart);
    if (code && origin) return { origin: origin, code: code, needsCode: false, reason: null };
    if (code && !origin) return { origin: null, code: code, needsCode: false, reason: null };
    if (origin) return { origin: origin, code: null, needsCode: true, reason: null };
    if (SCHEME.test(text)) return { origin: null, code: null, needsCode: false, reason: "Use an http or https address, not " + text.split(":")[0] + ":" };
    return { origin: null, code: null, needsCode: false, reason: "That does not look like a pairing link or code" };
  }

  function pairUrl(origin, code) {
    var normalized = normalizeOrigin(origin);
    var valid = codeFrom(code);
    if (!normalized || !valid) return null;
    return normalized.replace(/^http/, "ws") + BRIDGE_PATH + "?code=" + encodeURIComponent(valid);
  }

  root.LB = root.LB || {};
  root.LB.pairing = {
    normalizeOrigin: normalizeOrigin,
    parsePairingInput: parsePairingInput,
    pairUrl: pairUrl,
    BRIDGE_PATH: BRIDGE_PATH
  };
})(globalThis);
