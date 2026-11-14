// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPEECH_TO_TEXT_DEFAULTS, type SpeechToTextSettings } from "@tickernelz/wardmote-shared";
import { SpeechToTextSection } from "./SpeechToTextSection";

const mockInstanceSettingsApi = vi.hoisted(() => ({
  listSpeechToTextModels: vi.fn(),
  testSpeechToText: vi.fn(),
  getSpeechToTextCredentials: vi.fn(),
  saveSpeechToTextKey: vi.fn(),
  removeSpeechToTextKey: vi.fn(),
}));
vi.mock("@/api/instanceSettings", () => ({ instanceSettingsApi: mockInstanceSettingsApi }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const CREDENTIALS = {
  openai_compatible: { envVar: "OPENAI_API_KEY", set: false, stored: false },
  deepgram: { envVar: "DEEPGRAM_API_KEY", set: true, stored: false },
  elevenlabs: { envVar: "ELEVENLABS_API_KEY", set: false, stored: false },
  google: { envVar: "GOOGLE_APPLICATION_CREDENTIALS", set: true, stored: false, usable: true, projectId: "proj-zha6055" },
};

function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

function click(element: Element) {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

describe("SpeechToTextSection", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onSave: ReturnType<typeof vi.fn<(next: SpeechToTextSettings) => void>>;
  let originalResizeObserver: typeof ResizeObserver | undefined;

  beforeEach(() => {
    originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    container = document.createElement("div");
    document.body.appendChild(container);
    onSave = vi.fn<(next: SpeechToTextSettings) => void>();
    mockInstanceSettingsApi.getSpeechToTextCredentials.mockResolvedValue(CREDENTIALS);
  });

  afterEach(() => {
    act(() => root.unmount());
    globalThis.ResizeObserver = originalResizeObserver!;
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  async function render(value: SpeechToTextSettings) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    root = createRoot(container);
    act(() => {
      root.render(
        <QueryClientProvider client={client}>
          <SpeechToTextSection value={value} disabled={false} onSave={onSave} />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  const byLabel = <T extends Element>(label: string) => document.querySelector<T & Element>('[aria-label="' + label + '"]')!;
  const button = (text: string) => Array.from(document.querySelectorAll("button")).find((entry) => entry.textContent?.trim() === text)!;
  const keyStatus = () => document.querySelector('[data-testid="stt-key-status"]')?.textContent ?? "";

  async function pickLanguage(trigger: string, label: string) {
    await act(async () => click(byLabel(trigger)));
    const option = Array.from(document.querySelectorAll("[cmdk-item]")).find((entry) => entry.textContent?.includes(label));
    expect(option, label).toBeTruthy();
    await act(async () => click(option!));
  }

  function chooseFile() {
    const file = new File([new Uint8Array([1, 2, 3])], "sample.ogg", { type: "audio/ogg" });
    const input = byLabel<HTMLInputElement>("Speech-to-text test audio");
    Object.defineProperty(input, "files", { value: [file] });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    return file;
  }

  it("configures Deepgram, tests and saves without typing any text", async () => {
    mockInstanceSettingsApi.testSpeechToText.mockResolvedValue({ ok: true, text: "halo dunia", language: "id", durationMs: 1200 });
    await render(SPEECH_TO_TEXT_DEFAULTS);
    await act(async () => setValue(byLabel<HTMLSelectElement>("Speech-to-text provider"), "deepgram"));
    await vi.waitFor(() => expect(keyStatus()).toBe("Not set here. Using DEEPGRAM_API_KEY from the server environment."));
    expect(byLabel<HTMLSelectElement>("Speech-to-text model").value).toBe("nova-3");
    act(() => setValue(byLabel<HTMLSelectElement>("Speech-to-text model"), "nova-3-medical"));
    expect(byLabel("Other model id")).toBeNull();
    await pickLanguage("Speech-to-text language", "Indonesian (id)");
    const file = chooseFile();
    await act(async () => click(button("Test speech-to-text")));
    await vi.waitFor(() => expect(container.textContent).toContain("halo dunia"));
    const expected = expect.objectContaining({ provider: "deepgram", model: "nova-3-medical", language: "id", apiKeyEnvVar: "DEEPGRAM_API_KEY", baseUrl: "" });
    expect(mockInstanceSettingsApi.testSpeechToText).toHaveBeenCalledWith(expected, file, "");
    act(() => click(byLabel("Toggle speech-to-text")));
    act(() => click(button("Save speech-to-text")));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, provider: "deepgram", model: "nova-3-medical", language: "id" }));
  });

  it("asks for the key in place, tests and fetches with the typed key, then shows only that it is saved", async () => {
    const saved = { ...CREDENTIALS, elevenlabs: { ...CREDENTIALS.elevenlabs, stored: true } };
    mockInstanceSettingsApi.saveSpeechToTextKey.mockResolvedValue(saved);
    mockInstanceSettingsApi.listSpeechToTextModels.mockResolvedValue({ models: [{ id: "scribe_v3" }], source: "curated" });
    mockInstanceSettingsApi.testSpeechToText.mockResolvedValue({ ok: true, text: "halo", durationMs: 900 });
    await render(SPEECH_TO_TEXT_DEFAULTS);
    await act(async () => setValue(byLabel<HTMLSelectElement>("Speech-to-text provider"), "elevenlabs"));
    await vi.waitFor(() => expect(keyStatus()).toBe("Not set"));
    expect(container.textContent).toContain("Enter the API key.");
    expect(container.textContent).not.toMatch(/restart|server environment, then|never stored/i);
    expect(byLabel<HTMLButtonElement>("Toggle speech-to-text").disabled).toBe(true);
    const file = chooseFile();
    expect(button("Test speech-to-text").disabled).toBe(true);

    const input = byLabel<HTMLInputElement>("Speech-to-text API key");
    expect(input.type).toBe("password");
    act(() => setValue(input, "el-typed-zha6141"));
    expect(container.textContent).not.toContain("Enter the API key.");
    await act(async () => click(button("Fetch")));
    expect(mockInstanceSettingsApi.listSpeechToTextModels).toHaveBeenCalledWith(expect.objectContaining({ provider: "elevenlabs", apiKey: "el-typed-zha6141" }));
    await act(async () => click(button("Test speech-to-text")));
    expect(mockInstanceSettingsApi.testSpeechToText).toHaveBeenCalledWith(expect.objectContaining({ provider: "elevenlabs" }), file, "el-typed-zha6141");

    await act(async () => click(button("Save speech-to-text")));
    expect(mockInstanceSettingsApi.saveSpeechToTextKey).toHaveBeenCalledWith("elevenlabs", "el-typed-zha6141");
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ provider: "elevenlabs" }));
    await vi.waitFor(() => expect(keyStatus()).toBe("Saved"));
    expect(byLabel("Speech-to-text API key")).toBeNull();
    expect(button("Replace")).toBeTruthy();
    expect(button("Remove")).toBeTruthy();
    expect(container.innerHTML).not.toContain("el-typed-zha6141");
  });

  it("removes or replaces a saved key without touching the settings", async () => {
    const stored = { ...CREDENTIALS, deepgram: { ...CREDENTIALS.deepgram, set: false, stored: true } };
    mockInstanceSettingsApi.getSpeechToTextCredentials.mockResolvedValue(stored);
    mockInstanceSettingsApi.removeSpeechToTextKey.mockResolvedValue({ ...stored, deepgram: { ...stored.deepgram, stored: false } });
    await render({ ...SPEECH_TO_TEXT_DEFAULTS, provider: "deepgram", model: "nova-3", apiKeyEnvVar: "DEEPGRAM_API_KEY" });
    await vi.waitFor(() => expect(keyStatus()).toBe("Saved"));
    expect(button("Save speech-to-text").disabled).toBe(true);
    act(() => click(button("Replace")));
    expect(byLabel<HTMLInputElement>("Speech-to-text API key").value).toBe("");
    act(() => click(button("Cancel")));
    await act(async () => click(button("Remove")));
    expect(mockInstanceSettingsApi.removeSpeechToTextKey).toHaveBeenCalledWith("deepgram");
    await vi.waitFor(() => expect(keyStatus()).toBe("Not set"));
    expect(byLabel("Speech-to-text API key")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("fills the Google project from the service account and asks for a language on non-Chirp models", async () => {
    mockInstanceSettingsApi.listSpeechToTextModels.mockResolvedValue({ models: [{ id: "chirp_3" }, { id: "long" }], source: "provider", locations: ["asia-southeast1", "eu", "us"] });
    await render(SPEECH_TO_TEXT_DEFAULTS);
    await act(async () => setValue(byLabel<HTMLSelectElement>("Speech-to-text provider"), "google"));
    await vi.waitFor(() => expect(container.textContent).toContain("Project proj-zha6055 (from the service account)"));
    expect(byLabel<HTMLSelectElement>("Speech-to-text model").value).toBe("chirp_3");
    await act(async () => click(button("Fetch")));
    await vi.waitFor(() => expect(container.textContent).toContain("2 models from the provider"));
    act(() => setValue(byLabel<HTMLSelectElement>("Speech-to-text model"), "long"));
    expect(container.textContent).toContain("Choose a language: only Chirp models detect it automatically.");
    await pickLanguage("Speech-to-text language", "(id-ID)");
    expect(container.textContent).not.toContain("only Chirp models detect it");
    await act(async () => click(button("Advanced")));
    const location = byLabel<HTMLSelectElement>("Google location");
    expect(Array.from(location.options).map((option) => option.value)).toEqual(["asia-southeast1", "eu", "us"]);
    act(() => setValue(location, "eu"));
    await pickLanguage("Add alternative language", "(en-US)");
    const keyterm = byLabel<HTMLInputElement>("Add keyterm");
    act(() => setValue(keyterm, "Wardmote"));
    act(() => keyterm.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(container.textContent).toContain("Keyterms (1/100)");
    act(() => click(button("Save speech-to-text")));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "google",
        model: "long",
        language: "id-ID",
        apiKeyEnvVar: "GOOGLE_APPLICATION_CREDENTIALS",
        keyterms: ["Wardmote"],
        google: { location: "eu", projectId: "", autoPunctuation: true, alternativeLanguages: ["en-US"] },
      }),
    );
  });

  it("asks for a base URL and allows a typed model only for OpenAI-compatible endpoints or Other", async () => {
    await render(SPEECH_TO_TEXT_DEFAULTS);
    expect(container.textContent).toContain("Enter the endpoint base URL");
    act(() => setValue(byLabel<HTMLSelectElement>("Speech-to-text model"), "__other__"));
    act(() => setValue(byLabel<HTMLInputElement>("Other model id"), "my-whisper"));
    act(() => setValue(byLabel<HTMLInputElement>("Speech-to-text base URL"), "https://stt.example.com/v1"));
    expect(container.textContent).not.toContain("Enter the endpoint base URL");
    await act(async () => setValue(byLabel<HTMLSelectElement>("Speech-to-text provider"), "deepgram"));
    expect(byLabel("Speech-to-text base URL")).toBeNull();
    expect(byLabel("Other model id")).toBeNull();
  });

  it("shows a readable message and the code when the test fails", async () => {
    mockInstanceSettingsApi.testSpeechToText.mockResolvedValue({ ok: false, code: "stt_rejected", message: "Speech-to-text endpoint answered HTTP 401", status: 401 });
    await render({ ...SPEECH_TO_TEXT_DEFAULTS, provider: "deepgram", model: "nova-3", apiKeyEnvVar: "DEEPGRAM_API_KEY" });
    chooseFile();
    await act(async () => click(button("Test speech-to-text")));
    await vi.waitFor(() => expect(container.textContent).toContain("The provider rejected the request. Check the key, the model and the language."));
    expect(container.textContent).toContain("stt_rejected · HTTP 401");
  });

  it("changes limits with steppers that show the unit and reset to the default", async () => {
    await render({ ...SPEECH_TO_TEXT_DEFAULTS, provider: "elevenlabs", model: "scribe_v3", apiKeyEnvVar: "ELEVENLABS_API_KEY", diarize: true });
    await act(async () => click(button("Advanced")));
    expect(byLabel("Max audio").textContent).toBe("600 s");
    act(() => click(byLabel("Increase Max audio")));
    expect(byLabel("Max audio").textContent).toBe("630 s");
    act(() => click(button("Default (600 s)")));
    expect(byLabel("Max audio").textContent).toBe("600 s");
    expect(byLabel("Maximum speakers").textContent).toBe("Automatic");
    act(() => click(byLabel("Increase Maximum speakers")));
    expect(byLabel("Maximum speakers").textContent).toBe("1 speakers");
    act(() => click(button("Save speech-to-text")));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ maxAudioSeconds: 600, elevenlabs: { tagAudioEvents: false, numSpeakers: 1 } }));
  });
});
