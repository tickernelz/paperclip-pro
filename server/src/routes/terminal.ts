import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import type { Db } from "@tickernelz/wardmote-db";
import {
  TERMINAL_MAX_UPLOAD_BYTES,
  TERMINAL_WEBSOCKET_PATH,
  type CreateSshKeyRequest,
  type CreateTerminalSshHostRequest,
  type SshConfigHostSettings,
  type SshConnectionTarget,
  type TrustSshHostKeyRequest,
  type TerminalAttachToken,
  type TerminalSession,
  type TerminalSessionKind,
  type TerminalSshHost,
  type TerminalUploadResult,
} from "@tickernelz/wardmote-shared";
import { resolveAttachmentUploadTempDir } from "../attachment-upload.js";
import { HttpError, badRequest, conflict, forbidden, notFound, payloadTooLarge, unprocessable } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { logActivity, type LogActivityInput } from "../services/activity-log.js";
import { terminalAccessDenial } from "../services/terminal/access.js";
import { localTerminalFiles, pastedImageFileName, type TerminalFileAccess } from "../services/terminal/files.js";
import { terminalSessionManager, type TerminalSessionManager } from "../services/terminal/manager.js";
import {
  TERMINAL_ORIGIN_UNTRUSTED,
  terminalOriginAllowed,
  terminalOriginRemediation,
  type TerminalOriginPolicy,
} from "../services/terminal/origin.js";
import { spawnLocalTerminal, type TerminalProcess } from "../services/terminal/process.js";
import {
  SSH_ALIAS_PATTERN,
  createSshKeySchema,
  createTerminalSessionSchema,
  createTerminalSshHostSchema,
  sshConfigHostInputSchema,
  sshConnectionTargetSchema,
  trustSshHostKeySchema,
} from "../services/terminal/schema.js";
import { SshConfigWriteError, sshConfigWriter, type SshConfigWriter } from "../services/terminal/ssh-config-writer.js";
import { SshKeyError, generateSshKey, importSshKey, listSshKeys } from "../services/terminal/ssh-keys.js";
import { testSshConnection, trustSshHostKeys, type SshRunner } from "../services/terminal/ssh-probe.js";
import { connectSshTerminal, type SshTerminalTarget } from "../services/terminal/ssh.js";
import {
  SSH_CONFIG_HOST_ID_PREFIX,
  databaseSshHostStore,
  parseSavedSshHostId,
  type TerminalSshHostStore,
} from "../services/terminal/ssh-hosts.js";
import { startSystemSshTerminal } from "../services/terminal/system-ssh.js";
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
  startHostSsh?: (input: { host: TerminalSshHost; cols: number; rows: number }) => StartedTerminal | Promise<StartedTerminal>;
  sshHosts?: TerminalSshHostStore;
  sshConfigPath?: string;
  sshConfigWriter?: SshConfigWriter;
  sshRunner?: SshRunner;
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

function sshFailure(err: unknown): unknown {
  if (err instanceof SshConfigWriteError) {
    if (err.code === "not_found") return notFound(err.message, { code: err.code });
    if (err.code === "invalid") return unprocessable(err.message, { code: err.code });
    return conflict(err.message, { code: err.code });
  }
  if (err instanceof SshKeyError) {
    if (err.code === "exists") return conflict(err.message, { code: "key_exists" });
    return unprocessable(err.message, { code: err.code === "invalid" ? "key_invalid" : "keygen_failed" });
  }
  return err;
}

function auditedHost(settings: SshConfigHostSettings): Record<string, unknown> {
  return {
    alias: settings.alias,
    hostName: settings.hostName,
    user: settings.user,
    port: settings.port,
    identityFile: settings.identityFile,
    proxyJump: settings.proxyJump,
  };
}

function targetAlias(target: SshConnectionTarget): string {
  return "alias" in target ? target.alias : target.host.alias;
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
  const startHostSsh = options.startHostSsh ?? startSystemSshTerminal;
  const sshHosts = options.sshHosts ?? databaseSshHostStore(db, { configPath: options.sshConfigPath });
  const configWriter = options.sshConfigWriter ?? sshConfigWriter({ configPath: options.sshConfigPath });
  const probeOptions = () => ({ run: options.sshRunner, knownHostsPath: path.join(configWriter.sshDir, "known_hosts") });

  async function savedHostNames(companyId: string, exceptId?: string): Promise<string[]> {
    const list = await sshHosts.list(companyId);
    return list.hosts.filter((host) => host.source === "saved" && host.id !== exceptId).map((host) => host.name);
  }

  function aliasParam(req: Request): string {
    const alias = req.params.alias as string;
    if (!SSH_ALIAS_PATTERN.test(alias)) throw notFound("SSH host not found");
    return alias;
  }
  const recordActivity = options.recordActivity ?? ((input: LogActivityInput) => logActivity(db, input));
  const uploadTempDir = options.uploadTempDir ?? resolveAttachmentUploadTempDir();

  async function audit(
    req: Request,
    companyId: string,
    entityId: string,
    action: string,
    details: Record<string, unknown>,
    entityType = "terminal_session",
  ) {
    const actor = getActorInfo(req);
    await recordActivity({
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action,
      entityType,
      entityId,
      details,
    });
  }

  const gate = (req: Request, _res: Response, next: NextFunction) => {
    assertTerminalAccess(req, req.params.companyId as string, "ssh");
    next();
  };

  const requireLocalAccess = (req: Request, companyId: string) => assertTerminalAccess(req, companyId, "local");

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
    if (!allowed) {
      throw forbidden("This browser address is not trusted for terminal access.", {
        code: TERMINAL_ORIGIN_UNTRUSTED,
        remediation: terminalOriginRemediation(originPolicy),
      });
    }
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
        sshHostId?: string;
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
      let cwd: string | null;
      let title: string;
      let sshHost: string | null = null;
      if (body.sshHostId) {
        const host = await sshHosts.resolve(companyId, body.sshHostId);
        if (!host) throw notFound("SSH host not found");
        cwd = null;
        title = body.title ?? host.name;
        sshHost = host.name;
        try {
          started = await startHostSsh({ host, ...size });
        } catch (err) {
          throw startFailure(err);
        }
      } else if (body.kind === "ssh") {
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
        sshHost,
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
          sshHost: session.sshHost,
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

  router.get("/companies/:companyId/terminal/ssh-hosts", gate, async (req, res) => {
    const companyId = req.params.companyId as string;
    requireLocalAccess(req, companyId);
    res.setHeader("Cache-Control", "no-store");
    const [list, managed] = await Promise.all([sshHosts.list(companyId), configWriter.readManaged().catch(() => [])]);
    const blocks = new Map(managed.map((block) => [block.alias, block]));
    res.json({
      ...list,
      hosts: list.hosts.map((host) => {
        if (host.source !== "config") return host;
        const block = blocks.get(host.name);
        return { ...host, managed: Boolean(block), settings: block?.settings ?? null };
      }),
    });
  });

  router.post(
    "/companies/:companyId/terminal/ssh-config/hosts",
    gate,
    sameOrigin,
    validate(sshConfigHostInputSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      requireLocalAccess(req, companyId);
      const settings = await configWriter
        .add(req.body as SshConfigHostSettings, { reservedAliases: await savedHostNames(companyId) })
        .catch((err: unknown) => {
          throw sshFailure(err);
        });
      await audit(req, companyId, settings.alias, "terminal.ssh_config_host_added", auditedHost(settings), "terminal_ssh_config_host");
      res.status(201).json(settings);
    },
  );

  router.put(
    "/companies/:companyId/terminal/ssh-config/hosts/:alias",
    gate,
    sameOrigin,
    validate(sshConfigHostInputSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      requireLocalAccess(req, companyId);
      const alias = aliasParam(req);
      const settings = await configWriter
        .update(alias, req.body as SshConfigHostSettings, { reservedAliases: await savedHostNames(companyId) })
        .catch((err: unknown) => {
          throw sshFailure(err);
        });
      await audit(
        req,
        companyId,
        settings.alias,
        "terminal.ssh_config_host_updated",
        { ...auditedHost(settings), previousAlias: alias },
        "terminal_ssh_config_host",
      );
      res.json(settings);
    },
  );

  router.delete("/companies/:companyId/terminal/ssh-config/hosts/:alias", gate, sameOrigin, async (req, res) => {
    const companyId = req.params.companyId as string;
    requireLocalAccess(req, companyId);
    const alias = aliasParam(req);
    const removed = await configWriter.remove(alias).catch((err: unknown) => {
      throw sshFailure(err);
    });
    await audit(req, companyId, alias, "terminal.ssh_config_host_removed", auditedHost(removed), "terminal_ssh_config_host");
    res.status(204).end();
  });

  router.post(
    "/companies/:companyId/terminal/ssh-config/test",
    gate,
    sameOrigin,
    validate(sshConnectionTargetSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      requireLocalAccess(req, companyId);
      try {
        res.json(await testSshConnection(req.body as SshConnectionTarget, probeOptions()));
      } catch (err) {
        throw startFailure(err);
      }
    },
  );

  router.post(
    "/companies/:companyId/terminal/ssh-config/trust-host-key",
    gate,
    sameOrigin,
    validate(trustSshHostKeySchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      requireLocalAccess(req, companyId);
      const body = req.body as TrustSshHostKeyRequest;
      const result = await trustSshHostKeys(body.target, body.fingerprints, probeOptions()).catch((err: unknown) => {
        throw sshFailure(err);
      });
      if (result.added.length > 0) {
        await audit(
          req,
          companyId,
          targetAlias(body.target),
          "terminal.ssh_host_key_trusted",
          { alias: targetAlias(body.target), fingerprints: result.added.map((key) => key.fingerprint) },
          "terminal_ssh_config_host",
        );
      }
      res.json(result);
    },
  );

  router.get("/companies/:companyId/terminal/ssh-keys", gate, async (req, res) => {
    const companyId = req.params.companyId as string;
    requireLocalAccess(req, companyId);
    res.setHeader("Cache-Control", "no-store");
    res.json(await listSshKeys(configWriter.sshDir));
  });

  router.post("/companies/:companyId/terminal/ssh-keys", gate, sameOrigin, validate(createSshKeySchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    requireLocalAccess(req, companyId);
    const body = req.body as CreateSshKeyRequest;
    const created = await (body.mode === "generate"
      ? generateSshKey(configWriter.sshDir, body.name, body.comment || `${body.name}@wardmote`)
      : importSshKey(configWriter.sshDir, body.name, body.privateKey)
    ).catch((err: unknown) => {
      throw sshFailure(err);
    });
    await audit(
      req,
      companyId,
      created.name,
      "terminal.ssh_key_created",
      { name: created.name, mode: body.mode, type: created.type, fingerprint: created.fingerprint, encrypted: created.encrypted },
      "terminal_ssh_key",
    );
    res.status(201).json(created);
  });

  router.post(
    "/companies/:companyId/terminal/ssh-hosts/:hostId/move-to-config",
    gate,
    sameOrigin,
    validate(sshConfigHostInputSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const hostId = req.params.hostId as string;
      requireLocalAccess(req, companyId);
      if (!parseSavedSshHostId(hostId)) throw notFound("Saved SSH host not found");
      const saved = await sshHosts.resolve(companyId, hostId);
      if (!saved) throw notFound("Saved SSH host not found");
      const settings = await configWriter
        .add(req.body as SshConfigHostSettings, { reservedAliases: await savedHostNames(companyId, hostId) })
        .catch((err: unknown) => {
          throw sshFailure(err);
        });
      await sshHosts.remove(companyId, hostId);
      await audit(
        req,
        companyId,
        settings.alias,
        "terminal.ssh_host_moved_to_config",
        { ...auditedHost(settings), savedHostId: hostId, savedName: saved.name },
        "terminal_ssh_config_host",
      );
      res.status(201).json(settings);
    },
  );

  router.post(
    "/companies/:companyId/terminal/ssh-hosts",
    gate,
    sameOrigin,
    validate(createTerminalSshHostSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      requireLocalAccess(req, companyId);
      const input = req.body as CreateTerminalSshHostRequest;
      const saved = await sshHosts.create(companyId, input, req.actor.userId ?? null);
      if (!saved) throw conflict("A saved SSH host with that name already exists");
      await audit(
        req,
        companyId,
        saved.id,
        "terminal.ssh_host_saved",
        { name: saved.name, destination: saved.destination, port: saved.port },
        "terminal_ssh_host",
      );
      res.status(201).json(saved);
    },
  );

  router.delete("/companies/:companyId/terminal/ssh-hosts/:hostId", gate, sameOrigin, async (req, res) => {
    const companyId = req.params.companyId as string;
    const hostId = req.params.hostId as string;
    requireLocalAccess(req, companyId);
    if (!parseSavedSshHostId(hostId)) {
      if (hostId.startsWith(SSH_CONFIG_HOST_ID_PREFIX)) {
        throw badRequest("Hosts from the server ssh config cannot be removed");
      }
      throw notFound("SSH host not found");
    }
    const removed = await sshHosts.remove(companyId, hostId);
    if (!removed) throw notFound("SSH host not found");
    await audit(req, companyId, hostId, "terminal.ssh_host_deleted", { hostId }, "terminal_ssh_host");
    res.status(204).end();
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

  router.post("/companies/:companyId/terminal/sessions/:sessionId/paste-image", gate, sameOrigin, async (req, res) => {
    const companyId = req.params.companyId as string;
    const sessionId = req.params.sessionId as string;
    sessionForActor(req, companyId, sessionId);
    const file = await readUploadFile(req, res, uploadTempDir);
    try {
      if (!file) throw badRequest("Multipart field \"file\" is required");
      const fileName = pastedImageFileName(file.mimetype);
      const files = manager.files(companyId, sessionId);
      if (!files) throw notFound("Terminal session not found");
      const saved = await files.savePastedImage(fileName, file.path);
      await audit(req, companyId, sessionId, "terminal.image_pasted", { path: saved.path, bytes: saved.bytes });
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
