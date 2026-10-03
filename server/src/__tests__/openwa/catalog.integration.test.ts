import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  agents,
  authUsers,
  chatActions,
  chatAuditEntries,
  chatConversations,
  chatEndpointResources,
  chatEndpoints,
  companies,
  companyMemberships,
  companySecretBindings,
  createDb,
  heartbeatRuns,
  issueThreadInteractions,
  issues,
  toolConnections,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import { openwaTool, type OpenwaTriggerClass } from "@tickernelz/paperclip-pro-shared";
import { OPENWA_OPERATIONS, type OpenwaJsonSchema, type OpenwaOperation } from "@tickernelz/paperclip-pro-shared/openwa-operations";
import { startEmbeddedPostgresTestDatabase } from "../helpers/embedded-postgres.js";
import { createLocalDiskStorageProvider } from "../../storage/local-disk-provider.js";
import { createStorageService } from "../../storage/service.js";
import { chatChannelService, type ChatChannelService } from "../../services/chat-channels.js";
import { ChatSdkRuntime } from "../../services/chat-sdk-runtime.js";
import { secretService } from "../../services/secrets.js";
import { instanceSettingsService } from "../../services/instance-settings.js";
import { openwaThreadId } from "../../services/openwa/adapter.js";
import { openwaChatKey } from "../../services/openwa/outbound.js";
import { OPENWA_REDACTED, redactOpenwaSecrets } from "../../services/openwa/redact.js";
import { executeOpenwaTool, OpenwaToolError } from "../../services/openwa/tools.js";
import { FAKE_OPENWA_ADMIN_KEY, FAKE_OPENWA_KEY, FakeOpenwaGateway } from "./fake-gateway.js";

const SESSION_ID = "44444444-5555-4666-8777-888888888888";
const OWN_PHONE = "628111000666";
const MEMBER = "628222000444@c.us";
const OTHER = "628444000333@c.us";
const SELF_SESSION = new Set(["SessionController_logout", "SessionController_stop", "SessionController_delete", "SessionController_forceKill"]);
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
const SECRET_ISSUING = [
  "AuthController_create",
  "IntegrationInstanceController_create",
  "IntegrationInstanceController_regenerate",
  "SessionController_requestPairingCode",
  "SessionController_getQRCode",
];

async function rejection(promise: Promise<unknown>): Promise<OpenwaToolError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OpenwaToolError) return error;
    throw error;
  }
  throw new Error("expected an OpenWA tool error");
}

function minimal(schema: OpenwaJsonSchema | undefined, name: string, chatId: string): unknown {
  if (!schema) return "x";
  if (schema.allOf) {
    const { allOf, ...rest } = schema;
    return Object.assign(minimal({ type: "object", ...rest }, name, chatId) as object, ...allOf.map((part) => minimal(part, name, chatId) as object));
  }
  if (schema.oneOf) return minimal(schema.oneOf[0], name, chatId);
  if (schema.anyOf) return minimal(schema.anyOf[0], name, chatId);
  if (schema.enum) return schema.enum[0];
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === "object" || schema.properties) {
    const out: Record<string, unknown> = {};
    for (const key of schema.required ?? []) out[key] = minimal(schema.properties?.[key], key, chatId);
    return out;
  }
  if (type === "array") return Array.from({ length: Math.max(1, schema.minItems ?? 0) }, () => minimal(schema.items, name, chatId));
  if (type === "number" || type === "integer") return schema.minimum ?? 1;
  if (type === "boolean") return false;
  if (/^(chatId|toChatId|fromChatId)$/.test(name)) return chatId;
  return "x".repeat(Math.max(1, schema.minLength ?? 1));
}

function argsFor(operation: OpenwaOperation, chatId: string): Record<string, unknown> {
  return minimal(operation.args, "", chatId) as Record<string, unknown>;
}

function renderedPath(operation: OpenwaOperation, args: Record<string, unknown>): string {
  let out = operation.path.replace("{sessionId}", SESSION_ID);
  for (const name of operation.pathParams) out = out.replace("{" + name + "}", encodeURIComponent(String(args[name])));
  return out;
}

interface Config {
  level: "off" | "read" | "full";
  adminKey: boolean;
  runClass: OpenwaTriggerClass;
}

function expectedOutcome(operation: OpenwaOperation, config: Config): string {
  if (SECRET_ISSUING.includes(operation.id)) return "secret_issuing_operation";
  const listsAll = operation.id === "SessionController_findAll" && config.level === "full" && config.adminKey;
  const category = listsAll ? "gateway_admin" : operation.category;
  if (category === "gateway_admin" && (config.level === "off" || (config.level === "read" && !SAFE.has(operation.method)))) return "gateway_admin_disabled";
  if (!operation.engines.includes("whatsapp-web.js")) return "unavailable_on_engine";
  if (operation.auth === "api_key" && !config.adminKey && (operation.requiresUnscopedKey || operation.requiredRole === "admin")) return "unavailable_without_admin_key";
  const owner = config.runClass === "owner";
  if (SELF_SESSION.has(operation.id)) return owner ? "self_session_requires_confirmation" : "owner_only";
  if (owner || category === "read") return "dispatch";
  if (category === "write" && operation.targetChatArg) return "dispatch";
  return "approval_required";
}

describe.sequential("OpenWA catalog, describe and call (embedded Postgres + fake gateway)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let root: string;
  let storage: ReturnType<typeof createStorageService>;
  const oldKey = process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
  const services: ChatChannelService[] = [];
  const gateways: FakeOpenwaGateway[] = [];
  const endpointIds: string[] = [];

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-openwa-catalog-");
    db = createDb(database.connectionString);
    root = await mkdtemp(path.join(tmpdir(), "openwa-catalog-"));
    process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = path.join(root, "master.key");
    storage = createStorageService(createLocalDiskStorageProvider(path.join(root, "storage")));
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

  async function setup(input: { policy?: Record<string, unknown>; adminKey?: boolean } = {}) {
    const gateway = new FakeOpenwaGateway({ sessionId: SESSION_ID, ownPhone: OWN_PHONE });
    gateway.generic = true;
    await gateway.start();
    gateways.push(gateway);
    const companyId = randomUUID();
    const agentId = randomUUID();
    const userId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "OpenWA catalog",
      issuePrefix: "C" + companyId.replaceAll("-", "").slice(0, 7).toUpperCase(),
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
    await db.insert(authUsers).values({ id: userId, name: "Operator", email: userId + "@example.com", emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "owner" });
    const service = chatChannelService(db, {
      runtime: new ChatSdkRuntime(),
      publicBaseUrl: "https://paperclip.example",
      heartbeat: { wakeup: vi.fn(async () => ({ accepted: true })) } as never,
      storage,
      scheduleDeferredWork: () => {},
      discordGatewayLeaseWaitMs: 200,
    });
    services.push(service);
    const endpoint = await service.create(companyId, { provider: "openwa", assignedAgentId: agentId } as never, userId);
    endpointIds.push(endpoint.id);
    const [row] = await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, endpoint.id));
    const keys: Array<[string, string]> = [["apiKey", FAKE_OPENWA_KEY], ...(input.adminKey ? ([["adminApiKey", FAKE_OPENWA_ADMIN_KEY]] as Array<[string, string]>) : [])];
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
        policy: input.policy ?? {},
        setup: { step: "complete", testStartedAt: new Date(Date.now() - 60_000).toISOString() },
      })
      .where(eq(chatEndpoints.id, endpoint.id));
    expect((await service.reconcileProviderRuntimes()).local).toBe(1);
    await gateway.waitForSubscription();
    return { gateway, companyId, agentId, userId, endpointId: endpoint.id };
  }

  type Fixture = Awaited<ReturnType<typeof setup>>;

  async function conversation(t: Fixture, chatId: string) {
    const threadId = openwaThreadId({ sessionId: SESSION_ID, chatId, isGroup: false });
    const [issue] = await db.insert(issues).values({ companyId: t.companyId, title: "WhatsApp " + chatId, status: "todo", assigneeAgentId: t.agentId }).returning();
    const [resource] = await db
      .insert(chatEndpointResources)
      .values({
        companyId: t.companyId,
        endpointId: t.endpointId,
        type: "direct_message",
        providerResourceId: threadId,
        label: chatId,
        availability: "available",
        enabled: true,
        settings: {},
        metadata: { chatKey: openwaChatKey(chatId) },
      })
      .returning();
    const [row] = await db
      .insert(chatConversations)
      .values({
        companyId: t.companyId,
        endpointId: t.endpointId,
        resourceId: resource!.id,
        issueId: issue!.id,
        externalConversationId: threadId,
        externalThreadId: threadId,
        externalLabel: chatId,
        isDirectMessage: true,
      })
      .returning();
    return { ...row!, chatId };
  }

  type Conversation = Awaited<ReturnType<typeof conversation>>;

  async function run(t: Fixture, c: Conversation, triggerClass: OpenwaTriggerClass) {
    const runId = randomUUID();
    const profile = triggerClass === "owner" ? "full" : "read_only";
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId: t.companyId,
      agentId: t.agentId,
      status: "running",
      startedAt: new Date(Date.now() - 30_000),
      contextSnapshot: {
        source: "chat:openwa",
        issueId: c.issueId,
        paperclipToolProfile: profile,
        openwa: { event: "message", triggerClass, deliveryIds: [] },
        paperclipOpenwa: {
          endpointId: t.endpointId,
          chatKey: openwaChatKey(c.chatId),
          triggerClass,
          profile,
          grantIds: [],
          requesterPrincipalId: null,
          approvalRequestId: null,
        },
      },
    });
    return { companyId: t.companyId, agentId: t.agentId, runId, issueId: c.issueId };
  }

  type Binding = Awaited<ReturnType<typeof run>>;

  const call = (binding: Binding, input: Record<string, unknown>) => executeOpenwaTool(db, binding, "openwa_call", input);
  const forwarded = (t: Fixture, method: string, route: string) =>
    t.gateway.requests.filter((request) => request.method === method && request.path === route).length;

  async function sweep(t: Fixture, binding: Binding, c: Conversation, config: Config) {
    const outcomes: Array<{ id: string; expected: string; actual: string; forwarded: number }> = [];
    for (const operation of OPENWA_OPERATIONS) {
      const args = argsFor(operation, c.chatId);
      expect(openwaTool("openwa_call")!.schema.safeParse({ operation: operation.id, args, idempotencyKey: randomUUID() }).success).toBe(true);
      const route = renderedPath(operation, args);
      const before = forwarded(t, operation.method, route);
      let actual = "dispatch";
      try {
        await call(binding, { operation: operation.id, args, ...(SAFE.has(operation.method) && operation.category === "read" ? {} : { idempotencyKey: randomUUID() }) });
      } catch (error) {
        actual = error instanceof OpenwaToolError ? error.code : "untyped:" + String(error);
      }
      outcomes.push({ id: operation.id, expected: expectedOutcome(operation, config), actual, forwarded: forwarded(t, operation.method, route) - before });
    }
    return outcomes;
  }

  it("dispatches every manifest operation with schema-valid minimal args or refuses it with a typed reason (owner, full, admin key)", async () => {
    const t = await setup({ policy: { gatewayAdminTools: "full" }, adminKey: true });
    const c = await conversation(t, MEMBER);
    const binding = await run(t, c, "owner");
    const outcomes = await sweep(t, binding, c, { level: "full", adminKey: true, runClass: "owner" });
    expect(outcomes).toHaveLength(202);
    expect(outcomes.filter((entry) => entry.actual !== entry.expected)).toEqual([]);
    expect(outcomes.filter((entry) => (entry.actual === "dispatch") !== (entry.forwarded === 1))).toEqual([]);
    const counts = outcomes.reduce<Record<string, number>>((acc, entry) => ({ ...acc, [entry.actual]: (acc[entry.actual] ?? 0) + 1 }), {});
    expect(counts).toEqual({ dispatch: 180, unavailable_on_engine: 13, self_session_requires_confirmation: 4, secret_issuing_operation: 5 });
    const audited = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(chatAuditEntries)
      .where(and(eq(chatAuditEntries.endpointId, t.endpointId), eq(chatAuditEntries.kind, "tool_called"), sql`${chatAuditEntries.metadata}->>'tool' = 'openwa_call'`));
    expect(audited[0]!.count).toBe(202);
    const receipts = await db.select({ count: sql<number>`count(*)::int` }).from(chatActions).where(and(eq(chatActions.endpointId, t.endpointId), eq(chatActions.kind, "openwa_tool_write"), eq(chatActions.status, "processed")));
    expect(receipts[0]!.count).toBe(outcomes.filter((entry) => entry.actual === "dispatch" && !OPENWA_OPERATIONS.find((op) => op.id === entry.id && (op.category === "read" || SAFE.has(op.method)))).length);
    expect(t.gateway.requests.filter((request) => request.path.startsWith("/api/auth/api-keys")).every((request) => request.key === "admin")).toBe(true);
  }, 120_000);

  it("refuses with typed reasons for an other-class run at read level without an admin key", async () => {
    const t = await setup({ policy: { gatewayAdminTools: "read" } });
    const c = await conversation(t, MEMBER);
    const binding = await run(t, c, "other");
    const outcomes = await sweep(t, binding, c, { level: "read", adminKey: false, runClass: "other" });
    expect(outcomes.filter((entry) => entry.actual !== entry.expected)).toEqual([]);
    expect(outcomes.filter((entry) => (entry.actual === "dispatch") !== (entry.forwarded === 1))).toEqual([]);
    expect(new Set(outcomes.map((entry) => entry.actual))).toEqual(
      new Set(["dispatch", "approval_required", "gateway_admin_disabled", "unavailable_on_engine", "unavailable_without_admin_key", "secret_issuing_operation"]),
    );
  }, 120_000);

  async function catalogAll(binding: Binding, input: Record<string, unknown> = {}) {
    const operations: Array<Record<string, unknown>> = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await executeOpenwaTool(db, binding, "openwa_catalog", { ...input, ...(cursor ? { cursor } : {}) });
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(16_384);
      operations.push(...(page.operations as Array<Record<string, unknown>>));
      cursor = page.nextCursor as string | null;
      pages++;
    } while (cursor && pages < 20);
    return operations;
  }

  it("AC12: catalogs 202 operations with category and availability; hides gateway admin at off", async () => {
    const t = await setup({ policy: { gatewayAdminTools: "full" }, adminKey: true });
    const c = await conversation(t, MEMBER);
    const owner = await run(t, c, "owner");
    const all = await catalogAll(owner);
    const gateway = all.filter((entry) => entry.category !== "paperclip");
    expect(gateway).toHaveLength(202);
    expect(gateway.every((entry) => typeof entry.available === "boolean" && typeof entry.category === "string")).toBe(true);
    expect(gateway.filter((entry) => entry.reason === "unavailable_on_engine")).toHaveLength(13);
    expect(all.find((entry) => entry.operation === "paperclip.audit.list")).toMatchObject({ category: "paperclip", gate: "owner_only" });
    expect(all.find((entry) => entry.operation === "SessionController_findAll")).toMatchObject({ category: "gateway_admin", instanceGlobal: true });
    expect(all.find((entry) => entry.operation === "SessionController_logout")).toMatchObject({ gate: "owner_confirmation" });
    const described = await executeOpenwaTool(db, owner, "openwa_describe", { operation: "MessageController_sendText" });
    expect(described).toMatchObject({ category: "write", gate: "reply_or_cross_chat_send", requiresIdempotencyKey: true, args: { required: ["chatId", "text"] } });

    await db.update(chatEndpoints).set({ policy: { gatewayAdminTools: "off" } }).where(eq(chatEndpoints.id, t.endpointId));
    const hidden = await catalogAll(owner);
    expect(hidden.some((entry) => entry.category === "gateway_admin")).toBe(false);
    expect(hidden.filter((entry) => entry.category !== "paperclip")).toHaveLength(202 - OPENWA_OPERATIONS.filter((op) => op.category === "gateway_admin").length);
    expect((await rejection(executeOpenwaTool(db, owner, "openwa_describe", { operation: "PluginsController_findAll" }))).code).toBe("gateway_admin_disabled");
    const before = t.gateway.requests.length;
    expect((await rejection(call(owner, { operation: "PluginsController_findAll" }))).code).toBe("gateway_admin_disabled");
    expect(t.gateway.requests.length).toBe(before);

    await db.update(chatEndpoints).set({ policy: { gatewayAdminTools: "read" } }).where(eq(chatEndpoints.id, t.endpointId));
    const readLevel = await catalogAll(owner, { category: "gateway_admin" });
    expect(readLevel.length).toBeGreaterThan(0);
    expect(readLevel.every((entry) => SAFE.has(OPENWA_OPERATIONS.find((op) => op.id === entry.operation)!.method))).toBe(true);
  });

  it("AC12: at full with an admin key an owner run lists every session; an other run needs gateway_admin approval", async () => {
    const t = await setup({ policy: { gatewayAdminTools: "full" }, adminKey: true });
    t.gateway.overrides.push({ method: "GET", path: "/api/sessions", status: 200, body: [{ id: SESSION_ID, name: "ours" }, { id: randomUUID(), name: "another" }] });
    const c = await conversation(t, MEMBER);
    const owner = await run(t, c, "owner");
    const listed = await call(owner, { operation: "SessionController_findAll" });
    expect((listed.result as unknown[]).length).toBe(2);
    expect(t.gateway.requests.filter((request) => request.path === "/api/sessions").map((request) => request.key)).toEqual(["admin"]);
    const other = await run(t, c, "other");
    const denied = await rejection(call(other, { operation: "SessionController_findAll" }));
    expect(denied.code).toBe("approval_required");
    expect(denied.details).toMatchObject({ category: "gateway_admin" });
    expect(t.gateway.requests.filter((request) => request.path === "/api/sessions")).toHaveLength(1);
  });

  it("lists only the endpoint's own session with the operator key below full or without an admin key", async () => {
    const plain = await setup({ policy: { gatewayAdminTools: "read" } });
    plain.gateway.overrides.push({ method: "GET", path: "/api/sessions", status: 200, body: [{ id: SESSION_ID }, { id: randomUUID() }] });
    const pc = await conversation(plain, MEMBER);
    const own = await call(await run(plain, pc, "other"), { operation: "SessionController_findAll" });
    expect(own.result).toEqual([{ id: SESSION_ID }]);
    expect(plain.gateway.requests.filter((request) => request.path === "/api/sessions").map((request) => request.key)).toEqual(["operator"]);
    expect((await rejection(call(await run(plain, pc, "owner"), { operation: "PluginsController_findAll" }))).code).toBe("unavailable_without_admin_key");
  });

  it("AC12: never sends an engine-unavailable operation and learns a 501 without retrying it", async () => {
    const t = await setup();
    const c = await conversation(t, MEMBER);
    const owner = await run(t, c, "owner");
    const before = t.gateway.requests.length;
    const statik = await rejection(call(owner, { operation: "GroupController_create", args: { name: "x", participants: ["628333000111@c.us"] }, idempotencyKey: randomUUID() }));
    expect(statik.code).toBe("unavailable_on_engine");
    expect(t.gateway.requests.slice(before).filter((request) => request.path !== "/api/auth/validate")).toEqual([]);

    const route = "/api/sessions/" + SESSION_ID + "/groups/" + encodeURIComponent("g1@g.us") + "/settings";
    t.gateway.overrides.push({ method: "GET", path: route, status: 501, body: { statusCode: 501, message: "Not supported on whatsapp-web.js" } });
    const first = await rejection(call(owner, { operation: "GroupController_getSettings", args: { groupId: "g1@g.us" } }));
    expect(first.code).toBe("unavailable_on_engine");
    expect(forwarded(t, "GET", route)).toBe(1);
    const second = await rejection(call(owner, { operation: "GroupController_getSettings", args: { groupId: "g1@g.us" } }));
    expect(second.code).toBe("unavailable_on_engine");
    expect(forwarded(t, "GET", route)).toBe(1);
    const listing = await executeOpenwaTool(db, owner, "openwa_catalog", { query: "GroupController_getSettings" });
    expect(listing.operations).toEqual([expect.objectContaining({ operation: "GroupController_getSettings", available: false, reason: "unavailable_on_engine" })]);
  });

  it("AC12: pacing 429 returns retry_after with seconds and audits the pacing flag", async () => {
    const t = await setup();
    const c = await conversation(t, MEMBER);
    const owner = await run(t, c, "owner");
    t.gateway.overrides.push({
      method: "POST",
      path: "/api/sessions/" + SESSION_ID + "/messages/send-text",
      status: 429,
      body: { code: "SEND_PACING_LIMITED", retryAfterSeconds: 9, message: "paced" },
    });
    const paced = await rejection(call(owner, { operation: "MessageController_sendText", args: { chatId: MEMBER, text: "slow" }, idempotencyKey: randomUUID() }));
    expect(paced.code).toBe("retry_after");
    expect(paced.details).toMatchObject({ retryAfterSeconds: 9, pacing: true });
    const [audit] = await db.select().from(chatAuditEntries).where(and(eq(chatAuditEntries.endpointId, t.endpointId), eq(chatAuditEntries.kind, "tool_called")));
    expect(audit!.metadata).toMatchObject({ tool: "openwa_call", operation: "MessageController_sendText", errorCode: "retry_after", pacing: true });
  });

  it("gates write operations to another chat as cross_chat_send and keeps origin writes on reply semantics with receipts", async () => {
    const t = await setup();
    const c = await conversation(t, MEMBER);
    const other = await run(t, c, "other");
    const sendRoute = "/api/sessions/" + SESSION_ID + "/messages/send-text";
    const cross = await rejection(call(other, { operation: "MessageController_sendText", args: { chatId: "openwa:" + SESSION_ID + ":" + OTHER, text: "psst" }, idempotencyKey: randomUUID() }));
    expect(cross.code).toBe("approval_required");
    expect(cross.details).toMatchObject({ category: "cross_chat_send" });
    const forward = await rejection(call(other, { operation: "MessageController_forward", args: { fromChatId: MEMBER, toChatId: OTHER, messageId: "m1" }, idempotencyKey: randomUUID() }));
    expect(forward.details).toMatchObject({ category: "cross_chat_send" });
    const bulk = await rejection(call(other, { operation: "MessageController_sendBulk", args: { messages: [{ chatId: MEMBER, type: "text", content: { text: "a" } }, { chatId: OTHER, type: "text", content: { text: "b" } }] }, idempotencyKey: randomUUID() }));
    expect(bulk.details).toMatchObject({ category: "cross_chat_send" });
    expect(forwarded(t, "POST", sendRoute)).toBe(0);
    const key = randomUUID();
    const sent = await call(other, { operation: "MessageController_sendText", args: { chatId: MEMBER, text: "origin" }, idempotencyKey: key });
    expect(sent).toMatchObject({ state: "delivered", messageIds: [expect.any(String)] });
    const replay = await call(other, { operation: "MessageController_sendText", args: { chatId: MEMBER, text: "origin" }, idempotencyKey: key });
    expect(replay).toMatchObject({ actionId: sent.actionId, replayed: true });
    expect(forwarded(t, "POST", sendRoute)).toBe(1);
    const conflict = await rejection(call(other, { operation: "MessageController_sendText", args: { chatId: MEMBER, text: "changed" }, idempotencyKey: key }));
    expect(conflict.code).toBe("idempotency_conflict");
    await expect(call(other, { operation: "MessageController_react", args: { chatId: MEMBER, messageId: "m1", emoji: "x" }, idempotencyKey: randomUUID() })).resolves.toMatchObject({ state: "delivered" });
    const admin = await rejection(call(other, { operation: "MessageController_pinMessage", args: { chatId: MEMBER, messageId: "m1" }, idempotencyKey: randomUUID() }));
    expect(admin.details).toMatchObject({ category: "wa_admin" });
    const missingKey = await rejection(call(other, { operation: "MessageController_react", args: { chatId: MEMBER, messageId: "m1", emoji: "x" } }));
    expect(missingKey.code).toBe("invalid_arguments");
    const badArgs = await rejection(call(other, { operation: "MessageController_sendText", args: { chatId: MEMBER, text: "x", sessionId: "other" }, idempotencyKey: randomUUID() }));
    expect(badArgs.code).toBe("invalid_arguments");
  });

  it("requires an owner run plus a Paperclip confirmation before touching the endpoint's own session", async () => {
    const t = await setup({ policy: { gatewayAdminTools: "full" } });
    const c = await conversation(t, MEMBER);
    const logoutRoute = "/api/sessions/" + SESSION_ID + "/logout";
    const other = await run(t, c, "other");
    expect((await rejection(call(other, { operation: "SessionController_logout", idempotencyKey: randomUUID() }))).code).toBe("owner_only");
    const owner = await run(t, c, "owner");
    const key = randomUUID();
    const first = await rejection(call(owner, { operation: "SessionController_logout", idempotencyKey: key }));
    expect(first.code).toBe("self_session_requires_confirmation");
    const interactionId = String((first.details as Record<string, unknown>).interactionId);
    const [interaction] = await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.id, interactionId));
    expect(interaction).toMatchObject({ kind: "request_confirmation", status: "pending", issueId: c.issueId, effectiveResolverPolicy: "human_only", continuationPolicy: "none" });
    const again = await rejection(call(owner, { operation: "SessionController_logout", idempotencyKey: key }));
    expect((again.details as Record<string, unknown>).interactionId).toBe(interactionId);
    expect(forwarded(t, "POST", logoutRoute)).toBe(0);
    await db.update(issueThreadInteractions).set({ status: "accepted", resolvedAt: new Date() }).where(eq(issueThreadInteractions.id, interactionId));
    await expect(call(owner, { operation: "SessionController_logout", idempotencyKey: key })).resolves.toMatchObject({ state: "delivered" });
    expect(forwarded(t, "POST", logoutRoute)).toBe(1);
    const reused = await rejection(call(owner, { operation: "SessionController_logout", idempotencyKey: randomUUID() }));
    expect(reused.code).toBe("self_session_requires_confirmation");
    expect((reused.details as Record<string, unknown>).interactionId).not.toBe(interactionId);
    expect(forwarded(t, "POST", logoutRoute)).toBe(1);
  });

  it("serves paperclip.audit.list to owner runs only", async () => {
    const t = await setup();
    const c = await conversation(t, MEMBER);
    const owner = await run(t, c, "owner");
    await call(owner, { operation: "HealthController_check" });
    const page = await call(owner, { operation: "paperclip.audit.list", args: { kinds: ["tool_called"] } });
    expect(page.access).toBe("content");
    expect((page.items as Array<Record<string, unknown>>).length).toBeGreaterThan(0);
    expect((page.items as Array<Record<string, unknown>>)[0]).toMatchObject({ kind: "tool_called", metadata: { tool: "openwa_call" } });
    const other = await run(t, c, "other");
    expect((await rejection(call(other, { operation: "paperclip.audit.list" }))).code).toBe("owner_only");
  });

  it("filters session-query operations to the endpoint's session and caps results at 16 KB with cursors", async () => {
    const t = await setup();
    t.gateway.overrides.push({
      method: "GET",
      path: "/api/search",
      status: 200,
      body: { hits: [{ sessionId: SESSION_ID, body: "mine" }, { sessionId: randomUUID(), body: "theirs" }], total: 2 },
    });
    const contacts = Array.from({ length: 400 }, (_, index) => ({ id: "62800000" + String(index).padStart(4, "0") + "@c.us", name: "Contact ".padEnd(80, "x") + index }));
    t.gateway.overrides.push({ method: "GET", path: "/api/sessions/" + SESSION_ID + "/contacts", status: 200, body: contacts });
    const c = await conversation(t, MEMBER);
    const other = await run(t, c, "other");
    const search = await call(other, { operation: "SearchController_search", args: { q: "x" } });
    expect(search.result).toEqual({ hits: [{ sessionId: SESSION_ID, body: "mine" }] });
    expect(t.gateway.requests.find((request) => request.path === "/api/search")!.query.sessionId).toBe(SESSION_ID);
    const seen: unknown[] = [];
    let cursor: string | null = null;
    do {
      const page = await call(other, { operation: "ContactController_findAll", ...(cursor ? { cursor } : {}) });
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(16_384);
      seen.push(...(page.result as unknown[]));
      cursor = page.nextCursor as string | null;
    } while (cursor);
    expect(seen).toEqual(contacts);
  });

  it("redacts credential keys, OpenWA keys and QR data URLs in any JSON value", () => {
    const input = {
      ApiKey: "a",
      nested: [{ verifyToken: "v", order: { orderId: "o1", token: "t" } }, "owa_k1_leaked"],
      qrImage: "data:image/png;base64,AAAA",
      note: "data:image/png;base64,AAAA",
      count: 3,
      deep: { password: { any: "shape" }, clientSecret: null },
    };
    expect(redactOpenwaSecrets(input)).toEqual({
      ApiKey: OPENWA_REDACTED,
      nested: [{ verifyToken: OPENWA_REDACTED, order: { orderId: "o1", token: OPENWA_REDACTED } }, OPENWA_REDACTED],
      qrImage: OPENWA_REDACTED,
      note: "data:image/png;base64,AAAA",
      count: 3,
      deep: { password: OPENWA_REDACTED, clientSecret: OPENWA_REDACTED },
    });
    expect(input.nested[0]).toEqual({ verifyToken: "v", order: { orderId: "o1", token: "t" } });
  });

  it("refuses secret-issuing operations before any gateway call, for owner runs at full with an admin key", async () => {
    const t = await setup({ policy: { gatewayAdminTools: "full" }, adminKey: true });
    const c = await conversation(t, MEMBER);
    const owner = await run(t, c, "owner");
    const before = t.gateway.requests.length;
    const created = await rejection(call(owner, { operation: "AuthController_create", args: { name: "agent" }, idempotencyKey: randomUUID() }));
    expect(created.code).toBe("secret_issuing_operation");
    expect(created.status).toBe(403);
    const regenerated = await rejection(
      call(owner, { operation: "IntegrationInstanceController_regenerate", args: { pluginId: "p1", instanceId: "i1" }, idempotencyKey: randomUUID() }),
    );
    expect(regenerated.code).toBe("secret_issuing_operation");
    expect(t.gateway.requests.length).toBe(before);
    const [audit] = await db
      .select()
      .from(chatAuditEntries)
      .where(and(eq(chatAuditEntries.endpointId, t.endpointId), sql`${chatAuditEntries.metadata}->>'operation' = 'AuthController_create'`));
    expect(audit!.metadata).toMatchObject({ tool: "openwa_call", errorCode: "secret_issuing_operation" });

    const listed = (await catalogAll(owner)).filter((entry) => SECRET_ISSUING.includes(String(entry.operation)));
    expect(listed.map((entry) => entry.operation).sort()).toEqual([...SECRET_ISSUING].sort());
    expect(listed.every((entry) => entry.available === false && entry.reason === "secret_issuing_operation")).toBe(true);
    expect(await executeOpenwaTool(db, owner, "openwa_describe", { operation: "SessionController_getQRCode" })).toMatchObject({
      available: false,
      reason: "secret_issuing_operation",
    });
  });

  it("redacts gateway credentials in results, stored receipts, replays and audit content", async () => {
    const t = await setup({ policy: { gatewayAdminTools: "full" }, adminKey: true });
    const secret = "hmac-plaintext-" + randomUUID();
    const verifyToken = "verify-plaintext-" + randomUUID();
    const orderToken = "order-plaintext-" + randomUUID();
    const instancePath = "/api/integration/plugins/p1/instances/i1";
    const instance = { id: "i1", pluginId: "p1", enabled: true, secret, verifyToken, config: null };
    t.gateway.overrides.push({ method: "GET", path: instancePath, status: 200, body: instance });
    t.gateway.overrides.push({ method: "PATCH", path: instancePath, status: 200, body: instance });
    const historyPath = "/api/sessions/" + SESSION_ID + "/messages/" + encodeURIComponent(MEMBER) + "/history";
    t.gateway.overrides.push({ method: "GET", path: historyPath, status: 200, body: [{ id: "m1", body: "order", order: { orderId: "o1", token: orderToken } }] });
    const c = await conversation(t, MEMBER);
    const owner = await run(t, c, "owner");
    const plaintext = (value: unknown) => [secret, verifyToken, orderToken].filter((needle) => JSON.stringify(value).includes(needle));

    const read = await call(owner, { operation: "IntegrationInstanceController_getOne", args: { pluginId: "p1", instanceId: "i1" } });
    expect(read.result).toMatchObject({ id: "i1", secret: OPENWA_REDACTED, verifyToken: OPENWA_REDACTED });
    expect(plaintext(read)).toEqual([]);

    const key = randomUUID();
    const args = { pluginId: "p1", instanceId: "i1", enabled: true };
    const patched = await call(owner, { operation: "IntegrationInstanceController_patch", args, idempotencyKey: key });
    expect(patched).toMatchObject({ state: "delivered", result: { secret: OPENWA_REDACTED, verifyToken: OPENWA_REDACTED } });
    const replay = await call(owner, { operation: "IntegrationInstanceController_patch", args, idempotencyKey: key });
    expect(replay).toMatchObject({ actionId: patched.actionId, replayed: true, result: { secret: OPENWA_REDACTED, verifyToken: OPENWA_REDACTED } });
    expect(plaintext(replay)).toEqual([]);
    expect(forwarded(t, "PATCH", instancePath)).toBe(1);
    const [action] = await db.select().from(chatActions).where(eq(chatActions.id, String(patched.actionId)));
    expect(action!.status).toBe("processed");
    expect(plaintext(action)).toEqual([]);

    const other = await run(t, c, "other");
    const history = await call(other, { operation: "MessageController_getChatHistory", args: { chatId: MEMBER } });
    expect(history.result).toEqual([{ id: "m1", body: "order", order: { orderId: "o1", token: OPENWA_REDACTED } }]);

    const audits = await db.select().from(chatAuditEntries).where(eq(chatAuditEntries.endpointId, t.endpointId));
    expect(audits.filter((entry) => entry.kind === "tool_called")).toHaveLength(4);
    expect(plaintext(audits)).toEqual([]);
  });
});
