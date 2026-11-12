import { Router, type Request } from "express";
import { forbidden } from "../errors.js";
import type { WardmoteUpdateService } from "../services/wardmote-updates.js";
import { assertInstanceAdmin } from "./authz.js";

export function assertBoardSession(req: Request) {
  if (req.actor.type === "board" && (req.actor.source === "session" || req.actor.source === "local_implicit")) return;
  throw forbidden("A signed-in board session is required");
}

export function instanceUpdateRoutes(service: WardmoteUpdateService) {
  const router = Router();

  router.get("/instance/updates", async (req, res) => {
    assertInstanceAdmin(req);
    assertBoardSession(req);
    res.json(service.status());
  });

  return router;
}
