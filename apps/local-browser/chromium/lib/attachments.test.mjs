import test from "node:test";
import assert from "node:assert/strict";

import "./attachments.js";

const { normalizeUploadFiles, savedDownload } = globalThis.LB.attachments;

test("accepts the server's {name, mimeType, base64} shape", () => {
  const files = normalizeUploadFiles({
    files: [{ name: "invoice.pdf", mimeType: "application/pdf", base64: "JVBERi0=" }],
  });
  assert.deepEqual(files, [{ name: "invoice.pdf", mimeType: "application/pdf", base64: "JVBERi0=" }]);
});

test("accepts the legacy {name, mime, dataBase64} shape", () => {
  const files = normalizeUploadFiles({
    files: [{ name: "a.txt", mime: "text/plain", dataBase64: "aGk=" }],
  });
  assert.deepEqual(files, [{ name: "a.txt", mimeType: "text/plain", base64: "aGk=" }]);
});

test("mixes both shapes in one call and keeps order", () => {
  const files = normalizeUploadFiles({
    files: [
      { name: "one.bin", mimeType: "application/octet-stream", base64: "AA==" },
      { name: "two.bin", mime: "image/png", dataBase64: "AQ==" },
    ],
  });
  assert.deepEqual(files.map((file) => file.name), ["one.bin", "two.bin"]);
  assert.deepEqual(files.map((file) => file.base64), ["AA==", "AQ=="]);
  assert.deepEqual(files.map((file) => file.mimeType), ["application/octet-stream", "image/png"]);
});

test("drops entries with no bytes and keeps the rest", () => {
  const files = normalizeUploadFiles({
    files: [{ name: "empty" }, { name: "ok.txt", base64: "aGk=" }],
  });
  assert.deepEqual(files.map((file) => file.name), ["ok.txt"]);
});

test("defaults the name and mime when they are missing", () => {
  const files = normalizeUploadFiles({ files: [{ base64: "aGk=" }] });
  assert.equal(files[0].name, "attachment-1");
  assert.equal(files[0].mimeType, "application/octet-stream");
});

test("reads the attachments alias and tolerates junk input", () => {
  assert.equal(normalizeUploadFiles({ attachments: [{ name: "x", base64: "aGk=" }] }).length, 1);
  assert.deepEqual(normalizeUploadFiles({}), []);
  assert.deepEqual(normalizeUploadFiles(null), []);
  assert.deepEqual(normalizeUploadFiles({ files: "nope" }), []);
});

test("savedDownload returns {base64, mimeType, name} with the file name only", () => {
  const saved = savedDownload(
    { id: 9, filename: "/home/me/reports/q3.pdf", mime: "application/pdf" },
    "JVBERi0=",
    "application/pdf",
  );
  assert.equal(saved.id, 9);
  assert.equal(saved.name, "q3.pdf");
  assert.equal(saved.mimeType, "application/pdf");
  assert.equal(saved.base64, "JVBERi0=");
  assert.equal(saved.sizeBytes, 5);
});

test("savedDownload falls back to the response content type", () => {
  const saved = savedDownload({ id: 1, filename: "C:\\temp\\a.bin" }, "AA==", "application/zip");
  assert.equal(saved.name, "a.bin");
  assert.equal(saved.mimeType, "application/zip");
});
