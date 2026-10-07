import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { chatEndpoints, chatOpenwaLinkedSessions, type Db } from "@tickernelz/paperclip-pro-db";
import {
  maskOpenwaPhoneNumber,
  type OpenwaLinkableSession,
  type OpenwaLinkedChat,
  type OpenwaLinkedGatewayChat,
  type OpenwaLinkedSessionView,
  type OpenwaLinkedUnlinkResult,
} from "@tickernelz/paperclip-pro-shared";
import { HttpError, badRequest, conflict, notFound, unprocessable } from "../../errors.js";
import { logger } from "../../middleware/logger.js";
import { publishActivity, type ActivityPublication } from "../activity-log.js";
import { secretService } from "../secrets.js";
import { logOpenwaActivity, recordOpenwaAudit } from "./audit.js";
import { createOpenwaGatewayClient, OpenwaGatewayError, type OpenwaGatewayClient, type OpenwaHistoryMessage } from "./gateway.js";
import type { OpenwaIngestedMedia } from "./media.js";
import { openwaChatKey } from "./outbound.js";
import { openwaPhoneDigits, openwaSetupError } from "./setup.js";
import { OpenwaToolError, WA_MESSAGE_CHAT, fitPage, liveView, openwaMediaResult, type ToolContext } from "./tools.js";

type EndpointRow = typeof chatEndpoints.$inferSelect;
type LinkedRow = typeof chatOpenwaLinkedSessions.$inferSelect;
type Args = Record<string, unknown>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const GATEWAY_TIMEOUT_MS = 15_000;
const LIVE_LIMIT = 100;
const DEEP_LIMIT = 2000;
const CHAT_ID = /^[A-Za-z0-9._-]{1,128}@(c\.us|g\.us|lid|s\.whatsapp\.net)$/i;
const CHAT_REF = /^openwa:([A-Za-z0-9-]{1,64}):(.+)$/;
const MEDIA_TYPES = new Set(["image", "video", "audio", "voice", "ptt", "document", "sticker"]);

export interface OpenwaLinkedServiceDeps {
  adminApiKey(endpoint: EndpointRow): Promise<string | null>;
  fetchImpl?: typeof fetch;
}

function account(endpoint: Pick<EndpointRow, "providerAccountId">): { baseUrl: string; sessionId: string } {
  const value = endpoint.providerAccountId ?? "";
  const hash = value.lastIndexOf("#");
  return { baseUrl: hash > 0 ? value.slice(0, hash) : "", sessionId: hash >= 0 ? value.slice(hash + 1) : "" };
}

function view(row: LinkedRow): OpenwaLinkedSessionView {
  return {
    id: row.id,
    sessionId: row.sessionId,
    label: row.label,
    phoneMasked: row.phoneMasked,
    pushName: row.pushName,
    status: row.status,
    allowedChats: row.allowedChats,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function maskedPhone(phone: string | null | undefined): string | null {
  const digits = openwaPhoneDigits(phone);
  return digits ? maskOpenwaPhoneNumber(digits) : null;
}

function linkedKeyName(linkedId: string): string {
  return "paperclip-linked-" + linkedId.slice(0, 8);
}

function adminKeyRequired(): HttpError {
  return unprocessable("Linking a number needs the OpenWA admin key. Add an admin API key to this channel's OpenWA connection, then try again.", {
    code: "openwa_admin_key_required",
  });
}

function adminError(error: unknown, baseUrl: string): Error {
  if (error instanceof OpenwaGatewayError && (error.code === "unauthorized" || error.code === "forbidden"))
    return unprocessable("OpenWA rejected the admin key. Replace it with an active admin key in the channel's OpenWA connection.", {
      code: "openwa_admin_key_invalid",
    });
  return openwaSetupError(error, baseUrl);
}

/** Board-managed read-only OpenWA sessions linked to an endpoint; keys stay in Paperclip-managed secrets. */
export function openwaLinkedService(db: Db, deps: OpenwaLinkedServiceDeps) {
  const secrets = secretService(db);

  async function endpointFor(endpointId: string): Promise<EndpointRow> {
    const [endpoint] = await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, endpointId));
    if (!endpoint) throw notFound("Chat endpoint not found");
    if (endpoint.provider !== "openwa") throw badRequest("This action is only valid for OpenWA endpoints");
    if (endpoint.status === "archived") throw conflict("This channel was removed");
    return endpoint;
  }

  async function adminFor(endpoint: EndpointRow, sessionId: string) {
    const { baseUrl } = account(endpoint);
    if (!baseUrl) throw unprocessable("Connect the OpenWA gateway first", { code: "openwa_session_required" });
    const adminApiKey = await deps.adminApiKey(endpoint);
    if (!adminApiKey) throw adminKeyRequired();
    const client = createOpenwaGatewayClient({
      baseUrl,
      apiKey: adminApiKey,
      adminApiKey,
      sessionId,
      timeoutMs: GATEWAY_TIMEOUT_MS,
      fetchImpl: deps.fetchImpl,
    });
    return { client, baseUrl };
  }

  async function rowFor(endpoint: EndpointRow, linkedId: string): Promise<LinkedRow | null> {
    const [row] = await db
      .select()
      .from(chatOpenwaLinkedSessions)
      .where(
        and(
          eq(chatOpenwaLinkedSessions.companyId, endpoint.companyId),
          eq(chatOpenwaLinkedSessions.endpointId, endpoint.id),
          eq(chatOpenwaLinkedSessions.id, linkedId),
        ),
      );
    return row ?? null;
  }

  async function rowsFor(endpoint: EndpointRow): Promise<LinkedRow[]> {
    return db
      .select()
      .from(chatOpenwaLinkedSessions)
      .where(and(eq(chatOpenwaLinkedSessions.companyId, endpoint.companyId), eq(chatOpenwaLinkedSessions.endpointId, endpoint.id)))
      .orderBy(asc(chatOpenwaLinkedSessions.createdAt));
  }

  async function transact<T>(run: (tx: Tx, publications: ActivityPublication[]) => Promise<T>): Promise<T> {
    const publications: ActivityPublication[] = [];
    const result = await db.transaction((tx) => run(tx, publications));
    for (const publication of publications) publishActivity(publication);
    return result;
  }

  async function mutate<T>(endpoint: EndpointRow, run: (tx: Tx, publications: ActivityPublication[]) => Promise<T>): Promise<T> {
    return transact(async (tx, publications) => {
      const [locked] = await tx
        .select({ status: chatEndpoints.status })
        .from(chatEndpoints)
        .where(and(eq(chatEndpoints.companyId, endpoint.companyId), eq(chatEndpoints.id, endpoint.id)))
        .for("update");
      if (!locked || locked.status === "archived") throw conflict("This channel was removed");
      return run(tx, publications);
    });
  }

  async function revokeGatewayKey(endpoint: EndpointRow, row: LinkedRow): Promise<boolean> {
    try {
      const { client } = await adminFor(endpoint, row.sessionId);
      await client.revokeApiKey(row.gatewayKeyId).catch((error: unknown) => {
        if (error instanceof OpenwaGatewayError && error.code === "not_found") return;
        throw error;
      });
      return true;
    } catch (error) {
      logger.warn(
        { err: error, endpointId: endpoint.id, linkedSessionId: row.id, gatewayKeyName: linkedKeyName(row.id) },
        "failed to revoke an OpenWA linked-session key; revoke it in the OpenWA dashboard",
      );
      return false;
    }
  }

  async function deleteRows(tx: Tx, publications: ActivityPublication[], endpoint: EndpointRow, rows: Array<{ row: LinkedRow; revoked: boolean }>, actorUserId: string | null, reason: "unlinked" | "endpoint_removed"): Promise<LinkedRow[]> {
    if (rows.length === 0) return [];
    const removed = await tx
      .delete(chatOpenwaLinkedSessions)
      .where(and(eq(chatOpenwaLinkedSessions.companyId, endpoint.companyId), inArray(chatOpenwaLinkedSessions.id, rows.map(({ row }) => row.id))))
      .returning();
    for (const row of removed) {
      await logOpenwaActivity(
        tx,
        {
          companyId: endpoint.companyId,
          endpointId: endpoint.id,
          action: "openwa.linked_session_removed",
          actorUserId,
          details: { linkedSessionId: row.id, phoneMasked: row.phoneMasked, reason, revoked: rows.find((entry) => entry.row.id === row.id)?.revoked ?? false },
        },
        publications,
      );
    }
    return removed;
  }

  async function removeSecrets(endpoint: EndpointRow, rows: LinkedRow[]): Promise<void> {
    const results = await Promise.allSettled(rows.map((row) => secrets.remove(row.secretId)));
    if (results.some((result) => result.status === "rejected"))
      logger.warn({ endpointId: endpoint.id }, "removed an OpenWA linked number but left its secret for later cleanup");
  }

  /** Revokes, deletes, and forgets every linked number of an endpoint being removed; gateway revoke is best-effort. */
  async function removeForEndpoint(endpoint: EndpointRow, actorUserId: string | null | undefined): Promise<void> {
    const rows = await rowsFor(endpoint);
    if (rows.length === 0) return;
    const revoked: Array<{ row: LinkedRow; revoked: boolean }> = [];
    for (const row of rows) revoked.push({ row, revoked: await revokeGatewayKey(endpoint, row) });
    const removed = await transact((tx, publications) => deleteRows(tx, publications, endpoint, revoked, actorUserId ?? null, "endpoint_removed"));
    await removeSecrets(endpoint, removed);
  }

  async function viewerFor(endpoint: EndpointRow, row: LinkedRow): Promise<OpenwaGatewayClient> {
    const { baseUrl } = account(endpoint);
    const apiKey = await secrets.resolveSecretValue(endpoint.companyId, row.secretId, "latest").catch(() => null);
    if (!baseUrl || !apiKey) throw new OpenwaToolError(409, "linked_session_unavailable", "This linked number's key is no longer available; ask the board to link it again");
    return createOpenwaGatewayClient({ baseUrl, apiKey, sessionId: row.sessionId, timeoutMs: GATEWAY_TIMEOUT_MS, fetchImpl: deps.fetchImpl });
  }

  async function setStatus(row: LinkedRow, status: LinkedRow["status"]): Promise<void> {
    if (row.status === status) return;
    await db
      .update(chatOpenwaLinkedSessions)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(chatOpenwaLinkedSessions.companyId, row.companyId), eq(chatOpenwaLinkedSessions.id, row.id)));
  }

  async function list(endpointId: string): Promise<OpenwaLinkedSessionView[]> {
    return (await rowsFor(await endpointFor(endpointId))).map(view);
  }

  async function linkableSessions(endpointId: string): Promise<OpenwaLinkableSession[]> {
    const endpoint = await endpointFor(endpointId);
    const own = account(endpoint).sessionId;
    const { client, baseUrl } = await adminFor(endpoint, own);
    const [sessions, linked] = await Promise.all([
      client.listAllSessions().catch((error: unknown) => {
        throw adminError(error, baseUrl);
      }),
      rowsFor(endpoint),
    ]);
    const taken = new Set(linked.map((row) => row.sessionId));
    return (Array.isArray(sessions) ? sessions : []).flatMap((session) =>
      session && typeof session.id === "string" && session.id !== own && !taken.has(session.id)
        ? [
            {
              sessionId: session.id,
              name: typeof session.name === "string" ? session.name : session.id,
              status: typeof session.status === "string" ? session.status : "unknown",
              phoneMasked: maskedPhone(session.phone),
              pushName: typeof session.pushName === "string" && session.pushName ? session.pushName : null,
            },
          ]
        : [],
    );
  }

  async function link(endpointId: string, input: { sessionId: string; label: string }, actorUserId: string | null): Promise<OpenwaLinkedSessionView> {
    const endpoint = await endpointFor(endpointId);
    const sessionId = input.sessionId.trim();
    if (sessionId === account(endpoint).sessionId)
      throw unprocessable("This is the agent's own WhatsApp session; link a different number.", { code: "openwa_linked_is_agent_session" });
    if ((await rowsFor(endpoint)).some((row) => row.sessionId === sessionId))
      throw conflict("This WhatsApp session is already linked to this channel", { code: "openwa_linked_exists" });
    const { client, baseUrl } = await adminFor(endpoint, sessionId);
    const session = await client.getSession().catch((error: unknown) => {
      if (error instanceof OpenwaGatewayError && error.code === "not_found")
        throw notFound("The OpenWA gateway has no such session", { code: "openwa_session_not_found" });
      throw adminError(error, baseUrl);
    });
    const id = randomUUID();
    const created = await client
      .createApiKey({ name: linkedKeyName(id), role: "viewer", allowedSessions: [sessionId] })
      .catch((error: unknown) => {
        throw adminError(error, baseUrl);
      });
    const revokeKey = (keyId: string) =>
      client.revokeApiKey(keyId).catch((error: unknown) => {
        logger.warn({ err: error, endpointId: endpoint.id, gatewayKeyName: linkedKeyName(id) }, "failed to revoke an OpenWA linked-session key after a failed link");
      });
    if (!created || typeof created.id !== "string" || typeof created.apiKey !== "string" || !created.apiKey) {
      if (created && typeof created.id === "string" && created.id) await revokeKey(created.id);
      throw new HttpError(502, "The OpenWA gateway returned an unexpected API key response. Check the gateway version and logs.", {
        code: "openwa_invalid_response",
      });
    }
    let secretId: string | null = null;
    try {
      const suffix = randomUUID().replaceAll("-", "");
      const secret = await secrets.create(
        endpoint.companyId,
        {
          name: "chat.openwa." + endpoint.id.slice(0, 8) + ".linked." + id.slice(0, 8),
          key: ("CHAT_OPENWA_LINKED_" + endpoint.id.replaceAll("-", "_") + "_" + suffix).toUpperCase(),
          provider: "local_encrypted",
          managedMode: "paperclip_managed",
          value: created.apiKey,
          description: "OpenWA read-only viewer key for a linked number on endpoint " + endpoint.id,
        },
        { userId: actorUserId ?? undefined },
      );
      secretId = secret.id;
      const row = await mutate(endpoint, async (tx, publications) => {
        const [inserted] = await tx
          .insert(chatOpenwaLinkedSessions)
          .values({
            id,
            companyId: endpoint.companyId,
            endpointId: endpoint.id,
            sessionId,
            label: input.label.trim(),
            phoneMasked: maskedPhone(session.phone),
            pushName: typeof session.pushName === "string" && session.pushName ? session.pushName : null,
            secretId: secret.id,
            gatewayKeyId: created.id,
            allowedChats: [],
            createdByUserId: actorUserId,
          })
          .returning();
        await logOpenwaActivity(
          tx,
          {
            companyId: endpoint.companyId,
            endpointId: endpoint.id,
            action: "openwa.linked_session_added",
            actorUserId,
            details: { linkedSessionId: inserted!.id, phoneMasked: inserted!.phoneMasked },
          },
          publications,
        );
        return inserted!;
      });
      return view(row);
    } catch (error) {
      await revokeKey(created.id);
      if (secretId) await secrets.remove(secretId).catch(() => undefined);
      if (error instanceof Error && /chat_openwa_linked_sessions_endpoint_session_uq/.test(error.message + String((error as { cause?: unknown }).cause ?? "")))
        throw conflict("This WhatsApp session is already linked to this channel", { code: "openwa_linked_exists" });
      throw error;
    }
  }

  async function updateAllowedChats(endpointId: string, linkedId: string, chats: OpenwaLinkedChat[], actorUserId: string | null): Promise<OpenwaLinkedSessionView> {
    const endpoint = await endpointFor(endpointId);
    const next = chats.map((chat) => ({ chatId: openwaChatKey(chat.chatId), label: chat.label.trim(), isGroup: chat.chatId.toLowerCase().endsWith("@g.us") }));
    const row = await mutate(endpoint, async (tx, publications) => {
      const [current] = await tx
        .select()
        .from(chatOpenwaLinkedSessions)
        .where(
          and(
            eq(chatOpenwaLinkedSessions.companyId, endpoint.companyId),
            eq(chatOpenwaLinkedSessions.endpointId, endpoint.id),
            eq(chatOpenwaLinkedSessions.id, linkedId),
          ),
        )
        .for("update");
      if (!current) throw notFound("Linked number not found");
      const before = new Set(current.allowedChats.map((chat) => chat.chatId));
      const after = new Set(next.map((chat) => chat.chatId));
      const [updated] = await tx
        .update(chatOpenwaLinkedSessions)
        .set({ allowedChats: next, updatedAt: new Date() })
        .where(eq(chatOpenwaLinkedSessions.id, current.id))
        .returning();
      await logOpenwaActivity(
        tx,
        {
          companyId: endpoint.companyId,
          endpointId: endpoint.id,
          action: "openwa.linked_session_chats_changed",
          actorUserId,
          details: {
            linkedSessionId: current.id,
            chatCount: next.length,
            added: [...after].filter((chatId) => !before.has(chatId)).length,
            removed: [...before].filter((chatId) => !after.has(chatId)).length,
          },
        },
        publications,
      );
      return updated!;
    });
    return view(row);
  }

  async function unlink(endpointId: string, linkedId: string, actorUserId: string | null): Promise<OpenwaLinkedUnlinkResult> {
    const endpoint = await endpointFor(endpointId);
    const row = await rowFor(endpoint, linkedId);
    if (!row) throw notFound("Linked number not found");
    const revoked = await revokeGatewayKey(endpoint, row);
    const removed = await mutate(endpoint, async (tx, publications) => {
      const deleted = await deleteRows(tx, publications, endpoint, [{ row, revoked }], actorUserId, "unlinked");
      if (deleted.length === 0) throw notFound("Linked number not found");
      return deleted;
    });
    await removeSecrets(endpoint, removed);
    if (revoked) return { revoked: true };
    return {
      revoked: false,
      warning: "Unlinked, but OpenWA did not revoke the viewer key. Revoke the API key \"" + linkedKeyName(row.id) + "\" in the OpenWA dashboard.",
    };
  }

  async function gatewayChats(endpointId: string, linkedId: string, input: { limit: number; offset: number }): Promise<OpenwaLinkedGatewayChat[]> {
    const endpoint = await endpointFor(endpointId);
    const row = await rowFor(endpoint, linkedId);
    if (!row) throw notFound("Linked number not found");
    const client = await viewerFor(endpoint, row).catch(() => {
      throw new HttpError(409, "This linked number's key is no longer available. Unlink it and link it again.", { code: "openwa_linked_unavailable" });
    });
    const chats = await client.listChats({ limit: input.limit, offset: input.offset }).catch(async (error: unknown) => {
      if (error instanceof OpenwaGatewayError && (error.code === "unauthorized" || error.code === "forbidden")) {
        await setStatus(row, "unavailable");
        throw new HttpError(409, "OpenWA no longer accepts this linked number's key. Unlink it and link it again.", { code: "openwa_linked_unavailable" });
      }
      throw openwaSetupError(error, account(endpoint).baseUrl);
    });
    await setStatus(row, "active");
    const allowed = new Set(row.allowedChats.map((chat) => chat.chatId));
    return (Array.isArray(chats) ? chats : []).flatMap((chat) => {
      const id = chat && typeof chat.id === "string" ? chat.id : null;
      if (!id || !/@(c\.us|g\.us|lid)$/.test(id)) return [];
      const isGroup = id.endsWith("@g.us");
      return [
        {
          chatId: id,
          isGroup,
          name: typeof chat.name === "string" && chat.name ? chat.name : isGroup ? id : maskOpenwaPhoneNumber(id),
          allowed: allowed.has(openwaChatKey(id)),
        },
      ];
    });
  }

  return { list, linkableSessions, link, updateAllowedChats, unlink, removeForEndpoint, gatewayChats, rowsFor, rowFor, viewerFor, setStatus };
}

export type OpenwaLinkedService = ReturnType<typeof openwaLinkedService>;

/** Owner-only gate for linked-number tools: an owner-triggered run on this endpoint with the full profile. */
export function assertOpenwaLinkedOwnerRun(ctx: ToolContext): void {
  if (ctx.openwa?.triggerClass !== "owner" || ctx.openwa.endpointId !== ctx.endpoint.id || ctx.openwa.profile !== "full")
    throw new OpenwaToolError(403, "owner_only", "Only owner-triggered runs may read linked numbers");
}

function linkedChatRef(row: Pick<LinkedRow, "sessionId">, chatId: string): string {
  return "openwa:" + row.sessionId + ":" + chatId;
}

function linkedChatId(row: LinkedRow, value: string): string {
  const match = CHAT_REF.exec(value.trim());
  if (match && match[1] !== row.sessionId) throw new OpenwaToolError(403, "linked_chat_not_allowed", "The chatRef belongs to another WhatsApp session");
  const chatId = match ? match[2]! : value.trim();
  if (!CHAT_ID.test(chatId)) throw new OpenwaToolError(400, "invalid_target", "Use a chatRef from openwa_linked_list");
  return openwaChatKey(chatId);
}

export async function openwaLinkedListTool(ctx: ToolContext, linked: OpenwaLinkedService): Promise<Record<string, unknown>> {
  assertOpenwaLinkedOwnerRun(ctx);
  const rows = await linked.rowsFor(ctx.endpoint);
  return {
    linked: rows.map((row) => ({
      linkedRef: row.id,
      label: row.label,
      phoneMasked: row.phoneMasked,
      status: row.status,
      chats: row.allowedChats.map((chat) => ({ chatRef: linkedChatRef(row, chat.chatId), label: chat.label, isGroup: chat.isGroup })),
    })),
  };
}

async function allowedLinkedChat(ctx: ToolContext, linked: OpenwaLinkedService, args: Args) {
  assertOpenwaLinkedOwnerRun(ctx);
  const row = await linked.rowFor(ctx.endpoint, String(args.linkedRef));
  if (!row) throw new OpenwaToolError(404, "linked_session_unavailable", "No linked number with that linkedRef; call openwa_linked_list");
  const chatId = linkedChatId(row, String(args.chat));
  const allowed = row.allowedChats.find((chat) => chat.chatId === chatId);
  if (!allowed) throw new OpenwaToolError(403, "linked_chat_not_allowed", "The board has not allowed this chat on the linked number");
  return { row, chatId, allowed };
}

function linkedMessageView(ctx: Pick<ToolContext, "sessionId">, message: OpenwaHistoryMessage) {
  const view = liveView(ctx, message);
  if (view.media) return { ...view, media: { kind: message.type, ...view.media } };
  return MEDIA_TYPES.has(message.type) ? { ...view, media: { kind: message.type } } : view;
}

async function auditLinked(ctx: ToolContext, chatId: string, metadata: Record<string, unknown>): Promise<void> {
  try {
    await recordOpenwaAudit(ctx.db, {
      companyId: ctx.endpoint.companyId,
      endpointId: ctx.endpoint.id,
      kind: "linked_read",
      actorKind: "agent",
      actorRef: ctx.binding.agentId,
      chatKey: chatId,
      conversationId: ctx.conversation.id,
      runId: ctx.run.id,
      metadata,
      content: null,
    });
  } catch (error) {
    logger.warn({ err: error, endpointId: ctx.endpoint.id, runId: ctx.run.id }, "failed to record an OpenWA linked read audit");
  }
}

function linkedGatewayError(error: unknown, notFound: string): OpenwaToolError {
  if (error instanceof OpenwaGatewayError && error.code === "not_found") return new OpenwaToolError(404, "not_found", notFound);
  if (error instanceof OpenwaGatewayError && (error.code === "gateway_unavailable" || error.code === "uncertain"))
    return new OpenwaToolError(503, "gateway_unavailable", "The OpenWA gateway is unreachable");
  return new OpenwaToolError(502, "gateway_error", error instanceof Error ? error.message : String(error));
}

function revokedKey(error: unknown): boolean {
  return error instanceof OpenwaGatewayError && (error.code === "unauthorized" || error.code === "forbidden");
}

async function unavailable(linked: OpenwaLinkedService, row: LinkedRow): Promise<OpenwaToolError> {
  await linked.setStatus(row, "unavailable");
  return new OpenwaToolError(409, "linked_session_unavailable", "OpenWA no longer accepts this linked number's key; ask the board to link it again");
}

export async function openwaLinkedReadTool(ctx: ToolContext, linked: OpenwaLinkedService, args: Args): Promise<Record<string, unknown>> {
  const { row, chatId, allowed } = await allowedLinkedChat(ctx, linked, args);
  const cursor = typeof args.cursor === "string" && args.cursor ? args.cursor : null;
  if (cursor && !/^l:\d{1,4}$/.test(cursor)) throw new OpenwaToolError(400, "invalid_cursor", "The cursor is malformed");
  const offset = cursor ? Number(cursor.slice(2)) : 0;
  if (offset >= DEEP_LIMIT) throw new OpenwaToolError(400, "invalid_cursor", "The cursor is malformed");
  const limit = Math.min(Number(args.limit ?? 50), LIVE_LIMIT);
  const want = Math.min(offset + limit, offset + limit > LIVE_LIMIT ? DEEP_LIMIT : LIVE_LIMIT);
  const client = await linked.viewerFor(ctx.endpoint, row);
  let history: OpenwaHistoryMessage[];
  try {
    history = await client.chatHistory({ chatId, limit: want, deep: want > LIVE_LIMIT, includeMedia: false });
  } catch (error) {
    if (revokedKey(error)) throw await unavailable(linked, row);
    throw linkedGatewayError(error, "WhatsApp has no such chat on the linked number");
  }
  await linked.setStatus(row, "active");
  const scoped = { ...ctx, sessionId: row.sessionId };
  const ordered = [...history].sort((a, b) => b.timestamp - a.timestamp).slice(offset, offset + limit);
  const envelope = { linkedRef: row.id, chatRef: linkedChatRef(row, chatId), label: allowed.label };
  const fitted = fitPage(envelope, ordered.map((message) => linkedMessageView(scoped, message)));
  const consumed = offset + fitted.page.length;
  const more = fitted.truncated || (history.length >= want && consumed < DEEP_LIMIT);
  await auditLinked(ctx, chatId, { tool: "openwa_linked_read", linkedSessionId: row.id, count: fitted.page.length });
  return { ...envelope, messages: fitted.page, nextCursor: more ? "l:" + consumed : null, ...(fitted.truncated ? { truncated: true } : {}) };
}

export async function openwaLinkedGetMediaTool(ctx: ToolContext, linked: OpenwaLinkedService, args: Args): Promise<Record<string, unknown>> {
  const { row, chatId } = await allowedLinkedChat(ctx, linked, args);
  const messageId = String(args.messageId).trim();
  const ownChat = WA_MESSAGE_CHAT.exec(messageId);
  if (ownChat && openwaChatKey(ownChat[1]!) !== chatId) throw new OpenwaToolError(404, "not_found", "The message is not in this chat");
  const client = await linked.viewerFor(ctx.endpoint, row);
  const handle = await ctx.runtime();
  if (!handle.media) throw new OpenwaToolError(503, "gateway_unavailable", "OpenWA media handling is not available in this process");
  let items: OpenwaIngestedMedia[];
  try {
    items = await handle.media.fetchOpenwaMessageMedia({
      endpoint: ctx.endpoint,
      client,
      issueId: ctx.binding.issueId,
      chatId,
      messageId,
      rethrow: (error) => error instanceof OpenwaGatewayError && ["unauthorized", "forbidden", "not_found"].includes(error.code),
    });
  } catch (error) {
    if (revokedKey(error)) throw await unavailable(linked, row);
    if (error instanceof OpenwaGatewayError) throw linkedGatewayError(error, "No stored media for that message");
    throw error;
  }
  await linked.setStatus(row, "active");
  await auditLinked(ctx, chatId, { tool: "openwa_linked_get_media", linkedSessionId: row.id, messageId, count: items.length });
  return openwaMediaResult(ctx, handle, { linkedRef: row.id, chatRef: linkedChatRef(row, chatId), messageId }, items);
}
