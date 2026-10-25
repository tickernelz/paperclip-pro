(function (root) {
  "use strict";

  var PENDING_KEY = "lb.pending";
  var MAX_PENDING = 50;
  var REASON_MAX = 300;
  var NOTIFICATION_ID = "lb-permission-request";
  var ALL_URLS = "<all_urls>";
  var PENDING_COLOR = "#b45309";

  var listeners = [];
  var idleBadge = null;
  var chain = Promise.resolve();
  var emitting = null;
  var notificationClickBound = false;

  function ext() {
    return root.LB.ext;
  }

  function api() {
    return ext().api;
  }

  function client() {
    return ext().client;
  }

  function permissionsApi() {
    var current = api();
    return current && current.permissions ? current.permissions : null;
  }

  function storageArea() {
    var current = api();
    return current && current.storage && current.storage.local ? current.storage.local : null;
  }

  function contractEntries() {
    var contract = root.LB.contract || {};
    return Array.isArray(contract.permissions) ? contract.permissions : [];
  }

  function availability(entry) {
    var value = entry ? entry[client()] : null;
    return value === "required" || value === "optional" ? value : "unsupported";
  }

  function entry(id) {
    var list = contractEntries();
    for (var index = 0; index < list.length; index += 1) {
      if (list[index].id === id) return list[index];
    }
    return null;
  }

  function catalog() {
    return contractEntries().filter(function (item) {
      return availability(item) !== "unsupported";
    });
  }

  function label(id) {
    var item = entry(id);
    return item && item.label ? item.label : id;
  }

  function requiredIds() {
    return catalog().filter(function (item) { return availability(item) === "required"; }).map(function (item) { return item.id; });
  }

  function requestableIds() {
    var optional = catalog().filter(function (item) { return availability(item) === "optional"; }).map(function (item) { return item.id; });
    var declared = ext().declared().optional;
    if (!declared.length) return optional;
    return optional.filter(function (id) { return declared.indexOf(id) !== -1; });
  }

  function uniqueStrings(ids) {
    var list = Array.isArray(ids) ? ids : typeof ids === "string" ? [ids] : [];
    var out = [];
    for (var index = 0; index < list.length; index += 1) {
      if (typeof list[index] === "string" && list[index] && out.indexOf(list[index]) === -1) out.push(list[index]);
    }
    return out;
  }

  function toQuery(ids) {
    var query = { permissions: [], origins: [] };
    for (var index = 0; index < ids.length; index += 1) {
      var item = entry(ids[index]);
      if (item && item.kind === "origin") query.origins.push(ids[index]);
      else query.permissions.push(ids[index]);
    }
    return query;
  }

  function contains(id) {
    var perms = permissionsApi();
    if (!perms || typeof perms.contains !== "function") return Promise.resolve(false);
    try {
      return Promise.resolve(perms.contains(toQuery([id]))).then(Boolean, function () { return false; });
    } catch (error) {
      return Promise.resolve(false);
    }
  }

  function siteAccess() {
    var perms = permissionsApi();
    if (!perms || typeof perms.contains !== "function") return Promise.resolve("unknown");
    try {
      return Promise.resolve(perms.contains({ origins: [ALL_URLS] })).then(
        function (granted) { return granted ? "all" : "limited"; },
        function () { return "unknown"; }
      );
    } catch (error) {
      return Promise.resolve("unknown");
    }
  }

  function grantedIds() {
    var ids = catalog().map(function (item) { return item.id; });
    return Promise.all(ids.map(contains)).then(function (flags) {
      return ids.filter(function (id, index) { return flags[index]; });
    });
  }

  function sanitizeEntry(raw) {
    if (!raw || typeof raw !== "object" || typeof raw.permission !== "string" || !raw.permission) return null;
    var clean = {
      permission: raw.permission,
      reason: typeof raw.reason === "string" ? raw.reason.slice(0, REASON_MAX) : "",
      at: typeof raw.at === "number" && Number.isFinite(raw.at) ? raw.at : Date.now()
    };
    if (typeof raw.tool === "string" && raw.tool) clean.tool = raw.tool;
    return clean;
  }

  function readPending() {
    var area = storageArea();
    if (!area) return Promise.resolve([]);
    return Promise.resolve(area.get(PENDING_KEY)).then(
      function (stored) {
        var list = stored && Array.isArray(stored[PENDING_KEY]) ? stored[PENDING_KEY] : [];
        return list.map(sanitizeEntry).filter(Boolean).slice(-MAX_PENDING);
      },
      function () { return []; }
    );
  }

  function writePending(list) {
    var area = storageArea();
    var payload = {};
    payload[PENDING_KEY] = list;
    if (!area) return Promise.resolve(list);
    return Promise.resolve(area.set(payload)).then(function () { return list; });
  }

  function mutatePending(change) {
    var run = chain.then(function () {
      return readPending().then(function (list) {
        var next = change(list.slice()) || list;
        return writePending(next).then(function () { paintBadge(next.length); return next; });
      });
    });
    chain = run.catch(function () {});
    return run;
  }

  function paintBadge(count) {
    var action = ext().action();
    if (!action) return;
    try {
      if (count > 0) {
        Promise.resolve(action.setBadgeText({ text: String(count) })).catch(function () {});
        Promise.resolve(action.setBadgeBackgroundColor({ color: PENDING_COLOR })).catch(function () {});
        if (typeof action.setTitle === "function") {
          var noun = count === 1 ? "permission request" : "permission requests";
          Promise.resolve(action.setTitle({ title: "Paperclip Local Browser: " + count + " " + noun + " waiting" })).catch(function () {});
        }
        return;
      }
      if (typeof idleBadge === "function") {
        idleBadge();
        return;
      }
      Promise.resolve(action.setBadgeText({ text: "" })).catch(function () {});
      if (typeof action.setTitle === "function") Promise.resolve(action.setTitle({ title: "Paperclip Local Browser" })).catch(function () {});
    } catch (error) {
      return;
    }
  }

  function refreshBadge() {
    return readPending().then(function (list) {
      paintBadge(list.length);
      return list.length;
    });
  }

  function setIdleBadge(painter) {
    idleBadge = typeof painter === "function" ? painter : null;
  }

  function iconUrl() {
    var icons = ext().manifest().icons || {};
    var sizes = Object.keys(icons).sort(function (a, b) { return Number(b) - Number(a); });
    if (!sizes.length) return "";
    try {
      return api().runtime.getURL(icons[sizes[0]]);
    } catch (error) {
      return "";
    }
  }

  function bindNotificationClick(notifications) {
    if (notificationClickBound || !notifications.onClicked) return;
    notificationClickBound = true;
    notifications.onClicked.addListener(function (id) {
      if (id !== NOTIFICATION_ID) return;
      Promise.resolve(ext().openControlCenter("permissions")).catch(function () {});
      Promise.resolve(notifications.clear(NOTIFICATION_ID)).catch(function () {});
    });
  }

  function notify(ids) {
    return contains("notifications").then(function (granted) {
      var current = api();
      var notifications = current && current.notifications;
      if (!granted || !notifications || typeof notifications.create !== "function") return false;
      bindNotificationClick(notifications);
      var names = ids.map(label).join(", ");
      var options = {
        type: "basic",
        title: "Paperclip needs a browser permission",
        message: "An agent asked for: " + names + ". Open the Paperclip Local Browser extension to allow it."
      };
      var icon = iconUrl();
      if (icon) options.iconUrl = icon;
      return Promise.resolve(notifications.create(NOTIFICATION_ID, options)).then(function () { return true; }, function () { return false; });
    });
  }

  function snapshot() {
    return Promise.all([grantedIds(), siteAccess(), readPending()]).then(function (parts) {
      var granted = parts[0];
      var site = parts[1];
      if (site === "all" && granted.indexOf(ALL_URLS) === -1 && entry(ALL_URLS) && availability(entry(ALL_URLS)) !== "unsupported") granted.push(ALL_URLS);
      if (site === "limited") granted = granted.filter(function (id) { return id !== ALL_URLS; });
      var missing = catalog().map(function (item) { return item.id; }).filter(function (id) { return granted.indexOf(id) === -1; });
      var pending = parts[2].filter(function (item) { return granted.indexOf(item.permission) === -1; });
      return { siteAccess: site, granted: granted, missing: missing, pending: pending };
    });
  }

  function emit() {
    if (!listeners.length) return Promise.resolve(null);
    if (emitting) return emitting;
    emitting = Promise.resolve().then(snapshot).then(
      function (current) {
        emitting = null;
        listeners.slice().forEach(function (listener) {
          try {
            listener(current);
          } catch (error) {
            return;
          }
        });
        return current;
      },
      function () {
        emitting = null;
        return null;
      }
    );
    return emitting;
  }

  function onChange(listener) {
    if (typeof listener !== "function") return function () {};
    listeners.push(listener);
    return function () {
      listeners = listeners.filter(function (item) { return item !== listener; });
    };
  }

  function classify(ids) {
    var known = [];
    var unknown = [];
    var unsupported = [];
    uniqueStrings(ids).forEach(function (id) {
      var item = entry(id);
      if (!item) unknown.push(id);
      else if (availability(item) === "unsupported") unsupported.push(id);
      else known.push(id);
    });
    return { known: known, unknown: unknown, unsupported: unsupported };
  }

  function queue(ids, meta) {
    var details = meta || {};
    var split = classify(ids);
    return Promise.all(split.known.map(contains)).then(function (flags) {
      var alreadyGranted = split.known.filter(function (id, index) { return flags[index]; });
      var wanted = split.known.filter(function (id, index) { return !flags[index]; });
      var fresh = [];
      return mutatePending(function (list) {
        if (!wanted.length) return list;
        var now = Date.now();
        var next = list.filter(function (item) { return wanted.indexOf(item.permission) === -1; });
        wanted.forEach(function (id) {
          if (!list.some(function (item) { return item.permission === id; })) fresh.push(id);
          next.push(sanitizeEntry({ permission: id, reason: details.reason, tool: details.tool, at: now }));
        });
        return next.slice(-MAX_PENDING);
      }).then(function (pending) {
        if (fresh.length) notify(fresh).catch(function () {});
        if (wanted.length) emit();
        return {
          queued: wanted,
          alreadyGranted: alreadyGranted,
          unknown: split.unknown,
          unsupported: split.unsupported,
          pending: pending
        };
      });
    });
  }

  function permissionRequired(ids) {
    var names = ids.map(label).join(", ");
    return {
      code: "local_browser_permission_required",
      message: "This browser has not granted " + names + " to the Paperclip Local Browser extension.",
      hint: "Ask the user to open the Paperclip Local Browser extension and press Allow (or Allow all). The request is waiting there.",
      retryable: true,
      permissions: ids
    };
  }

  function ensure(ids, meta) {
    var split = classify(ids);
    if (split.unknown.length) {
      return Promise.reject({ code: "local_browser_protocol_error", message: "Unknown browser permission: " + split.unknown.join(", ") + "." });
    }
    if (split.unsupported.length) {
      return Promise.reject({
        code: "local_browser_unsupported",
        message: split.unsupported.map(label).join(", ") + " is not available in " + client() + ".",
        hint: "Use another tool or another browser."
      });
    }
    return Promise.all(split.known.map(contains)).then(function (flags) {
      var missing = split.known.filter(function (id, index) { return !flags[index]; });
      if (!missing.length) return { granted: split.known };
      return queue(missing, meta).then(function () {
        throw permissionRequired(missing);
      });
    });
  }

  function clearPending(ids) {
    var only = ids === undefined || ids === null ? null : uniqueStrings(ids);
    return mutatePending(function (list) {
      if (!only) return [];
      return list.filter(function (item) { return only.indexOf(item.permission) === -1; });
    }).then(function (pending) {
      emit();
      return pending;
    });
  }

  function request(ids) {
    var perms = permissionsApi();
    var requestable = requestableIds();
    var asked = uniqueStrings(ids);
    var wanted = asked.filter(function (id) { return requestable.indexOf(id) !== -1; });
    var skipped = asked.filter(function (id) { return requestable.indexOf(id) === -1; });
    if (!wanted.length) return Promise.resolve({ granted: false, requested: [], skipped: skipped });
    if (!perms || typeof perms.request !== "function") {
      return Promise.reject({ code: "local_browser_unsupported", message: "This browser cannot request permissions at runtime." });
    }
    var pending;
    try {
      pending = perms.request(toQuery(wanted));
    } catch (error) {
      return Promise.reject(error);
    }
    return Promise.resolve(pending).then(function (granted) {
      var result = { granted: Boolean(granted), requested: wanted, skipped: skipped };
      if (!granted) return result;
      return clearPending(wanted).then(function () { return result; });
    });
  }

  function requestAll() {
    return request(requestableIds());
  }

  function revoke(id) {
    var perms = permissionsApi();
    if (requestableIds().indexOf(id) === -1) {
      return Promise.reject({ code: "local_browser_unsupported", message: label(id) + " is required by the extension and cannot be revoked here." });
    }
    if (!perms || typeof perms.remove !== "function") {
      return Promise.reject({ code: "local_browser_unsupported", message: "This browser cannot revoke permissions at runtime." });
    }
    return Promise.resolve(perms.remove(toQuery([id]))).then(function (removed) {
      emit();
      return Boolean(removed);
    });
  }

  function install() {
    var perms = permissionsApi();
    if (perms && perms.onAdded && typeof perms.onAdded.addListener === "function") {
      perms.onAdded.addListener(function () {
        grantedIds().then(function (granted) {
          return siteAccess().then(function (site) {
            if (site === "all") granted.push(ALL_URLS);
            return mutatePending(function (list) {
              return list.filter(function (item) { return granted.indexOf(item.permission) === -1; });
            });
          });
        }).then(emit, emit);
      });
    }
    if (perms && perms.onRemoved && typeof perms.onRemoved.addListener === "function") {
      perms.onRemoved.addListener(function () { emit(); });
    }
    var current = api();
    if (current && current.storage && current.storage.onChanged && typeof current.storage.onChanged.addListener === "function") {
      current.storage.onChanged.addListener(function (changes, area) {
        if (area !== "local" || !changes || !changes[PENDING_KEY]) return;
        emit();
      });
    }
  }

  root.LB = root.LB || {};
  root.LB.access = {
    PENDING_KEY: PENDING_KEY,
    NOTIFICATION_ID: NOTIFICATION_ID,
    MAX_PENDING: MAX_PENDING,
    catalog: catalog,
    availability: function (id) { return availability(entry(id)); },
    label: label,
    requiredIds: requiredIds,
    requestableIds: requestableIds,
    snapshot: snapshot,
    ensure: ensure,
    queue: queue,
    request: request,
    requestAll: requestAll,
    revoke: revoke,
    clearPending: clearPending,
    onChange: onChange,
    refreshBadge: refreshBadge,
    setIdleBadge: setIdleBadge
  };
  install();
})(globalThis);
