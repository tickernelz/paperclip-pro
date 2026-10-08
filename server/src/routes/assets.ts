import { readFile } from "node:fs/promises";
import { Router } from "express";
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import type { Db } from "@tickernelz/paperclip-pro-db";
import { ASSET_NAMESPACE_RULE, createAssetImageMetadataSchema } from "@tickernelz/paperclip-pro-shared";
import type { StorageService } from "../storage/types.js";
import { assetService, logActivity } from "../services/index.js";
import { isAllowedContentType, normalizeContentType } from "../attachment-types.js";
import { removeStagedUpload, stageSingleFileUpload, type StagedUploadFile } from "../attachment-upload.js";
import { assertCompanyAccess, getAccessibleResource, getActorInfo } from "./authz.js";
import { serveAssetContent } from "./content-serving.js";
const SVG_CONTENT_TYPE = "image/svg+xml";
const ALLOWED_COMPANY_LOGO_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  SVG_CONTENT_TYPE,
]);

function sanitizeSvgBuffer(input: Buffer): Buffer | null {
  const raw = input.toString("utf8").trim();
  if (!raw) return null;

  const baseDom = new JSDOM("");
  const domPurify = createDOMPurify(
    baseDom.window as unknown as Parameters<typeof createDOMPurify>[0],
  );
  domPurify.addHook("uponSanitizeAttribute", (_node, data) => {
    const attrName = data.attrName.toLowerCase();
    const attrValue = (data.attrValue ?? "").trim();

    if (attrName.startsWith("on")) {
      data.keepAttr = false;
      return;
    }

    if ((attrName === "href" || attrName === "xlink:href") && attrValue && !attrValue.startsWith("#")) {
      data.keepAttr = false;
    }
  });

  let parsedDom: JSDOM | null = null;
  try {
    const sanitized = domPurify.sanitize(raw, {
      USE_PROFILES: { svg: true, svgFilters: true, html: false },
      FORBID_TAGS: ["script", "foreignObject"],
      FORBID_CONTENTS: ["script", "foreignObject"],
      RETURN_TRUSTED_TYPE: false,
    });

    parsedDom = new JSDOM(sanitized, { contentType: SVG_CONTENT_TYPE });
    const document = parsedDom.window.document;
    const root = document.documentElement;
    if (!root || root.tagName.toLowerCase() !== "svg") return null;

    for (const el of Array.from(root.querySelectorAll("script, foreignObject"))) {
      el.remove();
    }
    for (const el of Array.from(root.querySelectorAll("*"))) {
      for (const attr of Array.from(el.attributes)) {
        const attrName = attr.name.toLowerCase();
        const attrValue = attr.value.trim();
        if (attrName.startsWith("on")) {
          el.removeAttribute(attr.name);
          continue;
        }
        if ((attrName === "href" || attrName === "xlink:href") && attrValue && !attrValue.startsWith("#")) {
          el.removeAttribute(attr.name);
        }
      }
    }

    const output = root.outerHTML.trim();
    if (!output || !/^<svg[\s>]/i.test(output)) return null;
    return Buffer.from(output, "utf8");
  } catch {
    return null;
  } finally {
    parsedDom?.window.close();
    baseDom.window.close();
  }
}

export function assetRoutes(db: Db, storage: StorageService) {
  const router = Router();
  const svc = assetService(db);
  async function stagedFileBody(file: StagedUploadFile, contentType: string) {
    if (contentType !== SVG_CONTENT_TYPE) {
      return { sourcePath: file.path, byteSize: file.size, sha256: file.sha256 } as const;
    }
    const sanitized = sanitizeSvgBuffer(await readFile(file.path));
    return sanitized && sanitized.length > 0 ? ({ body: sanitized } as const) : null;
  }

  router.post("/companies/:companyId/assets/images", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const file = await stageSingleFileUpload(req, res, {
      limitMessage: (limit) => `File is larger than the ${limit} limit`,
    });
    let stored: Awaited<ReturnType<typeof storage.putFile>>;
    try {
      if (!file) {
        res.status(400).json({ error: "Missing file field 'file'" });
        return;
      }

      const parsedMeta = createAssetImageMetadataSchema.safeParse(req.body ?? {});
      if (!parsedMeta.success) {
        res.status(400).json({
          error: `Invalid image metadata: ${ASSET_NAMESPACE_RULE}`,
          details: parsedMeta.error.issues,
        });
        return;
      }

      const namespaceSuffix = parsedMeta.data.namespace ?? "general";
      const contentType = normalizeContentType(file.mimetype);
      if (contentType !== SVG_CONTENT_TYPE && !isAllowedContentType(contentType)) {
        res.status(422).json({ error: `Unsupported file type: ${contentType}` });
        return;
      }
      if (file.size <= 0) {
        res.status(422).json({ error: "Image is empty" });
        return;
      }
      const fileBody = await stagedFileBody(file, contentType);
      if (!fileBody) {
        res.status(422).json({ error: "SVG could not be sanitized" });
        return;
      }

      stored = await storage.putFile({
        companyId,
        namespace: `assets/${namespaceSuffix}`,
        originalFilename: file.originalname || null,
        contentType,
        ...fileBody,
      });
    } finally {
      await removeStagedUpload(file);
    }

    const actor = getActorInfo(req);

    const asset = await svc.create(companyId, {
      provider: stored.provider,
      objectKey: stored.objectKey,
      contentType: stored.contentType,
      byteSize: stored.byteSize,
      sha256: stored.sha256,
      originalFilename: stored.originalFilename,
      createdByAgentId: actor.agentId,
      createdByUserId: actor.actorType === "user" ? actor.actorId : null,
    });

    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action: "asset.created",
      entityType: "asset",
      entityId: asset.id,
      details: {
        originalFilename: asset.originalFilename,
        contentType: asset.contentType,
        byteSize: asset.byteSize,
      },
    });

    res.status(201).json({
      assetId: asset.id,
      companyId: asset.companyId,
      provider: asset.provider,
      objectKey: asset.objectKey,
      contentType: asset.contentType,
      byteSize: asset.byteSize,
      sha256: asset.sha256,
      originalFilename: asset.originalFilename,
      createdByAgentId: asset.createdByAgentId,
      createdByUserId: asset.createdByUserId,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
      contentPath: `/api/assets/${asset.id}/content`,
    });
  });

  router.post("/companies/:companyId/logo", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const file = await stageSingleFileUpload(req, res, {
      limitMessage: (limit) => `File is larger than the ${limit} limit`,
    });
    let stored: Awaited<ReturnType<typeof storage.putFile>>;
    try {
      if (!file) {
        res.status(400).json({ error: "Missing file field 'file'" });
        return;
      }

      const contentType = (file.mimetype || "").toLowerCase();
      if (!ALLOWED_COMPANY_LOGO_CONTENT_TYPES.has(contentType)) {
        res.status(422).json({ error: `Unsupported image type: ${contentType || "unknown"}` });
        return;
      }
      if (file.size <= 0) {
        res.status(422).json({ error: "Image is empty" });
        return;
      }
      const fileBody = await stagedFileBody(file, contentType);
      if (!fileBody) {
        res.status(422).json({ error: "SVG could not be sanitized" });
        return;
      }

      stored = await storage.putFile({
        companyId,
        namespace: "assets/companies",
        originalFilename: file.originalname || null,
        contentType,
        ...fileBody,
      });
    } finally {
      await removeStagedUpload(file);
    }

    const actor = getActorInfo(req);

    const asset = await svc.create(companyId, {
      provider: stored.provider,
      objectKey: stored.objectKey,
      contentType: stored.contentType,
      byteSize: stored.byteSize,
      sha256: stored.sha256,
      originalFilename: stored.originalFilename,
      createdByAgentId: actor.agentId,
      createdByUserId: actor.actorType === "user" ? actor.actorId : null,
    });

    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action: "asset.created",
      entityType: "asset",
      entityId: asset.id,
      details: {
        originalFilename: asset.originalFilename,
        contentType: asset.contentType,
        byteSize: asset.byteSize,
        namespace: "assets/companies",
      },
    });

    res.status(201).json({
      assetId: asset.id,
      companyId: asset.companyId,
      provider: asset.provider,
      objectKey: asset.objectKey,
      contentType: asset.contentType,
      byteSize: asset.byteSize,
      sha256: asset.sha256,
      originalFilename: asset.originalFilename,
      createdByAgentId: asset.createdByAgentId,
      createdByUserId: asset.createdByUserId,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
      contentPath: `/api/assets/${asset.id}/content`,
    });
  });

  router.get("/assets/:assetId/content", async (req, res, next) => {
    const assetId = req.params.assetId as string;
    const asset = await getAccessibleResource(req, res, svc.getById(assetId), "Asset not found");
    if (!asset) return;
    await serveAssetContent({
      storage,
      asset,
      rangeHeader: req.headers.range,
      parseRange: (size) => req.range(size),
      res,
      next,
    });
  });

  return router;
}
