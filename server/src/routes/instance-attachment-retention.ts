import { Router } from "express";
import { z } from "zod";
import { attachmentRetentionSettingsSchema, type AttachmentRetentionReport, type AttachmentRetentionSettings, type AttachmentRetentionStatus } from "@tickernelz/paperclip-pro-shared";
import { assertInstanceAdmin, getActorInfo } from "./authz.js";

/** Optional unsaved settings to preview instead of the saved policy. */
export const attachmentRetentionPreviewSchema = z
  .object({ settings: attachmentRetentionSettingsSchema.optional() })
  .strict();

export type AttachmentRetentionRouteService = {
  status(): Promise<AttachmentRetentionStatus>;
  preview(settings?: AttachmentRetentionSettings): Promise<AttachmentRetentionReport>;
  run(input: {
    trigger: "manual";
    actor: { actorType: "user" | "agent" | "system"; actorId: string };
  }): Promise<AttachmentRetentionReport>;
};

export function instanceAttachmentRetentionRoutes(service: AttachmentRetentionRouteService) {
  const router = Router();

  router.get("/instance/attachment-retention", async (req, res) => {
    assertInstanceAdmin(req);
    res.json(await service.status());
  });

  router.post("/instance/attachment-retention/preview", async (req, res) => {
    assertInstanceAdmin(req);
    const body = attachmentRetentionPreviewSchema.parse(req.body ?? {});
    res.json(await service.preview(body.settings));
  });

  router.post("/instance/attachment-retention/run", async (req, res) => {
    assertInstanceAdmin(req);
    const actor = getActorInfo(req);
    res.json(await service.run({ trigger: "manual", actor: { actorType: actor.actorType, actorId: actor.actorId } }));
  });

  return router;
}
