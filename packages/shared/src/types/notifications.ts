export const NOTIFICATION_KINDS = [
  "approval",
  "question",
  "comment",
  "assignment",
  "review",
  "run_failed",
  "join_request",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface PaperclipNotification {
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
  notification: PaperclipNotification;
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
