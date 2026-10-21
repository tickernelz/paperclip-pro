(function (root) {
  "use strict";

  var LB = root.LB;

  try {
    LB.network.install();
  } catch (error) {
    void error;
  }

  browser.runtime.onMessage.addListener(function (message) {
    if (!message || message.channel !== "lb-control") return undefined;
    return LB.bridge.control(message);
  });

  browser.runtime.onStartup.addListener(function () {
    void LB.bridge.start();
  });

  browser.runtime.onInstalled.addListener(function () {
    void LB.bridge.start();
  });

  browser.browserAction.setBadgeBackgroundColor({ color: "#2563eb" }).catch(function () {});

  function paintBadge() {
    var state = LB.bridge.snapshotState();
    var text = state.status === "connected" ? "" : "!";
    try {
      var painting = browser.browserAction.setBadgeText({ text: text });
      if (painting && typeof painting.catch === "function") painting.catch(function () {});
    } catch (error) {
      void error;
    }
  }

  browser.runtime.onMessage.addListener(function (message) {
    if (!message || message.channel !== "lb-status") return undefined;
    paintBadge();
    return undefined;
  });

  LB.bridge.installTabWatchers();

  void LB.bridge.start();
  paintBadge();
})(globalThis);
