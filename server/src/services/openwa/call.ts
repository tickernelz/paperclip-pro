import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { chatActions, issueThreadInteractions } from "@tickernelz/paperclip-pro-db";
import { OPENWA_TOOL_RESULT_LIMIT_BYTES, type OpenwaApprovalCategory } from "@tickernelz/paperclip-pro-shared";
import type { OpenwaOperation } from "@tickernelz/paperclip-pro-shared/openwa-operations";
import { HttpError } from "../../errors.js";
import { listOpenwaAudit } from "./audit.js";
import { OpenwaApprovalRequiredError, assertOpenwaRunMay, restoreOpenwaGrant } from "./authority.js";
import {
  OPENWA_AUDIT_LIST_OPERATION,
  OPENWA_SECRET_ISSUING_OPERATIONS,
  learnOpenwaOperationUnavailable,
  openwaAuditListArgsSchema,
  openwaCatalog,
  openwaCatalogOperation,
  openwaDescribe,
  openwaEffectiveOperation,
  openwaEngine,
  openwaOperationMutating,
  openwaOperationUnavailable,
  openwaOperationVisible,
  type OpenwaCatalogCategory,
  type OpenwaCatalogScope,
  type OpenwaEffectiveOperation,
  type OpenwaUnavailableReason,
} from "./catalog.js";
import { OpenwaGatewayError, openwaOperationArgsError, type OpenwaCallResult, type OpenwaGatewayClient } from "./gateway.js";
import { openwaChatKey } from "./outbound.js";
import { markTriggersAnswered } from "./publication.js";
import { redactOpenwaSecrets } from "./redact.js";
import {
  OpenwaToolError,
  assertReadable,
  chatRef,
  consumeReplyGrants,
  fitPage,
  messageIdOf,
  prefixFor,
  replyRequirementFailure,
  resolveTarget,
  toolErrorFromGateway,
  type Target,
  type ToolContext,
} from "./tools.js";
import {
  claimOpenwaWrite,
  createOpenwaWrite,
  finishOpenwaWrite,
  openwaToolArgsHash,
  openwaWriteHashMatches,
  openwaWriteReplay,
  runOpenwaWrite,
  setOpenwaWriteGrant,
  settleOpenwaWrite,
  type OpenwaWriteScope,
} from "./tool-writes.js";

type Args = Record<string, unknown>;

const PROBE_TTL_MS = 5 * 60_000;
const RESULT_ENVELOPE_BYTES = 1024;
const TEXT_PAGE_BYTES = OPENWA_TOOL_RESULT_LIMIT_BYTES - RESULT_ENVELOPE_BYTES;
const INLINE_MEDIA_MIN_LENGTH = 512;
const INLINE_MEDIA = /^(data:[^;,]{1,100};base64,)?[A-Za-z0-9+/=\s]+$/;
const SCRUB_DEPTH = 12;
const CHAT_REF = /^openwa:([A-Za-z0-9-]{1,64}):(.+)$/;
const CHAT_ARGS = ["chatId", "groupId", "fromChatId", "toChatId", "contactId"] as const;
const PAGED_KEYS = ["data", "hits", "messages", "items", "results"] as const;
const PREFIXED_TEXT: Readonly<Record<string, string>> = {
  MessageController_sendText: "text",
  MessageController_reply: "text",
  MessageController_sendImage: "caption",
  MessageController_sendVideo: "caption",
  MessageController_sendDocument: "caption",
};
const MESSAGE_BODY: Readonly<Record<string, string>> = { ...PREFIXED_TEXT, MessageController_sendPoll: "name" };
const SELF_SESSION_CONFIRMATION_PREFIX = "openwa-self-session:";
const SELF_SESSION_RESOLVER_POLICY = "human_only";

interface GatewayProbe {
  engine: OpenwaCatalogScope["engine"];
  operatorKeyIsAdmin: boolean;
}

interface ResolvedScope {
  scope: OpenwaCatalogScope;
  gateway: OpenwaGatewayClient;
  handle: Awaited<ReturnType<ToolContext["runtime"]>>;
}

const probes = new WeakMap<OpenwaGatewayClient, { at: number; value: Promise<GatewayProbe> }>();

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function probe(gateway: OpenwaGatewayClient): Promise<GatewayProbe> {
  const cached = probes.get(gateway);
  if (cached && Date.now() - cached.at < PROBE_TTL_MS) return cached.value;
  const value = gateway.validateKey("operator").then(
    (validation) => ({ engine: openwaEngine(validation.engineType), operatorKeyIsAdmin: validation.role === "admin" }),
    () => {
      probes.delete(gateway);
      return { engine: null, operatorKeyIsAdmin: false };
    },
  );
  probes.set(gateway, { at: Date.now(), value });
  return value;
}

async function catalogScope(ctx: ToolContext): Promise<ResolvedScope> {
  const handle = await ctx.runtime();
  const { engine, operatorKeyIsAdmin } = await probe(handle.gateway);
  const account = ctx.endpoint.providerAccountId ?? "";
  const baseUrl = account.slice(0, Math.max(0, account.lastIndexOf("#")));
  return {
    gateway: handle.gateway,
    handle,
    scope: {
      engine,
      engineKey: baseUrl + "|" + (engine ?? "unknown"),
      hasAdminKey: handle.gateway.hasAdminKey,
      operatorKeyIsAdmin,
      gatewayAdminTools: ctx.policy.gatewayAdminTools,
    },
  };
}

function refusal(status: number, code: ConstructorParameters<typeof OpenwaToolError>[1], message: string, extra: Record<string, unknown> = {}): OpenwaToolError {
  return new OpenwaToolError(status, code, message, extra);
}

function parseCursor(cursor: unknown): { kind: "i" | "t"; offset: number } | null {
  const value = str(cursor);
  if (!value) return null;
  const match = /^([it]):(\d{1,9})$/.exec(value);
  if (!match) throw refusal(400, "invalid_cursor", "The cursor is malformed");
  return { kind: match[1] as "i" | "t", offset: Number(match[2]) };
}

function pageResult(value: unknown, cursor: { kind: "i" | "t"; offset: number } | null): { result: unknown; truncated: boolean; nextCursor: string | null } {
  const container = Array.isArray(value) ? null : PAGED_KEYS.find((key) => Array.isArray(record(value)[key])) ?? null;
  const items = Array.isArray(value) ? value : container ? (record(value)[container] as unknown[]) : null;
  if (items) {
    if (cursor?.kind === "t") throw refusal(400, "invalid_cursor", "This result pages by item");
    const offset = cursor?.offset ?? 0;
    const envelope = container ? { ...record(value), [container]: [] } : {};
    const fitted = fitPage(envelope, items.slice(offset));
    const result = container ? { ...envelope, [container]: fitted.page } : fitted.page;
    return { result, truncated: fitted.truncated, nextCursor: fitted.truncated ? "i:" + (offset + fitted.page.length) : null };
  }
  if (cursor?.kind === "i") throw refusal(400, "invalid_cursor", "This result pages by text");
  const serialized = typeof value === "string" ? value : JSON.stringify(value ?? null);
  const offset = cursor?.offset ?? 0;
  if (offset === 0 && Buffer.byteLength(serialized) <= TEXT_PAGE_BYTES) return { result: value ?? null, truncated: false, nextCursor: null };
  if (offset > serialized.length) throw refusal(400, "invalid_cursor", "The cursor is past the end of the result");
  let end = Math.min(serialized.length, offset + TEXT_PAGE_BYTES);
  while (end > offset && Buffer.byteLength(serialized.slice(offset, end)) > TEXT_PAGE_BYTES) end -= Math.ceil((end - offset) / 8);
  const more = end < serialized.length;
  return { result: { text: serialized.slice(offset, end) }, truncated: more, nextCursor: more ? "t:" + end : null };
}

function scrubInlineMedia(value: unknown, depth = 0): unknown {
  if (typeof value === "string")
    return value.length >= INLINE_MEDIA_MIN_LENGTH && INLINE_MEDIA.test(value.slice(0, 4096))
      ? "[inline media omitted: " + value.length + " characters]"
      : value;
  if (!value || typeof value !== "object" || depth >= SCRUB_DEPTH) return value;
  if (Array.isArray(value)) return value.map((entry) => scrubInlineMedia(entry, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) out[key] = scrubInlineMedia(entry, depth + 1);
  return out;
}

function ownSessionOnly(value: unknown, sessionId: string, field: "sessionId" | "id"): unknown {
  const keep = (entry: unknown) => record(entry)[field] === sessionId;
  if (Array.isArray(value)) return value.filter(keep);
  const container = PAGED_KEYS.find((key) => Array.isArray(record(value)[key]));
  if (!container) return value;
  const out: Record<string, unknown> = { ...record(value), [container]: (record(value)[container] as unknown[]).filter(keep) };
  delete out.total;
  return out;
}

function resultValue(effective: OpenwaEffectiveOperation, ctx: ToolContext, result: OpenwaCallResult): unknown {
  if (result.kind === "empty") return { status: result.status };
  if (result.kind === "binary") {
    result.media.stream.destroy();
    return {
      binary: { contentType: result.media.contentType, contentLength: result.media.contentLength, filename: result.media.filename },
      hint: "Media is never returned inline; store message media with openwa_get_media.",
    };
  }
  const data = redactOpenwaSecrets(scrubInlineMedia(result.data));
  if (effective.operation.sessionParam === "query") return ownSessionOnly(data, ctx.sessionId, "sessionId");
  if (effective.operation.id === "SessionController_findAll" && !effective.useAdminKey) return ownSessionOnly(data, ctx.sessionId, "id");
  return data;
}

function rewriteChatRef(ctx: ToolContext, value: unknown): unknown {
  if (typeof value !== "string") return value;
  const match = CHAT_REF.exec(value.trim());
  if (!match) return value;
  if (match[1] !== ctx.sessionId) throw refusal(400, "invalid_target", "The chatRef belongs to another WhatsApp session");
  return match[2]!;
}

function normalizeChatArgs(ctx: ToolContext, operation: OpenwaOperation, args: Args): Args {
  const out: Args = { ...args };
  for (const name of CHAT_ARGS) if (name in out) out[name] = rewriteChatRef(ctx, out[name]);
  if (operation.targetChatArg === "messages[].chatId" && Array.isArray(out.messages))
    out.messages = out.messages.map((message) =>
      message && typeof message === "object" && !Array.isArray(message)
        ? { ...(message as Args), chatId: rewriteChatRef(ctx, (message as Args).chatId) }
        : message,
    );
  return out;
}

function chatTarget(ctx: ToolContext, chatId: string): Target {
  const chatKey = openwaChatKey(chatId);
  const isOrigin = chatKey === ctx.origin.chatKey;
  return { chatId: isOrigin ? ctx.origin.chatId : chatId, chatKey, isGroup: /@g\.us$/i.test(chatId), isOrigin, number: null };
}

function sendTargets(operation: OpenwaOperation, ctx: ToolContext, args: Args): Target[] {
  if (!operation.targetChatArg) return [];
  const ids =
    operation.targetChatArg === "messages[].chatId"
      ? (Array.isArray(args.messages) ? args.messages : []).map((message) => record(message).chatId)
      : [args[operation.targetChatArg]];
  return ids.map((id) => chatTarget(ctx, String(id)));
}

function withPrefix(ctx: ToolContext, operation: OpenwaOperation, args: Args): Args {
  const prefix = prefixFor(ctx);
  if (!prefix) return args;
  const field = PREFIXED_TEXT[operation.id];
  if (field && typeof args[field] === "string") return { ...args, [field]: prefix + "\n" + args[field] };
  if (operation.id !== "MessageController_sendBulk" || !Array.isArray(args.messages)) return args;
  return {
    ...args,
    messages: args.messages.map((message) => {
      const content = record(record(message).content);
      for (const key of ["text", "caption"] as const)
        if (typeof content[key] === "string") return { ...record(message), content: { ...content, [key]: prefix + "\n" + content[key] } };
      return message;
    }),
  };
}

function bulkBody(args: Args, index: number): string {
  const content = record(record((args.messages as unknown[] | undefined)?.[index]).content);
  return str(content.text) ?? str(content.caption) ?? "";
}

function secretIssuingError(operationId: string): OpenwaToolError {
  return refusal(403, "secret_issuing_operation", "This operation issues a credential or device-linking code shown only once; do it in the OpenWA dashboard", { operationId });
}

function unavailableError(reason: OpenwaUnavailableReason, operationId: string): OpenwaToolError {
  if (reason === "secret_issuing_operation") return secretIssuingError(operationId);
  return reason === "unavailable_on_engine"
    ? refusal(422, "unavailable_on_engine", "This operation is not supported by the gateway's WhatsApp engine", { operationId })
    : refusal(422, "unavailable_without_admin_key", "This operation needs an OpenWA admin key, which is not configured", { operationId });
}

async function mayCategory(ctx: ToolContext, category: OpenwaApprovalCategory, retry: boolean): Promise<string | null> {
  try {
    return await assertOpenwaRunMay(ctx.db, ctx.run, category, retry ? { consume: false } : {});
  } catch (error) {
    if (error instanceof OpenwaApprovalRequiredError)
      throw refusal(403, "approval_required", "This operation needs owner approval for " + category, {
        category,
        hint: "Ask an endpoint owner with openwa_request_approval, then continue in the approved run.",
      });
    throw error;
  }
}

async function assertReadsAllowed(ctx: ToolContext, operation: OpenwaOperation, args: Args): Promise<void> {
  for (const name of ["chatId", "groupId", "fromChatId"] as const) {
    const value = str(args[name]);
    if (!value || (name === "chatId" && operation.targetChatArg === "chatId")) continue;
    const target = chatTarget(ctx, value);
    ctx.audit.chatKey = target.chatKey;
    await assertReadable(ctx, target);
  }
}

async function assertGate(
  ctx: ToolContext,
  effective: OpenwaEffectiveOperation,
  args: Args,
  retry: boolean,
  heldGrant: string | null,
): Promise<{ grant: string | null; targets: Target[] }> {
  const { operation } = effective;
  if (effective.gate === "none") return { grant: null, targets: [] };
  if (effective.gate === "wa_admin" || effective.gate === "gateway_admin" || effective.gate === "owner_confirmation")
    return { grant: heldGrant ? null : await mayCategory(ctx, effective.gate === "wa_admin" ? "wa_admin" : "gateway_admin", retry), targets: [] };
  const targets = sendTargets(operation, ctx, args);
  if (targets.length) ctx.audit.chatKey = targets[0]!.chatKey;
  if (targets.length === 0 || targets.some((target) => !target.isOrigin))
    return { grant: heldGrant ? null : await mayCategory(ctx, "cross_chat_send", retry), targets };
  const failure = await replyRequirementFailure(ctx);
  if (failure)
    throw refusal(403, "reply_denied", failure.reason + "; replying here needs owner approval", {
      category: failure.category,
      hint: "Ask an endpoint owner with openwa_request_approval, or stay silent.",
    });
  return { grant: null, targets };
}

function isOwnerRun(ctx: ToolContext): boolean {
  return ctx.openwa?.triggerClass === "owner" && ctx.openwa.endpointId === ctx.endpoint.id;
}

async function selfSessionConfirmation(ctx: ToolContext, operation: OpenwaOperation, actionId: string): Promise<string> {
  const prefix = SELF_SESSION_CONFIRMATION_PREFIX + ctx.endpoint.id + ":" + operation.id + ":";
  const issueId = ctx.conversation.issueId;
  const [latest] = await ctx.db
    .select({ id: issueThreadInteractions.id, status: issueThreadInteractions.status })
    .from(issueThreadInteractions)
    .where(
      and(
        eq(issueThreadInteractions.companyId, ctx.endpoint.companyId),
        eq(issueThreadInteractions.issueId, issueId),
        eq(issueThreadInteractions.kind, "request_confirmation"),
        sql`starts_with(${issueThreadInteractions.idempotencyKey}, ${prefix})`,
      ),
    )
    .orderBy(desc(issueThreadInteractions.createdAt))
    .limit(1);
  if (latest?.status === "accepted") {
    const [used] = await ctx.db
      .select({ id: chatActions.id })
      .from(chatActions)
      .where(
        and(
          eq(chatActions.companyId, ctx.endpoint.companyId),
          eq(chatActions.endpointId, ctx.endpoint.id),
          ne(chatActions.id, actionId),
          inArray(chatActions.status, ["processing", "processed", "uncertain"]),
          sql`${chatActions.payload}->>'confirmationId' = ${latest.id}`,
        ),
      )
      .limit(1);
    if (!used) return latest.id;
  }
  let pendingId = latest?.status === "pending" ? latest.id : null;
  if (!pendingId) {
    const { issueThreadInteractionService } = await import("../issue-thread-interactions.js");
    const created = await issueThreadInteractionService(ctx.db).create(
      { id: issueId, companyId: ctx.endpoint.companyId },
      {
        kind: "request_confirmation",
        idempotencyKey: prefix + actionId,
        sourceRunId: ctx.run.id,
        resolverPolicy: SELF_SESSION_RESOLVER_POLICY,
        continuationPolicy: "none",
        title: "Confirm WhatsApp session action",
        payload: {
          version: 1,
          prompt: "Allow the agent to run " + operation.id + " on this endpoint's own WhatsApp session?",
          detailsMarkdown: operation.summary + ". The agent stays disconnected from WhatsApp until the session is reconnected in OpenWA.",
          acceptLabel: "Allow",
          rejectLabel: "Deny",
          allowDeclineReason: true,
        },
      },
      { agentId: ctx.binding.agentId, runId: ctx.run.id },
      { supersedePendingSiblingInteractions: false },
    );
    pendingId = created.id;
  }
  throw refusal(403, "self_session_requires_confirmation", "An endpoint owner must allow this in Paperclip first; call again with the same idempotencyKey after it is accepted", {
    category: "gateway_admin",
    interactionId: pendingId,
  });
}

async function paperclipAuditList(ctx: ToolContext, args: Args, cursor: string | null): Promise<Record<string, unknown>> {
  if (!isOwnerRun(ctx)) throw refusal(403, "owner_only", "Only owner-triggered runs may read this endpoint's audit");
  const parsed = openwaAuditListArgsSchema.safeParse(args);
  if (!parsed.success)
    throw refusal(400, "invalid_arguments", parsed.error.issues.map((issue) => issue.path.join(".") + ": " + issue.message).join("; "));
  const filters = parsed.data;
  const target = filters.chat ? resolveTarget(ctx, filters.chat) : null;
  const page = await listOpenwaAudit(ctx.db, {
    companyId: ctx.endpoint.companyId,
    endpointId: ctx.endpoint.id,
    viewer: { type: "owner_run", runId: ctx.run.id },
    filters: {
      ...(filters.kinds ? { kinds: filters.kinds } : {}),
      ...(target ? { chatKey: target.chatKey } : {}),
      ...(filters.actorKind ? { actorKind: filters.actorKind } : {}),
      ...(filters.from ? { from: new Date(filters.from) } : {}),
      ...(filters.to ? { to: new Date(filters.to) } : {}),
    },
    ...(cursor ? { cursor } : {}),
    limit: filters.limit ?? 25,
  }).catch((error: unknown) => {
    if (error instanceof HttpError && error.status === 403) throw refusal(403, "owner_only", error.message);
    throw error;
  });
  const envelope = { operation: OPENWA_AUDIT_LIST_OPERATION, access: page.access };
  const fitted = fitPage(envelope, page.items);
  const last = fitted.page.at(-1);
  const nextCursor = fitted.truncated && last ? Buffer.from(JSON.stringify([last.occurredAt, last.id])).toString("base64url") : page.nextCursor;
  return { ...envelope, items: fitted.page, nextCursor, ...(fitted.truncated ? { truncated: true } : {}) };
}

async function dispatch(resolved: ResolvedScope, effective: OpenwaEffectiveOperation, args: Args): Promise<OpenwaCallResult> {
  try {
    return await resolved.gateway.call(effective.operation.id, args, { useAdminKey: effective.useAdminKey });
  } catch (error) {
    if (error instanceof OpenwaGatewayError && error.code === "unavailable_on_engine") learnOpenwaOperationUnavailable(resolved.scope, effective.operation.id);
    throw error;
  }
}

async function executeWrite(ctx: ToolContext, resolved: ResolvedScope, effective: OpenwaEffectiveOperation, args: Args, idempotencyKey: string): Promise<Record<string, unknown>> {
  const { operation } = effective;
  const scope: OpenwaWriteScope = {
    companyId: ctx.endpoint.companyId,
    endpointId: ctx.endpoint.id,
    conversationId: ctx.conversation.id,
    issueId: ctx.binding.issueId,
    runId: ctx.binding.runId,
    tool: "openwa_call",
    idempotencyKey,
  };
  const hash = openwaToolArgsHash("openwa_call", { operation: operation.id, args });
  let action = await createOpenwaWrite(ctx.db, scope, hash, { operation: operation.id, chatKey: ctx.audit.chatKey });
  ctx.audit.actionId = action.id;
  if (!openwaWriteHashMatches(action, hash))
    throw refusal(409, "idempotency_conflict", "This idempotencyKey already belongs to a different OpenWA operation", { actionId: action.id });
  const replay = openwaWriteReplay(action);
  if (replay) return replay;
  const heldGrant = str(action.payload.grantId);
  if (effective.gate === "owner_confirmation" && typeof action.payload.confirmationId !== "string") {
    await assertGate(ctx, effective, args, true, heldGrant);
    const confirmationId = await selfSessionConfirmation(ctx, operation, action.id);
    const [updated] = await ctx.db
      .update(chatActions)
      .set({ payload: { ...action.payload, confirmationId }, updatedAt: new Date() })
      .where(eq(chatActions.id, action.id))
      .returning();
    action = updated ?? action;
  }
  const retry = action.status === "uncertain" || action.status === "processing";
  const { grant, targets } = await assertGate(ctx, effective, args, retry, heldGrant);
  if (grant) await setOpenwaWriteGrant(ctx.db, action.id, grant);
  const restore = async () => {
    if (!grant) return;
    await restoreOpenwaGrant(ctx.db, { companyId: ctx.endpoint.companyId, runId: ctx.run.id, grantId: grant });
    await setOpenwaWriteGrant(ctx.db, action.id, null);
  };
  const sent = withPrefix(ctx, operation, args);
  let value: unknown;
  let messageIds: string[] = [];
  if (operation.sendsMessage && operation.id !== "MessageController_sendBulk" && operation.response === "json") {
    let data: unknown = null;
    const outcome = await runOpenwaWrite(ctx.db, {
      action,
      registry: resolved.handle.registry,
      gateway: resolved.gateway,
      chatId: targets[0]!.chatId,
      runId: ctx.run.id,
      sends: [
        {
          key: "call",
          body: str(sent[MESSAGE_BODY[operation.id] ?? ""]) ?? "",
          send: async () => {
            const result = await dispatch(resolved, effective, sent);
            data = result.kind === "json" ? result.data : null;
            return messageIdOf(data);
          },
        },
      ],
    });
    if (outcome.state === "failed") {
      if (outcome.delivered === 0) await restore();
      const mapped = toolErrorFromGateway(outcome.error, false);
      if (mapped instanceof HttpError) mapped.details = { ...record(mapped.details), actionId: action.id, state: "failed" };
      throw mapped;
    }
    if (outcome.state !== "delivered")
      return {
        actionId: action.id,
        state: outcome.state,
        instruction: "The outcome is not confirmed yet. Do not call again with a new key; retry later with the same idempotencyKey to reconcile.",
      };
    messageIds = outcome.messageIds;
    value = data === null ? { messageId: messageIds[0] } : redactOpenwaSecrets(scrubInlineMedia(data));
  } else {
    const claimed = await claimOpenwaWrite(ctx.db, action);
    if (!claimed)
      return { actionId: action.id, state: "processing", instruction: "Another call with this idempotencyKey is running; retry later with the same key." };
    const reserved = operation.sendsMessage
      ? await Promise.all(
          targets.map((target, index) =>
            resolved.handle.registry.reserve({
              companyId: ctx.endpoint.companyId,
              endpointId: ctx.endpoint.id,
              chatKey: target.chatKey,
              source: "tool",
              body: bulkBody(sent, index),
              runId: ctx.run.id,
            }),
          ),
        )
      : [];
    try {
      value = resultValue(effective, ctx, await dispatch(resolved, effective, sent));
    } catch (error) {
      const definite = error instanceof OpenwaGatewayError && error.code !== "uncertain";
      await Promise.all(
        reserved.map((entry) => resolved.handle.registry.settle({ record: entry, providerMessageId: null, state: definite ? "failed" : "uncertain" })),
      );
      await settleOpenwaWrite(ctx.db, action.id, definite ? "failed" : "uncertain");
      if (definite) await restore();
      const mapped = toolErrorFromGateway(error, false);
      if (mapped instanceof HttpError) mapped.details = { ...record(mapped.details), actionId: action.id, state: definite ? "failed" : "uncertain" };
      throw mapped;
    }
  }
  const toOrigin = operation.sendsMessage && targets.length > 0 && targets.every((target) => target.isOrigin);
  const answeredTriggerIds =
    toOrigin && ctx.runClass
      ? await markTriggersAnswered(ctx.db, {
          companyId: ctx.endpoint.companyId,
          endpointId: ctx.endpoint.id,
          chatKey: ctx.origin.chatKey,
          quotedMessageId: str(args.quotedMessageId),
          runClass: ctx.runClass,
          visibleBefore: ctx.run.visibleBefore,
        })
      : [];
  if (toOrigin) await consumeReplyGrants(ctx);
  const paged = pageResult(value, null);
  const receipt = {
    operation: operation.id,
    result: paged.result,
    ...(paged.truncated ? { truncated: true } : {}),
    ...(messageIds.length ? { messageIds } : {}),
    ...(targets.length ? { chatRefs: [...new Set(targets.map((target) => chatRef(ctx, target.chatId)))] } : {}),
    ...(answeredTriggerIds.length ? { answeredTriggerIds } : {}),
  };
  await finishOpenwaWrite(ctx.db, action, receipt);
  return { actionId: action.id, state: "delivered", ...receipt };
}

export async function openwaCatalogTool(ctx: ToolContext, args: Args): Promise<Record<string, unknown>> {
  const { scope } = await catalogScope(ctx);
  const entries = openwaCatalog(scope, {
    ...(args.category ? { category: args.category as OpenwaCatalogCategory } : {}),
    ...(typeof args.query === "string" ? { query: args.query } : {}),
  });
  const cursor = parseCursor(args.cursor);
  if (cursor?.kind === "t") throw refusal(400, "invalid_cursor", "The catalog pages by item");
  const offset = cursor?.offset ?? 0;
  const envelope = { engine: scope.engine, gatewayAdminTools: scope.gatewayAdminTools, adminKey: scope.hasAdminKey, total: entries.length };
  const fitted = fitPage(envelope, entries.slice(offset));
  const next = offset + fitted.page.length;
  return { ...envelope, operations: fitted.page, nextCursor: next < entries.length ? "i:" + next : null };
}

export async function openwaDescribeTool(ctx: ToolContext, args: Args): Promise<Record<string, unknown>> {
  const operationId = String(args.operation);
  ctx.audit.operation = operationId;
  const { scope } = await catalogScope(ctx);
  const description = openwaDescribe(scope, operationId);
  if (description) return { ...description };
  if (openwaCatalogOperation(operationId)?.category === "gateway_admin")
    throw refusal(403, "gateway_admin_disabled", "Gateway admin operations are not enabled for this endpoint", { operationId });
  throw refusal(404, "not_found", "Unknown OpenWA operation; list operations with openwa_catalog", { operationId });
}

export async function openwaCallTool(ctx: ToolContext, input: Args): Promise<Record<string, unknown>> {
  const operationId = String(input.operation);
  ctx.audit.operation = operationId;
  const rawArgs = record(input.args);
  if (operationId === OPENWA_AUDIT_LIST_OPERATION) return paperclipAuditList(ctx, rawArgs, str(input.cursor));
  const operation = openwaCatalogOperation(operationId);
  if (!operation) throw refusal(404, "not_found", "Unknown OpenWA operation; list operations with openwa_catalog", { operationId });
  if (OPENWA_SECRET_ISSUING_OPERATIONS.has(operationId)) throw secretIssuingError(operationId);
  const resolved = await catalogScope(ctx);
  const effective = openwaEffectiveOperation(operation, resolved.scope);
  if (!openwaOperationVisible(effective, resolved.scope))
    throw refusal(403, "gateway_admin_disabled", "Gateway admin operations are not enabled for this endpoint", { operationId, category: "gateway_admin" });
  const unavailable = openwaOperationUnavailable(effective, resolved.scope);
  if (unavailable) throw unavailableError(unavailable, operationId);
  const args = normalizeChatArgs(ctx, operation, rawArgs);
  const invalid = openwaOperationArgsError(operation, args);
  if (invalid) throw refusal(400, "invalid_arguments", operationId + " rejected its arguments: " + invalid, { operationId });
  await assertReadsAllowed(ctx, operation, args);
  if (effective.gate === "owner_confirmation" && !isOwnerRun(ctx))
    throw refusal(403, "owner_only", "Only owner-triggered runs may stop, log out or delete this WhatsApp session", { operationId });
  if (openwaOperationMutating(effective)) {
    if (input.cursor !== undefined) throw refusal(400, "invalid_cursor", "Only read operations page with a cursor");
    const idempotencyKey = str(input.idempotencyKey);
    if (!idempotencyKey) throw refusal(400, "invalid_arguments", operationId + " changes state and needs an idempotencyKey", { operationId });
    return executeWrite(ctx, resolved, effective, args, idempotencyKey);
  }
  const cursor = parseCursor(input.cursor);
  const { grant } = await assertGate(ctx, effective, args, false, null);
  let result: OpenwaCallResult;
  try {
    result = await dispatch(resolved, effective, args);
  } catch (error) {
    if (grant) await restoreOpenwaGrant(ctx.db, { companyId: ctx.endpoint.companyId, runId: ctx.run.id, grantId: grant });
    throw toolErrorFromGateway(error, false);
  }
  const paged = pageResult(resultValue(effective, ctx, result), cursor);
  return { operation: operationId, result: paged.result, ...(paged.truncated ? { truncated: true } : {}), nextCursor: paged.nextCursor };
}
