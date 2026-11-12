import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { customProvidersFromYaml, fetchCustomProviderModels, parseLoginProviders, probeCustomProvider, upsertCustomProviderYaml, validateModelsYamlWithOmp } from "./providers.js";

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
  it("never repeats the key an upstream error echoes", async () => {
    const result = await probeCustomProvider({
      baseUrl: "http://gw/v1",
      key: "sk-echoed-secret",
      authHeader: false,
      headers: {},
      fetchImpl: async () => new Response("bad key sk-echoed-secret", { status: 401 }),
    });
    expect(result.attempts[0].detail).toBe("bad key [redacted]");
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

describe("fetchCustomProviderModels", () => {
  type Call = { url: string; headers: Record<string, string> };
  const replying = (reply: (url: string) => Response) => {
    const calls: Call[] = [];
    return {
      calls,
      fetchImpl: async (url: string, init: { headers: Record<string, string> }) => {
        calls.push({ url, headers: init.headers });
        return reply(url);
      },
    };
  };
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
  const SECRET = "sk-stored-secret-123";

  it("reads an OpenAI list with a bearer key, keeps upstream names and drops duplicates", async () => {
    const { calls, fetchImpl } = replying(() => json({ data: [{ id: "a", name: "Model A" }, { id: "b" }, { id: "a" }, { id: "c", name: "c" }] }));
    const result = await fetchCustomProviderModels({ baseUrl: "http://gw/v1/", api: "openai-completions", key: SECRET, authHeader: false, headers: { "X-Team": "t1" }, fetchImpl });
    expect(result).toEqual({ url: "http://gw/v1/models", status: 200, truncated: false, error: null, models: [{ id: "a", name: "Model A" }, { id: "b" }, { id: "c" }] });
    expect(calls).toEqual([{ url: "http://gw/v1/models", headers: { "X-Team": "t1", authorization: `Bearer ${SECRET}` } }]);
  });

  it("reads a models[] list by id or by name", async () => {
    const { fetchImpl } = replying(() => json({ models: [{ id: "x", display_name: "X" }, { name: "llama3:8b" }, { size: 1 }] }));
    const result = await fetchCustomProviderModels({ baseUrl: "http://gw", api: null, key: null, authHeader: false, headers: {}, fetchImpl });
    expect(result.models).toEqual([{ id: "x", name: "X" }, { id: "llama3:8b" }]);
  });

  it("pages an Anthropic list with x-api-key and anthropic-version until has_more is false", async () => {
    const { calls, fetchImpl } = replying((url) => {
      const after = new URL(url).searchParams.get("after_id");
      return after === null
        ? json({ data: [{ id: "claude-a", display_name: "Claude A" }], has_more: true, last_id: "claude-a" })
        : json({ data: [{ id: "claude-b" }], has_more: false, last_id: "claude-b" });
    });
    const result = await fetchCustomProviderModels({ baseUrl: "https://api.anthropic.com/v1", api: "anthropic-messages", key: SECRET, authHeader: false, headers: {}, fetchImpl });
    expect(result.models).toEqual([{ id: "claude-a", name: "Claude A" }, { id: "claude-b" }]);
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.anthropic.com/v1/models?limit=1000",
      "https://api.anthropic.com/v1/models?limit=1000&after_id=claude-a",
    ]);
    expect(calls[0].headers).toEqual({ "anthropic-version": "2023-06-01", "x-api-key": SECRET });
  });

  it("sends an Anthropic key as Authorization when the provider asks for it", async () => {
    const { calls, fetchImpl } = replying(() => json({ data: [{ id: "m" }], has_more: false }));
    await fetchCustomProviderModels({ baseUrl: "https://proxy/v1", api: "anthropic-messages", key: SECRET, authHeader: true, headers: {}, fetchImpl });
    expect(calls[0].headers).toEqual({ "anthropic-version": "2023-06-01", authorization: `Bearer ${SECRET}` });
  });

  it("stops paging at the total deadline and keeps the models read so far", async () => {
    const slow = (signal: AbortSignal, reply: () => Response) => new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(reply()), 20);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(signal.reason);
      }, { once: true });
    });
    let pages = 0;
    const endless = await fetchCustomProviderModels({
      baseUrl: "http://gw/v1",
      api: "anthropic-messages",
      key: null,
      authHeader: false,
      headers: {},
      totalTimeoutMs: 150,
      fetchImpl: async (_url, init) => slow(init.signal, () => {
        pages += 1;
        return json({ data: [{ id: `m${pages}` }], has_more: true, last_id: `m${pages}` });
      }),
    });
    expect(endless).toMatchObject({ truncated: true, error: null });
    expect(endless.models.length).toBeGreaterThan(0);
    expect(endless.models.length).toBeLessThan(50);

    const silent = await fetchCustomProviderModels({
      baseUrl: "http://gw/v1",
      api: null,
      key: null,
      authHeader: false,
      headers: {},
      totalTimeoutMs: 50,
      fetchImpl: async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true })),
    });
    expect(silent).toMatchObject({ models: [], error: "http://gw/v1/models did not finish listing models within 0.05 s." });
  });

  it("explains failures without repeating the key or header values", async () => {
    const run = (reply: () => Response | Promise<Response>) =>
      fetchCustomProviderModels({ baseUrl: "http://gw/v1", api: null, key: SECRET, authHeader: false, headers: { "X-Org": "org-secret-value" }, fetchImpl: async () => reply() });
    const rejected = await run(() => new Response(`invalid key ${SECRET} for org-secret-value`, { status: 401 }));
    expect(rejected).toMatchObject({ status: 401, models: [] });
    expect(rejected.error).toBe("http://gw/v1/models answered 401: the provider rejected the key or headers. invalid key [redacted] for [redacted]");
    expect((await run(() => new Response("nope", { status: 404 }))).error).toContain("answered 404: there is no model list at this address");
    expect((await run(() => new Response(`<html>${SECRET}</html>`, { status: 200 }))).error).toBe("http://gw/v1/models did not answer with JSON: <html>[redacted]</html>");
    expect((await run(() => json({ object: "list" }))).error).toContain("without a model list");
    expect((await run(() => json({ data: [] }))).error).toBe("http://gw/v1/models listed no models.");
    expect((await run(() => Promise.reject(Object.assign(new Error("timed out"), { name: "TimeoutError" })))).error).toBe("http://gw/v1/models did not answer within 15 s.");
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
