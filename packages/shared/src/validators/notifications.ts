import { z } from "zod";
import { NOTIFICATION_KINDS } from "../types/notifications.js";

export const notificationKindSchema = z.enum(NOTIFICATION_KINDS);

export const upsertWebPushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(128),
  }).strict(),
  kinds: z.array(notificationKindSchema).max(NOTIFICATION_KINDS.length),
}).strict();

export type UpsertWebPushSubscription = z.infer<typeof upsertWebPushSubscriptionSchema>;

export const deleteWebPushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
}).strict();

export type DeleteWebPushSubscription = z.infer<typeof deleteWebPushSubscriptionSchema>;
