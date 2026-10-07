import type {
  DeleteWebPushSubscription,
  UpsertWebPushSubscription,
  WebPushConfig,
  WebPushSubscriptionRecord,
} from "@tickernelz/paperclip-pro-shared";
import { api } from "./client";

export interface WebPushTestResult {
  sent: number;
  failed: number;
}

export const notificationsApi = {
  getWebPushConfig: () => api.get<WebPushConfig>("/notifications/web-push/config"),
  upsertWebPushSubscription: (data: UpsertWebPushSubscription) =>
    api.put<WebPushSubscriptionRecord>("/notifications/web-push/subscription", data),
  deleteWebPushSubscription: (data: DeleteWebPushSubscription) =>
    api.deleteWithBody<void>("/notifications/web-push/subscription", data),
  sendWebPushTest: () => api.post<WebPushTestResult>("/notifications/web-push/test", {}),
};
