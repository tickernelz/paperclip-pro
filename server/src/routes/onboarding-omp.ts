import { spawn, type ChildProcessByStdio } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { Router } from "express";
import {
  bundledOmpVersion,
  classifyOmpVersion,
  detectRecentProjectFolder,
  ompInstallCommand,
  OMP_MIN_VERSION,
  OMP_UPDATE_COMMAND,
  parseOmpVersion,
  probeOmpInstall,
  readOmpDefaultModel,
  recommendOmpModel,
  type OmpInstallProbe,
} from "@tickernelz/wardmote-adapter-omp-local/readiness";
import {
  onboardingOmpLoginRequestSchema,
  onboardingRemoteOmpRequestSchema,
  parseSshAddress,
  type OnboardingOmpBrowseEntry,
  type OnboardingOmpBrowseResult,
  type OnboardingOmpLoginProvider,
  type OnboardingOmpLoginResult,
  type OnboardingOmpStatus,
  type OnboardingRemoteOmpStatus,
} from "@tickernelz/wardmote-shared";
import { listAdapterModels, refreshAdapterModels } from "../adapters/registry.js";
import { badRequest, conflict, unprocessable } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { validate } from "../middleware/validate.js";
import { assertInstanceAdmin } from "./authz.js";

const LOGIN_URL_TIMEOUT_MS = 20_000;
const LOGIN_LIFETIME_MS = 10 * 60_000;
const NETWORK_TRIES = 3;
const NETWORK_TIMEOUT_MS = 4_000;
const SSH_TIMEOUT_MS = 25_000;
const BROWSE_LIMIT = 500;

type LoginChild = ChildProcessByStdio<Writable, Readable, Readable>;

export interface OnboardingOmpDeps {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  home: string;
  probe: (command: string | null) => Promise<OmpInstallProbe>;
  listModels: () => Promise<Array<{ id: string; label: string; provider?: string }>>;
  refreshModels: () => Promise<Array<{ id: string; label: string; provider?: string }>>;
  checkNetwork: () => Promise<boolean>;
  spawnLogin: (command: string, provider: OnboardingOmpLoginProvider) => LoginChild;
  runSsh: (args: string[], timeoutMs: number) => Promise<{ code: number | null; stdout: string; stderr: string }>;
}

const OS_LABELS: Partial<Record<NodeJS.Platform, string>> = { linux: "Linux", darwin: "macOS", win32: "Windows" };

async function defaultCheckNetwork(): Promise<boolean> {
  for (let attempt = 0; attempt < NETWORK_TRIES; attempt += 1) {
    try {
      const response = await fetch("https://omp.sh/install", { method: "HEAD", signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) });
      if (response.status < 500) return true;
    } catch {
      continue;
    }
  }
  return false;
}

function defaultRunSsh(args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("ssh", args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr || error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function defaultDeps(): OnboardingOmpDeps {
  return {
    env: process.env,
    platform: process.platform,
    home: os.homedir(),
    probe: (command) => probeOmpInstall({ command }),
    listModels: () => listAdapterModels("omp_local"),
    refreshModels: () => refreshAdapterModels("omp_local"),
    checkNetwork: defaultCheckNetwork,
    spawnLogin: (command, provider) =>
      spawn(command, ["login", provider], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }),
    runSsh: defaultRunSsh,
  };
}

const REMOTE_SCRIPT = [
  "printf 'HOME=%s\\n' \"$HOME\"",
  "p=$(command -v omp 2>/dev/null || ls \"$HOME/.local/bin/omp\" \"$HOME/.bun/bin/omp\" 2>/dev/null | head -n 1)",
  "printf 'OMP=%s\\n' \"$p\"",
  "if [ -n \"$p\" ]; then printf 'VERSION=%s\\n' \"$(\"$p\" --version 2>&1 | head -n 1)\"; printf 'MODELS=%s\\n' \"$(\"$p\" models --json 2>/dev/null | tr -d '\\n')\"; fi",
].join("; ");

function readMarker(stdout: string, key: string): string | null {
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(`${key}=`));
  const value = line?.slice(key.length + 1).trim();
  return value ? value : null;
}

function countModels(raw: string | null): number {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as { models?: unknown };
    return Array.isArray(parsed.models) ? parsed.models.length : 0;
  } catch {
    return 0;
  }
}

export function onboardingOmpRoutes(overrides: Partial<OnboardingOmpDeps> = {}) {
  const deps = { ...defaultDeps(), ...overrides };
  const router = Router();
  let activeLogin: { child: LoginChild; timer: NodeJS.Timeout } | null = null;

  function stopActiveLogin() {
    if (!activeLogin) return;
    clearTimeout(activeLogin.timer);
    activeLogin.child.kill("SIGTERM");
    activeLogin = null;
  }

  router.get("/onboarding/omp", async (req, res) => {
    assertInstanceAdmin(req);
    const bundled = bundledOmpVersion(deps.env);
    const requestedCommand = typeof req.query.command === "string" && req.query.command.trim() ? req.query.command.trim() : null;
    if (requestedCommand && bundled) throw badRequest("The OMP bundled with this image cannot be replaced from onboarding");
    const probe = await deps.probe(requestedCommand);
    const ready = probe.state === "ready" || bundled !== null;
    const cached = ready ? await deps.listModels().catch(() => []) : [];
    const models = ready && cached.length === 0 ? await deps.refreshModels().catch(() => []) : cached;
    const network = probe.state === "missing" && !bundled && req.query.network === "1"
      ? ((await deps.checkNetwork()) ? "online" : "offline")
      : null;
    const body: OnboardingOmpStatus = {
      runtime: bundled ? "bundled" : "local",
      os: { platform: deps.platform, label: OS_LABELS[deps.platform] ?? deps.platform },
      minVersion: OMP_MIN_VERSION,
      state: bundled ? "ready" : probe.state,
      path: probe.path,
      version: probe.version ?? bundled,
      copies: probe.copies,
      installCommand: ompInstallCommand(deps.platform),
      updateCommand: OMP_UPDATE_COMMAND,
      network,
      models: models.map((model) => ({ id: model.id, label: model.label, provider: model.provider ?? null })),
      recommendedModel: recommendOmpModel(models, await readOmpDefaultModel(deps.env, deps.home)),
      projectFolder: (await detectRecentProjectFolder(deps.env, deps.home)) ?? deps.home,
    };
    res.json(body);
  });

  router.get("/onboarding/omp/browse", async (req, res) => {
    assertInstanceAdmin(req);
    if (bundledOmpVersion(deps.env)) throw conflict("The OMP bundled with this image cannot be replaced from onboarding");
    const requested = typeof req.query.path === "string" && req.query.path.trim() ? req.query.path.trim() : deps.home;
    if (!path.isAbsolute(requested)) throw badRequest("Path must be absolute");
    const directory = path.resolve(requested);
    const dirents = await fs.readdir(directory, { withFileTypes: true }).catch(() => {
      throw badRequest(`Cannot open ${directory}`);
    });
    const entries: OnboardingOmpBrowseEntry[] = dirents
      .filter((entry) => !entry.name.startsWith(".") || entry.name === ".local" || entry.name === ".bun")
      .filter((entry) => entry.isDirectory() || ((entry.isFile() || entry.isSymbolicLink()) && entry.name.toLowerCase().startsWith("omp")))
      .map((entry): OnboardingOmpBrowseEntry => ({
        name: entry.name,
        path: path.join(directory, entry.name),
        kind: entry.isDirectory() ? "directory" : "file",
      }))
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1))
      .slice(0, BROWSE_LIMIT);
    const parent = path.dirname(directory);
    const body: OnboardingOmpBrowseResult = { path: directory, parent: parent === directory ? null : parent, entries };
    res.json(body);
  });

  router.post("/onboarding/omp/login", validate(onboardingOmpLoginRequestSchema), async (req, res) => {
    assertInstanceAdmin(req);
    if (bundledOmpVersion(deps.env)) throw conflict("Sign in to OMP inside the container with: omp login");
    const probe = await deps.probe(null);
    if (probe.state !== "ready" || !probe.path) throw unprocessable("OMP must be installed and up to date before signing in");
    const provider = req.body.provider as OnboardingOmpLoginProvider;
    stopActiveLogin();
    const child = deps.spawnLogin(probe.path, provider);
    const timer = setTimeout(() => child.kill("SIGTERM"), LOGIN_LIFETIME_MS);
    activeLogin = { child, timer };
    child.on("close", (code) => {
      clearTimeout(timer);
      if (activeLogin?.child === child) activeLogin = null;
      if (code === 0) {
        void Promise.resolve(deps.refreshModels()).catch((error: unknown) => {
          logger.warn({ err: error }, "OMP model refresh after onboarding login failed");
        });
      }
    });
    const url = await new Promise<string | null>((resolve) => {
      let output = "";
      const done = (value: string | null) => {
        clearTimeout(wait);
        child.stdout.off("data", onData);
        child.stderr.off("data", onData);
        resolve(value);
      };
      const onData = (chunk: Buffer) => {
        output += chunk.toString("utf8");
        const found = /https:\/\/\S+/.exec(output);
        if (found) done(found[0]);
      };
      const wait = setTimeout(() => done(null), LOGIN_URL_TIMEOUT_MS);
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.once("close", () => done(null));
      child.once("error", () => done(null));
    });
    if (!url) {
      if (activeLogin?.child === child) stopActiveLogin();
      throw unprocessable(`omp login ${provider} did not print a sign-in link`);
    }
    const body: OnboardingOmpLoginResult = { provider, url };
    res.json(body);
  });

  router.post("/onboarding/omp/remote", validate(onboardingRemoteOmpRequestSchema), async (req, res) => {
    assertInstanceAdmin(req);
    const address = req.body.address as string;
    const parsed = parseSshAddress(address);
    if (!parsed) throw badRequest("Use user@host or user@host:port");
    const started = Date.now();
    const result = await deps.runSsh(
      [
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=10",
        "-o", "StrictHostKeyChecking=accept-new",
        "-p", String(parsed.port),
        `${parsed.username}@${parsed.host}`,
        REMOTE_SCRIPT,
      ],
      SSH_TIMEOUT_MS,
    );
    const latencyMs = Date.now() - started;
    const homeFolder = readMarker(result.stdout, "HOME");
    const connected = result.code !== null && result.code !== 255 && homeFolder !== null;
    const ompPath = readMarker(result.stdout, "OMP");
    const version = parseOmpVersion(readMarker(result.stdout, "VERSION") ?? "");
    const body: OnboardingRemoteOmpStatus = {
      address,
      ...parsed,
      connected,
      latencyMs: connected ? latencyMs : null,
      state: ompPath ? classifyOmpVersion(version) : "missing",
      path: ompPath,
      version,
      modelCount: countModels(readMarker(result.stdout, "MODELS")),
      homeFolder,
      error: connected ? null : (result.stderr.trim().split(/\r?\n/).pop() ?? "Could not connect"),
    };
    res.json(body);
  });

  return router;
}
