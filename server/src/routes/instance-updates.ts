import { Router, type Request } from "express";
import { z } from "zod";
import { forbidden, notFound } from "../errors.js";
import { validate } from "../middleware/validate.js";
import type { WardmoteUpdateService } from "../services/wardmote-updates.js";
import type { UpdateInstaller } from "../services/wardmote-update-install.js";
import { assertInstanceAdmin, getActorInfo } from "./authz.js";

export const startUpdateInstallSchema = z.object({
  version: z.string().min(1).max(64),
  mode: z.enum(["force", "wait"]),
}).strict();

export function assertBoardSession(req: Request) {
  if (req.actor.type === "board" && (req.actor.source === "session" || req.actor.source === "local_implicit")) return;
  throw forbidden("A signed-in board session is required");
}

export function instanceUpdateRoutes(service: WardmoteUpdateService, installer?: UpdateInstaller) {
  const router = Router();

  router.get("/instance/updates", async (req, res) => {
    assertInstanceAdmin(req);
    assertBoardSession(req);
    res.json(service.status());
  });

  router.get("/instance/updates/install", async (req, res) => {
    assertInstanceAdmin(req);
    assertBoardSession(req);
    res.json({ job: installer?.current() ?? null });
  });

  router.post("/instance/updates/install", validate(startUpdateInstallSchema), async (req, res) => {
    assertInstanceAdmin(req);
    assertBoardSession(req);
    if (!installer) throw notFound("Updating from the web UI is not available on this server");
    const actor = getActorInfo(req);
    const job = await installer.start({
      version: req.body.version,
      mode: req.body.mode,
      trigger: "manual",
      requestedBy: { actorType: actor.actorType, actorId: actor.actorId },
    });
    res.status(202).json({ job });
  });

  router.post("/instance/updates/install/force", async (req, res) => {
    assertInstanceAdmin(req);
    assertBoardSession(req);
    if (!installer) throw notFound("Updating from the web UI is not available on this server");
    res.json({ job: await installer.forceWaiting() });
  });

  router.delete("/instance/updates/install", async (req, res) => {
    assertInstanceAdmin(req);
    assertBoardSession(req);
    if (!installer) throw notFound("Updating from the web UI is not available on this server");
    res.json({ job: await installer.cancelWaiting() });
  });

  return router;
}
