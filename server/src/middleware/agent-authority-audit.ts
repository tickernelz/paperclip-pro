import type { RequestHandler } from "express";
import type { Db } from "@tickernelz/paperclip-pro-db";
import { logActivity } from "../services/activity-log.js";
import { logger } from "./logger.js";

const SAFE_METHODS: Record<string, true> = { GET: true, HEAD: true, OPTIONS: true };

export function agentAuthorityAudit(db: Db): RequestHandler {
  return (req, res, next) => {
    res.on("finish", () => {
      const explicit = req.agentAuthority;
      const decided = req.actor.type === "agent" && req.actor.agentId
        ? req.actor.exercisedAgentAuthority
        : null;
      const authority = explicit ?? (decided
        ? {
          capability: decided.capability,
          reason: decided.reason,
          companyId: decided.companyId,
          agentId: req.actor.agentId as string,
          runId: req.actor.runId ?? null,
        }
        : null);
      if (!authority) return;
      if (SAFE_METHODS[req.method.toUpperCase()]) return;
      if (res.statusCode >= 400) return;
      void logActivity(db, {
        companyId: authority.companyId,
        actorType: "agent",
        actorId: authority.agentId,
        agentId: authority.agentId,
        runId: authority.runId,
        agentApiKeyId: req.actor.keyId ?? null,
        action: "agent.authority_exercised",
        entityType: "agent_authority",
        entityId: authority.agentId,
        details: {
          authorityReason: authority.reason,
          capability: authority.capability,
          agentRole: req.actor.agentRole ?? null,
          method: req.method.toUpperCase(),
          path: req.originalUrl.split("?")[0],
          statusCode: res.statusCode,
        },
      }).catch((err) => {
        logger.warn(
          { err, agentId: authority.agentId, capability: authority.capability },
          "Failed to audit agent authority use",
        );
      });
    });
    next();
  };
}
