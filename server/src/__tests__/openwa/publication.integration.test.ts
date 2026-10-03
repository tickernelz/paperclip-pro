import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  agents,
  assets,
  authUsers,
  chatActions,
  chatAuditEntries,
  chatConversations,
  chatDeliveries,
  chatEndpointResources,
  chatEndpoints,
  chatExternalPrincipals,
  chatOutboundMessages,
  chatOwnerApprovalRequests,
  chatOwnerGrants,
  chatPublications,
  companies,
  companyMemberships,
  companySecretBindings,
  createDb,
  heartbeatRuns,
  issueAttachments,
  issueComments,
  issues,
  toolConnections,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import type { OpenwaGrantCategory, OpenwaPrincipalRole, OpenwaTriggerClass } from "@tickernelz/paperclip-pro-shared";
import { startEmbeddedPostgresTestDatabase } from "../helpers/embedded-postgres.js";
import type { StorageService } from "../../storage/types.js";
import { chatChannelService, type ChatChannelService } from "../../services/chat-channels.js";
import { ChatSdkRuntime } from "../../services/chat-sdk-runtime.js";
import { hasChatRunOwnedProviderInteraction } from "../../services/chat-interaction-arbitration.js";
import { projectSafeChatPublication } from "../../services/chat-publication-projection.js";
import { issueThreadInteractionService } from "../../services/issue-thread-interactions.js";
import { secretService } from "../../services/secrets.js";
import { OpenwaChatAdapter, openwaThreadId } from "../../services/openwa/adapter.js";
import { createOpenwaGatewayClient } from "../../services/openwa/gateway.js";
import { openwaChatKey, sendThroughRegistry } from "../../services/openwa/outbound.js";
import { markTriggersAnswered, readOpenwaLastOutput } from "../../services/openwa/publication.js";
import { FAKE_OPENWA_KEY, FakeOpenwaGateway } from "./fake-gateway.js";

const SESSION_ID = "22222222-3333-4444-8555-666666666666";
const OWN_PHONE = "628111000999";
const MEMBER = "628222000777@c.us";
const GROUP = "120363000000000777@g.us";
const CREDENTIAL = "sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX";

async function until(predicate: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe.sequential("OpenWA publication (embedded Postgres + fake gateway)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let secrets: string;
  const oldKey = process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
  const services: ChatChannelService[] = [];
  const gateways: FakeOpenwaGateway[] = [];
  const endpointIds: string[] = [];

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-openwa-pub-");
    db = createDb(database.connectionString);
    secrets = await mkdtemp(path.join(tmpdir(), "openwa-pub-secrets-"));
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

  async function setup(policy: Record<string, unknown> = {}) {
    const gateway = new FakeOpenwaGateway({ sessionId: SESSION_ID, ownPhone: OWN_PHONE });
    await gateway.start();
    gateways.push(gateway);
    const companyId = randomUUID();
    const agentId = randomUUID();
    const userId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "OpenWA publication",
      issuePrefix: "P" + companyId.replaceAll("-", "").slice(0, 7).toUpperCase(),
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
    const objects = new Map<string, Buffer>();
    const storage: StorageService = {
      provider: "local_disk",
      putFile: async () => {
        throw new Error("not used");
      },
      getObject: async (_company, key) => ({ stream: Readable.from([objects.get(key)!]), contentLength: objects.get(key)!.length }),
      headObject: async (_company, key) => ({ exists: objects.has(key) }),
      deleteObject: async (_company, key) => {
        objects.delete(key);
      },
    };
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
        policy,
        setup: { step: "complete", testStartedAt: new Date(Date.now() - 60_000).toISOString() },
      })
      .where(eq(chatEndpoints.id, endpoint.id));
    expect((await service.reconcileProviderRuntimes()).local).toBe(1);
    await gateway.waitForSubscription();
    await until(async () => (await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, endpoint.id)))[0]!.status === "active");
    const adapter = runtime.get(endpoint.id)!.getProviderAdapter() as OpenwaChatAdapter;
    expect(adapter).toBeInstanceOf(OpenwaChatAdapter);
    return { gateway, companyId, agentId, userId, endpointId: endpoint.id, service, runtime, adapter, objects };
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
    return { ...row!, chatId, threadId };
  }

  type Conversation = Awaited<ReturnType<typeof conversation>>;

  async function principal(t: Fixture, phone: string) {
    const [row] = await db
      .insert(chatExternalPrincipals)
      .values({ companyId: t.companyId, provider: "openwa", providerAccountId: t.gateway.baseUrl + "#" + SESSION_ID, externalId: phone + "@c.us" })
      .returning();
    return row!.id;
  }

  async function trigger(
    t: Fixture,
    c: Conversation,
    input: { triggerClass: OpenwaTriggerClass; role: OpenwaPrincipalRole; principalId?: string | null; receivedAt?: Date },
  ) {
    const waMessageId = "false_" + c.chatId + "_3EB0" + randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
    const [row] = await db
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
          openwa: { chatKey: openwaChatKey(c.chatId), waMessageId, triggerClass: input.triggerClass, principalRole: input.role, rules: [] },
        },
        state: "processed",
        triggerClass: input.triggerClass,
        principalRole: input.role,
        answerState: "pending",
        receivedAt: input.receivedAt ?? new Date(Date.now() - 60_000),
      })
      .returning();
    return { id: row!.id, waMessageId };
  }

  async function runOutput(
    t: Fixture,
    c: Conversation,
    input: {
      triggerClass: OpenwaTriggerClass;
      body: string;
      deliveryIds?: string[];
      grantIds?: string[];
      event?: string;
      status?: string;
      projected?: boolean;
      attachment?: { filename: string; content: string };
    },
  ) {
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId: t.companyId,
      agentId: t.agentId,
      status: input.status ?? "succeeded",
      startedAt: new Date(Date.now() - 30_000),
      contextSnapshot: {
        source: "chat:openwa",
        issueId: c.issueId,
        openwa: { event: input.event ?? "message", triggerClass: input.triggerClass, deliveryIds: input.deliveryIds ?? [] },
        paperclipOpenwa: {
          endpointId: t.endpointId,
          chatKey: openwaChatKey(c.chatId),
          triggerClass: input.triggerClass,
          profile: input.triggerClass === "owner" ? "full" : "read_only",
          grantIds: input.grantIds ?? [],
          requesterPrincipalId: null,
          approvalRequestId: null,
        },
      },
    });
    const [comment] = await db
      .insert(issueComments)
      .values({
        companyId: t.companyId,
        issueId: c.issueId,
        authorType: "agent",
        authorAgentId: t.agentId,
        createdByRunId: runId,
        body: input.body,
        metadata: { version: 1, authorizationReason: "allow_chat_run_presentation", sections: [] },
      })
      .returning();
    const [publication] = await db
      .insert(chatPublications)
      .values({
        companyId: t.companyId,
        endpointId: t.endpointId,
        conversationId: c.id,
        issueId: c.issueId,
        commentId: comment!.id,
        idempotencyKey: "comment:" + comment!.id + ":" + t.endpointId,
        payload: input.projected === false ? { text: input.body } : projectSafeChatPublication({ classification: "external", source: "agent_comment", text: input.body }),
        state: "pending",
      })
      .returning();
    let attachmentPublicationId: string | null = null;
    if (input.attachment) {
      const bytes = Buffer.from(input.attachment.content, "utf8");
      const objectKey = "test/" + randomUUID();
      t.objects.set(objectKey, bytes);
      const [asset] = await db
        .insert(assets)
        .values({
          companyId: t.companyId,
          provider: "local_disk",
          objectKey,
          contentType: "text/plain",
          byteSize: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          originalFilename: input.attachment.filename,
        })
        .returning();
      const [attachment] = await db.insert(issueAttachments).values({ companyId: t.companyId, issueId: c.issueId, assetId: asset!.id, issueCommentId: comment!.id }).returning();
      const [row] = await db
        .insert(chatPublications)
        .values({
          companyId: t.companyId,
          endpointId: t.endpointId,
          conversationId: c.id,
          issueId: c.issueId,
          commentId: comment!.id,
          idempotencyKey: "attachment:" + attachment!.id + ":" + t.endpointId,
          payload: projectSafeChatPublication({ classification: "external", source: "agent_comment", text: "Shared a file.", attachmentIds: [attachment!.id] }),
          state: "pending",
          createdAt: new Date(Date.now() + 1),
        })
        .returning();
      attachmentPublicationId = row!.id;
    }
    return { runId, commentId: comment!.id, publicationId: publication!.id, attachmentPublicationId };
  }

  async function drain(t: Fixture) {
    await t.service.processPendingPublications(25);
  }

  async function publicationState(id: string) {
    return (await db.select().from(chatPublications).where(eq(chatPublications.id, id)))[0]!;
  }

  async function answerStates(ids: string[]) {
    const rows = await db.select({ id: chatDeliveries.id, answerState: chatDeliveries.answerState }).from(chatDeliveries);
    return ids.map((id) => rows.find((row) => row.id === id)?.answerState ?? null);
  }

  async function audits(t: Fixture, kind: "publication_suppressed" | "message_sent") {
    return db
      .select()
      .from(chatAuditEntries)
      .where(and(eq(chatAuditEntries.endpointId, t.endpointId), eq(chatAuditEntries.kind, kind)));
  }

  async function grant(t: Fixture, c: Conversation, input: { principalId: string; category: OpenwaGrantCategory; scope?: "one_action" | "requester" }) {
    const [request] = await db
      .insert(chatOwnerApprovalRequests)
      .values({
        companyId: t.companyId,
        endpointId: t.endpointId,
        originChatKey: openwaChatKey(c.chatId),
        requestedByPrincipalId: input.principalId,
        categories: [input.category],
        scope: input.scope ?? "requester",
        summary: "reply",
        proposedAction: "reply",
        status: "approved",
      })
      .returning();
    const [row] = await db
      .insert(chatOwnerGrants)
      .values({
        companyId: t.companyId,
        endpointId: t.endpointId,
        requestId: request!.id,
        originChatKey: openwaChatKey(c.chatId),
        requesterPrincipalId: input.principalId,
        category: input.category,
        scope: input.scope ?? "requester",
        status: "live",
        approvedVia: "paperclip",
        expiresAt: new Date(Date.now() + 60 * 60_000),
      })
      .returning();
    return row!.id;
  }

  it("publishes the final output exactly once, redacted, and marks the run-class triggers answered", async () => {
    const t = await setup();
    const c = await conversation(t, MEMBER);
    const owner = await trigger(t, c, { triggerClass: "owner", role: "owner" });
    const other = await trigger(t, c, { triggerClass: "other", role: "allowed" });
    const run = await runOutput(t, c, {
      triggerClass: "owner",
      body: "Done. The deploy key was " + CREDENTIAL + " and password: hunter2",
      deliveryIds: [owner.id],
      projected: false,
    });
    await drain(t);
    await drain(t);
    expect(t.gateway.sends).toHaveLength(1);
    const sent = t.gateway.sends[0]!;
    expect(sent.chatId).toBe(MEMBER);
    expect(sent.quotedMessageId).toBeUndefined();
    expect(sent.text).toContain("[REDACTED]");
    expect(sent.text).not.toContain(CREDENTIAL);
    expect(sent.text).not.toContain("hunter2");
    expect((await publicationState(run.publicationId)).state).toBe("published");
    expect(await answerStates([owner.id, other.id])).toEqual(["answered", "pending"]);
    const outbound = await db.select().from(chatOutboundMessages).where(eq(chatOutboundMessages.endpointId, t.endpointId));
    expect(outbound.map((row) => [row.source, row.state, row.runId, row.providerMessageId])).toEqual([["publication", "sent", run.runId, sent.messageId]]);
    const [audit] = await audits(t, "message_sent");
    expect(audit).toMatchObject({ runId: run.runId, chatKey: openwaChatKey(MEMBER), actorKind: "agent" });
    expect(JSON.stringify(audit!.content)).not.toContain(CREDENTIAL);
    expect(await readOpenwaLastOutput(db, { companyId: t.companyId, endpointId: t.endpointId, conversationId: c.id })).toMatchObject({ runId: run.runId, suppressed: false });
    const [second] = await db
      .insert(issueComments)
      .values({ companyId: t.companyId, issueId: c.issueId, authorType: "agent", authorAgentId: t.agentId, createdByRunId: run.runId, body: "second final" })
      .returning();
    const [again] = await db
      .insert(chatPublications)
      .values({
        companyId: t.companyId,
        endpointId: t.endpointId,
        conversationId: c.id,
        issueId: c.issueId,
        commentId: second!.id,
        idempotencyKey: "comment:" + second!.id + ":" + t.endpointId,
        payload: projectSafeChatPublication({ classification: "external", source: "agent_comment", text: "second final" }),
        state: "pending",
      })
      .returning();
    await drain(t);
    expect(t.gateway.sends).toHaveLength(1);
    expect(await publicationState(again!.id)).toMatchObject({ state: "cancelled", redactedError: "OpenWA publication suppressed: already_published" });
    expect(await readOpenwaLastOutput(db, { companyId: t.companyId, endpointId: t.endpointId, conversationId: c.id })).toMatchObject({ runId: run.runId, suppressed: false });
  }, 90_000);

  it("quotes the oldest pending trigger of the run class in groups and prefixes owner_number output once", async () => {
    const t = await setup({ numberMode: "owner_number" });
    const c = await conversation(t, GROUP);
    const first = await trigger(t, c, { triggerClass: "owner", role: "owner", receivedAt: new Date(Date.now() - 120_000) });
    const second = await trigger(t, c, { triggerClass: "owner", role: "owner", receivedAt: new Date(Date.now() - 60_000) });
    await trigger(t, c, { triggerClass: "other", role: "allowed", receivedAt: new Date(Date.now() - 180_000) });
    await runOutput(t, c, { triggerClass: "owner", body: "**Ready**", deliveryIds: [first.id, second.id] });
    await drain(t);
    expect(t.gateway.sends).toEqual([expect.objectContaining({ chatId: GROUP, quotedMessageId: first.waMessageId, text: "🤖 *Assistant:*\n*Ready*" })]);
    expect(await answerStates([first.id, second.id])).toEqual(["answered", "answered"]);
  }, 90_000);

  it("does not publish again after a tool reply quoting the trigger (dedupe)", async () => {
    const t = await setup();
    const c = await conversation(t, MEMBER);
    const owner = await trigger(t, c, { triggerClass: "owner", role: "owner" });
    await sendThroughRegistry({
      registry: t.service.openwaOutbound,
      companyId: t.companyId,
      endpointId: t.endpointId,
      chatId: MEMBER,
      source: "tool",
      body: "tool reply",
      send: () =>
        createOpenwaGatewayClient({ baseUrl: t.gateway.baseUrl, apiKey: FAKE_OPENWA_KEY, sessionId: SESSION_ID }).sendText({
          chatId: MEMBER,
          text: "tool reply",
          quotedMessageId: owner.waMessageId,
        }),
    });
    expect(
      await markTriggersAnswered(db, { companyId: t.companyId, endpointId: t.endpointId, chatKey: MEMBER, quotedMessageId: owner.waMessageId, runClass: "owner" }),
    ).toEqual([owner.id]);
    const run = await runOutput(t, c, { triggerClass: "owner", body: "Final summary", deliveryIds: [owner.id] });
    await drain(t);
    expect(t.gateway.sends.map((send) => send.text)).toEqual(["tool reply"]);
    expect((await publicationState(run.publicationId)).state).toBe("cancelled");
    const [suppressed] = await audits(t, "publication_suppressed");
    expect(suppressed).toMatchObject({ runId: run.runId, metadata: expect.objectContaining({ reason: "no_pending_trigger" }) });
    expect(await readOpenwaLastOutput(db, { companyId: t.companyId, endpointId: t.endpointId, conversationId: c.id })).toMatchObject({
      runId: run.runId,
      suppressed: true,
      reason: "no_pending_trigger",
    });
  }, 90_000);

  it("publishes nothing when the agent stayed silent", async () => {
    const t = await setup();
    const c = await conversation(t, MEMBER);
    const owner = await trigger(t, c, { triggerClass: "owner", role: "owner" });
    await db.update(chatDeliveries).set({ answerState: "silenced" }).where(eq(chatDeliveries.id, owner.id));
    const run = await runOutput(t, c, { triggerClass: "owner", body: "internal notes", deliveryIds: [owner.id] });
    await drain(t);
    expect(t.gateway.sends).toHaveLength(0);
    expect((await publicationState(run.publicationId)).state).toBe("cancelled");
  }, 90_000);

  it("suppresses and audits an other-class reply under ask_owner until a reply grant exists", async () => {
    const t = await setup({ replyPolicy: "ask_owner" });
    const c = await conversation(t, MEMBER);
    const member = await principal(t, "628222000777");
    const first = await trigger(t, c, { triggerClass: "other", role: "allowed", principalId: member });
    const blocked = await runOutput(t, c, { triggerClass: "other", body: "Here is the answer", deliveryIds: [first.id] });
    await drain(t);
    expect(t.gateway.sends).toHaveLength(0);
    expect((await publicationState(blocked.publicationId)).state).toBe("cancelled");
    const [audit] = await audits(t, "publication_suppressed");
    expect(audit).toMatchObject({ runId: blocked.runId, metadata: expect.objectContaining({ reason: "reply_policy_ask_owner" }) });
    expect(audit!.content).toEqual({ text: "Here is the answer" });
    expect(await answerStates([first.id])).toEqual(["pending"]);
    const grantId = await grant(t, c, { principalId: member, category: "reply", scope: "one_action" });
    const allowed = await runOutput(t, c, { triggerClass: "other", body: "Approved answer", deliveryIds: [first.id], grantIds: [grantId] });
    await drain(t);
    expect(t.gateway.sends.map((send) => send.text)).toEqual(["Approved answer"]);
    expect((await publicationState(allowed.publicationId)).state).toBe("published");
    expect((await db.select().from(chatOwnerGrants).where(eq(chatOwnerGrants.id, grantId)))[0]).toMatchObject({ status: "consumed", consumedByRunId: allowed.runId });
  }, 90_000);

  it("applies the per-chat reply policy and owner_absent_only", async () => {
    const t = await setup();
    const c = await conversation(t, MEMBER, { activation: "on", replyPolicy: "owner_absent_only" });
    const first = await trigger(t, c, { triggerClass: "other", role: "allowed" });
    const regular = await runOutput(t, c, { triggerClass: "other", body: "early answer", deliveryIds: [first.id] });
    await drain(t);
    expect(t.gateway.sends).toHaveLength(0);
    expect((await publicationState(regular.publicationId)).redactedError).toContain("reply_policy_owner_absent_only");
    await runOutput(t, c, { triggerClass: "other", body: "absent answer", deliveryIds: [first.id], event: "owner_absent" });
    await drain(t);
    expect(t.gateway.sends.map((send) => send.text)).toEqual(["absent answer"]);
  }, 90_000);

  it("requires a reply_outside_allowlist grant for an outside-allowlist group sender", async () => {
    const t = await setup();
    const c = await conversation(t, GROUP);
    const stranger = await principal(t, "628999000111");
    const first = await trigger(t, c, { triggerClass: "other", role: "outside_allowlist", principalId: stranger });
    await runOutput(t, c, { triggerClass: "other", body: "blocked reply", deliveryIds: [first.id] });
    await drain(t);
    expect(t.gateway.sends).toHaveLength(0);
    expect((await audits(t, "publication_suppressed"))[0]!.metadata).toMatchObject({ reason: "outside_allowlist" });
    const grantId = await grant(t, c, { principalId: stranger, category: "reply_outside_allowlist" });
    await runOutput(t, c, { triggerClass: "other", body: "granted reply", deliveryIds: [first.id], grantIds: [grantId] });
    await drain(t);
    expect(t.gateway.sends).toEqual([expect.objectContaining({ text: "granted reply", quotedMessageId: first.waMessageId })]);
  }, 90_000);

  it("sends more than three parts as a markdown document and agent files as documents", async () => {
    const t = await setup();
    const c = await conversation(t, MEMBER);
    const owner = await trigger(t, c, { triggerClass: "owner", role: "owner" });
    const paragraph = "word ".repeat(700).trim();
    const body = Array.from({ length: 4 }, (_, index) => "Section " + index + "\n\n" + paragraph).join("\n\n");
    const run = await runOutput(t, c, { triggerClass: "owner", body, deliveryIds: [owner.id], attachment: { filename: "report.txt", content: "file body" } });
    await drain(t);
    await drain(t);
    expect(t.gateway.sends).toHaveLength(0);
    expect(t.gateway.documents.map((doc) => [doc.filename, doc.mimetype])).toEqual([
      ["response.md", "text/markdown"],
      ["report.txt", "text/plain"],
    ]);
    expect(t.gateway.documents[0]!.content).toBe(body);
    expect(t.gateway.documents[0]!.caption).toBe("Section 0");
    expect(t.gateway.documents[1]!.content).toBe("file body");
    expect((await publicationState(run.attachmentPublicationId!)).state).toBe("published");
  }, 90_000);

  it("refuses server-composed publications for OpenWA conversations", async () => {
    const t = await setup();
    const c = await conversation(t, MEMBER);
    const owner = await trigger(t, c, { triggerClass: "owner", role: "owner" });
    const run = await runOutput(t, c, { triggerClass: "owner", body: "x", deliveryIds: [owner.id] });
    await db.delete(chatPublications).where(eq(chatPublications.id, run.publicationId));
    const [row] = await db
      .insert(chatPublications)
      .values({
        companyId: t.companyId,
        endpointId: t.endpointId,
        conversationId: c.id,
        issueId: c.issueId,
        idempotencyKey: "run:" + run.runId + ":working:" + t.endpointId,
        payload: projectSafeChatPublication({ classification: "external", source: "safe_milestone", text: "Working on it" }),
        state: "pending",
      })
      .returning();
    await drain(t);
    expect(t.gateway.sends).toHaveLength(0);
    expect(await publicationState(row!.id)).toMatchObject({ state: "cancelled", redactedError: "OpenWA publishes only the agent's own run output" });
    expect(await answerStates([owner.id])).toEqual(["pending"]);
  }, 90_000);

  it("never publishes the generic Paperclip interaction text and never yields the run's reply slot to an interaction", async () => {
    const t = await setup();
    const c = await conversation(t, MEMBER);
    const owner = await trigger(t, c, { triggerClass: "owner", role: "owner" });
    const run = await runOutput(t, c, { triggerClass: "owner", body: "Need a decision", deliveryIds: [owner.id], status: "running" });
    await issueThreadInteractionService(db).create(
      { id: c.issueId, companyId: t.companyId },
      { kind: "request_confirmation", continuationPolicy: "none", sourceRunId: run.runId, payload: { version: 1, prompt: "Approve?" } } as never,
      { agentId: t.agentId, runId: run.runId },
    );
    const rows = await db.select().from(chatPublications).where(eq(chatPublications.endpointId, t.endpointId));
    expect(rows.filter((row) => row.idempotencyKey.startsWith("interaction:"))).toEqual([]);
    expect(rows.some((row) => row.payload.text.includes("needs an authorized response in Paperclip"))).toBe(false);
    expect(await hasChatRunOwnedProviderInteraction(db, { companyId: t.companyId, issueId: c.issueId, runId: run.runId })).toBe(false);
    await drain(t);
    expect(t.gateway.sends.map((send) => send.text)).toEqual(["Need a decision"]);
  }, 90_000);

  it("marks answer state per spec 7.4", async () => {
    const t = await setup();
    const c = await conversation(t, GROUP);
    const a = await trigger(t, c, { triggerClass: "other", role: "allowed" });
    const b = await trigger(t, c, { triggerClass: "other", role: "allowed" });
    const owner = await trigger(t, c, { triggerClass: "owner", role: "owner" });
    expect(await markTriggersAnswered(db, { companyId: t.companyId, endpointId: t.endpointId, chatKey: GROUP, quotedMessageId: b.waMessageId, runClass: "other" })).toEqual([b.id]);
    expect(await answerStates([a.id, b.id, owner.id])).toEqual(["pending", "answered", "pending"]);
    expect(await markTriggersAnswered(db, { companyId: t.companyId, endpointId: t.endpointId, chatKey: GROUP, quotedMessageId: null, runClass: "other" })).toEqual([a.id]);
    expect(await answerStates([a.id, b.id, owner.id])).toEqual(["answered", "answered", "pending"]);
  }, 90_000);

  it("shows typing only while a triggered run is active and stops when it ends", async () => {
    const t = await setup();
    const c = await conversation(t, MEMBER);
    const owner = await trigger(t, c, { triggerClass: "owner", role: "owner" });
    const run = await runOutput(t, c, { triggerClass: "owner", body: "x", deliveryIds: [owner.id], status: "running" });
    await db.delete(chatPublications).where(eq(chatPublications.id, run.publicationId));
    t.adapter.typingRefreshMs = 50;
    await t.adapter.startTyping(c.threadId);
    await until(() => t.gateway.typing.filter((entry) => entry.state === "typing").length >= 2);
    await db.update(heartbeatRuns).set({ status: "succeeded" }).where(eq(heartbeatRuns.id, run.runId));
    await until(() => t.gateway.typing.some((entry) => entry.state === "paused"));
    await until(() => !t.adapter.isTyping(c.threadId));
    const count = t.gateway.typing.length;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(t.gateway.typing.length).toBe(count);
    expect(t.gateway.typing.every((entry) => entry.chatId === MEMBER)).toBe(true);
  }, 90_000);

  it("does not show typing when the endpoint toggle is off", async () => {
    const t = await setup({ typingIndicator: false });
    const c = await conversation(t, MEMBER);
    await expect(t.adapter.startTyping(c.threadId)).rejects.toThrow(/typing is not active/);
    expect(t.gateway.typing).toHaveLength(0);
  }, 90_000);
});
