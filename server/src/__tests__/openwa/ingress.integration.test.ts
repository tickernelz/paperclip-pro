import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  agents,
  authUsers,
  chatAuditEntries,
  chatEndpointLeases,
  chatEndpoints,
  chatOutboundMessages,
  chatSdkState,
  companies,
  companyMemberships,
  companySecretBindings,
  createDb,
  toolConnections,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import { startEmbeddedPostgresTestDatabase } from "../helpers/embedded-postgres.js";
import { chatChannelService, type ChatChannelService } from "../../services/chat-channels.js";
import { ChatSdkRuntime } from "../../services/chat-sdk-runtime.js";
import { secretService } from "../../services/secrets.js";
import { createOpenwaGatewayClient, OpenwaGatewayError } from "../../services/openwa/gateway.js";
import { openwaOutboundRegistry, sendThroughRegistry } from "../../services/openwa/outbound.js";
import type { OpenwaInboundEvent } from "../../services/openwa/receiver.js";
import { FAKE_OPENWA_KEY, FakeOpenwaGateway } from "./fake-gateway.js";

const SESSION_ID = "11111111-2222-4333-8444-555555555555";
const OWN_PHONE = "628111000111";
const PEER = "628222000222@c.us";
const OWNER_CHAT = "628333000333@c.us";
const CURSOR_STATE_KEY = "openwa:" + createHash("sha256").update("openwa.ingest_cursor").digest("hex");
const QUERY_METHODS = new Set(["select", "selectDistinct", "insert", "update", "delete", "execute"]);

async function until(predicate: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function countingDb(db: Db) {
  const counts = { queries: 0, transactions: 0 };
  const proxy = new Proxy(db, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      if (typeof property === "string" && QUERY_METHODS.has(property))
        return (...args: unknown[]) => {
          counts.queries++;
          return value.apply(target, args);
        };
      if (property === "transaction")
        return (...args: unknown[]) => {
          counts.transactions++;
          return value.apply(target, args);
        };
      return value.bind(target);
    },
  });
  return { db: proxy as Db, counts };
}

describe.sequential("OpenWA ingress (embedded Postgres + fake gateway)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let secrets: string;
  const oldKey = process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
  const services: ChatChannelService[] = [];
  const gateways: FakeOpenwaGateway[] = [];
  const endpointIds: string[] = [];

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-openwa-");
    db = createDb(database.connectionString);
    secrets = await mkdtemp(path.join(tmpdir(), "openwa-secrets-"));
    process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = path.join(secrets, "master.key");
  }, 60_000);
  afterEach(async () => {
    await Promise.all(services.splice(0).map((service) => service.shutdown()));
    await Promise.all(gateways.splice(0).map((gateway) => gateway.close()));
    for (const id of endpointIds.splice(0)) await db.update(chatEndpoints).set({ status: "archived" }).where(eq(chatEndpoints.id, id));
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await database?.cleanup();
    if (secrets) await rm(secrets, { recursive: true, force: true });
    if (oldKey === undefined) delete process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
    else process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = oldKey;
  });

  async function setup(options: { leaseTtlMs?: number; renewalMs?: number } = {}) {
    const gateway = new FakeOpenwaGateway({ sessionId: SESSION_ID, ownPhone: OWN_PHONE });
    await gateway.start();
    gateways.push(gateway);
    const companyId = randomUUID();
    const agentId = randomUUID();
    const userId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "OpenWA test",
      issuePrefix: "W" + companyId.replaceAll("-", "").slice(0, 7).toUpperCase(),
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
    await db.insert(authUsers).values({
      id: userId,
      name: "Operator",
      email: userId + "@example.com",
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
    const inbound: OpenwaInboundEvent[] = [];
    const counted = countingDb(db);
    const make = () => {
      const runtime = new ChatSdkRuntime();
      const replacement = vi.spyOn(runtime, "replaceEndpoint");
      const service = chatChannelService(counted.db, {
        runtime,
        publicBaseUrl: "https://paperclip.example",
        heartbeat: { wakeup: vi.fn(async () => ({ accepted: true })) } as never,
        scheduleDeferredWork: () => {},
        discordGatewayLeaseTtlMs: options.leaseTtlMs ?? 120_000,
        discordGatewayLeaseRenewalIntervalMs: options.renewalMs ?? 60_000,
        discordGatewayLeaseWaitMs: 200,
        openwaBurstWindowMs: 0,
        openwaIngressHooks: {
          onInbound: async (event) => {
            inbound.push(event);
          },
        },
      });
      services.push(service);
      return { service, runtime, replacement };
    };
    const first = make();
    const endpoint = await first.service.create(companyId, { provider: "openwa", assignedAgentId: agentId } as never, userId);
    const secret = await secretService(db).create(
      companyId,
      { name: "openwa-key-" + endpoint.id.slice(0, 8), provider: "local_encrypted", managedMode: "paperclip_managed", value: FAKE_OPENWA_KEY },
      { userId },
    );
    endpointIds.push(endpoint.id);
    const [row] = await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, endpoint.id));
    await db
      .update(toolConnections)
      .set({
        status: "active",
        enabled: true,
        credentialSecretRefs: [
          { secretId: secret.id, versionSelector: "latest", configPath: "credentials.apiKey", required: true, label: "apiKey", projectionClass: "unclassified" },
        ],
      })
      .where(eq(toolConnections.id, row.connectionId));
    await db.insert(companySecretBindings).values({
      companyId,
      secretId: secret.id,
      targetType: "tool_connection",
      targetId: row.connectionId,
      configPath: "credentials.apiKey",
      versionSelector: "latest",
      required: true,
      label: "apiKey",
      projectionClass: "unclassified",
    });
    await db
      .update(chatEndpoints)
      .set({
        status: "active",
        providerAccountId: gateway.baseUrl + "#" + SESSION_ID,
        botExternalId: OWN_PHONE,
        setup: { step: "complete", testStartedAt: new Date(Date.now() - 60_000).toISOString() },
      })
      .where(eq(chatEndpoints.id, endpoint.id));
    return { gateway, companyId, endpointId: endpoint.id, connectionId: row.connectionId, inbound, counted, make, first };
  }

  async function goLive(t: Awaited<ReturnType<typeof setup>>, service: ChatChannelService) {
    const result = await service.reconcileProviderRuntimes();
    expect(result.local).toBe(1);
    await t.gateway.waitForSubscription();
    await until(async () => {
      const [endpoint] = await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, t.endpointId));
      return endpoint.status === "active";
    });
    return result;
  }

  async function settled(t: Awaited<ReturnType<typeof setup>>, count: number) {
    await until(() => t.inbound.length >= count);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  it("fixes openwa endpoints to the concurrent SDK policy", async () => {
    const t = await setup();
    const [row] = await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, t.endpointId));
    expect(row.concurrencyPolicy).toBe("concurrent");
    expect(row.inflightMode).toBe("steer");
  }, 60_000);

  it("delivers live and caught-up messages exactly once across a socket kill", async () => {
    const t = await setup();
    await goLive(t, t.first.service);
    for (let i = 0; i < 15; i++) t.gateway.inbound({ chatId: PEER });
    await settled(t, 15);
    t.gateway.killSocket();
    const idless = t.gateway.inbound({ chatId: PEER, emit: false, waMessageId: null });
    const missed = [idless.id];
    for (let i = 0; i < 5; i++) missed.push(t.gateway.inbound({ chatId: PEER, emit: false }).id);
    t.gateway.restartSocket();
    await until(() => t.gateway.subscriberCount === 1);
    for (let i = 0; i < 5; i++) t.gateway.inbound({ chatId: PEER });
    await settled(t, 26);
    expect(t.inbound.map((event) => Number(event.body.replace("seq:", "")))).toEqual(Array.from({ length: 26 }, (_, i) => i + 1));
    expect(new Set(t.inbound.map((event) => event.dedupeKey)).size).toBe(26);
    expect(t.inbound.find((event) => event.rowUuid === idless.id)?.dedupeKey).toBe("openwa:" + SESSION_ID + ":row:" + idless.id);
    expect(t.inbound.filter((event) => missed.includes(event.rowUuid ?? "")).map((event) => event.source)).toEqual(Array(6).fill("catch_up"));
    expect(t.inbound.slice(0, 15).every((event) => event.source === "live")).toBe(true);
    expect(t.inbound.every((event) => event.chatKind === "dm" && !event.fromMe && !event.phoneTyped)).toBe(true);
  }, 60_000);

  it("performs zero database queries while classifying non-trigger traffic", async () => {
    const t = await setup();
    await goLive(t, t.first.service);
    t.gateway.inbound({ chatId: PEER });
    await settled(t, 1);
    const cursorVersion = async () =>
      (
        await db
          .select({ version: chatSdkState.version })
          .from(chatSdkState)
          .where(and(eq(chatSdkState.endpointId, t.endpointId), eq(chatSdkState.stateKey, CURSOR_STATE_KEY)))
      )[0]?.version ?? 0;
    const versionBefore = await cursorVersion();
    t.counted.counts.queries = 0;
    t.counted.counts.transactions = 0;
    for (let i = 0; i < 100; i++) t.gateway.inbound({ chatId: i % 2 ? PEER : "120363000000000001@g.us", from: "120363000000000001@g.us", author: "628444000444@c.us" });
    await settled(t, 101);
    const cursorCommits = (await cursorVersion()) - versionBefore;
    expect(t.counted.counts.queries).toBe(0);
    expect(t.counted.counts.transactions).toBe(cursorCommits);
    expect(cursorCommits).toBeLessThanOrEqual(1);
  }, 60_000);

  it("ignores the echo of a registered send and classifies other own-number messages as phone-typed", async () => {
    const t = await setup();
    await goLive(t, t.first.service);
    const client = createOpenwaGatewayClient({ baseUrl: t.gateway.baseUrl, apiKey: FAKE_OPENWA_KEY, sessionId: SESSION_ID });
    const sent = await sendThroughRegistry({
      registry: t.first.service.openwaOutbound,
      companyId: t.companyId,
      endpointId: t.endpointId,
      chatId: OWNER_CHAT,
      source: "tool",
      body: "agent reply",
      send: () => client.sendText({ chatId: OWNER_CHAT, text: "agent reply" }),
    });
    expect(sent.record.state).toBe("sent");
    t.gateway.inbound({ chatId: OWNER_CHAT, fromMe: true, body: "typed on the phone" });
    await settled(t, 1);
    expect(t.inbound).toHaveLength(1);
    expect(t.inbound[0]).toMatchObject({ body: "typed on the phone", fromMe: true, phoneTyped: true });
    const [row] = await db.select().from(chatOutboundMessages).where(eq(chatOutboundMessages.id, sent.record.id));
    expect(row).toMatchObject({ state: "sent", providerMessageId: sent.result.messageId, source: "tool" });
  }, 60_000);

  it("reconciles a send that crashed before its 201 and never classifies it as phone-typed", async () => {
    const t = await setup();
    await goLive(t, t.first.service);
    t.gateway.killSocket();
    const client = createOpenwaGatewayClient({ baseUrl: t.gateway.baseUrl, apiKey: FAKE_OPENWA_KEY, sessionId: SESSION_ID });
    t.gateway.failNextSend({ dropResponseAfterStore: true });
    const failure = await sendThroughRegistry({
      registry: t.first.service.openwaOutbound,
      companyId: t.companyId,
      endpointId: t.endpointId,
      chatId: OWNER_CHAT,
      source: "approval",
      body: "Approve request #12?",
      send: () => client.sendText({ chatId: OWNER_CHAT, text: "Approve request #12?" }),
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(OpenwaGatewayError);
    expect((failure as OpenwaGatewayError).code).toBe("uncertain");
    const [pending] = await db.select().from(chatOutboundMessages).where(eq(chatOutboundMessages.endpointId, t.endpointId));
    expect(pending).toMatchObject({ state: "uncertain", providerMessageId: null });
    t.gateway.inbound({ chatId: OWNER_CHAT, fromMe: true, body: "owner typed this", emit: false });
    t.gateway.restartSocket();
    await settled(t, 1);
    const [reconciled] = await db.select().from(chatOutboundMessages).where(eq(chatOutboundMessages.id, pending.id));
    expect(reconciled.state).toBe("sent");
    expect(reconciled.providerMessageId).toBe(t.gateway.sends[0].messageId);
    expect(t.inbound.map((event) => [event.body, event.phoneTyped])).toEqual([["owner typed this", true]]);
  }, 60_000);

  it("reconciles uncertain and stale pending sends against stored outgoing rows at lease start", async () => {
    const t = await setup();
    await goLive(t, t.first.service);
    const registry = t.first.service.openwaOutbound;
    const client = createOpenwaGatewayClient({ baseUrl: t.gateway.baseUrl, apiKey: FAKE_OPENWA_KEY, sessionId: SESSION_ID });
    t.gateway.killSocket();
    t.gateway.failNextSend({ dropResponseAfterStore: true });
    await sendThroughRegistry({
      registry,
      companyId: t.companyId,
      endpointId: t.endpointId,
      chatId: OWNER_CHAT,
      source: "publication",
      body: "final answer",
      send: () => client.sendText({ chatId: OWNER_CHAT, text: "final answer" }),
    }).catch(() => undefined);
    const lost = await registry.reserve({ companyId: t.companyId, endpointId: t.endpointId, chatKey: OWNER_CHAT, source: "tool", body: "never reached the gateway" });
    await db.update(chatOutboundMessages).set({ createdAt: new Date(Date.now() - 10 * 60_000) }).where(eq(chatOutboundMessages.id, lost.id));
    const restarted = openwaOutboundRegistry(db);
    await restarted.preload(t.companyId, t.endpointId);
    const crashedId = t.gateway.sends[0].messageId!;
    expect(restarted.lookup(t.endpointId, crashedId)).toBeNull();
    expect(await restarted.reconcileUncertain(t.companyId, t.endpointId, client)).toBe(1);
    expect(restarted.lookup(t.endpointId, crashedId)).toMatchObject({ state: "sent", source: "publication" });
    const rows = await db.select().from(chatOutboundMessages).where(eq(chatOutboundMessages.endpointId, t.endpointId));
    expect(Object.fromEntries(rows.map((row) => [row.source, [row.state, row.providerMessageId]]))).toEqual({
      publication: ["sent", crashedId],
      tool: ["uncertain", null],
    });
  }, 60_000);

  it("marks a send failed on a definite gateway error and on a failed ack", async () => {
    const t = await setup();
    await goLive(t, t.first.service);
    const client = createOpenwaGatewayClient({ baseUrl: t.gateway.baseUrl, apiKey: FAKE_OPENWA_KEY, sessionId: SESSION_ID });
    t.gateway.failNextSend({ status: 400, body: { message: "bad chat" } });
    await expect(
      sendThroughRegistry({
        registry: t.first.service.openwaOutbound,
        companyId: t.companyId,
        endpointId: t.endpointId,
        chatId: PEER,
        source: "tool",
        body: "first",
        send: () => client.sendText({ chatId: PEER, text: "first" }),
      }),
    ).rejects.toMatchObject({ code: "bad_request" });
    const second = await sendThroughRegistry({
      registry: t.first.service.openwaOutbound,
      companyId: t.companyId,
      endpointId: t.endpointId,
      chatId: PEER,
      source: "publication",
      body: "second",
      send: () => client.sendText({ chatId: PEER, text: "second" }),
    });
    t.gateway.emit("message.ack", { id: second.result.messageId, messageId: second.result.messageId, status: "failed", ack: -1 });
    await until(async () => {
      const [row] = await db.select().from(chatOutboundMessages).where(eq(chatOutboundMessages.id, second.record.id));
      return row.state === "failed";
    });
    const states = await db.select({ state: chatOutboundMessages.state }).from(chatOutboundMessages).where(eq(chatOutboundMessages.endpointId, t.endpointId));
    expect(states.map((row) => row.state).sort()).toEqual(["failed", "failed"]);
  }, 60_000);

  it("hands the lease to a second runtime without duplicate processing and still recognizes pre-restart sends", async () => {
    const t = await setup();
    await goLive(t, t.first.service);
    const client = createOpenwaGatewayClient({ baseUrl: t.gateway.baseUrl, apiKey: FAKE_OPENWA_KEY, sessionId: SESSION_ID });
    const sent = await sendThroughRegistry({
      registry: t.first.service.openwaOutbound,
      companyId: t.companyId,
      endpointId: t.endpointId,
      chatId: OWNER_CHAT,
      source: "approval",
      body: "approval bubble",
      send: () => client.sendText({ chatId: OWNER_CHAT, text: "approval bubble" }),
    });
    for (let i = 0; i < 10; i++) t.gateway.inbound({ chatId: PEER });
    await settled(t, 10);
    const standby = t.make();
    const standbyResult = await standby.service.reconcileProviderRuntimes();
    expect(standbyResult.ownedElsewhere + standbyResult.failed).toBe(1);
    expect(standby.replacement).not.toHaveBeenCalled();
    await t.first.service.shutdown();
    for (let i = 0; i < 5; i++) t.gateway.inbound({ chatId: PEER, emit: false });
    const takeover = await standby.service.reconcileProviderRuntimes();
    expect(takeover.local).toBe(1);
    await t.gateway.waitForSubscription();
    await settled(t, 15);
    t.gateway.emit("message.sent", { id: sent.result.messageId, chatId: OWNER_CHAT, from: t.gateway.ownJid, to: OWNER_CHAT, body: "approval bubble", type: "text", timestamp: Math.floor(Date.now() / 1000), fromMe: true });
    for (let i = 0; i < 3; i++) t.gateway.inbound({ chatId: PEER });
    await settled(t, 18);
    const bodies = t.inbound.map((event) => event.body);
    expect(bodies).not.toContain("approval bubble");
    const sequences = t.inbound.map((event) => event.body).filter((body) => body.startsWith("seq:"));
    expect(sequences).toHaveLength(18);
    expect(new Set(sequences).size).toBe(18);
    const [lease] = await db.select().from(chatEndpointLeases).where(and(eq(chatEndpointLeases.endpointId, t.endpointId), eq(chatEndpointLeases.leaseKey, "openwa_receiver_runtime")));
    expect(lease).toBeDefined();
  }, 90_000);

  it("fences cursor writes and stops intake once the lease token is replaced", async () => {
    const t = await setup({ leaseTtlMs: 3_000, renewalMs: 250 });
    await goLive(t, t.first.service);
    t.gateway.inbound({ chatId: PEER });
    await settled(t, 1);
    const callbacks = t.first.replacement.mock.calls.at(-1)![0].callbacks;
    const before = await db.select().from(chatSdkState).where(eq(chatSdkState.endpointId, t.endpointId));
    await db
      .update(chatEndpointLeases)
      .set({ token: randomUUID() })
      .where(and(eq(chatEndpointLeases.endpointId, t.endpointId), eq(chatEndpointLeases.leaseKey, "openwa_receiver_runtime")));
    await expect(
      callbacks.onOpenwaCursor!({ schema: 1, sessionId: SESSION_ID, waMessageId: "x", rowId: null, timestamp: Math.floor(Date.now() / 1000) + 100 }),
    ).rejects.toThrow(/lease was replaced/);
    const after = await db.select().from(chatSdkState).where(eq(chatSdkState.endpointId, t.endpointId));
    expect(after.map((row) => [row.stateKey, row.version])).toEqual(before.map((row) => [row.stateKey, row.version]));
    await until(() => t.gateway.subscriberCount === 0);
    const count = t.inbound.length;
    t.gateway.restartSocket();
    t.gateway.emit("message.received", { id: "false_x_1", chatId: PEER, from: PEER, body: "late", type: "text", timestamp: Math.floor(Date.now() / 1000) });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(t.inbound).toHaveLength(count);
  }, 60_000);

  it("moves the endpoint to attention on session status and restriction events and back when ready", async () => {
    const t = await setup();
    await goLive(t, t.first.service);
    t.gateway.emit("session.status", { sessionId: SESSION_ID, status: "disconnected" });
    await until(async () => (await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, t.endpointId)))[0].status === "attention");
    t.gateway.emit("session.status", { sessionId: SESSION_ID, status: "ready" });
    await until(async () => (await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, t.endpointId)))[0].status === "active");
    t.gateway.emit("session.restriction", { sessionId: SESSION_ID, active: true, kind: "temporary", code: "463", expiresAt: null });
    await until(async () => (await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, t.endpointId)))[0].status === "attention");
    const [endpoint] = await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, t.endpointId));
    expect(endpoint.lastError).toMatch(/^OpenWA restriction: /);
    const audits = await db.select().from(chatAuditEntries).where(eq(chatAuditEntries.endpointId, t.endpointId));
    expect(audits.map((row) => row.kind)).toEqual(["session_health", "session_health", "session_health"]);
    await db.update(chatEndpoints).set({ status: "attention", lastError: "The assigned agent adapter changed" }).where(eq(chatEndpoints.id, t.endpointId));
    t.gateway.emit("session.restriction", { sessionId: SESSION_ID, active: false, kind: null, code: null, expiresAt: null });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, t.endpointId)))[0].status).toBe("attention");
  }, 60_000);
});
