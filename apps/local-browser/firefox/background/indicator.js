(function (root) {
  "use strict";

  var LB = root.LB;
  var protocol = LB.protocol;
  var HELD_MESSAGE = "The user took over this tab, so the agent leaves it alone";
  var HELD_HINT =
    "Work in your own tab: call local_browser_open with a url. The user hands this tab back with the Hand back button on the page";

  var tracker = LB.indicator.createTracker();

  function render(tabId) {
    return LB.tabs.send(tabId, "indicator", { state: tracker.stateOf(tabId) }).catch(function () {
      return null;
    });
  }

  async function toolIndicator(args) {
    if (!Array.isArray(args.tabs)) {
      throw protocol.error(protocol.ERROR_CODES.protocolError, "indicator tabs must be a list", "Update the Paperclip server", false);
    }
    await Promise.all(tracker.replace(args.tabs).map(render));
    return { tabs: tracker.tabIds() };
  }

  function toggle(tabId) {
    if (tracker.toggle(tabId)) void render(tabId);
  }

  function refresh(tabId) {
    if (tracker.stateOf(tabId)) void render(tabId);
  }

  function reset() {
    tracker.replace([]).forEach(function (tabId) {
      void render(tabId);
    });
  }

  function assertNotHeld(tab) {
    if (tab && tracker.isHeld(tab.tabId)) {
      throw protocol.error(protocol.ERROR_CODES.navigationBlocked, HELD_MESSAGE, HELD_HINT, false);
    }
    return tab;
  }

  async function withHidden(tabId, run) {
    if (!tracker.stateOf(tabId)) return await run();
    await LB.tabs.send(tabId, "indicator", { suppressed: true }).catch(function () {});
    try {
      return await run();
    } finally {
      await LB.tabs.send(tabId, "indicator", { suppressed: false }).catch(function () {});
    }
  }

  function install() {
    browser.runtime.onMessage.addListener(function (message, sender) {
      if (!message || message.channel !== "lb-indicator" || message.op !== "toggle") return undefined;
      if (sender && sender.tab && typeof sender.tab.id === "number" && sender.frameId === 0) toggle(sender.tab.id);
      return undefined;
    });
    browser.tabs.onRemoved.addListener(function (tabId) {
      tracker.forget(tabId);
    });
    browser.tabs.onUpdated.addListener(function (tabId, info) {
      if (info && info.status === "complete") refresh(tabId);
    });
  }

  root.LB = root.LB || {};
  root.LB.indicatorTabs = {
    toolIndicator: toolIndicator,
    toggle: toggle,
    refresh: refresh,
    reset: reset,
    isHeld: tracker.isHeld,
    assertNotHeld: assertNotHeld,
    withHidden: withHidden,
    install: install
  };
})(globalThis);
