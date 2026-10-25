(function (root) {
  "use strict";

  var LB = root.LB;
  var bridge = LB.bg.bridge;
  var KEEPALIVE_ALARM = "lb-heartbeat";

  function ensureAlarm() {
    var created = chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
    if (created && typeof created.catch === "function") {
      created.catch(function () {
        chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 1 });
      });
    }
  }

  function resume() {
    ensureAlarm();
    bridge.reopenSession();
    void bridge.connect();
  }

  async function firstRun(details) {
    var reason = details && details.reason;
    if (reason === "install") {
      await LB.ext.openControlCenter("welcome");
      return;
    }
    if (reason === "update") {
      var snapshot = await LB.access.snapshot();
      if (snapshot.siteAccess !== "all") await LB.ext.openControlCenter("welcome");
    }
  }

  function onTabClosed(tabId) {
    LB.bg.network.forgetTab(tabId);
    LB.bg.tabs.forget(tabId);
    LB.bg.viewer.onTabClosed(tabId);
    bridge.scheduleTabsEvent();
  }

  function onDebuggerDetach(source) {
    if (!source || typeof source.tabId !== "number") return;
    LB.bg.cdp.forget(source.tabId);
  }

  LB.bg.cdp.onDetach(function (tabId) {
    LB.bg.input.onDebuggerDetached(tabId);
    LB.bg.network.onDebuggerDetached(tabId);
  });

  LB.access.setIdleBadge(bridge.paintConnectionBadge);
  LB.access.onChange(function (snapshot) {
    LB.bg.network.setAccess(snapshot);
    bridge.sendAccess(snapshot);
    bridge.scheduleBroadcast();
  });
  LB.guards.onChange(function (guards) {
    bridge.sendGuards(guards);
    bridge.scheduleBroadcast();
  });

  chrome.runtime.onMessage.addListener(bridge.onMessage);
  chrome.runtime.onStartup.addListener(resume);
  chrome.runtime.onInstalled.addListener(function (details) {
    resume();
    void firstRun(details).catch(function () {});
  });
  chrome.alarms.onAlarm.addListener(function (alarm) {
    if (alarm.name !== KEEPALIVE_ALARM || bridge.isClosed()) return;
    void bridge.connect();
  });

  chrome.tabs.onCreated.addListener(bridge.scheduleTabsEvent);
  chrome.tabs.onRemoved.addListener(onTabClosed);
  chrome.tabs.onActivated.addListener(bridge.scheduleTabsEvent);
  chrome.tabs.onMoved.addListener(bridge.scheduleTabsEvent);
  chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
    if (
      changeInfo.url ||
      changeInfo.status === "complete" ||
      changeInfo.title ||
      typeof changeInfo.discarded === "boolean" ||
      typeof changeInfo.frozen === "boolean" ||
      typeof changeInfo.pinned === "boolean" ||
      typeof changeInfo.audible === "boolean"
    ) {
      bridge.scheduleTabsEvent();
    }
  });
  if (chrome.tabs.onReplaced) chrome.tabs.onReplaced.addListener(bridge.scheduleTabsEvent);
  chrome.windows.onRemoved.addListener(bridge.scheduleTabsEvent);
  chrome.debugger.onDetach.addListener(onDebuggerDetach);

  LB.bg.network.install();
  void LB.access.snapshot().then(LB.bg.network.setAccess, function () {});
  void LB.guards.get().catch(function () {});
  ensureAlarm();
  void bridge.connect();

  LB.bg.boot = { KEEPALIVE_ALARM: KEEPALIVE_ALARM, firstRun: firstRun };
})(globalThis);
