import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCustomProviderModels } from "@tickernelz/wardmote-adapter-omp-local/providers";
import type { OmpInstallProbe } from "@tickernelz/wardmote-adapter-omp-local/readiness";
import { errorHandler } from "../middleware/index.js";
import { onboardingOmpRoutes, type OnboardingOmpDeps } from "../routes/onboarding-omp.js";

const ADMIN = { type: "board", source: "local_implicit", userId: "local-board", isInstanceAdmin: true };
const MEMBER = { type: "board", source: "session", userId: "member", isInstanceAdmin: false, companyIds: [] };
const homes: string[] = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function probeOf(state: OmpInstallProbe["state"], version: string | null): OmpInstallProbe {
  return { state, version, path: version ? "/home/u/.local/bin/omp" : null, copies: [], minVersion: "18.1.16" };
}

async function appWith(overrides: Partial<OnboardingOmpDeps>, actor: object = ADMIN) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "onboarding-omp-home-"));
  homes.push(home);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { actor: object }).actor = actor;
    next();
  });
  app.use("/api", onboardingOmpRoutes({
    env: {},
    platform: "linux",
    home,
    listModels: async () => [],
    refreshModels: async () => [],
    checkNetwork: async () => true,
    ompEnv: () => ({}),
    ...overrides,
  }));
  app.use(errorHandler);
  return { app, home };
}

function fakeLoginChild(lines: string[]) {
  const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; stdin: PassThrough; kill: ReturnType<typeof vi.fn> };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = vi.fn(() => {
    child.emit("close", null);
    return true;
  });
  setImmediate(() => {
    for (const line of lines) child.stdout.write(`${line}\n`);
  });
  return child;
}

describe("GET /api/onboarding/omp", () => {
  it("reports a missing OMP with the install command and the network check", async () => {
    const { app, home } = await appWith({ probe: async () => probeOf("missing", null), checkNetwork: async () => false });
    const res = await request(app).get("/api/onboarding/omp?network=1");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      runtime: "local",
      state: "missing",
      minVersion: "18.1.16",
      installCommand: "curl -fsSL https://omp.sh/install | sh",
      network: "offline",
      models: [],
      projectFolder: home,
      os: { label: "Linux" },
    });
  });

  it("lists models and recommends OMP's own default once OMP is ready", async () => {
    const { app } = await appWith({
      probe: async () => probeOf("ready", "18.18.0"),
      listModels: async () => [{ id: "openai/gpt-6", label: "GPT 6" }, { id: "anthropic/opus", label: "Opus" }],
    });
    const res = await request(app).get("/api/onboarding/omp");
    expect(res.body).toMatchObject({ state: "ready", version: "18.18.0", recommendedModel: "openai/gpt-6", network: null });
    expect(res.body.models).toHaveLength(2);
  });

  it("refreshes an empty model list so a fresh sign-in shows up on the next poll", async () => {
    const refreshModels = vi.fn(async () => [{ id: "anthropic/opus", label: "Opus", provider: "anthropic" }]);
    const { app } = await appWith({ probe: async () => probeOf("ready", "18.18.0"), listModels: async () => [], refreshModels });
    const res = await request(app).get("/api/onboarding/omp");
    expect(refreshModels).toHaveBeenCalledTimes(1);
    expect(res.body.models).toEqual([{ id: "anthropic/opus", label: "Opus", provider: "anthropic" }]);
  });

  it("probes a chosen omp file", async () => {
    const probe = vi.fn(async () => probeOf("too_old", "18.0.2"));
    const { app } = await appWith({ probe });
    const res = await request(app).get("/api/onboarding/omp").query({ command: "/media/usb/omp" });
    expect(probe).toHaveBeenCalledWith("/media/usb/omp");
    expect(res.body).toMatchObject({ state: "too_old", updateCommand: "omp update" });
  });

  it("is ready in the Docker image without probing the gate", async () => {
    const { app } = await appWith({
      env: { WARDMOTE_OMP_BUNDLED_VERSION: "18.18.0" },
      probe: async () => probeOf("missing", null),
    });
    const res = await request(app).get("/api/onboarding/omp");
    expect(res.body).toMatchObject({ runtime: "bundled", state: "ready", version: "18.18.0" });
  });

  it("is limited to instance admins", async () => {
    const { app } = await appWith({ probe: async () => probeOf("ready", "18.18.0") }, MEMBER);
    expect((await request(app).get("/api/onboarding/omp")).status).toBe(403);
  });
});

describe("GET /api/onboarding/omp/browse", () => {
  it("lists folders and omp files only, folders first", async () => {
    const { app, home } = await appWith({});
    await fs.mkdir(path.join(home, "bin"));
    await fs.mkdir(path.join(home, ".cache"));
    await fs.writeFile(path.join(home, "omp"), "");
    await fs.writeFile(path.join(home, "notes.txt"), "");
    const res = await request(app).get("/api/onboarding/omp/browse");
    expect(res.status).toBe(200);
    expect(res.body.path).toBe(home);
    expect(res.body.entries).toEqual([
      { name: "bin", path: path.join(home, "bin"), kind: "directory" },
      { name: "omp", path: path.join(home, "omp"), kind: "file" },
    ]);
  });

  it("rejects relative paths and non-admins", async () => {
    const { app } = await appWith({});
    expect((await request(app).get("/api/onboarding/omp/browse").query({ path: "etc" })).status).toBe(400);
    const member = await appWith({}, MEMBER);
    expect((await request(member.app).get("/api/onboarding/omp/browse")).status).toBe(403);
  });
});

describe("OMP sign-in", () => {
  const PICKER = "Select a provider:\n\n  1. ChatGPT Plus/Pro (Codex Subscription)\n  2. Anthropic (Claude Pro/Max)\n\nEnter number (1-2): ";

  function scriptedOmp(onLine: (child: ReturnType<typeof fakeLoginChild>, line: string, index: number) => void) {
    const child = fakeLoginChild([]);
    let buffer = "";
    let index = 0;
    child.stdin.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        onLine(child, line, index);
        index += 1;
        newline = buffer.indexOf("\n");
      }
    });
    setImmediate(() => child.stdout.write(PICKER));
    return child;
  }

  it("lists the providers omp login offers", async () => {
    const child = fakeLoginChild([]);
    setImmediate(() => child.stdout.write(PICKER));
    const spawnOmp = vi.fn(() => child as never);
    const { app } = await appWith({ probe: async () => probeOf("ready", "18.18.8"), spawnOmp, ompEnv: () => ({ OMP_PROFILE: "test" }) });
    const res = await request(app).get("/api/onboarding/omp/login/providers");
    expect(res.status).toBe(200);
    expect(res.body.providers).toEqual(["ChatGPT Plus/Pro (Codex Subscription)", "Anthropic (Claude Pro/Max)"]);
    expect(spawnOmp).toHaveBeenCalledWith("/home/u/.local/bin/omp", ["login"], { OMP_PROFILE: "test" });
    expect(child.kill).toHaveBeenCalled();
  });

  it("picks the provider, takes a pasted redirect URL for a remote browser, and never returns it", async () => {
    const pasted = "http://localhost:54545/callback?code=SECRET-CODE-123&state=s";
    const child = scriptedOmp((fake, line, index) => {
      if (index === 0) {
        expect(line).toBe("2");
        fake.stdout.write("Open this link:\nhttps://claude.ai/oauth/authorize?state=s\nIf the browser cannot reach this machine, paste the final redirect URL or authorization code when prompted.\nPaste the authorization code (or full redirect URL): ");
      } else {
        fake.stdout.write(`Received ${line}\nLogged in to Anthropic (Claude Pro/Max)\nCredentials saved to /tmp/agent.db\n`);
        setImmediate(() => fake.emit("close", 0));
      }
    });
    const refreshModels = vi.fn(async () => []);
    const { app } = await appWith({ probe: async () => probeOf("ready", "18.18.8"), spawnOmp: () => child as never, refreshModels });
    const started = await request(app).post("/api/onboarding/omp/login").send({ provider: "Anthropic (Claude Pro/Max)" });
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({
      state: "waiting",
      url: "https://claude.ai/oauth/authorize?state=s",
      prompt: { label: "Paste the authorization code (or full redirect URL):", secret: false },
    });
    const finished = await request(app).post(`/api/onboarding/omp/login/${started.body.id}/input`).send({ value: pasted });
    expect(finished.status).toBe(200);
    expect(finished.body).toMatchObject({ state: "succeeded", prompt: null, message: "Logged in to Anthropic (Claude Pro/Max)" });
    expect(JSON.stringify(finished.body)).not.toContain("SECRET-CODE-123");
    expect(refreshModels).toHaveBeenCalled();
    const later = await request(app).get(`/api/onboarding/omp/login/${started.body.id}`);
    expect(later.body.state).toBe("succeeded");
  });

  it("refuses a pasted value with line breaks so it cannot answer more than one OMP prompt", async () => {
    const writes: string[] = [];
    const child = scriptedOmp((fake, line) => {
      writes.push(line);
      fake.stdout.write("Paste the authorization code (or full redirect URL): ");
    });
    const { app } = await appWith({ probe: async () => probeOf("ready", "18.18.8"), spawnOmp: () => child as never });
    const started = await request(app).post("/api/onboarding/omp/login").send({ provider: "Anthropic (Claude Pro/Max)" });
    const res = await request(app).post(`/api/onboarding/omp/login/${started.body.id}/input`).send({ value: "code-a\n2" });
    expect(res.status).toBe(400);
    expect(writes).toEqual(["2"]);
  });

  it("explains a pasted value OMP asks for again instead of repeating the prompt", async () => {
    const prompt = "Paste the authorization code (or full redirect URL): ";
    const child = scriptedOmp((fake, _line, index) => {
      fake.stdout.write(index === 0 ? `https://claude.ai/oauth/authorize?state=s\n${prompt}` : prompt);
    });
    const { app } = await appWith({ probe: async () => probeOf("ready", "18.18.8"), spawnOmp: () => child as never });
    const started = await request(app).post("/api/onboarding/omp/login").send({ provider: "Anthropic (Claude Pro/Max)" });
    const again = await request(app).post(`/api/onboarding/omp/login/${started.body.id}/input`).send({ value: "http://localhost:54545/callback?code=wrong-state" });
    expect(again.body).toMatchObject({ state: "waiting", prompt: { label: prompt.trim(), secret: false } });
    expect(again.body.message).toContain("did not accept that value");
  });

  it("marks an API key prompt as secret and reports OMP's own failure text", async () => {
    const child = scriptedOmp((fake, _line, index) => {
      if (index === 0) fake.stdout.write("Get a key at https://console.x.ai\nPaste your xAI API key (xai-...): ");
      else {
        fake.stdout.write("Login failed: Invalid API key\n");
        setImmediate(() => fake.emit("close", 0));
      }
    });
    const { app } = await appWith({ probe: async () => probeOf("ready", "18.18.8"), spawnOmp: () => child as never });
    const started = await request(app).post("/api/onboarding/omp/login").send({ provider: "ChatGPT Plus/Pro (Codex Subscription)" });
    expect(started.body.prompt).toEqual({ label: "Paste your xAI API key (xai-...):", secret: true });
    const failed = await request(app).post(`/api/onboarding/omp/login/${started.body.id}/input`).send({ value: "xai-123" });
    expect(failed.body).toMatchObject({ state: "failed", message: "Invalid API key" });
  });

  it("fails with a fix when the provider is not in OMP's list, and rejects an outdated OMP", async () => {
    const child = scriptedOmp(() => undefined);
    const { app } = await appWith({ probe: async () => probeOf("ready", "18.18.8"), spawnOmp: () => child as never });
    const res = await request(app).post("/api/onboarding/omp/login").send({ provider: "Nope" });
    expect(res.body).toMatchObject({ state: "failed", message: 'OMP does not offer "Nope". Reload the provider list and pick one from it.' });
    const old = await appWith({ probe: async () => probeOf("too_old", "18.0.0") });
    expect((await request(old.app).post("/api/onboarding/omp/login").send({ provider: "Anthropic" })).status).toBe(422);
  });

  it("is limited to instance admins", async () => {
    const { app } = await appWith({ probe: async () => probeOf("ready", "18.18.8") }, MEMBER);
    expect((await request(app).get("/api/onboarding/omp/login/providers")).status).toBe(403);
    expect((await request(app).post("/api/onboarding/omp/login").send({ provider: "Anthropic" })).status).toBe(403);
    expect((await request(app).get("/api/onboarding/omp/custom-providers")).status).toBe(403);
    expect((await request(app).delete("/api/onboarding/omp/custom-providers/x")).status).toBe(403);
  });
});

describe("OMP custom providers", () => {
  const EXISTING = [
    "# my gateways",
    "providers:",
    "  keep-me:",
    "    baseUrl: http://localhost:1/v1 # local",
    "    api: openai-completions",
    "    apiKey: sk-live-keep-me-secret",
    "    models:",
    "      - id: m1",
    "",
  ].join("\n");
  const INPUT = {
    baseUrl: "https://gw.example.com/v1",
    api: "openai-responses",
    apiKey: { kind: "literal", value: "sk-new-literal-secret" },
    authHeader: false,
    disableStrictTools: true,
    headers: [{ name: "X-Team", value: "header-secret-value" }],
    discovery: null,
    models: [{ id: "gpt-x", name: "GPT X", contextWindow: 200000, maxTokens: 32000 }],
  };

  async function setup(validateModelsYaml: OnboardingOmpDeps["validateModelsYaml"] = async () => []) {
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "onboarding-omp-agent-"));
    homes.push(agentDir);
    await fs.writeFile(path.join(agentDir, "models.yml"), EXISTING);
    const { app } = await appWith({ probe: async () => probeOf("ready", "18.18.8"), agentDir: async () => agentDir, validateModelsYaml });
    return { app, file: path.join(agentDir, "models.yml") };
  }

  it("adds a provider without touching comments or other providers, keeps a backup, and never returns keys", async () => {
    const { app, file } = await setup();
    const saved = await request(app).put("/api/onboarding/omp/custom-providers/gw").send(INPUT);
    expect(saved.status).toBe(200);
    const text = await fs.readFile(file, "utf8");
    expect(text).toContain("# my gateways");
    expect(text).toContain("baseUrl: http://localhost:1/v1 # local");
    expect(text).toContain("apiKey: sk-new-literal-secret");
    expect(text).toContain("X-Team: header-secret-value");
    expect(await fs.readFile(`${file}.bak`, "utf8")).toBe(EXISTING);
    const listed = await request(app).get("/api/onboarding/omp/custom-providers");
    for (const body of [saved.body, listed.body]) {
      const json = JSON.stringify(body);
      expect(json).not.toContain("sk-new-literal-secret");
      expect(json).not.toContain("sk-live-keep-me-secret");
      expect(json).not.toContain("header-secret-value");
    }
    expect(listed.body.providers.map((provider: { name: string }) => provider.name)).toEqual(["keep-me", "gw"]);
    expect(listed.body.providers[1]).toMatchObject({
      apiKey: { kind: "literal" },
      headers: [{ name: "X-Team" }],
      disableStrictTools: true,
      models: [{ id: "gpt-x", name: "GPT X", contextWindow: 200000, maxTokens: 32000 }],
    });
  });

  it("keeps both providers when two saves overlap", async () => {
    let calls = 0;
    const { app, file } = await setup(async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return [];
    });
    const [first, second] = await Promise.all([
      request(app).put("/api/onboarding/omp/custom-providers/one").send(INPUT),
      request(app).put("/api/onboarding/omp/custom-providers/two").send(INPUT),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(calls).toBe(2);
    const text = await fs.readFile(file, "utf8");
    expect(text.match(/^ {2}[a-z-]+:$/gm)?.sort()).toEqual(["  keep-me:", "  one:", "  two:"]);
  });

  it("keeps the stored key and header values when an edit leaves them out", async () => {
    const { app, file } = await setup();
    await request(app).put("/api/onboarding/omp/custom-providers/gw").send(INPUT);
    const edited = await request(app).put("/api/onboarding/omp/custom-providers/gw").send({
      ...INPUT,
      apiKey: { kind: "keep" },
      headers: [{ name: "X-Team" }],
      models: [{ id: "gpt-y" }],
    });
    expect(edited.status).toBe(200);
    const text = await fs.readFile(file, "utf8");
    expect(text).toContain("apiKey: sk-new-literal-secret");
    expect(text).toContain("X-Team: header-secret-value");
    expect(text).toContain("id: gpt-y");
    expect(text).not.toContain("gpt-x");
  });

  it("does not write a file OMP rejects and says why", async () => {
    const { app, file } = await setup(async () => ["Schema error: providers.gw.api: must be equal to one of the allowed values"]);
    const res = await request(app).put("/api/onboarding/omp/custom-providers/gw").send(INPUT);
    expect(res.status).toBe(422);
    expect(res.body.error).toContain("providers.gw.api");
    expect(await fs.readFile(file, "utf8")).toBe(EXISTING);
  });

  it("rejects a provider without models or discovery, and a new provider that keeps a key it never had", async () => {
    const { app } = await setup();
    expect((await request(app).put("/api/onboarding/omp/custom-providers/gw").send({ ...INPUT, models: [] })).status).toBe(400);
    expect((await request(app).put("/api/onboarding/omp/custom-providers/gw").send({ ...INPUT, api: null })).status).toBe(400);
    expect((await request(app).put("/api/onboarding/omp/custom-providers/fresh").send({ ...INPUT, apiKey: { kind: "keep" } })).status).toBe(422);
    expect((await request(app).put("/api/onboarding/omp/custom-providers/bad%20name").send(INPUT)).status).toBe(400);
  });

  it("removes a provider and reports a missing one", async () => {
    const { app, file } = await setup();
    const removed = await request(app).delete("/api/onboarding/omp/custom-providers/keep-me");
    expect(removed.status).toBe(200);
    expect(removed.body.providers).toEqual([]);
    expect(await fs.readFile(file, "utf8")).toContain("# my gateways");
    expect((await request(app).delete("/api/onboarding/omp/custom-providers/keep-me")).status).toBe(404);
  });

  it("tests a saved provider with its stored key without sending the key back", async () => {
    const probeProvider = vi.fn(async () => ({ suggestedApi: "openai-completions" as const, models: ["m1"], attempts: [], usedModel: "m1" }));
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "onboarding-omp-agent-"));
    homes.push(agentDir);
    await fs.writeFile(path.join(agentDir, "models.yml"), EXISTING);
    const { app } = await appWith({ probe: async () => probeOf("ready", "18.18.8"), agentDir: async () => agentDir, probeProvider });
    const res = await request(app).post("/api/onboarding/omp/custom-providers/probe").send({
      name: "keep-me",
      baseUrl: "http://localhost:1/v1",
      apiKey: { kind: "keep" },
      authHeader: false,
      headers: [],
    });
    expect(res.status).toBe(200);
    expect(res.body.suggestedApi).toBe("openai-completions");
    expect(probeProvider).toHaveBeenCalledWith(expect.objectContaining({ key: "sk-live-keep-me-secret", baseUrl: "http://localhost:1/v1" }));
    expect(JSON.stringify(res.body)).not.toContain("sk-live-keep-me-secret");
  });

  it("fetches a saved provider's upstream models with its stored key only at its own base URL, never returning the key", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchProviderModels: OnboardingOmpDeps["fetchProviderModels"] = (options) => fetchCustomProviderModels({
      ...options,
      fetchImpl: async (url, init) => {
        calls.push({ url, headers: init.headers });
        return calls.length === 1
          ? new Response(JSON.stringify({ data: [{ id: "m1" }, { id: "m2" }] }), { status: 200 })
          : new Response(`key ${init.headers.authorization} is revoked`, { status: 401 });
      },
    });
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "onboarding-omp-agent-"));
    homes.push(agentDir);
    await fs.writeFile(path.join(agentDir, "models.yml"), EXISTING);
    const { app } = await appWith({ probe: async () => probeOf("ready", "18.18.8"), agentDir: async () => agentDir, fetchProviderModels });
    const body = { name: "keep-me", baseUrl: "http://localhost:1/v1", api: "openai-completions", apiKey: { kind: "keep" }, authHeader: false, headers: [] };

    const listed = await request(app).post("/api/onboarding/omp/custom-providers/models").send(body);
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({ url: "http://localhost:1/v1/models", status: 200, models: [{ id: "m1" }, { id: "m2" }], truncated: false, error: null });

    const refused = await request(app).post("/api/onboarding/omp/custom-providers/models").send(body);
    expect(refused.status).toBe(200);
    expect(refused.body.error).toBe("http://localhost:1/v1/models answered 401: the provider rejected the key or headers. key Bearer [redacted] is revoked");
    expect(calls.map((call) => [call.url, call.headers.authorization])).toEqual([
      ["http://localhost:1/v1/models", "Bearer sk-live-keep-me-secret"],
      ["http://localhost:1/v1/models", "Bearer sk-live-keep-me-secret"],
    ]);
    expect(JSON.stringify([listed.body, refused.body])).not.toContain("sk-live-keep-me-secret");

    const member = await appWith({ probe: async () => probeOf("ready", "18.18.8"), agentDir: async () => agentDir, fetchProviderModels }, MEMBER);
    expect((await request(member.app).post("/api/onboarding/omp/custom-providers/models").send(body)).status).toBe(403);
    expect(calls).toHaveLength(2);
  });
});

describe("POST /api/onboarding/omp/remote", () => {
  it("checks OMP over SSH and reports the remote home folder", async () => {
    const runSsh = vi.fn(async () => ({
      code: 0,
      stdout: "HOME=/home/ada\nOMP=/home/ada/.local/bin/omp\nVERSION=omp/18.17.0\nMODELS={\"models\":[]}\n",
      stderr: "",
    }));
    const { app } = await appWith({ runSsh });
    const res = await request(app).post("/api/onboarding/omp/remote").send({ address: "ada@build-box:2222" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      connected: true,
      host: "build-box",
      port: 2222,
      username: "ada",
      state: "ready",
      version: "18.17.0",
      modelCount: 0,
      homeFolder: "/home/ada",
    });
    const args = runSsh.mock.calls[0]![0] as string[];
    expect(args).toContain("BatchMode=yes");
    expect(args).toContain("ada@build-box");
  });

  it("refuses an address that could become an ssh option", async () => {
    const runSsh = vi.fn();
    const { app } = await appWith({ runSsh });
    const res = await request(app).post("/api/onboarding/omp/remote").send({ address: "-oProxyCommand=sh@x" });
    expect(res.status).toBe(400);
    expect(runSsh).not.toHaveBeenCalled();
  });

  it("reports a failed connection", async () => {
    const { app } = await appWith({ runSsh: async () => ({ code: 255, stdout: "", stderr: "ssh: connect to host x port 22: Connection refused\n" }) });
    const res = await request(app).post("/api/onboarding/omp/remote").send({ address: "ada@x" });
    expect(res.body).toMatchObject({ connected: false, state: "missing", error: "ssh: connect to host x port 22: Connection refused" });
  });
});
