import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ServerAdapterModule } from "../adapters/types.js";
import { registerServerAdapter, unregisterServerAdapter } from "../adapters/registry.js";
import { adapterRoutes } from "./adapters.js";

const ADAPTER_TYPE = "first_party_ui_parser_fixture";
const PARSER_SOURCE = [
  "export function parseStdoutLine(line, ts) {",
  '  return [{ kind: "text", text: line, ts }];',
  "}",
  "",
].join("\n");

let parserDir: string;
let parserPath: string;

function buildApp() {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { actor: unknown }).actor = {
      type: "board",
      source: "local_implicit",
      isInstanceAdmin: true,
      companyIds: [],
    };
    next();
  });
  app.use("/api", adapterRoutes());
  return app;
}

beforeAll(() => {
  parserDir = fs.mkdtempSync(path.join(os.tmpdir(), "pcpro-ui-parser-"));
  parserPath = path.join(parserDir, "ui-parser.js");
  fs.writeFileSync(parserPath, PARSER_SOURCE, "utf-8");

  const adapter = {
    type: ADAPTER_TYPE,
    uiParserPath: parserPath,
    execute: async () => {
      throw new Error("not used");
    },
    testEnvironment: async () => {
      throw new Error("not used");
    },
  } satisfies Partial<ServerAdapterModule> as unknown as ServerAdapterModule;

  registerServerAdapter(adapter);
});

afterAll(() => {
  unregisterServerAdapter(ADAPTER_TYPE);
  fs.rmSync(parserDir, { recursive: true, force: true });
});

describe("GET /api/adapters/:type/ui-parser.js", () => {
  it("serves the parser declared by a statically registered adapter module", async () => {
    const res = await request(buildApp()).get(`/api/adapters/${ADAPTER_TYPE}/ui-parser.js`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/javascript");
    expect(res.text).toBe(PARSER_SOURCE);
  });

  it("still answers 404 for an adapter type nobody registered", async () => {
    const res = await request(buildApp()).get("/api/adapters/no_such_adapter_type/ui-parser.js");

    expect(res.status).toBe(404);
  });
});
