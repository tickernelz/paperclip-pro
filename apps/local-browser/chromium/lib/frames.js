(function (root) {
  "use strict";

  function tabsEvent(tabs) {
    return { type: "event", event: "tabs", data: { tabs: Array.isArray(tabs) ? tabs : [] } };
  }

  function frameEvent(dataUrl, width, height, tabId) {
    var data = { dataUrl: dataUrl, width: width, height: height };
    if (typeof tabId === "number") data.tabId = tabId;
    return { type: "event", event: "frame", data: data };
  }

  function stateEvent(state, tabId, message) {
    var data = { state: state };
    if (typeof tabId === "number") data.tabId = tabId;
    if (typeof message === "string" && message) data.message = message.slice(0, 400);
    return { type: "event", event: "state", data: data };
  }

  var VIEWPORT_TOLERANCE_PX = 1;

  function cssPixels(bitmapWidth, bitmapHeight, ratio, viewport) {
    var dpr = typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    var width = typeof bitmapWidth === "number" ? bitmapWidth : 0;
    var height = typeof bitmapHeight === "number" ? bitmapHeight : 0;
    var scaled = {
      width: width > 0 ? Math.max(1, Math.round(width / dpr)) : 0,
      height: height > 0 ? Math.max(1, Math.round(height / dpr)) : 0
    };
    var known =
      viewport &&
      typeof viewport.width === "number" &&
      typeof viewport.height === "number" &&
      viewport.width > 0 &&
      viewport.height > 0;
    if (!known) return { width: scaled.width, height: scaled.height, dpr: dpr, source: "bitmap" };
    var offBy =
      Math.abs(scaled.width - viewport.width) > VIEWPORT_TOLERANCE_PX ||
      Math.abs(scaled.height - viewport.height) > VIEWPORT_TOLERANCE_PX;
    if (!offBy) return { width: scaled.width, height: scaled.height, dpr: dpr, source: "bitmap" };
    return {
      width: Math.round(viewport.width),
      height: Math.round(viewport.height),
      dpr: dpr,
      source: "viewport"
    };
  }

  function cropRect(rect, dpr, bitmapWidth, bitmapHeight) {
    var source = rect && typeof rect === "object" ? rect : {};
    var ratio = typeof dpr === "number" && Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    var limitWidth = typeof bitmapWidth === "number" && bitmapWidth > 0 ? bitmapWidth : 0;
    var limitHeight = typeof bitmapHeight === "number" && bitmapHeight > 0 ? bitmapHeight : 0;
    var rawX = Math.round((source.x || 0) * ratio);
    var rawY = Math.round((source.y || 0) * ratio);
    var rawWidth = Math.round((source.width || 0) * ratio);
    var rawHeight = Math.round((source.height || 0) * ratio);
    if (!(rawWidth > 0) || !(rawHeight > 0)) return null;
    if (rawX >= limitWidth || rawY >= limitHeight) return null;
    if (rawX + rawWidth <= 0 || rawY + rawHeight <= 0) return null;
    var x = Math.max(0, rawX);
    var y = Math.max(0, rawY);
    var width = Math.min(rawWidth - (x - rawX), limitWidth - x);
    var height = Math.min(rawHeight - (y - rawY), limitHeight - y);
    if (!(width > 0) || !(height > 0)) return null;
    return { x: x, y: y, width: width, height: height };
  }

  function corroborateViewport(bitmapWidth, bitmapHeight, candidate) {
    if (!candidate || typeof candidate !== "object") return null;
    var width = typeof candidate.width === "number" && candidate.width > 0 ? Math.round(candidate.width) : 0;
    var height = typeof candidate.height === "number" && candidate.height > 0 ? Math.round(candidate.height) : 0;
    if (!width || !height) return null;
    var ratio =
      typeof candidate.dpr === "number" && Number.isFinite(candidate.dpr) && candidate.dpr > 0 ? candidate.dpr : null;
    if (ratio === null) return null;
    if (ratio <= 1) return null;
    var scaledWidth = Math.round(bitmapWidth / ratio);
    var scaledHeight = Math.round(bitmapHeight / ratio);
    if (Math.abs(scaledWidth - width) > VIEWPORT_TOLERANCE_PX) return null;
    if (Math.abs(scaledHeight - height) > VIEWPORT_TOLERANCE_PX) return null;
    return { width: width, height: height, dpr: ratio };
  }

  function canSendFrame(dataUrl, width, height) {
    if (typeof dataUrl !== "string" || dataUrl.indexOf("data:image/") !== 0) return false;
    if (typeof width !== "number" || !Number.isInteger(width) || width <= 0) return false;
    if (typeof height !== "number" || !Number.isInteger(height) || height <= 0) return false;
    return true;
  }

  root.LB = root.LB || {};
  root.LB.frames = {
    tabsEvent: tabsEvent,
    frameEvent: frameEvent,
    stateEvent: stateEvent,
    cssPixels: cssPixels,
    corroborateViewport: corroborateViewport,
    VIEWPORT_TOLERANCE_PX: VIEWPORT_TOLERANCE_PX,
    cropRect: cropRect,
    canSendFrame: canSendFrame
  };
})(globalThis);
