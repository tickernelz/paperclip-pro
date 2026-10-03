import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  agents,
  authUsers,
  chatAuditEntries,
  chatEndpoints,
  companies,
  companyMemberships,
  createDb,
  principalPermissionGrants,
  toolConnections,
} from "@tickernelz/paperclip-pro-db";
import { startEmbeddedPostgresTestDatabase } from "../helpers/embedded-postgres.js";
import { describeEmbeddedPostgres } from "../helpers/route-test-harness.js";
import { errorHandler } from "../../middleware/index.js";
import { chatChannelRoutes } from "../../routes/chat-channels.js";
import { chatChannelService, type ChatChannelService } from "../../services/chat-channels.js";
import { ChatSdkRuntime, type ChatSdkEndpointRuntime } from "../../services/chat-sdk-runtime.js";
import { agentService } from "../../services/agents.js";
import { OPENWA_AGENT_ADAPTER_ATTENTION_MESSAGE } from "../../services/openwa/agent-adapter.js";

const OPERATOR_KEY = "operator-key-0123456789";
const ADMIN_KEY = "admin-key-0123456789";
const CHAT_SCOPED_KEY = "chat-scoped-key-0123456789";
const VIEWER_KEY = "viewer-key-0123456789";
const SESSION_ID = "f97fb953-c17e-4d9a-a547-7b64de9fb79b";
const SECOND_SESSION_ID = "0f1e2d3c-4b5a-4968-8776-655443322110";
const PHONE = "6281234567040";

type FakeSession = { id: string; name: string; status: string; phone: string | null; pushName: string | null };

interface FakeGateway {
  baseUrl: string;
  version: string | null;
  sessions: FakeSession[];
  sessionsStatus: number;
  sessionsBody: unknown;
  requests: string[];
  close(): Promise<void>;
}

async function startFakeGateway(): Promise<FakeGateway> {
  const state = {
    version: "0.23.7" as string | null,
    sessions: [{ id: SESSION_ID, name: "zhafron", status: "ready", phone: PHONE, pushName: "Zhafron" }] as FakeSession[],
    sessionsStatus: 200,
    sessionsBody: undefined as unknown,
    requests: [] as string[],
  };
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const handler = (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://gateway");
    state.requests.push(`${req.method} ${url.pathname}`);
    const key = req.headers["x-api-key"];
    if (url.pathname === "/api/docs-json" && req.method === "GET") {
      if (state.version === null) return json(res, 404, { message: "Not Found", statusCode: 404 });
      return json(res, 200, { openapi: "3.0.0", info: { title: "OpenWA API", version: state.version } });
    }
    if (key !== OPERATOR_KEY && key !== ADMIN_KEY && key !== CHAT_SCOPED_KEY && key !== VIEWER_KEY)
      return json(res, 401, { message: "Invalid API key", error: "Unauthorized", statusCode: 401 });
    if (key === CHAT_SCOPED_KEY)
      return json(res, 403, { message: "API key is restricted to selected chats", error: "Forbidden", statusCode: 403 });
    if (url.pathname === "/api/auth/validate" && req.method === "POST") {
      const role = key === ADMIN_KEY ? "admin" : key === VIEWER_KEY ? "viewer" : "operator";
      return json(res, 200, { valid: true, role, engineType: "whatsapp-web.js" });
    }
    if (url.pathname === "/api/sessions" && req.method === "GET") {
      if (state.sessionsStatus !== 200) return json(res, state.sessionsStatus, { message: "Too Many Requests", statusCode: state.sessionsStatus });
      return json(res, 200, state.sessionsBody ?? state.sessions.map((session) => ({
        ...session,
        connectedAt: null,
        lastActive: null,
        createdAt: "2026-10-02T00:00:00.000Z",
        updatedAt: "2026-10-03T00:00:00.000Z",
        lastError: null,
        restriction: null,
        engineLoaded: true,
      })));
    }
    const sessionPath = /^\/api\/sessions\/([^/]+)$/.exec(url.pathname);
    if (sessionPath && req.method === "GET") {
      const session = state.sessions.find((candidate) => candidate.id === sessionPath[1]);
      if (!session) return json(res, 404, { message: "Session not found", statusCode: 404 });
      return json(res, 200, {
        ...session,
        connectedAt: null,
        lastActive: null,
        createdAt: "2026-10-02T00:00:00.000Z",
        updatedAt: "2026-10-03T00:00:00.000Z",
        lastError: null,
        restriction: { active: true, kind: "temporary_ban", expiresAt: "2026-10-04T00:00:00.000Z" },
        engineLoaded: true,
      });
    }
    return json(res, 404, { message: "Not Found", statusCode: 404 });
  };
  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return Object.assign(state, {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  });
}

describeEmbeddedPostgres("OpenWA setup inspection and configure", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let secretsDir: string;
  let gateway: FakeGateway | undefined;
  const previousKeyFile = process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
  const services: ChatChannelService[] = [];
  const companyIds: string[] = [];

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-openwa-setup-");
    db = createDb(database.connectionString);
    secretsDir = await mkdtemp(path.join(tmpdir(), "openwa-secrets-"));
    process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = path.join(secretsDir, "master.key");
  }, 30_000);

  afterEach(async () => {
    await Promise.all(services.splice(0).map((service) => service.shutdown()));
    for (const id of companyIds.splice(0))
      await db.update(chatEndpoints).set({ status: "archived" }).where(eq(chatEndpoints.companyId, id));
    await gateway?.close();
    gateway = undefined;
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await database?.cleanup();
    if (secretsDir) await rm(secretsDir, { recursive: true, force: true });
    if (previousKeyFile === undefined) delete process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
    else process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = previousKeyFile;
  });

  function fakeRuntime(): ChatSdkRuntime {
    const runtime = new ChatSdkRuntime();
    const live = new Map<string, ChatSdkEndpointRuntime>();
    vi.spyOn(runtime, "replaceEndpoint").mockImplementation(async (options) => {
      const instance = { initialize: async () => undefined, shutdown: async () => undefined, getProviderAdapter: () => null } as unknown as ChatSdkEndpointRuntime;
      live.set(options.endpointId, instance);
      return instance;
    });
    vi.spyOn(runtime, "get").mockImplementation((endpointId) => live.get(endpointId) ?? null);
    vi.spyOn(runtime, "removeEndpoint").mockImplementation(async (endpointId) => live.delete(endpointId));
    return runtime;
  }

  function live(): FakeGateway {
    if (!gateway) throw new Error("fake gateway is not running");
    return gateway;
  }

  async function setup(options: { adapterType?: string; publicBaseUrl?: string | null } = {}) {
    gateway ??= await startFakeGateway();
    const companyId = randomUUID();
    const agentId = randomUUID();
    const userId = randomUUID();
    companyIds.push(companyId);
    await db.insert(companies).values({
      id: companyId,
      name: "OpenWA test",
      issuePrefix: `W${companyId.replaceAll("-", "").slice(0, 7).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "WhatsApp Agent",
      role: "engineer",
      status: "idle",
      adapterType: options.adapterType ?? "claude_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(authUsers).values({
      id: userId,
      name: "Operator",
      email: `${userId}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "operator",
    });
    await db.insert(principalPermissionGrants).values({
      companyId,
      principalType: "user",
      principalId: userId,
      permissionKey: "tools:manage_connections",
      grantedByUserId: userId,
    });
    const service = chatChannelService(db, {
      runtime: fakeRuntime(),
      publicBaseUrl: options.publicBaseUrl === undefined ? "https://paperclip.example" : options.publicBaseUrl,
      heartbeat: { wakeup: async () => ({ accepted: true }) } as never,
      scheduleDeferredWork: () => {},
    });
    services.push(service);
    const endpoint = await service.create(companyId, { provider: "openwa", assignedAgentId: agentId }, userId);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = {
        type: "board",
        source: "session",
        userId,
        isInstanceAdmin: false,
        companyIds: [companyId],
        memberships: [{ companyId, status: "active", membershipRole: "operator" }],
      } as never;
      next();
    });
    app.use("/api", chatChannelRoutes(db, { heartbeat: { wakeup: async () => undefined } as never, service }));
    app.use(errorHandler);
    return { app, service, endpoint, companyId, agentId, userId };
  }

  const inspect = (app: express.Express, endpointId: string, body: Record<string, unknown>) =>
    request(app).post(`/api/chat-endpoints/${endpointId}/openwa/inspect`).send(body);
  const configure = (app: express.Express, endpointId: string, overrides: { attestations?: { pacing: boolean; soleClient: boolean }; sessionId?: string } = {}) =>
    request(app).post(`/api/chat-endpoints/${endpointId}/setup`).send({
      action: "configure",
      credentials: { apiKey: OPERATOR_KEY },
      openwa: {
        baseUrl: live().baseUrl,
        sessionId: overrides.sessionId ?? SESSION_ID,
        numberMode: "agent_number",
        attestations: overrides.attestations ?? { pacing: true, soleClient: true },
      },
    });

  it("inspects a valid gateway read-only and returns no secrets", async () => {
    const { app, endpoint } = await setup();
    const response = await inspect(app, endpoint.id, { baseUrl: live().baseUrl + "/", apiKey: OPERATOR_KEY });
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      baseUrl: live().baseUrl,
      gatewayVersion: "0.23.7",
      pinnedVersion: "0.23.7",
      engine: "whatsapp-web.js",
      keyRole: "operator",
      adminKey: null,
      warnings: [],
      eligible: true,
      sessions: [{ sessionId: SESSION_ID, name: "zhafron", status: "ready", maskedNumber: "+62xxx...7040", pushName: "Zhafron", eligible: true }],
    });
    expect(JSON.stringify(response.body)).not.toContain(OPERATOR_KEY);
    expect(JSON.stringify(response.body)).not.toContain(PHONE);
    expect(live().requests.every((line) => line.startsWith("GET ") || line === "POST /api/auth/validate")).toBe(true);
  });

  it("validates an optional admin key and warns about an unknown gateway version", async () => {
    const { app, endpoint } = await setup();
    live().version = null;
    const response = await inspect(app, endpoint.id, { baseUrl: live().baseUrl, apiKey: OPERATOR_KEY, adminApiKey: ADMIN_KEY });
    expect(response.status).toBe(200);
    expect(response.body.gatewayVersion).toBeNull();
    expect(response.body.adminKey).toEqual({ role: "admin" });
    expect(response.body.warnings.join(" ")).toContain("assumes OpenWA 0.23.7");
  });

  it("warns when the key sees more than one session", async () => {
    const { app, endpoint } = await setup();
    live().sessions.push({ id: SECOND_SESSION_ID, name: "other", status: "qr_ready", phone: null, pushName: null });
    const response = await inspect(app, endpoint.id, { baseUrl: live().baseUrl, apiKey: OPERATOR_KEY });
    expect(response.status).toBe(200);
    expect(response.body.warnings.join(" ")).toContain("not scoped to one session");
    expect(response.body.sessions[1]).toMatchObject({ sessionId: SECOND_SESSION_ID, eligible: false, maskedNumber: null });
  });

  it("rejects a key restricted to selected chats", async () => {
    const { app, endpoint } = await setup();
    const response = await inspect(app, endpoint.id, { baseUrl: live().baseUrl, apiKey: CHAT_SCOPED_KEY });
    expect(response.status).toBe(422);
    expect(response.body.details.code).toBe("openwa_key_chat_scoped");
  });

  it("rejects an agent whose adapter cannot sign run tokens", async () => {
    const { app, endpoint } = await setup({ adapterType: "paperclip_runner" });
    const inspected = await inspect(app, endpoint.id, { baseUrl: live().baseUrl, apiKey: OPERATOR_KEY });
    expect(inspected.status).toBe(422);
    expect(inspected.body.details.code).toBe("openwa_agent_adapter_unsupported");
    const configured = await configure(app, endpoint.id);
    expect(configured.status).toBe(422);
    expect(configured.body.details.code).toBe("openwa_agent_adapter_unsupported");
    expect(live().requests).toEqual([]);
  });

  it("rejects a wrong or viewer key with 422", async () => {
    const { app, endpoint } = await setup();
    const wrong = await inspect(app, endpoint.id, { baseUrl: live().baseUrl, apiKey: "wrong-key" });
    expect(wrong.status).toBe(422);
    expect(wrong.body.details.code).toBe("openwa_credentials_invalid");
    expect(JSON.stringify(wrong.body)).not.toContain("wrong-key");
    const viewer = await inspect(app, endpoint.id, { baseUrl: live().baseUrl, apiKey: VIEWER_KEY });
    expect(viewer.status).toBe(422);
    expect(viewer.body.details.code).toBe("openwa_key_role_insufficient");
  });

  it("returns 503 telling the user not to replace credentials when the gateway is down", async () => {
    const { app, endpoint } = await setup();
    const baseUrl = live().baseUrl;
    await live().close();
    const response = await inspect(app, endpoint.id, { baseUrl, apiKey: OPERATOR_KEY });
    expect(response.status).toBe(503);
    expect(response.body.error).toContain("do not replace the API key");
    expect(response.body.details.code).toBe("openwa_gateway_unreachable");
    gateway = await startFakeGateway();
  });

  it("maps gateway throttling to 429 and a malformed session list to 502", async () => {
    const { app, endpoint } = await setup();
    live().sessionsStatus = 429;
    const limited = await inspect(app, endpoint.id, { baseUrl: live().baseUrl, apiKey: OPERATOR_KEY });
    expect(limited.status).toBe(429);
    live().sessionsStatus = 200;
    live().sessionsBody = { sessions: "nope" };
    const malformed = await inspect(app, endpoint.id, { baseUrl: live().baseUrl, apiKey: OPERATOR_KEY });
    expect(malformed.status).toBe(502);
    expect(malformed.body.details.code).toBe("openwa_invalid_response");
  });

  it("rejects a gateway URL with a path or embedded credentials", async () => {
    const { app, endpoint } = await setup();
    for (const baseUrl of [live().baseUrl + "/api", "http://user:pass@127.0.0.1:1", "ftp://127.0.0.1"]) {
      const response = await inspect(app, endpoint.id, { baseUrl, apiKey: OPERATOR_KEY });
      expect(response.status).toBe(400);
    }
  });

  it("requires both attestations before configuring", async () => {
    const { app, endpoint, service } = await setup();
    for (const attestations of [{ pacing: false, soleClient: true }, { pacing: true, soleClient: false }]) {
      const response = await configure(app, endpoint.id, { attestations });
      expect(response.status).toBe(422);
      expect(response.body.details.code).toBe("openwa_attestations_required");
    }
    expect((await service.get(endpoint.id)).status).toBe("draft");
  });

  it("configures with vaulted keys, the session identity, and attestations, then waits in the test step", async () => {
    const { app, endpoint, companyId } = await setup();
    const response = await request(app).post(`/api/chat-endpoints/${endpoint.id}/setup`).send({
      action: "configure",
      credentials: { apiKey: OPERATOR_KEY, adminApiKey: ADMIN_KEY },
      openwa: {
        baseUrl: live().baseUrl,
        sessionId: SESSION_ID,
        numberMode: "owner_number",
        attestations: { pacing: true, soleClient: true },
      },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "verifying",
      providerAccountId: `${live().baseUrl}#${SESSION_ID}`,
      botExternalId: PHONE,
      botUsername: "Zhafron",
      botLabel: "Zhafron",
      setup: { step: "test" },
      policy: { numberMode: "owner_number", attestations: { pacing: true, soleClient: true }, triggers: { selfChat: true } },
    });
    expect(response.body.policyRevision).toBe(1);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain(OPERATOR_KEY);
    expect(serialized).not.toContain(ADMIN_KEY);
    const [connection] = await db.select().from(toolConnections).where(eq(toolConnections.companyId, companyId));
    expect(connection.config).toEqual({ provider: "openwa", openwa: { baseUrl: live().baseUrl, sessionId: SESSION_ID } });
    expect(connection.credentialSecretRefs.map((ref) => ref.configPath).sort()).toEqual(["credentials.adminApiKey", "credentials.apiKey"]);
    expect(JSON.stringify(connection)).not.toContain(OPERATOR_KEY);
  });

  it("reads gateway health with the stored key and reports observed pacing without secrets or full numbers", async () => {
    const { app, endpoint, companyId, userId } = await setup();
    expect((await request(app).post(`/api/chat-endpoints/${endpoint.id}/setup`).send({
      action: "configure",
      credentials: { apiKey: OPERATOR_KEY, adminApiKey: ADMIN_KEY },
      openwa: { baseUrl: live().baseUrl, sessionId: SESSION_ID, numberMode: "agent_number", attestations: { pacing: true, soleClient: true } },
    })).status).toBe(200);
    const attested = await request(app).get(`/api/chat-endpoints/${endpoint.id}/openwa/health`);
    expect(attested.status).toBe(200);
    expect(attested.headers["cache-control"]).toBe("no-store");
    expect(attested.body).toMatchObject({
      gatewayVersion: "0.23.7",
      pinnedVersion: "0.23.7",
      engine: "whatsapp-web.js",
      session: { status: "ready", maskedNumber: "+62xxx...7040", restriction: { active: true, kind: "temporary_ban", expiresAt: "2026-10-04T00:00:00.000Z" } },
      pacing: { attested: true, observedAt: null },
      adminKeyConfigured: true,
      gatewayError: null,
    });
    const serialized = JSON.stringify(attested.body);
    expect(serialized).not.toContain(OPERATOR_KEY);
    expect(serialized).not.toContain(ADMIN_KEY);
    expect(serialized).not.toContain(PHONE);
    expect(live().requests).toContain(`GET /api/sessions/${SESSION_ID}`);
    const limitedAt = new Date("2026-10-03T05:00:00.000Z");
    await db.insert(chatAuditEntries).values([
      { companyId, endpointId: endpoint.id, kind: "tool_called", actorKind: "agent", metadata: { tool: "openwa_send", errorCode: "retry_after", pacing: true }, occurredAt: limitedAt },
      { companyId, endpointId: endpoint.id, kind: "tool_called", actorKind: "agent", metadata: { tool: "openwa_send", errorCode: "retry_after" }, occurredAt: new Date("2026-10-03T06:00:00.000Z") },
    ]);
    const observed = await request(app).get(`/api/chat-endpoints/${endpoint.id}/openwa/health`);
    expect(observed.body.pacing).toEqual({ attested: true, observedAt: limitedAt.toISOString() });
    await gateway?.close();
    gateway = undefined;
    const down = await request(app).get(`/api/chat-endpoints/${endpoint.id}/openwa/health`);
    expect(down.status).toBe(200);
    expect(down.body.gatewayError).toContain("could not reach the OpenWA gateway");
    expect(down.body.pacing.observedAt).toBe(limitedAt.toISOString());
    await db.delete(principalPermissionGrants).where(eq(principalPermissionGrants.principalId, userId));
    expect((await request(app).get(`/api/chat-endpoints/${endpoint.id}/openwa/health`)).status).toBe(403);
  });

  it("configures without a public Paperclip URL because ingress is an outbound socket", async () => {
    const { app, endpoint } = await setup({ publicBaseUrl: null });
    const response = await configure(app, endpoint.id);
    expect(response.status).toBe(200);
    expect(response.body.setup.step).toBe("test");
  });

  it("refuses a second endpoint on the same gateway session or number with 409", async () => {
    const first = await setup();
    expect((await configure(first.app, first.endpoint.id)).status).toBe(200);
    const second = await setup();
    const inspected = await inspect(second.app, second.endpoint.id, { baseUrl: live().baseUrl, apiKey: OPERATOR_KEY });
    expect(inspected.body.sessions[0]).toMatchObject({ eligible: false, unavailableReason: "This session or WhatsApp number already belongs to another channel" });
    const response = await configure(second.app, second.endpoint.id);
    expect(response.status).toBe(409);
    expect(response.body.details.code).toBe("chat_bot_identity_in_use");
    live().sessions.splice(0, 1, { id: SECOND_SESSION_ID, name: "same number", status: "ready", phone: PHONE, pushName: "Zhafron" });
    const sameNumber = await configure(second.app, second.endpoint.id, { sessionId: SECOND_SESSION_ID });
    expect(sameNumber.status).toBe(409);
  });

  it("puts the endpoint in attention when its agent switches to an adapter without run tokens", async () => {
    const { app, endpoint, service, agentId } = await setup();
    expect((await configure(app, endpoint.id)).status).toBe(200);
    await agentService(db).update(agentId, { adapterType: "codex_local" });
    expect((await service.get(endpoint.id)).status).toBe("verifying");
    await agentService(db).update(agentId, { adapterType: "paperclip_runner" });
    const updated = await service.get(endpoint.id);
    expect(updated.status).toBe("attention");
    expect(updated.healthMessage).toBe(OPENWA_AGENT_ADAPTER_ATTENTION_MESSAGE);
  });
});
