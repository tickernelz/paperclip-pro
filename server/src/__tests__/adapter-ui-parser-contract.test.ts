import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getUiParserSource, loadExternalAdapterPackage } from "../adapters/plugin-loader.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function adapterPackage(type: string, contract: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wardmote-adapter-ui-parser-"));
  dirs.push(dir);
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({
    name: "@example/" + type,
    type: "module",
    exports: { ".": "./index.js", "./ui-parser": "./ui-parser.js" },
    wardmote: { adapterUiParser: contract },
  }));
  await fs.writeFile(path.join(dir, "index.js"), "export function createServerAdapter() { return { type: \"" + type + "\", execute: async () => ({}), testEnvironment: async () => ({}) }; }\n");
  await fs.writeFile(path.join(dir, "ui-parser.js"), "export function parseStdoutLine() { return []; }\n");
  return dir;
}

describe("external adapter UI parser contract", () => {
  it("reads the documented wardmote.adapterUiParser version", async () => {
    await loadExternalAdapterPackage("@example/zha-ui-supported", await adapterPackage("zha-ui-supported", "1.0.0"));
    expect(getUiParserSource("zha-ui-supported")).toContain("parseStdoutLine");
  });

  it("skips a UI parser whose declared contract major is unsupported", async () => {
    await loadExternalAdapterPackage("@example/zha-ui-unsupported", await adapterPackage("zha-ui-unsupported", "2.0.0"));
    expect(getUiParserSource("zha-ui-unsupported")).toBeUndefined();
  });
});
