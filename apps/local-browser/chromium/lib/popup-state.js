(function (root) {
  "use strict";

  function statusLabel(status) {
    if (!status || !status.paired) return "Not paired";
    if (status.connected) return "Connected";
    if (status.socketState === "connecting") return "Connecting…";
    return "Disconnected";
  }

  function dotClass(status) {
    if (!status || !status.paired) return "dot off";
    if (status.connected) return "dot on";
    if (status.socketState === "connecting") return "dot wait";
    return "dot off";
  }

  function detailLine(status) {
    if (!status) return "";
    if (status.retiredReason) return "Session ended: " + status.retiredReason;
    if (status.origin) return String(status.label || "") + " · " + status.origin;
    return "Paste a connect URL from Paperclip to start";
  }

  function accessLine(status) {
    if (!status) return "";
    if (status.siteAccess === "limited")
      return "This browser limits the extension to some sites. Set site access to all sites so every page works.";
    return "";
  }

  function originsLine(status) {
    if (!status) return "";
    var origins = Array.isArray(status.allowedOrigins) ? status.allowedOrigins : [];
    if (status.tier === "full") return "Full tier: every origin is reachable.";
    if (origins.length) return "Allowed origins: " + origins.join(", ");
    return "Refine tier with no allowed origins yet; set them in Paperclip.";
  }

  function view(status) {
    var safe = status && typeof status === "object" ? status : null;
    var paired = Boolean(safe && safe.paired);
    return {
      stateLabel: statusLabel(safe),
      dotClass: dotClass(safe),
      detail: detailLine(safe),
      origins: originsLine(safe),
      access: accessLine(safe),
      showGrant: Boolean(safe && safe.siteAccess === "limited"),
      tier: (safe && safe.tier) || "—",
      session: safe && safe.sessionId ? String(safe.sessionId).slice(0, 8) : "—",
      tabs: safe && typeof safe.tabCount === "number" ? String(safe.tabCount) : "—",
      retired: Boolean(safe && safe.retiredReason),
      showPairForm: true,
      reconnectEnabled: paired,
      disconnectEnabled: paired,
      prefilledOrigin: (safe && safe.origin) || "",
      prefilledLabel: (safe && safe.label) || "",
      error: safe && safe.error ? String(safe.error) : ""
    };
  }

  root.LB = root.LB || {};
  root.LB.popup = { view: view };
})(globalThis);
