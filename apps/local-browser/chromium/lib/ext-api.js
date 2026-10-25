(function (root) {
  "use strict";

  var ALL_URLS = "<all_urls>";

  function api() {
    return root.browser || root.chrome || null;
  }

  function manifest() {
    var current = api();
    try {
      return current && current.runtime && typeof current.runtime.getManifest === "function" ? current.runtime.getManifest() || {} : {};
    } catch (error) {
      return {};
    }
  }

  function client() {
    var meta = manifest();
    var gecko = (meta.browser_specific_settings && meta.browser_specific_settings.gecko) || (meta.applications && meta.applications.gecko);
    if (gecko) return "firefox";
    var current = api();
    var base = "";
    try {
      base = current && current.runtime && typeof current.runtime.getURL === "function" ? current.runtime.getURL("") : "";
    } catch (error) {
      base = "";
    }
    if (base.indexOf("moz-extension:") === 0) return "firefox";
    if (base) return "chromium";
    return root.browser ? "firefox" : "chromium";
  }

  function version() {
    return typeof manifest().version === "string" ? manifest().version : "";
  }

  function action() {
    var current = api();
    if (!current) return null;
    return current.action || current.browserAction || null;
  }

  function isOrigin(entry) {
    return entry === ALL_URLS || /^[a-z*]+:\/\//.test(entry);
  }

  function toCatalogIds(list) {
    var ids = [];
    for (var index = 0; index < (Array.isArray(list) ? list.length : 0); index += 1) {
      var entry = list[index];
      if (typeof entry !== "string") continue;
      var id = isOrigin(entry) ? (entry === ALL_URLS || entry === "*://*/*" ? ALL_URLS : null) : entry;
      if (id && ids.indexOf(id) === -1) ids.push(id);
    }
    return ids;
  }

  function declared() {
    var meta = manifest();
    var required = toCatalogIds((meta.permissions || []).concat(meta.host_permissions || []));
    var optional = toCatalogIds((meta.optional_permissions || []).concat(meta.optional_host_permissions || []));
    return { required: required, optional: optional.filter(function (id) { return required.indexOf(id) === -1; }) };
  }

  function pageUrl(file, section) {
    var current = api();
    var hash = section ? "#" + String(section).replace(/^#/, "") : "";
    return current.runtime.getURL(file) + hash;
  }

  function openControlCenter(section) {
    var current = api();
    var url = pageUrl("ui/control.html", section || "overview");
    var base = pageUrl("ui/control.html", "");
    var query = Promise.resolve([]);
    try {
      query = Promise.resolve(current.tabs.query({ url: base + "*" })).catch(function () { return []; });
    } catch (error) {
      query = Promise.resolve([]);
    }
    return query.then(function (tabs) {
      var existing = Array.isArray(tabs) && tabs.length ? tabs[0] : null;
      if (existing && typeof existing.id === "number") {
        return Promise.resolve(current.tabs.update(existing.id, { url: url, active: true })).then(function (tab) {
          if (current.windows && typeof existing.windowId === "number") {
            Promise.resolve(current.windows.update(existing.windowId, { focused: true })).catch(function () {});
          }
          return tab || existing;
        });
      }
      return current.tabs.create({ url: url, active: true });
    });
  }

  function sendControl(op, payload) {
    var message = Object.assign({}, payload || {}, { channel: "lb-control", op: op });
    return Promise.resolve(api().runtime.sendMessage(message));
  }

  root.LB = root.LB || {};
  root.LB.ext = {
    ALL_URLS: ALL_URLS,
    get api() {
      return api();
    },
    get client() {
      return client();
    },
    manifest: manifest,
    version: version,
    action: action,
    declared: declared,
    pageUrl: pageUrl,
    openControlCenter: openControlCenter,
    sendControl: sendControl
  };
})(globalThis);
