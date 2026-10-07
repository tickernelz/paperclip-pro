import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@tickernelz/paperclip-pro-db";
import { webPushSubscriptions } from "@tickernelz/paperclip-pro-db";
import type {
  NotificationKind,
  PaperclipNotification,
  UpsertWebPushSubscription,
  WebPushSubscriptionRecord,
} from "@tickernelz/paperclip-pro-shared";
import { logger } from "../../middleware/logger.js";
import type { WebPushSender } from "./web-push.js";

type SubscriptionRow = typeof webPushSubscriptions.$inferSelect;

export interface WebPushDeliveryResult {
  sent: number;
  failed: number;
}

function toRecord(row: SubscriptionRow): WebPushSubscriptionRecord {
  return {
    id: row.id,
    endpoint: row.endpoint,
    kinds: row.kinds,
    createdAt: row.createdAt.toISOString(),
    lastSuccessAt: row.lastSuccessAt ? row.lastSuccessAt.toISOString() : null,
  };
}

export async function upsertWebPushSubscription(
  db: Db,
  userId: string,
  input: UpsertWebPushSubscription,
  userAgent: string | null,
): Promise<WebPushSubscriptionRecord> {
  const now = new Date();
  const kinds = [...new Set(input.kinds)];
  const [row] = await db
    .insert(webPushSubscriptions)
    .values({
      userId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      kinds,
      userAgent,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: webPushSubscriptions.endpoint,
      set: {
        userId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        kinds,
        userAgent,
        failureCount: 0,
        updatedAt: now,
      },
    })
    .returning();
  return toRecord(row!);
}

export async function deleteWebPushSubscription(db: Db, userId: string, endpoint: string) {
  await db
    .delete(webPushSubscriptions)
    .where(and(eq(webPushSubscriptions.userId, userId), eq(webPushSubscriptions.endpoint, endpoint)));
}

function expiredStatus(error: unknown) {
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  return statusCode === 404 || statusCode === 410;
}

export async function deliverWebPush(
  db: Db,
  sender: WebPushSender,
  input: { userIds: string[]; notification: PaperclipNotification; kind: NotificationKind | null },
): Promise<WebPushDeliveryResult> {
  if (input.userIds.length === 0) return { sent: 0, failed: 0 };
  const rows = await db
    .select()
    .from(webPushSubscriptions)
    .where(inArray(webPushSubscriptions.userId, input.userIds));
  const kind = input.kind;
  const targets = kind ? rows.filter((row) => row.kinds.includes(kind)) : rows;
  if (targets.length === 0) return { sent: 0, failed: 0 };
  const payload = JSON.stringify({ notification: input.notification });
  const outcomes = await Promise.all(
    targets.map(async (row) => {
      try {
        await sender({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload);
        await db
          .update(webPushSubscriptions)
          .set({ lastSuccessAt: new Date(), failureCount: 0 })
          .where(eq(webPushSubscriptions.id, row.id));
        return true;
      } catch (error) {
        try {
          if (expiredStatus(error)) {
            await db.delete(webPushSubscriptions).where(eq(webPushSubscriptions.id, row.id));
          } else {
            logger.warn({ err: error, subscriptionId: row.id }, "Web Push delivery failed");
            await db
              .update(webPushSubscriptions)
              .set({ failureCount: sql`${webPushSubscriptions.failureCount} + 1`, updatedAt: new Date() })
              .where(eq(webPushSubscriptions.id, row.id));
          }
        } catch (err) {
          logger.warn({ err, subscriptionId: row.id }, "Web Push subscription bookkeeping failed");
        }
        return false;
      }
    }),
  );
  const sent = outcomes.filter(Boolean).length;
  return { sent, failed: outcomes.length - sent };
}
