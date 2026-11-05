(function (root) {
  "use strict";

  var LB = root.LB;
  var core = LB.bg.core;
  var ERROR = core.ERROR;
  var ToolFailure = core.ToolFailure;
  var RENDER_TIMEOUT_MS = 3000;
  var HELD_MESSAGE = "The user took over this tab, so the agent leaves it alone";
  var HELD_HINT =
    "Work in your own tab: call local_browser_open with a url. The user hands this tab back with the Hand back button on the page";

  var HELD_KEY = "lb.indicator.held";

  var tracker = LB.indicator.createTracker();

  function sessionArea() {
    return chrome.storage && chrome.storage.session ? chrome.storage.session : null;
  }

  function persistHeld() {
    var area = sessionArea();
    if (!area) return Promise.resolve();
    return Promise.resolve(area.set({ [HELD_KEY]: tracker.heldIds() })).catch(function () {});
  }

  var restored = (async function () {
    var area = sessionArea();
    if (!area) return;
    try {
      var stored = await area.get(HELD_KEY);
      tracker.restoreHeld(stored && stored[HELD_KEY]);
    } catch (error) {
      return;
    }
    tracker.heldIds().forEach(function (tabId) {
      void render(tabId);
    });
  })();

  function ready() {
    return restored;
  }

  function render(tabId) {
    return LB.bg.tabs.rpc(tabId, "indicator", { state: tracker.stateOf(tabId) }, RENDER_TIMEOUT_MS).catch(function () {
      return null;
    });
  }

  async function toolIndicator(args) {
    if (!Array.isArray(args.tabs)) throw new ToolFailure(ERROR.protocolError, "indicator tabs must be a list");
    await restored;
    await Promise.all(tracker.replace(args.tabs).map(render));
    return { tabs: tracker.tabIds() };
  }

  async function toggle(tabId) {
    await restored;
    if (!tracker.toggle(tabId)) return;
    await persistHeld();
    void render(tabId);
  }

  function refresh(tabId) {
    if (tracker.stateOf(tabId)) void render(tabId);
  }

  function forget(tabId) {
    var wasHeld = tracker.isHeld(tabId);
    tracker.forget(tabId);
    if (wasHeld) void persistHeld();
  }

  function reset() {
    tracker.replace([]).forEach(function (tabId) {
      void render(tabId);
    });
  }

  function assertNotHeld(tab) {
    if (tab && tracker.isHeld(tab.id)) throw new ToolFailure(ERROR.navigationBlocked, HELD_MESSAGE, HELD_HINT);
    return tab;
  }

  async function withHidden(tabId, run) {
    if (!tracker.stateOf(tabId)) return await run();
    await LB.bg.tabs.rpc(tabId, "indicator", { suppressed: true }, RENDER_TIMEOUT_MS).catch(function () {});
    try {
      return await run();
    } finally {
      await LB.bg.tabs.rpc(tabId, "indicator", { suppressed: false }, RENDER_TIMEOUT_MS).catch(function () {});
    }
  }

  LB.bg = LB.bg || {};
  LB.bg.indicator = {
    toolIndicator: toolIndicator,
    ready: ready,
    toggle: toggle,
    refresh: refresh,
    forget: forget,
    reset: reset,
    isHeld: tracker.isHeld,
    assertNotHeld: assertNotHeld,
    withHidden: withHidden
  };
})(globalThis);
