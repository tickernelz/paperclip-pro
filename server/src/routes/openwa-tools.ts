import { Router } from "express";
import type { Db } from "@tickernelz/paperclip-pro-db";
import { isUuidLike, openwaToolCallSchema } from "@tickernelz/paperclip-pro-shared";
import { badRequest, forbidden } from "../errors.js";
import { executeConnectorTool } from "../services/connector-runtime.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { assertCompanyAccess } from "./authz.js";

export function openwaToolRoutes(db: Db) {
  const router = Router();
  router.use("/companies/:companyId/openwa", async (_req, _res, next) => {
    if (!(await instanceSettingsService(db).getExperimental()).enableChatConnectors) throw forbidden("Chat connectors are disabled");
    next();
  });
  router.param("companyId", (_req, _res, next, id) => {
    if (!isUuidLike(id)) throw badRequest("Invalid company");
    next();
  });
  router.param("issueId", (_req, _res, next, id) => {
    if (!isUuidLike(id)) throw badRequest("Invalid task binding");
    next();
  });
  router.post("/companies/:companyId/openwa/tasks/:issueId/tools", async (req, res) => {
    const companyId = String(req.params.companyId);
    const issueId = String(req.params.issueId);
    assertCompanyAccess(req, companyId);
    if (req.actor.type !== "agent" || !req.actor.agentId || !req.actor.runId)
      throw forbidden("OpenWA tools require an authenticated agent run");
    const call = openwaToolCallSchema.parse(req.body);
    if (!call.tool.startsWith("openwa_")) throw forbidden("Expected an OpenWA tool");
    res.set("Cache-Control", "no-store").json(
      await executeConnectorTool(
        db,
        { companyId, issueId, runId: req.actor.runId, agentId: req.actor.agentId },
        call.tool,
        call.arguments,
      ),
    );
  });
  return router;
}
