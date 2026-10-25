(function (root) {
  "use strict";

  var SECTIONS = ["welcome", "overview", "permissions", "guards", "input"];
  var TITLES = {
    unpaired: "Not paired",
    connecting: "Connecting\u2026",
    connected: "Connected",
    disconnected: "Disconnected",
    retired: "Pairing ended"
  };
  var TONES = { unpaired: "off", connecting: "wait", connected: "ok", disconnected: "warn", retired: "error" };

  function text(value) {
    return typeof value === "string" ? value : "";
  }

  function stateOf(status) {
    var state = status && status.state;
    return Object.prototype.hasOwnProperty.call(TITLES, state) ? state : "unpaired";
  }

  function originsLine(status) {
    if (!status || stateOf(status) !== "connected") return "";
    if (status.tier === "full") return "Full tier: agents can reach every site this browser allows.";
    var origins = Array.isArray(status.allowedOrigins) ? status.allowedOrigins.filter(Boolean) : [];
    if (origins.length) return "Allowed sites: " + origins.join(", ");
    return "Refine tier with no allowed sites yet. Add sites on Paperclip's Local Browser page.";
  }

  function connection(status) {
    var state = stateOf(status);
    var source = status || {};
    var origin = text(source.origin);
    var label = text(source.label);
    var detail;
    if (state === "retired") {
      detail = "Paperclip ended this pairing" + (source.retiredReason ? ": " + source.retiredReason : "") + ". Paste a new pairing link to connect again.";
    } else if (state === "connected") {
      detail = [label, origin].filter(Boolean).join(" \u00b7 ");
    } else if (state === "connecting") {
      detail = origin ? "Reaching " + origin + "\u2026" : "Reaching Paperclip\u2026";
    } else if (state === "disconnected") {
      detail = text(source.lastError) || "Paperclip is unreachable right now. The extension keeps retrying.";
    } else {
      detail = "Paste the pairing link from Paperclip's Local Browser page to connect this browser.";
    }
    var tabs = Array.isArray(source.tabs) ? source.tabs.length : typeof source.tabs === "number" ? source.tabs : null;
    return {
      state: state,
      title: TITLES[state],
      tone: TONES[state],
      detail: detail,
      error: state === "disconnected" ? "" : text(source.lastError),
      showPairForm: state === "unpaired" || state === "retired",
      canReconnect: (state === "disconnected" || state === "connecting") && Boolean(origin),
      canDisconnect: state === "connected" || state === "connecting" || state === "disconnected",
      session: text(source.sessionId) ? source.sessionId.slice(0, 8) : "\u2014",
      tier: source.tier === "full" ? "Full" : source.tier === "refine" ? "Refine" : "\u2014",
      origin: origin || "\u2014",
      label: label || "\u2014",
      origins: originsLine(source),
      tabs: tabs === null ? "\u2014" : String(tabs),
      version: text(source.version) ? "Version " + source.version : "",
      client: source.client === "firefox" ? "Firefox" : source.client === "chromium" ? "Chromium" : ""
    };
  }

  function ageText(at, now) {
    if (typeof at !== "number" || !Number.isFinite(at)) return "";
    var seconds = Math.max(0, Math.round(((typeof now === "number" ? now : Date.now()) - at) / 1000));
    if (seconds < 45) return "just now";
    var minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + " min ago";
    var hours = Math.round(minutes / 60);
    if (hours < 48) return hours + " h ago";
    return Math.round(hours / 24) + " days ago";
  }

  function availabilityOf(entry, client) {
    var value = entry ? entry[client] : null;
    return value === "required" || value === "optional" ? value : "unsupported";
  }

  function siteLine(siteAccess) {
    if (siteAccess === "all") return "Agents can open and read any site.";
    if (siteAccess === "limited") return "Site access is limited. Agents cannot read or act on pages until you allow all sites.";
    return "Checking site access\u2026";
  }

  function permissions(access, options) {
    var opts = options || {};
    var client = opts.client === "firefox" ? "firefox" : "chromium";
    var catalog = Array.isArray(opts.catalog) ? opts.catalog : [];
    var snapshot = access && typeof access === "object" ? access : { siteAccess: "unknown", granted: [], missing: [], pending: [] };
    var granted = Array.isArray(snapshot.granted) ? snapshot.granted : [];
    var pendingList = Array.isArray(snapshot.pending) ? snapshot.pending : [];
    var labels = {};
    catalog.forEach(function (entry) { labels[entry.id] = entry.label || entry.id; });
    var requestable = Array.isArray(opts.requestable) ? opts.requestable : null;
    var rows = [];
    catalog.forEach(function (entry) {
      var availability = availabilityOf(entry, client);
      if (availability === "unsupported") return;
      var isGranted = granted.indexOf(entry.id) !== -1;
      var pending = null;
      pendingList.forEach(function (item) {
        if (item && item.permission === entry.id) pending = item;
      });
      var canRequest = availability === "optional" && (!requestable || requestable.indexOf(entry.id) !== -1);
      rows.push({
        id: entry.id,
        kind: entry.kind === "origin" ? "origin" : "api",
        label: entry.label || entry.id,
        grants: entry.grants || "",
        availability: availability,
        granted: isGranted,
        status: isGranted ? (availability === "required" ? "required" : "granted") : "missing",
        statusText: isGranted ? (availability === "required" ? "Always on" : "Allowed") : pending ? "Requested by an agent" : "Not allowed",
        pending: pending,
        canAllow: canRequest && !isGranted,
        canRevoke: canRequest && isGranted
      });
    });
    var pending = pendingList
      .filter(function (item) { return item && granted.indexOf(item.permission) === -1; })
      .slice()
      .sort(function (a, b) { return (b.at || 0) - (a.at || 0); })
      .map(function (item) {
        return {
          permission: item.permission,
          label: labels[item.permission] || item.permission,
          reason: text(item.reason) || "No reason given.",
          tool: text(item.tool),
          age: ageText(item.at, opts.now)
        };
      });
    var missingRequestable = rows.filter(function (row) { return row.canAllow; }).map(function (row) { return row.id; });
    var grantedCount = rows.filter(function (row) { return row.granted; }).length;
    return {
      siteAccess: snapshot.siteAccess || "unknown",
      siteLine: siteLine(snapshot.siteAccess),
      rows: rows,
      pending: pending,
      pendingIds: pending.map(function (item) { return item.permission; }),
      grantedCount: grantedCount,
      total: rows.length,
      summary: grantedCount + " of " + rows.length + " permissions allowed",
      missingRequestable: missingRequestable,
      allGranted: missingRequestable.length === 0,
      allowAllLabel: missingRequestable.length === 0 ? "Everything is allowed" : "Allow all (" + missingRequestable.length + ")",
      badge: pending.length ? String(pending.length) : ""
    };
  }

  function guards(value, bounds) {
    var source = value && typeof value === "object" ? value : {};
    var range = bounds && typeof bounds === "object" ? bounds : { min: 50, max: 20000 };
    return {
      networkBufferSize: typeof source.networkBufferSize === "number" ? source.networkBufferSize : 1000,
      min: range.min,
      max: range.max,
      toggles: [
        {
          key: "protectPaperclipTab",
          label: "Keep agents away from the Paperclip tab",
          description: "Agents cannot navigate the tab where Paperclip itself is open.",
          checked: source.protectPaperclipTab !== false
        },
        {
          key: "protectFocusedTab",
          label: "Keep agents away from the tab you are using",
          description: "Agents cannot navigate the tab you have in focus unless they opened it.",
          checked: source.protectFocusedTab !== false
        }
      ]
    };
  }

  function trustedInput(value, client) {
    var source = value && typeof value === "object" ? value : {};
    var mode = source.mode === "cdp" || source.mode === "bidi" ? source.mode : "synthetic";
    var title;
    if (mode === "cdp") title = "Trusted input is ready (Chrome DevTools Protocol).";
    else if (mode === "bidi") title = "Trusted input is ready (WebDriver BiDi).";
    else if (client === "firefox") title = "Agents use synthetic events. Start Firefox with remote debugging to give them real clicks and keys.";
    else title = "Agents use synthetic events until the debugger can attach.";
    var command = mode === "synthetic" ? text(source.command) : "";
    return {
      mode: mode,
      tone: mode === "synthetic" ? "warn" : "ok",
      title: title,
      hint: text(source.hint),
      command: command,
      showCommand: Boolean(command),
      showPort: client === "firefox"
    };
  }

  function section(hash) {
    var name = text(hash).replace(/^#/, "").toLowerCase();
    return SECTIONS.indexOf(name) !== -1 ? name : "overview";
  }

  function control(status, options) {
    var opts = options || {};
    var source = status || {};
    var client = opts.client || source.client || "chromium";
    return {
      connection: connection(source),
      permissions: permissions(opts.access || source.access, { catalog: opts.catalog, client: client, requestable: opts.requestable, now: opts.now }),
      guards: guards(source.guards, opts.bounds),
      trustedInput: trustedInput(source.trustedInput, client),
      ready: Boolean(status)
    };
  }

  function popup(status, options) {
    var view = control(status, options);
    return {
      connection: view.connection,
      permissions: view.permissions,
      ready: view.ready,
      showAllowAll: !view.permissions.allGranted,
      showPending: view.permissions.pending.length > 0
    };
  }

  function unwrap(response) {
    if (!response || typeof response !== "object") return { ok: false, error: "The extension background did not answer." };
    if (response.ok === false) return { ok: false, error: text(response.error) || "Something went wrong.", status: response.status || null };
    return Object.assign({ ok: true }, response);
  }

  root.LB = root.LB || {};
  root.LB.uiState = {
    SECTIONS: SECTIONS,
    connection: connection,
    permissions: permissions,
    guards: guards,
    trustedInput: trustedInput,
    section: section,
    ageText: ageText,
    control: control,
    popup: popup,
    unwrap: unwrap
  };
})(globalThis);
