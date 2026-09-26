import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const docsLaneVitestSuites = [
  "packages/shared/src/frontmatter.test.ts",
  "packages/shared/src/telemetry/readme-contract.test.ts",
  "packages/skills-catalog/src/release-content-cases-contract.test.ts",
  "packages/skills-catalog/src/shipped-catalog.test.ts",
  "server/src/__tests__/cli-invocation-safety.test.ts",
  "server/src/__tests__/company-skills-service.test.ts",
  "server/src/__tests__/hiring-operational-examples.test.ts",
  "server/src/__tests__/paperclip-skill-utils.test.ts",
  "server/src/services/onboarding-first-task-assets.test.ts",
];

export const docsLaneNodeTestSuites = ["scripts/prepare-npm-readme.test.mjs"];

export const dynamicDocumentationReaders = [
  "packages/shared/src/frontmatter.test.ts",
  "packages/skills-catalog/src/release-content-cases-contract.test.ts",
  "packages/skills-catalog/src/shipped-catalog.test.ts",
];

const TEST_FILE_PATTERN = /\.(test|spec)\.(?:ts|tsx|mjs|js)$/;
const DOCUMENTATION_PATH_PATTERN = /\.md$/i;
const DOCUMENTATION_PATH_PREFIXES = [
  ".github/ISSUE_TEMPLATE/",
  ".github/PULL_REQUEST_TEMPLATE/",
];
const ROOT_CONSTANT_PATTERN = /\b(?:REPO_ROOT|repoRoot|repositoryRoot|projectRoot)\b/;

export function isDocumentationPath(relPath) {
  if (DOCUMENTATION_PATH_PATTERN.test(relPath)) return true;
  if (relPath === "LICENSE") return true;
  return DOCUMENTATION_PATH_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

export function listTestFiles(root) {
  return execFileSync("git", ["ls-files"], { cwd: root, maxBuffer: 1 << 28 })
    .toString()
    .split("\n")
    .filter((file) => TEST_FILE_PATTERN.test(file))
    .sort();
}

function acceptsLiteral(line, literal) {
  if (literal.includes("${") || literal.startsWith("http")) return false;
  const hasSlash = literal.includes("/");
  if (/new URL\(/.test(line) && /import\.meta\.url/.test(line)) return hasSlash || /\.md$/i.test(literal);
  if (/path\.resolve\(/.test(line)) return hasSlash || /\.md$/i.test(literal);
  if (/path\.join\(/.test(line) && ROOT_CONSTANT_PATTERN.test(line)) return hasSlash;
  if (/\bread\(["'`]/.test(line)) return hasSlash;
  return false;
}

function candidatePaths(root, testFile, literal, line) {
  if (/new URL\(/.test(line) && /import\.meta\.url/.test(line)) {
    return [path.resolve(root, path.dirname(testFile), literal)];
  }
  return [path.resolve(root, literal), path.resolve(root, "server", literal)];
}

export function documentationReferences(root, testFile) {
  const source = readFileSync(path.join(root, testFile), "utf8");
  const references = new Set();
  for (const line of source.split("\n")) {
    for (const match of line.matchAll(/["'`]([^"'`\n]{2,240}?)["'`]/g)) {
      const literal = match[1];
      if (!acceptsLiteral(line, literal)) continue;
      for (const candidate of candidatePaths(root, testFile, literal, line)) {
        if (!candidate.startsWith(root)) continue;
        const relPath = path.relative(root, candidate);
        if (!isDocumentationPath(relPath)) continue;
        try {
          if (statSync(candidate).isFile()) {
            references.add(relPath);
            break;
          }
        } catch {
          continue;
        }
      }
    }
  }
  return [...references].sort();
}

export function findLiteralDocumentationReaders(root) {
  const vitest = [];
  const nodeTest = [];
  for (const testFile of listTestFiles(root)) {
    if (documentationReferences(root, testFile).length === 0) continue;
    if (testFile.endsWith(".test.mjs")) nodeTest.push(testFile);
    else vitest.push(testFile);
  }
  return { vitest, nodeTest };
}

export function undeclaredDocumentationReaders(root) {
  const declared = new Set([...docsLaneVitestSuites, ...docsLaneNodeTestSuites]);
  const dynamic = new Set(dynamicDocumentationReaders);
  const found = findLiteralDocumentationReaders(root);
  return [...found.vitest, ...found.nodeTest].filter(
    (testFile) => !declared.has(testFile) && !dynamic.has(testFile),
  );
}

export function absentDeclaredSuites(root) {
  return [...docsLaneVitestSuites, ...docsLaneNodeTestSuites].filter(
    (suite) => !existsSync(path.join(root, suite)),
  );
}
