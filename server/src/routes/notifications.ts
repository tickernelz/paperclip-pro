import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { Db } from "@tickernelz/paperclip-pro-db";
import {
  deleteWebPushSubscriptionSchema,
  upsertWebPushSubscriptionSchema,
  type PaperclipNotification,
} from "@tickernelz/paperclip-pro-shared";
import { validate } from "../middleware/validate.js";
import {
  deleteWebPushSubscription,
  deliverWebPush,
  upsertWebPushSubscription,
} from "../services/notifications/subscriptions.js";
import type { WebPushRuntime } from "../services/notifications/web-push.js";
import { assertBoard } from "./authz.js";

const USER_AGENT_MAX_CHARS = 512;

function requireBoardUserId(req: Request, res: Response): string | null {
  assertBoard(req);
  if (!req.actor.userId) {
    res.status(403).json({ error: "Board user context required" });
    return null;
  }
  return req.actor.userId;
}

export function notificationRoutes(db: Db, webPush: WebPushRuntime) {
  const router = Router();

  router.get("/notifications/web-push/config", (req, res) => {
    if (!requireBoardUserId(req, res)) return;
    res.json(webPush.config());
  });

  router.put("/notifications/web-push/subscription", validate(upsertWebPushSubscriptionSchema), async (req, res) => {
    const userId = requireBoardUserId(req, res);
    if (!userId) return;
    const userAgent = req.get("user-agent")?.slice(0, USER_AGENT_MAX_CHARS) ?? null;
    res.json(await upsertWebPushSubscription(db, userId, req.body, userAgent));
  });

  router.delete("/notifications/web-push/subscription", validate(deleteWebPushSubscriptionSchema), async (req, res) => {
    const userId = requireBoardUserId(req, res);
    if (!userId) return;
    await deleteWebPushSubscription(db, userId, req.body.endpoint);
    res.status(204).end();
  });

  router.post("/notifications/web-push/test", async (req, res) => {
    const userId = requireBoardUserId(req, res);
    if (!userId) return;
    const sender = webPush.sender();
    if (!sender) {
      res.status(503).json({ error: "Web Push is not available on this instance" });
      return;
    }
    const notification: PaperclipNotification = {
      key: `test:${randomUUID()}`,
      kind: "comment",
      companyId: req.actor.companyIds?.[0] ?? "",
      title: "Paperclip test notification",
      body: "Push notifications are working on this device.",
      url: "/",
      issueId: null,
      createdAt: new Date().toISOString(),
    };
    res.json(await deliverWebPush(db, sender, { userIds: [userId], notification, kind: null }));
  });

  return router;
}
