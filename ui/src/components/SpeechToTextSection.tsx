import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  SPEECH_TO_TEXT_CURATED_MODELS,
  SPEECH_TO_TEXT_DEFAULT_BASE_URLS,
  SPEECH_TO_TEXT_GOOGLE_MAX_LANGUAGES,
  SPEECH_TO_TEXT_GOOGLE_SYNC_MAX_SECONDS,
  SPEECH_TO_TEXT_KEYTERMS_MAX,
  SPEECH_TO_TEXT_MAX_SPEAKERS,
  type SpeechToTextModelOption,
  type SpeechToTextProvider,
  type SpeechToTextSettings,
  type SpeechToTextTestResult,
} from "@tickernelz/wardmote-shared";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { ToggleSwitch } from "@/components/ui/toggle-switch";

const PROVIDER_LABELS: Record<SpeechToTextProvider, string> = {
  openai_compatible: "OpenAI-compatible",
  deepgram: "Deepgram",
  elevenlabs: "ElevenLabs",
  google: "Google Cloud Speech-to-Text",
};

const KEY_PLACEHOLDERS: Record<SpeechToTextProvider, string> = {
  openai_compatible: "OPENAI_API_KEY",
  deepgram: "DEEPGRAM_API_KEY",
  elevenlabs: "ELEVENLABS_API_KEY",
  google: "GOOGLE_APPLICATION_CREDENTIALS",
};

function googleOriginFor(location: string): string {
  return location === "global" ? "https://speech.googleapis.com" : "https://" + (location || "us") + "-speech.googleapis.com";
}

function parseLanguageList(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((code) => code.trim())
    .filter(Boolean);
}

function parseKeyterms(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function isComplete(draft: SpeechToTextSettings): boolean {
  return (
    draft.model.trim() !== "" &&
    draft.apiKeyEnvVar.trim() !== "" &&
    (draft.provider !== "openai_compatible" || draft.baseUrl.trim() !== "")
  );
}

function ToggleRow({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (next: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm">{label}</span>
      <ToggleSwitch checked={checked} onCheckedChange={() => onChange(!checked)} disabled={disabled} aria-label={label} />
    </div>
  );
}

function TestResult({ result }: { result: SpeechToTextTestResult }) {
  if (!result.ok) {
    return (
      <p className="text-sm text-bad" role="status">
        {result.code}: {result.message}
      </p>
    );
  }
  return (
    <div className="space-y-1 text-sm" role="status">
      <p className="text-xs text-ink-3">
        {(result.durationMs / 1000).toFixed(1)} s{result.language ? " · " + result.language : ""}
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
  const modelListId = useId();
  const [draft, setDraft] = useState<SpeechToTextSettings>(value);
  const [keytermText, setKeytermText] = useState(value.keyterms.join("\n"));
  const [alternativeLanguageText, setAlternativeLanguageText] = useState(value.google.alternativeLanguages.join(", "));
  const [fetchedModels, setFetchedModels] = useState<{ provider: SpeechToTextProvider; models: SpeechToTextModelOption[]; source: string } | null>(null);
  const [testFile, setTestFile] = useState<File | null>(null);
  const complete = isComplete(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(value);
  const update = (patch: Partial<SpeechToTextSettings>) => setDraft((current) => ({ ...current, ...patch }));
  const numeric = (raw: string, fallback: number) => {
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const provider = draft.provider;
  const models: SpeechToTextModelOption[] =
    fetchedModels?.provider === provider
      ? fetchedModels.models
      : SPEECH_TO_TEXT_CURATED_MODELS[provider].map((id) => ({ id }));

  const fetchModels = useMutation({
    mutationFn: () =>
      instanceSettingsApi.listSpeechToTextModels({
        provider,
        baseUrl: draft.baseUrl.trim(),
        apiKeyEnvVar: draft.apiKeyEnvVar.trim(),
        ...(provider === "google" ? { google: { location: draft.google.location, projectId: draft.google.projectId } } : {}),
      }),
    onSuccess: (list) => setFetchedModels({ provider, models: list.models, source: list.source }),
  });
  const testMutation = useMutation({
    mutationFn: (file: File) => instanceSettingsApi.testSpeechToText(draft, file),
  });

  const changeProvider = (next: SpeechToTextProvider) => {
    fetchModels.reset();
    testMutation.reset();
    update({ provider: next, model: SPEECH_TO_TEXT_CURATED_MODELS[next][0] ?? "", baseUrl: "", diarize: next === "openai_compatible" ? false : draft.diarize });
  };

  const keytermCount = draft.keyterms.length;

  return (
    <section>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <h2 className="text-sm font-semibold">Speech-to-text</h2>
            <p className="max-w-2xl text-sm text-ink-3">
              Transcribe voice notes and audio for chat connectors and agents, with Deepgram, ElevenLabs or any
              OpenAI-compatible /audio/transcriptions endpoint. The API key is read from the named server environment
              variable at call time and is never stored by Wardmote. This is off by default.
            </p>
          </div>
          <ToggleSwitch
            checked={draft.enabled}
            onCheckedChange={() => update({ enabled: !draft.enabled })}
            disabled={disabled || (!draft.enabled && !complete)}
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
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-ink-3">
              Base URL{provider === "openai_compatible" ? "" : " (optional)"}
            </span>
            <Input
              value={draft.baseUrl}
              placeholder={
                provider === "google" ? googleOriginFor(draft.google.location) : SPEECH_TO_TEXT_DEFAULT_BASE_URLS[provider] || "https://api.openai.com/v1"
              }
              disabled={disabled}
              onChange={(event) => update({ baseUrl: event.target.value })}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-ink-3">
              {provider === "google" ? "Service account key environment variable (JSON or file path)" : "API key environment variable"}
            </span>
            <Input
              value={draft.apiKeyEnvVar}
              placeholder={KEY_PLACEHOLDERS[provider]}
              autoComplete="off"
              spellCheck={false}
              disabled={disabled}
              onChange={(event) => update({ apiKeyEnvVar: event.target.value })}
            />
          </label>
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-ink-3">Model</span>
            <div className="flex gap-2">
              <Input
                aria-label="Speech-to-text model"
                list={modelListId}
                value={draft.model}
                placeholder={SPEECH_TO_TEXT_CURATED_MODELS[provider][0]}
                disabled={disabled}
                onChange={(event) => update({ model: event.target.value })}
              />
              <datalist id={modelListId}>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label ?? model.id}
                  </option>
                ))}
              </datalist>
              <Button
                variant="secondary"
                size="sm"
                disabled={disabled || fetchModels.isPending}
                onClick={() => fetchModels.mutate()}
              >
                {fetchModels.isPending ? "Fetching..." : "Fetch"}
              </Button>
            </div>
            {fetchModels.isError ? (
              <p className="text-xs text-bad">{fetchModels.error instanceof Error ? fetchModels.error.message : "Could not list models"}</p>
            ) : fetchedModels?.provider === provider ? (
              <p className="text-xs text-ink-3">
                {fetchedModels.models.length} models {fetchedModels.source === "provider" ? "from the provider" : "from Wardmote's list (the provider publishes none)"}
              </p>
            ) : null}
          </div>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-ink-3">Language</span>
            <Input
              aria-label="Speech-to-text language"
              value={draft.language}
              placeholder="Automatic"
              disabled={disabled}
              onChange={(event) => update({ language: event.target.value.trim() })}
            />
            <span className="block text-xs text-ink-3">
              {provider === "google"
                ? "Empty lets Chirp detect the language; other Google models need a code such as id-ID or en-US."
                : "Empty detects the language. Otherwise a code such as en, id or pt-BR" + (provider === "deepgram" ? "; multi for Nova-3 multilingual." : ".")}
            </span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-ink-3">Max audio (seconds)</span>
              <Input
                type="number"
                min={1}
                max={7200}
                value={draft.maxAudioSeconds}
                disabled={disabled}
                onChange={(event) => update({ maxAudioSeconds: numeric(event.target.value, draft.maxAudioSeconds) })}
              />
              <span className="block text-xs text-ink-3">
                Checked for Ogg Opus voice notes; other formats are limited by size only.
              </span>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-ink-3">Wake wait (seconds)</span>
              <Input
                type="number"
                min={1}
                max={120}
                value={draft.sttWaitSeconds}
                disabled={disabled}
                onChange={(event) => update({ sttWaitSeconds: numeric(event.target.value, draft.sttWaitSeconds) })}
              />
            </label>
          </div>
        </div>
        {provider === "google" ? (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-ink-3">Location</span>
              <Input
                aria-label="Google location"
                value={draft.google.location}
                placeholder="us"
                disabled={disabled}
                onChange={(event) => update({ google: { ...draft.google, location: event.target.value.trim() } })}
              />
              <span className="block text-xs text-ink-3">
                Chirp 3 runs in us and eu. Synchronous recognition takes audio up to {SPEECH_TO_TEXT_GOOGLE_SYNC_MAX_SECONDS} seconds.
              </span>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-ink-3">Project id (optional)</span>
              <Input
                aria-label="Google project id"
                value={draft.google.projectId}
                placeholder="From the service account key"
                disabled={disabled}
                onChange={(event) => update({ google: { ...draft.google, projectId: event.target.value.trim() } })}
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-ink-3">
                Alternative languages (up to {SPEECH_TO_TEXT_GOOGLE_MAX_LANGUAGES - 1})
              </span>
              <Input
                aria-label="Google alternative languages"
                value={alternativeLanguageText}
                placeholder="en-US, ms-MY"
                disabled={disabled}
                onChange={(event) => {
                  setAlternativeLanguageText(event.target.value);
                  update({ google: { ...draft.google, alternativeLanguages: parseLanguageList(event.target.value) } });
                }}
              />
              <span className="block text-xs text-ink-3">Long, short and telephony models only, next to a chosen language.</span>
            </label>
          </div>
        ) : null}
        {provider !== "openai_compatible" ? (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-3">
              <ToggleRow label="Speaker diarization" checked={draft.diarize} disabled={disabled} onChange={(diarize) => update({ diarize })} />
              {provider === "google" ? (
                <ToggleRow
                  label="Automatic punctuation"
                  checked={draft.google.autoPunctuation}
                  disabled={disabled}
                  onChange={(autoPunctuation) => update({ google: { ...draft.google, autoPunctuation } })}
                />
              ) : provider === "deepgram" ? (
                <ToggleRow
                  label="Smart formatting"
                  checked={draft.deepgram.smartFormat}
                  disabled={disabled}
                  onChange={(smartFormat) => update({ deepgram: { smartFormat } })}
                />
              ) : (
                <>
                  <ToggleRow
                    label="Tag audio events"
                    checked={draft.elevenlabs.tagAudioEvents}
                    disabled={disabled}
                    onChange={(tagAudioEvents) => update({ elevenlabs: { ...draft.elevenlabs, tagAudioEvents } })}
                  />
                  {draft.diarize ? (
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium text-ink-3">Maximum speakers</span>
                      <Input
                        type="number"
                        min={1}
                        max={SPEECH_TO_TEXT_MAX_SPEAKERS}
                        value={draft.elevenlabs.numSpeakers ?? ""}
                        placeholder="Automatic"
                        disabled={disabled}
                        onChange={(event) => {
                          const parsed = Number.parseInt(event.target.value, 10);
                          update({ elevenlabs: { ...draft.elevenlabs, numSpeakers: Number.isFinite(parsed) ? parsed : null } });
                        }}
                      />
                    </label>
                  ) : null}
                </>
              )}
            </div>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-ink-3">
                Keyterms ({keytermCount}/{SPEECH_TO_TEXT_KEYTERMS_MAX}, one per line)
              </span>
              <textarea
                aria-label="Speech-to-text keyterms"
                className="min-h-24 w-full rounded-md border border-line bg-bg px-2.5 py-1.5 text-sm"
                value={keytermText}
                disabled={disabled}
                onChange={(event) => {
                  setKeytermText(event.target.value);
                  update({ keyterms: parseKeyterms(event.target.value) });
                }}
              />
              <span className="block text-xs text-ink-3">
                {provider === "deepgram"
                  ? "Sent as keyterm for Nova-3 models and keywords for older models."
                  : provider === "google"
                    ? "Sent as an inline phrase set (speech adaptation)."
                    : "ElevenLabs bills keyterm prompting as a surcharge."}
              </span>
            </label>
          </div>
        ) : null}
        {!complete ? (
          <p className="text-xs text-ink-3">
            {provider === "openai_compatible"
              ? "Enter a base URL, a model and an environment variable name to enable transcription."
              : "Enter a model and an environment variable name to enable transcription."}
          </p>
        ) : null}
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
              disabled={disabled || !complete || !testFile || testMutation.isPending}
              onClick={() => testFile && testMutation.mutate(testFile)}
            >
              {testMutation.isPending ? "Transcribing..." : "Test speech-to-text"}
            </Button>
          </div>
          {testMutation.data ? <TestResult result={testMutation.data} /> : null}
          {testMutation.isError ? (
            <p className="text-sm text-bad">{testMutation.error instanceof Error ? testMutation.error.message : "Test failed"}</p>
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
              setDraft(value);
              setKeytermText(value.keyterms.join("\n"));
              setAlternativeLanguageText(value.google.alternativeLanguages.join(", "));
            }}
          >
            Reset
          </Button>
        </div>
      </div>
    </section>
  );
}
