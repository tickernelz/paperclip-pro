import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
  defaultSpawnOmp,
  existingProvider,
  listCustomProviders,
  listOmpLoginProviders,
  modelsYamlPath,
  ompProviderEnv,
  probeCustomProvider,
  readModelsYaml,
  removeCustomProviderYaml,
  resolveOmpAgentDir,
  resolveProviderKey,
  startOmpLogin,
  upsertCustomProviderYaml,
  validateModelsYamlWithOmp,
  writeModelsYaml,
  type OmpLoginSession,
  type SpawnOmp,
} from "@tickernelz/wardmote-adapter-omp-local/providers";
import {
  OMP_PROVIDER_NAME_PATTERN,
  ompCustomProviderInputSchema,
  ompCustomProviderProbeSchema,
  onboardingOmpLoginInputSchema,
  onboardingOmpLoginRequestSchema,
  onboardingRemoteOmpRequestSchema,
  parseSshAddress,
  type OmpCustomProviderInput,
  type OmpCustomProviderProbeInput,
  type OnboardingOmpBrowseEntry,
  type OnboardingOmpBrowseResult,
  type OnboardingOmpLoginProviders,
  type OnboardingOmpStatus,
  type OnboardingRemoteOmpStatus,
} from "@tickernelz/wardmote-shared";
import { listAdapterModels, refreshAdapterModels } from "../adapters/registry.js";
import { badRequest, conflict, notFound, unprocessable } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { validate } from "../middleware/validate.js";
import { assertInstanceAdmin } from "./authz.js";

const LOGIN_FIRST_STEP_TIMEOUT_MS = 20_000;
const LOGIN_INPUT_WAIT_MS = 8_000;
const FINISHED_LOGIN_KEEP_MS = 5 * 60_000;
const PROVIDER_LIST_TTL_MS = 10 * 60_000;
const NETWORK_TRIES = 3;
const NETWORK_TIMEOUT_MS = 4_000;
const SSH_TIMEOUT_MS = 25_000;
const BROWSE_LIMIT = 500;

export interface OnboardingOmpDeps {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  home: string;
  probe: (command: string | null) => Promise<OmpInstallProbe>;
  listModels: () => Promise<Array<{ id: string; label: string; provider?: string }>>;
  refreshModels: () => Promise<Array<{ id: string; label: string; provider?: string }>>;
  checkNetwork: () => Promise<boolean>;
  ompEnv: () => NodeJS.ProcessEnv;
  spawnOmp: SpawnOmp;
  agentDir: (command: string, env: NodeJS.ProcessEnv) => Promise<string>;
  validateModelsYaml: (command: string, env: NodeJS.ProcessEnv, text: string) => Promise<string[]>;
  probeProvider: typeof probeCustomProvider;
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
    ompEnv: ompProviderEnv,
    spawnOmp: defaultSpawnOmp,
    agentDir: resolveOmpAgentDir,
    validateModelsYaml: validateModelsYamlWithOmp,
    probeProvider: probeCustomProvider,
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
  let activeLogin: OmpLoginSession | null = null;
  let finishedLogins: Array<{ session: OmpLoginSession; at: number }> = [];
  let providerList: { command: string; at: number; providers: string[] } | null = null;

  function findLogin(id: string): OmpLoginSession {
    const now = Date.now();
    finishedLogins = finishedLogins.filter((entry) => now - entry.at < FINISHED_LOGIN_KEEP_MS);
    if (activeLogin?.id === id) return activeLogin;
    const finished = finishedLogins.find((entry) => entry.session.id === id);
    if (!finished) throw notFound("This sign-in is no longer running. Start it again.");
    return finished.session;
  }

  function retire(session: OmpLoginSession) {
    if (activeLogin !== session) return;
    activeLogin = null;
    finishedLogins.push({ session, at: Date.now() });
  }

  async function readyCommand(): Promise<string> {
    const bundled = bundledOmpVersion(deps.env);
    const probe = await deps.probe(null);
    if (probe.state !== "ready" || !probe.path) {
      if (bundled && probe.path) return probe.path;
      throw unprocessable("OMP must be installed and up to date first. Open onboarding and finish the Check OMP step.");
    }
    return probe.path;
  }

  async function modelsFile(command: string, env: NodeJS.ProcessEnv): Promise<string> {
    try {
      return modelsYamlPath(await deps.agentDir(command, env));
    } catch (error) {
      throw unprocessable(`Could not find OMP's settings folder: ${(error as Error).message}`);
    }
  }

  function refreshModelsQuietly(reason: string) {
    void Promise.resolve(deps.refreshModels()).catch((error: unknown) => {
      logger.warn({ err: error }, reason);
    });
  }

  function providerName(raw: unknown): string {
    const name = typeof raw === "string" ? raw : "";
    if (!OMP_PROVIDER_NAME_PATTERN.test(name)) throw badRequest("Provider names use letters, digits, dot, dash and underscore (up to 63 characters)");
    return name;
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

  router.get("/onboarding/omp/login/providers", async (req, res) => {
    assertInstanceAdmin(req);
    const command = await readyCommand();
    const now = Date.now();
    if (!providerList || providerList.command !== command || now - providerList.at > PROVIDER_LIST_TTL_MS || req.query.refresh === "1") {
      const providers = await listOmpLoginProviders(command, deps.ompEnv(), deps.spawnOmp).catch((error: Error) => {
        throw unprocessable(`OMP did not list its sign-in providers: ${error.message}`);
      });
      providerList = { command, at: now, providers };
    }
    const body: OnboardingOmpLoginProviders = { providers: providerList.providers };
    res.json(body);
  });

  router.post("/onboarding/omp/login", validate(onboardingOmpLoginRequestSchema), async (req, res) => {
    assertInstanceAdmin(req);
    const command = await readyCommand();
    if (activeLogin) {
      activeLogin.cancel();
      retire(activeLogin);
    }
    const session = startOmpLogin({
      command,
      env: deps.ompEnv(),
      provider: req.body.provider as string,
      spawnOmp: deps.spawnOmp,
      onSuccess: () => refreshModelsQuietly("OMP model refresh after sign-in failed"),
    });
    activeLogin = session;
    const deadline = Date.now() + LOGIN_FIRST_STEP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const view = session.view();
      if (view.state !== "waiting" || view.url || view.prompt) break;
      await session.changed(session.version(), deadline - Date.now());
    }
    if (session.settled()) retire(session);
    res.json(session.view());
  });

  router.get("/onboarding/omp/login/:loginId", async (req, res) => {
    assertInstanceAdmin(req);
    const session = findLogin(req.params.loginId as string);
    if (session.settled()) retire(session);
    res.json(session.view());
  });

  router.post("/onboarding/omp/login/:loginId/input", validate(onboardingOmpLoginInputSchema), async (req, res) => {
    assertInstanceAdmin(req);
    const session = findLogin(req.params.loginId as string);
    if (session.settled()) throw conflict("This sign-in has already finished. Start it again.");
    session.submit(req.body.value as string);
    const deadline = Date.now() + LOGIN_INPUT_WAIT_MS;
    while (Date.now() < deadline && !session.settled() && !session.view().prompt) {
      await session.changed(session.version(), deadline - Date.now());
    }
    if (session.settled()) retire(session);
    res.json(session.view());
  });

  router.delete("/onboarding/omp/login/:loginId", async (req, res) => {
    assertInstanceAdmin(req);
    const session = findLogin(req.params.loginId as string);
    session.cancel();
    retire(session);
    res.json(session.view());
  });

  router.get("/onboarding/omp/custom-providers", async (req, res) => {
    assertInstanceAdmin(req);
    const command = await readyCommand();
    const env = deps.ompEnv();
    const file = await modelsFile(command, env);
    res.json(listCustomProviders(await readModelsYaml(file), file, env));
  });

  router.post("/onboarding/omp/custom-providers/probe", validate(ompCustomProviderProbeSchema), async (req, res) => {
    assertInstanceAdmin(req);
    const input = req.body as OmpCustomProviderProbeInput;
    const command = await readyCommand();
    const env = deps.ompEnv();
    let existing: Record<string, unknown> | null = null;
    if (input.apiKey.kind === "keep" || input.headers.some((header) => header.value === undefined)) {
      const text = await readModelsYaml(await modelsFile(command, env));
      try {
        existing = existingProvider(text, input.name);
      } catch (error) {
        throw unprocessable((error as Error).message);
      }
    }
    const key = resolveProviderKey(input.apiKey, existing, env);
    if (key.error) throw unprocessable(key.error);
    const storedHeaders = (existing?.headers && typeof existing.headers === "object" ? existing.headers : {}) as Record<string, unknown>;
    const headers: Record<string, string> = {};
    for (const header of input.headers) {
      const value = header.value ?? storedHeaders[header.name];
      if (typeof value === "string") headers[header.name] = value;
    }
    res.json(await deps.probeProvider({
      baseUrl: input.baseUrl,
      key: key.key,
      authHeader: input.authHeader,
      headers,
      modelId: input.modelId,
    }));
  });

  router.put("/onboarding/omp/custom-providers/:name", validate(ompCustomProviderInputSchema), async (req, res) => {
    assertInstanceAdmin(req);
    const name = providerName(req.params.name);
    const command = await readyCommand();
    const env = deps.ompEnv();
    const file = await modelsFile(command, env);
    const before = await readModelsYaml(file);
    let next: string;
    try {
      next = upsertCustomProviderYaml(before, name, req.body as OmpCustomProviderInput);
    } catch (error) {
      throw unprocessable((error as Error).message);
    }
    const problems = await deps.validateModelsYaml(command, env, next);
    if (problems.length) throw unprocessable(`OMP rejected this provider: ${problems.join("; ")}`, { problems });
    await writeModelsYaml(file, next);
    refreshModelsQuietly("OMP model refresh after saving a custom provider failed");
    res.json(listCustomProviders(next, file, env));
  });

  router.delete("/onboarding/omp/custom-providers/:name", async (req, res) => {
    assertInstanceAdmin(req);
    const name = providerName(req.params.name);
    const command = await readyCommand();
    const env = deps.ompEnv();
    const file = await modelsFile(command, env);
    let next: string;
    try {
      next = removeCustomProviderYaml(await readModelsYaml(file), name);
    } catch (error) {
      throw notFound((error as Error).message);
    }
    await writeModelsYaml(file, next);
    refreshModelsQuietly("OMP model refresh after removing a custom provider failed");
    res.json(listCustomProviders(next, file, env));
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
