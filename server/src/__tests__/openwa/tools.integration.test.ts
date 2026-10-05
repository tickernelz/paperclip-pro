import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  activityLog,
  agents,
  assets,
  authUsers,
  chatActions,
  chatAuditEntries,
  chatConversations,
  chatDeliveries,
  chatEndpointResources,
  chatEndpointOwners,
  chatEndpoints,
  chatExternalPrincipals,
  chatIdentityLinks,
  chatOutboundMessages,
  chatOwnerApprovalRequests,
  chatOwnerGrants,
  companies,
  companyMemberships,
  companySecretBindings,
  createDb,
  heartbeatRuns,
  issueAttachments,
  issues,
  toolConnections,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import type { OpenwaPrincipalRole, OpenwaTriggerClass } from "@tickernelz/paperclip-pro-shared";
import { startEmbeddedPostgresTestDatabase } from "../helpers/embedded-postgres.js";
import { createLocalDiskStorageProvider } from "../../storage/local-disk-provider.js";
import { createStorageService } from "../../storage/service.js";
import { chatChannelService, type ChatChannelService } from "../../services/chat-channels.js";
import { ChatSdkRuntime } from "../../services/chat-sdk-runtime.js";
import { secretService } from "../../services/secrets.js";
import { instanceSettingsService } from "../../services/instance-settings.js";
import {
  applyConnectorSkills,
  executeConnectorTool,
  prepareConnectorSkillDelivery,
  resolveConnectorAssignments,
} from "../../services/connector-runtime.js";
import { PaperclipRunnerToolAuthority } from "../../services/native-runtime/paperclip-runner-tool-authority.js";
import { openwaThreadId } from "../../services/openwa/adapter.js";
import { openwaChatKey } from "../../services/openwa/outbound.js";
import { openwaAttachmentLocalPaths } from "../../services/openwa/media.js";
import { executeOpenwaTool, openwaMentionText, OpenwaToolError } from "../../services/openwa/tools.js";
import { resolveOpenwaApproval } from "../../services/openwa/approvals.js";
import { openwaToolRoutes } from "../../routes/openwa-tools.js";
import { paperclipMcpRoutes } from "../../routes/paperclip-mcp.js";
import { errorHandler } from "../../middleware/index.js";
import { FAKE_OPENWA_KEY, FakeOpenwaGateway } from "./fake-gateway.js";

const SESSION_ID = "33333333-4444-4555-8666-777777777777";
const OWN_PHONE = "628111000555";
const MEMBER = "628222000333@c.us";
const OTHER = "628444000222@c.us";
const GROUP = "120363000000000555@g.us";

async function until(predicate: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function rejection(promise: Promise<unknown>): Promise<OpenwaToolError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OpenwaToolError) return error;
    throw error;
  }
  throw new Error("expected an OpenWA tool error");
}

describe.sequential("OpenWA agent tools (embedded Postgres + fake gateway)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let root: string;
  let storage: ReturnType<typeof createStorageService>;
  const oldKey = process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
  const services: ChatChannelService[] = [];
  const gateways: FakeOpenwaGateway[] = [];
  const endpointIds: string[] = [];

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-openwa-tools-");
    db = createDb(database.connectionString);
    root = await mkdtemp(path.join(tmpdir(), "openwa-tools-"));
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

  async function setup(policy: Record<string, unknown> = {}) {
    const gateway = new FakeOpenwaGateway({ sessionId: SESSION_ID, ownPhone: OWN_PHONE });
    await gateway.start();
    gateways.push(gateway);
    const companyId = randomUUID();
    const agentId = randomUUID();
    const userId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "OpenWA tools",
      issuePrefix: "T" + companyId.replaceAll("-", "").slice(0, 7).toUpperCase(),
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
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "operator" });
    const runtime = new ChatSdkRuntime();
    const service = chatChannelService(db, {
      runtime,
      publicBaseUrl: "https://paperclip.example",
      heartbeat: { wakeup: vi.fn(async () => ({ accepted: true })) } as never,
      storage,
      scheduleDeferredWork: () => {},
      discordGatewayLeaseWaitMs: 200,
    });
    services.push(service);
    const endpoint = await service.create(companyId, { provider: "openwa", assignedAgentId: agentId } as never, userId);
    endpointIds.push(endpoint.id);
    const secret = await secretService(db).create(
      companyId,
      { name: "openwa-key-" + endpoint.id.slice(0, 8), provider: "local_encrypted", managedMode: "paperclip_managed", value: FAKE_OPENWA_KEY },
      { userId },
    );
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
      .where(eq(toolConnections.id, row!.connectionId));
    await db.insert(companySecretBindings).values({
      companyId,
      secretId: secret.id,
      targetType: "tool_connection",
      targetId: row!.connectionId,
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
        policy,
        setup: { step: "complete", testStartedAt: new Date(Date.now() - 60_000).toISOString() },
      })
      .where(eq(chatEndpoints.id, endpoint.id));
    expect((await service.reconcileProviderRuntimes()).local).toBe(1);
    await gateway.waitForSubscription();
    await until(async () => (await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, endpoint.id)))[0]!.status === "active");
    return { gateway, companyId, agentId, userId, endpointId: endpoint.id, service };
  }

  type Fixture = Awaited<ReturnType<typeof setup>>;

  async function conversation(t: Fixture, chatId: string, settings: Record<string, unknown> = {}) {
    const isGroup = chatId.endsWith("@g.us");
    const threadId = openwaThreadId({ sessionId: SESSION_ID, chatId, isGroup });
    const [issue] = await db.insert(issues).values({ companyId: t.companyId, title: "WhatsApp " + chatId, status: "todo", assigneeAgentId: t.agentId }).returning();
    const [resource] = await db
      .insert(chatEndpointResources)
      .values({
        companyId: t.companyId,
        endpointId: t.endpointId,
        type: isGroup ? "group_chat" : "direct_message",
        providerResourceId: threadId,
        label: chatId,
        availability: "available",
        enabled: true,
        settings,
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
        isDirectMessage: !isGroup,
      })
      .returning();
    return { ...row!, chatId, threadId, chatRef: threadId };
  }

  type Conversation = Awaited<ReturnType<typeof conversation>>;

  async function trigger(
    t: Fixture,
    c: Conversation,
    input: { triggerClass: OpenwaTriggerClass; role: OpenwaPrincipalRole; principalId?: string | null; rules?: string[]; event?: string },
  ) {
    const row = t.gateway.inbound({ chatId: c.chatId, from: c.chatId.endsWith("@g.us") ? MEMBER : c.chatId, author: c.chatId.endsWith("@g.us") ? MEMBER : undefined, body: "question " + randomUUID().slice(0, 6), emit: false });
    const waMessageId = row.waMessageId!;
    const [delivery] = await db
      .insert(chatDeliveries)
      .values({
        companyId: t.companyId,
        endpointId: t.endpointId,
        conversationId: c.id,
        principalId: input.principalId ?? null,
        providerEventId: c.threadId + ":" + waMessageId,
        deduplicationKey: "openwa:" + SESSION_ID + ":" + waMessageId,
        eventKind: c.isDirectMessage ? "direct_message" : "message",
        normalizedEvent: {
          message: { providerMessageId: waMessageId },
          openwa: {
            chatKey: openwaChatKey(c.chatId),
            chatKind: c.isDirectMessage ? "dm" : "group",
            waMessageId,
            triggerClass: input.triggerClass,
            principalRole: input.role,
            rules: input.rules ?? [],
            ...(input.event ? { event: input.event } : {}),
          },
        },
        state: "processed",
        triggerClass: input.triggerClass,
        principalRole: input.role,
        answerState: "pending",
        receivedAt: new Date(Date.now() - 60_000),
      })
      .returning();
    return { id: delivery!.id, waMessageId };
  }

  async function run(t: Fixture, c: Conversation, input: { triggerClass: OpenwaTriggerClass; grantIds?: string[]; requesterPrincipalId?: string | null; event?: string; issueId?: string }) {
    const runId = randomUUID();
    const profile = input.triggerClass === "owner" ? "full" : "read_only";
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId: t.companyId,
      agentId: t.agentId,
      status: "running",
      startedAt: new Date(Date.now() - 30_000),
      contextSnapshot: {
        source: "chat:openwa",
        issueId: input.issueId ?? c.issueId,
        paperclipToolProfile: profile,
        openwa: { event: input.event ?? "message", triggerClass: input.triggerClass, deliveryIds: [] },
        paperclipOpenwa: {
          endpointId: t.endpointId,
          chatKey: openwaChatKey(c.chatId),
          triggerClass: input.triggerClass,
          profile,
          grantIds: input.grantIds ?? [],
          requesterPrincipalId: input.requesterPrincipalId ?? null,
          approvalRequestId: null,
          ...(input.event ? { event: input.event } : {}),
        },
      },
    });
    return { companyId: t.companyId, agentId: t.agentId, runId, issueId: input.issueId ?? c.issueId };
  }

  async function answerStates(ids: string[]) {
    const rows = await db.select({ id: chatDeliveries.id, answerState: chatDeliveries.answerState }).from(chatDeliveries);
    return ids.map((id) => rows.find((row) => row.id === id)?.answerState);
  }

  it("renders mentions as array plus @n tokens and quotes a trigger, marking it answered", async () => {
    const t = await setup();
    const c = await conversation(t, GROUP);
    const first = await trigger(t, c, { triggerClass: "other", role: "allowed" });
    const second = await trigger(t, c, { triggerClass: "other", role: "allowed" });
    const binding = await run(t, c, { triggerClass: "other" });
    const result = await executeOpenwaTool(db, binding, "openwa_send", {
      text: "Thanks **both**, see @628333000111",
      mentions: ["+628333000111", "628555000444"],
      quoteMessageId: first.id,
      idempotencyKey: randomUUID(),
    });
    expect(result).toMatchObject({ state: "delivered", chatRef: c.chatRef, quotedMessageId: first.waMessageId, answeredTriggerIds: [first.id] });
    const sent = t.gateway.sends.at(-1)!;
    expect(sent.text).toBe("@628555000444 Thanks *both*, see @628333000111");
    expect(sent.mentions).toEqual(["628333000111@c.us", "628555000444@c.us"]);
    expect(sent.quotedMessageId).toBe(first.waMessageId);
    expect(await answerStates([first.id, second.id])).toEqual(["answered", "pending"]);
    expect(openwaMentionText("hi @628333000111", [{ token: "@628333000111" }])).toBe("hi @628333000111");
    const audit = await db.select().from(chatAuditEntries).where(eq(chatAuditEntries.endpointId, t.endpointId));
    expect(audit.map((entry) => entry.kind).sort()).toEqual(["message_sent", "tool_called"]);
    expect(audit.find((entry) => entry.kind === "tool_called")!.metadata).toMatchObject({ tool: "openwa_send", errorCode: null });
  });

  it("types unresolvable quotes and checks new numbers before sending", async () => {
    const t = await setup();
    const c = await conversation(t, MEMBER);
    const binding = await run(t, c, { triggerClass: "owner" });
    t.gateway.strictQuotes = true;
    const unknown = await rejection(
      executeOpenwaTool(db, binding, "openwa_send", { text: "x", quoteMessageId: "false_" + MEMBER + "_3EB0UNKNOWN", idempotencyKey: randomUUID() }),
    );
    expect(unknown.code).toBe("quote_unresolvable");
    const sendsBefore = t.gateway.sends.length;
    const foreign = await rejection(
      executeOpenwaTool(db, binding, "openwa_send", { text: "x", quoteMessageId: "false_" + OTHER + "_3EB0FOREIGN", idempotencyKey: randomUUID() }),
    );
    expect(foreign.code).toBe("quote_unresolvable");
    expect(t.gateway.sends.length).toBe(sendsBefore);
    t.gateway.numbers.set("628999000111", false);
    const missing = await rejection(executeOpenwaTool(db, binding, "openwa_send", { chat: "+628999000111", text: "hello", idempotencyKey: randomUUID() }));
    expect(missing.code).toBe("number_not_on_whatsapp");
    expect(missing.message).not.toContain("628999000111");
    expect(t.gateway.sends.some((send) => send.chatId === "628999000111@c.us")).toBe(false);
    const checked = await executeOpenwaTool(db, binding, "openwa_send", { chat: "+628999000222", text: "hello", idempotencyKey: randomUUID() });
    expect(checked).toMatchObject({ state: "delivered", chatRef: "openwa:" + SESSION_ID + ":628999000222@c.us", answeredTriggerIds: [] });
    expect(t.gateway.requests.filter((entry) => entry.path.includes("/contacts/check/")).length).toBe(2);
  });

  it("lets a read_only run reply to its origin chat under the reply policy and gates other chats", async () => {
    const t = await setup();
    const c = await conversation(t, MEMBER);
    const pending = await trigger(t, c, { triggerClass: "other", role: "allowed" });
    const binding = await run(t, c, { triggerClass: "other" });
    await expect(executeOpenwaTool(db, binding, "openwa_send", { text: "On it", idempotencyKey: randomUUID() })).resolves.toMatchObject({
      state: "delivered",
      answeredTriggerIds: [pending.id],
    });
    const sends = t.gateway.sends.length;
    const crossChat = await rejection(executeOpenwaTool(db, binding, "openwa_send", { chat: "+628444000222", text: "psst", idempotencyKey: randomUUID() }));
    expect(crossChat.code).toBe("approval_required");
    expect(crossChat.details).toMatchObject({ code: "approval_required", category: "cross_chat_send" });
    const group = await rejection(executeOpenwaTool(db, binding, "openwa_send", { chat: GROUP, text: "psst", idempotencyKey: randomUUID() }));
    expect(group.details).toMatchObject({ category: "cross_chat_send" });
    expect(t.gateway.sends.length).toBe(sends);
  });

  it("marks owners in openwa_find and keeps owner DMs from an owner_absent run behind approval", async () => {
    const t = await setup();
    const [endpoint] = await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, t.endpointId));
    const [principal] = await db
      .insert(chatExternalPrincipals)
      .values({ companyId: t.companyId, provider: "openwa", providerAccountId: endpoint!.providerAccountId!, externalId: OTHER })
      .returning();
    const [link] = await db
      .insert(chatIdentityLinks)
      .values({ companyId: t.companyId, endpointId: t.endpointId, principalId: principal!.id, paperclipUserId: t.userId, status: "linked" })
      .returning();
    await db.insert(chatEndpointOwners).values({ companyId: t.companyId, endpointId: t.endpointId, identityLinkId: link!.id, addedByUserId: t.userId });
    const c = await conversation(t, GROUP);
    await trigger(t, c, { triggerClass: "other", role: "allowed" });
    const absent = await run(t, c, { triggerClass: "other" });
    await db
      .update(heartbeatRuns)
      .set({ contextSnapshot: sql`jsonb_set(${heartbeatRuns.contextSnapshot}, '{paperclipOpenwa,event}', '"owner_absent"')` })
      .where(eq(heartbeatRuns.id, absent.runId));
    t.gateway.lids.set("105000000006444@lid", "628444000222");
    await expect(executeOpenwaTool(db, absent, "openwa_find", { lid: "105000000006444@lid" })).resolves.toMatchObject({ role: "owner" });
    t.gateway.lids.set("105000000009999@lid", "628555000999");
    expect(await executeOpenwaTool(db, absent, "openwa_find", { lid: "105000000009999@lid" })).not.toHaveProperty("role");
    const ownerDm = await rejection(executeOpenwaTool(db, absent, "openwa_send", { chat: "+628444000222", text: "psst", idempotencyKey: randomUUID() }));
    expect(ownerDm.code).toBe("approval_required");
  });

  it("answers an owner_absent outside_allowlist group member with one merged approval and a holding reply", async () => {
    const t = await setup();
    const [endpoint] = await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, t.endpointId));
    const principalFor = async (externalId: string) =>
      (await db.insert(chatExternalPrincipals).values({ companyId: t.companyId, provider: "openwa", providerAccountId: endpoint!.providerAccountId!, externalId }).returning())[0]!.id;
    const ownerPrincipal = await principalFor(OTHER);
    const [link] = await db
      .insert(chatIdentityLinks)
      .values({ companyId: t.companyId, endpointId: t.endpointId, principalId: ownerPrincipal, paperclipUserId: t.userId, status: "linked" })
      .returning();
    await db.insert(chatEndpointOwners).values({ companyId: t.companyId, endpointId: t.endpointId, identityLinkId: link!.id, addedByUserId: t.userId });
    const stranger = await principalFor(MEMBER);
    const g = await conversation(t, GROUP, { activation: "on" });
    const quoted = await trigger(t, g, { triggerClass: "other", role: "outside_allowlist", principalId: stranger, rules: [] });
    const absent = await run(t, g, { triggerClass: "other", event: "owner_absent", requesterPrincipalId: stranger });
    const ask = (binding: typeof absent, categories: string[]) =>
      executeOpenwaTool(db, binding, "openwa_request_approval", {
        categories,
        scope: "one_action",
        summary: "Member asks the owner about the invoice",
        proposedAction: "Reply that the invoice is being checked",
        messageToOwners: "Member asked about the invoice. Approve the suggested reply?",
        idempotencyKey: randomUUID(),
      }) as Promise<{ requestId: string; reused?: boolean; categories?: string[] }>;
    const ownerBubbles = () => t.gateway.sends.filter((send) => send.chatId === OTHER).length;
    const first = await ask(absent, ["reply"]);
    const requestOf = async (id: string) => (await db.select().from(chatOwnerApprovalRequests).where(eq(chatOwnerApprovalRequests.id, id)))[0]!;
    expect((await requestOf(first.requestId)).categories).toEqual(["reply", "reply_outside_allowlist"]);
    expect(ownerBubbles()).toBe(1);
    const second = await ask(absent, ["reply_outside_allowlist"]);
    expect(second).toMatchObject({ requestId: first.requestId, reused: true, categories: ["reply", "reply_outside_allowlist"] });
    expect(ownerBubbles()).toBe(1);
    const third = await ask(absent, ["create_task"]);
    expect(third.requestId).not.toBe(first.requestId);
    expect(third).not.toHaveProperty("reused");
    expect((await requestOf(third.requestId)).categories).toEqual(["create_task", "reply_outside_allowlist"]);
    expect(ownerBubbles()).toBe(2);
    expect((await requestOf(first.requestId)).categories).toEqual(["reply", "reply_outside_allowlist"]);
    expect(
      (await db.select().from(chatOwnerApprovalRequests).where(eq(chatOwnerApprovalRequests.endpointId, t.endpointId))).map((row) => row.id).sort(),
    ).toEqual([first.requestId, third.requestId].sort());
    const merged = await db
      .select()
      .from(chatAuditEntries)
      .where(and(eq(chatAuditEntries.endpointId, t.endpointId), eq(chatAuditEntries.kind, "approval_requested")));
    expect(merged.map((entry) => (entry.metadata as { merged?: boolean }).merged === true).sort()).toEqual([false, false, true]);
    await expect(
      executeOpenwaTool(db, absent, "openwa_send", { text: "holding reply", quoteMessageId: quoted.waMessageId, idempotencyKey: randomUUID() }),
    ).resolves.toMatchObject({ state: "delivered" });
    const otherRun = await run(t, g, { triggerClass: "other", event: "owner_absent", requesterPrincipalId: stranger });
    const fresh = await ask(otherRun, ["reply"]);
    expect(fresh.requestId).not.toBe(first.requestId);
    expect(fresh).not.toHaveProperty("reused");
    expect(ownerBubbles()).toBe(3);
    await resolveOpenwaApproval(db, {
      companyId: t.companyId,
      endpointId: t.endpointId,
      requestId: fresh.requestId,
      decision: "reject",
      via: "paperclip",
      owner: { userId: t.userId },
      ownerText: null,
    });
    const leftover = await trigger(t, g, { triggerClass: "other", role: "outside_allowlist", principalId: stranger, rules: [], event: "owner_absent" });
    const rejected = await run(t, g, { triggerClass: "other", event: "approval_resolved", requesterPrincipalId: stranger });
    const refused = await rejection(
      executeOpenwaTool(db, rejected, "openwa_send", { text: "after rejection", quoteMessageId: leftover.waMessageId, idempotencyKey: randomUUID() }),
    );
    expect(refused.code).toBe("reply_denied");
    expect(refused.details).toMatchObject({ category: "reply_outside_allowlist" });
    const resolved = await resolveOpenwaApproval(db, {
      companyId: t.companyId,
      endpointId: t.endpointId,
      requestId: first.requestId,
      decision: "approve",
      via: "paperclip",
      owner: { userId: t.userId },
      ownerText: null,
    });
    const grants = await db.select().from(chatOwnerGrants).where(eq(chatOwnerGrants.requestId, first.requestId));
    expect(grants.map((grant) => grant.category).sort()).toEqual(["reply", "reply_outside_allowlist"]);
    const granted = await run(t, g, { triggerClass: "grant", event: "approval_resolved", grantIds: resolved.grantIds, requesterPrincipalId: stranger });
    await expect(
      executeOpenwaTool(db, granted, "openwa_send", { text: "approved reply", quoteMessageId: quoted.waMessageId, idempotencyKey: randomUUID() }),
    ).resolves.toMatchObject({ state: "delivered" });
    expect(t.gateway.sends.filter((send) => send.chatId === GROUP).map((send) => send.text)).toEqual(["holding reply", "approved reply"]);

    await t.service.openwa.updatePolicy(t.endpointId, { groupMemberReplies: false }, t.userId);
    const late = await trigger(t, g, { triggerClass: "other", role: "outside_allowlist", principalId: stranger, rules: [] });
    const strict = await run(t, g, { triggerClass: "other", event: "owner_absent", requesterPrincipalId: stranger });
    const denied = await rejection(
      executeOpenwaTool(db, strict, "openwa_send", { text: "blocked holding reply", quoteMessageId: late.waMessageId, idempotencyKey: randomUUID() }),
    );
    expect(denied.code).toBe("reply_denied");
    expect(denied.details).toMatchObject({ category: "reply_outside_allowlist" });
  });

  it("mints an auto-added reply_outside_allowlist as a one_action grant on a requester-scoped approval", async () => {
    const t = await setup();
    const [endpoint] = await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, t.endpointId));
    const principalFor = async (externalId: string) =>
      (await db.insert(chatExternalPrincipals).values({ companyId: t.companyId, provider: "openwa", providerAccountId: endpoint!.providerAccountId!, externalId }).returning())[0]!.id;
    const [link] = await db
      .insert(chatIdentityLinks)
      .values({ companyId: t.companyId, endpointId: t.endpointId, principalId: await principalFor(OTHER), paperclipUserId: t.userId, status: "linked" })
      .returning();
    await db.insert(chatEndpointOwners).values({ companyId: t.companyId, endpointId: t.endpointId, identityLinkId: link!.id, addedByUserId: t.userId });
    const stranger = await principalFor(MEMBER);
    const g = await conversation(t, GROUP, { activation: "on" });
    await trigger(t, g, { triggerClass: "other", role: "outside_allowlist", principalId: stranger, rules: [] });
    const asking = await run(t, g, { triggerClass: "other", requesterPrincipalId: stranger });
    const created = (await executeOpenwaTool(db, asking, "openwa_request_approval", {
      categories: ["external_tools"],
      scope: "requester",
      summary: "Member wants the vendor emailed",
      proposedAction: "Email the vendor",
      messageToOwners: "Member asks to email the vendor. Approve?",
      idempotencyKey: randomUUID(),
    })) as { requestId: string };
    expect(t.gateway.sends.filter((send) => send.chatId === OTHER)).toHaveLength(1);
    const [request] = await db.select().from(chatOwnerApprovalRequests).where(eq(chatOwnerApprovalRequests.id, created.requestId));
    expect(request).toMatchObject({ scope: "requester", categories: ["external_tools", "reply_outside_allowlist"] });
    const resolved = await resolveOpenwaApproval(db, {
      companyId: t.companyId,
      endpointId: t.endpointId,
      requestId: created.requestId,
      decision: "approve",
      via: "paperclip",
      owner: { userId: t.userId },
      ownerText: null,
    });
    const scopes = Object.fromEntries(
      (await db.select().from(chatOwnerGrants).where(eq(chatOwnerGrants.requestId, created.requestId))).map((grant) => [grant.category, grant.scope]),
    );
    expect(scopes).toEqual({ external_tools: "requester", reply_outside_allowlist: "one_action" });
    const granted = await run(t, g, { triggerClass: "grant", event: "approval_resolved", grantIds: resolved.grantIds, requesterPrincipalId: stranger });
    await expect(executeOpenwaTool(db, granted, "openwa_send", { text: "approved once", idempotencyKey: randomUUID() })).resolves.toMatchObject({ state: "delivered" });
    const outsideGrant = (await db.select().from(chatOwnerGrants).where(eq(chatOwnerGrants.requestId, created.requestId))).find((grant) => grant.category === "reply_outside_allowlist")!;
    expect(outsideGrant).toMatchObject({ status: "consumed", consumedByRunId: granted.runId });
    await trigger(t, g, { triggerClass: "other", role: "outside_allowlist", principalId: stranger, rules: [] });
    const later = await run(t, g, { triggerClass: "other", grantIds: resolved.grantIds, requesterPrincipalId: stranger });
    const again = await rejection(executeOpenwaTool(db, later, "openwa_send", { text: "second", idempotencyKey: randomUUID() }));
    expect(again.code).toBe("reply_denied");
    expect(again.details).toMatchObject({ category: "reply_outside_allowlist" });
  });

  it("refuses an approval_reply run's send to the request's origin chat but lets it answer the owner", async () => {
    const t = await setup();
    const ownerDm = await conversation(t, OTHER);
    const [requestRow] = await db
      .insert(chatOwnerApprovalRequests)
      .values({ companyId: t.companyId, endpointId: t.endpointId, originChatKey: openwaChatKey(GROUP), categories: ["reply"], scope: "one_action", summary: "owner absent", proposedAction: "post the suggested reply", status: "approved" })
      .returning();
    await trigger(t, ownerDm, { triggerClass: "owner", role: "owner" });
    const binding = await run(t, ownerDm, { triggerClass: "owner", event: "approval_reply" });
    await db
      .update(heartbeatRuns)
      .set({ contextSnapshot: sql`jsonb_set(jsonb_set(${heartbeatRuns.contextSnapshot}, '{paperclipOpenwa,event}', '"approval_reply"'), '{paperclipOpenwa,approvalRequestId}', to_jsonb(${requestRow!.id}::text))` })
      .where(eq(heartbeatRuns.id, binding.runId));
    const toGroup = await rejection(executeOpenwaTool(db, binding, "openwa_send", { chat: GROUP, text: "posting it myself", idempotencyKey: randomUUID() }));
    expect(toGroup.code).toBe("approval_action_pending");
    expect(t.gateway.sends.some((send) => send.text === "posting it myself")).toBe(false);
    await expect(executeOpenwaTool(db, binding, "openwa_send", { text: "approved, posting now", idempotencyKey: randomUUID() })).resolves.toMatchObject({ state: "delivered" });
  });

  it("lets a cross_chat_send grant lift the gate exactly once", async () => {
    const t = await setup();
    const c = await conversation(t, MEMBER);
    const [requestRow] = await db
      .insert(chatOwnerApprovalRequests)
      .values({ companyId: t.companyId, endpointId: t.endpointId, originChatKey: openwaChatKey(MEMBER), categories: ["cross_chat_send"], scope: "one_action", summary: "forward", proposedAction: "forward", status: "approved" })
      .returning();
    const [grant] = await db
      .insert(chatOwnerGrants)
      .values({ companyId: t.companyId, endpointId: t.endpointId, requestId: requestRow!.id, originChatKey: openwaChatKey(MEMBER), category: "cross_chat_send", scope: "one_action", approvedVia: "paperclip", expiresAt: new Date(Date.now() + 3_600_000) })
      .returning();
    const binding = await run(t, c, { triggerClass: "grant", grantIds: [grant!.id] });
    t.gateway.failNextSend({ dropResponseAfterStore: true });
    const approved = { chat: "+628444000222", text: "approved", idempotencyKey: randomUUID() };
    await expect(executeOpenwaTool(db, binding, "openwa_send", approved)).resolves.toMatchObject({ state: "uncertain" });
    const [consumed] = await db.select().from(chatOwnerGrants).where(eq(chatOwnerGrants.id, grant!.id));
    expect(consumed).toMatchObject({ status: "consumed", consumedByRunId: binding.runId });
    await db.update(chatOwnerGrants).set({ consumedByRunId: null }).where(eq(chatOwnerGrants.id, grant!.id));
    await expect(executeOpenwaTool(db, binding, "openwa_send", approved)).resolves.toMatchObject({ state: "delivered" });
    expect(t.gateway.sends.filter((send) => send.text === "approved")).toHaveLength(1);
    const again = await rejection(executeOpenwaTool(db, binding, "openwa_send", { chat: "+628444000222", text: "again", idempotencyKey: randomUUID() }));
    expect(again.code).toBe("approval_required");
  });

  it("denies origin replies the reply policy holds back and the outside_allowlist rule", async () => {
    const t = await setup({ replyPolicy: "ask_owner" });
    const c = await conversation(t, MEMBER);
    await trigger(t, c, { triggerClass: "other", role: "allowed" });
    const binding = await run(t, c, { triggerClass: "other" });
    const denied = await rejection(executeOpenwaTool(db, binding, "openwa_send", { text: "hi", idempotencyKey: randomUUID() }));
    expect(denied.code).toBe("reply_denied");
    expect(denied.details).toMatchObject({ category: "reply" });
    expect(t.gateway.sends).toHaveLength(0);
    const g = await conversation(t, GROUP, { replyPolicy: "allowed" });
    await trigger(t, g, { triggerClass: "other", role: "outside_allowlist" });
    const outside = await rejection(executeOpenwaTool(db, await run(t, g, { triggerClass: "other" }), "openwa_send", { text: "hi", idempotencyKey: randomUUID() }));
    expect(outside.details).toMatchObject({ code: "reply_denied", category: "reply_outside_allowlist" });
    const owner = await run(t, c, { triggerClass: "owner" });
    await expect(executeOpenwaTool(db, owner, "openwa_send", { text: "owner reply", idempotencyKey: randomUUID() })).resolves.toMatchObject({ state: "delivered" });
  });

  it("lets an outside_allowlist member who addressed the agent in an active group get a reply without a grant", async () => {
    const t = await setup();
    const g = await conversation(t, GROUP, { activation: "on" });
    await trigger(t, g, { triggerClass: "other", role: "outside_allowlist", rules: ["agent_mentioned"] });
    await expect(
      executeOpenwaTool(db, await run(t, g, { triggerClass: "other" }), "openwa_send", { text: "group answer", idempotencyKey: randomUUID() }),
    ).resolves.toMatchObject({ state: "delivered" });
    const quoted = await conversation(t, "120363000000000666@g.us", { activation: "on" });
    await trigger(t, quoted, { triggerClass: "other", role: "outside_allowlist", rules: ["reply_to_agent"] });
    await expect(
      executeOpenwaTool(db, await run(t, quoted, { triggerClass: "other" }), "openwa_send", { text: "quoted answer", idempotencyKey: randomUUID() }),
    ).resolves.toMatchObject({ state: "delivered" });
    const unaddressed = await conversation(t, "120363000000000777@g.us", { activation: "on" });
    await trigger(t, unaddressed, { triggerClass: "other", role: "outside_allowlist", rules: ["keywords"] });
    const keyword = await rejection(
      executeOpenwaTool(db, await run(t, unaddressed, { triggerClass: "other" }), "openwa_send", { text: "hi", idempotencyKey: randomUUID() }),
    );
    expect(keyword.details).toMatchObject({ code: "reply_denied", category: "reply_outside_allowlist" });
    const inactive = await conversation(t, "120363000000000888@g.us", { activation: "off" });
    await trigger(t, inactive, { triggerClass: "other", role: "outside_allowlist", rules: ["agent_mentioned"] });
    const off = await rejection(
      executeOpenwaTool(db, await run(t, inactive, { triggerClass: "other" }), "openwa_send", { text: "hi", idempotencyKey: randomUUID() }),
    );
    expect(off.details).toMatchObject({ code: "reply_denied", category: "reply_outside_allowlist" });
    const dm = await conversation(t, OTHER);
    await trigger(t, dm, { triggerClass: "other", role: "outside_allowlist", rules: ["agent_mentioned", "direct_message"] });
    const direct = await rejection(
      executeOpenwaTool(db, await run(t, dm, { triggerClass: "other" }), "openwa_send", { text: "hi", idempotencyKey: randomUUID() }),
    );
    expect(direct.details).toMatchObject({ code: "reply_denied", category: "reply_outside_allowlist" });
    expect(t.gateway.sends.map((send) => send.text)).toEqual(["group answer", "quoted answer"]);
  });

  it("requires reply_outside_allowlist for an addressed group member while groupMemberReplies is off, and audits the switch", async () => {
    const t = await setup();
    const g = await conversation(t, GROUP, { activation: "on" });
    await trigger(t, g, { triggerClass: "other", role: "outside_allowlist", rules: ["agent_mentioned"] });
    const binding = await run(t, g, { triggerClass: "other" });
    await t.service.openwa.updatePolicy(t.endpointId, { groupMemberReplies: false }, t.userId);
    const denied = await rejection(executeOpenwaTool(db, binding, "openwa_send", { text: "hi", idempotencyKey: randomUUID() }));
    expect(denied.details).toMatchObject({ code: "reply_denied", category: "reply_outside_allowlist" });
    expect(t.gateway.sends).toHaveLength(0);
    const changes = await db
      .select({ details: activityLog.details })
      .from(activityLog)
      .where(and(eq(activityLog.entityId, t.endpointId), eq(activityLog.action, "openwa.config_changed")));
    expect(changes.map((row) => (row.details as { changed: string[] }).changed)).toEqual([["groupMemberReplies"]]);
    await t.service.openwa.updatePolicy(t.endpointId, { groupMemberReplies: true }, t.userId);
    await expect(executeOpenwaTool(db, binding, "openwa_send", { text: "member answer", idempotencyKey: randomUUID() })).resolves.toMatchObject({
      state: "delivered",
    });
    expect(t.gateway.sends.map((send) => send.text)).toEqual(["member answer"]);
  });

  it("replays an idempotent retry without resending and rejects a reused key", async () => {
    const t = await setup();
    const c = await conversation(t, MEMBER);
    const binding = await run(t, c, { triggerClass: "owner" });
    const args = { text: "Once only", idempotencyKey: randomUUID() };
    const first = await executeOpenwaTool(db, binding, "openwa_send", args);
    const second = await executeOpenwaTool(db, binding, "openwa_send", args);
    expect(second).toMatchObject({ actionId: first.actionId, state: "delivered", replayed: true, messageIds: first.messageIds });
    expect(t.gateway.sends.filter((send) => send.text === "Once only")).toHaveLength(1);
    const conflict = await rejection(executeOpenwaTool(db, binding, "openwa_send", { ...args, text: "Different" }));
    expect(conflict.code).toBe("idempotency_conflict");
    const otherRun = await run(t, c, { triggerClass: "owner" });
    await executeOpenwaTool(db, otherRun, "openwa_send", args);
    expect(t.gateway.sends.filter((send) => send.text === "Once only")).toHaveLength(2);
  });

  it("reconciles an uncertain send through the outbound registry instead of resending", async () => {
    const t = await setup();
    const c = await conversation(t, MEMBER);
    const binding = await run(t, c, { triggerClass: "owner" });
    t.gateway.failNextSend({ dropResponseAfterStore: true });
    const args = { text: "Lost response", idempotencyKey: randomUUID() };
    const first = await executeOpenwaTool(db, binding, "openwa_send", args);
    expect(first).toMatchObject({ state: "uncertain" });
    const [action] = await db.select().from(chatActions).where(eq(chatActions.id, String(first.actionId)));
    expect(action!.status).toBe("uncertain");
    const second = await executeOpenwaTool(db, binding, "openwa_send", args);
    expect(second).toMatchObject({ state: "delivered" });
    const stored = t.gateway.rows.filter((row) => row.body === "Lost response");
    expect(stored).toHaveLength(1);
    expect(second.messageIds).toEqual([stored[0]!.waMessageId]);
    expect(t.gateway.sends.filter((send) => send.text === "Lost response")).toHaveLength(1);
    const outbound = await db.select().from(chatOutboundMessages).where(and(eq(chatOutboundMessages.endpointId, t.endpointId), eq(chatOutboundMessages.source, "tool")));
    expect(outbound).toHaveLength(1);
    expect(outbound[0]).toMatchObject({ state: "sent", providerMessageId: stored[0]!.waMessageId });
  });

  it("surfaces pacing as retry_after with seconds and audits the pacing flag", async () => {
    const t = await setup();
    const c = await conversation(t, MEMBER);
    const binding = await run(t, c, { triggerClass: "owner" });
    t.gateway.failNextSend({ status: 429, body: { code: "SEND_PACING_LIMITED", retryAfterSeconds: 7, message: "paced" } });
    const paced = await rejection(executeOpenwaTool(db, binding, "openwa_send", { text: "slow", idempotencyKey: randomUUID() }));
    expect(paced.code).toBe("retry_after");
    expect(paced.details).toMatchObject({ retryAfterSeconds: 7, pacing: true, state: "failed" });
    expect(paced.message).toContain("7 seconds");
    const [audit] = await db.select().from(chatAuditEntries).where(and(eq(chatAuditEntries.endpointId, t.endpointId), eq(chatAuditEntries.kind, "tool_called")));
    expect(audit!.metadata).toMatchObject({ errorCode: "retry_after", pacing: true });
  });

  it("caps read results at 16 KB with a continuation cursor", async () => {
    const t = await setup();
    const c = await conversation(t, MEMBER);
    for (let index = 0; index < 60; index++) t.gateway.inbound({ chatId: MEMBER, body: index + ":" + "x".repeat(1800), emit: false });
    const binding = await run(t, c, { triggerClass: "other" });
    const first = await executeOpenwaTool(db, binding, "openwa_read_chat", { limit: 60 });
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(16_384);
    expect(first).toMatchObject({ truncated: true, source: "stored" });
    expect(String(first.nextCursor)).toMatch(/^s:/);
    const firstIds = (first.messages as Array<{ id: string }>).map((message) => message.id);
    const second = await executeOpenwaTool(db, binding, "openwa_read_chat", { cursor: first.nextCursor, limit: 60 });
    const secondIds = (second.messages as Array<{ id: string }>).map((message) => message.id);
    expect(secondIds.length).toBeGreaterThan(0);
    expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
    expect(JSON.stringify(first)).not.toContain("base64");
    const live = await executeOpenwaTool(db, binding, "openwa_read_chat", { source: "live", limit: 60 });
    expect(Buffer.byteLength(JSON.stringify(live))).toBeLessThanOrEqual(16_384);
    expect(String(live.nextCursor)).toMatch(/^l:\d+$/);
  });

  it("reads any visible chat in agent_number mode but only enabled chats in owner_number mode", async () => {
    const agentNumber = await setup();
    const c1 = await conversation(agentNumber, MEMBER);
    await expect(executeOpenwaTool(db, await run(agentNumber, c1, { triggerClass: "other" }), "openwa_read_chat", { chat: "+628444000222" })).resolves.toMatchObject({
      chatRef: "openwa:" + SESSION_ID + ":" + OTHER,
    });
    await agentNumber.service.shutdown();
    services.splice(services.indexOf(agentNumber.service), 1);
    await db.update(chatEndpoints).set({ status: "archived" }).where(eq(chatEndpoints.id, agentNumber.endpointId));
    const ownerNumber = await setup({ numberMode: "owner_number" });
    const c2 = await conversation(ownerNumber, MEMBER, { activation: "on" });
    const binding = await run(ownerNumber, c2, { triggerClass: "other" });
    await expect(executeOpenwaTool(db, binding, "openwa_read_chat", {})).resolves.toMatchObject({ chatRef: c2.chatRef });
    const hidden = await rejection(executeOpenwaTool(db, binding, "openwa_read_chat", { chat: "+628444000222" }));
    expect(hidden.code).toBe("chat_inactive");
    await conversation(ownerNumber, OTHER, { activation: "on" });
    await expect(executeOpenwaTool(db, binding, "openwa_read_chat", { chat: "+628444000222" })).resolves.toMatchObject({ chatRef: "openwa:" + SESSION_ID + ":" + OTHER });
    ownerNumber.gateway.chats.push({ id: GROUP, name: "Hidden group" }, { id: OTHER, name: "Visible friend" });
    const found = await executeOpenwaTool(db, binding, "openwa_find", { query: "i" });
    expect((found.chats as Array<{ name: string }>).map((chat) => chat.name)).toEqual(["Visible friend"]);
  });

  it("marks triggers silenced or handed off and stores the handoff note", async () => {
    const t = await setup();
    const c = await conversation(t, MEMBER);
    const a = await trigger(t, c, { triggerClass: "other", role: "allowed" });
    const b = await trigger(t, c, { triggerClass: "other", role: "allowed" });
    const binding = await run(t, c, { triggerClass: "other" });
    await expect(executeOpenwaTool(db, binding, "openwa_stay_silent", { triggerIds: [a.id] })).resolves.toEqual({ silenced: [a.id] });
    expect(await answerStates([a.id, b.id])).toEqual(["silenced", "pending"]);
    await expect(executeOpenwaTool(db, binding, "openwa_stay_silent", {})).resolves.toEqual({ silenced: [b.id] });
    const owner = await trigger(t, c, { triggerClass: "owner", role: "owner" });
    const other = await trigger(t, c, { triggerClass: "other", role: "allowed" });
    const refused = await rejection(executeOpenwaTool(db, binding, "openwa_handoff", { triggerIds: [owner.id, other.id], note: "Needs the owner" }));
    expect(refused.code).toBe("owner_only");
    expect(await answerStates([owner.id, other.id])).toEqual(["pending", "pending"]);
    const handed = await executeOpenwaTool(db, binding, "openwa_handoff", { triggerIds: [owner.id], note: "Needs the owner's pricing call" });
    expect(handed).toMatchObject({ handedOff: [owner.id] });
    expect(await answerStates([owner.id])).toEqual(["handed_off"]);
    const [stored] = await db.select().from(chatActions).where(eq(chatActions.id, String(handed.handoffId)));
    expect(stored).toMatchObject({ kind: "openwa_handoff", status: "received", conversationId: c.id });
    expect(stored!.payload).toMatchObject({ runId: binding.runId, issueId: c.issueId, triggerIds: [owner.id], note: "Needs the owner's pricing call", chatKey: openwaChatKey(MEMBER) });
  });

  it("stores media as an attachment and sends task attachments as voice notes", async () => {
    const t = await setup();
    const c = await conversation(t, MEMBER);
    const binding = await run(t, c, { triggerClass: "owner" });
    const row = t.gateway.inbound({ chatId: MEMBER, body: "", emit: false });
    t.gateway.setMedia(MEMBER, row.waMessageId!, { body: Buffer.from("%PDF-1.4 tool test"), contentType: "application/pdf", filename: "invoice.pdf" });
    const media = await executeOpenwaTool(db, binding, "openwa_get_media", { messageId: row.waMessageId });
    const [item] = media.media as Array<Record<string, unknown>>;
    expect(item).toMatchObject({ status: "stored", mime: "application/pdf", filename: "invoice.pdf" });
    expect(typeof item!.attachmentId).toBe("string");
    expect(path.isAbsolute(String(item!.localPath))).toBe(true);
    expect(String(item!.localPath).startsWith(await realpath(path.join(root, "storage")) + path.sep)).toBe(true);
    expect(await readFile(String(item!.localPath), "utf8")).toBe("%PDF-1.4 tool test");
    expect(item).not.toHaveProperty("contentPath");
    expect(JSON.stringify(media)).not.toContain(Buffer.from("%PDF-1.4 tool test").toString("base64"));
    const voice = Buffer.from("OggS-voice");
    const put = await storage.putFile({ companyId: t.companyId, namespace: "issues/" + c.issueId, originalFilename: "note.ogg", contentType: "audio/ogg", body: voice });
    const [asset] = await db.insert(assets).values({ companyId: t.companyId, provider: put.provider, objectKey: put.objectKey, contentType: put.contentType, byteSize: put.byteSize, sha256: put.sha256, originalFilename: "note.ogg" }).returning();
    const [attachment] = await db.insert(issueAttachments).values({ companyId: t.companyId, issueId: c.issueId, assetId: asset!.id }).returning();
    await expect(executeOpenwaTool(db, binding, "openwa_send", { kind: "voice", attachmentId: attachment!.id, idempotencyKey: randomUUID() })).resolves.toMatchObject({ state: "delivered" });
    expect(t.gateway.mediaSends.at(-1)).toMatchObject({ kind: "audio", ptt: true, bytes: voice.length, mimetype: "audio/ogg" });
    const foreign = await rejection(executeOpenwaTool(db, binding, "openwa_send", { kind: "image", attachmentId: randomUUID(), idempotencyKey: randomUUID() }));
    expect(foreign.code).toBe("attachment_unavailable");
  });

  it("resolves local attachment paths only for files inside the local-disk storage root", async () => {
    const t = await setup();
    const c = await conversation(t, MEMBER);
    const put = await storage.putFile({ companyId: t.companyId, namespace: "issues/" + c.issueId, originalFilename: "a.txt", contentType: "text/plain", body: Buffer.from("inside") });
    const outside = path.join(root, "outside.txt");
    await writeFile(outside, "secret");
    const linkKey = t.companyId + "/issues/" + c.issueId + "/link.txt";
    await mkdir(path.dirname(path.join(root, "storage", linkKey)), { recursive: true });
    await symlink(outside, path.join(root, "storage", linkKey));
    const attach = async (provider: string, objectKey: string) => {
      const [asset] = await db.insert(assets).values({ companyId: t.companyId, provider, objectKey, contentType: "text/plain", byteSize: 6, sha256: put.sha256, originalFilename: "a.txt" }).returning();
      const [attachment] = await db.insert(issueAttachments).values({ companyId: t.companyId, issueId: c.issueId, assetId: asset!.id }).returning();
      return attachment!.id;
    };
    const inside = await attach("local_disk", put.objectKey);
    const escaped = await attach("local_disk", linkKey);
    const remotePut = await storage.putFile({ companyId: t.companyId, namespace: "issues/" + c.issueId, originalFilename: "b.txt", contentType: "text/plain", body: Buffer.from("remote") });
    const remote = await attach("s3", remotePut.objectKey);
    const missing = await attach("local_disk", t.companyId + "/issues/" + c.issueId + "/missing.txt");
    const paths = await openwaAttachmentLocalPaths(db, storage, t.companyId, [inside, escaped, remote, missing]);
    expect([...paths.keys()]).toEqual([inside]);
    expect(await readFile(paths.get(inside)!, "utf8")).toBe("inside");
  });

  it("finds numbers and LIDs with masked phones", async () => {
    const t = await setup();
    const c = await conversation(t, MEMBER);
    const binding = await run(t, c, { triggerClass: "other" });
    t.gateway.numbers.set("628777000111", false);
    await expect(executeOpenwaTool(db, binding, "openwa_find", { phone: "+628777000111" })).resolves.toEqual({ phone: "+62xxx...0111", exists: false, chatRef: null });
    t.gateway.lids.set("123456789012@lid", "628666000999");
    await expect(executeOpenwaTool(db, binding, "openwa_find", { lid: "123456789012@lid" })).resolves.toMatchObject({ phone: "+62xxx...0999", chatRef: "openwa:" + SESSION_ID + ":628666000999@c.us" });
    t.gateway.contacts.push({ id: "628666000999@c.us", name: "Budi Santoso", number: "628666000999" });
    const found = await executeOpenwaTool(db, binding, "openwa_find", { query: "budi" });
    expect(found.contacts).toEqual([{ chatRef: "openwa:" + SESSION_ID + ":628666000999@c.us", name: "Budi Santoso", phone: "+62xxx...0999" }]);
    expect(JSON.stringify(found)).not.toContain("628666000999\"");
  });

  it("pages oversized find results under 16 KB and truncates long media transcripts with a flag", async () => {
    const t = await setup();
    const c = await conversation(t, MEMBER);
    const binding = await run(t, c, { triggerClass: "owner" });
    const wide = "名".repeat(200);
    for (let index = 0; index < 20; index++) {
      const digits = "6287770" + String(index).padStart(5, "0");
      t.gateway.chats.push({ id: digits + "@c.us", name: "Zed " + wide + index });
      t.gateway.contacts.push({ id: digits + "@c.us", name: "Zed " + wide + index, number: digits });
    }
    const chats: unknown[] = [];
    const contacts: unknown[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await executeOpenwaTool(db, binding, "openwa_find", { query: "zed", ...(cursor ? { cursor } : {}) });
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(16_384);
      chats.push(...(page.chats as unknown[]));
      contacts.push(...(page.contacts as unknown[]));
      cursor = page.nextCursor as string | null;
      pages++;
    } while (cursor);
    expect(pages).toBeGreaterThan(1);
    expect(chats).toHaveLength(20);
    expect(contacts).toHaveLength(20);
    expect(new Set(chats.map((chat) => (chat as { chatRef: string }).chatRef)).size).toBe(20);
    expect((await rejection(executeOpenwaTool(db, binding, "openwa_find", { query: "zed", cursor: "l:5" }))).code).toBe("invalid_cursor");

    const row = t.gateway.inbound({ chatId: MEMBER, body: "", emit: false });
    const transcript = "語".repeat(8_000);
    await db.insert(chatActions).values({
      companyId: t.companyId,
      endpointId: t.endpointId,
      kind: "openwa_media",
      providerActionId: "openwa_media:" + row.waMessageId,
      status: "processed",
      payload: {
        version: 1,
        issueId: c.issueId,
        commentId: null,
        chatId: MEMBER,
        waMessageId: row.waMessageId,
        items: [1, 2].map(() => ({
          kind: "voice",
          waMessageId: row.waMessageId,
          status: "stored",
          reason: null,
          attachmentId: randomUUID(),
          mime: "audio/ogg",
          size: 4096,
          filename: null,
          transcriptStatus: "done",
          transcript,
        })),
      },
    });
    const media = await executeOpenwaTool(db, binding, "openwa_get_media", { messageId: row.waMessageId });
    expect(Buffer.byteLength(JSON.stringify(media))).toBeLessThanOrEqual(16_384);
    const items = media.media as Array<{ transcript?: string; transcriptTruncated?: boolean }>;
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.transcriptTruncated === true)).toBe(true);
    expect(items[0]!.transcript!.length).toBeGreaterThan(1_000);
    expect(items[0]!.transcript!.startsWith("語語語")).toBe(true);
  });

  it("exposes the tools over HTTP to the bound agent run only", async () => {
    const t = await setup();
    const c = await conversation(t, MEMBER);
    const binding = await run(t, c, { triggerClass: "other" });
    let actor: Record<string, unknown> = { type: "agent", source: "agent_jwt", companyId: t.companyId, agentId: t.agentId, runId: binding.runId };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = actor as never;
      next();
    });
    app.use("/api", openwaToolRoutes(db));
    app.use(errorHandler);
    const url = (companyId: string, issueId: string) => "/api/companies/" + companyId + "/openwa/tasks/" + issueId + "/tools";
    const ok = await request(app).post(url(t.companyId, c.issueId)).send({ tool: "openwa_read_chat", arguments: {} }).expect(200);
    expect(ok.body).toMatchObject({ chatRef: c.chatRef, source: "stored" });
    expect(ok.headers["cache-control"]).toBe("no-store");
    await request(app).post(url(randomUUID(), c.issueId)).send({ tool: "openwa_read_chat", arguments: {} }).expect(403);
    const [plain] = await db.insert(issues).values({ companyId: t.companyId, title: "Not WhatsApp", status: "todo", assigneeAgentId: t.agentId }).returning();
    const plainRun = await run(t, c, { triggerClass: "other", issueId: plain!.id });
    actor = { ...actor, runId: plainRun.runId };
    await request(app).post(url(t.companyId, plain!.id)).send({ tool: "openwa_read_chat", arguments: {} }).expect(403);
    actor = { ...actor, runId: binding.runId };
    await request(app).post(url(t.companyId, plain!.id)).send({ tool: "openwa_read_chat", arguments: {} }).expect(403);
    await request(app).post(url(t.companyId, c.issueId)).send({ tool: "slack_history", arguments: {} }).expect(403);
    await request(app).post(url(t.companyId, c.issueId)).send({ tool: "openwa_read_chat", arguments: { companyId: t.companyId } }).expect(400);
    const denied = await request(app).post(url(t.companyId, c.issueId)).send({ tool: "openwa_send", arguments: { chat: "+628444000222", text: "x", idempotencyKey: randomUUID() } }).expect(403);
    expect(denied.body).toMatchObject({ code: "approval_required", details: { category: "cross_chat_send" } });
    actor = { type: "agent", source: "agent_key", companyId: t.companyId, agentId: t.agentId };
    await request(app).post(url(t.companyId, c.issueId)).send({ tool: "openwa_read_chat", arguments: {} }).expect(403);
    actor = { type: "board", source: "session", userId: t.userId, companyIds: [t.companyId] };
    await request(app).post(url(t.companyId, c.issueId)).send({ tool: "openwa_read_chat", arguments: {} }).expect(403);
    actor = { type: "agent", source: "agent_jwt", companyId: t.companyId, agentId: t.agentId, runId: binding.runId };
    await instanceSettingsService(db).updateExperimental({ enableChatConnectors: false });
    try {
      await request(app).post(url(t.companyId, c.issueId)).send({ tool: "openwa_read_chat", arguments: {} }).expect(403);
    } finally {
      await instanceSettingsService(db).updateExperimental({ enableChatConnectors: true });
    }
  });

  it("lists native runner tools and the skill contract for OpenWA runs only, including child issues", async () => {
    const t = await setup();
    const c = await conversation(t, MEMBER);
    const binding = await run(t, c, { triggerClass: "other" });
    const assignments = await resolveConnectorAssignments(db, binding);
    expect(assignments.map((assignment) => assignment.key)).toEqual(["openwa"]);
    const authority = new PaperclipRunnerToolAuthority(db, { ...binding, connectorAssignments: assignments });
    expect(authority.definitions().map((tool) => String(tool.name)).filter((name) => name.startsWith("openwa_"))).toEqual([
      "openwa_send",
      "openwa_read_chat",
      "openwa_get_media",
      "openwa_find",
      "openwa_request_approval",
      "openwa_approval_resolve",
      "openwa_stay_silent",
      "openwa_handoff",
      "openwa_catalog",
      "openwa_endpoint_config",
      "openwa_linked_list",
      "openwa_linked_read",
      "openwa_describe",
      "openwa_call",
    ]);
    await db.update(heartbeatRuns).set({ runtimeMode: "native", nativeIssueId: c.issueId }).where(eq(heartbeatRuns.id, binding.runId));
    await db.update(issues).set({ executionRunId: binding.runId }).where(eq(issues.id, c.issueId));
    await expect(authority.execute({ tool: "openwa_read_chat", callId: "c1", arguments: {} })).resolves.toMatchObject({ chatRef: c.chatRef });
    const configured = await applyConnectorSkills({ paperclipSkillSync: { desiredSkills: [] } }, [], assignments);
    const bundle = configured.paperclipRuntimeSkills.find((entry) => entry.key === "paperclipai/paperclip/openwa")!;
    expect(JSON.parse(await readFile(path.join(bundle.source, "TOOLS.json"), "utf8")).map((tool: { name: string }) => tool.name)).toContain("openwa_send");
    const native = await prepareConnectorSkillDelivery(configured, "paperclip_runner");
    expect(native.instructions).toContain("openwa_send");
    const [child] = await db.insert(issues).values({ companyId: t.companyId, title: "Child", status: "todo", assigneeAgentId: t.agentId, parentId: c.issueId }).returning();
    const childRun = await run(t, c, { triggerClass: "owner", issueId: child!.id });
    expect((await resolveConnectorAssignments(db, childRun)).map((assignment) => assignment.key)).toEqual(["openwa"]);
    await expect(executeConnectorTool(db, childRun, "openwa_stay_silent", {})).rejects.toMatchObject({ status: 403 });
    await expect(executeConnectorTool(db, childRun, "openwa_read_chat", {})).resolves.toMatchObject({ chatRef: c.chatRef });
    const [plain] = await db.insert(issues).values({ companyId: t.companyId, title: "Plain", status: "todo", assigneeAgentId: t.agentId }).returning();
    expect(await resolveConnectorAssignments(db, { ...binding, issueId: plain!.id })).toEqual([]);
    expect(await resolveConnectorAssignments(db, { ...binding, agentId: randomUUID() })).toEqual([]);
    expect(new PaperclipRunnerToolAuthority(db, { ...binding, issueId: plain!.id }).definitions().some((tool) => String(tool.name).startsWith("openwa_"))).toBe(false);
    await db.update(chatEndpoints).set({ status: "paused" }).where(eq(chatEndpoints.id, t.endpointId));
    expect(await resolveConnectorAssignments(db, binding)).toEqual([]);
  });

  it("adds the openwa MCP toolset per run on the server side", async () => {
    const t = await setup();
    const c = await conversation(t, MEMBER);
    const binding = await run(t, c, { triggerClass: "other" });
    const [plain] = await db.insert(issues).values({ companyId: t.companyId, title: "Plain", status: "todo", assigneeAgentId: t.agentId }).returning();
    const plainRun = await run(t, c, { triggerClass: "other", issueId: plain!.id });
    let actor: Record<string, unknown> = {};
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = actor as never;
      next();
    });
    app.use("/api", paperclipMcpRoutes(db));
    app.use(errorHandler);
    const list = async () =>
      (await request(app).post("/api/mcp/paperclip?toolsets=full").set("authorization", "Bearer token").send({ jsonrpc: "2.0", id: 1, method: "tools/list" }).expect(200)).body.result.tools.map(
        (tool: { name: string }) => tool.name,
      ) as string[];
    actor = { type: "agent", source: "agent_jwt", companyId: t.companyId, agentId: t.agentId, runId: binding.runId };
    expect((await list()).filter((name) => name.startsWith("openwa_")).sort()).toEqual([
      "openwa_approval_resolve",
      "openwa_call",
      "openwa_catalog",
      "openwa_describe",
      "openwa_endpoint_config",
      "openwa_find",
      "openwa_get_media",
      "openwa_handoff",
      "openwa_linked_list",
      "openwa_linked_read",
      "openwa_read_chat",
      "openwa_request_approval",
      "openwa_send",
      "openwa_stay_silent",
    ]);
    const called = await request(app)
      .post("/api/mcp/paperclip")
      .set("authorization", "Bearer token")
      .send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "openwa_read_chat", arguments: {} } })
      .expect(200);
    expect(JSON.parse(called.body.result.content[0].text)).toMatchObject({ chatRef: c.chatRef });
    const gated = await request(app)
      .post("/api/mcp/paperclip")
      .set("authorization", "Bearer token")
      .send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "openwa_send", arguments: { chat: "+628444000222", text: "x", idempotencyKey: randomUUID() } } })
      .expect(200);
    expect(gated.body.result.isError).toBe(true);
    expect(JSON.parse(gated.body.result.content[0].text)).toMatchObject({ error: "approval_required", category: "cross_chat_send" });
    actor = { ...actor, runId: plainRun.runId };
    expect((await list()).some((name) => name.startsWith("openwa_"))).toBe(false);
    actor = { type: "agent", source: "agent_key", companyId: t.companyId, agentId: t.agentId, runId: binding.runId };
    expect((await list()).some((name) => name.startsWith("openwa_"))).toBe(false);
  });
});
