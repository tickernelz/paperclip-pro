import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { chatActions, chatConversations, heartbeatRuns, type Db } from "@tickernelz/paperclip-pro-db";
import type { SpeechToTextErrorCode } from "../speech-to-text.js";
import { OPENWA_TRANSCRIPT_PAYLOAD_LIMIT, type OpenwaTranscriptListener, type OpenwaTranscriptReady } from "./media.js";

type DbOrTransaction = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export const OPENWA_LATE_TRANSCRIPT_ACTION_KIND = "openwa_late_transcripts";
export const OPENWA_LATE_TRANSCRIPT_CAP = 10;

export interface OpenwaLateTranscript {
  waMessageId: string;
  deliveryId: string | null;
  attachmentId: string;
  transcriptStatus: "done" | "unavailable";
  transcript?: string;
  transcriptTruncated?: true;
  transcriptError?: SpeechToTextErrorCode;
  activeRunId: string;
  readyAt: string;
}

export interface OpenwaLateTranscriptEvent {
  companyId: string;
  endpointId: string;
  conversationId: string;
  issueId: string;
  runId: string;
  transcript: OpenwaLateTranscript;
}

export type OpenwaLateTranscriptHook = (event: OpenwaLateTranscriptEvent) => void | Promise<void>;

function lateTranscriptActionId(conversationId: string): string {
  return "openwa-late-transcripts:" + conversationId;
}

/** Stores a transcript that finished after its wake was released, when the conversation still has a queued or running run. */
export async function recordOpenwaLateTranscript(db: DbOrTransaction, ready: OpenwaTranscriptReady, now = new Date()): Promise<OpenwaLateTranscriptEvent | null> {
  const [conversation] = await db
    .select({ id: chatConversations.id })
    .from(chatConversations)
    .where(
      and(
        eq(chatConversations.companyId, ready.companyId),
        eq(chatConversations.endpointId, ready.endpointId),
        eq(chatConversations.issueId, ready.issueId),
      ),
    )
    .orderBy(desc(chatConversations.createdAt))
    .limit(1);
  if (!conversation) return null;
  const [run] = await db
    .select({ id: heartbeatRuns.id })
    .from(heartbeatRuns)
    .where(
      and(
        eq(heartbeatRuns.companyId, ready.companyId),
        sql`(${heartbeatRuns.contextSnapshot} ->> 'issueId') = ${ready.issueId}`,
        inArray(heartbeatRuns.status, ["queued", "running"]),
      ),
    )
    .orderBy(desc(heartbeatRuns.createdAt))
    .limit(1);
  if (!run) return null;
  const transcript: OpenwaLateTranscript = {
    waMessageId: ready.waMessageId,
    deliveryId: ready.deliveryId,
    attachmentId: ready.attachmentId,
    transcriptStatus: ready.transcriptStatus,
    ...(ready.transcript !== undefined
      ? ready.transcript.length > OPENWA_TRANSCRIPT_PAYLOAD_LIMIT
        ? { transcript: ready.transcript.slice(0, OPENWA_TRANSCRIPT_PAYLOAD_LIMIT), transcriptTruncated: true as const }
        : { transcript: ready.transcript }
      : {}),
    ...(ready.transcriptError ? { transcriptError: ready.transcriptError } : {}),
    activeRunId: run.id,
    readyAt: now.toISOString(),
  };
  const item = JSON.stringify([transcript]);
  const stored = await db
    .insert(chatActions)
    .values({
      companyId: ready.companyId,
      endpointId: ready.endpointId,
      conversationId: conversation.id,
      kind: OPENWA_LATE_TRANSCRIPT_ACTION_KIND,
      providerActionId: lateTranscriptActionId(conversation.id),
      payload: { version: 1, items: [transcript] },
      status: "processed",
    })
    .onConflictDoUpdate({
      target: [chatActions.endpointId, chatActions.providerActionId],
      set: {
        payload: sql`jsonb_build_object('version', 1, 'items', coalesce(${chatActions.payload} -> 'items', '[]'::jsonb) || ${item}::jsonb)`,
        updatedAt: now,
      },
      setWhere: sql`${chatActions.companyId} = ${ready.companyId} and jsonb_array_length(coalesce(${chatActions.payload} -> 'items', '[]'::jsonb)) < ${OPENWA_LATE_TRANSCRIPT_CAP}`,
    })
    .returning({ id: chatActions.id });
  if (!stored.length) return null;
  return {
    companyId: ready.companyId,
    endpointId: ready.endpointId,
    conversationId: conversation.id,
    issueId: ready.issueId,
    runId: run.id,
    transcript,
  };
}

/** Claims the conversation's late transcripts for a run start; a rebuild of the same run sees the same items. */
export async function takeOpenwaLateTranscripts(
  db: DbOrTransaction,
  input: { companyId: string; endpointId: string; conversationId: string; runId: string },
): Promise<OpenwaLateTranscript[]> {
  const rows = await db
    .update(chatActions)
    .set({
      payload: sql`jsonb_build_object('version', 1, 'items', coalesce((
        select jsonb_agg(case when item ->> 'consumedByRunId' is null then item || jsonb_build_object('consumedByRunId', ${input.runId}::text) else item end)
        from jsonb_array_elements(coalesce(${chatActions.payload} -> 'items', '[]'::jsonb)) as item
        where item ->> 'consumedByRunId' is null or item ->> 'consumedByRunId' = ${input.runId}::text
      ), '[]'::jsonb))`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(chatActions.companyId, input.companyId),
        eq(chatActions.endpointId, input.endpointId),
        eq(chatActions.providerActionId, lateTranscriptActionId(input.conversationId)),
      ),
    )
    .returning({ payload: chatActions.payload });
  const items = rows[0]?.payload.items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const { consumedByRunId: _consumed, ...item } = entry as OpenwaLateTranscript & { consumedByRunId?: string };
    return typeof item.attachmentId === "string" && typeof item.waMessageId === "string" ? [item] : [];
  });
}

/** Builds the media service listener that records late transcripts and forwards them to the steering hook. */
export function openwaLateTranscriptListener(db: Db, hook?: OpenwaLateTranscriptHook): OpenwaTranscriptListener {
  return async (ready) => {
    const event = await recordOpenwaLateTranscript(db, ready);
    if (event && hook) await hook(event);
  };
}
