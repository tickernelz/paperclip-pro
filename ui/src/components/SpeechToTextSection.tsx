import { useMemo, useState, type KeyboardEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  SPEECH_TO_TEXT_CURATED_MODELS,
  SPEECH_TO_TEXT_DEFAULT_BASE_URLS,
  SPEECH_TO_TEXT_DEFAULT_KEY_ENV_VARS,
  SPEECH_TO_TEXT_DEFAULTS,
  SPEECH_TO_TEXT_GOOGLE_LOCATIONS,
  SPEECH_TO_TEXT_GOOGLE_MAX_LANGUAGES,
  SPEECH_TO_TEXT_KEYTERM_MAX_LENGTH,
  SPEECH_TO_TEXT_KEYTERMS_MAX,
  SPEECH_TO_TEXT_LANGUAGES,
  SPEECH_TO_TEXT_MAX_SPEAKERS,
  type SpeechToTextCredentialStatus,
  type SpeechToTextProvider,
  type SpeechToTextSettings,
  type SpeechToTextTestResult,
} from "@tickernelz/wardmote-shared";
import { ChevronDown, Minus, Plus, X } from "lucide-react";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { SearchableSelect, type SearchableSelectOption } from "@/components/SearchableSelect";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { queryKeys } from "@/lib/queryKeys";

const PROVIDER_LABELS: Record<SpeechToTextProvider, string> = {
  deepgram: "Deepgram",
  elevenlabs: "ElevenLabs",
  google: "Google Cloud Speech-to-Text",
  openai_compatible: "OpenAI-compatible endpoint",
};

const OTHER_MODEL = "__other__";

const ERROR_TEXT: Record<string, string> = {
  stt_disabled: "Speech-to-text is not configured. Choose a provider and a model.",
  stt_missing_key: "The API key variable is not set on the server. Set it in the server environment and restart Wardmote.",
  stt_invalid_credentials: "The Google service account key cannot be read. Point the variable at a service account JSON key file.",
  stt_too_long: "The audio is longer than the limit. Use a shorter file or raise Max audio in Advanced.",
  stt_too_large: "The file is larger than the provider accepts. Use a smaller file.",
  stt_empty: "The file is empty. Choose another audio file.",
  stt_timeout: "The provider did not answer in time. Try again.",
  stt_rejected: "The provider rejected the request. Check the key, the model and the language.",
  stt_unavailable: "The provider is busy or down. Try again in a minute.",
  stt_network: "Wardmote could not reach the provider. Check the server's network access.",
  stt_invalid_response: "The provider answered in an unexpected format. Check the base URL and model.",
};

const languageNames = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" });
  } catch {
    return null;
  }
})();

export function speechToTextLanguageLabel(code: string): string {
  if (code === "") return "Automatic (detect language)";
  if (code === "multi") return "Multilingual (Nova-3, mixed languages)";
  let name: string | undefined;
  try {
    name = languageNames?.of(code);
  } catch {
    name = undefined;
  }
  return name && name !== code ? name + " (" + code + ")" : code;
}

export function speechToTextErrorText(code: string): string {
  return ERROR_TEXT[code] ?? "Speech-to-text failed.";
}

type FieldErrors = Partial<Record<"model" | "language" | "baseUrl" | "key" | "alternativeLanguages", string>>;

export function speechToTextFieldErrors(draft: SpeechToTextSettings, credentials: SpeechToTextCredentialStatus | undefined): FieldErrors {
  const errors: FieldErrors = {};
  if (draft.provider === "openai_compatible" && draft.baseUrl.trim() === "") errors.baseUrl = "Enter the endpoint base URL, for example https://api.openai.com/v1.";
  if (draft.model.trim() === "") errors.model = "Choose a model.";
  const state = credentials?.[draft.provider];
  if (draft.apiKeyEnvVar.trim() === "") errors.key = "Choose the key variable in Advanced.";
  else if (state && draft.apiKeyEnvVar === state.envVar && !state.set)
    errors.key = "Set " + state.envVar + " in the server environment, then restart Wardmote.";
  else if (state && draft.provider === "google" && draft.apiKeyEnvVar === state.envVar && state.usable === false)
    errors.key = state.envVar + " must hold a service account JSON key or the path of that file.";
  if (draft.provider === "google") {
    const chirp = draft.model.startsWith("chirp");
    if (!chirp && draft.model !== "" && draft.language === "") errors.language = "Choose a language: only Chirp models detect it automatically.";
    if (draft.google.alternativeLanguages.length > 0 && (chirp || draft.language === ""))
      errors.alternativeLanguages = "Remove the alternative languages, or choose a language and the long, short or telephony model.";
  }
  return errors;
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-xs text-bad">{message}</p> : null;
}

function ToggleRow({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (next: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm">{label}</span>
      <ToggleSwitch checked={checked} onCheckedChange={() => onChange(!checked)} disabled={disabled} aria-label={label} />
    </div>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  step,
  unit,
  defaultValue,
  disabled,
  onChange,
}: {
  label: string;
  value: number | null;
  min: number;
  max: number;
  step: number;
  unit: string;
  defaultValue: number | null;
  disabled: boolean;
  onChange: (next: number | null) => void;
}) {
  const current = value ?? defaultValue ?? min;
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-ink-3">{label}</span>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          aria-label={"Decrease " + label}
          disabled={disabled || (value !== null && value <= min)}
          onClick={() => onChange(clamp(current - step))}
        >
          <Minus className="size-3" />
        </Button>
        <span className="min-w-20 text-center text-sm tabular-nums" aria-label={label}>
          {value === null ? "Automatic" : value + " " + unit}
        </span>
        <Button
          variant="secondary"
          size="sm"
          aria-label={"Increase " + label}
          disabled={disabled || current >= max}
          onClick={() => onChange(clamp(value === null ? min : current + step))}
        >
          <Plus className="size-3" />
        </Button>
        {value !== defaultValue ? (
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(defaultValue)}>
            Default ({defaultValue === null ? "automatic" : defaultValue + " " + unit})
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function KeytermChips({
  values,
  disabled,
  onChange,
}: {
  values: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  const [text, setText] = useState("");
  const full = values.length >= SPEECH_TO_TEXT_KEYTERMS_MAX;
  const add = () => {
    const term = text.trim();
    if (!term || full || term.length > SPEECH_TO_TEXT_KEYTERM_MAX_LENGTH || values.includes(term) || /[<>{}[\]\\]/.test(term)) return;
    onChange([...values, term]);
    setText("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    add();
  };
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-ink-3">
        Keyterms ({values.length}/{SPEECH_TO_TEXT_KEYTERMS_MAX})
      </span>
      <div className="flex flex-wrap gap-1.5">
        {values.map((term) => (
          <span key={term} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs">
            {term}
            <button type="button" aria-label={"Remove " + term} disabled={disabled} onClick={() => onChange(values.filter((entry) => entry !== term))}>
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <Input
        aria-label="Add keyterm"
        value={text}
        maxLength={SPEECH_TO_TEXT_KEYTERM_MAX_LENGTH}
        placeholder={full ? "Limit reached" : "Type a word or name, then press Enter"}
        disabled={disabled || full}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}

function languageOptions(codes: readonly string[], automatic: boolean): SearchableSelectOption[] {
  const options = codes.map((code) => ({ key: code, value: code, label: speechToTextLanguageLabel(code), searchText: code }));
  return automatic ? [{ key: "auto", value: "", label: speechToTextLanguageLabel(""), searchText: "auto detect" }, ...options] : options;
}

function TestResult({ result }: { result: SpeechToTextTestResult }) {
  if (!result.ok) {
    return (
      <div className="space-y-0.5 text-sm" role="status">
        <p className="text-bad">{speechToTextErrorText(result.code)}</p>
        <p className="text-xs text-ink-3">
          {result.code}
          {result.status ? " · HTTP " + result.status : ""}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-1 text-sm" role="status">
      <p className="text-xs text-ink-3">
        Transcribed in {(result.durationMs / 1000).toFixed(1)} s{result.language ? " · " + speechToTextLanguageLabel(result.language) : ""}
      </p>
      {result.segments && new Set(result.segments.map((segment) => segment.speaker)).size > 1 ? (
        result.segments.map((segment, index) => (
          <p key={index}>
            <span className="font-medium">{segment.speaker}:</span> {segment.text}
          </p>
        ))
      ) : (
        <p>{result.text || "(no speech detected)"}</p>
      )}
    </div>
  );
}

export function SpeechToTextSection({
  value,
  disabled,
  onSave,
}: {
  value: SpeechToTextSettings;
  disabled: boolean;
  onSave: (next: SpeechToTextSettings) => void;
}) {
  const initial = value.apiKeyEnvVar === "" ? { ...value, apiKeyEnvVar: SPEECH_TO_TEXT_DEFAULT_KEY_ENV_VARS[value.provider] } : value;
  const [draft, setDraft] = useState<SpeechToTextSettings>(initial);
  const [fetched, setFetched] = useState<{ provider: SpeechToTextProvider; models: string[]; locations: string[]; source: string } | null>(null);
  const [otherModel, setOtherModel] = useState(
    () => value.model !== "" && !SPEECH_TO_TEXT_CURATED_MODELS[value.provider].includes(value.model),
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [testFile, setTestFile] = useState<File | null>(null);
  const provider = draft.provider;
  const update = (patch: Partial<SpeechToTextSettings>) => setDraft((current) => ({ ...current, ...patch }));

  const credentialsQuery = useQuery({
    queryKey: queryKeys.instance.speechToTextCredentials,
    queryFn: () => instanceSettingsApi.getSpeechToTextCredentials(),
    retry: false,
  });
  const credentials = credentialsQuery.data;
  const credential = credentials?.[provider];
  const defaultEnvVar = SPEECH_TO_TEXT_DEFAULT_KEY_ENV_VARS[provider];
  const customKey = draft.apiKeyEnvVar !== defaultEnvVar;
  const errors = speechToTextFieldErrors(draft, credentials);
  const blocking = Object.keys(errors).length > 0;
  const dirty = JSON.stringify(draft) !== JSON.stringify(value);

  const models = useMemo(() => {
    const list = fetched?.provider === provider ? fetched.models : [...SPEECH_TO_TEXT_CURATED_MODELS[provider]];
    return draft.model && !otherModel && !list.includes(draft.model) ? [draft.model, ...list] : list;
  }, [fetched, provider, draft.model, otherModel]);
  const locations = useMemo(() => {
    const list = fetched?.provider === "google" && fetched.locations.length > 0 ? fetched.locations : [...SPEECH_TO_TEXT_GOOGLE_LOCATIONS];
    return list.includes(draft.google.location) ? list : [draft.google.location, ...list];
  }, [fetched, draft.google.location]);
  const languageCodes = SPEECH_TO_TEXT_LANGUAGES[provider];
  const languageChoices = useMemo(() => {
    const automatic = provider !== "google" || draft.model.startsWith("chirp");
    const codes = draft.language && !languageCodes.includes(draft.language) ? [draft.language, ...languageCodes] : languageCodes;
    return languageOptions(codes, automatic);
  }, [provider, draft.model, draft.language, languageCodes]);
  const alternativeChoices = useMemo(
    () => languageOptions(languageCodes.filter((code) => code !== draft.language && !draft.google.alternativeLanguages.includes(code)), false),
    [languageCodes, draft.language, draft.google.alternativeLanguages],
  );

  const fetchModels = useMutation({
    mutationFn: () =>
      instanceSettingsApi.listSpeechToTextModels({
        provider,
        baseUrl: draft.baseUrl.trim(),
        apiKeyEnvVar: draft.apiKeyEnvVar.trim(),
        ...(provider === "google" ? { google: { location: draft.google.location, projectId: draft.google.projectId } } : {}),
      }),
    onSuccess: (list) => setFetched({ provider, models: list.models.map((model) => model.id), locations: list.locations ?? [], source: list.source }),
  });
  const testMutation = useMutation({
    mutationFn: (file: File) => instanceSettingsApi.testSpeechToText(draft, file),
  });

  const changeProvider = (next: SpeechToTextProvider) => {
    fetchModels.reset();
    testMutation.reset();
    setOtherModel(false);
    update({
      provider: next,
      model: SPEECH_TO_TEXT_CURATED_MODELS[next][0] ?? "",
      baseUrl: "",
      apiKeyEnvVar: SPEECH_TO_TEXT_DEFAULT_KEY_ENV_VARS[next],
      language: "",
      diarize: next === "openai_compatible" ? false : draft.diarize,
      google: { ...draft.google, alternativeLanguages: [] },
    });
  };

  const keyStatus = (() => {
    if (customKey) return { tone: "text-ink-3", text: "Custom variable " + draft.apiKeyEnvVar + ": not checked here. Run Test to confirm it works." };
    if (credentialsQuery.isLoading) return { tone: "text-ink-3", text: "Checking " + defaultEnvVar + "..." };
    if (!credential) return { tone: "text-ink-3", text: "Uses " + defaultEnvVar + ". Its status could not be read." };
    if (!credential.set) return { tone: "text-bad", text: defaultEnvVar + " is not set on the server." };
    if (provider === "google" && credential.usable === false) return { tone: "text-bad", text: defaultEnvVar + " is set but is not a usable service account key." };
    return { tone: "text-ok", text: defaultEnvVar + " is set on the server." };
  })();
  const googleProject = draft.google.projectId || credential?.projectId || "";

  return (
    <section>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <h2 className="text-sm font-semibold">Speech-to-text</h2>
            <p className="max-w-2xl text-sm text-ink-3">
              Transcribe WhatsApp voice notes and any audio or video attachment agents read. API keys stay in the server
              environment and are never stored by Wardmote. Off by default.
            </p>
          </div>
          <ToggleSwitch
            checked={draft.enabled}
            onCheckedChange={() => update({ enabled: !draft.enabled })}
            disabled={disabled || (!draft.enabled && blocking)}
            aria-label="Toggle speech-to-text"
          />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-ink-3">Provider</span>
            <NativeSelect
              aria-label="Speech-to-text provider"
              value={provider}
              disabled={disabled}
              onChange={(event) => changeProvider(event.target.value as SpeechToTextProvider)}
            >
              {(Object.keys(PROVIDER_LABELS) as SpeechToTextProvider[]).map((id) => (
                <option key={id} value={id}>
                  {PROVIDER_LABELS[id]}
                </option>
              ))}
            </NativeSelect>
          </label>
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-ink-3">API key</span>
            <p className={"text-sm " + keyStatus.tone} data-testid="stt-key-status">
              {keyStatus.text}
            </p>
            {provider === "google" && googleProject ? (
              <p className="text-xs text-ink-3">
                Project {googleProject}
                {draft.google.projectId ? " (set in Advanced)" : " (from the service account)"}
              </p>
            ) : null}
            <FieldError message={errors.key} />
          </div>

          {provider === "openai_compatible" ? (
            <label className="space-y-1.5 md:col-span-2">
              <span className="text-xs font-medium text-ink-3">Endpoint base URL</span>
              <Input
                aria-label="Speech-to-text base URL"
                value={draft.baseUrl}
                placeholder="https://api.openai.com/v1"
                disabled={disabled}
                onChange={(event) => update({ baseUrl: event.target.value })}
              />
              <FieldError message={errors.baseUrl} />
            </label>
          ) : null}

          <div className="space-y-1.5">
            <span className="text-xs font-medium text-ink-3">Model</span>
            <div className="flex gap-2">
              <NativeSelect
                aria-label="Speech-to-text model"
                value={otherModel ? OTHER_MODEL : draft.model}
                disabled={disabled}
                onChange={(event) => {
                  if (event.target.value === OTHER_MODEL) {
                    setOtherModel(true);
                    update({ model: "" });
                  } else {
                    setOtherModel(false);
                    update({ model: event.target.value });
                  }
                }}
              >
                {models.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
                <option value={OTHER_MODEL}>Other model...</option>
              </NativeSelect>
              <Button variant="secondary" size="sm" disabled={disabled || fetchModels.isPending} onClick={() => fetchModels.mutate()}>
                {fetchModels.isPending ? "Fetching..." : "Fetch"}
              </Button>
            </div>
            {otherModel ? (
              <Input
                aria-label="Other model id"
                value={draft.model}
                placeholder="Model id from the provider"
                disabled={disabled}
                onChange={(event) => update({ model: event.target.value.trim() })}
              />
            ) : null}
            {fetchModels.isError ? (
              <p className="text-xs text-bad">
                {fetchModels.error instanceof Error ? fetchModels.error.message : "Could not list models."} The suggested list stays available.
              </p>
            ) : fetched?.provider === provider ? (
              <p className="text-xs text-ink-3">
                {fetched.models.length} models {fetched.source === "provider" ? "from the provider" : "from Wardmote's list (the provider publishes none)"}
              </p>
            ) : null}
            <FieldError message={errors.model} />
          </div>

          <div className="space-y-1.5">
            <span className="text-xs font-medium text-ink-3">Language</span>
            <SearchableSelect
              value={draft.language}
              groups={[{ id: "languages", options: languageChoices }]}
              onValueChange={(language) => update({ language })}
              placeholder="Choose a language"
              searchPlaceholder="Search languages..."
              triggerAriaLabel="Speech-to-text language"
              disabled={disabled}
              renderValue={(option) => option?.label ?? speechToTextLanguageLabel(draft.language)}
            />
            <FieldError message={errors.language} />
          </div>
        </div>

        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" aria-expanded={advancedOpen}>
              <ChevronDown className={"size-4 transition-transform " + (advancedOpen ? "rotate-180" : "")} />
              Advanced
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              {provider !== "openai_compatible" ? (
                <div className="space-y-3">
                  <ToggleRow label="Speaker diarization" checked={draft.diarize} disabled={disabled} onChange={(diarize) => update({ diarize })} />
                  {provider === "deepgram" ? (
                    <ToggleRow label="Smart formatting" checked={draft.deepgram.smartFormat} disabled={disabled} onChange={(smartFormat) => update({ deepgram: { smartFormat } })} />
                  ) : null}
                  {provider === "elevenlabs" ? (
                    <ToggleRow
                      label="Tag audio events"
                      checked={draft.elevenlabs.tagAudioEvents}
                      disabled={disabled}
                      onChange={(tagAudioEvents) => update({ elevenlabs: { ...draft.elevenlabs, tagAudioEvents } })}
                    />
                  ) : null}
                  {provider === "google" ? (
                    <ToggleRow
                      label="Automatic punctuation"
                      checked={draft.google.autoPunctuation}
                      disabled={disabled}
                      onChange={(autoPunctuation) => update({ google: { ...draft.google, autoPunctuation } })}
                    />
                  ) : null}
                  {provider === "elevenlabs" && draft.diarize ? (
                    <Stepper
                      label="Maximum speakers"
                      value={draft.elevenlabs.numSpeakers}
                      min={1}
                      max={SPEECH_TO_TEXT_MAX_SPEAKERS}
                      step={1}
                      unit="speakers"
                      defaultValue={null}
                      disabled={disabled}
                      onChange={(numSpeakers) => update({ elevenlabs: { ...draft.elevenlabs, numSpeakers } })}
                    />
                  ) : null}
                </div>
              ) : null}
              {provider !== "openai_compatible" ? (
                <KeytermChips values={draft.keyterms} disabled={disabled} onChange={(keyterms) => update({ keyterms })} />
              ) : null}

              {provider === "google" ? (
                <>
                  <label className="space-y-1.5">
                    <span className="text-xs font-medium text-ink-3">Location</span>
                    <NativeSelect
                      aria-label="Google location"
                      value={draft.google.location}
                      disabled={disabled}
                      onChange={(event) => update({ google: { ...draft.google, location: event.target.value } })}
                    >
                      {locations.map((location) => (
                        <option key={location} value={location}>
                          {location}
                        </option>
                      ))}
                    </NativeSelect>
                    <span className="block text-xs text-ink-3">Chirp 3 runs in us and eu. Fetch lists every location your project can use.</span>
                  </label>
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-ink-3">
                      Alternative languages ({draft.google.alternativeLanguages.length}/{SPEECH_TO_TEXT_GOOGLE_MAX_LANGUAGES - 1})
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {draft.google.alternativeLanguages.map((code) => (
                        <span key={code} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs">
                          {speechToTextLanguageLabel(code)}
                          <button
                            type="button"
                            aria-label={"Remove " + code}
                            disabled={disabled}
                            onClick={() => update({ google: { ...draft.google, alternativeLanguages: draft.google.alternativeLanguages.filter((entry) => entry !== code) } })}
                          >
                            <X className="size-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                    <SearchableSelect<string>
                      value=""
                      groups={[{ id: "alternatives", options: alternativeChoices }]}
                      onValueChange={(code) => update({ google: { ...draft.google, alternativeLanguages: [...draft.google.alternativeLanguages, code] } })}
                      placeholder="Add a language"
                      searchPlaceholder="Search languages..."
                      triggerAriaLabel="Add alternative language"
                      disabled={disabled || draft.google.alternativeLanguages.length >= SPEECH_TO_TEXT_GOOGLE_MAX_LANGUAGES - 1}
                    />
                    <span className="block text-xs text-ink-3">For the long, short and telephony models, next to the chosen language.</span>
                    <FieldError message={errors.alternativeLanguages} />
                  </div>
                </>
              ) : null}

              <Stepper
                label="Max audio"
                value={draft.maxAudioSeconds}
                min={30}
                max={7200}
                step={30}
                unit="s"
                defaultValue={SPEECH_TO_TEXT_DEFAULTS.maxAudioSeconds}
                disabled={disabled}
                onChange={(next) => update({ maxAudioSeconds: next ?? SPEECH_TO_TEXT_DEFAULTS.maxAudioSeconds })}
              />
              <Stepper
                label="Voice note wait"
                value={draft.sttWaitSeconds}
                min={1}
                max={120}
                step={5}
                unit="s"
                defaultValue={SPEECH_TO_TEXT_DEFAULTS.sttWaitSeconds}
                disabled={disabled}
                onChange={(next) => update({ sttWaitSeconds: next ?? SPEECH_TO_TEXT_DEFAULTS.sttWaitSeconds })}
              />
              <p className="text-xs text-ink-3 md:col-span-2">
                Max audio is checked for Ogg Opus voice notes; other formats are limited by size only. Voice note wait is how long a
                WhatsApp wake waits for the transcript before it continues without it.
              </p>

              <label className="space-y-1.5">
                <span className="text-xs font-medium text-ink-3">Key variable name</span>
                <Input
                  aria-label="Key variable name"
                  value={draft.apiKeyEnvVar}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={disabled}
                  onChange={(event) => update({ apiKeyEnvVar: event.target.value.trim() })}
                />
                {customKey ? (
                  <Button variant="ghost" size="sm" disabled={disabled} onClick={() => update({ apiKeyEnvVar: defaultEnvVar })}>
                    Use {defaultEnvVar}
                  </Button>
                ) : null}
              </label>
              {provider !== "openai_compatible" ? (
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-ink-3">Base URL override</span>
                  <Input
                    aria-label="Base URL override"
                    value={draft.baseUrl}
                    placeholder={
                      provider === "google"
                        ? draft.google.location === "global"
                          ? "https://speech.googleapis.com"
                          : "https://" + draft.google.location + "-speech.googleapis.com"
                        : SPEECH_TO_TEXT_DEFAULT_BASE_URLS[provider]
                    }
                    disabled={disabled}
                    onChange={(event) => update({ baseUrl: event.target.value.trim() })}
                  />
                </label>
              ) : null}
              {provider === "google" ? (
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-ink-3">Project id override</span>
                  <Input
                    aria-label="Google project id"
                    value={draft.google.projectId}
                    placeholder={credential?.projectId ?? "From the service account key"}
                    disabled={disabled}
                    onChange={(event) => update({ google: { ...draft.google, projectId: event.target.value.trim() } })}
                  />
                </label>
              ) : null}
            </div>
          </CollapsibleContent>
        </Collapsible>

        <div className="space-y-2">
          <span className="text-xs font-medium text-ink-3">Test with an audio file</span>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="file"
              accept="audio/*,video/*"
              aria-label="Speech-to-text test audio"
              disabled={disabled}
              onChange={(event) => {
                setTestFile(event.target.files?.[0] ?? null);
                testMutation.reset();
              }}
              className="text-sm"
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled || blocking || !testFile || testMutation.isPending}
              onClick={() => testFile && testMutation.mutate(testFile)}
            >
              {testMutation.isPending ? "Transcribing..." : "Test speech-to-text"}
            </Button>
          </div>
          {testMutation.data ? <TestResult result={testMutation.data} /> : null}
          {testMutation.isError ? (
            <p className="text-sm text-bad">{testMutation.error instanceof Error ? testMutation.error.message : "Test failed."}</p>
          ) : null}
        </div>

        <div className="flex gap-2">
          <Button size="sm" disabled={disabled || !dirty} onClick={() => onSave(draft)}>
            Save speech-to-text
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled || !dirty}
            onClick={() => {
              setDraft(initial);
              setOtherModel(value.model !== "" && !SPEECH_TO_TEXT_CURATED_MODELS[value.provider].includes(value.model));
            }}
          >
            Reset
          </Button>
        </div>
      </div>
    </section>
  );
}
