import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { findTrailerOffenses, runCheck } from "./check-no-coauthor-trailer.mjs";

const TRAILER = ["Co-Authored", "By"].join("-");

function makeRepo(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), "coauthor-guard-"));
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  git("init", "-q");
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  git("add", "-A");
  return root;
}

function capture(root) {
  const errors = [];
  const code = runCheck({ repoRoot: root, log: () => {}, error: (message) => errors.push(message) });
  return { code, errors };
}

test("passes on a repository without the trailer", () => {
  const root = makeRepo({ "skills/a/SKILL.md": "commit with the configured identity\n" });
  try {
    assert.equal(capture(root).code, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("flags an instruction that tells agents to add the trailer, with file and line", () => {
  const root = makeRepo({
    "skills/a/SKILL.md": `intro\n- you MUST add \`${TRAILER}: Paperclip <noreply@paperclip.ing>\`\n`,
  });
  try {
    const { code, errors } = capture(root);
    assert.equal(code, 1);
    assert.match(errors.join("\n"), /skills\/a\/SKILL\.md:2:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("matches regardless of case and for any model name", () => {
  const root = makeRepo({
    "docs/x.md": `${TRAILER.toLowerCase()}: Claude Opus 5.5 <noreply@anthropic.com>\n`,
  });
  try {
    assert.equal(findTrailerOffenses(root).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ignores untracked files and binary files", () => {
  const root = makeRepo({ "a.txt": "clean\n" });
  writeFileSync(path.join(root, "untracked.md"), `${TRAILER}: x\n`);
  mkdirSync(path.join(root, "bin"));
  writeFileSync(path.join(root, "bin", "blob.dat"), Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from(TRAILER)]));
  execFileSync("git", ["-C", root, "add", "bin/blob.dat"]);
  try {
    assert.equal(capture(root).code, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("excludes only its own script and test", () => {
  const root = makeRepo({
    "scripts/check-no-coauthor-trailer.mjs": `${TRAILER}\n`,
    "scripts/check-no-coauthor-trailer.test.mjs": `${TRAILER}\n`,
    "scripts/other.mjs": `${TRAILER}\n`,
  });
  try {
    const offenses = findTrailerOffenses(root);
    assert.deepEqual(offenses.map((entry) => entry.file), ["scripts/other.mjs"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
