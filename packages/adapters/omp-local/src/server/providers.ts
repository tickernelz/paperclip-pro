import { execFile, spawn, type ChildProcessByStdio } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { isMap, isSeq, parseDocument, YAMLMap, type Document } from "yaml";
import {
  OMP_ENV_NAME_PATTERN,
  type OmpCustomProviderInput,
  type OmpCustomProviderKeyInput,
  type OmpCustomProviderKeyView,
  type OmpCustomProviderList,
  type OmpCustomProviderProbeAttempt,
  type OmpCustomProviderProbeResult,
  type OmpCustomProviderView,
  type OmpProviderApi,
  type OnboardingOmpLoginState,
  type OnboardingOmpLoginView,
} from "@tickernelz/wardmote-shared";
import { detectionEnv } from "./config.js";

export type OmpChild = ChildProcessByStdio<Writable, Readable, Readable>;
export type SpawnOmp = (command: string, args: string[], env: NodeJS.ProcessEnv) => OmpChild;

export const defaultSpawnOmp: SpawnOmp = (command, args, env) =>
  spawn(command, args, { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });

export function ompProviderEnv(): NodeJS.ProcessEnv {
  return detectionEnv();
}

const ANSI_PATTERN = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*\u0007/g;
const PICKER_PROMPT = /Enter number \(1-(\d+)\):\s*$/;
const PICKER_LINE = /^\s*(\d+)\.\s+(.+?)\s*$/;
const PROVIDER_LIST_TIMEOUT_MS = 10_000;
const LOGIN_LIFETIME_MS = 10 * 60_000;
const MAX_LINES = 60;
const MAX_LINE_LENGTH = 600;
const SECRET_PROMPT = /\b(api[ -]?key|token|secret|password)\b/i;
const MIN_REDACTED_LENGTH = 6;
const REJECTED_ANSWER = "OMP asked again, so it did not accept that value. Copy the whole address from the browser bar of the page the sign-in ended on, or the code the page shows, and paste it again.";

function plain(text: string): string {
  return text.replace(ANSI_PATTERN, "").replace(/\r\n?/g, "\n");
}

export function parseLoginProviders(output: string): string[] {
  const text = plain(output);
  const end = text.search(/Enter number/);
  const providers: string[] = [];
  for (const line of (end === -1 ? text : text.slice(0, end)).split("\n")) {
    const match = PICKER_LINE.exec(line);
    if (match && Number(match[1]) === providers.length + 1) providers.push(match[2]);
  }
  return providers;
}

export function listOmpLoginProviders(command: string, env: NodeJS.ProcessEnv, spawnOmp: SpawnOmp = defaultSpawnOmp): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawnOmp(command, ["login"], env);
    child.stdin.on("error", () => undefined);
    let output = "";
    let settled = false;
    const finish = (error: Error | null, providers: string[] = []) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill("SIGTERM");
      if (error) reject(error);
      else resolve(providers);
    };
    const timer = setTimeout(() => finish(new Error("omp login did not list its providers within 10 seconds")), PROVIDER_LIST_TIMEOUT_MS);
    const onData = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (PICKER_PROMPT.test(plain(output))) {
        const providers = parseLoginProviders(output);
        finish(providers.length ? null : new Error("omp login printed no providers"), providers);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("error", (error) => finish(error));
    child.once("close", () => finish(new Error(lastLine(plain(output)) || "omp login exited before listing providers")));
  });
}

function lastLine(text: string): string {
  return text.split("\n").map((line) => line.trim()).filter(Boolean).pop() ?? "";
}

export interface OmpLoginSession {
  readonly id: string;
  readonly provider: string;
  view(): OnboardingOmpLoginView;
  submit(value: string): void;
  cancel(): void;
  settled(): boolean;
  changed(sinceVersion: number, timeoutMs: number): Promise<void>;
  version(): number;
}

export function startOmpLogin(options: {
  command: string;
  env: NodeJS.ProcessEnv;
  provider: string;
  spawnOmp?: SpawnOmp;
  lifetimeMs?: number;
  onSuccess?: () => void;
}): OmpLoginSession {
  const child = (options.spawnOmp ?? defaultSpawnOmp)(options.command, ["login"], options.env);
  child.stdin.on("error", () => undefined);
  const id = randomUUID();
  const secrets: string[] = [];
  let raw = "";
  let selectedAt = -1;
  let answeredAt = -1;
  let state: OnboardingOmpLoginState = "waiting";
  let message: string | null = null;
  let version = 0;
  const waiters = new Set<() => void>();
  const bump = () => {
    version += 1;
    for (const wake of waiters) wake();
    waiters.clear();
  };
  const settle = (next: OnboardingOmpLoginState, text: string | null) => {
    if (state !== "waiting") return;
    state = next;
    message = text;
    clearTimeout(lifetime);
    if (next === "succeeded") options.onSuccess?.();
    bump();
  };
  const lifetime = setTimeout(() => {
    settle("failed", "Sign-in took longer than 10 minutes. Start it again.");
    child.kill("SIGTERM");
  }, options.lifetimeMs ?? LOGIN_LIFETIME_MS);

  const redact = (text: string) => secrets.reduce((acc, secret) => acc.split(secret).join("••••"), text);
  const loginText = () => (selectedAt < 0 ? "" : redact(plain(raw.slice(selectedAt))));

  const onData = (chunk: Buffer) => {
    raw += chunk.toString("utf8");
    if (selectedAt < 0) {
      const text = plain(raw);
      if (!PICKER_PROMPT.test(text)) return;
      const providers = parseLoginProviders(text);
      const index = providers.findIndex((name) => name === options.provider);
      if (index === -1) {
        settle("failed", `OMP does not offer "${options.provider}". Reload the provider list and pick one from it.`);
        child.kill("SIGTERM");
        return;
      }
      selectedAt = raw.length;
      child.stdin.write(`${index + 1}\n`);
    }
    bump();
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.once("error", (error) => settle("failed", `Could not start omp login: ${error.message}`));
  child.once("close", (code) => {
    const text = loginText();
    const failure = /Login failed:\s*(.+)/.exec(text);
    if (failure) settle("failed", failure[1].trim());
    else if (/Logged in to /.test(text)) settle("succeeded", lastMatching(text, /Logged in to .+/) ?? "Signed in");
    else settle("failed", code === 0 ? (lastLine(text) || "omp login stopped without signing in") : `omp login exited with code ${code ?? "unknown"}`);
  });

  return {
    id,
    provider: options.provider,
    view() {
      const text = loginText();
      const lines = text.split("\n").map((line) => line.trimEnd()).filter((line) => line.trim().length > 0);
      const sinceAnswer = answeredAt > selectedAt ? redact(plain(raw.slice(answeredAt))) : text;
      const tail = sinceAnswer.endsWith("\n") ? "" : (sinceAnswer.split("\n").pop() ?? "").trim();
      const prompt = state === "waiting" && /[:?]$/.test(tail) && raw.length > answeredAt
        ? { label: tail, secret: SECRET_PROMPT.test(tail) }
        : null;
      const askedAgain = prompt !== null && answeredAt > selectedAt && !sinceAnswer.includes("\n");
      return {
        id,
        provider: options.provider,
        state,
        url: /https:\/\/\S+/.exec(text)?.[0] ?? null,
        lines: lines.slice(-MAX_LINES).map((line) => line.slice(0, MAX_LINE_LENGTH)),
        prompt,
        message: askedAgain ? REJECTED_ANSWER : message,
      };
    },
    submit(value: string) {
      if (state !== "waiting") throw new Error("This sign-in has already finished");
      if (value.length >= MIN_REDACTED_LENGTH) secrets.push(value);
      answeredAt = raw.length;
      child.stdin.write(`${value}\n`);
      bump();
    },
    cancel() {
      settle("cancelled", "Sign-in cancelled");
      child.stdin.end();
      child.kill("SIGTERM");
    },
    settled: () => state !== "waiting",
    version: () => version,
    changed(sinceVersion: number, timeoutMs: number) {
      if (version !== sinceVersion || state !== "waiting") return Promise.resolve();
      return new Promise<void>((resolve) => {
        const wake = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          waiters.delete(wake);
          resolve();
        }, timeoutMs);
        waiters.add(wake);
      });
    },
  };
}

function lastMatching(text: string, pattern: RegExp): string | null {
  const lines = text.split("\n").filter((line) => pattern.test(line));
  return lines.length ? lines[lines.length - 1].trim() : null;
}

function runOmp(command: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { env, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      const code = error && typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : error ? null : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) || (error && code === null ? error.message : "") });
    });
  });
}

export async function resolveOmpAgentDir(command: string, env: NodeJS.ProcessEnv): Promise<string> {
  const result = await runOmp(command, ["config", "path"], env, 15_000);
  const dir = lastLine(result.stdout);
  if (result.code !== 0 || !path.isAbsolute(dir)) throw new Error(`omp config path failed: ${lastLine(result.stderr) || "no path printed"}`);
  return dir;
}

export function modelsYamlPath(agentDir: string): string {
  return path.join(agentDir, "models.yml");
}

export async function readModelsYaml(file: string): Promise<string> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

function loadDocument(text: string): Document {
  const doc = parseDocument(text || "{}\n");
  if (doc.errors.length) throw new Error(`models.yml is not valid YAML: ${doc.errors[0].message}`);
  if (doc.contents !== null && !isMap(doc.contents)) throw new Error("models.yml must be a mapping with a providers key");
  return doc;
}

function stringAt(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

const KNOWN_PROVIDER_KEYS = new Set(["baseUrl", "api", "apiKey", "auth", "authHeader", "disableStrictTools", "headers", "discovery", "models"]);

function keyView(provider: Record<string, unknown>, env: NodeJS.ProcessEnv): OmpCustomProviderKeyView {
  if (provider.auth === "none") return { kind: "none" };
  if (provider.auth === "oauth") return { kind: "oauth" };
  const key = stringAt(provider.apiKey);
  if (!key) return { kind: "missing" };
  if (key.startsWith("!")) return { kind: "command" };
  if (OMP_ENV_NAME_PATTERN.test(key)) return { kind: "env", name: key, present: Boolean(env[key]) };
  return { kind: "literal" };
}

export function customProvidersFromYaml(text: string, env: NodeJS.ProcessEnv): OmpCustomProviderView[] {
  const data = loadDocument(text).toJS() as { providers?: unknown } | null;
  const providers = data && typeof data.providers === "object" && data.providers ? data.providers as Record<string, unknown> : {};
  return Object.entries(providers)
    .filter((entry): entry is [string, Record<string, unknown>] => typeof entry[1] === "object" && entry[1] !== null && !Array.isArray(entry[1]))
    .map(([name, provider]) => {
      const discovery = typeof provider.discovery === "object" && provider.discovery ? provider.discovery as Record<string, unknown> : null;
      const headers = typeof provider.headers === "object" && provider.headers ? Object.keys(provider.headers as object) : [];
      const models = Array.isArray(provider.models) ? provider.models : [];
      return {
        name,
        baseUrl: stringAt(provider.baseUrl) ?? null,
        api: stringAt(provider.api) ?? null,
        apiKey: keyView(provider, env),
        authHeader: provider.authHeader === true,
        disableStrictTools: provider.disableStrictTools === true,
        headers: headers.map((header) => ({ name: header })),
        discovery: discovery && stringAt(discovery.type)
          ? {
            type: discovery.type as string,
            ...(positiveInt(discovery.timeoutMs) ? { timeoutMs: positiveInt(discovery.timeoutMs) } : {}),
            ...(typeof discovery.injectV1 === "boolean" ? { injectV1: discovery.injectV1 } : {}),
          }
          : null,
        models: models
          .filter((model): model is Record<string, unknown> => typeof model === "object" && model !== null && typeof (model as { id?: unknown }).id === "string")
          .map((model) => ({
            id: model.id as string,
            ...(stringAt(model.name) ? { name: model.name as string } : {}),
            ...(stringAt(model.api) ? { api: model.api as string } : {}),
            ...(positiveInt(model.contextWindow) ? { contextWindow: model.contextWindow as number } : {}),
            ...(positiveInt(model.maxTokens) ? { maxTokens: model.maxTokens as number } : {}),
            ...(typeof model.reasoning === "boolean" ? { reasoning: model.reasoning } : {}),
            ...(Array.isArray(model.input) ? { images: model.input.includes("image") } : {}),
          })),
        otherKeys: Object.keys(provider).filter((key) => !KNOWN_PROVIDER_KEYS.has(key)),
      };
    });
}

export function listCustomProviders(text: string, file: string, env: NodeJS.ProcessEnv): OmpCustomProviderList {
  try {
    return { modelsPath: file, providers: customProvidersFromYaml(text, env), parseError: null };
  } catch (error) {
    return { modelsPath: file, providers: [], parseError: (error as Error).message };
  }
}

function setOrDelete(map: YAMLMap, key: string, value: unknown) {
  if (value === undefined) map.delete(key);
  else map.set(key, value);
}

function applyKey(map: YAMLMap, input: OmpCustomProviderKeyInput) {
  if (input.kind === "keep") return;
  if (input.kind === "none") {
    map.delete("apiKey");
    map.set("auth", "none");
    return;
  }
  if (map.get("auth") === "none" || map.get("auth") === "oauth") map.delete("auth");
  map.set("apiKey", input.kind === "env" ? input.name : input.kind === "literal" ? input.value : `!${input.command}`);
}

function applyModels(doc: Document, map: YAMLMap, models: OmpCustomProviderInput["models"]) {
  if (models.length === 0) {
    map.delete("models");
    return;
  }
  const existing = map.get("models");
  const byId = new Map<string, YAMLMap>();
  if (isSeq(existing)) {
    for (const item of existing.items) {
      if (isMap(item) && typeof item.get("id") === "string") byId.set(item.get("id") as string, item);
    }
  }
  const seq = doc.createNode([]) as ReturnType<Document["createNode"]> & { items: unknown[] };
  for (const model of models) {
    const node = byId.get(model.id) ?? (doc.createNode({ id: model.id }) as YAMLMap);
    node.set("id", model.id);
    setOrDelete(node, "name", model.name || undefined);
    setOrDelete(node, "api", model.api);
    setOrDelete(node, "reasoning", model.reasoning);
    if (model.images !== undefined) {
      const current = node.toJSON() as { input?: unknown };
      const others = Array.isArray(current.input) ? current.input.filter((item) => item !== "image" && item !== "text") : [];
      node.set("input", doc.createNode(model.images ? ["text", "image", ...others] : ["text", ...others]));
    }
    setOrDelete(node, "contextWindow", model.contextWindow);
    setOrDelete(node, "maxTokens", model.maxTokens);
    seq.items.push(node);
  }
  map.set("models", seq);
}

export function upsertCustomProviderYaml(text: string, name: string, input: OmpCustomProviderInput): string {
  const doc = loadDocument(text);
  if (doc.contents === null) doc.contents = doc.createNode({}) as never;
  let providers = doc.get("providers");
  if (!isMap(providers)) {
    providers = doc.createNode({});
    doc.set("providers", providers);
  }
  const providersMap = providers as YAMLMap;
  const existing = providersMap.get(name);
  const map = isMap(existing) ? existing : (doc.createNode({}) as YAMLMap);
  if (input.apiKey.kind === "keep" && !isMap(existing)) throw new Error("A new provider needs a key choice");
  map.set("baseUrl", input.baseUrl);
  setOrDelete(map, "api", input.api ?? undefined);
  applyKey(map, input.apiKey);
  setOrDelete(map, "authHeader", input.authHeader ? true : undefined);
  setOrDelete(map, "disableStrictTools", input.disableStrictTools ? true : undefined);
  const oldHeaders = (map.get("headers") && isMap(map.get("headers")) ? (map.get("headers") as YAMLMap).toJSON() : {}) as Record<string, unknown>;
  if (input.headers.length === 0) map.delete("headers");
  else {
    const headers: Record<string, unknown> = {};
    for (const header of input.headers) {
      const value = header.value ?? oldHeaders[header.name];
      if (value === undefined) throw new Error(`Header ${header.name} needs a value`);
      headers[header.name] = value;
    }
    map.set("headers", doc.createNode(headers));
  }
  if (input.discovery) {
    map.set("discovery", doc.createNode({
      type: input.discovery.type,
      ...(input.discovery.timeoutMs ? { timeoutMs: input.discovery.timeoutMs } : {}),
      ...(input.discovery.injectV1 !== undefined ? { injectV1: input.discovery.injectV1 } : {}),
    }));
  } else map.delete("discovery");
  applyModels(doc, map, input.models);
  if (!isMap(existing)) providersMap.set(name, map);
  return doc.toString();
}

export function removeCustomProviderYaml(text: string, name: string): string {
  const doc = loadDocument(text);
  const providers = doc.get("providers");
  if (!isMap(providers) || !providers.has(name)) throw new Error(`Provider ${name} is not in models.yml`);
  providers.delete(name);
  return doc.toString();
}

export function resolveProviderKey(
  input: OmpCustomProviderKeyInput,
  existing: Record<string, unknown> | null,
  env: NodeJS.ProcessEnv,
): { key: string | null; error: string | null } {
  const fromValue = (value: string | undefined) => {
    if (!value) return { key: null, error: "This provider has no key yet" };
    if (value.startsWith("!")) return { key: null, error: "The key comes from a command; the connection test does not run commands. Paste the key or name an environment variable to test." };
    if (OMP_ENV_NAME_PATTERN.test(value)) return env[value] ? { key: env[value] as string, error: null } : { key: value, error: null };
    return { key: value, error: null };
  };
  if (input.kind === "none") return { key: null, error: null };
  if (input.kind === "literal") return { key: input.value, error: null };
  if (input.kind === "command") return fromValue(`!${input.command}`);
  if (input.kind === "env") {
    const value = env[input.name];
    return value ? { key: value, error: null } : { key: null, error: `The server has no ${input.name} environment variable` };
  }
  if (existing?.auth === "none") return { key: null, error: null };
  return fromValue(stringAt(existing?.apiKey));
}

export function existingProvider(text: string, name: string | undefined): Record<string, unknown> | null {
  if (!name) return null;
  const data = loadDocument(text).toJS() as { providers?: Record<string, unknown> } | null;
  const provider = data?.providers?.[name];
  return typeof provider === "object" && provider !== null ? provider as Record<string, unknown> : null;
}

export async function writeModelsYaml(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const previous = await fs.stat(file).catch(() => null);
  if (previous) await fs.copyFile(file, `${file}.bak`);
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, text, { mode: previous ? previous.mode & 0o777 : 0o600 });
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true });
  }
}

function hasModelList(stdout: string): boolean {
  try {
    return Array.isArray((JSON.parse(stdout) as { models?: unknown }).models);
  } catch {
    return false;
  }
}

export async function validateModelsYamlWithOmp(command: string, env: NodeJS.ProcessEnv, text: string): Promise<string[]> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wardmote-models-check-"));
  try {
    await fs.writeFile(path.join(dir, "models.yml"), text, { mode: 0o600 });
    const checkEnv: NodeJS.ProcessEnv = { ...env, PI_CODING_AGENT_DIR: dir };
    delete checkEnv.OMP_PROFILE;
    delete checkEnv.PI_PROFILE;
    delete checkEnv.PI_CONFIG_FILES;
    const result = await runOmp(command, ["models", "--json"], checkEnv, 60_000);
    const output = plain(`${result.stderr}\n${result.stdout.startsWith("{") ? "" : result.stdout}`);
    if (/models\.yml validation failed|Failed to load config file models|Schema error/i.test(output)) {
      const errors = output.split("\n").map((line) => line.trim()).filter((line) => /Schema error|must be|required|invalid|Unexpected/i.test(line));
      return errors.length ? errors.slice(0, 10) : [lastLine(output) || "OMP rejected models.yml"];
    }
    if (result.code !== 0) return [`omp models --json could not check the file (exit ${result.code ?? "none"}): ${lastLine(output) || "no output"}`];
    if (!hasModelList(result.stdout)) return ["omp models --json printed no model list, so the file could not be checked. Update OMP and try again."];
    return [];
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<{ status: number; body: ReadableStream<Uint8Array> | null }>;

const PROBE_TIMEOUT_MS = 15_000;
const PROBE_BODY_LIMIT_BYTES = 8 * 1024 * 1024;

async function readLimitedBody(body: ReadableStream<Uint8Array> | null, limit: number): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  try {
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.byteLength > limit - size ? value.subarray(0, limit - size) : value;
      size += chunk.byteLength;
      text += decoder.decode(chunk, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function joinUrl(base: string, suffix: string): string {
  return `${base.replace(/\/+$/, "")}/${suffix}`;
}

function shortDetail(body: string): string | null {
  const text = body.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 240) : null;
}

export async function probeCustomProvider(options: {
  baseUrl: string;
  key: string | null;
  authHeader: boolean;
  headers: Record<string, string>;
  modelId?: string;
  fetchImpl?: FetchLike;
}): Promise<OmpCustomProviderProbeResult> {
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
  const bearer: Record<string, string> = options.key ? { authorization: `Bearer ${options.key}` } : {};
  const json = { "content-type": "application/json", ...options.headers };
  const call = async (api: OmpCustomProviderProbeAttempt["api"], url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    try {
      const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      const body = await readLimitedBody(response.body, PROBE_BODY_LIMIT_BYTES).catch(() => "");
      const ok = response.status >= 200 && response.status < 300;
      return { attempt: { api, url, status: response.status, ok, detail: ok ? null : shortDetail(body) }, body };
    } catch (error) {
      return { attempt: { api, url, status: null, ok: false, detail: (error as Error).message.slice(0, 240) }, body: "" };
    }
  };
  const list = await call("models-list", joinUrl(options.baseUrl, "models"), { method: "GET", headers: { ...options.headers, ...bearer } });
  let models: string[] = [];
  if (list.attempt.ok) {
    try {
      const parsed = JSON.parse(list.body) as { data?: Array<{ id?: unknown }>; models?: Array<{ id?: unknown; name?: unknown }> };
      const rows = parsed.data ?? parsed.models ?? [];
      models = rows.map((row) => (typeof row.id === "string" ? row.id : typeof (row as { name?: unknown }).name === "string" ? (row as { name: string }).name : null)).filter((id): id is string => Boolean(id)).slice(0, 500);
    } catch {
      models = [];
    }
  }
  const model = options.modelId ?? models[0] ?? null;
  const attempts: OmpCustomProviderProbeAttempt[] = [list.attempt];
  if (!model) return { suggestedApi: null, models, attempts, usedModel: null };
  const anthropicHeaders: Record<string, string> = options.key
    ? (options.authHeader ? bearer : { "x-api-key": options.key })
    : {};
  const [responses, completions, messages] = await Promise.all([
    call("openai-responses", joinUrl(options.baseUrl, "responses"), {
      method: "POST",
      headers: { ...json, ...bearer },
      body: JSON.stringify({ model, input: "hi", max_output_tokens: 1, stream: false }),
    }),
    call("openai-completions", joinUrl(options.baseUrl, "chat/completions"), {
      method: "POST",
      headers: { ...json, ...bearer },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], max_tokens: 1, stream: false }),
    }),
    call("anthropic-messages", joinUrl(options.baseUrl, "messages"), {
      method: "POST",
      headers: { ...json, ...anthropicHeaders, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
    }),
  ]);
  attempts.push(responses.attempt, completions.attempt, messages.attempt);
  const winner = [responses, completions, messages].find((result) => result.attempt.ok);
  return {
    suggestedApi: (winner?.attempt.api as OmpProviderApi | undefined) ?? null,
    models,
    attempts,
    usedModel: model,
  };
}
