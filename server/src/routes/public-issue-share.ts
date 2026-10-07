import { Router, type Response } from "express";
import type { Db } from "@tickernelz/paperclip-pro-db";
import type { StorageService } from "../storage/types.js";
import { tooManyRequests } from "../errors.js";
import {
  createInviteRateLimiter,
  type InviteRateLimiter,
} from "../services/invite-rate-limit.js";
import { issueShareLinkService } from "../services/issue-share-links.js";
import {
  sendIssueDocumentPdf,
  serveAssetContent,
  serveAttachmentContent,
} from "./content-serving.js";

const SHARE_REQUESTS_PER_MINUTE = 300;

function notFound(res: Response) {
  res.setHeader("Cache-Control", "private, no-store");
  res.status(404).json({ error: "Not found" });
}

export function publicIssueShareRoutes(
  db: Db,
  storage: StorageService,
  opts: { notFoundLimiter?: InviteRateLimiter; requestLimiter?: InviteRateLimiter } = {},
) {
  const router = Router();
  const shares = issueShareLinkService(db);
  const notFoundLimiter = opts.notFoundLimiter ?? createInviteRateLimiter();
  const requestLimiter =
    opts.requestLimiter ?? createInviteRateLimiter({ maxRequests: SHARE_REQUESTS_PER_MINUTE });

  router.use("/public/share", (req, res, next) => {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "private, no-store");
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const token = req.path.split("/")[1] ?? "";
    const lookups = notFoundLimiter.peek(ip);
    const result = lookups.allowed ? requestLimiter.consume(`${token}:${ip}`) : lookups;
    res.setHeader("X-RateLimit-Limit", String(result.limit));
    res.setHeader("X-RateLimit-Remaining", String(result.remaining));
    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfterSeconds));
      next(
        tooManyRequests("Too many share link requests", {
          retryAfterSeconds: result.retryAfterSeconds,
        }),
      );
      return;
    }
    res.on("finish", () => {
      if (res.statusCode === 404) notFoundLimiter.consume(ip);
    });
    next();
  });

  router.get("/public/share/:token", async (req, res) => {
    const resolved = await shares.resolve(String(req.params.token));
    if (!resolved) return notFound(res);
    res.json(await shares.buildView(resolved, resolved.root));
  });

  router.get("/public/share/:token/issues/:issueId", async (req, res) => {
    const resolved = await shares.resolve(String(req.params.token));
    if (!resolved) return notFound(res);
    const target = (await shares.oneHopIssues(resolved)).get(String(req.params.issueId));
    if (!target) return notFound(res);
    res.json(await shares.buildView(resolved, target));
  });

  router.get(
    "/public/share/:token/attachments/:attachmentId/content",
    async (req, res, next) => {
      const resolved = await shares.resolve(String(req.params.token));
      if (!resolved) return notFound(res);
      const attachment = await shares.findVisibleAttachment(resolved, String(req.params.attachmentId));
      if (!attachment) return notFound(res);
      await serveAttachmentContent({
        storage,
        attachment,
        rangeHeader: typeof req.headers.range === "string" ? req.headers.range : undefined,
        download: req.query.download === "1" || req.query.download === "true",
        res,
        next,
      });
    },
  );

  router.get("/public/share/:token/assets/:assetId/content", async (req, res, next) => {
    const resolved = await shares.resolve(String(req.params.token));
    if (!resolved) return notFound(res);
    const asset = await shares.findVisibleAsset(resolved, String(req.params.assetId));
    if (!asset) return notFound(res);
    await serveAssetContent({
      storage,
      asset,
      rangeHeader: req.headers.range,
      parseRange: (size) => req.range(size),
      res,
      next,
    });
  });

  router.get("/public/share/:token/issues/:issueId/documents/:key/pdf", async (req, res) => {
    const resolved = await shares.resolve(String(req.params.token));
    if (!resolved) return notFound(res);
    const found = await shares.findVisibleDocument(
      resolved,
      String(req.params.issueId),
      String(req.params.key),
    );
    if (!found) return notFound(res);
    res.setHeader("Cache-Control", "private, max-age=60");
    await sendIssueDocumentPdf({ res, issue: found.issue, document: found.document });
  });

  return router;
}
