import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { customProvidersFromYaml, parseLoginProviders, probeCustomProvider, upsertCustomProviderYaml } from "./providers.js";

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
        if (url.endsWith("/models")) return { status: 200, text: async () => JSON.stringify({ data: [{ id: "gpt-a" }] }) };
        if (url.endsWith("/chat/completions")) return { status: 200, text: async () => "{}" };
        return { status: 404, text: async () => "not here" };
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
      fetchImpl: async () => ({ status: 401, text: async () => "unauthorized" }),
    });
    expect(result).toMatchObject({ suggestedApi: null, models: [], usedModel: null });
    expect(result.attempts).toEqual([{ api: "models-list", url: "http://gw/v1/models", status: 401, ok: false, detail: "unauthorized" }]);
  });
});
