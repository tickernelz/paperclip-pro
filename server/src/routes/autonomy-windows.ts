import { Router } from "express";
import type { Db } from "@tickernelz/paperclip-pro-db";
import { openIssueAutonomyWindowSchema } from "@tickernelz/paperclip-pro-shared";
import { validate } from "../middleware/validate.js";
import { autonomyWindowService } from "../services/autonomy-windows.js";
import { notFound } from "../errors.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";

export function autonomyWindowRoutes(db: Db) {
  const router = Router();
  const svc = autonomyWindowService(db);

  router.get("/companies/:companyId/autonomy-windows", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json({ windows: await svc.listLive(companyId) });
  });

  router.post(
    "/companies/:companyId/autonomy-windows",
    validate(openIssueAutonomyWindowSchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const windows = await svc.open(companyId, req.body, {
        userId: actor.actorId,
        grantedVia: "paperclip",
      });
      res.status(201).json({ windows });
    },
  );

  router.delete("/autonomy-windows/:id", async (req, res) => {
    assertBoard(req);
    const existing = await svc.getById(req.params.id as string);
    if (!existing) throw notFound("Autonomy window not found");
    assertCompanyAccess(req, existing.companyId);
    const actor = getActorInfo(req);
    const window = await svc.close(existing.id, { userId: actor.actorId, grantedVia: "paperclip" }, existing.companyId);
    res.json(window);
  });

  return router;
}
