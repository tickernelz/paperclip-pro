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
}));
vi.mock("@/api/instanceSettings", () => ({ instanceSettingsApi: mockInstanceSettingsApi }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function setValue(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

describe("SpeechToTextSection", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onSave: ReturnType<typeof vi.fn<(next: SpeechToTextSettings) => void>>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    onSave = vi.fn<(next: SpeechToTextSettings) => void>();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  function render(value: SpeechToTextSettings) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    root = createRoot(container);
    act(() => {
      root.render(
        <QueryClientProvider client={client}>
          <SpeechToTextSection value={value} disabled={false} onSave={onSave} />
        </QueryClientProvider>,
      );
    });
  }

  const byLabel = <T extends Element>(label: string) => container.querySelector<T & Element>('[aria-label="' + label + '"]')!;
  const button = (text: string) => Array.from(container.querySelectorAll("button")).find((entry) => entry.textContent?.trim() === text)!;

  it("switches to Deepgram options and saves the provider with its options", () => {
    render(SPEECH_TO_TEXT_DEFAULTS);
    expect(container.textContent).not.toContain("Smart formatting");
    act(() => setValue(byLabel<HTMLSelectElement>("Speech-to-text provider"), "deepgram"));
    expect(container.textContent).toContain("Smart formatting");
    expect(container.textContent).toContain("Speaker diarization");
    expect(container.textContent).not.toContain("Tag audio events");
    expect(byLabel<HTMLInputElement>("Speech-to-text model").value).toBe("nova-3");
    act(() => setValue(byLabel<HTMLInputElement>("Speech-to-text model"), "nova-3-medical"));
    act(() => setValue(container.querySelector<HTMLInputElement>('input[placeholder="DEEPGRAM_API_KEY"]')!, "DEEPGRAM_API_KEY"));
    act(() => setValue(byLabel<HTMLTextAreaElement>("Speech-to-text keyterms"), "Wardmote\n\n  OpenWA  \n"));
    act(() => button("Save speech-to-text").click());
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "deepgram", model: "nova-3-medical", apiKeyEnvVar: "DEEPGRAM_API_KEY", baseUrl: "", keyterms: ["Wardmote", "OpenWA"] }),
    );
  });

  it("shows ElevenLabs options and keeps OpenAI-compatible free of provider-only options", () => {
    render({ ...SPEECH_TO_TEXT_DEFAULTS, provider: "elevenlabs", model: "scribe_v3", diarize: true });
    expect(container.textContent).toContain("Tag audio events");
    expect(container.textContent).toContain("Maximum speakers");
    expect(container.textContent).not.toContain("Smart formatting");
    act(() => setValue(byLabel<HTMLSelectElement>("Speech-to-text provider"), "openai_compatible"));
    expect(container.textContent).not.toContain("Speaker diarization");
    expect(container.textContent).not.toContain("Keyterms");
    expect(byLabel<HTMLInputElement>("Speech-to-text model").value).toBe("whisper-1");
  });

  it("fetches provider models into the model suggestions", async () => {
    mockInstanceSettingsApi.listSpeechToTextModels.mockResolvedValue({ models: [{ id: "nova-3" }, { id: "nova-3-general" }], source: "provider" });
    render({ ...SPEECH_TO_TEXT_DEFAULTS, provider: "deepgram", model: "nova-3", apiKeyEnvVar: "DG_KEY" });
    await act(async () => button("Fetch").click());
    await vi.waitFor(() => expect(container.textContent).toContain("2 models from the provider"));
    expect(mockInstanceSettingsApi.listSpeechToTextModels).toHaveBeenCalledWith({ provider: "deepgram", baseUrl: "", apiKeyEnvVar: "DG_KEY" });
    const options = Array.from(container.querySelectorAll("datalist option")).map((option) => option.getAttribute("value"));
    expect(options).toEqual(["nova-3", "nova-3-general"]);
  });

  it("tests the draft settings with a chosen file and shows the transcript or the error code", async () => {
    const draft = { ...SPEECH_TO_TEXT_DEFAULTS, provider: "elevenlabs" as const, model: "scribe_v3", apiKeyEnvVar: "EL_KEY" };
    mockInstanceSettingsApi.testSpeechToText.mockResolvedValueOnce({ ok: true, text: "halo dunia", language: "ind", durationMs: 1200 });
    render(draft);
    const file = new File([new Uint8Array([1, 2, 3])], "sample.ogg", { type: "audio/ogg" });
    const input = byLabel<HTMLInputElement>("Speech-to-text test audio");
    Object.defineProperty(input, "files", { value: [file] });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    await act(async () => button("Test speech-to-text").click());
    await vi.waitFor(() => expect(container.textContent).toContain("halo dunia"));
    expect(mockInstanceSettingsApi.testSpeechToText).toHaveBeenCalledWith(draft, file);
    mockInstanceSettingsApi.testSpeechToText.mockResolvedValueOnce({ ok: false, code: "stt_missing_key", message: "The speech-to-text API key environment variable is not set", status: null });
    await act(async () => button("Test speech-to-text").click());
    await vi.waitFor(() => expect(container.textContent).toContain("stt_missing_key"));
  });
});
