import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudDownload, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  OMP_CUSTOM_PROVIDER_MODEL_LIMIT,
  OMP_DISCOVERY_TYPES,
  OMP_PROVIDER_APIS,
  OMP_PROVIDER_NAME_PATTERN,
  type OmpCustomProviderInput,
  type OmpCustomProviderKeyInput,
  type OmpCustomProviderList,
  type OmpCustomProviderModelsFetchResult,
  type OmpCustomProviderProbeResult,
  type OmpCustomProviderView,
  type OmpDiscoveryType,
  type OmpUpstreamModel,
} from "@tickernelz/wardmote-shared";
import { ApiError } from "@/api/client";
import { onboardingOmpApi } from "@/api/onboardingOmp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { InlineRowEditorPanel, useInlineRowEditor } from "@/components/InlineRowEditor";
import { OmpNote } from "./OmpSignIn";
import { UpstreamModelPicker } from "./UpstreamModelPicker";

export const OMP_CUSTOM_PROVIDERS_KEY = ["omp", "custom-providers"] as const;

const API_LABELS: Record<string, string> = {
  "openai-responses": "OpenAI Responses (/responses): most OpenAI-compatible gateways",
  "openai-completions": "OpenAI Chat Completions (/chat/completions): vLLM, LiteLLM, Ollama, llama.cpp",
  "anthropic-messages": "Anthropic Messages (/messages)",
  "openai-codex-responses": "ChatGPT Codex backend: only with a ChatGPT sign-in token",
  "google-generative-ai": "Google Gemini API",
  "google-vertex": "Google Vertex AI",
  "google-gemini-cli": "Gemini CLI backend",
  "azure-openai-responses": "Azure OpenAI Responses",
  "bedrock-converse-stream": "AWS Bedrock Converse",
};

const DISCOVERY_LABELS: Record<string, string> = {
  "openai-models-list": "OpenAI /models list",
  proxy: "Proxy (models from the gateway)",
  litellm: "LiteLLM",
  ollama: "Ollama",
  "llama.cpp": "llama.cpp",
  "lm-studio": "LM Studio",
  "apple-foundation-models": "Apple Foundation Models",
};

type KeyMode = OmpCustomProviderKeyInput["kind"];

interface ModelRow {
  id: string;
  name: string;
  api: string;
  contextWindow: string;
  maxTokens: string;
  reasoning: boolean;
  images: boolean;
}

interface HeaderRow {
  name: string;
  value: string;
  saved: boolean;
}

interface FormState {
  name: string;
  baseUrl: string;
  api: string;
  keyMode: KeyMode;
  keyValue: string;
  authHeader: boolean;
  disableStrictTools: boolean;
  discovery: string;
  discoveryTimeout: string;
  injectV1: boolean;
  headers: HeaderRow[];
  models: ModelRow[];
}

const EMPTY_MODEL: ModelRow = { id: "", name: "", api: "", contextWindow: "", maxTokens: "", reasoning: false, images: false };

function initialState(provider: OmpCustomProviderView | null): FormState {
  if (!provider) {
    return {
      name: "",
      baseUrl: "",
      api: "openai-responses",
      keyMode: "literal",
      keyValue: "",
      authHeader: false,
      disableStrictTools: false,
      discovery: "",
      discoveryTimeout: "",
      injectV1: false,
      headers: [],
      models: [{ ...EMPTY_MODEL }],
    };
  }
  return {
    name: provider.name,
    baseUrl: provider.baseUrl ?? "",
    api: provider.api ?? "",
    keyMode: provider.apiKey.kind === "none" ? "none" : provider.apiKey.kind === "missing" ? "literal" : "keep",
    keyValue: "",
    authHeader: provider.authHeader,
    disableStrictTools: provider.disableStrictTools,
    discovery: provider.discovery?.type ?? "",
    discoveryTimeout: provider.discovery?.timeoutMs ? String(provider.discovery.timeoutMs) : "",
    injectV1: provider.discovery?.injectV1 ?? false,
    headers: provider.headers.map((header) => ({ name: header.name, value: "", saved: true })),
    models: provider.models.map((model) => ({
      id: model.id,
      name: model.name ?? "",
      api: model.api ?? "",
      contextWindow: model.contextWindow ? String(model.contextWindow) : "",
      maxTokens: model.maxTokens ? String(model.maxTokens) : "",
      reasoning: model.reasoning ?? false,
      images: model.images ?? false,
    })),
  };
}

function keyInput(state: FormState): OmpCustomProviderKeyInput {
  switch (state.keyMode) {
    case "keep":
      return { kind: "keep" };
    case "none":
      return { kind: "none" };
    case "env":
      return { kind: "env", name: state.keyValue.trim() };
    case "command":
      return { kind: "command", command: state.keyValue.trim() };
    default:
      return { kind: "literal", value: state.keyValue.trim() };
  }
}

function positive(value: string): number | undefined {
  const parsed = Number(value.replace(/[_,\s]/g, ""));
  return value.trim() && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function headersInput(state: FormState) {
  return state.headers
    .filter((header) => header.name.trim())
    .map((header) => (header.saved && !header.value ? { name: header.name.trim() } : { name: header.name.trim(), value: header.value }));
}

function toInput(state: FormState): OmpCustomProviderInput {
  return {
    baseUrl: state.baseUrl.trim(),
    api: (state.api || null) as OmpCustomProviderInput["api"],
    apiKey: keyInput(state),
    authHeader: state.authHeader,
    disableStrictTools: state.disableStrictTools,
    headers: headersInput(state),
    discovery: state.discovery
      ? {
        type: state.discovery as OmpDiscoveryType,
        ...(positive(state.discoveryTimeout) ? { timeoutMs: positive(state.discoveryTimeout) } : {}),
        ...(state.discovery === "openai-models-list" && state.injectV1 ? { injectV1: true } : {}),
      }
      : null,
    models: state.models
      .filter((model) => model.id.trim())
      .map((model) => ({
        id: model.id.trim(),
        ...(model.name.trim() ? { name: model.name.trim() } : {}),
        ...(model.api ? { api: model.api as OmpCustomProviderInput["models"][number]["api"] } : {}),
        ...(positive(model.contextWindow) ? { contextWindow: positive(model.contextWindow) } : {}),
        ...(positive(model.maxTokens) ? { maxTokens: positive(model.maxTokens) } : {}),
        ...(model.reasoning ? { reasoning: true } : {}),
        ...(model.images ? { images: true } : {}),
      })),
  };
}

function problemsOf(error: unknown): string[] {
  if (error instanceof ApiError) {
    const body = error.body as { error?: unknown; details?: unknown } | undefined;
    const details = body?.details;
    if (Array.isArray(details)) {
      const issues = details
        .map((issue: { path?: unknown; message?: unknown }) => (typeof issue?.message === "string" ? `${Array.isArray(issue.path) ? `${issue.path.join(".")}: ` : ""}${issue.message}` : null))
        .filter((text): text is string => Boolean(text));
      if (issues.length) return issues;
    }
    return [error.message];
  }
  return [error instanceof Error ? error.message : "Something went wrong"];
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
      {label}
      {children}
      {hint ? <span className="text-xs font-normal text-ink-3">{hint}</span> : null}
    </label>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="flex flex-col gap-0.5 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-ink-3">{hint}</span>
      </span>
      <ToggleSwitch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

export function CustomProviderForm({
  provider,
  takenNames,
  onSaved,
  onCancel,
  onDirtyChange,
}: {
  provider: OmpCustomProviderView | null;
  takenNames: string[];
  onSaved: (list: OmpCustomProviderList) => void;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [initial] = useState<FormState>(() => initialState(provider));
  const [state, setState] = useState<FormState>(initial);
  const dirty = JSON.stringify(state) !== JSON.stringify(initial);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  const [probe, setProbe] = useState<OmpCustomProviderProbeResult | null>(null);
  const [upstream, setUpstream] = useState<OmpCustomProviderModelsFetchResult | null>(null);
  const set = (patch: Partial<FormState>) => setState((current) => ({ ...current, ...patch }));
  const setModel = (index: number, patch: Partial<ModelRow>) =>
    setState((current) => ({ ...current, models: current.models.map((model, at) => (at === index ? { ...model, ...patch } : model)) }));
  const setHeader = (index: number, patch: Partial<HeaderRow>) =>
    setState((current) => ({ ...current, headers: current.headers.map((header, at) => (at === index ? { ...header, ...patch } : header)) }));

  const editing = provider !== null;
  const nameError = !editing && state.name && !OMP_PROVIDER_NAME_PATTERN.test(state.name)
    ? "Use letters, digits, dot, dash or underscore"
    : !editing && takenNames.includes(state.name)
      ? "A provider with this name already exists; edit it instead"
      : null;

  const save = useMutation({
    mutationFn: () => onboardingOmpApi.saveCustomProvider(state.name.trim(), toInput(state)),
    onSuccess: onSaved,
  });
  const test = useMutation({
    mutationFn: () => onboardingOmpApi.probeCustomProvider({
      ...(editing ? { name: provider.name } : {}),
      baseUrl: state.baseUrl.trim(),
      apiKey: keyInput(state),
      authHeader: state.authHeader,
      headers: headersInput(state),
      ...(state.models[0]?.id.trim() ? { modelId: state.models[0].id.trim() } : {}),
    }),
    onSuccess: (result) => {
      setProbe(result);
      setState((current) => ({
        ...current,
        api: result.suggestedApi ?? current.api,
        models: current.models.some((model) => model.id.trim()) || !result.usedModel
          ? current.models
          : [{ ...EMPTY_MODEL, id: result.usedModel }],
      }));
    },
    onError: () => setProbe(null),
  });

  const fetchModels = useMutation({
    mutationFn: () => onboardingOmpApi.fetchCustomProviderModels({
      ...(editing ? { name: provider.name } : {}),
      baseUrl: state.baseUrl.trim(),
      api: (state.api || null) as OmpCustomProviderInput["api"],
      apiKey: keyInput(state),
      authHeader: state.authHeader,
      headers: headersInput(state),
    }),
    onSuccess: setUpstream,
    onError: () => setUpstream(null),
  });
  const savedIdList = state.models.map((model) => model.id.trim()).filter(Boolean).join("\n");
  const savedIds = useMemo<ReadonlySet<string>>(() => new Set(savedIdList ? savedIdList.split("\n") : []), [savedIdList]);
  const listedIds = useMemo(
    () => (upstream && !upstream.error && !upstream.truncated ? new Set(upstream.models.map((model) => model.id)) : null),
    [upstream],
  );
  const addUpstream = useCallback((models: OmpUpstreamModel[]) => {
    setState((current) => {
      const kept = current.models.filter((model) => model.id.trim());
      const have = new Set(kept.map((model) => model.id.trim()));
      const added = models.filter((model) => !have.has(model.id)).map((model) => ({ ...EMPTY_MODEL, id: model.id, name: model.name ?? "" }));
      return { ...current, models: [...kept, ...added] };
    });
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!nameError) save.mutate();
  }

  const keyModes: Array<{ mode: KeyMode; label: string }> = [
    ...(editing && provider.apiKey.kind !== "none" && provider.apiKey.kind !== "missing" ? [{ mode: "keep" as const, label: "Keep saved" }] : []),
    { mode: "literal", label: "Key" },
    { mode: "env", label: "Env variable" },
    { mode: "command", label: "Command" },
    { mode: "none", label: "No key" },
  ];

  return (
    <form onSubmit={submit} aria-label={editing ? `Edit ${provider.name}` : "Add a custom provider"} className="flex flex-col gap-4 rounded-lg border border-line bg-bg-2 px-4 py-4 sm:px-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{editing ? `Edit ${provider.name}` : "Add a custom provider"}</h3>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Close" onClick={onCancel}><X aria-hidden="true" /></Button>
      </div>
      {editing && provider.otherKeys.length ? (
        <p className="text-xs text-ink-3">Also kept as written in models.yml: {provider.otherKeys.join(", ")}.</p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" hint={nameError ?? "Used in model ids, e.g. my-gateway/model"}>
          <Input value={state.name} onChange={(event) => set({ name: event.target.value })} disabled={editing} required aria-invalid={Boolean(nameError)} placeholder="my-gateway" autoComplete="off" />
        </Field>
        <Field label="Base URL" hint="Usually ends in /v1">
          <Input value={state.baseUrl} onChange={(event) => set({ baseUrl: event.target.value })} required type="url" placeholder="http://localhost:8000/v1" autoComplete="off" />
        </Field>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">API key</span>
        <Segmented aria-label="Where the key comes from" className="flex-wrap self-start">
          {keyModes.map(({ mode, label }) => (
            <SegmentedItem key={mode} selected={state.keyMode === mode} onClick={() => set({ keyMode: mode, keyValue: "" })}>{label}</SegmentedItem>
          ))}
        </Segmented>
        {state.keyMode === "literal" ? (
          <Input value={state.keyValue} onChange={(event) => set({ keyValue: event.target.value })} type="password" autoComplete="off" required aria-label="API key" placeholder="sk-..." />
        ) : state.keyMode === "env" ? (
          <Input value={state.keyValue} onChange={(event) => set({ keyValue: event.target.value.toUpperCase() })} required aria-label="Environment variable name" placeholder="MY_GATEWAY_KEY" autoComplete="off" />
        ) : state.keyMode === "command" ? (
          <Input value={state.keyValue} onChange={(event) => set({ keyValue: event.target.value })} required aria-label="Command that prints the key" placeholder="op read op://vault/gateway/key" autoComplete="off" className="font-mono" />
        ) : null}
        <span className="text-xs text-ink-3">
          {state.keyMode === "keep" ? `The saved ${provider?.apiKey.kind === "env" ? `variable ${provider.apiKey.name}` : provider?.apiKey.kind === "command" ? "command" : "key"} stays as it is.`
            : state.keyMode === "env" ? "OMP reads the key from this variable on the machine that runs agents."
            : state.keyMode === "command" ? "OMP runs this command and uses what it prints."
            : state.keyMode === "none" ? "For local servers that need no key."
            : "Saved in OMP's models.yml. Wardmote never shows it again."}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <Field label="Wire format (api)" hint="Picking the wrong one is the most common mistake. Test connection suggests the right one.">
          <NativeSelect value={state.api} onChange={(event) => set({ api: event.target.value })} className="w-full">
            <option value="">Set per model</option>
            {OMP_PROVIDER_APIS.map((api) => <option key={api} value={api}>{API_LABELS[api] ?? api}</option>)}
          </NativeSelect>
        </Field>
        <Button type="button" variant="secondary" size="sm" className="self-start" disabled={!state.baseUrl.trim() || test.isPending} onClick={() => test.mutate()}>
          {test.isPending ? "Testing..." : "Test connection"}
        </Button>
        {test.error ? <OmpNote tone="bad">{problemsOf(test.error).join(" ")}</OmpNote> : null}
        {probe ? (
          <OmpNote tone={probe.suggestedApi ? "ok" : "bad"}>
            {probe.suggestedApi
              ? `${probe.suggestedApi} answered${probe.usedModel ? ` for ${probe.usedModel}` : ""}, so the wire format is set to it.`
              : probe.usedModel
                ? `No wire format answered for ${probe.usedModel}. Check the base URL, key and model id.`
                : "The server listed no models. Add a model id below, then test again."}
            <ul className="mt-1 flex flex-col gap-0.5 text-xs text-ink-3">
              {probe.attempts.map((attempt) => (
                <li key={attempt.api} className="break-all">
                  {attempt.api}: {attempt.status ?? "no answer"}{attempt.detail && !attempt.ok ? ` (${attempt.detail})` : ""}
                </li>
              ))}
            </ul>
          </OmpNote>
        ) : null}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium">Models</legend>
        {state.models.map((model, index) => (
          <div key={index} className="grid grid-cols-2 gap-2 rounded-md border border-line-soft p-2 sm:grid-cols-[2fr_2fr_1fr_1fr_auto]">
            {listedIds && model.id.trim() && !listedIds.has(model.id.trim()) ? (
              <span className="col-span-2 text-xs text-ink-3 sm:col-span-5">Not listed upstream any more; kept until you remove it.</span>
            ) : null}
            <Input aria-label={`Model ${index + 1} id`} value={model.id} onChange={(event) => setModel(index, { id: event.target.value })} placeholder="model id" className="col-span-2 sm:col-span-1" autoComplete="off" />
            <Input aria-label={`Model ${index + 1} name`} value={model.name} onChange={(event) => setModel(index, { name: event.target.value })} placeholder="Display name" className="col-span-2 sm:col-span-1" />
            <Input aria-label={`Model ${index + 1} context window`} value={model.contextWindow} onChange={(event) => setModel(index, { contextWindow: event.target.value })} placeholder="Context" inputMode="numeric" />
            <Input aria-label={`Model ${index + 1} max output tokens`} value={model.maxTokens} onChange={(event) => setModel(index, { maxTokens: event.target.value })} placeholder="Max output" inputMode="numeric" />
            <div className="col-span-2 flex items-center justify-between gap-3 text-xs sm:col-span-1">
              <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={model.reasoning} onChange={(event) => setModel(index, { reasoning: event.target.checked })} />Thinks</label>
              <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={model.images} onChange={(event) => setModel(index, { images: event.target.checked })} />Images</label>
              <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove model ${index + 1}`} onClick={() => set({ models: state.models.filter((_, at) => at !== index) })}><Trash2 aria-hidden="true" /></Button>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => set({ models: [...state.models, { ...EMPTY_MODEL }] })}><Plus aria-hidden="true" />Add model</Button>
          <Button type="button" variant="secondary" size="sm" disabled={!state.baseUrl.trim() || fetchModels.isPending} onClick={() => fetchModels.mutate()}>
            <CloudDownload aria-hidden="true" />{fetchModels.isPending ? "Fetching..." : "Fetch models"}
          </Button>
        </div>
        {fetchModels.error ? <OmpNote tone="bad">{problemsOf(fetchModels.error).join(" ")}</OmpNote> : null}
        {upstream?.error ? <OmpNote tone="bad">{upstream.error}</OmpNote> : null}
        {upstream && !upstream.error ? (
          <UpstreamModelPicker result={upstream} savedIds={savedIds} room={OMP_CUSTOM_PROVIDER_MODEL_LIMIT - savedIds.size} onAdd={addUpstream} />
        ) : null}
        <span className="text-xs text-ink-3">Leave context and max output empty when unsure; OMP fills known models in.</span>
      </fieldset>

      <details className="flex flex-col gap-3">
        <summary className="cursor-pointer select-none text-sm font-medium">Advanced</summary>
        <div className="mt-3 flex flex-col gap-3">
          <Toggle label="Send the key as an Authorization header" hint="OpenAI wire formats already do. Turn on for discovery or proxies that need it." checked={state.authHeader} onChange={(value) => set({ authHeader: value })} />
          <Toggle label="Disable strict tools" hint="For Anthropic-style proxies that reject strict tool schemas." checked={state.disableStrictTools} onChange={(value) => set({ disableStrictTools: value })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Model discovery" hint="Ask the server for its models instead of listing them">
              <NativeSelect value={state.discovery} onChange={(event) => set({ discovery: event.target.value })} className="w-full">
                <option value="">Off</option>
                {OMP_DISCOVERY_TYPES.map((type) => <option key={type} value={type}>{DISCOVERY_LABELS[type] ?? type}</option>)}
              </NativeSelect>
            </Field>
            {state.discovery ? (
              <Field label="Discovery timeout (ms)">
                <Input value={state.discoveryTimeout} onChange={(event) => set({ discoveryTimeout: event.target.value })} inputMode="numeric" placeholder="OMP default" />
              </Field>
            ) : null}
          </div>
          {state.discovery === "openai-models-list" ? (
            <Toggle label="Add /v1 to the discovery URL" hint="Turn on when the base URL has no /v1 but the model list lives under it." checked={state.injectV1} onChange={(value) => set({ injectV1: value })} />
          ) : null}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium">Extra headers</legend>
            {state.headers.map((header, index) => (
              <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <Input aria-label={`Header ${index + 1} name`} value={header.name} onChange={(event) => setHeader(index, { name: event.target.value })} placeholder="X-Header" disabled={header.saved} />
                <Input aria-label={`Header ${index + 1} value`} value={header.value} onChange={(event) => setHeader(index, { value: event.target.value })} placeholder={header.saved ? "Saved; type to replace" : "value"} type="password" autoComplete="off" />
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove header ${index + 1}`} onClick={() => set({ headers: state.headers.filter((_, at) => at !== index) })}><Trash2 aria-hidden="true" /></Button>
              </div>
            ))}
            <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => set({ headers: [...state.headers, { name: "", value: "", saved: false }] })}><Plus aria-hidden="true" />Add header</Button>
          </fieldset>
        </div>
      </details>

      {save.error ? (
        <OmpNote tone="bad">
          <ul className="flex flex-col gap-0.5">{problemsOf(save.error).map((problem) => <li key={problem}>{problem}</li>)}</ul>
        </OmpNote>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={save.isPending || Boolean(nameError)}>{save.isPending ? "Checking with OMP..." : "Save provider"}</Button>
      </div>
    </form>
  );
}

function keySummary(provider: OmpCustomProviderView): string {
  switch (provider.apiKey.kind) {
    case "env":
      return provider.apiKey.present ? `key from ${provider.apiKey.name}` : `${provider.apiKey.name} is not set on the server`;
    case "literal":
      return "key saved";
    case "command":
      return "key from a command";
    case "none":
      return "no key";
    case "oauth":
      return "OMP sign-in";
    default:
      return "no key set";
  }
}

const NEW_PROVIDER = ":new";

function providerKey(provider: OmpCustomProviderView | typeof NEW_PROVIDER): string {
  return provider === NEW_PROVIDER ? NEW_PROVIDER : provider.name;
}

export function CustomProviders({ onChanged }: { onChanged?: () => void }) {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: OMP_CUSTOM_PROVIDERS_KEY, queryFn: () => onboardingOmpApi.customProviders() });
  const editor = useInlineRowEditor<OmpCustomProviderView | typeof NEW_PROVIDER>(providerKey);
  const remove = useMutation({
    mutationFn: (name: string) => onboardingOmpApi.removeCustomProvider(name),
    onSuccess: (data, name) => {
      queryClient.setQueryData(OMP_CUSTOM_PROVIDERS_KEY, data);
      if (editor.openKey === name) editor.close(false);
      onChanged?.();
    },
  });
  const providers = list.data?.providers ?? [];
  const takenNames = providers.map((provider) => provider.name);
  const onSaved = (data: OmpCustomProviderList) => {
    queryClient.setQueryData(OMP_CUSTOM_PROVIDERS_KEY, data);
    editor.close();
    onChanged?.();
  };

  return (
    <div className="flex flex-col gap-3">
      {list.error ? <OmpNote tone="bad">{problemsOf(list.error).join(" ")}</OmpNote> : null}
      {list.data?.parseError ? <OmpNote tone="bad">{list.data.parseError}. Fix {list.data.modelsPath} by hand; Wardmote will not overwrite it.</OmpNote> : null}
      {providers.length ? (
        <ul aria-label="Custom providers" className="flex flex-col divide-y divide-line rounded-lg border border-line">
          {providers.map((provider) => (
            <li key={provider.name}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <b className="font-medium">{provider.name}</b>
                <span className="min-w-0 flex-1 truncate text-xs text-ink-3">
                  {[provider.baseUrl, provider.api, keySummary(provider), provider.discovery ? `discovery: ${provider.discovery.type}` : `${provider.models.length} ${provider.models.length === 1 ? "model" : "models"}`].filter(Boolean).join(" · ")}
                </span>
                <span className="flex gap-1">
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${provider.name}`} {...editor.triggerProps(provider.name)} onClick={() => editor.toggle(provider)}><Pencil aria-hidden="true" /></Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${provider.name}`}
                    disabled={remove.isPending}
                    onClick={() => {
                      if (window.confirm(`Remove ${provider.name} from OMP's models.yml? A backup stays in models.yml.bak.`)) remove.mutate(provider.name);
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </span>
              </div>
              {editor.openKey === provider.name ? (
                <InlineRowEditorPanel id={editor.panelId(provider.name)} onEscape={editor.dismiss} className="px-2 pb-2 sm:px-3 sm:pb-3">
                  <CustomProviderForm
                    provider={provider}
                    takenNames={takenNames}
                    onCancel={() => editor.close()}
                    onSaved={onSaved}
                    onDirtyChange={editor.setDirty}
                  />
                </InlineRowEditorPanel>
              ) : null}
            </li>
          ))}
        </ul>
      ) : list.isLoading ? <p className="text-sm text-ink-3">Reading models.yml...</p> : null}
      {remove.error ? <OmpNote tone="bad">{problemsOf(remove.error).join(" ")}</OmpNote> : null}
      {editor.openKey === NEW_PROVIDER ? (
        <InlineRowEditorPanel id={editor.panelId(NEW_PROVIDER)} onEscape={editor.dismiss}>
          <CustomProviderForm
            provider={null}
            takenNames={takenNames}
            onCancel={() => editor.close()}
            onSaved={onSaved}
            onDirtyChange={editor.setDirty}
          />
        </InlineRowEditorPanel>
      ) : (
        <Button type="button" variant="secondary" size="sm" className="self-start" disabled={Boolean(list.data?.parseError)} {...editor.triggerProps(NEW_PROVIDER)} onClick={() => editor.request(NEW_PROVIDER)}>
          <Plus aria-hidden="true" />Add custom provider
        </Button>
      )}
      {list.data ? <p className="text-xs text-ink-3">Saved to {list.data.modelsPath}, with the previous copy in models.yml.bak.</p> : null}
    </div>
  );
}
