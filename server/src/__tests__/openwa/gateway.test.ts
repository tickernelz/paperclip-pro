import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createOpenwaGatewayClient,
  OpenwaGatewayError,
  type OpenwaGatewayClient,
} from "../../services/openwa/gateway.js";

const OPERATOR_KEY = "owa_k1_operator_SECRET_aaaaaaaaaaaaaaaa";
const ADMIN_KEY = "owa_k1_admin_SECRET_bbbbbbbbbbbbbbbbbbbb";
const SESSION_ID = "f97fb953-0000-4000-8000-00000000b79b";

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void;

let server: Server;
let baseUrl: string;
let handler: Handler;
const seen: Seen[] = [];

function reply(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(text);
}

function client(overrides: Partial<Parameters<typeof createOpenwaGatewayClient>[0]> = {}): OpenwaGatewayClient {
  return createOpenwaGatewayClient({
    baseUrl,
    apiKey: OPERATOR_KEY,
    adminApiKey: ADMIN_KEY,
    sessionId: SESSION_ID,
    timeoutMs: 2_000,
    ...overrides,
  });
}

async function caught(promise: Promise<unknown>): Promise<OpenwaGatewayError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(OpenwaGatewayError);
    const gatewayError = error as OpenwaGatewayError;
    const rendered = [gatewayError.message, String(gatewayError), gatewayError.stack ?? "", JSON.stringify(gatewayError)].join("\n");
    expect(rendered).not.toContain(OPERATOR_KEY);
    expect(rendered).not.toContain(ADMIN_KEY);
    return gatewayError;
  }
  throw new Error("expected the call to fail");
}

async function unusedPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
      handler(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = "http://127.0.0.1:" + (server.address() as AddressInfo).port + "/";
});

afterEach(() => {
  seen.length = 0;
  server.closeAllConnections();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("OpenWA gateway client requests", () => {
  it("sends with the operator key, injects the session id and forwards only declared body fields", async () => {
    handler = (_req, res) => reply(res, 201, { messageId: "true_628@c.us_ABC", timestamp: 1_760_000_000 });
    const result = await client().sendText({ chatId: "628111@c.us", text: "halo", mentions: ["628111@c.us"] });
    expect(result).toEqual({ messageId: "true_628@c.us_ABC", timestamp: 1_760_000_000 });
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe("POST");
    expect(seen[0].url).toBe("/api/sessions/" + SESSION_ID + "/messages/send-text");
    expect(seen[0].headers["x-api-key"]).toBe(OPERATOR_KEY);
    expect(JSON.parse(seen[0].body)).toEqual({ chatId: "628111@c.us", text: "halo", mentions: ["628111@c.us"] });
  });

  it("uses the admin key only for operations that require an unscoped key", async () => {
    handler = (_req, res) => reply(res, 200, []);
    await client().call("AuthController_findAll");
    await client().call("PluginsController_findAll");
    await client().call("ContactController_findAll");
    await client().call("SessionController_getGroups");
    expect(seen.map((entry) => entry.headers["x-api-key"])).toEqual([ADMIN_KEY, ADMIN_KEY, OPERATOR_KEY, OPERATOR_KEY]);
  });

  it("refuses unscoped-key operations without an admin key before any request", async () => {
    handler = (_req, res) => reply(res, 200, []);
    const error = await caught(client({ adminApiKey: null }).call("SettingsController_get"));
    expect(error.code).toBe("unavailable_without_admin_key");
    expect(seen).toHaveLength(0);
  });

  it("sends public health checks without any key", async () => {
    handler = (_req, res) => reply(res, 200, { status: "ok", timestamp: "2026-10-03T00:00:00.000Z" });
    expect((await client().health()).status).toBe("ok");
    expect(seen[0].url).toBe("/api/health");
    expect(seen[0].headers["x-api-key"]).toBeUndefined();
  });

  it("injects the session id as a query filter on cross-session listing routes", async () => {
    handler = (_req, res) => reply(res, 200, { items: [], total: 0 });
    await client().call("AuditController_findAll", { limit: 5 });
    const url = new URL(seen[0].url, "http://x");
    expect(url.pathname).toBe("/api/audit");
    expect(url.searchParams.get("sessionId")).toBe(SESSION_ID);
    expect(url.searchParams.get("limit")).toBe("5");
    expect(seen[0].headers["x-api-key"]).toBe(ADMIN_KEY);
  });

  it("encodes path arguments and query flags for stored and live history", async () => {
    handler = (_req, res) => reply(res, 200, { messages: [], total: 0 });
    await client().listStoredMessages({ after: "row-1", limit: 100, chatId: "120363@g.us", inlineMedia: false });
    handler = (_req, res) => reply(res, 200, []);
    await client().chatHistory({ chatId: "120363@g.us", limit: 2000, deep: true, includeMedia: false });
    const stored = new URL(seen[0].url, "http://x");
    expect(stored.pathname).toBe("/api/sessions/" + SESSION_ID + "/messages");
    expect(Object.fromEntries(stored.searchParams)).toEqual({ limit: "100", inlineMedia: "false", after: "row-1", chatId: "120363@g.us" });
    const live = new URL(seen[1].url, "http://x");
    expect(live.pathname).toBe("/api/sessions/" + SESSION_ID + "/messages/120363%40g.us/history");
    expect(Object.fromEntries(live.searchParams)).toEqual({ limit: "2000", deep: "true", includeMedia: "false" });
  });

  it("rejects invalid arguments before any HTTP call", async () => {
    handler = (_req, res) => reply(res, 201, { messageId: "x", timestamp: 1 });
    const missing = await caught(client().call("MessageController_sendText", { chatId: "628111@c.us" }));
    expect(missing.code).toBe("bad_request");
    const extra = await caught(client().call("MessageController_sendText", { chatId: "a", text: "b", sessionId: "other" }));
    expect(extra.code).toBe("bad_request");
    const tooLong = await caught(client().sendText({ chatId: "a", text: "x".repeat(4097) }));
    expect(tooLong.code).toBe("bad_request");
    const wrongEnum = await caught(client().call("SessionController_sendChatState", { chatId: "a", state: "dancing" }));
    expect(wrongEnum.code).toBe("bad_request");
    const unknown = await caught(client().call("Nope_nope", {}));
    expect(unknown.code).toBe("bad_request");
    const twoSources = await caught(client().sendMedia({ kind: "image", chatId: "a", url: "https://x/y.png", base64: "AA==" }));
    expect(twoSources.code).toBe("bad_request");
    expect(seen).toHaveLength(0);
  });

  it("validates the operator and admin keys through POST /api/auth/validate", async () => {
    handler = (req, res) => {
      if (req.headers["x-api-key"] === ADMIN_KEY) reply(res, 200, { valid: true, role: "admin", engineType: "whatsapp-web.js" });
      else reply(res, 401, { statusCode: 401, message: "Invalid API key" });
    };
    expect(await client().validateKey("admin")).toEqual({ valid: true, role: "admin", engineType: "whatsapp-web.js" });
    expect(await client().validateKey()).toEqual({ valid: false });
    expect(seen.map((entry) => [entry.method, entry.url])).toEqual([
      ["POST", "/api/auth/validate"],
      ["POST", "/api/auth/validate"],
    ]);
  });

  it("reads the gateway version from the public OpenAPI document", async () => {
    handler = (_req, res) => reply(res, 200, { openapi: "3.0.0", info: { title: "OpenWA API", version: "0.23.7" }, paths: {} });
    expect(await client().openApiVersion()).toBe("0.23.7");
    expect(seen[0].url).toBe("/api/docs-json");
    expect(seen[0].headers["x-api-key"]).toBeUndefined();
  });
});

describe("OpenWA gateway client error mapping", () => {
  const cases: Array<[number, Record<string, string>, unknown, string]> = [
    [501, {}, { statusCode: 501, message: "Not supported on whatsapp-web.js" }, "unavailable_on_engine"],
    [401, {}, { statusCode: 401, message: "Invalid API key" }, "unauthorized"],
    [403, {}, { statusCode: 403, message: "API key is restricted to selected chats" }, "forbidden"],
    [404, {}, { statusCode: 404, message: "Session not found" }, "not_found"],
    [400, {}, { statusCode: 400, message: ["chatId must be a string"] }, "bad_request"],
    [413, {}, { statusCode: 413, message: "Payload too large" }, "payload_too_large"],
    [502, {}, "bad gateway", "gateway_unavailable"],
    [503, { "retry-after": "7" }, { statusCode: 503, message: "busy" }, "gateway_unavailable"],
    [504, {}, "timeout", "gateway_unavailable"],
  ];

  for (const [status, headers, body, code] of cases) {
    it("maps HTTP " + status + " to " + code, async () => {
      handler = (_req, res) => reply(res, status, body, headers);
      const error = await caught(client().call("ContactController_findAll"));
      expect(error.code).toBe(code);
      expect(error.status).toBe(status);
      expect(error.operationId).toBe("ContactController_findAll");
    });
  }

  it("maps a pacing refusal to retry_after with the governor's delay", async () => {
    handler = (_req, res) =>
      reply(res, 429, { statusCode: 429, error: "Too Many Requests", message: "warm-up cap", code: "SEND_PACING_LIMITED", retryAfterSeconds: 3600 });
    const error = await caught(client().sendText({ chatId: "628111@c.us", text: "halo" }));
    expect(error.code).toBe("retry_after");
    expect(error.pacing).toBe(true);
    expect(error.retryAfterSeconds).toBe(3600);
  });

  it("maps the throttler's 429 to rate_limited with Retry-After", async () => {
    handler = (_req, res) => reply(res, 429, { statusCode: 429, message: "ThrottlerException: Too Many Requests" }, { "retry-after": "12" });
    const error = await caught(client().sendText({ chatId: "628111@c.us", text: "halo" }));
    expect(error.code).toBe("rate_limited");
    expect(error.pacing).toBe(false);
    expect(error.retryAfterSeconds).toBe(12);
  });

  it("maps a malformed JSON body to invalid_response", async () => {
    handler = (_req, res) => reply(res, 200, "{not json");
    const error = await caught(client().call("ContactController_findAll"));
    expect(error.code).toBe("invalid_response");
  });

  it("maps connection refusal to gateway_unavailable even for sends", async () => {
    const port = await unusedPort();
    const error = await caught(client({ baseUrl: "http://127.0.0.1:" + port }).sendText({ chatId: "628111@c.us", text: "halo" }));
    expect(error.code).toBe("gateway_unavailable");
  });

  it("maps a send timeout to uncertain", async () => {
    handler = () => undefined;
    const error = await caught(client({ timeoutMs: 150 }).sendText({ chatId: "628111@c.us", text: "halo" }));
    expect(error.code).toBe("uncertain");
    expect(seen).toHaveLength(1);
  });

  it("maps a connection reset after a send was written to uncertain", async () => {
    handler = (req) => req.socket.destroy();
    const error = await caught(client().sendText({ chatId: "628111@c.us", text: "halo" }));
    expect(error.code).toBe("uncertain");
    expect(seen).toHaveLength(1);
  });

  it("maps a read timeout to gateway_unavailable", async () => {
    handler = () => undefined;
    const error = await caught(client({ timeoutMs: 150 }).call("ContactController_findAll"));
    expect(error.code).toBe("gateway_unavailable");
  });

  it("keeps both keys out of errors even when the gateway echoes them", async () => {
    handler = (req, res) => reply(res, 400, { statusCode: 400, message: "bad key " + String(req.headers["x-api-key"]) + " / " + ADMIN_KEY });
    const error = await caught(client().call("ContactController_findAll"));
    expect(error.code).toBe("bad_request");
    expect(error.message).toContain("[redacted]");
  });
});

describe("OpenWA gateway media download", () => {
  it("streams media bytes with type and filename", async () => {
    handler = (_req, res) => {
      res.writeHead(200, {
        "content-type": "image/jpeg",
        "content-disposition": 'attachment; filename="photo.jpg"',
        "content-length": "4",
      });
      res.end(Buffer.from([1, 2, 3, 4]));
    };
    const media = await client().downloadMedia({ chatId: "628111@c.us", messageId: "true_628@c.us_M1", maxBytes: 1024 });
    const chunks: Buffer[] = [];
    for await (const chunk of media.stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(media.contentType).toBe("image/jpeg");
    expect(media.filename).toBe("photo.jpg");
    expect(media.contentLength).toBe(4);
    expect(seen[0].url).toBe("/api/sessions/" + SESSION_ID + "/messages/628111%40c.us/true_628%40c.us_M1/media");
  });

  it("refuses media whose declared size exceeds the limit", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "video/mp4", "content-length": "2048" });
      res.end(Buffer.alloc(2048));
    };
    const error = await caught(client().downloadMedia({ chatId: "a@c.us", messageId: "m", maxBytes: 1024 }));
    expect(error.code).toBe("payload_too_large");
  });

  it("aborts a chunked stream once it passes the limit", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "video/mp4" });
      res.write(Buffer.alloc(800));
      res.end(Buffer.alloc(800));
    };
    const media = await client().downloadMedia({ chatId: "a@c.us", messageId: "m", maxBytes: 1024 });
    let failure: unknown = null;
    try {
      for await (const chunk of media.stream) void chunk;
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(OpenwaGatewayError);
    expect((failure as OpenwaGatewayError).code).toBe("payload_too_large");
  });
});
