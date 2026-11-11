import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { customProvidersFromYaml, parseLoginProviders, probeCustomProvider, upsertCustomProviderYaml, validateModelsYamlWithOmp } from "./providers.js";

const BASE = {
  baseUrl: "https://gw.example.com/v1",
  api: "openai-completions" as const,
  apiKey: { kind: "keep" as const },
  authHeader: false,
  disableStrictTools: false,
  headers: [],
  discovery: null,
  models: [{ id: "m1", contextWindow: 1000 }],
};

describe("parseLoginProviders", () => {
  it("reads the numbered picker in order, including names with dots and parentheses", () => {
    const output = "\u001b[1mSelect a provider:\u001b[0m\n\n  1. ChatGPT Plus/Pro (Codex Subscription)\n  2. Z.AI (GLM Coding Plan \u00b7 Sign in)\n  10. Ignored out of order\n\nEnter number (1-2): ";
    expect(parseLoginProviders(output)).toEqual(["ChatGPT Plus/Pro (Codex Subscription)", "Z.AI (GLM Coding Plan \u00b7 Sign in)"]);
  });
});

describe("upsertCustomProviderYaml", () => {
  it("keeps keys and model fields the form does not manage", () => {
    const before = [
      "providers:",
      "  gw:",
      "    baseUrl: http://old/v1",
      "    apiKey: GW_KEY",
      "    compat:",
      "      supportsStore: false",
      "    models:",
      "      - id: m1",
      "        cost: { input: 1, output: 2 }",
      "        contextWindow: 10",
      "      - id: gone",
      "",
    ].join("\n");
    const after = parseYaml(upsertCustomProviderYaml(before, "gw", BASE)) as { providers: { gw: Record<string, unknown> } };
    expect(after.providers.gw).toEqual({
      baseUrl: "https://gw.example.com/v1",
      apiKey: "GW_KEY",
      compat: { supportsStore: false },
      api: "openai-completions",
      models: [{ id: "m1", cost: { input: 1, output: 2 }, contextWindow: 1000 }],
    });
  });

  it("switches between a key and auth none both ways", () => {
    const none = upsertCustomProviderYaml("", "local", { ...BASE, apiKey: { kind: "none" } });
    expect(parseYaml(none).providers.local).toMatchObject({ auth: "none" });
    expect(parseYaml(none).providers.local.apiKey).toBeUndefined();
    const command = upsertCustomProviderYaml(none, "local", { ...BASE, apiKey: { kind: "command", command: "op read op://x" } });
    expect(parseYaml(command).providers.local.apiKey).toBe("!op read op://x");
    expect(parseYaml(command).providers.local.auth).toBeUndefined();
    expect(customProvidersFromYaml(command, {})[0].apiKey).toEqual({ kind: "command" });
  });

  it("reports an env key and whether the server has it", () => {
    const text = upsertCustomProviderYaml("", "gw", { ...BASE, apiKey: { kind: "env", name: "GW_KEY" } });
    expect(customProvidersFromYaml(text, { GW_KEY: "x" })[0].apiKey).toEqual({ kind: "env", name: "GW_KEY", present: true });
    expect(customProvidersFromYaml(text, {})[0].apiKey).toEqual({ kind: "env", name: "GW_KEY", present: false });
  });

  it("refuses a file that is not a mapping instead of overwriting it", () => {
    expect(() => upsertCustomProviderYaml("- a\n- b\n", "gw", { ...BASE, apiKey: { kind: "none" } })).toThrow(/mapping/);
  });
});

describe("probeCustomProvider", () => {
  it("suggests the first wire that answers and uses the listed model", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const result = await probeCustomProvider({
      baseUrl: "http://gw/v1/",
      key: "k",
      authHeader: false,
      headers: {},
      fetchImpl: async (url, init) => {
        calls.push({ url, headers: init.headers });
        if (url.endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "gpt-a" }] }), { status: 200 });
        if (url.endsWith("/chat/completions")) return new Response("{}", { status: 200 });
        return new Response("not here", { status: 404 });
      },
    });
    expect(result).toMatchObject({ suggestedApi: "openai-completions", models: ["gpt-a"], usedModel: "gpt-a" });
    expect(calls.map((call) => call.url)).toEqual([
      "http://gw/v1/models",
      "http://gw/v1/responses",
      "http://gw/v1/chat/completions",
      "http://gw/v1/messages",
    ]);
    expect(calls[2].headers.authorization).toBe("Bearer k");
    expect(calls[3].headers["x-api-key"]).toBe("k");
  });

  it("stops after the model list when there is no model to try", async () => {
    const result = await probeCustomProvider({
      baseUrl: "http://gw/v1",
      key: null,
      authHeader: false,
      headers: {},
      fetchImpl: async () => new Response("unauthorized", { status: 401 }),
    });
    expect(result).toMatchObject({ suggestedApi: null, models: [], usedModel: null });
    expect(result.attempts).toEqual([{ api: "models-list", url: "http://gw/v1/models", status: 401, ok: false, detail: "unauthorized" }]);
  });
  it("stops reading a reply that never ends", async () => {
    let chunks = 0;
    const endless = () => new ReadableStream<Uint8Array>({
      pull(controller) {
        chunks += 1;
        controller.enqueue(new Uint8Array(1024 * 1024).fill(0x61));
      },
    });
    const result = await probeCustomProvider({
      baseUrl: "http://gw/v1",
      key: null,
      authHeader: false,
      headers: {},
      fetchImpl: async () => new Response(endless(), { status: 500 }),
    });
    expect(result.attempts[0]).toMatchObject({ status: 500, ok: false });
    expect(result.attempts[0].detail).toHaveLength(240);
    expect(chunks).toBeLessThanOrEqual(10);
  });
});

describe("validateModelsYamlWithOmp", () => {
  it.skipIf(process.platform === "win32")("refuses the file when omp cannot check it instead of passing it", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wardmote-omp-stub-"));
    try {
      const noJson = path.join(dir, "omp-no-json");
      await fs.writeFile(noJson, "#!/bin/sh\necho 'unknown command models'\n", { mode: 0o755 });
      const failing = path.join(dir, "omp-failing");
      await fs.writeFile(failing, "#!/bin/sh\necho '{\"models\":[]}'\nexit 3\n", { mode: 0o755 });
      const listing = path.join(dir, "omp-ok");
      await fs.writeFile(listing, "#!/bin/sh\necho '{\"models\":[]}'\n", { mode: 0o755 });
      const text = "providers: {}\n";
      expect(await validateModelsYamlWithOmp(path.join(dir, "missing-omp"), {}, text)).toHaveLength(1);
      expect((await validateModelsYamlWithOmp(noJson, {}, text))[0]).toMatch(/no model list/);
      expect((await validateModelsYamlWithOmp(failing, {}, text))[0]).toMatch(/exit 3/);
      expect(await validateModelsYamlWithOmp(listing, {}, text)).toEqual([]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
