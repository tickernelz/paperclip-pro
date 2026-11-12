export const NOTIFICATION_KINDS = [
  "approval",
  "question",
  "comment",
  "assignment",
  "review",
  "run_failed",
  "join_request",
  "disk_space",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface WardmoteNotification {
  key: string;
  kind: NotificationKind;
  companyId: string;
  title: string;
  body: string;
  url: string;
  issueId: string | null;
  createdAt: string;
}

export interface NotificationCreatedLivePayload {
  notification: WardmoteNotification;
  recipientUserIds: string[];
}

export interface WebPushConfig {
  enabled: boolean;
  publicKey: string | null;
}

export interface WebPushSubscriptionRecord {
  id: string;
  endpoint: string;
  kinds: NotificationKind[];
  createdAt: string;
  lastSuccessAt: string | null;
}
