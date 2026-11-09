import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@tickernelz/wardmote-db";
import {
  activityLog,
  agentApiKeys,
  agents,
  authUsers,
  companyMemberships,
  heartbeatRuns,
  instanceUserRoles,
} from "@tickernelz/wardmote-db";
import { verifyLocalAgentJwt } from "../agent-auth-jwt.js";
import { agentRunWritesRevoked } from "../agent-run-cancellation.js";
import { isUuidLike, normalizeAgentApiKeyScope, type DeploymentMode } from "@tickernelz/wardmote-shared";
import type { BetterAuthSessionResult } from "../auth/better-auth.js";
import { logger } from "./logger.js";
import { captureRunIdentity } from "../services/run-identity.js";
import {
  assertOpenwaAgentKeyMethodAllowed,
  assertOpenwaRestAllowed,
  openwaGrantScope,
  restoreOpenwaGrant,
} from "../services/openwa/authority.js";
import { boardAuthService } from "../services/board-auth.js";
import { beginIdleTrackedWork } from "../services/task-admission.js";

export {
  isTransientDbConnectionError,
  retryIdempotentDatabaseOperation as retryOnTransientDbConnectionError,
} from "../database-retry.js";

import { forbidden, unauthorized, unprocessable } from "../errors.js";

function restoreOpenwaGrantOnRejection(db: Db, res: Response, grant: { companyId: string; runId: string; grantId: string }) {
  const end = res.end;
  res.end = function (this: Response, ...args: unknown[]) {
    res.end = end;
    if (res.statusCode < 400 || res.statusCode >= 500) return end.apply(this, args as Parameters<Response["end"]>);
    void restoreOpenwaGrant(db, grant)
      .catch((err) => logger.warn({ err, runId: grant.runId }, "failed to restore OpenWA grant"))
      .finally(() => end.apply(this, args as Parameters<Response["end"]>));
    return this;
  } as Response["end"];
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeOptionalString(value: string | null | undefined) {
  return value?.trim() || null;
}

function invalidAgentTokenMessage(token: string) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as {
      exp?: unknown;
    };
    if (typeof payload.exp === "number" && payload.exp <= Math.floor(Date.now() / 1000)) {
      return "Expired agent token; obtain fresh credentials and retry";
    }
  } catch {
    // Malformed and incorrectly signed tokens share the generic failure below.
  }
  return "Agent token did not verify; obtain fresh credentials and retry";
}

async function resolveLegacyRunResponsibleUserId(
  db: Db,
  input: { companyId: string; agentId: string; runId: string },
) {
  if (!isUuidLike(input.runId)) return null;
  const run = await db
    .select({ responsibleUserId: heartbeatRuns.responsibleUserId })
    .from(heartbeatRuns)
    .where(
      and(
        eq(heartbeatRuns.id, input.runId),
        eq(heartbeatRuns.companyId, input.companyId),
        eq(heartbeatRuns.agentId, input.agentId),
      ),
    )
    .then((rows) => rows[0] ?? null);
  return normalizeOptionalString(run?.responsibleUserId);
}

async function loadResponsibleUserMemberships(
  db: Db,
  input: { companyId: string; userId: string | null },
) {
  if (!input.userId) return [];
  const [user, memberships] = await Promise.all([
    db
      .select({ id: authUsers.id })
      .from(authUsers)
      .where(eq(authUsers.id, input.userId))
      .then((rows) => rows[0] ?? null),
    db
      .select({
        companyId: companyMemberships.companyId,
        membershipRole: companyMemberships.membershipRole,
        status: companyMemberships.status,
      })
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, input.companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, input.userId),
          eq(companyMemberships.status, "active"),
        ),
      ),
  ]);
  return user ? memberships : [];
}

/**
 * The user's own active company memberships — the exact company scope a
 * locally authenticated session actor carries.
 */
async function loadActiveUserCompanyMemberships(db: Db, userId: string) {
  return db
    .select({
      companyId: companyMemberships.companyId,
      membershipRole: companyMemberships.membershipRole,
      status: companyMemberships.status,
    })
    .from(companyMemberships)
    .where(
      and(
        eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, userId),
        eq(companyMemberships.status, "active"),
      ),
    );
}

async function auditAgentJwtRunHeaderMismatch(
  db: Db,
  input: { companyId: string; agentId: string; claimRunId: string; headerRunId: string; method: string; url: string },
) {
  try {
    await db.insert(activityLog).values({
      companyId: input.companyId,
      actorType: "agent",
      actorId: input.agentId,
      action: "auth.agent_jwt_run_header_mismatch",
      entityType: "heartbeat_run",
      entityId: input.claimRunId,
      ...(isUuidLike(input.agentId) ? { agentId: input.agentId } : {}),
      ...(isUuidLike(input.claimRunId) ? { runId: input.claimRunId } : {}),
      details: {
        claimRunId: input.claimRunId,
        headerRunId: input.headerRunId,
        method: input.method,
        url: input.url,
      },
    });
  } catch (err) {
    logger.warn(
      { err, companyId: input.companyId, agentId: input.agentId, claimRunId: input.claimRunId },
      "Failed to audit rejected agent JWT run header mismatch",
    );
  }
}

async function auditAgentKeyMissingResponsibleUser(
  db: Db,
  input: { companyId: string; agentId: string; keyId: string; method: string; url: string },
) {
  try {
    await db.insert(activityLog).values({
      companyId: input.companyId,
      actorType: "agent",
      actorId: input.agentId,
      action: "auth.agent_key_missing_responsible_user",
      entityType: "agent_api_key",
      entityId: input.keyId,
      ...(isUuidLike(input.agentId) ? { agentId: input.agentId } : {}),
      details: {
        method: input.method,
        url: input.url,
      },
    });
  } catch (err) {
    logger.warn(
      { err, companyId: input.companyId, agentId: input.agentId, keyId: input.keyId },
      "Failed to audit rejected agent key without responsible user binding",
    );
  }
}

interface ActorMiddlewareOptions {
  deploymentMode: DeploymentMode;
  resolveSession?: (req: Request) => Promise<BetterAuthSessionResult | null>;
}

const publicRoutineWebhookPath = /^\/api\/routine-triggers\/public\/[a-f0-9]{24}\/fire\/?$/i;

const publicMcpGatewayProtocolPath = /^\/mcp\/gateways\/gw_[a-f0-9]{32}\/?$/i;

export function actorMiddleware(db: Db, opts: ActorMiddlewareOptions): RequestHandler {
  const boardAuth = boardAuthService(db);
  const authenticate: RequestHandler = async (req, _res, next) => {
    req.actor =
      opts.deploymentMode === "local_trusted"
        ? {
            type: "board",
            userId: "local-board",
            userName: "Local Board",
            userEmail: null,
            isInstanceAdmin: true,
            source: "local_implicit",
          }
        : { type: "none", source: "none" };

    // Routine ingress authenticates its own bearer/signature. Never interpret
    // webhook credentials as agent keys or attach an ambient browser session.
    if (req.method === "POST" && publicRoutineWebhookPath.test(req.path)) {
      req.actor = { type: "none", source: "none" };
      next();
      return;
    }

    const runIdHeader = req.header("x-wardmote-run-id");

    const authHeader = req.header("authorization");
    const hasBearerCredentials = /^bearer(?:\s|$)/i.test(authHeader ?? "");

    // Public MCP gateway protocol requests carry a pcgw_* bearer that is
    // validated by the gateway service itself. Do not interpret that bearer as
    // a board key or agent JWT here: doing so rejects the MCP handshake before
    // the protocol route can verify its run-scoped credential. Keep this bypass
    // restricted to the unguessable public gateway path; all /api routes retain
    // the normal actor authentication path below.
    if (hasBearerCredentials && publicMcpGatewayProtocolPath.test(req.path)) {
      if (runIdHeader) req.actor.runId = runIdHeader;
      next();
      return;
    }

    if (!hasBearerCredentials) {
      if (opts.deploymentMode === "authenticated" && opts.resolveSession) {
        let session: BetterAuthSessionResult | null = null;
        try {
          session = await opts.resolveSession(req);
        } catch (err) {
          logger.warn(
            { err, method: req.method, url: req.originalUrl },
            "Failed to resolve auth session from request headers",
          );
        }
        if (session?.user?.id && session.session?.id) {
          const userId = session.user.id;
          const [roleRow, memberships] = await Promise.all([
            db
              .select({ id: instanceUserRoles.id })
              .from(instanceUserRoles)
              .where(and(eq(instanceUserRoles.userId, userId), eq(instanceUserRoles.role, "instance_admin")))
              .then((rows) => rows[0] ?? null),
            loadActiveUserCompanyMemberships(db, userId),
          ]);
          req.actor = {
            type: "board",
            userId,
            sessionId: session.session.id,
            userName: session.user.name ?? null,
            userEmail: session.user.email ?? null,
            companyIds: memberships.map((row) => row.companyId),
            memberships,
            isInstanceAdmin: Boolean(roleRow),
            runId: runIdHeader ?? undefined,
            source: "session",
          };
          next();
          return;
        }
      }
      if (runIdHeader) req.actor.runId = runIdHeader;
      next();
      return;
    }

    const token = authHeader!.slice("bearer".length).trim();
    if (!token) {
      next(unauthorized("Empty bearer token; provide valid agent credentials and retry"));
      return;
    }

    const boardKey = await boardAuth.findBoardApiKeyByToken(token);
    if (boardKey) {
      const access = await boardAuth.resolveBoardAccess(boardKey.userId);
      if (access.user) {
        await boardAuth.touchBoardApiKey(boardKey.id);
        req.actor = {
          type: "board",
          userId: boardKey.userId,
          userName: access.user?.name ?? null,
          userEmail: access.user?.email ?? null,
          companyIds: access.companyIds,
          memberships: access.memberships,
          isInstanceAdmin: access.isInstanceAdmin,
          keyId: boardKey.id,
          runId: runIdHeader || undefined,
          source: "board_key",
        };
        next();
        return;
      }
    }

    const tokenHash = hashToken(token);
    const key = await db
      .select()
      .from(agentApiKeys)
      .where(and(eq(agentApiKeys.keyHash, tokenHash), isNull(agentApiKeys.revokedAt)))
      .then((rows) => rows[0] ?? null);

    if (!key) {
      const claims = verifyLocalAgentJwt(token);
      if (!claims) {
        next(unauthorized(invalidAgentTokenMessage(token)));
        return;
      }

      const agentRecord = await db
        .select()
        .from(agents)
        .where(eq(agents.id, claims.sub))
        .then((rows) => rows[0] ?? null);

      if (!agentRecord || agentRecord.companyId !== claims.company_id) {
        next(unauthorized("Agent record is missing or belongs to another company; obtain fresh credentials and retry"));
        return;
      }

      if (agentRecord.status === "terminated") {
        next(unauthorized("Agent is terminated and cannot authenticate"));
        return;
      }
      if (agentRecord.status === "pending_approval") {
        next(unauthorized("Agent is pending approval and cannot authenticate"));
        return;
      }

      const normalizedRunIdHeader = normalizeOptionalString(runIdHeader);
      if (normalizedRunIdHeader && normalizedRunIdHeader !== claims.run_id) {
        await auditAgentJwtRunHeaderMismatch(db, {
          companyId: claims.company_id,
          agentId: claims.sub,
          claimRunId: claims.run_id,
          headerRunId: normalizedRunIdHeader,
          method: req.method,
          url: req.originalUrl,
        });
        next(
          unprocessable("X-Wardmote-Run-Id does not match signed agent JWT run_id", {
            code: "agent_jwt_run_id_mismatch",
            claimRunId: claims.run_id,
            headerRunId: normalizedRunIdHeader,
          }),
        );
        return;
      }

      const [identityRun] = await db.select({ activeIdentityContextId: heartbeatRuns.activeIdentityContextId,
        responsibleUserId: heartbeatRuns.responsibleUserId, status: heartbeatRuns.status, resultJson: heartbeatRuns.resultJson,
        contextSnapshot: heartbeatRuns.contextSnapshot }).from(heartbeatRuns).where(and(
          eq(heartbeatRuns.id, claims.run_id), eq(heartbeatRuns.companyId, claims.company_id), eq(heartbeatRuns.agentId, claims.sub),
        ));
      if (agentRunWritesRevoked(identityRun)
        && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        const conversation = identityRun?.contextSnapshot?.conversationMode === true;
        _res.status(403).json({ error: conversation ? "This conversation turn was cancelled" : "This run was cancelled",
          code: conversation ? "conversation_turn_cancelled" : "agent_run_cancelled" });
        return;
      }
      let openwaGrantId: string | null = null;
      if (identityRun) {
        try {
          openwaGrantId = await assertOpenwaRestAllowed(db, {
            run: { id: claims.run_id, companyId: claims.company_id, contextSnapshot: identityRun.contextSnapshot },
            method: req.method,
            path: req.path,
            body: req.body,
          });
          if (openwaGrantId) restoreOpenwaGrantOnRejection(db, _res, { companyId: claims.company_id, runId: claims.run_id, grantId: openwaGrantId });
        } catch (error) {
          next(error);
          return;
        }
      }
      if (identityRun?.activeIdentityContextId && identityRun.status === "running") {
        const captured = await captureRunIdentity(db, { companyId: claims.company_id, agentId: claims.sub, runId: claims.run_id });
        identityRun.activeIdentityContextId = captured.context?.id ?? null;
        identityRun.responsibleUserId = captured.context?.responsibleUserId ?? null;
      }
      const onBehalfOfUserId = identityRun?.activeIdentityContextId
        ? identityRun.responsibleUserId
        : claims.responsible_user_id !== undefined
        ? normalizeOptionalString(claims.responsible_user_id)
        : await resolveLegacyRunResponsibleUserId(db, {
            companyId: claims.company_id,
            agentId: claims.sub,
            runId: claims.run_id,
          });
      const onBehalfOfMemberships = await loadResponsibleUserMemberships(db, {
        companyId: claims.company_id,
        userId: onBehalfOfUserId,
      });

      req.actor = {
        type: "agent",
        agentId: claims.sub,
        agentRole: agentRecord.role ?? null,
        agentStatus: agentRecord.status ?? null,
        agentPermissions: agentRecord.permissions ?? null,
        companyId: claims.company_id,
        keyId: undefined,
        keyScope: normalizeAgentApiKeyScope(claims.key_scope),
        runId: claims.run_id,
        onBehalfOfUserId,
        identityContextId: identityRun?.activeIdentityContextId ?? null,
        onBehalfOfMemberships,
        source: "agent_jwt",
      };
      if (openwaGrantId) openwaGrantScope({ companyId: claims.company_id, runId: claims.run_id, grantId: openwaGrantId }, next);
      else next();
      return;
    }

    await db
      .update(agentApiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(agentApiKeys.id, key.id));

    const agentRecord = await db
      .select()
      .from(agents)
      .where(eq(agents.id, key.agentId))
      .then((rows) => rows[0] ?? null);

    if (!agentRecord || agentRecord.companyId !== key.companyId) {
      next(unauthorized("Agent record is missing or belongs to another company; obtain fresh credentials and retry"));
      return;
    }
    if (agentRecord.status === "terminated") {
      next(unauthorized("Agent is terminated and cannot authenticate"));
      return;
    }
    if (agentRecord.status === "pending_approval") {
      next(unauthorized("Agent is pending approval and cannot authenticate"));
      return;
    }

    try {
      await assertOpenwaAgentKeyMethodAllowed(db, { companyId: key.companyId, agentId: key.agentId, method: req.method });
    } catch (error) {
      next(error);
      return;
    }

    const responsibleUserId = normalizeOptionalString(key.responsibleUserId);
    if (!responsibleUserId) {
      await auditAgentKeyMissingResponsibleUser(db, {
        companyId: key.companyId,
        agentId: key.agentId,
        keyId: key.id,
        method: req.method,
        url: req.originalUrl,
      });
      next(forbidden("Responsible user is unavailable for this agent key", {
        code: "RESPONSIBLE_USER_UNAVAILABLE",
      }));
      return;
    }

    req.actor = {
      type: "agent",
      agentId: key.agentId,
      agentRole: agentRecord.role ?? null,
      agentStatus: agentRecord.status ?? null,
      agentPermissions: agentRecord.permissions ?? null,
      companyId: key.companyId,
      keyId: key.id,
      keyScope: normalizeAgentApiKeyScope(key.scopeConfig),
      onBehalfOfUserId: responsibleUserId,
      onBehalfOfMemberships: await loadResponsibleUserMemberships(db, {
        companyId: key.companyId,
        userId: responsibleUserId,
      }),
      runId: runIdHeader || undefined,
      source: "agent_key",
    };

    next();
  };
  return async (req, res, next) => {
    // Health and task-drain requests bypass tenant admission, but resolving
    // their actor can still write users, companies, memberships and key usage.
    // Finish all authentication before entering the next handler: the report
    // must count concurrent authentication, without counting its own auth.
    const finish = beginIdleTrackedWork();
    let continueRequest: (() => void) | undefined;
    try {
      await authenticate(req, res, (error?: unknown) => {
        const resume = AsyncLocalStorage.snapshot();
        continueRequest = () => resume(() => next(error));
      });
    } finally {
      finish();
    }
    continueRequest?.();
  };
}

export function requireBoard(req: Express.Request) {
  return req.actor.type === "board";
}
