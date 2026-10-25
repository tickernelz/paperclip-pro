(function (root) {
  "use strict";

  var LB = root.LB;
  var core = LB.bg.core;
  var ERROR = core.ERROR;
  var ToolFailure = core.ToolFailure;

  function filenameOf(item) {
    var parts = String(item.filename || "").split(/[\\/]/);
    return parts[parts.length - 1] || "download";
  }

  async function attachFiles(selector, files) {
    var input = document.querySelector(selector);
    if (!input) return { ok: false, message: "The file input is gone" };
    var transfer = new DataTransfer();
    for (var index = 0; index < files.length; index += 1) {
      var file = files[index];
      var binary = atob(file.base64);
      var bytes = new Uint8Array(binary.length);
      for (var offset = 0; offset < binary.length; offset += 1) bytes[offset] = binary.charCodeAt(offset);
      transfer.items.add(new File([bytes], file.name, { type: file.mimeType }));
    }
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, count: transfer.files.length };
  }

  async function toolUpload(args, call) {
    var tab = await LB.bg.tabs.resolveTab(args);
    var files = LB.attachments.normalizeUploadFiles(args);
    if (!files.length) {
      throw new ToolFailure(
        ERROR.unsupported,
        "No file data arrived with this call",
        "The server must send files:[{name,mimeType,base64}] with the call; attachmentIds alone cannot reach the browser"
      );
    }
    var target = await LB.bg.tabs.rpc(tab.id, "uploadTarget", { ref: args.ref, selector: args.selector }, call.pageTimeout(10000));
    var frames = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      args: [target.selector, files],
      func: attachFiles
    });
    var outcome = frames && frames[0] ? frames[0].result : null;
    if (!outcome || outcome.ok !== true) {
      throw new ToolFailure(
        ERROR.elementMissing,
        (outcome && outcome.message) || "The file input could not take the files",
        "Take a fresh snapshot and target the file input again"
      );
    }
    return { ok: true, count: outcome.count, selector: target.selector, tabId: tab.id };
  }

  function downloadRow(item) {
    var row = {
      id: item.id,
      name: filenameOf(item),
      url: item.finalUrl || item.url,
      mime: item.mime,
      state: item.state,
      bytesReceived: item.bytesReceived,
      totalBytes: item.totalBytes,
      startTime: item.startTime
    };
    if (item.referrer) row.referrer = item.referrer;
    if (item.error) row.error = item.error;
    if (typeof item.exists === "boolean") row.exists = item.exists;
    if (item.incognito === true) row.incognito = true;
    return row;
  }

  async function saveDownload(args) {
    if (typeof args.downloadId !== "number") {
      throw new ToolFailure(ERROR.protocolError, "download with op:save needs downloadId", "Call local_browser_download with op:list first");
    }
    var found = await chrome.downloads.search({ id: args.downloadId });
    var item = found && found[0];
    if (!item) throw new ToolFailure(ERROR.elementMissing, "No download with id " + args.downloadId);
    var response = await fetch(item.finalUrl || item.url);
    var buffer = await response.arrayBuffer();
    var contentType = response.headers.get("content-type") || undefined;
    return LB.attachments.savedDownload(item, core.toBase64(buffer), contentType);
  }

  async function toolDownload(args) {
    if (args.op === "save") return await saveDownload(args);
    var items = await chrome.downloads.search({ orderBy: ["-startTime"] });
    var rows = (items || []).map(downloadRow);
    return { downloads: rows, total: rows.length };
  }

  function requirements(args) {
    return args.op === "save" ? ["downloads", "<all_urls>"] : ["downloads"];
  }

  LB.bg = LB.bg || {};
  LB.bg.downloads = {
    toolUpload: toolUpload,
    toolDownload: toolDownload,
    downloadRow: downloadRow,
    requirements: requirements
  };
})(globalThis);
