import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import {
  agents,
  agentWakeupRequests,
  authUsers,
  chatActions,
  chatAuditEntries,
  chatConversations,
  chatDeliveries,
  chatEndpoints,
  chatExternalPrincipals,
  companies,
  companyMemberships,
  companySecretBindings,
  createDb,
  issueComments,
  issues,
  toolConnections,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import { startEmbeddedPostgresTestDatabase } from "../helpers/embedded-postgres.js";
import { chatChannelService, type ChatChannelService, type ChatChannelServiceOptions } from "../../services/chat-channels.js";
import { ChatSdkRuntime } from "../../services/chat-sdk-runtime.js";
import { secretService } from "../../services/secrets.js";
import { createOpenwaPolicyCache, OPENWA_POLICY_REVALIDATE_MS } from "../../services/openwa/policy.js";
import { FAKE_OPENWA_KEY, FakeOpenwaGateway } from "./fake-gateway.js";

const SESSION_ID = "21111111-2222-4333-8444-555555555555";
const OWN_PHONE = "628111000111";
const OWNER_PHONE = "628333000333";
const ALLOWED_PHONE = "628444000444";
const STRANGER_PHONE = "628555000555";
const MEMBER_PHONE = "628666000666";
const QUERY_METHODS = new Set(["select", "selectDistinct", "insert", "update", "delete", "execute"]);

const jid = (phone: string) => phone + "@c.us";

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

describe.sequential("OpenWA admission (embedded Postgres + fake gateway)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let secrets: string;
  const oldKey = process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
  const services: ChatChannelService[] = [];
  const gateways: FakeOpenwaGateway[] = [];
  const endpointIds: string[] = [];

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-openwa-admission-");
    db = createDb(database.connectionString);
    secrets = await mkdtemp(path.join(tmpdir(), "openwa-admission-secrets-"));
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

  async function setup() {
    const gateway = new FakeOpenwaGateway({ sessionId: SESSION_ID, ownPhone: OWN_PHONE });
    await gateway.start();
    gateways.push(gateway);
    const companyId = randomUUID();
    const agentId = randomUUID();
    const userId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "OpenWA admission",
      issuePrefix: "A" + companyId.replaceAll("-", "").slice(0, 7).toUpperCase(),
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
      name: "Owner",
      email: userId + "@example.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "operator" });
    const counted = countingDb(db);
    const wakeup = vi.fn<ChatChannelServiceOptions["heartbeat"]["wakeup"]>(async (agentId, opts) => {
      const request = opts.durableChatRequest;
      if (!request) return { accepted: true } as never;
      await db.transaction(async (tx) => {
        await request.authorize(tx as unknown as Parameters<typeof request.authorize>[0]);
        await tx
          .insert(agentWakeupRequests)
          .values({
            id: request.id,
            companyId: request.companyId,
            agentId,
            source: opts.source ?? "assignment",
            triggerDetail: opts.triggerDetail,
            reason: opts.reason,
            payload: opts.payload,
            requestedByActorType: opts.requestedByActorType,
            requestedByActorId: opts.requestedByActorId,
            idempotencyKey: request.idempotencyKey,
            requestedAt: request.requestedAt,
            status: "queued",
          })
          .onConflictDoNothing();
      });
      return { accepted: true } as never;
    });
    const runtime = new ChatSdkRuntime();
    const service = chatChannelService(counted.db, {
      runtime,
      publicBaseUrl: "https://paperclip.example",
      heartbeat: { wakeup } as never,
      discordGatewayLeaseTtlMs: 120_000,
      discordGatewayLeaseRenewalIntervalMs: 60_000,
      discordGatewayLeaseWaitMs: 200,
    });
    services.push(service);
    const endpoint = await service.create(companyId, { provider: "openwa", assignedAgentId: agentId } as never, userId);
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
    return { gateway, companyId, agentId, userId, endpointId: endpoint.id, service, counted, wakeup };
  }

  type Setup = Awaited<ReturnType<typeof setup>>;

  async function addOwner(t: Setup, phone: string) {
    const added = await t.service.openwa.addOwner(t.endpointId, { e164: "+" + phone, expiresInSeconds: 1_800 }, t.userId);
    expect(added.created).toBe(true);
    const token = new URL(added.confirmationUrl!, "https://paperclip.example").searchParams.get("token")!;
    await t.service.confirmIdentityLink(token, t.userId);
    const owners = await t.service.openwa.listOwners(t.endpointId);
    expect(owners.find((owner) => owner.id === added.owner!.id)?.effective).toBe(true);
    return added.owner!;
  }

  async function goLive(t: Setup) {
    const result = await t.service.reconcileProviderRuntimes();
    expect(result.local).toBe(1);
    await t.gateway.waitForSubscription();
  }

  function handled(t: Setup) {
    const stats = t.service.openwaAdmissionStats;
    return stats.discarded + stats.ownerActivity + stats.filtered + stats.admitted;
  }

  async function send(t: Setup, input: Parameters<FakeOpenwaGateway["inbound"]>[0]) {
    const before = handled(t);
    const row = t.gateway.inbound(input);
    await until(() => handled(t) > before);
    return row;
  }

  async function deliveries(t: Setup) {
    return db
      .select()
      .from(chatDeliveries)
      .where(and(eq(chatDeliveries.companyId, t.companyId), eq(chatDeliveries.endpointId, t.endpointId)))
      .orderBy(asc(chatDeliveries.createdAt));
  }

  async function settledDeliveries(t: Setup, count: number) {
    let swept = Date.now();
    await until(async () => {
      if (Date.now() - swept > 1_000) {
        swept = Date.now();
        await t.service.processPendingDeliveries();
      }
      const rows = await deliveries(t);
      return rows.length >= count && rows.every((row) => row.state !== "processing" && row.state !== "received");
    });
    return deliveries(t);
  }

  async function audits(t: Setup) {
    return db
      .select()
      .from(chatAuditEntries)
      .where(and(eq(chatAuditEntries.companyId, t.companyId), eq(chatAuditEntries.endpointId, t.endpointId)))
      .orderBy(asc(chatAuditEntries.occurredAt));
  }

  async function conversations(t: Setup) {
    return db
      .select()
      .from(chatConversations)
      .where(and(eq(chatConversations.companyId, t.companyId), eq(chatConversations.endpointId, t.endpointId)))
      .orderBy(asc(chatConversations.createdAt));
  }

  it("admits owner and allowlisted DMs and filters outside-allowlist and denylisted senders (AC3)", async () => {
    const t = await setup();
    await addOwner(t, OWNER_PHONE);
    await t.service.openwa.addSenderRule(t.endpointId, { list: "allow", e164: "+" + ALLOWED_PHONE }, t.userId);
    await t.service.openwa.addSenderRule(t.endpointId, { list: "deny", e164: "+" + OWNER_PHONE }, t.userId);
    await goLive(t);

    await send(t, { chatId: jid(OWNER_PHONE), body: "hello from the owner" });
    await send(t, { chatId: jid(ALLOWED_PHONE), body: "hello from an allowed sender" });
    await send(t, { chatId: jid(STRANGER_PHONE), body: "hello from a stranger" });
    const rows = await settledDeliveries(t, 2);
    expect(rows.map((row) => [row.principalRole, row.triggerClass, row.answerState])).toEqual([
      ["owner", "owner", "pending"],
      ["allowed", "other", "pending"],
    ]);
    expect(rows.every((row) => row.deduplicationKey?.startsWith("openwa:" + SESSION_ID + ":"))).toBe(true);
    expect(rows.map((row) => (row.normalizedEvent as { openwa?: { addressed?: boolean } }).openwa?.addressed)).toEqual([true, true]);

    const issueRows = await db.select().from(issues).where(eq(issues.companyId, t.companyId));
    expect(issueRows.map((issue) => issue.originId).sort()).toEqual([
      "chat:" + t.endpointId + ":" + jid(OWNER_PHONE) + ":1",
      "chat:" + t.endpointId + ":" + jid(ALLOWED_PHONE) + ":1",
    ].sort());
    expect(issueRows.every((issue) => issue.sourceTrust === null)).toBe(true);
    const wakes = await db.select().from(chatActions).where(and(eq(chatActions.companyId, t.companyId), eq(chatActions.kind, "inbound_wakeup")));
    expect(wakes.map((wake) => (wake.payload as { openwa?: unknown }).openwa).sort((a, b) => String((a as { triggerClass: string }).triggerClass).localeCompare(String((b as { triggerClass: string }).triggerClass)))).toEqual(
      [
        { event: "message", triggerClass: "other", deliveryIds: [rows[1].id] },
        { event: "message", triggerClass: "owner", deliveryIds: [rows[0].id] },
      ],
    );

    await t.service.openwa.addSenderRule(t.endpointId, { list: "deny", e164: "+" + ALLOWED_PHONE }, t.userId);
    await send(t, { chatId: jid(ALLOWED_PHONE), body: "allowed then denied" });
    expect(await deliveries(t)).toHaveLength(2);
    const filtered = (await audits(t)).filter((entry) => entry.kind === "trigger_filtered");
    expect(filtered.map((entry) => (entry.metadata as { reason: string }).reason)).toEqual(["outside_allowlist", "denylisted"]);
    expect(filtered.map((entry) => entry.chatKey)).toEqual([jid(STRANGER_PHONE), jid(ALLOWED_PHONE)]);
    const admittedAudits = (await audits(t)).filter((entry) => entry.kind === "trigger_admitted");
    expect(admittedAudits).toHaveLength(2);
    const byDelivery = new Map(admittedAudits.map((entry) => [(entry.metadata as { deliveryId: string }).deliveryId, entry]));
    expect(byDelivery.get(rows[0].id)).toMatchObject({
      chatKey: jid(OWNER_PHONE),
      actorKind: "chat_principal",
      actorRef: jid(OWNER_PHONE),
      conversationId: rows[0].conversationId,
      metadata: { event: "message", triggerClass: "owner", principalRole: "owner", rules: ["direct_message"], chatKind: "dm", senderMasked: "+62xxx...0333" },
      content: { text: "hello from the owner" },
    });
    expect(byDelivery.get(rows[0].id)!.contentPurgeAt).not.toBeNull();
    expect(byDelivery.get(rows[1].id)).toMatchObject({ metadata: { triggerClass: "other", principalRole: "allowed" }, content: { text: "hello from an allowed sender" } });
  }, 90_000);

  it("drops a revoked owner's authority on the next message", async () => {
    const t = await setup();
    const owner = await addOwner(t, OWNER_PHONE);
    await goLive(t);
    await send(t, { chatId: jid(OWNER_PHONE), body: "first" });
    await settledDeliveries(t, 1);
    await t.service.revokeLink(t.endpointId, owner.principalId);
    await send(t, { chatId: jid(OWNER_PHONE), body: "after revoke" });
    expect(await deliveries(t)).toHaveLength(1);
    const filtered = (await audits(t)).filter((entry) => entry.kind === "trigger_filtered");
    expect(filtered.map((entry) => (entry.metadata as { reason: string; principalRole: string }).principalRole)).toEqual(["outside_allowlist"]);
    expect((await t.service.openwa.listOwners(t.endpointId))[0].effective).toBe(false);
  }, 90_000);

  it("rechecks owner membership at admission even when the cached policy still lists the owner", async () => {
    const t = await setup();
    await addOwner(t, OWNER_PHONE);
    await goLive(t);
    await send(t, { chatId: jid(OWNER_PHONE), body: "first" });
    await settledDeliveries(t, 1);
    await db
      .update(companyMemberships)
      .set({ membershipRole: "viewer" })
      .where(and(eq(companyMemberships.companyId, t.companyId), eq(companyMemberships.principalId, t.userId)));
    await send(t, { chatId: jid(OWNER_PHONE), body: "as a viewer now" });
    const rows = await settledDeliveries(t, 2);
    expect(rows.map((row) => row.state)).toEqual(["processed", "filtered"]);
    expect(await conversations(t)).toHaveLength(1);
    const comments = await db.select().from(issueComments).where(eq(issueComments.companyId, t.companyId));
    expect(comments.some((comment) => comment.body.includes("as a viewer now"))).toBe(false);
  }, 90_000);

  it("activates groups by owner presence, admits outside-allowlist members, and never converts to low trust (AC4)", async () => {
    const t = await setup();
    await addOwner(t, OWNER_PHONE);
    const active = "120363000000000001@g.us";
    const inactive = "120363000000000002@g.us";
    t.gateway.groups.set(active, {
      id: active,
      name: "Ops",
      participants: [{ id: jid(OWN_PHONE) }, { id: jid(OWNER_PHONE) }, { id: jid(MEMBER_PHONE) }],
    });
    t.gateway.groups.set(inactive, { id: inactive, name: "Strangers", participants: [{ id: jid(OWN_PHONE) }, { id: jid(MEMBER_PHONE) }] });
    await goLive(t);

    await send(t, { chatId: active, author: jid(MEMBER_PHONE), body: "just chatting" });
    await send(t, { chatId: active, author: jid(MEMBER_PHONE), body: "@" + OWN_PHONE + " can you help", extra: { mentionedIds: [jid(OWN_PHONE)] } });
    await send(t, { chatId: active, author: jid(OWNER_PHONE), body: "@" + OWN_PHONE + " please do", extra: { mentionedIds: [jid(OWN_PHONE)] } });
    const rows = await settledDeliveries(t, 2);
    expect(rows.map((row) => [row.principalRole, row.triggerClass])).toEqual([
      ["outside_allowlist", "other"],
      ["owner", "owner"],
    ]);
    const bound = await conversations(t);
    expect(bound).toHaveLength(1);
    const [issue] = await db.select().from(issues).where(eq(issues.id, bound[0].issueId));
    expect(issue.sourceTrust).toBeNull();
    expect((issue.executionPolicy as { reviewPreset?: unknown } | null)?.reviewPreset).toBeUndefined();

    await send(t, { chatId: inactive, author: jid(MEMBER_PHONE), body: "@" + OWN_PHONE + " hi", extra: { mentionedIds: [jid(OWN_PHONE)] } });
    await send(t, { chatId: inactive, author: jid(MEMBER_PHONE), body: "no mention here" });
    expect(await deliveries(t)).toHaveLength(2);
    const filtered = (await audits(t)).filter((entry) => entry.kind === "trigger_filtered");
    expect(filtered.map((entry) => [entry.chatKey, (entry.metadata as { reason: string }).reason])).toEqual([[inactive, "chat_inactive"]]);

    await t.service.openwa.putChat(t.endpointId, { chatId: inactive, settings: { activation: "on" } }, t.userId);
    await send(t, { chatId: inactive, author: jid(MEMBER_PHONE), body: "@" + OWN_PHONE + " again", extra: { mentionedIds: [jid(OWN_PHONE)] } });
    expect((await settledDeliveries(t, 3)).at(-1)?.principalRole).toBe("outside_allowlist");
  }, 90_000);

  it("wakes the agent once when added to an inactive group", async () => {
    const t = await setup();
    await addOwner(t, OWNER_PHONE);
    const group = "120363000000000003@g.us";
    t.gateway.groups.set(group, { id: group, name: "New group", participants: [{ id: jid(OWN_PHONE) }, { id: jid(MEMBER_PHONE) }] });
    await goLive(t);
    t.gateway.emit("group.join", { groupId: group, actorId: jid(MEMBER_PHONE), participantIds: [jid(OWN_PHONE)], timestamp: Math.floor(Date.now() / 1000) });
    const [row] = await settledDeliveries(t, 1);
    expect(row.triggerClass).toBe("other");
    expect(row.answerState).toBeNull();
    expect((row.normalizedEvent as { openwa?: { event?: string } }).openwa?.event).toBe("group_added");
    expect((await audits(t)).map((entry) => entry.kind)).toContain("group_added");
    expect((await audits(t)).map((entry) => entry.kind)).not.toContain("trigger_admitted");
  }, 90_000);

  it("drops and audits a denylisted sender matched only by a keyword rule", async () => {
    const t = await setup();
    await addOwner(t, OWNER_PHONE);
    const group = "120363000000000009@g.us";
    t.gateway.groups.set(group, { id: group, name: "Keywords", participants: [{ id: jid(OWN_PHONE) }, { id: jid(OWNER_PHONE) }, { id: jid(MEMBER_PHONE) }] });
    await t.service.openwa.addSenderRule(t.endpointId, { list: "deny", e164: "+" + MEMBER_PHONE }, t.userId);
    await goLive(t);
    await send(t, { chatId: group, author: jid(MEMBER_PHONE), body: "warm up" });
    await until(() => t.service.openwaAdmissionStats.discoveries >= 1);
    await t.service.openwa.putChat(t.endpointId, { chatId: group, settings: { activation: "on", triggers: { keywords: ["invoice"] } } }, t.userId);
    await send(t, { chatId: group, author: jid(MEMBER_PHONE), body: "where is the invoice?" });
    expect(await deliveries(t)).toHaveLength(0);
    const entries = await audits(t);
    const filtered = entries.filter((entry) => entry.kind === "trigger_filtered");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toMatchObject({ chatKey: group, metadata: { reason: "denylisted", principalRole: "denylisted", rules: ["keywords"] }, content: { text: "where is the invoice?" } });
    expect(entries.map((entry) => entry.kind)).not.toContain("trigger_admitted");
  }, 90_000);

  it("performs zero database queries for non-trigger traffic once the policy is warm", async () => {
    const t = await setup();
    await addOwner(t, OWNER_PHONE);
    const group = "120363000000000004@g.us";
    t.gateway.groups.set(group, { id: group, name: "Busy", participants: [{ id: jid(OWN_PHONE) }, { id: jid(OWNER_PHONE) }, { id: jid(MEMBER_PHONE) }] });
    await goLive(t);
    await send(t, { chatId: group, author: jid(MEMBER_PHONE), body: "warm up" });
    await until(() => t.service.openwaAdmissionStats.discoveries >= 1);
    const queries = t.counted.counts.queries;
    const transactions = t.counted.counts.transactions;
    const before = handled(t);
    for (let i = 0; i < 100; i++) t.gateway.inbound({ chatId: group, author: jid(i % 2 ? MEMBER_PHONE : STRANGER_PHONE), body: "chatter " + i });
    await until(() => handled(t) >= before + 100);
    expect(t.counted.counts.queries - queries).toBe(0);
    expect(t.counted.counts.transactions - transactions).toBeLessThanOrEqual(1);
    expect(await deliveries(t)).toHaveLength(0);
    expect((await audits(t)).filter((entry) => entry.kind === "trigger_filtered" || entry.kind === "trigger_admitted")).toHaveLength(0);
  }, 90_000);

  it("keeps non-trigger traffic query-free after the policy revalidation interval has elapsed", async () => {
    const realNow = Date.now.bind(Date);
    let skew = 0;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + skew);
    const t = await setup();
    await addOwner(t, OWNER_PHONE);
    const group = "120363000000000005@g.us";
    t.gateway.groups.set(group, { id: group, name: "Quiet", participants: [{ id: jid(OWN_PHONE) }, { id: jid(OWNER_PHONE) }, { id: jid(MEMBER_PHONE) }] });
    await goLive(t);
    await send(t, { chatId: group, author: jid(MEMBER_PHONE), body: "warm up" });
    await until(() => t.service.openwaAdmissionStats.discoveries >= 1);
    let observed = -1;
    await until(async () => {
      const current = t.counted.counts.queries;
      if (current === observed) return true;
      observed = current;
      await new Promise((resolve) => setTimeout(resolve, 300));
      return false;
    });
    skew = OPENWA_POLICY_REVALIDATE_MS + 1_000;
    const queries = t.counted.counts.queries;
    const before = handled(t);
    for (let i = 0; i < 20; i++) t.gateway.inbound({ chatId: group, author: jid(MEMBER_PHONE), body: "later chatter " + i });
    await until(() => handled(t) >= before + 20);
    expect(t.counted.counts.queries - queries).toBe(0);
  }, 90_000);

  it("picks up an out-of-band policy revision on the revalidation timer", async () => {
    const t = await setup();
    await addOwner(t, OWNER_PHONE);
    const cache = createOpenwaPolicyCache(db, Date.now, 50);
    try {
      const first = await cache.get(t.companyId, t.endpointId);
      expect(first?.policy.senderPolicyMode).toBe("allowlist");
      const [endpoint] = await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, t.endpointId));
      await db
        .update(chatEndpoints)
        .set({ policy: { ...(endpoint.policy as Record<string, unknown>), senderPolicyMode: "denylist" } as typeof endpoint.policy, policyRevision: endpoint.policyRevision + 1 })
        .where(eq(chatEndpoints.id, t.endpointId));
      await until(() => cache.peek(t.endpointId)?.revision === endpoint.policyRevision + 1);
      expect(cache.peek(t.endpointId)?.policy.senderPolicyMode).toBe("denylist");
      cache.stop();
      await db
        .update(chatEndpoints)
        .set({ policyRevision: endpoint.policyRevision + 2 })
        .where(eq(chatEndpoints.id, t.endpointId));
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(cache.peek(t.endpointId)?.revision).toBe(endpoint.policyRevision + 1);
    } finally {
      cache.stop();
    }
  }, 90_000);

  it("rotates conversations after idle hours and applies /new, /close and /status", async () => {
    const t = await setup();
    await addOwner(t, OWNER_PHONE);
    await t.service.openwa.addSenderRule(t.endpointId, { list: "allow", e164: "+" + ALLOWED_PHONE }, t.userId);
    await t.service.openwa.updatePolicy(t.endpointId, { rotateAfterIdleHours: 1 }, t.userId);
    await goLive(t);

    await send(t, { chatId: jid(OWNER_PHONE), body: "first task" });
    await settledDeliveries(t, 1);
    const [first] = await conversations(t);
    await db.update(chatConversations).set({ lastActivityAt: new Date(Date.now() - 2 * 3_600_000) }).where(eq(chatConversations.id, first.id));
    await send(t, { chatId: jid(OWNER_PHONE), body: "after a long pause" });
    await settledDeliveries(t, 2);
    let rows = await conversations(t);
    expect(rows.map((row) => [row.sessionGeneration, row.state])).toEqual([
      [1, "completed"],
      [2, "active"],
    ]);
    const [rotated] = await db.select().from(issues).where(eq(issues.id, rows[1].issueId));
    const [original] = await db.select().from(issues).where(eq(issues.id, rows[0].issueId));
    expect(rotated.originId).toBe("chat:" + t.endpointId + ":" + jid(OWNER_PHONE) + ":2");
    expect(rotated.description).toContain("Continues " + original.identifier);

    await send(t, { chatId: jid(OWNER_PHONE), body: "/new" });
    const afterNew = await settledDeliveries(t, 3);
    expect(afterNew.at(-1)?.state).toBe("processed");
    expect((await conversations(t)).map((row) => row.state)).toEqual(["completed", "completed"]);
    await send(t, { chatId: jid(OWNER_PHONE), body: "fresh start" });
    await settledDeliveries(t, 4);
    expect((await conversations(t)).map((row) => [row.sessionGeneration, row.state]).at(-1)).toEqual([3, "active"]);

    await send(t, { chatId: jid(ALLOWED_PHONE), body: "allowed task" });
    await settledDeliveries(t, 5);
    await send(t, { chatId: jid(ALLOWED_PHONE), body: "/close" });
    await settledDeliveries(t, 6);
    const allowedConversation = (await conversations(t)).find((row) => row.externalConversationId?.includes(ALLOWED_PHONE) || row.externalThreadId?.includes(ALLOWED_PHONE));
    expect(allowedConversation?.state).toBe("completed");

    const wakesBefore = (await db.select().from(chatActions).where(and(eq(chatActions.companyId, t.companyId), eq(chatActions.kind, "inbound_wakeup")))).length;
    await send(t, { chatId: jid(OWNER_PHONE), body: "/status" });
    const statusRow = (await settledDeliveries(t, 7)).at(-1)!;
    expect((statusRow.normalizedEvent as { openwa?: { rules?: string[]; control?: unknown } }).openwa).toMatchObject({ rules: ["control"], control: null });
    expect(statusRow.answerState).toBe("pending");
    const wakesAfter = (await db.select().from(chatActions).where(and(eq(chatActions.companyId, t.companyId), eq(chatActions.kind, "inbound_wakeup")))).length;
    expect(wakesAfter).toBe(wakesBefore + 1);
  }, 120_000);

  it("ignores control commands from senders outside the allowlist", async () => {
    const t = await setup();
    await addOwner(t, OWNER_PHONE);
    await goLive(t);
    await send(t, { chatId: jid(STRANGER_PHONE), body: "/new" });
    expect(await deliveries(t)).toHaveLength(0);
    const [principal] = await db
      .select()
      .from(chatExternalPrincipals)
      .where(and(eq(chatExternalPrincipals.companyId, t.companyId), eq(chatExternalPrincipals.externalId, jid(STRANGER_PHONE))));
    expect(principal).toBeUndefined();
  }, 90_000);
});
