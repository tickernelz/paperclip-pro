(function (root) {
  "use strict";

  var LB = root.LB;
  var core = LB.bg.core;
  var ERROR = core.ERROR;
  var ToolFailure = core.ToolFailure;

  async function cropDataUrl(dataUrl, rect) {
    var response = await fetch(dataUrl);
    var blob = await response.blob();
    var bitmap = await createImageBitmap(blob);
    var box = LB.frames.cropRect(rect, rect.dpr, bitmap.width, bitmap.height);
    if (!box) {
      if (typeof bitmap.close === "function") bitmap.close();
      return null;
    }
    var canvas = new OffscreenCanvas(box.width, box.height);
    var context = canvas.getContext("2d");
    context.drawImage(bitmap, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
    if (typeof bitmap.close === "function") bitmap.close();
    return await core.blobToDataUrl(await canvas.convertToBlob({ type: "image/png" }));
  }

  async function captureFullPage(tab) {
    try {
      return await LB.bg.cdp.borrow(tab.id, async function () {
        await LB.bg.cdp.send(tab.id, "Page.enable", {});
        var metrics = await LB.bg.cdp.send(tab.id, "Page.getLayoutMetrics");
        var size = metrics.cssContentSize || metrics.contentSize;
        var width = Math.ceil(size.width);
        var height = Math.ceil(size.height);
        var shot = await LB.bg.cdp.send(tab.id, "Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: true,
          clip: { x: 0, y: 0, width: width, height: height, scale: 1 }
        });
        return { dataUrl: "data:image/png;base64," + shot.data, width: width, height: height };
      });
    } catch (error) {
      return null;
    }
  }

  async function captureWithDebugger(tab, format, quality) {
    try {
      return await LB.bg.cdp.borrow(tab.id, async function () {
        var params = { format: format };
        if (typeof quality === "number") params.quality = quality;
        var shot = await LB.bg.cdp.send(tab.id, "Page.captureScreenshot", params);
        return "data:image/" + format + ";base64," + shot.data;
      });
    } catch (error) {
      return null;
    }
  }

  async function screenshotWithoutFocus(tab) {
    var focused = await LB.bg.tabs.focusedTab();
    if (focused && focused.id === tab.id) return await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    var background = await captureWithDebugger(tab, "png");
    if (background) return background;
    throw new ToolFailure(
      ERROR.unsupported,
      "This tab cannot be captured without bringing it to the front",
      "Ask the user to switch to that tab, or use local_browser_read instead"
    );
  }

  async function capture(tab, args, call) {
    if (args.fullPage === true) {
      var full = await captureFullPage(tab);
      if (full) return { dataUrl: full.dataUrl, width: full.width, height: full.height, tabId: tab.id, fullPage: true };
    }
    var note = args.fullPage === true ? "The browser refused the debugger, so this is the visible viewport only" : null;
    var rect = args.selector ? await LB.bg.tabs.rpc(tab.id, "elementRect", { selector: args.selector }, call.pageTimeout(10000)) : null;
    var dataUrl = await screenshotWithoutFocus(tab);
    var result = { dataUrl: dataUrl, width: null, height: null, tabId: tab.id, fullPage: false };
    if (note) result.note = note;
    if (!rect) return result;
    var cropped = await cropDataUrl(dataUrl, rect).catch(function () {
      return null;
    });
    result.width = Math.round(rect.width);
    result.height = Math.round(rect.height);
    if (!cropped) {
      result.cropped = false;
      result.note = "The element crop failed, so this is the whole viewport";
      return result;
    }
    result.dataUrl = cropped;
    result.cropped = true;
    return result;
  }

  async function toolScreenshot(args, call) {
    var tab = await LB.bg.tabs.resolveTab(args);
    var result = await capture(tab, args, call);
    result.document = await LB.bg.tabs.documentOf(tab.id, Math.min(3000, call.pageTimeout(3000)));
    return result;
  }

  LB.bg = LB.bg || {};
  LB.bg.screenshot = {
    cropDataUrl: cropDataUrl,
    captureFullPage: captureFullPage,
    captureWithDebugger: captureWithDebugger,
    screenshotWithoutFocus: screenshotWithoutFocus,
    toolScreenshot: toolScreenshot
  };
})(globalThis);
