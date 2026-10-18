import { Router, type Request } from "express";
import type { Db } from "@tickernelz/paperclip-pro-db";
import type { AttentionSortMode } from "@tickernelz/paperclip-pro-shared";
import { attentionService } from "../services/attention.js";
import { canReadDesk, listDeskDecisions, resolveDeskReader } from "../services/decision-desk.js";
import { listPendingDecisions } from "../services/owner-decision-relay.js";
import { badRequest } from "../errors.js";
import { assertBoard, assertBoardOrAgent, assertCompanyAccess } from "./authz.js";

function optionalQueryString(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) throw badRequest(`${field} must be a non-empty string`);
  return value.trim();
}

function parseAttentionQuery(query: Request["query"]) {
  const sortValue = optionalQueryString(query.sort, "sort");
  if (sortValue !== undefined && sortValue !== "activity" && sortValue !== "decide") {
    throw badRequest("sort must be 'activity' or 'decide'");
  }
  const limitValue = optionalQueryString(query.limit, "limit");
  const limit = limitValue === undefined ? undefined : Number(limitValue);
  if (limit !== undefined && !Number.isInteger(limit)) throw badRequest("limit must be an integer");
  return {
    includeDismissed: query.includeDismissed === "true",
    archived: query.archived === "true",
    all: query.all === "true",
    activitySince: optionalQueryString(query.activitySince, "activitySince"),
    activityUntil: optionalQueryString(query.activityUntil, "activityUntil"),
    queue: optionalQueryString(query.queue, "queue"),
    cursor: optionalQueryString(query.cursor, "cursor"),
    sort: sortValue as AttentionSortMode | undefined,
    limit,
  };
}

const RELAY_LIST_NOTE =
  "Partial list: only cards and approvals an owner's answer can be relayed for. It leaves out recovery, review, blocked-dependency, failed-run, budget, agent-error and join-request items, so an empty list does not mean the Decisions desk is empty. Read the whole desk with scope=desk.";

export function attentionRoutes(db: Db) {
  const router = Router();
  const svc = attentionService(db);

  router.get("/companies/:companyId/attention", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    if (!req.actor.userId) {
      res.status(403).json({ error: "Board user context required" });
      return;
    }

    const query = parseAttentionQuery(req.query);
    const feed = await svc.list(companyId, {
      ...query,
      userId: req.actor.userId,
      actor: req.actor,
      allowUnscopedAll: query.all,
    });
    res.json(feed);
  });

  router.get("/companies/:companyId/pending-decisions", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoardOrAgent(req);
    const scope = optionalQueryString(req.query.scope, "scope") ?? "relay";
    if (scope !== "relay" && scope !== "desk") throw badRequest("scope must be 'relay' or 'desk'");
    if (scope === "desk") {
      const userId = await resolveDeskReader(db, { companyId, actor: req.actor });
      const { includeDismissed, queue, sort, cursor, limit } = parseAttentionQuery(req.query);
      res.set("Cache-Control", "no-store").json(
        await listDeskDecisions(db, { companyId, actor: req.actor, userId, query: { includeDismissed, queue, sort, cursor, limit } }),
      );
      return;
    }
    const userId = req.actor.type === "board" ? (req.actor.userId ?? null) : (req.actor.onBehalfOfUserId ?? null);
    const [{ items, omittedCount }, deskReadable] = await Promise.all([
      listPendingDecisions(db, { companyId, actor: req.actor, userId }),
      canReadDesk(db, { companyId, actor: req.actor }),
    ]);
    res.set("Cache-Control", "no-store").json({
      companyId,
      scope: "relay",
      partial: true,
      omittedCount: deskReadable ? omittedCount : null,
      note: RELAY_LIST_NOTE,
      items,
    });
  });

  return router;
}
