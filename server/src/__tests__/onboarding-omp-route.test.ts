import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
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
      env: { PAPERCLIP_OMP_BUNDLED_VERSION: "18.18.0" },
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

describe("POST /api/onboarding/omp/login", () => {
  it("returns the sign-in link omp login prints and refreshes models when it succeeds", async () => {
    const child = fakeLoginChild(["", "Open this URL in your browser:", "https://claude.ai/oauth/authorize?x=1", "Waiting..."]);
    const refreshModels = vi.fn(async () => []);
    const spawnLogin = vi.fn(() => child as never);
    const { app } = await appWith({ probe: async () => probeOf("ready", "18.18.0"), spawnLogin, refreshModels });
    const res = await request(app).post("/api/onboarding/omp/login").send({ provider: "anthropic" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ provider: "anthropic", url: "https://claude.ai/oauth/authorize?x=1" });
    expect(spawnLogin).toHaveBeenCalledWith("/home/u/.local/bin/omp", "anthropic");
    child.emit("close", 0);
    await vi.waitFor(() => expect(refreshModels).toHaveBeenCalled());
  });

  it("rejects an unknown provider and an outdated OMP", async () => {
    const { app } = await appWith({ probe: async () => probeOf("too_old", "18.0.2") });
    expect((await request(app).post("/api/onboarding/omp/login").send({ provider: "evil --flag" })).status).toBe(400);
    expect((await request(app).post("/api/onboarding/omp/login").send({ provider: "openrouter" })).status).toBe(422);
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
