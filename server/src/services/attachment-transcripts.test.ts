import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { SPEECH_TO_TEXT_DEFAULTS, type SpeechToTextSettings } from "@tickernelz/wardmote-shared";
import type { PutFileInput, StorageService } from "../storage/types.js";
import { transcribeStoredAudio, transcriptCacheObjectKey, withTranscriptCache } from "./attachment-transcripts.js";
import { SpeechToTextError } from "./speech-to-text.js";

function memoryStorage(): StorageService & { objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>();
  return {
    provider: "local_disk",
    objects,
    putFile: vi.fn(async (input: PutFileInput) => {
      const body = "body" in input && Buffer.isBuffer(input.body) ? input.body : Buffer.alloc(0);
      objects.set(input.objectKey!, body);
      return { provider: "local_disk" as const, objectKey: input.objectKey!, contentType: input.contentType, byteSize: body.length, sha256: "x", originalFilename: null };
    }),
    getObject: vi.fn(async (_companyId: string, objectKey: string) => ({ stream: Readable.from(objects.get(objectKey) ?? Buffer.alloc(0)) })),
    headObject: vi.fn(async (_companyId: string, objectKey: string) => ({ exists: objects.has(objectKey), contentLength: objects.get(objectKey)?.length })),
    deleteObject: vi.fn(async () => undefined),
  };
}

const SHA = "a".repeat(64);
const settings: SpeechToTextSettings = { ...SPEECH_TO_TEXT_DEFAULTS, enabled: true, provider: "deepgram", model: "nova-3", apiKeyEnvVar: "DG" };

describe("withTranscriptCache", () => {
  it("runs one transcription per audio content and transcript-affecting settings, inside the company prefix", async () => {
    const storage = memoryStorage();
    const run = vi.fn(async () => ({ text: "halo", language: "id" }));
    const first = await withTranscriptCache({ storage, companyId: "company-1", sha256: SHA, settings }, run);
    const second = await withTranscriptCache({ storage, companyId: "company-1", sha256: SHA, settings: { ...settings, apiKeyEnvVar: "OTHER", sttWaitSeconds: 40 } }, run);
    expect(first).toEqual({ result: { text: "halo", language: "id" }, cached: false });
    expect(second).toEqual({ result: { text: "halo", language: "id" }, cached: true });
    expect(run).toHaveBeenCalledTimes(1);
    expect([...storage.objects.keys()]).toEqual([transcriptCacheObjectKey("company-1", SHA, settings)]);
    expect([...storage.objects.keys()][0]).toMatch(/^company-1\/speech-to-text-cache\/a{64}-[0-9a-f]{32}\.json$/);

    await withTranscriptCache({ storage, companyId: "company-1", sha256: SHA, settings: { ...settings, language: "en" } }, run);
    await withTranscriptCache({ storage, companyId: "company-2", sha256: SHA, settings }, run);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("transcribes without caching when the content hash is unknown or the cache cannot be written", async () => {
    const storage = memoryStorage();
    const run = vi.fn(async () => ({ text: "x" }));
    await withTranscriptCache({ storage, companyId: "company-1", sha256: "not-a-hash", settings }, run);
    expect(storage.putFile).not.toHaveBeenCalled();
    vi.mocked(storage.putFile).mockRejectedValueOnce(new Error("disk full"));
    expect(await withTranscriptCache({ storage, companyId: "company-1", sha256: SHA, settings }, run)).toEqual({ result: { text: "x" }, cached: false });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not cache failures", async () => {
    const storage = memoryStorage();
    await expect(
      withTranscriptCache({ storage, companyId: "company-1", sha256: SHA, settings }, async () => {
        throw new SpeechToTextError("stt_unavailable", "busy");
      }),
    ).rejects.toMatchObject({ code: "stt_unavailable" });
    expect(storage.objects.size).toBe(0);
  });
});

describe("transcribeStoredAudio", () => {
  it("refuses a file above the provider byte limit before reading it", async () => {
    const storage = memoryStorage();
    await expect(
      transcribeStoredAudio({
        storage,
        file: { companyId: "company-1", objectKey: "company-1/a.mp3", sha256: SHA, byteSize: 7_500_001, contentType: "audio/mpeg", originalFilename: "a.mp3" },
        settings: { ...settings, provider: "google", model: "chirp_3" },
      }),
    ).rejects.toMatchObject({ code: "stt_too_large" });
    expect(storage.headObject).not.toHaveBeenCalled();
    expect(storage.getObject).not.toHaveBeenCalled();
  });
});
