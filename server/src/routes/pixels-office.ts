import { Router, type Request, type Response } from "express";
import type { Db } from "@tickernelz/paperclip-pro-db";
import {
  pixelsOfficeSeatAssignmentsSchema,
  pixelsOfficeTimelineQuerySchema,
} from "@tickernelz/paperclip-pro-shared";
import { notFound } from "../errors.js";
import { validate } from "../middleware/validate.js";
import {
  accessService,
  instanceSettingsService,
  logActivity,
  pixelsOfficeService,
} from "../services/index.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";

export function pixelsOfficeRoutes(db: Db) {
  const router = Router();
  const settings = instanceSettingsService(db);
  const service = pixelsOfficeService(db);
  const access = accessService(db);

  async function assertPixelsOfficeEnabled() {
    const experimental = await settings.getExperimental();
    if (experimental.enablePixelsOffice !== true) throw notFound("Pixels Office is not enabled");
  }

  async function assertCompanyScopeReadAllowed(req: Request, res: Response, companyId: string) {
    const decision = await access.decide({
      actor: req.actor,
      action: "company_scope:read",
      resource: { type: "company", companyId },
    });
    if (decision.allowed) return true;
    res.status(403).json({ error: "The office is outside this actor's authorization boundary" });
    return false;
  }

  router.get("/companies/:companyId/pixels-office", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    if (!(await assertCompanyScopeReadAllowed(req, res, companyId))) return;
    await assertPixelsOfficeEnabled();
    res.json(await service.snapshot(companyId));
  });

  router.get("/companies/:companyId/pixels-office/timeline", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    if (!(await assertCompanyScopeReadAllowed(req, res, companyId))) return;
    await assertPixelsOfficeEnabled();
    const query = pixelsOfficeTimelineQuerySchema.parse(req.query);
    res.json(await service.timeline(companyId, query));
  });

  router.put(
    "/companies/:companyId/pixels-office/seats",
    validate(pixelsOfficeSeatAssignmentsSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertBoard(req);
      assertCompanyAccess(req, companyId);
      await assertPixelsOfficeEnabled();
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
