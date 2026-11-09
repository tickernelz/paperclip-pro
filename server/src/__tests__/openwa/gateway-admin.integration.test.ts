import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  activityLog,
  agents,
  authUsers,
  chatAuditEntries,
  chatEndpoints,
  companies,
  companyMemberships,
  companySecretBindings,
  createDb,
  toolConnections,
  type Db,
} from "@tickernelz/wardmote-db";
import { startEmbeddedPostgresTestDatabase } from "../helpers/embedded-postgres.js";
import { chatChannelService, type ChatChannelService } from "../../services/chat-channels.js";
import { ChatSdkRuntime } from "../../services/chat-sdk-runtime.js";
import { secretService } from "../../services/secrets.js";
import { instanceSettingsService } from "../../services/instance-settings.js";
import { chatChannelRoutes } from "../../routes/chat-channels.js";
import { errorHandler } from "../../middleware/index.js";
import { createLocalDiskStorageProvider } from "../../storage/local-disk-provider.js";
import { createStorageService } from "../../storage/service.js";
import { FAKE_OPENWA_ADMIN_KEY, FAKE_OPENWA_KEY, FakeOpenwaGateway } from "./fake-gateway.js";

const SESSION_ID = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const NEW_SESSION_ID = "88888888-9999-4aaa-8bbb-cccccccccccc";
const OWN_PHONE = "628111000888";

describe("OpenWA gateway administration from the board (embedded Postgres + fake gateway)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let root: string;
  const oldKey = process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
  const services: ChatChannelService[] = [];
  const gateways: FakeOpenwaGateway[] = [];
  const endpointIds: string[] = [];

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-openwa-gateway-admin-");
    db = createDb(database.connectionString);
    root = await mkdtemp(path.join(tmpdir(), "openwa-gateway-admin-"));
    process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = path.join(root, "master.key");
    await instanceSettingsService(db).updateExperimental({ enableChatConnectors: true });
  }, 60_000);
  afterEach(async () => {
    await Promise.all(services.splice(0).map((service) => service.shutdown()));
    await Promise.all(gateways.splice(0).map((gateway) => gateway.close()));
    for (const id of endpointIds.splice(0)) await db.update(chatEndpoints).set({ status: "archived" }).where(eq(chatEndpoints.id, id));
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await database?.cleanup();
    if (root) await rm(root, { recursive: true, force: true });
    if (oldKey === undefined) delete process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
    else process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = oldKey;
  });

  async function setup(input: { adminKey?: boolean } = {}) {
    const gateway = new FakeOpenwaGateway({ sessionId: SESSION_ID, ownPhone: OWN_PHONE });
    await gateway.start();
    gateways.push(gateway);
    const companyId = randomUUID();
    const agentId = randomUUID();
    const userId = randomUUID();
    const memberId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "OpenWA gateway admin",
      issuePrefix: "G" + companyId.replaceAll("-", "").slice(0, 7).toUpperCase(),
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "OpenWA Agent",
      role: "engineer",
      status: "idle",
      adapterType: "paperclip_runner",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    for (const id of [userId, memberId])
      await db.insert(authUsers).values({ id, name: "Board", email: id + "@example.com", emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values([
      { companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "owner" },
      { companyId, principalType: "user", principalId: memberId, status: "active", membershipRole: "member" },
    ]);
    const service = chatChannelService(db, {
      runtime: new ChatSdkRuntime(),
      publicBaseUrl: "https://paperclip.example",
      heartbeat: { wakeup: vi.fn(async () => ({ accepted: true })) } as never,
      scheduleDeferredWork: () => {},
      discordGatewayLeaseWaitMs: 200,
      openwaBurstWindowMs: 0,
      storage: createStorageService(createLocalDiskStorageProvider(path.join(root, "storage"))),
    });
    services.push(service);
    const endpoint = await service.create(companyId, { provider: "openwa", assignedAgentId: agentId } as never, userId);
    endpointIds.push(endpoint.id);
    const [row] = await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, endpoint.id));
    const keys: Array<[string, string]> = [["apiKey", FAKE_OPENWA_KEY], ...(input.adminKey === false ? [] : ([["adminApiKey", FAKE_OPENWA_ADMIN_KEY]] as Array<[string, string]>))];
    const refs = [];
    for (const [label, value] of keys) {
      const secret = await secretService(db).create(
        companyId,
        { name: "openwa-" + label + "-" + endpoint.id.slice(0, 8), provider: "local_encrypted", managedMode: "paperclip_managed", value },
        { userId },
      );
      const ref = { secretId: secret.id, versionSelector: "latest" as const, configPath: "credentials." + label, required: label === "apiKey", label, projectionClass: "unclassified" as const };
      refs.push(ref);
      await db.insert(companySecretBindings).values({ companyId, targetType: "tool_connection", targetId: row!.connectionId, ...ref });
    }
    await db.update(toolConnections).set({ status: "active", enabled: true, credentialSecretRefs: refs }).where(eq(toolConnections.id, row!.connectionId));
    await db
      .update(chatEndpoints)
      .set({
        status: "active",
        providerAccountId: gateway.baseUrl + "#" + SESSION_ID,
        botExternalId: OWN_PHONE,
        policy: {},
        setup: { step: "complete", testStartedAt: new Date(Date.now() - 60_000).toISOString() },
      })
      .where(eq(chatEndpoints.id, endpoint.id));
    return { gateway, companyId, agentId, userId, memberId, endpointId: endpoint.id, service };
  }

  type Fixture = Awaited<ReturnType<typeof setup>>;

  function app(t: Fixture, actor: Record<string, unknown>) {
    const server = express();
    server.use(express.json());
    server.use((req, _res, next) => {
      req.actor = actor as never;
      next();
    });
    server.use("/api", chatChannelRoutes(db, { heartbeat: { wakeup: async () => undefined } as never, service: t.service }));
    server.use(errorHandler);
    return server;
  }

  function board(t: Fixture, userId = t.userId, role = "owner") {
    return app(t, {
      type: "board",
      source: "session",
      userId,
      isInstanceAdmin: false,
      companyIds: [t.companyId],
      memberships: [{ companyId: t.companyId, status: "active", membershipRole: role }],
    });
  }

  function admin(t: Fixture, server = board(t)) {
    return (body: Record<string, unknown>) => request(server).post("/api/chat-endpoints/" + t.endpointId + "/openwa/gateway-admin").send(body);
  }

  async function auditRows(t: Fixture) {
    return db.select().from(chatAuditEntries).where(and(eq(chatAuditEntries.endpointId, t.endpointId), eq(chatAuditEntries.kind, "config_changed")));
  }

  async function activityRows(t: Fixture) {
    return db.select().from(activityLog).where(and(eq(activityLog.entityId, t.endpointId), eq(activityLog.action, "openwa.gateway_admin_called")));
  }

  it("creates a session, shows its QR and pairing code once, and audits the change without the secrets", async () => {
    const t = await setup();
    const qr = "data:image/png;base64,QR-" + randomUUID();
    const pairing = "PAIR-" + randomUUID().slice(0, 4);
    t.gateway.overrides.push(
      { method: "POST", path: "/api/sessions", status: 201, body: { id: NEW_SESSION_ID, name: "sales", status: "created" } },
      { method: "GET", path: "/api/sessions/" + NEW_SESSION_ID + "/qr", status: 200, body: { qrCode: qr, status: "qr_ready" } },
      { method: "POST", path: "/api/sessions/" + NEW_SESSION_ID + "/pairing-code", status: 201, body: { pairingCode: pairing } },
    );
    const call = admin(t);

    const created = await call({ operationId: "SessionController_create", args: { name: "sales" } });
    expect(created.status).toBe(200);
    expect(created.headers["cache-control"]).toBe("no-store");
    expect(created.body).toEqual({ operationId: "SessionController_create", sessionId: null, data: { id: NEW_SESSION_ID, name: "sales", status: "created" }, revealed: false });

    const shown = await call({ operationId: "SessionController_getQRCode", sessionId: NEW_SESSION_ID });
    expect(shown.body).toMatchObject({ revealed: true, sessionId: NEW_SESSION_ID, data: { qrCode: qr } });
    const code = await call({ operationId: "SessionController_requestPairingCode", sessionId: NEW_SESSION_ID, args: { phoneNumber: "628123456789" } });
    expect(code.body).toMatchObject({ revealed: true, data: { pairingCode: pairing } });
    expect(t.gateway.requests.filter((entry) => entry.path.startsWith("/api/sessions/" + NEW_SESSION_ID)).every((entry) => entry.key === "admin")).toBe(true);

    const audits = await auditRows(t);
    expect(audits.map((row) => row.metadata.operation).sort()).toEqual(["SessionController_create", "SessionController_requestPairingCode"]);
    const create = audits.find((row) => row.metadata.operation === "SessionController_create")!;
    expect(create).toMatchObject({ actorKind: "user", actorRef: t.userId, metadata: { outcome: "ok", source: "board_gateway_admin" } });
    expect(create.content).toMatchObject({ args: { name: "sales" }, before: null, after: { id: NEW_SESSION_ID, name: "sales" } });
    expect(audits.find((row) => row.metadata.operation === "SessionController_requestPairingCode")!.content).toMatchObject({ after: { revealedOnce: true } });
    expect(JSON.stringify(audits)).not.toContain(qr);
    expect(JSON.stringify(audits)).not.toContain(pairing);
    expect(JSON.stringify(await activityRows(t))).not.toContain(pairing);
    expect((await activityRows(t)).map((row) => row.actorId).sort()).toEqual([t.userId, t.userId]);
  });

  it("needs an explicit confirmation before stopping the agent's own session and records before and after", async () => {
    const t = await setup();
    t.gateway.overrides.push({ method: "POST", path: "/api/sessions/" + SESSION_ID + "/stop", status: 200, body: { id: SESSION_ID, status: "stopped" } });
    const call = admin(t);

    const refused = await call({ operationId: "SessionController_stop", sessionId: SESSION_ID });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ details: { code: "openwa_own_session_confirmation_required" } });
    expect(t.gateway.requests.filter((entry) => entry.method === "POST" && entry.path.endsWith("/stop"))).toEqual([]);
    expect(await auditRows(t)).toEqual([]);

    const stopped = await call({ operationId: "SessionController_stop", sessionId: SESSION_ID, confirmOwnSession: true });
    expect(stopped.status).toBe(200);
    expect(t.gateway.requests.filter((entry) => entry.method === "POST" && entry.path.endsWith("/stop"))).toHaveLength(1);
    const [audit] = await auditRows(t);
    expect(audit!.content).toMatchObject({ before: { id: SESSION_ID, status: "ready" }, after: { id: SESSION_ID } });

    const other = await call({ operationId: "SessionController_start", sessionId: SESSION_ID });
    expect(other.status).not.toBe(409);
  });

  it("returns a new API key once and masks keys in every later read and in the audit", async () => {
    const t = await setup();
    const call = admin(t);
    const created = await call({ operationId: "AuthController_create", args: { name: "ops", role: "operator", allowedSessions: [SESSION_ID] } });
    expect(created.status).toBe(200);
    const key = String(created.body.data.apiKey);
    expect(key).toMatch(/^owa_k1_/);
    expect(created.body.revealed).toBe(true);
    t.gateway.overrides.push({ method: "GET", path: "/api/auth/api-keys", status: 200, body: [{ id: created.body.data.id, name: "ops", apiKey: key }] });
    const listed = await call({ operationId: "AuthController_findAll" });
    expect(listed.body).toMatchObject({ revealed: false, data: [{ id: created.body.data.id, name: "ops", apiKey: "[REDACTED]" }] });
    expect(JSON.stringify(listed.body)).not.toContain(key);
    expect(JSON.stringify(await auditRows(t))).not.toContain(key);
    expect(JSON.stringify(await activityRows(t))).not.toContain(key);
  });

  it("records a failed mutation with its error and the snapshot taken before it", async () => {
    const t = await setup();
    t.gateway.overrides.push({ method: "DELETE", path: "/api/sessions/" + NEW_SESSION_ID, status: 404, body: { message: "Session not found" } });
    const removed = await admin(t)({ operationId: "SessionController_delete", sessionId: NEW_SESSION_ID });
    expect(removed.status).toBe(404);
    const [audit] = await auditRows(t);
    expect(audit).toMatchObject({ metadata: { outcome: "failed", errorCode: "not_found", operation: "SessionController_delete" } });
  });

  it("admits only connection managers on the board and only allowlisted gateway operations", async () => {
    const t = await setup();
    const body = { operationId: "SessionController_findAll" };
    expect((await admin(t)(body)).status).toBe(200);
    expect((await admin(t, board(t, t.memberId, "member"))(body)).status).toBe(403);
    const agent = app(t, { type: "agent", agentId: t.agentId, companyId: t.companyId, source: "agent_key" });
    expect((await admin(t, agent)(body)).status).toBe(403);
    const send = await admin(t)({ operationId: "MessageController_sendText", sessionId: SESSION_ID, args: { chatId: "x@c.us", text: "hi" } });
    expect(send.status).toBe(400);
    expect(t.gateway.requests.filter((entry) => entry.path.includes("send-text"))).toEqual([]);
  });

  it("refuses dot-segment path values so an allowlisted operation cannot reach another gateway path", async () => {
    const t = await setup();
    const call = admin(t);
    const before = t.gateway.requests.length;
    const parent = await call({ operationId: "WebhookController_delete", sessionId: SESSION_ID, args: { id: ".." } });
    expect(parent.status).toBe(400);
    const session = await call({ operationId: "SessionController_delete", sessionId: "..", confirmOwnSession: true });
    expect(session.status).toBe(400);
    expect(t.gateway.requests.slice(before).filter((entry) => entry.method === "DELETE")).toEqual([]);
  });

  it("refuses without the admin key instead of falling back to the operator key", async () => {
    const t = await setup({ adminKey: false });
    const response = await admin(t)({ operationId: "SessionController_findAll" });
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ details: { code: "openwa_admin_key_required" } });
    expect(t.gateway.requests).toEqual([]);
  });
  it("lets the setup wizard create and link a first session with the admin key it was given, before the channel is saved", async () => {
    const t = await setup({ adminKey: false });
    await db.update(chatEndpoints).set({ status: "draft", providerAccountId: null, botExternalId: null }).where(eq(chatEndpoints.id, t.endpointId));
    const qr = "data:image/png;base64,QR-" + randomUUID();
    t.gateway.overrides.push(
      { method: "POST", path: "/api/sessions", status: 201, body: { id: NEW_SESSION_ID, name: "pmo", status: "created" } },
      { method: "POST", path: "/api/sessions/" + NEW_SESSION_ID + "/start", status: 200, body: { id: NEW_SESSION_ID, status: "initializing" } },
      { method: "GET", path: "/api/sessions/" + NEW_SESSION_ID + "/qr", status: 200, body: { qrCode: qr, status: "qr_ready" } },
    );
    const call = admin(t);
    const connection = { baseUrl: t.gateway.baseUrl + "\u2060", adminApiKey: FAKE_OPENWA_ADMIN_KEY + "\u200b" };

    expect((await call({ operationId: "SessionController_findAll" })).body).toMatchObject({ details: { code: "openwa_session_required" } });
    const listed = await call({ operationId: "SessionController_findAll", connection });
    expect(listed.status).toBe(200);
    const created = await call({ operationId: "SessionController_create", args: { name: "pmo" }, connection });
    expect(created.status).toBe(200);
    expect((await call({ operationId: "SessionController_start", sessionId: NEW_SESSION_ID, connection })).status).toBe(200);
    const shown = await call({ operationId: "SessionController_getQRCode", sessionId: NEW_SESSION_ID, connection });
    expect(shown.body).toMatchObject({ revealed: true, data: { qrCode: qr } });
    expect(t.gateway.requests.slice(-4).every((entry) => entry.key === "admin")).toBe(true);

    const before = t.gateway.requests.length;
    const removed = await call({ operationId: "SessionController_delete", sessionId: NEW_SESSION_ID, connection });
    expect(removed.status).toBe(400);
    expect(removed.body).toMatchObject({ details: { code: "openwa_setup_connection_operation" } });
    const keys = await call({ operationId: "AuthController_create", args: { name: "x", role: "admin" }, connection });
    expect(keys.status).toBe(400);
    expect(t.gateway.requests.length).toBe(before);
    const audits = JSON.stringify(await auditRows(t));
    expect(audits).not.toContain(FAKE_OPENWA_ADMIN_KEY);
    expect(audits).not.toContain(qr);
  });

  it("refuses a setup connection that points a saved channel at another gateway, and keeps agents out", async () => {
    const t = await setup();
    const connection = { baseUrl: "http://127.0.0.1:1", adminApiKey: FAKE_OPENWA_ADMIN_KEY };
    const before = t.gateway.requests.length;
    const moved = await admin(t)({ operationId: "SessionController_findAll", connection });
    expect(moved.status).toBe(409);
    const agent = app(t, { type: "agent", agentId: t.agentId, companyId: t.companyId, source: "agent_key" });
    const fromAgent = await admin(t, agent)({ operationId: "SessionController_findAll", connection: { baseUrl: t.gateway.baseUrl, adminApiKey: FAKE_OPENWA_ADMIN_KEY } });
    expect(fromAgent.status).toBe(403);
    expect(t.gateway.requests.length).toBe(before);
  });
});
