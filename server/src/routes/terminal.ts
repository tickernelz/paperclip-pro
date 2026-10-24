import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import type { Db } from "@tickernelz/paperclip-pro-db";
import {
  TERMINAL_MAX_UPLOAD_BYTES,
  TERMINAL_WEBSOCKET_PATH,
  type TerminalAttachToken,
  type TerminalSession,
  type TerminalSessionKind,
  type TerminalUploadResult,
} from "@tickernelz/paperclip-pro-shared";
import { resolveAttachmentUploadTempDir } from "../attachment-upload.js";
import { HttpError, badRequest, conflict, forbidden, notFound, payloadTooLarge, unprocessable } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { logActivity, type LogActivityInput } from "../services/activity-log.js";
import { terminalAccessDenial } from "../services/terminal/access.js";
import { localTerminalFiles, type TerminalFileAccess } from "../services/terminal/files.js";
import { terminalSessionManager, type TerminalSessionManager } from "../services/terminal/manager.js";
import { terminalOriginAllowed, type TerminalOriginPolicy } from "../services/terminal/origin.js";
import { spawnLocalTerminal, type TerminalProcess } from "../services/terminal/process.js";
import { createTerminalSessionSchema } from "../services/terminal/schema.js";
import { connectSshTerminal, type SshTerminalTarget } from "../services/terminal/ssh.js";
import { resolveLocalTerminalCwd, resolveSshTerminalTarget } from "../services/terminal/targets.js";
import { getActorInfo } from "./authz.js";

interface StartedTerminal {
  process: TerminalProcess;
  files: TerminalFileAccess;
}

export interface TerminalRouteOptions {
  originPolicy: TerminalOriginPolicy;
  manager?: TerminalSessionManager;
  resolveLocalCwd?: (companyId: string, issueId: string | null) => Promise<string>;
  resolveSshTarget?: (companyId: string, environmentId: string) => Promise<{ target: SshTerminalTarget; title: string }>;
  startLocal?: (input: { cwd: string; cols: number; rows: number }) => StartedTerminal | Promise<StartedTerminal>;
  startSsh?: (target: SshTerminalTarget, size: { cols: number; rows: number }) => Promise<StartedTerminal>;
  recordActivity?: (input: LogActivityInput) => Promise<unknown>;
  uploadTempDir?: string;
}

export function assertTerminalAccess(req: Request, companyId: string, kind: TerminalSessionKind) {
  const denial = terminalAccessDenial(req.actor, companyId, kind);
  if (denial) throw forbidden(denial);
}

function startFailure(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  const reason = err instanceof Error ? err.message : String(err);
  return unprocessable(`Terminal failed to start: ${reason}`, { code: "spawn_failed" });
}

function readUploadFile(req: Request, res: Response, tempDir: string): Promise<Express.Multer.File | null> {
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, callback) => {
        fs.mkdir(tempDir, { recursive: true }).then(
          () => callback(null, tempDir),
          (err: Error) => callback(err, tempDir),
        );
      },
      filename: (_req, _file, callback) => callback(null, `${randomUUID()}.terminal-upload`),
    }),
    preservePath: true,
    defParamCharset: "utf8",
    limits: { fileSize: TERMINAL_MAX_UPLOAD_BYTES, files: 1, fields: 0, parts: 2, fieldSize: 1024 },
  }).single("file");
  return new Promise((resolve, reject) => {
    upload(req, res, (err: unknown) => {
      if (!err) {
        resolve((req as Request & { file?: Express.Multer.File }).file ?? null);
        return;
      }
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          reject(payloadTooLarge(`Terminal uploads are limited to ${TERMINAL_MAX_UPLOAD_BYTES} bytes`, {
            maxBytes: TERMINAL_MAX_UPLOAD_BYTES,
          }));
          return;
        }
        reject(badRequest(err.message));
        return;
      }
      reject(err);
    });
  });
}

export function terminalRoutes(db: Db, options: TerminalRouteOptions) {
  const router = Router();
  const originPolicy = options.originPolicy;
  const manager = options.manager ?? terminalSessionManager;
  const resolveLocalCwd = options.resolveLocalCwd ?? ((companyId, issueId) => resolveLocalTerminalCwd(db, companyId, issueId));
  const resolveSshTarget =
    options.resolveSshTarget ?? ((companyId, environmentId) => resolveSshTerminalTarget(db, companyId, environmentId));
  const startLocal =
    options.startLocal ??
    ((input: { cwd: string; cols: number; rows: number }) => ({
      process: spawnLocalTerminal(input),
      files: localTerminalFiles(input.cwd),
    }));
  const startSsh = options.startSsh ?? connectSshTerminal;
  const recordActivity = options.recordActivity ?? ((input: LogActivityInput) => logActivity(db, input));
  const uploadTempDir = options.uploadTempDir ?? resolveAttachmentUploadTempDir();

  async function audit(
    req: Request,
    companyId: string,
    sessionId: string,
    action: string,
    details: Record<string, unknown>,
  ) {
    const actor = getActorInfo(req);
    await recordActivity({
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action,
      entityType: "terminal_session",
      entityId: sessionId,
      details,
    });
  }

  const gate = (req: Request, _res: Response, next: NextFunction) => {
    assertTerminalAccess(req, req.params.companyId as string, "ssh");
    next();
  };

  const sameOrigin = (req: Request, _res: Response, next: NextFunction) => {
    const allowed = terminalOriginAllowed(
      {
        origin: req.header("origin"),
        referer: req.header("referer"),
        host: req.header("host"),
        hostname: req.hostname,
      },
      originPolicy,
    );
    if (!allowed) throw forbidden("Terminal changes require a same-origin browser request");
    next();
  };

  function sessionForActor(req: Request, companyId: string, sessionId: string): TerminalSession {
    const session = manager.get(companyId, sessionId);
    if (!session) throw notFound("Terminal session not found");
    assertTerminalAccess(req, companyId, session.kind);
    return session;
  }

  router.post(
    "/companies/:companyId/terminal/sessions",
    gate,
    sameOrigin,
    validate(createTerminalSessionSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const body = req.body as {
        kind: TerminalSessionKind;
        issueId?: string;
        environmentId?: string;
        cols?: number;
        rows?: number;
        title?: string;
      };
      assertTerminalAccess(req, companyId, body.kind);
      const userId = req.actor.userId ?? null;
      const capacity = manager.capacityDenial(companyId, userId);
      if (capacity) throw conflict(capacity);
      const size = { cols: body.cols ?? 80, rows: body.rows ?? 24 };
      const issueId = body.issueId ?? null;
      let started: StartedTerminal;
      let cwd: string;
      let title: string;
      if (body.kind === "ssh") {
        const resolved = await resolveSshTarget(companyId, body.environmentId!);
        cwd = resolved.target.remoteCwd;
        title = body.title ?? resolved.title;
        started = await startSsh(resolved.target, size).catch((err: unknown) => {
          throw startFailure(err);
        });
      } else {
        cwd = await resolveLocalCwd(companyId, issueId);
        title = body.title ?? (path.basename(cwd) || cwd);
        try {
          started = await startLocal({ cwd, ...size });
        } catch (err) {
          throw startFailure(err);
        }
      }
      const session = manager.register({
        companyId,
        kind: body.kind,
        title,
        cwd,
        issueId,
        environmentId: body.kind === "ssh" ? body.environmentId! : null,
        cols: size.cols,
        rows: size.rows,
        createdByUserId: userId,
        process: started.process,
        files: started.files,
      });
      try {
        await audit(req, companyId, session.id, "terminal.session_created", {
          kind: session.kind,
          cwd: session.cwd,
          issueId: session.issueId,
          environmentId: session.environmentId,
        });
      } catch (err) {
        manager.kill(companyId, session.id);
        throw err;
      }
      res.status(201).json(session);
    },
  );

  router.get("/companies/:companyId/terminal/sessions", gate, async (req, res) => {
    const companyId = req.params.companyId as string;
    res.json(
      manager.list(companyId).filter((session) => terminalAccessDenial(req.actor, companyId, session.kind) === null),
    );
  });

  router.delete("/companies/:companyId/terminal/sessions/:sessionId", gate, sameOrigin, async (req, res) => {
    const companyId = req.params.companyId as string;
    sessionForActor(req, companyId, req.params.sessionId as string);
    const session = manager.kill(companyId, req.params.sessionId as string);
    if (!session) throw notFound("Terminal session not found");
    await audit(req, companyId, session.id, "terminal.session_deleted", {
      kind: session.kind,
      cwd: session.cwd,
      issueId: session.issueId,
      environmentId: session.environmentId,
    });
    res.status(204).end();
  });

  router.post("/companies/:companyId/terminal/sessions/:sessionId/token", gate, sameOrigin, async (req, res) => {
    const companyId = req.params.companyId as string;
    const sessionId = req.params.sessionId as string;
    sessionForActor(req, companyId, sessionId);
    const minted = manager.mintAttachToken(companyId, sessionId, {
      userId: req.actor.userId ?? null,
      actorSource: req.actor.source ?? "none",
      authSessionId: req.actor.source === "session" ? (req.actor.sessionId ?? null) : null,
    });
    if (!minted) throw notFound("Terminal session not found");
    const body: TerminalAttachToken = {
      sessionId,
      token: minted.token,
      expiresAt: minted.expiresAt.toISOString(),
      websocketPath: TERMINAL_WEBSOCKET_PATH,
    };
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json(body);
  });

  router.post("/companies/:companyId/terminal/sessions/:sessionId/upload", gate, sameOrigin, async (req, res) => {
    const companyId = req.params.companyId as string;
    const sessionId = req.params.sessionId as string;
    sessionForActor(req, companyId, sessionId);
    const file = await readUploadFile(req, res, uploadTempDir);
    try {
      if (!file) throw badRequest("Multipart field \"file\" is required");
      const files = manager.files(companyId, sessionId);
      if (!files) throw notFound("Terminal session not found");
      const saved = await files.saveUpload(file.originalname, file.path);
      await audit(req, companyId, sessionId, "terminal.file_uploaded", { path: saved.path, bytes: saved.bytes });
      const result: TerminalUploadResult = { path: saved.path, bytes: saved.bytes };
      res.status(201).json(result);
    } finally {
      if (file?.path) await fs.rm(file.path, { force: true });
    }
  });

  router.get("/companies/:companyId/terminal/sessions/:sessionId/download", gate, async (req, res) => {
    const companyId = req.params.companyId as string;
    const sessionId = req.params.sessionId as string;
    sessionForActor(req, companyId, sessionId);
    const files = manager.files(companyId, sessionId);
    if (!files) throw notFound("Terminal session not found");
    const download = await files.openDownload(req.query.path as string);
    try {
      await audit(req, companyId, sessionId, "terminal.file_downloaded", { path: download.path, bytes: download.size });
    } catch (err) {
      download.stream.destroy();
      throw err;
    }
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.attachment(path.posix.basename(download.path));
    try {
      await pipeline(download.stream, res);
    } catch (err) {
      if (!res.headersSent) throw err;
      res.destroy(err instanceof Error ? err : undefined);
    }
  });

  return router;
}
