import { Router } from "express";
import type { Db } from "@tickernelz/paperclip-pro-db";
import { pixelsOfficeSeatAssignmentsSchema } from "@tickernelz/paperclip-pro-shared";
import { forbidden, notFound } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { instanceSettingsService, logActivity, pixelsOfficeService } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

export function pixelsOfficeRoutes(db: Db) {
  const router = Router();
  const settings = instanceSettingsService(db);
  const service = pixelsOfficeService(db);

  async function assertPixelsOfficeEnabled() {
    const experimental = await settings.getExperimental();
    if (experimental.enablePixelsOffice !== true) throw notFound("Pixels Office is not enabled");
  }

  function assertBoardActor(req: Parameters<typeof assertCompanyAccess>[0]) {
    if (req.actor.type !== "board") throw forbidden("Board access required");
  }

  router.get("/companies/:companyId/pixels-office", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    await assertPixelsOfficeEnabled();
    res.json(await service.snapshot(companyId));
  });

  router.put(
    "/companies/:companyId/pixels-office/seats",
    validate(pixelsOfficeSeatAssignmentsSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      await assertPixelsOfficeEnabled();
      assertBoardActor(req);
      const actor = getActorInfo(req);
      const assignments = await service.replaceSeatAssignments(companyId, req.body.assignments);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: "pixels_office.seats_updated",
        entityType: "pixels_office_seat",
        entityId: companyId,
        agentId: actor.agentId,
        runId: actor.runId,
        details: { count: assignments.length },
      });
      res.json({ assignments });
    },
  );

  return router;
}
