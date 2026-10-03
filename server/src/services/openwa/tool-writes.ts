import { createHash } from "node:crypto";
import { and, eq, inArray, lt, or } from "drizzle-orm";
import { chatActions, chatOutboundMessages, type Db } from "@tickernelz/paperclip-pro-db";
import { OpenwaGatewayError, type OpenwaGatewayClient, type OpenwaSendResult } from "./gateway.js";
import { sendThroughRegistry, type OpenwaOutboundRegistry } from "./outbound.js";

export const OPENWA_TOOL_WRITE_ACTION_KIND = "openwa_tool_write";
const STALE_PROCESSING_MS = 2 * 60_000;

type ActionRow = typeof chatActions.$inferSelect;

export interface OpenwaWriteScope {
  companyId: string;
  endpointId: string;
  conversationId: string;
  issueId: string;
  runId: string;
  tool: string;
  idempotencyKey: string;
}

export interface OpenwaPlannedSend {
  key: string;
  body: string;
  send: () => Promise<OpenwaSendResult>;
}

interface PartState {
  outboundId: string | null;
  messageId: string | null;
}

export type OpenwaWriteOutcome =
  | { state: "delivered"; messageIds: string[] }
  | { state: "uncertain" | "processing" }
  | { state: "failed"; error: unknown; delivered: number };

export function openwaToolActionKey(scope: Pick<OpenwaWriteScope, "issueId" | "runId" | "idempotencyKey">): string {
  return "openwa-tool:" + scope.issueId + ":" + scope.runId + ":" + scope.idempotencyKey;
}

export function openwaToolArgsHash(tool: string, args: Record<string, unknown>): string {
  const { idempotencyKey: _key, ...rest } = args;
  return createHash("sha256").update(JSON.stringify({ tool, args: rest })).digest("hex");
}

export async function findOpenwaWrite(db: Db, scope: OpenwaWriteScope): Promise<ActionRow | null> {
  const [row] = await db
    .select()
    .from(chatActions)
    .where(
      and(
        eq(chatActions.companyId, scope.companyId),
        eq(chatActions.endpointId, scope.endpointId),
        eq(chatActions.providerActionId, openwaToolActionKey(scope)),
      ),
    )
    .limit(1);
  return row ?? null;
}

export function openwaWriteHashMatches(action: ActionRow, hash: string): boolean {
  return action.kind === OPENWA_TOOL_WRITE_ACTION_KIND && action.payload.hash === hash;
}

export function openwaWriteReplay(action: ActionRow): Record<string, unknown> | null {
  if (action.status !== "processed") return null;
  const receipt = action.result?.receipt;
  return { ...(receipt && typeof receipt === "object" ? (receipt as Record<string, unknown>) : {}), actionId: action.id, state: "delivered", replayed: true };
}

export async function createOpenwaWrite(
  db: Db,
  scope: OpenwaWriteScope,
  hash: string,
  payload: Record<string, unknown>,
): Promise<ActionRow> {
  const [created] = await db
    .insert(chatActions)
    .values({
      companyId: scope.companyId,
      endpointId: scope.endpointId,
      conversationId: scope.conversationId,
      kind: OPENWA_TOOL_WRITE_ACTION_KIND,
      providerActionId: openwaToolActionKey(scope),
      status: "received",
      payload: { version: 1, tool: scope.tool, hash, issueId: scope.issueId, runId: scope.runId, ...payload },
      result: { parts: {} },
    })
    .onConflictDoNothing()
    .returning();
  return created ?? (await findOpenwaWrite(db, scope))!;
}

function partsOf(action: ActionRow): Record<string, PartState> {
  const parts = action.result?.parts;
  return parts && typeof parts === "object" ? { ...(parts as Record<string, PartState>) } : {};
}

async function saveParts(db: Db, actionId: string, parts: Record<string, PartState>, status?: string) {
  await db
    .update(chatActions)
    .set({ result: { parts }, ...(status ? { status } : {}), updatedAt: new Date() })
    .where(eq(chatActions.id, actionId));
}

async function outboundRow(db: Db, action: ActionRow, outboundId: string) {
  const [row] = await db
    .select({ state: chatOutboundMessages.state, providerMessageId: chatOutboundMessages.providerMessageId })
    .from(chatOutboundMessages)
    .where(
      and(
        eq(chatOutboundMessages.companyId, action.companyId),
        eq(chatOutboundMessages.endpointId, action.endpointId),
        eq(chatOutboundMessages.id, outboundId),
      ),
    );
  return row ?? null;
}

/** Claims a receipt for execution; null while another call holds a fresh claim. */
export async function claimOpenwaWrite(db: Db, action: ActionRow): Promise<ActionRow | null> {
  const now = new Date();
  const [claimed] = await db
    .update(chatActions)
    .set({ status: "processing", updatedAt: now })
    .where(
      and(
        eq(chatActions.id, action.id),
        or(
          inArray(chatActions.status, ["received", "failed", "uncertain"]),
          and(eq(chatActions.status, "processing"), lt(chatActions.updatedAt, new Date(now.getTime() - STALE_PROCESSING_MS))),
        ),
      ),
    )
    .returning();
  return claimed ?? null;
}

export async function settleOpenwaWrite(db: Db, actionId: string, status: "failed" | "uncertain"): Promise<void> {
  await db.update(chatActions).set({ status, updatedAt: new Date() }).where(eq(chatActions.id, actionId));
}

export async function runOpenwaWrite(
  db: Db,
  input: {
    action: ActionRow;
    registry: OpenwaOutboundRegistry;
    gateway: OpenwaGatewayClient;
    chatId: string;
    runId: string;
    sends: OpenwaPlannedSend[];
  },
): Promise<OpenwaWriteOutcome> {
  const claimed = await claimOpenwaWrite(db, input.action);
  if (!claimed) return { state: "processing" };
  const parts = partsOf(claimed);
  const messageIds: string[] = [];
  let reconciled = false;
  for (const planned of input.sends) {
    const part: PartState = parts[planned.key] ?? { outboundId: null, messageId: null };
    parts[planned.key] = part;
    if (!part.messageId && part.outboundId) {
      let row = await outboundRow(db, claimed, part.outboundId);
      if (row && (row.state === "pending" || row.state === "uncertain") && !reconciled) {
        reconciled = true;
        await input.registry.reconcileUncertain(claimed.companyId, claimed.endpointId, input.gateway);
        row = await outboundRow(db, claimed, part.outboundId);
      }
      if (row?.state === "sent" && row.providerMessageId) part.messageId = row.providerMessageId;
      else if (row?.state === "failed" || !row) part.outboundId = null;
      else {
        await saveParts(db, claimed.id, parts, "uncertain");
        return { state: "uncertain" };
      }
    }
    if (part.messageId) {
      messageIds.push(part.messageId);
      continue;
    }
    const registry: OpenwaOutboundRegistry = {
      ...input.registry,
      reserve: async (reservation) => {
        const record = await input.registry.reserve(reservation);
        part.outboundId = record.id;
        await saveParts(db, claimed.id, parts);
        return record;
      },
    };
    try {
      const { result } = await sendThroughRegistry({
        registry,
        companyId: claimed.companyId,
        endpointId: claimed.endpointId,
        chatId: input.chatId,
        source: "tool",
        body: planned.body,
        runId: input.runId,
        send: planned.send,
      });
      part.messageId = result.messageId;
      messageIds.push(result.messageId);
      await saveParts(db, claimed.id, parts);
    } catch (error) {
      const open = !(error instanceof OpenwaGatewayError) || error.code === "uncertain" || error.code === "invalid_response";
      if (open && part.outboundId) {
        await saveParts(db, claimed.id, parts, "uncertain");
        return { state: "uncertain" };
      }
      await saveParts(db, claimed.id, parts, "failed");
      return { state: "failed", error, delivered: messageIds.length };
    }
  }
  return { state: "delivered", messageIds };
}

export async function finishOpenwaWrite(db: Db, action: ActionRow, receipt: Record<string, unknown>) {
  const [current] = await db.select({ result: chatActions.result }).from(chatActions).where(eq(chatActions.id, action.id));
  await db
    .update(chatActions)
    .set({ status: "processed", result: { ...(current?.result ?? {}), receipt }, updatedAt: new Date() })
    .where(eq(chatActions.id, action.id));
}
