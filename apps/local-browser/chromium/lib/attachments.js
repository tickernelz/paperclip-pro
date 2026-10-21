(function (root) {
  "use strict";

  var FALLBACK_MIME = "application/octet-stream";

  function pickBase64(file) {
    if (!file || typeof file !== "object") return null;
    if (typeof file.base64 === "string" && file.base64) return file.base64;
    if (typeof file.dataBase64 === "string" && file.dataBase64) return file.dataBase64;
    if (typeof file.data === "string" && file.data) return file.data;
    return null;
  }

  function pickMime(file) {
    if (!file || typeof file !== "object") return FALLBACK_MIME;
    if (typeof file.mimeType === "string" && file.mimeType) return file.mimeType;
    if (typeof file.mime === "string" && file.mime) return file.mime;
    if (typeof file.type === "string" && file.type) return file.type;
    return FALLBACK_MIME;
  }

  function pickName(file, index) {
    if (file && typeof file === "object") {
      if (typeof file.name === "string" && file.name) return file.name;
      if (typeof file.filename === "string" && file.filename) return file.filename;
    }
    return "attachment-" + (index + 1);
  }

  function normalizeUploadFiles(args) {
    var source = args && typeof args === "object" ? args : {};
    var raw = Array.isArray(source.files) ? source.files : Array.isArray(source.attachments) ? source.attachments : [];
    var out = [];
    for (var index = 0; index < raw.length; index += 1) {
      var base64 = pickBase64(raw[index]);
      if (!base64) continue;
      out.push({ name: pickName(raw[index], index), mimeType: pickMime(raw[index]), base64: base64 });
    }
    return out;
  }

  function base64Bytes(value) {
    if (typeof value !== "string") return 0;
    var cleaned = value.replace(/\s+/g, "");
    if (!cleaned) return 0;
    var padding = 0;
    if (cleaned.slice(-2) === "==") padding = 2;
    else if (cleaned.slice(-1) === "=") padding = 1;
    return Math.max(0, Math.floor((cleaned.length * 3) / 4) - padding);
  }

  function savedDownload(item, base64, contentType) {
    var source = item && typeof item === "object" ? item : {};
    var path = typeof source.filename === "string" ? source.filename : "";
    var parts = path.split(/[\\/]/);
    var name = parts[parts.length - 1] || "download";
    var mimeType = source.mime || contentType || FALLBACK_MIME;
    return {
      id: typeof source.id === "number" ? source.id : null,
      name: name,
      mimeType: mimeType,
      sizeBytes: base64Bytes(base64),
      base64: typeof base64 === "string" ? base64 : ""
    };
  }

  root.LB = root.LB || {};
  root.LB.attachments = {
    normalizeUploadFiles: normalizeUploadFiles,
    savedDownload: savedDownload,
    base64Bytes: base64Bytes,
    FALLBACK_MIME: FALLBACK_MIME
  };
})(globalThis);
