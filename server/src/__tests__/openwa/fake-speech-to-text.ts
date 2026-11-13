import { generateKeyPairSync } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { SPEECH_TO_TEXT_DEFAULTS, type SpeechToTextProvider, type SpeechToTextSettings } from "@tickernelz/wardmote-shared";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_KEY_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const MODELS: Record<SpeechToTextProvider, string> = {
  openai_compatible: "whisper-test",
  deepgram: "nova-3",
  elevenlabs: "scribe_v3",
  google: "chirp_3",
};

export class FakeSpeechToTextServer {
  text = "tolong cek invoice nomor 42";
  status = 200;
  hold: Promise<void> | null = null;
  calls = 0;
  readonly paths: string[] = [];
  private server: Server | null = null;

  get origin(): string {
    return "http://127.0.0.1:" + (this.server!.address() as AddressInfo).port;
  }

  get baseUrl(): string {
    return this.origin + "/v1";
  }

  serviceAccountJson(): string {
    return JSON.stringify({
      type: "service_account",
      project_id: "proj-fake-stt",
      private_key_id: "fake-kid",
      private_key: PRIVATE_KEY_PEM,
      client_email: "stt@proj-fake-stt.iam.gserviceaccount.com",
      token_uri: this.origin + "/token",
    });
  }

  settings(provider: SpeechToTextProvider, apiKeyEnvVar: string, overrides: Partial<SpeechToTextSettings> = {}): SpeechToTextSettings {
    return {
      ...SPEECH_TO_TEXT_DEFAULTS,
      enabled: true,
      provider,
      baseUrl: provider === "openai_compatible" ? this.baseUrl : this.origin,
      model: MODELS[provider],
      apiKeyEnvVar,
      ...overrides,
    };
  }

  private body(path: string): unknown {
    if (path === "/v1/listen") return { results: { channels: [{ alternatives: [{ transcript: this.text }] }] } };
    if (path === "/v1/speech-to-text") return { text: this.text, language_code: "ind", words: [] };
    if (path.includes("/recognizers/")) return { results: [{ alternatives: [{ transcript: this.text }], languageCode: "id-id" }] };
    return { text: this.text };
  }

  async start(): Promise<void> {
    this.server = createServer(async (req, res) => {
      for await (const _chunk of req);
      const path = (req.url ?? "").split("?")[0]!;
      if (path === "/token") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ access_token: "fake-google-token", expires_in: 3600 }));
        return;
      }
      this.calls++;
      this.paths.push(path);
      if (this.hold) await this.hold;
      if (res.destroyed) return;
      res.writeHead(this.status, { "content-type": "application/json" });
      res.end(JSON.stringify(this.status === 200 ? this.body(path) : { error: "upstream failed" }));
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
  }

  async close(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}
