(function (root) {
  "use strict";

  var LB = root.LB;
  var protocol = LB.protocol;

  function baseName(path) {
    if (!path) return "";
    var parts = String(path).split(/[\\/]/);
    return parts[parts.length - 1] || "";
  }

  function nameFromUrl(rawUrl) {
    try {
      var parsed = new URL(rawUrl);
      return baseName(parsed.pathname) || "download";
    } catch (error) {
      return "download";
    }
  }

  function base64Of(bytes) {
    var binary = "";
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      var slice = bytes.subarray(i, Math.min(i + chunk, bytes.length));
      binary += String.fromCharCode.apply(null, Array.prototype.slice.call(slice));
    }
    return btoa(binary);
  }

  async function list(tab) {
    var items = await browser.downloads.search({ orderBy: ["-startTime"] });
    var origin = protocol.originOf(tab.url);
    var fromTab = [];
    var others = [];
    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
      var record = {
        id: item.id,
        name: baseName(item.filename) || nameFromUrl(item.url),
        url: item.url,
        mime: item.mime || "",
        state: item.state,
        bytesReceived: item.bytesReceived || 0,
        totalBytes: item.totalBytes || 0,
        startTime: item.startTime
      };
      var referrer = item.referrer || "";
      var url = item.url || "";
      var sameTab = Boolean(origin) && (referrer.indexOf(origin) === 0 || url.indexOf(origin) === 0);
      if (sameTab) fromTab.push(record);
      else others.push(record);
    }
    var ordered = fromTab.concat(others);
    return { downloads: ordered, total: ordered.length };
  }

  async function save(downloadId) {
    var items = await browser.downloads.search({ id: downloadId });
    var item = items && items[0];
    if (!item) {
      throw protocol.error(
        protocol.ERROR_CODES.elementMissing,
        "Download " + downloadId + " is not in this profile",
        "Call local_browser_download with op list first",
        true
      );
    }
    var response;
    try {
      response = await fetch(item.url, { credentials: "include", cache: "no-store" });
    } catch (error) {
      throw protocol.error(protocol.ERROR_CODES.extensionUnavailable, "Could not fetch the download: " + (error && error.message ? error.message : "network error"), "Open the URL in a tab and retry", true);
    }
    if (!response.ok) {
      throw protocol.error(protocol.ERROR_CODES.extensionUnavailable, "The download URL answered " + response.status, "Open the URL in a tab and retry", true);
    }
    var blob = await response.blob();
    var bytes = new Uint8Array(await blob.arrayBuffer());
    var name = baseName(item.filename) || nameFromUrl(item.url);
    var mime = item.mime || blob.type || "application/octet-stream";
    return {
      downloadId: item.id,
      id: item.id,
      name: name,
      mime: mime,
      mimeType: mime,
      sizeBytes: bytes.byteLength,
      base64: base64Of(bytes)
    };
  }

  root.LB = root.LB || {};
  root.LB.downloads = { list: list, save: save, baseName: baseName };
})(globalThis);
