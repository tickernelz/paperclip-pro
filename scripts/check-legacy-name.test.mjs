import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ALLOWLIST_PATH, countOccurrences, runCheck, serializeAllowlist, tighten } from "./check-legacy-name.mjs";

const CLASSES = { "belum-diganti": { reason: "scheduled rename", approvedBy: "issue owner" } };

function makeRepo(files, entries, classes = CLASSES) {
  const root = mkdtempSync(path.join(os.tmpdir(), "legacy-name-gate-"));
  const write = (relative, content) => {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    writeFileSync(path.join(root, relative), content);
  };
  for (const [relative, content] of Object.entries(files)) write(relative, content);
  write(ALLOWLIST_PATH, serializeAllowlist({ pattern: "paperclip", classes, entries }));
  execFileSync("git", ["-C", root, "init", "-q"]);
  execFileSync("git", ["-C", root, "add", "-A"]);
  return root;
}

function check(root) {
  const errors = [];
  const logs = [];
  const code = runCheck({ repoRoot: root, log: (m) => logs.push(m), error: (m) => errors.push(m) });
  return { code, text: errors.join("\n"), logs: logs.join("\n") };
}

function withRepo(files, entries, fn, classes) {
  const root = makeRepo(files, entries, classes);
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("passes when every occurrence is within its allowlisted count", () => {
  withRepo({ "a.ts": "const PAPERCLIP_HOME = 1;\nconst x = 2;\n", "b.ts": "wardmote\n" }, [["a.ts", 1, "belum-diganti"]], (root) => {
    assert.equal(check(root).code, 0);
  });
});

test("fails on a new file that uses the legacy name, in any letter case", () => {
  withRepo({ "a.ts": "PaPeRcLiP\n" }, [], (root) => {
    const result = check(root);
    assert.equal(result.code, 1);
    assert.match(result.text, /a\.ts: 1 new occurrence/);
  });
});

test("fails when an allowlisted file gains an occurrence", () => {
  withRepo({ "a.ts": "paperclip\nX-Paperclip-Run-Id\n" }, [["a.ts", 1, "belum-diganti"]], (root) => {
    const result = check(root);
    assert.equal(result.code, 1);
    assert.match(result.text, /a\.ts: 2 occurrence\(s\), allowlist permits 1/);
  });
});

test("counts the legacy name in a file path, including binary files", () => {
  withRepo({ "skills/paperclip/logo.bin": Buffer.from([0, 1, 2, 0]) }, [], (root) => {
    assert.deepEqual([...countOccurrences(root)], [["skills/paperclip/logo.bin", 1]]);
    assert.match(check(root).text, /skills\/paperclip\/logo\.bin: 1 new occurrence/);
  });
});

test("rejects a class without an approver and an entry with an unknown class", () => {
  const classes = { "arsip": { reason: "history", approvedBy: " " } };
  withRepo({ "a.md": "paperclip\n" }, [["a.md", 1, "lainnya"]], (root) => {
    const result = check(root);
    assert.equal(result.code, 1);
    assert.match(result.text, /class "arsip" needs a reason and approvedBy/);
    assert.match(result.text, /a\.md: unknown class "lainnya"/);
  }, classes);
});

test("a shrunk count passes and tighten lowers it without ever raising another entry", () => {
  withRepo({ "a.ts": "paperclip\n", "b.ts": "paperclip\npaperclip\n" }, [["a.ts", 3, "belum-diganti"], ["b.ts", 1, "belum-diganti"], ["gone.ts", 2, "belum-diganti"]], (root) => {
    const allowlist = JSON.parse(readFileSync(path.join(root, ALLOWLIST_PATH), "utf8"));
    assert.deepEqual(tighten(countOccurrences(root), allowlist).entries, [["a.ts", 1, "belum-diganti"], ["b.ts", 1, "belum-diganti"]]);
    assert.match(check(root).text, /b\.ts: 2 occurrence\(s\), allowlist permits 1/);
  });
});
