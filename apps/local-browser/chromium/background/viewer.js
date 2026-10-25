(function (root) {
  "use strict";

  var LB = root.LB;
  var core = LB.bg.core;
  var ERROR = core.ERROR;
  var ToolFailure = core.ToolFailure;
  var VIEWER_STATE = {
    connected: "connected",
    unavailable: "viewer_unavailable",
    streaming: "agent_streaming",
    idle: "agent_idle",
    disconnected: "disconnected"
  };

  var viewer = null;
  var agentBusy = false;

  function send(frame) {
    return LB.bg.bridge.send(frame);
  }

  function emitState(state, tabId, message) {
    send(LB.frames.stateEvent(state, tabId, message));
  }

  function emitAgentState(busy) {
    if (agentBusy === busy) return;
    agentBusy = busy;
    if (!viewer) return;
    emitState(busy ? VIEWER_STATE.streaming : VIEWER_STATE.idle, viewer.tabId);
  }

  function stop() {
    if (!viewer) return null;
    if (viewer.timer) clearInterval(viewer.timer);
    var tabId = viewer.tabId;
    viewer = null;
    agentBusy = false;
    return tabId;
  }

  async function bitmapSize(dataUrl) {
    if (typeof createImageBitmap !== "function") return null;
    var blob = await (await fetch(dataUrl)).blob();
    var bitmap = await createImageBitmap(blob);
    var size = { width: bitmap.width, height: bitmap.height };
    if (typeof bitmap.close === "function") bitmap.close();
    return size;
  }

  function readViewportInPage() {
    return { width: window.innerWidth || 0, height: window.innerHeight || 0, dpr: window.devicePixelRatio || 1 };
  }

  function usableViewport(value) {
    if (!value || typeof value !== "object") return null;
    var width = typeof value.width === "number" && value.width > 0 ? Math.round(value.width) : 0;
    var height = typeof value.height === "number" && value.height > 0 ? Math.round(value.height) : 0;
    if (!width || !height) return null;
    var ratio = typeof value.dpr === "number" && Number.isFinite(value.dpr) && value.dpr > 0 ? value.dpr : null;
    return { width: width, height: height, dpr: ratio };
  }

  async function tabViewport(tabId, bitmap) {
    var fromRpc = usableViewport(await LB.bg.tabs.rpc(tabId, "viewport", {}, 4000).catch(function () { return null; }));
    if (fromRpc && fromRpc.dpr !== null) return { viewport: fromRpc, source: "rpc" };
    var injected = await chrome.scripting
      .executeScript({ target: { tabId: tabId }, world: "ISOLATED", func: readViewportInPage })
      .then(function (frames) {
        return usableViewport(frames && frames[0] ? frames[0].result : null);
      })
      .catch(function () {
        return null;
      });
    if (injected) {
      var trusted = bitmap ? LB.frames.corroborateViewport(bitmap.width, bitmap.height, injected) : injected;
      if (trusted) return { viewport: trusted, source: "injected" };
    }
    return { viewport: fromRpc, source: fromRpc ? "rpc-partial" : "none" };
  }

  async function activeTabIdOf(windowId) {
    var active = await chrome.tabs.query({ active: true, windowId: windowId });
    return active && active[0] && typeof active[0].id === "number" ? active[0].id : null;
  }

  async function viewerFrame(tab) {
    if (tab.active === true && (await activeTabIdOf(tab.windowId)) === tab.id) {
      return await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 70 });
    }
    return await LB.bg.screenshot.captureWithDebugger(tab, "jpeg", 70);
  }

  async function closedIfGone(current) {
    var stillOpen = await chrome.tabs.get(current.tabId).catch(function () { return null; });
    if (stillOpen) return false;
    stop();
    emitState(VIEWER_STATE.disconnected, current.tabId, "The watched tab closed");
    return true;
  }

  async function captureFrame() {
    if (!viewer) return;
    var current = viewer;
    try {
      if (await closedIfGone(current)) return;
      var tab = await chrome.tabs.get(current.tabId);
      var dataUrl = await viewerFrame(tab);
      if (viewer !== current) return;
      var bitmap = await bitmapSize(dataUrl);
      if (!bitmap) {
        emitState(VIEWER_STATE.unavailable, current.tabId, "The browser returned a frame without a readable size");
        return;
      }
      var probe = await tabViewport(current.tabId, bitmap);
      if (viewer !== current) return;
      var viewport = probe.viewport;
      if (!viewport || viewport.dpr === null) {
        emitState(VIEWER_STATE.unavailable, current.tabId, "The page would not report its viewport, so this frame cannot be labelled in CSS pixels");
        return;
      }
      var size = LB.frames.cssPixels(bitmap.width, bitmap.height, viewport.dpr, viewport);
      if (!LB.frames.canSendFrame(dataUrl, size.width, size.height)) {
        emitState(VIEWER_STATE.unavailable, current.tabId, "The browser returned a frame without a usable size");
        return;
      }
      send(LB.frames.frameEvent(dataUrl, size.width, size.height, current.tabId));
    } catch (error) {
      if (viewer !== current) return;
      if (await closedIfGone(current)) return;
      emitState(VIEWER_STATE.unavailable, current.tabId, "The browser could not capture this tab");
    }
  }

  async function toolViewer(args) {
    if (args.op === "stop") {
      var stopped = stop();
      if (typeof stopped === "number") emitState(VIEWER_STATE.disconnected, stopped);
      return { stopped: typeof stopped === "number", active: false, tabId: stopped };
    }
    if (args.op !== "start") throw new ToolFailure(ERROR.protocolError, "viewer op must be start or stop");
    stop();
    var tab = await LB.bg.tabs.resolveTab(args);
    var intervalMs = core.clampInt(args.intervalMs, core.DEFAULTS.viewerIntervalMs, 250, 10000);
    viewer = { tabId: tab.id, windowId: tab.windowId, intervalMs: intervalMs, timer: null };
    emitState(VIEWER_STATE.connected, tab.id);
    viewer.timer = setInterval(function () {
      void captureFrame();
    }, intervalMs);
    void captureFrame();
    return { started: true, active: true, tabId: tab.id, intervalMs: intervalMs };
  }

  function onTabClosed(tabId) {
    if (viewer && viewer.tabId === tabId) {
      stop();
      emitState(VIEWER_STATE.disconnected, tabId, "The watched tab closed");
    }
  }

  LB.bg = LB.bg || {};
  LB.bg.viewer = {
    VIEWER_STATE: VIEWER_STATE,
    emitAgentState: emitAgentState,
    stop: stop,
    toolViewer: toolViewer,
    onTabClosed: onTabClosed
  };
})(globalThis);
