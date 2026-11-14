import { createVerify, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  instanceGeneralSettingsSchema,
  speechToTextSettingsSchema,
  SPEECH_TO_TEXT_DEFAULTS,
  type SpeechToTextSettings,
} from "@tickernelz/wardmote-shared";
import {
  formatSpeechToTextTranscript,
  listSpeechToTextModels,
  speechToTextCredentialStatus,
  SpeechToTextError,
  transcribeAudio,
  type SpeechToTextErrorCode,
} from "./speech-to-text.js";

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const env = { STT_KEY: "secret-key" };
const audio = { buffer: Buffer.from("fake audio bytes"), mime: "audio/ogg", filename: "voice.ogg" };

const legacyStored = {
  enabled: true,
  baseUrl: "https://api.openai.com/v1",
  model: "whisper-1",
  apiKeyEnvVar: "STT_KEY",
  maxAudioSeconds: 600,
  sttWaitSeconds: 15,
};

function settings(patch: Partial<SpeechToTextSettings>): SpeechToTextSettings {
  return { ...SPEECH_TO_TEXT_DEFAULTS, enabled: true, apiKeyEnvVar: "STT_KEY", ...patch };
}

const deepgramSettings = settings({ provider: "deepgram", model: "nova-3" });
const elevenlabsSettings = settings({ provider: "elevenlabs", model: "scribe_v3" });
const openAiSettings = speechToTextSettingsSchema.parse(legacyStored);

const DEEPGRAM_OK = {
  metadata: { duration: 2.5 },
  results: {
    channels: [
      {
        detected_language: "id",
        alternatives: [
          {
            transcript: "halo apa kabar baik",
            words: [
              { word: "halo", punctuated_word: "Halo,", speaker: 0 },
              { word: "apa", punctuated_word: "apa", speaker: 0 },
              { word: "kabar", punctuated_word: "kabar?", speaker: 0 },
              { word: "baik", punctuated_word: "Baik.", speaker: 1 },
            ],
          },
        ],
      },
    ],
  },
};

const ELEVENLABS_OK = {
  language_code: "ind",
  language_probability: 0.97,
  text: "Halo apa kabar? Baik.",
  words: [
    { text: "Halo", type: "word", speaker_id: "speaker_0", logprob: 0 },
    { text: " ", type: "spacing", speaker_id: "speaker_0", logprob: 0 },
    { text: "apa kabar?", type: "word", speaker_id: "speaker_0", logprob: 0 },
    { text: " ", type: "spacing", speaker_id: "speaker_1", logprob: 0 },
    { text: "Baik.", type: "word", speaker_id: "speaker_1", logprob: 0 },
  ],
};

async function expectCode(promise: Promise<unknown>, code: SpeechToTextErrorCode) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(SpeechToTextError);
  expect((error as SpeechToTextError).code).toBe(code);
}

describe("speech-to-text settings", () => {
  it("reads a stored setting without provider as the unchanged OpenAI-compatible setup", () => {
    expect(openAiSettings).toEqual({ ...SPEECH_TO_TEXT_DEFAULTS, ...legacyStored, provider: "openai_compatible" });
    expect(instanceGeneralSettingsSchema.parse({ speechToText: legacyStored }).speechToText.provider).toBe("openai_compatible");
  });

  it("needs a base URL only for OpenAI-compatible endpoints", () => {
    expect(speechToTextSettingsSchema.safeParse({ ...legacyStored, baseUrl: "" }).success).toBe(false);
    expect(speechToTextSettingsSchema.safeParse({ ...legacyStored, baseUrl: "", provider: "deepgram", model: "nova-3" }).success).toBe(true);
    expect(speechToTextSettingsSchema.safeParse({ ...legacyStored, provider: "elevenlabs", model: "" }).success).toBe(false);
  });

  it("rejects unknown providers, bad language codes, keyterm syntax and speaker counts", () => {
    const base = { ...legacyStored, provider: "deepgram" };
    expect(speechToTextSettingsSchema.safeParse({ ...base, provider: "whisperx" }).success).toBe(false);
    expect(speechToTextSettingsSchema.safeParse({ ...base, language: "pt-BR" }).success).toBe(true);
    expect(speechToTextSettingsSchema.safeParse({ ...base, language: "multi" }).success).toBe(true);
    expect(speechToTextSettingsSchema.safeParse({ ...base, language: "english" }).success).toBe(false);
    expect(speechToTextSettingsSchema.safeParse({ ...base, keyterms: ["Wardmote"] }).success).toBe(true);
    expect(speechToTextSettingsSchema.safeParse({ ...base, keyterms: ["<script>"] }).success).toBe(false);
    expect(speechToTextSettingsSchema.safeParse({ ...base, keyterms: ["x".repeat(51)] }).success).toBe(false);
    expect(speechToTextSettingsSchema.safeParse({ ...base, keyterms: Array.from({ length: 101 }, (_, i) => "t" + i) }).success).toBe(false);
    expect(speechToTextSettingsSchema.safeParse({ ...base, elevenlabs: { tagAudioEvents: true, numSpeakers: 33 } }).success).toBe(false);
    expect(speechToTextSettingsSchema.safeParse({ ...base, apiKeyEnvVar: "sk-live-abc" }).success).toBe(false);
  });
});

describe("transcribeAudio with an OpenAI-compatible endpoint", () => {
  it("sends exactly the pre-provider request for a stored setting", async () => {
    const fake = fakeFetch(() => json({ text: " hello ", language: "en" }));
    const result = await transcribeAudio(audio, { settings: openAiSettings, env, fetchImpl: fake.impl });
    expect(result).toEqual({ text: "hello", language: "en" });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(fake.calls[0].init.headers).toEqual({ Authorization: "Bearer secret-key", Accept: "application/json" });
    const form = fake.calls[0].init.body as FormData;
    expect([...form.keys()]).toEqual(["file", "model", "response_format"]);
    expect(form.get("model")).toBe("whisper-1");
    expect(form.get("response_format")).toBe("json");
  });

  it("uses the saved key before the environment variable and the variable when no key is saved", async () => {
    const fake = fakeFetch(() => json({ text: "ok" }));
    await transcribeAudio(audio, { settings: openAiSettings, apiKey: "saved-key", env, fetchImpl: fake.impl });
    await transcribeAudio(audio, { settings: openAiSettings, apiKey: null, env, fetchImpl: fake.impl });
    await transcribeAudio(audio, { settings: { ...openAiSettings, apiKeyEnvVar: "" }, apiKey: "saved-key", env: {}, fetchImpl: fake.impl });
    expect(fake.calls.map((call) => (call.init.headers as Record<string, string>).Authorization)).toEqual([
      "Bearer saved-key",
      "Bearer secret-key",
      "Bearer saved-key",
    ]);
    await expectCode(transcribeAudio(audio, { settings: { ...openAiSettings, apiKeyEnvVar: "" }, apiKey: null, env, fetchImpl: fake.impl }), "stt_missing_key");
    expect(fake.calls).toHaveLength(3);
  });

  it("reports a saved key per provider without its value", async () => {
    const status = await speechToTextCredentialStatus({ deepgram: "dg-saved-zha6141" }, { OPENAI_API_KEY: "env-value" });
    expect(status.deepgram).toEqual({ envVar: "DEEPGRAM_API_KEY", set: false, stored: true });
    expect(status.openai_compatible).toEqual({ envVar: "OPENAI_API_KEY", set: true, stored: false });
    expect(JSON.stringify(status)).not.toMatch(/dg-saved-zha6141|env-value/);
  });

  it("adds the primary language subtag when a language is chosen", async () => {
    const fake = fakeFetch(() => json({ text: "olá" }));
    await transcribeAudio(audio, { settings: { ...openAiSettings, language: "pt-BR" }, env, fetchImpl: fake.impl });
    expect((fake.calls[0].init.body as FormData).get("language")).toBe("pt");
  });
});

describe("transcribeAudio with Deepgram", () => {
  it("posts raw audio to /v1/listen with Token auth and documented query options", async () => {
    const fake = fakeFetch(() => json(DEEPGRAM_OK));
    const result = await transcribeAudio(audio, {
      settings: { ...deepgramSettings, keyterms: ["Wardmote", "Open WA"] },
      env,
      fetchImpl: fake.impl,
    });
    expect(result).toEqual({ text: "halo apa kabar baik", language: "id" });
    const url = new URL(fake.calls[0].url);
    expect(url.origin + url.pathname).toBe("https://api.deepgram.com/v1/listen");
    expect(url.searchParams.get("model")).toBe("nova-3");
    expect(url.searchParams.get("punctuate")).toBe("true");
    expect(url.searchParams.get("smart_format")).toBe("true");
    expect(url.searchParams.get("detect_language")).toBe("true");
    expect(url.searchParams.has("language")).toBe(false);
    expect(url.searchParams.has("diarize_model")).toBe(false);
    expect(url.searchParams.getAll("keyterm")).toEqual(["Wardmote", "Open WA"]);
    expect(fake.calls[0].init.headers).toMatchObject({ Authorization: "Token secret-key", "Content-Type": "audio/ogg" });
    expect(await (fake.calls[0].init.body as Blob).text()).toBe("fake audio bytes");
  });

  it("uses the configured region origin, a fixed language, keywords for older models and diarization", async () => {
    const fake = fakeFetch(() => json(DEEPGRAM_OK));
    const result = await transcribeAudio(audio, {
      settings: {
        ...deepgramSettings,
        baseUrl: "https://api.eu.deepgram.com/v1/",
        model: "nova-2-meeting",
        language: "id",
        diarize: true,
        keyterms: ["Wardmote"],
        deepgram: { smartFormat: false },
      },
      env,
      fetchImpl: fake.impl,
    });
    const url = new URL(fake.calls[0].url);
    expect(url.origin + url.pathname).toBe("https://api.eu.deepgram.com/v1/listen");
    expect(url.searchParams.get("language")).toBe("id");
    expect(url.searchParams.has("detect_language")).toBe(false);
    expect(url.searchParams.has("smart_format")).toBe(false);
    expect(url.searchParams.get("diarize_model")).toBe("latest");
    expect(url.searchParams.getAll("keywords")).toEqual(["Wardmote"]);
    expect(url.searchParams.has("keyterm")).toBe(false);
    expect(result.segments).toEqual([
      { speaker: "Speaker 1", text: "Halo, apa kabar?" },
      { speaker: "Speaker 2", text: "Baik." },
    ]);
    expect(formatSpeechToTextTranscript(result)).toBe("Speaker 1: Halo, apa kabar?\nSpeaker 2: Baik.");
  });

  it("rejects a response without a transcript", async () => {
    const fake = fakeFetch(() => json({ results: { channels: [] } }));
    await expectCode(transcribeAudio(audio, { settings: deepgramSettings, env, fetchImpl: fake.impl }), "stt_invalid_response");
  });
});

describe("transcribeAudio with ElevenLabs", () => {
  it("posts multipart to /v1/speech-to-text with xi-api-key and documented fields", async () => {
    const fake = fakeFetch(() => json(ELEVENLABS_OK));
    const result = await transcribeAudio(audio, {
      settings: { ...elevenlabsSettings, language: "id", keyterms: ["Wardmote", "OpenWA"], elevenlabs: { tagAudioEvents: true, numSpeakers: 3 } },
      env,
      fetchImpl: fake.impl,
    });
    expect(result).toEqual({ text: "Halo apa kabar? Baik.", language: "ind" });
    expect(fake.calls[0].url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(fake.calls[0].init.headers).toEqual({ "xi-api-key": "secret-key", Accept: "application/json" });
    const form = fake.calls[0].init.body as FormData;
    expect(form.get("model_id")).toBe("scribe_v3");
    expect(form.get("file")).toBeInstanceOf(Blob);
    expect(form.get("language_code")).toBe("id");
    expect(form.get("tag_audio_events")).toBe("true");
    expect(form.get("diarize")).toBe("false");
    expect(form.has("num_speakers")).toBe(false);
    expect(form.get("timestamps_granularity")).toBe("none");
    expect(form.getAll("keyterms")).toEqual(["Wardmote", "OpenWA"]);
  });

  it("returns speaker turns when diarization is on", async () => {
    const fake = fakeFetch(() => json(ELEVENLABS_OK));
    const result = await transcribeAudio(audio, {
      settings: { ...elevenlabsSettings, diarize: true, elevenlabs: { tagAudioEvents: false, numSpeakers: 2 } },
      env,
      fetchImpl: fake.impl,
    });
    const form = fake.calls[0].init.body as FormData;
    expect(form.get("diarize")).toBe("true");
    expect(form.get("num_speakers")).toBe("2");
    expect(form.get("timestamps_granularity")).toBe("word");
    expect(form.has("language_code")).toBe(false);
    expect(result.segments).toEqual([
      { speaker: "Speaker 1", text: "Halo apa kabar?" },
      { speaker: "Speaker 2", text: "Baik." },
    ]);
  });
});

describe.each([
  ["openai_compatible", openAiSettings],
  ["deepgram", deepgramSettings],
  ["elevenlabs", elevenlabsSettings],
] as const)("transcribeAudio failures for %s", (_provider, providerSettings) => {
  it.each([
    [400, "stt_rejected"],
    [401, "stt_rejected"],
    [429, "stt_unavailable"],
    [503, "stt_unavailable"],
  ] as const)("maps HTTP %i to %s", async (status, code) => {
    const fake = fakeFetch(() => json({ error: "nope" }, status));
    await expectCode(transcribeAudio(audio, { settings: providerSettings, env, fetchImpl: fake.impl }), code);
  });

  it("maps malformed JSON to stt_invalid_response", async () => {
    const fake = fakeFetch(() => json("{not json"));
    await expectCode(transcribeAudio(audio, { settings: providerSettings, env, fetchImpl: fake.impl }), "stt_invalid_response");
  });

  it("maps a timeout to stt_timeout", async () => {
    const impl = ((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      })) as typeof fetch;
    await expectCode(transcribeAudio(audio, { settings: providerSettings, env, fetchImpl: impl, timeoutMs: 20 }), "stt_timeout");
  });

  it("maps a network failure to stt_network", async () => {
    const impl = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expectCode(transcribeAudio(audio, { settings: providerSettings, env, fetchImpl: impl }), "stt_network");
  });

  it("refuses an empty key, oversized or overlong audio without calling the provider", async () => {
    const fake = fakeFetch(() => json({}));
    await expectCode(transcribeAudio(audio, { settings: providerSettings, env: {}, fetchImpl: fake.impl }), "stt_missing_key");
    await expectCode(transcribeAudio(audio, { settings: providerSettings, env, fetchImpl: fake.impl, maxBytes: 4 }), "stt_too_large");
    await expectCode(
      transcribeAudio({ ...audio, durationHintSeconds: providerSettings.maxAudioSeconds + 1 }, { settings: providerSettings, env, fetchImpl: fake.impl }),
      "stt_too_long",
    );
    await expectCode(transcribeAudio({ ...audio, buffer: Buffer.alloc(0) }, { settings: providerSettings, env, fetchImpl: fake.impl }), "stt_empty");
    await expectCode(transcribeAudio(audio, { settings: { ...providerSettings, enabled: false }, env, fetchImpl: fake.impl }), "stt_disabled");
    expect(fake.calls).toHaveLength(0);
  });
});

describe("listSpeechToTextModels", () => {
  it("lists Deepgram batch models by canonical name", async () => {
    const fake = fakeFetch(() =>
      json({
        stt: [
          { name: "nova-3", canonical_name: "nova-3", batch: true, streaming: true },
          { name: "nova-3", canonical_name: "nova-3", batch: true, version: "older" },
          { name: "general-nova-2", canonical_name: "nova-2-general", batch: true },
          { name: "streaming-only", canonical_name: "flux-general-en", batch: false },
        ],
        tts: [{ name: "aura-2-zeus-en" }],
      }),
    );
    const list = await listSpeechToTextModels({ provider: "deepgram", baseUrl: "", apiKeyEnvVar: "STT_KEY" }, { env, fetchImpl: fake.impl });
    expect(list).toEqual({ models: [{ id: "nova-2-general" }, { id: "nova-3" }], source: "provider" });
    expect(fake.calls[0].url).toBe("https://api.deepgram.com/v1/models");
    expect(fake.calls[0].init.headers).toMatchObject({ Authorization: "Token secret-key" });
  });

  it("lists OpenAI-compatible models from /models", async () => {
    const fake = fakeFetch(() => json({ data: [{ id: "whisper-1" }, { id: "gpt-4o-transcribe" }] }));
    const list = await listSpeechToTextModels(
      { provider: "openai_compatible", baseUrl: "https://stt.example.com/v1/", apiKeyEnvVar: "STT_KEY" },
      { env, fetchImpl: fake.impl },
    );
    expect(list.models.map((model) => model.id)).toEqual(["gpt-4o-transcribe", "whisper-1"]);
    expect(fake.calls[0].url).toBe("https://stt.example.com/v1/models");
  });

  it("returns the curated ElevenLabs list without a request", async () => {
    const fake = fakeFetch(() => json({}));
    const list = await listSpeechToTextModels({ provider: "elevenlabs", baseUrl: "", apiKeyEnvVar: "" }, { env, fetchImpl: fake.impl });
    expect(list).toEqual({ models: [{ id: "scribe_v3" }, { id: "scribe_v2" }, { id: "scribe_v2_medical" }], source: "curated" });
    expect(fake.calls).toHaveLength(0);
  });

  it("reports missing configuration and provider errors with stt codes", async () => {
    const fake = fakeFetch(() => json({ err_msg: "bad key" }, 401));
    await expectCode(listSpeechToTextModels({ provider: "openai_compatible", baseUrl: "", apiKeyEnvVar: "STT_KEY" }, { env }), "stt_disabled");
    await expectCode(listSpeechToTextModels({ provider: "deepgram", baseUrl: "", apiKeyEnvVar: "STT_KEY" }, { env: {} }), "stt_missing_key");
    await expectCode(listSpeechToTextModels({ provider: "deepgram", baseUrl: "", apiKeyEnvVar: "STT_KEY" }, { env, fetchImpl: fake.impl }), "stt_rejected");
  });
});

const { privateKey: googlePrivateKey, publicKey: googlePublicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
let googleAccountSeq = 0;

function googleAccount(patch: Record<string, unknown> = {}) {
  googleAccountSeq += 1;
  return {
    type: "service_account",
    project_id: "proj-zha6055",
    private_key_id: "kid-" + googleAccountSeq,
    private_key: googlePrivateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    client_email: "stt-" + googleAccountSeq + "@proj-zha6055.iam.gserviceaccount.com",
    token_uri: "https://oauth2.googleapis.com/token",
    ...patch,
  };
}

function googleEnv(patch: Record<string, unknown> = {}) {
  return { STT_KEY: JSON.stringify(googleAccount(patch)) };
}

const googleSettings = settings({ provider: "google", model: "chirp_3" });

function googleFetch(recognize: (call: Call) => Response) {
  return fakeFetch((call) =>
    call.url === "https://oauth2.googleapis.com/token" ? json({ access_token: "tok-1", expires_in: 3600, token_type: "Bearer" }) : recognize(call),
  );
}

const GOOGLE_OK = {
  results: [
    { alternatives: [{ transcript: "halo apa kabar", words: [{ word: "halo", speakerLabel: "1" }, { word: "apa", speakerLabel: "1" }, { word: "kabar", speakerLabel: "1" }] }], languageCode: "id-id" },
    { alternatives: [{ transcript: "baik", words: [{ word: "baik", speakerLabel: "2" }] }], languageCode: "id-id" },
  ],
  metadata: { totalBilledDuration: "3s" },
};

describe("transcribeAudio with Google Cloud Speech-to-Text v2", () => {
  it("signs a service account assertion, then posts base64 audio to the implicit recognizer", async () => {
    const fake = googleFetch(() => json(GOOGLE_OK));
    const env = googleEnv();
    const result = await transcribeAudio(audio, { settings: { ...googleSettings, keyterms: ["Wardmote"] }, env, fetchImpl: fake.impl });
    expect(result).toEqual({ text: "halo apa kabar baik", language: "id-id" });
    expect(fake.calls.map((call) => call.url)).toEqual([
      "https://oauth2.googleapis.com/token",
      "https://us-speech.googleapis.com/v2/projects/proj-zha6055/locations/us/recognizers/_:recognize",
    ]);
    const form = new URLSearchParams(String(fake.calls[0].init.body));
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const [header, claims, signature] = form.get("assertion")!.split(".");
    expect(createVerify("RSA-SHA256").update(header + "." + claims).verify(googlePublicKey, Buffer.from(signature, "base64url"))).toBe(true);
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toMatchObject({
      iss: JSON.parse(env.STT_KEY).client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
    });
    expect(fake.calls[1].init.headers).toMatchObject({ Authorization: "Bearer tok-1", "Content-Type": "application/json" });
    const body = JSON.parse(String(fake.calls[1].init.body));
    expect(body).toEqual({
      config: {
        autoDecodingConfig: {},
        model: "chirp_3",
        languageCodes: ["auto"],
        features: { enableAutomaticPunctuation: true },
        adaptation: { phraseSets: [{ inlinePhraseSet: { phrases: [{ value: "Wardmote" }] } }] },
      },
      content: Buffer.from("fake audio bytes").toString("base64"),
    });
    expect(JSON.stringify(fake.calls)).not.toContain("PRIVATE KEY");
  });

  it("reuses the access token and reads a key file path", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "zha6055-google-"));
    try {
      const keyPath = path.join(dir, "key.json");
      await writeFile(keyPath, JSON.stringify(googleAccount()));
      const fake = googleFetch(() => json(GOOGLE_OK));
      const options = { settings: googleSettings, env: { STT_KEY: keyPath }, fetchImpl: fake.impl };
      await transcribeAudio(audio, options);
      await transcribeAudio(audio, options);
      expect(fake.calls.filter((call) => call.url.endsWith("/token"))).toHaveLength(1);
      expect(fake.calls.filter((call) => call.url.endsWith(":recognize"))).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("sends a chosen language with alternatives, the global endpoint, a project override and diarization", async () => {
    const fake = googleFetch(() => json(GOOGLE_OK));
    const result = await transcribeAudio(audio, {
      settings: {
        ...googleSettings,
        model: "telephony",
        language: "id-ID",
        diarize: true,
        google: { location: "global", projectId: "other-project", autoPunctuation: false, alternativeLanguages: ["en-US", "ms-MY"] },
      },
      env: googleEnv(),
      fetchImpl: fake.impl,
    });
    expect(fake.calls[1].url).toBe("https://speech.googleapis.com/v2/projects/other-project/locations/global/recognizers/_:recognize");
    const config = JSON.parse(String(fake.calls[1].init.body)).config;
    expect(config.languageCodes).toEqual(["id-ID", "en-US", "ms-MY"]);
    expect(config.features).toEqual({ enableAutomaticPunctuation: false, diarizationConfig: {} });
    expect(config.adaptation).toBeUndefined();
    expect(formatSpeechToTextTranscript(result)).toBe("Speaker 1: halo apa kabar\nSpeaker 2: baik");
  });

  it("returns an empty transcript when Google finds no speech", async () => {
    const fake = googleFetch(() => json({ metadata: { totalBilledDuration: "1s" } }));
    expect(await transcribeAudio(audio, { settings: googleSettings, env: googleEnv(), fetchImpl: fake.impl })).toEqual({ text: "" });
  });

  it.each([
    [400, "stt_rejected"],
    [403, "stt_rejected"],
    [429, "stt_unavailable"],
    [500, "stt_unavailable"],
  ] as const)("maps recognize HTTP %i to %s", async (status, code) => {
    const fake = googleFetch(() => json({ error: { code: status } }, status));
    await expectCode(transcribeAudio(audio, { settings: googleSettings, env: googleEnv(), fetchImpl: fake.impl }), code);
  });

  it("maps malformed recognize responses to stt_invalid_response", async () => {
    await expectCode(
      transcribeAudio(audio, { settings: googleSettings, env: googleEnv(), fetchImpl: googleFetch(() => json("{oops")).impl }),
      "stt_invalid_response",
    );
    await expectCode(
      transcribeAudio(audio, { settings: googleSettings, env: googleEnv(), fetchImpl: googleFetch(() => json({ results: "x" })).impl }),
      "stt_invalid_response",
    );
  });

  it("maps token endpoint failures", async () => {
    const rejected = fakeFetch(() => json({ error: "invalid_grant" }, 400));
    await expectCode(transcribeAudio(audio, { settings: googleSettings, env: googleEnv(), fetchImpl: rejected.impl }), "stt_rejected");
    expect(rejected.calls).toHaveLength(1);
    const malformed = fakeFetch(() => json("<html>"));
    await expectCode(transcribeAudio(audio, { settings: googleSettings, env: googleEnv(), fetchImpl: malformed.impl }), "stt_invalid_response");
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expectCode(transcribeAudio(audio, { settings: googleSettings, env: googleEnv(), fetchImpl: offline }), "stt_network");
    const hanging = ((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      })) as typeof fetch;
    await expectCode(transcribeAudio(audio, { settings: googleSettings, env: googleEnv(), fetchImpl: hanging, timeoutMs: 20 }), "stt_timeout");
  });

  it("refuses missing or unusable credentials and audio past the synchronous limits without a request", async () => {
    const fake = googleFetch(() => json(GOOGLE_OK));
    const run = (patch: Partial<Parameters<typeof transcribeAudio>[1]>, input: Parameters<typeof transcribeAudio>[0] = audio) =>
      transcribeAudio(input, { settings: googleSettings, env: googleEnv(), fetchImpl: fake.impl, ...patch });
    await expectCode(run({ env: {} }), "stt_missing_key");
    await expectCode(run({ env: { STT_KEY: "/nonexistent/zha6055-key.json" } }), "stt_invalid_credentials");
    await expectCode(run({ env: { STT_KEY: JSON.stringify({ type: "authorized_user", client_id: "x" }) } }), "stt_invalid_credentials");
    await expectCode(run({ env: googleEnv({ project_id: "" }) }), "stt_invalid_credentials");
    await expectCode(run({ env: googleEnv({ private_key: "-----BEGIN PRIVATE KEY-----\nbroken\n-----END PRIVATE KEY-----\n" }) }), "stt_invalid_credentials");
    await expectCode(run({}, { ...audio, mime: "audio/mpeg", durationHintSeconds: 61 }), "stt_too_long");
    await expectCode(run({}, { ...audio, mime: "audio/mpeg", buffer: Buffer.alloc(7_500_001) }), "stt_too_large");
    await expectCode(run({}, { ...audio, buffer: Buffer.alloc(7_500_001) }), "stt_too_large");
    await expectCode(run({}, { ...audio, buffer: Buffer.alloc(0) }), "stt_empty");
    await expectCode(run({ settings: { ...googleSettings, enabled: false } }), "stt_disabled");
    expect(fake.calls).toHaveLength(0);
  });
});

describe("Google speech-to-text settings", () => {
  const base = { ...legacyStored, baseUrl: "", provider: "google", model: "chirp_3" };

  it("accepts Chirp with automatic language and requires a language for other models", () => {
    expect(speechToTextSettingsSchema.parse(base).google).toEqual(SPEECH_TO_TEXT_DEFAULTS.google);
    expect(speechToTextSettingsSchema.safeParse({ ...base, model: "long" }).success).toBe(false);
    expect(speechToTextSettingsSchema.safeParse({ ...base, model: "long", language: "id-ID" }).success).toBe(true);
    expect(speechToTextSettingsSchema.safeParse({ ...base, language: "multi" }).success).toBe(false);
  });

  it("limits alternative languages to two, beside a primary language, on non-Chirp models", () => {
    const google = (alternativeLanguages: string[]) => ({ ...SPEECH_TO_TEXT_DEFAULTS.google, alternativeLanguages });
    expect(speechToTextSettingsSchema.safeParse({ ...base, model: "long", language: "id-ID", google: google(["en-US", "ms-MY"]) }).success).toBe(true);
    expect(speechToTextSettingsSchema.safeParse({ ...base, model: "long", language: "id-ID", google: google(["en-US", "ms-MY", "jv-ID"]) }).success).toBe(false);
    expect(speechToTextSettingsSchema.safeParse({ ...base, language: "id-ID", google: google(["en-US"]) }).success).toBe(false);
    expect(speechToTextSettingsSchema.safeParse({ ...base, google: { ...SPEECH_TO_TEXT_DEFAULTS.google, location: "US!" } }).success).toBe(false);
    expect(speechToTextSettingsSchema.safeParse({ ...base, google: { ...SPEECH_TO_TEXT_DEFAULTS.google, projectId: "X" } }).success).toBe(false);
  });
});

describe("listSpeechToTextModels for Google", () => {
  it("collects models from the location metadata", async () => {
    const fake = googleFetch(() =>
      json({
        locationId: "us",
        metadata: { languages: { models: { "en-US": { modelFeatures: { chirp_3: {}, long: {} } }, "id-ID": { modelFeatures: { chirp_3: {} } } } } },
      }),
    );
    const list = await listSpeechToTextModels(
      { provider: "google", baseUrl: "", apiKeyEnvVar: "STT_KEY", google: { location: "us", projectId: "" } },
      { env: googleEnv(), fetchImpl: fake.impl },
    );
    expect(list).toEqual({ models: [{ id: "chirp_3" }, { id: "long" }], source: "provider" });
    expect(fake.calls[1].url).toBe("https://us-speech.googleapis.com/v2/projects/proj-zha6055/locations/us");
    expect(fake.calls[1].init.headers).toMatchObject({ Authorization: "Bearer tok-1" });
  });

  it("rejects location metadata without models", async () => {
    const fake = googleFetch(() => json({ locationId: "us" }));
    await expectCode(
      listSpeechToTextModels({ provider: "google", baseUrl: "", apiKeyEnvVar: "STT_KEY" }, { env: googleEnv(), fetchImpl: fake.impl }),
      "stt_invalid_response",
    );
  });
});

describe("transcribeAudio limits on file-backed audio", () => {
  function oggOpus(durationSeconds: number, paddingBytes: number): Buffer {
    const first = Buffer.alloc(47);
    first.write("OggS", 0, "latin1");
    first.write("OpusHead", 28, "latin1");
    const last = Buffer.alloc(27);
    last.write("OggS", 0, "latin1");
    last.writeBigUInt64LE(BigInt(durationSeconds * 48_000), 6);
    return Buffer.concat([first, Buffer.alloc(paddingBytes), last]);
  }

  it("measures a large Ogg Opus blob from its head and tail and refuses it past maxAudioSeconds", async () => {
    const fake = fakeFetch(() => json({ text: "never" }));
    const long = new Blob([new Uint8Array(oggOpus(700, 500_000))]);
    await expectCode(transcribeAudio({ blob: long, mime: "audio/ogg", filename: "v.ogg" }, { settings: openAiSettings, env, fetchImpl: fake.impl }), "stt_too_long");
    expect(fake.calls).toHaveLength(0);
    const short = new Blob([new Uint8Array(oggOpus(30, 500_000))]);
    await transcribeAudio({ blob: short, mime: "audio/ogg", filename: "v.ogg" }, { settings: openAiSettings, env, fetchImpl: fake.impl });
    expect(fake.calls).toHaveLength(1);
  });

  it("sends a blob without copying it to a different size or type", async () => {
    const fake = fakeFetch(() => json(DEEPGRAM_OK));
    const blob = new Blob([Buffer.from("blob audio")]);
    await transcribeAudio({ blob, mime: "audio/mpeg", filename: "a.mp3" }, { settings: deepgramSettings, env, fetchImpl: fake.impl });
    expect(await (fake.calls[0].init.body as Blob).text()).toBe("blob audio");
    const multipart = fakeFetch(() => json({ text: "ok" }));
    await transcribeAudio({ blob, mime: "audio/mpeg", filename: "a.mp3" }, { settings: openAiSettings, env, fetchImpl: multipart.impl });
    const file = (multipart.calls[0].init.body as FormData).get("file") as File;
    expect([file.name, file.type, file.size]).toEqual(["a.mp3", "audio/mpeg", 10]);
  });

  it("refuses a blob above the Google synchronous byte limit", async () => {
    const fake = fakeFetch(() => json({}));
    const big = new Blob([Buffer.alloc(7_500_001)]);
    await expectCode(
      transcribeAudio({ blob: big, mime: "audio/mpeg", filename: "a.mp3" }, { settings: settings({ provider: "google", model: "chirp_3" }), env, fetchImpl: fake.impl }),
      "stt_too_large",
    );
    expect(fake.calls).toHaveLength(0);
  });
});
