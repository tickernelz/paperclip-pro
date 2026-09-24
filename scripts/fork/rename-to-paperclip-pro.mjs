#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const SCOPE = "@tickernelz";
const PREFIX = "paperclip-pro";
const CLI_PACKAGE = `${SCOPE}/${PREFIX}`;
const CLI_BIN = PREFIX;
const TARBALL_STEM = "tickernelz-paperclip-pro";
const HOME_DIR = ".paperclip-pro";
const FORK_REPO = "https://github.com/tickernelz/paperclip-pro";

const SKIP_PREFIXES = ["releases/", "screenshots/", "report/"];
const SKIP_FILES = new Set(["pnpm-lock.yaml", "scripts/fork/rename-to-paperclip-pro.mjs"]);

const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const r = (source, replacement) => ({ source, replacement });
const lit = (from, to) => ({ source: escapeRe(from), replacement: to.replace(/\$/g, "$$$$") });

const guarded = (anchor, sentinel, to) => ({
  source: escapeRe(anchor),
  replacement: to.replace(/\$/g, "$$$$"),
  skipWhenPresent: sentinel,
});

const SCOPED_PACKAGE_RULES = [
  r(String.raw`@paperclipai\\/`, `${SCOPE}${String.raw`\/`}${PREFIX}-`),
  r(String.raw`"@paperclipai",(\s*)"([A-Za-z0-9][A-Za-z0-9._-]*)"`, `"${SCOPE}",$1"${PREFIX}-$2"`),
  r(String.raw`@paperclipai/`, `${SCOPE}/${PREFIX}-`),
  r(String.raw`@paperclipai:`, `${SCOPE}:`),
  r(String.raw`@paperclipai\b`, SCOPE),
];

const CLI_PACKAGE_RULES = [
  r(String.raw`node_modules/paperclipai/`, `node_modules/${SCOPE}/${PREFIX}/`),
  r(String.raw`("node_modules",\s*)"paperclipai"`, `$1"${SCOPE}", "${PREFIX}"`),
  r(String.raw`\bpaperclipai/(dist|package\.json)`, `${CLI_PACKAGE}/$1`),
  r(String.raw`\bpaperclipai@`, `${CLI_PACKAGE}@`),
  r(String.raw`\bnpx paperclipai\b`, `npx ${CLI_PACKAGE}`),
  r(String.raw`"name": "paperclipai"`, `"name": "${CLI_PACKAGE}"`),
  r(String.raw`name: "paperclipai"`, `name: "${CLI_PACKAGE}"`),
  r(String.raw`paperclipai-(\$\{metadata\.version\}|<version>)\.tgz`, `${TARBALL_STEM}-$1.tgz`),
  r(String.raw`"paperclipai": "\./dist/index\.js"`, `"${CLI_BIN}": "./dist/index.js"`),
  r(String.raw`"paperclipai": "node cli/`, `"${CLI_BIN}": "node cli/`),
];

const HOME_RULES = [
  r(String.raw`~/\.paperclip(?![-A-Za-z0-9])`, `~/${HOME_DIR}`),
  r(String.raw`(\$\{?(?:HOME|PC_HOME)\}?"?)/\.paperclip(?![-A-Za-z0-9])`, `$1/${HOME_DIR}`),
  r(String.raw`(homedir\(\),\s*)"\.paperclip"`, `$1"${HOME_DIR}"`),
];

const PACKAGE_JSON_RULES = [
  r(String.raw`https://github\.com/paperclipai/paperclip(?![-\w])`, FORK_REPO),
];

const ISOLATION_REGRESSION_TESTS = {
  "cli/src/__tests__/install-store.test.ts": [
    guarded(
      `} from "../install-store.js";`,
      `resolveServiceShimPath`,
      `} from "../install-store.js";\nimport { resolveServiceShimPath } from "../services/service-manager.js";`,
    ),
    guarded(
      `    expect(() => writeManagedShim(paths)).toThrow("multiply linked shim");\n  });`,
      `PAPERCLIP_SHIM_PATH points`,
      [
        `    expect(() => writeManagedShim(paths)).toThrow("multiply linked shim");`,
        `  });`,
        ``,
        `  it("places the shim where PAPERCLIP_SHIM_PATH points, matching the service manager", () => {`,
        `    const override = path.join(root, "isolated", "bin", "${CLI_BIN}");`,
        `    const previous = process.env.PAPERCLIP_SHIM_PATH;`,
        `    process.env.PAPERCLIP_SHIM_PATH = override;`,
        `    try {`,
        `      expect(resolveInstallStorePaths({ homeDir: path.join(root, "home") }).shimPath).toBe(override);`,
        `      expect(resolveServiceShimPath(path.join(root, "home"))).toBe(override);`,
        `    } finally {`,
        `      if (previous === undefined) delete process.env.PAPERCLIP_SHIM_PATH;`,
        `      else process.env.PAPERCLIP_SHIM_PATH = previous;`,
        `    }`,
        ``,
        `    expect(resolveInstallStorePaths({ homeDir: path.join(root, "home") }).shimPath).toBe(`,
        `      path.join(root, "home", ".local", "bin", "${CLI_BIN}"),`,
        `    );`,
        `  });`,
      ].join("\n"),
    ),
  ],
  "server/src/__tests__/plugin-local-folders.test.ts": [
    guarded(
      `  deletePluginLocalFolderFile,`,
      `defaultLocalFolderBasePath`,
      `  deletePluginLocalFolderFile,\n  defaultLocalFolderBasePath,`,
    ),
    guarded(
      `      expect(await fs.readdir(outside)).toEqual([]);\n    } finally {\n      openSpy.mockRestore();\n    }\n  });`,
      `roots default plugin data`,
      [
        `      expect(await fs.readdir(outside)).toEqual([]);`,
        `    } finally {`,
        `      openSpy.mockRestore();`,
        `    }`,
        `  });`,
        ``,
        `  it("roots default plugin data in the configured Paperclip home, not the real user home", () => {`,
        `    const previous = process.env.PAPERCLIP_HOME;`,
        `    process.env.PAPERCLIP_HOME = path.join(os.tmpdir(), "paperclip-plugin-home-probe");`,
        `    try {`,
        `      expect(defaultLocalFolderBasePath("acme.plugin", "company-1")).toBe(`,
        `        path.join(os.tmpdir(), "paperclip-plugin-home-probe", "plugin-data", "company-1", "acme.plugin"),`,
        `      );`,
        `    } finally {`,
        `      if (previous === undefined) delete process.env.PAPERCLIP_HOME;`,
        `      else process.env.PAPERCLIP_HOME = previous;`,
        `    }`,
        `  });`,
      ].join("\n"),
    ),
  ],
  "cli/src/__tests__/worktree.test.ts": [
    guarded(
      `  it("preserves the source config path across worktree:make cwd changes", () => {`,
      `resolves --from-instance against the configured Paperclip home`,
      [
        `  it("resolves --from-instance against the configured Paperclip home, not the real user home", () => {`,
        `    const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-worktree-home-"));`,
        `    const previous = process.env.PAPERCLIP_HOME;`,
        `    process.env.PAPERCLIP_HOME = isolatedHome;`,
        ``,
        `    try {`,
        `      expect(resolveSourceConfigPath({ fromInstance: "team-a" })).toBe(`,
        `        path.resolve(isolatedHome, "instances", "team-a", "config.json"),`,
        `      );`,
        `    } finally {`,
        `      if (previous === undefined) delete process.env.PAPERCLIP_HOME;`,
        `      else process.env.PAPERCLIP_HOME = previous;`,
        `      fs.rmSync(isolatedHome, { recursive: true, force: true });`,
        `    }`,
        `  });`,
        ``,
        `  it("preserves the source config path across worktree:make cwd changes", () => {`,
      ].join("\n"),
    ),
  ],
};

const FILE_RULES = {
  "cli/src/install-store.ts": [
    lit(
      `shimPath: path.join(homeDir, ".local", "bin", "paperclipai"),`,
      `shimPath: process.env.PAPERCLIP_SHIM_PATH?.trim() || path.join(homeDir, ".local", "bin", "${CLI_BIN}"),`,
    ),
  ],
  "cli/src/commands/worktree.ts": [
    lit(
      `import { expandHomePrefix } from "../config/home.js";`,
      `import { expandHomePrefix, resolvePaperclipHomeDir } from "../config/home.js";`,
    ),
    lit(
      `const sourceHome = path.resolve(expandHomePrefix(opts.fromDataDir ?? "~/.paperclip"));`,
      `const sourceHome = opts.fromDataDir ? path.resolve(expandHomePrefix(opts.fromDataDir)) : resolvePaperclipHomeDir();`,
    ),
  ],
  "server/src/services/plugin-local-folders.ts": [
    lit(`import os from "node:os";\n`, ``),
    r(
      String.raw`import \{ badRequest, forbidden, notFound \} from "\.\./errors\.js";(?!\nimport \{ resolvePaperclipHomeDir \})`,
      `import { badRequest, forbidden, notFound } from "../errors.js";\nimport { resolvePaperclipHomeDir } from "../home-paths.js";`,
    ),
    lit(
      `return path.join(os.homedir(), ".paperclip", "plugin-data", companyId, pluginKey);`,
      `return path.join(resolvePaperclipHomeDir(), "plugin-data", companyId, pluginKey);`,
    ),
  ],
  "cli/src/__tests__/http.test.ts": [
    lit(String.raw`npx paperclipai run/`, String.raw`npx @tickernelz\/paperclip-pro run/`),
  ],
  "cli/src/__tests__/install-command.test.ts": [
    lit(`? "paperclipai-db" : "paperclipai"`, `? "${PREFIX}-db" : "${TARBALL_STEM}"`),
  ],
  "scripts/__tests__/release-dry-run-notes.test.mjs": [
    lit(`{"paperclipai":[]}`, `{"${CLI_PACKAGE}":[]}`),
  ],
  "scripts/install.sh": [lit(`PAPERCLIP_PACKAGE="paperclipai"`, `PAPERCLIP_PACKAGE="${CLI_PACKAGE}"`)],
  "scripts/release-package-map.mjs": [
    lit(`CHANNEL_ENTRYPOINT_PACKAGE = "paperclipai"`, `CHANNEL_ENTRYPOINT_PACKAGE = "${CLI_PACKAGE}"`),
  ],
  "scripts/link-plugin-dev-sdk.mjs": [lit(`join(scopeDir, "plugin-sdk")`, `join(scopeDir, "${PREFIX}-plugin-sdk")`)],
  "scripts/link-plugin-dev-sdk.test.js": [lit(`join(scopeDir, "plugin-sdk")`, `join(scopeDir, "${PREFIX}-plugin-sdk")`)],
  "server/src/__tests__/workspace-runtime.test.ts": [
    lit(`(serverNodeModulesScopeDir, "db")`, `(serverNodeModulesScopeDir, "${PREFIX}-db")`),
  ],
  "scripts/bootstrap-npm-package.mjs": [
    lit(`Add repository paperclipai/paperclip`, `Add repository tickernelz/paperclip-pro`),
    ...PACKAGE_JSON_RULES,
  ],
  ...ISOLATION_REGRESSION_TESTS,
};

const PROTECTED = [
  { why: "upstream GitHub org, repositories and their paths", source: String.raw`paperclipai/` },
  { why: "skill and catalog identity namespaces", source: String.raw`paperclipai:` },
  {
    why: "plugin, connector and OCI label namespaces",
    source: String.raw`paperclipai\.(?:plugin-|content-machine|schema\.)`,
  },
  { why: "plugin skill keys", source: String.raw`paperclipai-plugin-llm-wiki` },
  { why: "upstream checkout directory naming", source: String.raw`paperclipai-paperclip/` },
  { why: "upstream-owned S3 bucket", source: String.raw`paperclipai-runner-e2e-history` },
  {
    why: "GitHub organisation login literals",
    source: String.raw`(?:owner|login)(?:"?\s*:\s*|\s*!==\s*)"paperclipai"`,
  },
  { why: "GitHub organisation login literals", source: String.raw`\["paperclipai"\]` },
];

const DEFAULT_RULE = r(String.raw`\bpaperclipai\b`, CLI_BIN);

const DERIVED_ARTIFACTS = ["packages/paperclip-runner/scripts/generate-protocol-manifest.mjs"];

function regenerateDerived(check) {
  const failures = [];
  for (const relativePath of DERIVED_ARTIFACTS) {
    const target = path.join(repoRoot, relativePath);
    if (!fs.existsSync(target)) continue;
    try {
      execFileSync(process.execPath, check ? [target, "--check"] : [target], { cwd: repoRoot, stdio: "pipe" });
    } catch {
      failures.push(relativePath);
    }
  }
  return failures;
}

function collect(text, claims, source, replacement) {
  const find = new RegExp(source, "g");
  const single = new RegExp(source);
  for (const match of text.matchAll(find)) {
    const start = match.index;
    const end = start + match[0].length;
    if (claims.some((claim) => start < claim.end && end > claim.start)) continue;
    claims.push({ start, end, text: replacement === null ? match[0] : match[0].replace(single, replacement) });
  }
}

function transform(relativePath, text) {
  const groups = [
    ...(FILE_RULES[relativePath] ?? []),
    ...(path.basename(relativePath) === "package.json" ? PACKAGE_JSON_RULES : []),
    ...SCOPED_PACKAGE_RULES,
    ...CLI_PACKAGE_RULES,
    ...HOME_RULES,
  ];
  const claims = [];
  for (const item of groups) {
    if (item.skipWhenPresent && text.includes(item.skipWhenPresent)) continue;
    collect(text, claims, item.source, item.replacement);
  }
  const retained = new Map();
  for (const item of PROTECTED) {
    const before = claims.length;
    collect(text, claims, item.source, null);
    if (claims.length > before) retained.set(item.why, (retained.get(item.why) ?? 0) + claims.length - before);
  }
  collect(text, claims, DEFAULT_RULE.source, DEFAULT_RULE.replacement);
  claims.sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  let changes = 0;
  for (const claim of claims) {
    out += text.slice(cursor, claim.start) + claim.text;
    if (claim.text !== text.slice(claim.start, claim.end)) changes += 1;
    cursor = claim.end;
  }
  return { text: out + text.slice(cursor), changes, retained };
}

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 })
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((entry) => !SKIP_FILES.has(entry))
    .filter((entry) => !SKIP_PREFIXES.some((prefix) => entry.startsWith(prefix)));
}

function main() {
  const check = process.argv.includes("--check");
  const residual = [];
  const retainedTotals = new Map();
  let changedFiles = 0;
  let changedOccurrences = 0;

  for (const relativePath of trackedFiles()) {
    const absolutePath = path.join(repoRoot, relativePath);
    let raw;
    try {
      raw = fs.readFileSync(absolutePath);
    } catch {
      continue;
    }
    const text = raw.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(raw)) continue;
    if (!text.includes("paperclipai") && !text.includes(".paperclip")) continue;
    const result = transform(relativePath, text);
    for (const [why, count] of result.retained) retainedTotals.set(why, (retainedTotals.get(why) ?? 0) + count);
    if (result.text === text) continue;
    changedFiles += 1;
    changedOccurrences += result.changes;
    if (check) residual.push({ relativePath, changes: result.changes });
    else fs.writeFileSync(absolutePath, result.text);
  }

  const retainedLines = [...retainedTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([why, count]) => `  ${String(count).padStart(6)}  ${why}`);

  const derivedFailures = regenerateDerived(check);

  if (check) {
    for (const relativePath of derivedFailures) console.log(`stale derived artefact: ${relativePath}`);
    console.log(`residual files: ${residual.length}`);
    console.log(`residual occurrences: ${changedOccurrences}`);
    for (const entry of residual.slice(0, 50)) console.log(`  ${entry.changes}  ${entry.relativePath}`);
    console.log("intentionally retained occurrences:");
    for (const line of retainedLines) console.log(line);
    process.exitCode = residual.length === 0 && derivedFailures.length === 0 ? 0 : 1;
    return;
  }

  for (const relativePath of derivedFailures) console.log(`could not regenerate ${relativePath}`);
  console.log(`rewrote ${changedOccurrences} occurrences across ${changedFiles} files`);
  console.log("intentionally retained occurrences:");
  for (const line of retainedLines) console.log(line);
  console.log("regenerate the lockfile with: pnpm install --no-frozen-lockfile");
}

main();
