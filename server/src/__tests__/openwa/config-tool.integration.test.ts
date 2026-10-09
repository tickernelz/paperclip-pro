import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import {
  activityLog,
  agents,
  authUsers,
  chatAuditEntries,
  chatConversations,
  chatDeliveries,
  chatEndpointResources,
  chatEndpoints,
  chatIdentityLinks,
  chatSenderRules,
  issueAutonomyWindows,
  companies,
  companyMemberships,
  companySecretBindings,
  createDb,
  heartbeatRuns,
  issues,
  toolConnections,
  type Db,
} from "@tickernelz/paperclip-pro-db";
import { openwaEndpointPolicySchema, type OpenwaTriggerClass } from "@tickernelz/paperclip-pro-shared";
import { startEmbeddedPostgresTestDatabase } from "../helpers/embedded-postgres.js";
import { chatChannelService, type ChatChannelService } from "../../services/chat-channels.js";
import { ChatSdkRuntime } from "../../services/chat-sdk-runtime.js";
import { secretService } from "../../services/secrets.js";
import { instanceSettingsService } from "../../services/instance-settings.js";
import { openwaThreadId } from "../../services/openwa/adapter.js";
import { openwaChatKey } from "../../services/openwa/outbound.js";
import { executeOpenwaTool, OpenwaToolError } from "../../services/openwa/tools.js";
import { FAKE_OPENWA_KEY, FakeOpenwaGateway } from "./fake-gateway.js";

const SESSION_ID = "44444444-5555-4666-8777-888888888888";
const OWN_PHONE = "628111000666";
const OWNER_DM = "628222000666@c.us";
const TARGET_PHONE = "628777000111";
const GROUP = "120363000000000666@g.us";

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

describe.sequential("openwa_endpoint_config (embedded Postgres + fake gateway)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let root: string;
  const oldKey = process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
  const services: ChatChannelService[] = [];
  const gateways: FakeOpenwaGateway[] = [];
  const endpointIds: string[] = [];

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-openwa-config-tool-");
    db = createDb(database.connectionString);
    root = await mkdtemp(path.join(tmpdir(), "openwa-config-tool-"));
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

  async function setup(policy: Record<string, unknown> = {}) {
    const gateway = new FakeOpenwaGateway({ sessionId: SESSION_ID, ownPhone: OWN_PHONE });
    await gateway.start();
    gateways.push(gateway);
    const companyId = randomUUID();
    const agentId = randomUUID();
    const userId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "OpenWA config tool",
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
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "operator" });
    const service = chatChannelService(db, {
      runtime: new ChatSdkRuntime(),
      publicBaseUrl: "https://paperclip.example",
      heartbeat: { wakeup: vi.fn(async () => ({ accepted: true })) } as never,
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
    return { ...row!, chatId, threadId, resourceId: resource!.id };
  }

  type Conversation = Awaited<ReturnType<typeof conversation>>;

  async function run(t: Fixture, c: Conversation, triggerClass: OpenwaTriggerClass, grantIds: string[] = [], triggerPrincipalId: string | null = null) {
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
          grantIds,
          requesterPrincipalId: null,
          approvalRequestId: null,
          triggerPrincipalId,
        },
      },
    });
    return { companyId: t.companyId, agentId: t.agentId, runId, issueId: c.issueId };
  }

  function handled(t: Fixture) {
    const stats = t.service.openwaAdmissionStats;
    return stats.discarded + stats.ownerActivity + stats.filtered + stats.admitted;
  }

  async function inbound(t: Fixture, phone: string, body: string) {
    const before = handled(t);
    t.gateway.inbound({ chatId: phone + "@c.us", body });
    await until(() => handled(t) > before);
  }

  async function endpointRow(t: Fixture) {
    return (await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, t.endpointId)))[0]!;
  }

  async function snapshot(t: Fixture) {
    const [endpoint, rules, resources, configAudits] = await Promise.all([
      endpointRow(t),
      db.select().from(chatSenderRules).where(eq(chatSenderRules.endpointId, t.endpointId)),
      db.select().from(chatEndpointResources).where(eq(chatEndpointResources.endpointId, t.endpointId)).orderBy(asc(chatEndpointResources.createdAt)),
      db.select().from(chatAuditEntries).where(and(eq(chatAuditEntries.endpointId, t.endpointId), eq(chatAuditEntries.kind, "config_changed"))),
    ]);
    return {
      policy: endpoint.policy,
      revision: endpoint.policyRevision,
      rules: rules.map((rule) => [rule.list, rule.e164]),
      settings: resources.map((resource) => resource.settings),
      configAudits: configAudits.length,
    };
  }

  it("lets an owner run denylist a number by chat, effective on the next event and audited (AC13)", async () => {
    const t = await setup({ senderPolicyMode: "all" });
    const c = await conversation(t, OWNER_DM);
    await inbound(t, TARGET_PHONE, "before the denylist");
    const admittedBefore = t.service.openwaAdmissionStats.admitted;
    expect(admittedBefore).toBe(1);
    const deliveryCount = async () => (await db.select().from(chatDeliveries).where(eq(chatDeliveries.endpointId, t.endpointId))).length;
    await until(async () => (await deliveryCount()) === 1);
    const deliveriesBefore = await deliveryCount();
    const revisionBefore = (await endpointRow(t)).policyRevision;

    const ownerPrincipalId = randomUUID();
    const binding = await run(t, c, "owner", [], ownerPrincipalId);
    const result = await executeOpenwaTool(db, binding, "openwa_endpoint_config", {
      senders: { add: [{ list: "deny", number: "+" + TARGET_PHONE, label: "spam" }] },
    });
    expect(result).toMatchObject({
      changed: { senders: { added: 1, removed: 0, unchanged: 0 } },
      policyRevision: revisionBefore + 1,
      senders: [{ list: "deny", number: "+62xxx...0111", label: "spam" }],
    });
    expect(JSON.stringify(result)).not.toContain(TARGET_PHONE);
    expect((await endpointRow(t)).policyRevision).toBe(revisionBefore + 1);

    await inbound(t, TARGET_PHONE, "after the denylist");
    expect(t.service.openwaAdmissionStats.admitted).toBe(admittedBefore);
    expect(await deliveryCount()).toBe(deliveriesBefore);
    const filtered = await db
      .select()
      .from(chatAuditEntries)
      .where(and(eq(chatAuditEntries.endpointId, t.endpointId), eq(chatAuditEntries.kind, "trigger_filtered")));
    expect(filtered.map((entry) => (entry.metadata as { reason: string }).reason)).toEqual(["denylisted"]);

    const [audit] = await db
      .select()
      .from(chatAuditEntries)
      .where(and(eq(chatAuditEntries.endpointId, t.endpointId), eq(chatAuditEntries.kind, "config_changed")));
    expect(audit).toMatchObject({
      actorKind: "agent",
      actorRef: t.agentId,
      runId: binding.runId,
      conversationId: c.id,
      chatKey: openwaChatKey(OWNER_DM),
      metadata: { tool: "openwa_endpoint_config", scope: "sender_rules", added: 1, removed: 0 },
      content: { before: [], after: [{ list: "deny", e164: "+" + TARGET_PHONE, label: "spam" }] },
    });
    expect(audit!.contentPurgeAt).not.toBeNull();
    const [activity] = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.companyId, t.companyId), eq(activityLog.action, "openwa.sender_rule_changed")));
    expect(activity).toMatchObject({ actorType: "system", actorId: "chat:" + ownerPrincipalId, agentId: t.agentId, runId: binding.runId });
    expect(activity!.details).toMatchObject({
      change: "added",
      list: "deny",
      numberMasked: "+62xxx...0111",
      via: "openwa_endpoint_config",
      agentId: t.agentId,
      runId: binding.runId,
    });
    expect(JSON.stringify(activity!.details)).not.toContain(TARGET_PHONE);

    const removed = await executeOpenwaTool(db, binding, "openwa_endpoint_config", { senders: { remove: [{ list: "deny", number: TARGET_PHONE }] } });
    expect(removed).toMatchObject({ changed: { senders: { added: 0, removed: 1 } }, policyRevision: revisionBefore + 2, senders: [] });
    const audits = await db
      .select()
      .from(chatAuditEntries)
      .where(and(eq(chatAuditEntries.endpointId, t.endpointId), eq(chatAuditEntries.kind, "config_changed")))
      .orderBy(asc(chatAuditEntries.occurredAt));
    expect(audits[1]!.content).toEqual({ before: [{ list: "deny", e164: "+" + TARGET_PHONE, label: "spam" }], after: [] });
  }, 90_000);

  it("lets only a linked owner's run open, list and close autonomy windows attributed to that owner", async () => {
    const t = await setup();
    const c = await conversation(t, OWNER_DM);
    const [root] = await db.insert(issues).values({ companyId: t.companyId, title: "Ship the release", status: "todo" }).returning();
    const open = { operation: "open", issues: [root!.id], hours: 6, idempotencyKey: randomUUID() };

    for (const triggerClass of ["other", "grant"] as const) {
      const binding = await run(t, c, triggerClass, triggerClass === "grant" ? [randomUUID()] : []);
      expect(await rejection(executeOpenwaTool(db, binding, "openwa_autonomy_window", open))).toMatchObject({ status: 403, code: "owner_only" });
    }
    const unlinked = await run(t, c, "owner", [], randomUUID());
    expect(await rejection(executeOpenwaTool(db, unlinked, "openwa_autonomy_window", open))).toMatchObject({ status: 403, code: "owner_only" });
    expect(await db.select().from(issueAutonomyWindows).where(eq(issueAutonomyWindows.companyId, t.companyId))).toEqual([]);

    const added = await t.service.openwa.addOwner(t.endpointId, { e164: "+" + OWNER_DM.split("@")[0], expiresInSeconds: 1_800 }, t.userId);
    const token = new URL(added.confirmationUrl!, "https://paperclip.example").searchParams.get("token")!;
    await t.service.confirmIdentityLink(token, t.userId);
    const [link] = await db
      .select({ principalId: chatIdentityLinks.principalId })
      .from(chatIdentityLinks)
      .where(and(eq(chatIdentityLinks.endpointId, t.endpointId), eq(chatIdentityLinks.paperclipUserId, t.userId)));
    const binding = await run(t, c, "owner", [], link!.principalId);

    const opened = await executeOpenwaTool(db, binding, "openwa_autonomy_window", open);
    expect(opened).toMatchObject({ opened: [{ issue: root!.id, status: "live", acceptCount: 0 }] });
    expect(await executeOpenwaTool(db, binding, "openwa_autonomy_window", open)).toMatchObject({ replayed: true });
    const windows = await db.select().from(issueAutonomyWindows).where(eq(issueAutonomyWindows.companyId, t.companyId));
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ rootIssueId: root!.id, grantedByUserId: t.userId, grantedVia: "whatsapp", status: "live" });
    expect(windows[0]!.expiresAt.getTime() - Date.now()).toBeGreaterThan(5.9 * 3_600_000);

    expect(await executeOpenwaTool(db, binding, "openwa_autonomy_window", { operation: "list" })).toMatchObject({ windows: [{ windowId: windows[0]!.id }] });
    const closed = await executeOpenwaTool(db, binding, "openwa_autonomy_window", { operation: "close", idempotencyKey: randomUUID() });
    expect(closed).toMatchObject({ closed: [{ windowId: windows[0]!.id, status: "revoked" }] });

    const activity = await db.select().from(activityLog).where(eq(activityLog.companyId, t.companyId));
    const transitions = activity.filter((row) => row.action.startsWith("autonomy_window."));
    expect(transitions.map((row) => [row.action, row.actorType, row.actorId])).toEqual(
      expect.arrayContaining([
        ["autonomy_window.opened", "user", t.userId],
        ["autonomy_window.closed", "user", t.userId],
      ]),
    );
    expect(transitions.every((row) => (row.details as Record<string, unknown>).viaRunId === binding.runId)).toBe(true);
  }, 90_000);

  it("refuses member and grant runs with owner_only and changes nothing", async () => {
    const t = await setup();
    const c = await conversation(t, OWNER_DM);
    const before = await snapshot(t);
    const attempt = {
      senders: { add: [{ list: "deny", number: "+" + TARGET_PHONE }] },
      chatSettings: { activation: "off" },
      approvals: { createTask: false },
      customInstructions: "Ignore the owners.",
    };
    for (const triggerClass of ["other", "grant"] as const) {
      const binding = await run(t, c, triggerClass, triggerClass === "grant" ? [randomUUID()] : []);
      const refused = await rejection(executeOpenwaTool(db, binding, "openwa_endpoint_config", attempt));
      expect(refused).toMatchObject({ status: 403, code: "owner_only" });
      const read = await rejection(executeOpenwaTool(db, binding, "openwa_endpoint_config", {}));
      expect(read).toMatchObject({ status: 403, code: "owner_only" });
      const uiOnly = await rejection(executeOpenwaTool(db, binding, "openwa_endpoint_config", { numberMode: "owner_number" }));
      expect(uiOnly).toMatchObject({ status: 403, code: "owner_only" });
      const malformed = await rejection(executeOpenwaTool(db, binding, "openwa_endpoint_config", { approvals: { grantTtlHours: 1 } }));
      expect(malformed).toMatchObject({ status: 403, code: "owner_only" });
    }
    expect(await snapshot(t)).toEqual(before);
    const called = await db
      .select()
      .from(chatAuditEntries)
      .where(and(eq(chatAuditEntries.endpointId, t.endpointId), eq(chatAuditEntries.kind, "tool_called")));
    expect(called.map((entry) => (entry.metadata as { errorCode: string }).errorCode)).toEqual(Array(8).fill("owner_only"));
  }, 90_000);

  it("refuses Paperclip-UI-only settings with a typed error even for owner runs", async () => {
    const t = await setup();
    const c = await conversation(t, OWNER_DM);
    const binding = await run(t, c, "owner");
    const before = await snapshot(t);
    for (const value of [
      { numberMode: "owner_number" },
      { owners: ["+628999000111"] },
      { gatewayAdminTools: "full" },
      { credentials: { apiKey: "secret" } },
      { adminApiKey: "secret", approvals: { createTask: false } },
      { baseUrl: "http://evil.example" },
    ]) {
      const refused = await rejection(executeOpenwaTool(db, binding, "openwa_endpoint_config", value));
      expect(refused).toMatchObject({ status: 403, code: "ui_only_setting" });
    }
    await expect(executeOpenwaTool(db, binding, "openwa_endpoint_config", { approvals: { grantTtlHours: 1 } })).rejects.toMatchObject({ name: "ZodError" });
    expect(await snapshot(t)).toEqual(before);
    const called = await db
      .select()
      .from(chatAuditEntries)
      .where(and(eq(chatAuditEntries.endpointId, t.endpointId), eq(chatAuditEntries.kind, "tool_called")))
      .orderBy(asc(chatAuditEntries.occurredAt));
    expect(called.map((entry) => (entry.metadata as { errorCode: string }).errorCode)).toEqual([...Array(6).fill("ui_only_setting"), "invalid_arguments"]);
    expect(called.every((entry) => entry.runId === binding.runId)).toBe(true);
  }, 90_000);

  it("changes chat settings, approval toggles, reminders and custom instructions with before/after audit", async () => {
    const t = await setup({ customInstructions: "Be brief." });
    const c = await conversation(t, OWNER_DM);
    const ownerPrincipalId = randomUUID();
    const binding = await run(t, c, "owner", [], ownerPrincipalId);
    const revision = (await endpointRow(t)).policyRevision;

    const empty = await executeOpenwaTool(db, binding, "openwa_endpoint_config", {});
    expect(empty).not.toHaveProperty("changed");
    expect(empty).toMatchObject({ policyRevision: revision, customInstructions: "Be brief.", approvals: { createTask: true }, reminders: { reminderMinutes: 30, maxReminders: 3, pendingTtlHours: 24 } });
    expect((await endpointRow(t)).policyRevision).toBe(revision);

    const result = await executeOpenwaTool(db, binding, "openwa_endpoint_config", {
      chat: GROUP,
      chatSettings: { activation: "on", replyPolicy: "ask_owner", absenceSeconds: 300, triggers: { keywords: ["invoice"] }, note: "Supplier group." },
      approvals: { createTask: false, reminderMinutes: 15, maxReminders: 1, pendingTtlHours: 48 },
      customInstructions: "Sign every reply as Bot Gamma.",
    });
    const groupRef = "openwa:" + SESSION_ID + ":" + GROUP;
    expect(result).toMatchObject({
      changed: { endpoint: ["approvals", "customInstructions"], chat: groupRef },
      policyRevision: revision + 2,
      chat: {
        chatRef: groupRef,
        configured: true,
        settings: { activation: "on", replyPolicy: "ask_owner", absenceSeconds: 300, triggers: { keywords: ["invoice"] }, note: "Supplier group." },
      },
      approvals: { createTask: false, externalTools: true },
      reminders: { reminderMinutes: 15, maxReminders: 1, pendingTtlHours: 48 },
      customInstructions: "Sign every reply as Bot Gamma.",
    });
    const policy = openwaEndpointPolicySchema.parse((await endpointRow(t)).policy);
    expect(policy.approvals).toMatchObject({ createTask: false, reminderMinutes: 15, maxReminders: 1, grantTtlHours: 24, pendingTtlHours: 48 });
    expect(policy.customInstructions).toBe("Sign every reply as Bot Gamma.");
    expect(policy.numberMode).toBe("agent_number");

    const cleared = await executeOpenwaTool(db, binding, "openwa_endpoint_config", { chat: GROUP, chatSettings: { replyPolicy: null, note: null } });
    expect(cleared).toMatchObject({ chat: { settings: { activation: "on", absenceSeconds: 300, triggers: { keywords: ["invoice"] } } } });
    expect((cleared.chat as { settings: Record<string, unknown> }).settings).not.toHaveProperty("replyPolicy");
    expect((cleared.chat as { settings: Record<string, unknown> }).settings).not.toHaveProperty("note");

    const origin = await executeOpenwaTool(db, binding, "openwa_endpoint_config", { chatSettings: { note: "Owner's own DM." } });
    expect(origin).toMatchObject({ chat: { chatRef: "openwa:" + SESSION_ID + ":" + OWNER_DM, settings: { activation: "auto", note: "Owner's own DM." } } });

    const audits = await db
      .select()
      .from(chatAuditEntries)
      .where(and(eq(chatAuditEntries.endpointId, t.endpointId), eq(chatAuditEntries.kind, "config_changed")))
      .orderBy(asc(chatAuditEntries.occurredAt));
    expect(audits.map((entry) => (entry.metadata as { scope: string }).scope)).toEqual(["endpoint", "chat", "chat", "chat"]);
    expect(audits[0]).toMatchObject({
      actorKind: "agent",
      runId: binding.runId,
      metadata: { changed: ["approvals", "customInstructions"] },
      content: {
        before: { approvals: { createTask: true, reminderMinutes: 30, maxReminders: 3 }, customInstructions: "Be brief." },
        after: { approvals: { createTask: false, reminderMinutes: 15, maxReminders: 1 }, customInstructions: "Sign every reply as Bot Gamma." },
      },
    });
    expect(audits[1]).toMatchObject({ metadata: { chatKey: GROUP }, content: { before: null, after: { activation: "on", replyPolicy: "ask_owner" } } });
    expect(audits[2]).toMatchObject({ content: { before: { replyPolicy: "ask_owner", note: "Supplier group." }, after: { activation: "on" } } });
    expect((audits[2]!.content as { after: Record<string, unknown> }).after).not.toHaveProperty("note");
    const activities = await db
      .select({ action: activityLog.action, actorType: activityLog.actorType, actorId: activityLog.actorId, details: activityLog.details })
      .from(activityLog)
      .where(and(eq(activityLog.companyId, t.companyId), eq(activityLog.entityId, t.endpointId)));
    const configActivities = activities.filter((entry) => entry.action === "openwa.config_changed" || entry.action === "openwa.chat_activation_changed");
    expect(configActivities.length).toBeGreaterThan(0);
    expect(configActivities.every((entry) => entry.actorType === "system" && entry.actorId === "chat:" + ownerPrincipalId)).toBe(true);
    expect(JSON.stringify(configActivities)).not.toContain("Bot Gamma");
    expect(JSON.stringify(configActivities)).not.toContain("Supplier group");

    const invalid = await rejection(executeOpenwaTool(db, binding, "openwa_endpoint_config", { chat: "not a chat", chatSettings: { activation: "on" } }));
    expect(invalid).toMatchObject({ status: 400, code: "invalid_target" });
  }, 90_000);

  it("lets an owner run turn a group into a dedicated group that triggers on every message, and refuses a member run", async () => {
    const t = await setup();
    const dm = await conversation(t, OWNER_DM);
    const group = await conversation(t, GROUP, { activation: "auto", replyPolicy: "ask_owner" });
    const dedicated = { chat: GROUP, chatSettings: { activation: "on", triggers: { allMessages: true } } };
    const before = await snapshot(t);
    const member = await run(t, group, "other");
    expect(await rejection(executeOpenwaTool(db, member, "openwa_endpoint_config", dedicated))).toMatchObject({ status: 403, code: "owner_only" });
    expect(await snapshot(t)).toEqual(before);

    const owner = await run(t, dm, "owner", [], randomUUID());
    const result = await executeOpenwaTool(db, owner, "openwa_endpoint_config", dedicated);
    const groupRef = "openwa:" + SESSION_ID + ":" + GROUP;
    expect(result).toMatchObject({ changed: { chat: groupRef }, chat: { chatRef: groupRef, configured: true } });
    expect((result.chat as { settings: unknown }).settings).toEqual({ activation: "on", replyPolicy: "ask_owner", triggers: { allMessages: true } });
    const [stored] = await db.select().from(chatEndpointResources).where(eq(chatEndpointResources.id, group.resourceId));
    expect(stored!.settings).toEqual({ activation: "on", replyPolicy: "ask_owner", triggers: { allMessages: true } });
    expect(stored!.enabled).toBe(true);
  }, 90_000);
});
