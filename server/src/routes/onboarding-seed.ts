import { Router } from "express";
import type { Db } from "@tickernelz/wardmote-db";
import { applyOnboardingSeedSchema } from "@tickernelz/wardmote-shared";
import { validate } from "../middleware/index.js";
import { onboardingSeedService } from "../services/onboarding-seed.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

export function onboardingSeedRoutes(db: Db) {
  const router = Router();
  const svc = onboardingSeedService(db);

  router.post(
    "/companies/:companyId/onboarding-seed",
    validate(applyOnboardingSeedSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      const result = await svc.apply(companyId, req.body, getActorInfo(req));

      res.status(200).json({
        companyId,
        revision: result.revision,
        applied: true,
        changed: result.changed,
        goalId: result.goalId,
        agentId: result.agentId,
        issueId: result.issueId,
      });
    },
  );

  return router;
}
