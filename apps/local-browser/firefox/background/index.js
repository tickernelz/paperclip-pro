(function (root) {
  "use strict";

  var LB = root.LB;
  var BADGE_COLOR = "#2563eb";

  function paintConnectionBadge(action) {
    var target = action || LB.ext.action();
    if (!target) return;
    var connected = LB.bridge.snapshotState().status === "connected";
    try {
      var colouring = target.setBadgeBackgroundColor({ color: BADGE_COLOR });
      if (colouring && typeof colouring.catch === "function") colouring.catch(function () {});
      var painting = target.setBadgeText({ text: connected ? "" : "!" });
      if (painting && typeof painting.catch === "function") painting.catch(function () {});
    } catch (error) {
      void error;
    }
  }

  async function onInstalled(details) {
    var reason = details && details.reason;
    if (reason === "install") {
      await LB.ext.openControlCenter("welcome");
      return;
    }
    if (reason !== "update") return;
    var access = await LB.access.snapshot();
    if (access.siteAccess !== "all") await LB.ext.openControlCenter("welcome");
  }

  LB.access.setIdleBadge(paintConnectionBadge);

  browser.runtime.onMessage.addListener(function (message) {
    if (!message || message.channel !== "lb-control") return undefined;
    return LB.bridge.control(message);
  });

  browser.runtime.onStartup.addListener(function () {
    void LB.bridge.start();
  });

  browser.runtime.onInstalled.addListener(function (details) {
    void onInstalled(details).catch(function () {});
  });

  LB.bridge.installTabWatchers();
  LB.bridge.installAccessWatchers();

  void LB.guards
    .get()
    .then(function (guards) {
      LB.network.resize(guards.networkBufferSize);
    })
    .catch(function () {});
  void LB.network.install();
  void LB.tabs.refreshContainers();
  void LB.bridge.refreshTrustedInput();
  void LB.bridge.start();
  Promise.resolve(LB.access.refreshBadge()).catch(function () {});

  root.LB.background = { onInstalled: onInstalled, paintConnectionBadge: paintConnectionBadge };
})(globalThis);
