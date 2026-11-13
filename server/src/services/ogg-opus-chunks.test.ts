import { describe, expect, it } from "vitest";
import { SPEECH_TO_TEXT_DEFAULTS } from "@tickernelz/wardmote-shared";
import { oggCrc, parseOggPages, splitOggOpus } from "./ogg-opus-chunks.js";
import { transcribeAudio } from "./speech-to-text.js";
import { generateKeyPairSync } from "node:crypto";

function page(input: { flags: number; granule: bigint; sequence: number; payload: Buffer }): Buffer {
  const header = Buffer.alloc(27 + 1);
  header.write("OggS", 0, "latin1");
  header[5] = input.flags;
  header.writeBigUInt64LE(input.granule, 6);
  header.writeUInt32LE(0x1234, 14);
  header.writeUInt32LE(input.sequence, 18);
  header[26] = 1;
  header[27] = input.payload.length;
  const built = Buffer.concat([header, input.payload]);
  built.writeUInt32LE(oggCrc(built), 22);
  return built;
}

function opusStream(audioSeconds: number[], continuedAt: number[] = []): Buffer {
  const head = Buffer.alloc(19);
  head.write("OpusHead", 0, "latin1");
  const tags = Buffer.from("OpusTags" + "x".repeat(8), "latin1");
  const pages = [page({ flags: 0x02, granule: 0n, sequence: 0, payload: head }), page({ flags: 0, granule: 0n, sequence: 1, payload: tags })];
  let granule = 0n;
  audioSeconds.forEach((seconds, index) => {
    granule += BigInt(seconds * 48_000);
    const last = index === audioSeconds.length - 1;
    pages.push(page({ flags: (last ? 0x04 : 0) | (continuedAt.includes(index) ? 0x01 : 0), granule, sequence: index + 2, payload: Buffer.alloc(40, index) }));
  });
  return Buffer.concat(pages);
}

function chunkFacts(chunk: Buffer) {
  const pages = parseOggPages(chunk)!;
  return pages.map((entry) => {
    const copy = Buffer.from(chunk.subarray(entry.start, entry.end));
    const crc = copy.readUInt32LE(22);
    copy.writeUInt32LE(0, 22);
    return { flags: entry.flags, seconds: Number(entry.granule) / 48_000, sequence: copy.readUInt32LE(18), crcOk: oggCrc(copy) === crc };
  });
}

describe("splitOggOpus", () => {
  it("computes the Ogg CRC (polynomial 0x04c11db7, no reflection)", () => {
    expect(oggCrc(Buffer.from("123456789"))).toBe(0x89a1897f);
  });

  it("splits a 130 s stream into standalone streams of at most 55 s with rebased granules, fresh sequences and valid CRCs", () => {
    const chunks = splitOggOpus(opusStream(Array(13).fill(10)), 55)!;
    expect(chunks).toHaveLength(3);
    const facts = chunks.map(chunkFacts);
    for (const chunk of facts) {
      expect(chunk.every((entry) => entry.crcOk)).toBe(true);
      expect(chunk.map((entry) => entry.sequence)).toEqual(chunk.map((_entry, index) => index));
      expect(chunk[0]).toMatchObject({ flags: 0x02, seconds: 0 });
      expect(chunk[1]).toMatchObject({ flags: 0, seconds: 0 });
      expect(chunk.at(-1)!.flags & 0x04).toBe(0x04);
      expect(chunk.slice(2, -1).every((entry) => (entry.flags & 0x04) === 0)).toBe(true);
    }
    expect(facts.map((chunk) => chunk.at(-1)!.seconds)).toEqual([50, 50, 30]);
    expect(chunks.every((chunk) => chunk.toString("latin1", 28, 36) === "OpusHead")).toBe(true);
  });

  it("never starts a part on a page that continues a packet", () => {
    const chunks = splitOggOpus(opusStream(Array(13).fill(10), [5]), 55)!;
    const firstAudioFlags = chunks.map((chunk) => chunkFacts(chunk)[2].flags & 0x01);
    expect(firstAudioFlags.every((flag) => flag === 0)).toBe(true);
    expect(chunkFacts(chunks[0]).at(-1)!.seconds).toBe(60);
  });

  it("keeps a short stream whole and refuses non-Ogg data", () => {
    const short = opusStream([10, 20]);
    expect(splitOggOpus(short, 55)).toEqual([short]);
    expect(splitOggOpus(Buffer.from("ID3 not ogg"), 55)).toBeNull();
  });
});

describe("Google transcription of long Ogg Opus voice notes", () => {
  it("sends one recognize request per part and joins the text", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const account = {
      type: "service_account",
      project_id: "proj-zha6055",
      private_key_id: "kid-ogg",
      private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      client_email: "ogg@proj-zha6055.iam.gserviceaccount.com",
      token_uri: "https://oauth2.googleapis.com/token",
    };
    const contents: Buffer[] = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith("/token")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      contents.push(Buffer.from(JSON.parse(String(init?.body)).content, "base64"));
      return new Response(JSON.stringify({ results: [{ alternatives: [{ transcript: "part " + contents.length }], languageCode: "id-id" }] }), { status: 200 });
    }) as typeof fetch;
    const result = await transcribeAudio(
      { buffer: opusStream(Array(13).fill(10)), mime: "audio/ogg; codecs=opus", filename: "voice.ogg" },
      {
        settings: { ...SPEECH_TO_TEXT_DEFAULTS, enabled: true, provider: "google", model: "chirp_3", apiKeyEnvVar: "G" },
        env: { G: JSON.stringify(account) },
        fetchImpl,
      },
    );
    expect(result).toEqual({ text: "part 1 part 2 part 3", language: "id-id" });
    expect(contents).toHaveLength(3);
    expect(contents.every((content) => content.toString("latin1", 28, 36) === "OpusHead")).toBe(true);
  });
});

describe("Google deadlines and parallel parts", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const account = JSON.stringify({
    type: "service_account",
    project_id: "proj-zha6055",
    private_key_id: "kid-deadline",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    client_email: "deadline@proj-zha6055.iam.gserviceaccount.com",
    token_uri: "https://oauth2.googleapis.com/token",
  });
  const googleSettings = { ...SPEECH_TO_TEXT_DEFAULTS, enabled: true, provider: "google" as const, model: "chirp_3", apiKeyEnvVar: "G", maxAudioSeconds: 7200 };

  function slowGoogle(delayMs: number, failAt?: number) {
    let inFlight = 0;
    let peak = 0;
    let started = 0;
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith("/token")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      const index = ++started;
      inFlight++;
      peak = Math.max(peak, inFlight);
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, delayMs);
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(init.signal!.reason);
          });
        });
      } finally {
        inFlight--;
      }
      if (index === failAt) return new Response("{}", { status: 503 });
      return new Response(JSON.stringify({ results: [{ alternatives: [{ transcript: "part " + index }] }] }), { status: 200 });
    }) as typeof fetch;
    return { fetchImpl, stats: () => ({ peak, started }) };
  }

  it("gives every part its own deadline, so parts that each fit succeed even when their sum does not", async () => {
    const google = slowGoogle(150);
    const result = await transcribeAudio(
      { buffer: opusStream(Array(13).fill(10)), mime: "audio/ogg", filename: "v.ogg" },
      { settings: googleSettings, env: { G: account }, fetchImpl: google.fetchImpl, timeoutMs: 300 },
    );
    expect(result.text).toBe("part 1 part 2 part 3");
    expect(google.stats().started).toBe(3);
  });

  it("runs at most three parts at once and joins them in audio order", async () => {
    const google = slowGoogle(30);
    const result = await transcribeAudio(
      { buffer: opusStream(Array(60).fill(10)), mime: "audio/ogg", filename: "v.ogg" },
      { settings: googleSettings, env: { G: account }, fetchImpl: google.fetchImpl },
    );
    expect(google.stats()).toEqual({ peak: 3, started: 12 });
    expect(result.text.split(" ").filter((word) => word !== "part").map(Number).sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_v, i) => i + 1));
  });

  it("stops starting new parts after one fails", async () => {
    const google = slowGoogle(20, 2);
    await expect(
      transcribeAudio(
        { buffer: opusStream(Array(60).fill(10)), mime: "audio/ogg", filename: "v.ogg" },
        { settings: googleSettings, env: { G: account }, fetchImpl: google.fetchImpl },
      ),
    ).rejects.toMatchObject({ code: "stt_unavailable" });
    expect(google.stats().started).toBeLessThanOrEqual(4);
  });
});

describe("streamed audio is spooled to a temporary file", () => {
  it("sends a file-backed body and removes the file, also when the stream is over the limit", async () => {
    const { mkdtemp, readdir, rm } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const { Readable } = await import("node:stream");
    const dir = await mkdtemp(path.join(os.tmpdir(), "zha6055-spool-"));
    try {
      let sent = "";
      const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
        sent = await (init?.body as Blob).text();
        expect(await readdir(dir)).toHaveLength(1);
        return new Response(JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: "ok" }] }] } }), { status: 200 });
      }) as typeof fetch;
      const settings = { ...SPEECH_TO_TEXT_DEFAULTS, enabled: true, provider: "deepgram" as const, model: "nova-3", apiKeyEnvVar: "D" };
      const result = await transcribeAudio(
        { stream: Readable.from([Buffer.from("part-a "), Buffer.from("part-b")]), mime: "audio/mpeg", filename: "a.mp3" },
        { settings, env: { D: "k" }, fetchImpl, spoolDir: dir },
      );
      expect(result.text).toBe("ok");
      expect(sent).toBe("part-a part-b");
      expect(await readdir(dir)).toEqual([]);
      await expect(
        transcribeAudio(
          { stream: Readable.from([Buffer.alloc(10), Buffer.alloc(10)]), mime: "audio/mpeg", filename: "a.mp3" },
          { settings, env: { D: "k" }, fetchImpl, spoolDir: dir, maxBytes: 15 },
        ),
      ).rejects.toMatchObject({ code: "stt_too_large" });
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
