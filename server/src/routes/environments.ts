import { Router, type Request } from "express";
import type { Db } from "@tickernelz/wardmote-db";
import {
  AGENT_ADAPTER_TYPES,
  cancelEnvironmentCustomImageSetupSessionSchema,
  createEnvironmentCustomImageTerminalSessionTokenSchema,
  createEnvironmentSchema,
  finishEnvironmentCustomImageSetupSessionSchema,
  getEnvironmentCapabilities,
  probeEnvironmentConfigSchema,
  resolveDeclaredSandboxCapabilities,
  redactEnvironmentCustomImageSetupSession,
  redactEnvironmentCustomImageTemplate,
  relinkEnvironmentCustomImageTemplateSchema,
  startEnvironmentCustomImageSetupSessionSchema,
  type EnvironmentDeleteBlastRadius,
  updateEnvironmentSchema,
} from "@tickernelz/wardmote-shared";
import { conflict, forbidden, unprocessable } from "../errors.js";
import { parseExecutionPolicyBootstrapEnv } from "../services/execution-policy-bootstrap.js";
import { isExecutionForcedToKubernetes } from "../services/execution-allowlist.js";
import { validate } from "../middleware/validate.js";
import { logger } from "../middleware/logger.js";
import {
  environmentCustomImageService,
  issueService,
  instanceSettingsService,
  logActivity,
  projectService,
} from "../services/index.js";
import {
  environmentCustomImageTerminalConnectionRegistry,
  environmentCustomImageTerminalSessionStore,
  validateCustomImageSetupSshPayload,
  type EnvironmentCustomImageTerminalPayloadValidationResult,
} from "../services/environment-custom-image-terminal-sessions.js";
import {
  readCustomImageSetupSessionCompanyId,
  requireFutureCustomImageSetupExpiry,
} from "../services/environment-custom-image-setup-session-utils.js";
import {
  collectEnvironmentSecretRefs,
  normalizeEnvironmentConfigForPersistence,
  normalizeEnvironmentConfigForProbe,
  readSshEnvironmentPrivateKeySecretId,
  type ParsedEnvironmentConfig,
} from "../services/environment-config.js";
import { probeEnvironment } from "../services/environment-probe.js";
import { secretService } from "../services/secrets.js";
import {
  listReadyPluginEnvironmentDrivers,
} from "../services/plugin-environment-driver.js";
import { getConfiguredSecretProvider } from "../secrets/configured-provider.js";
import { assertBoardOrgAccess, getActorInfo } from "./authz.js";
import type { PluginWorkerManager } from "../services/plugin-worker-manager.js";
import { environmentService } from "../services/environments.js";
import { environmentRuntimeService } from "../services/environment-runtime.js";
import { executionWorkspaceService } from "../services/execution-workspaces.js";
import { closeWarmNativeSessionsForEnvironment } from "../services/native-runtime/native-session-executor.js";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function environmentRoutes(
  db: Db,
  options: {
    pluginWorkerManager?: PluginWorkerManager;
  } = {},
) {
  const router = Router();
  const svc = environmentService(db);
  const environmentRuntime = environmentRuntimeService(db, {
    pluginWorkerManager: options.pluginWorkerManager,
  });
  const customImages = environmentCustomImageService(db, {
    pluginWorkerManager: options.pluginWorkerManager,
  });
  const executionWorkspaces = executionWorkspaceService(db);
  const issues = issueService(db);
  const instanceSettings = instanceSettingsService(db);
  const projects = projectService(db);
  const secrets = secretService(db);
  const strictSecretsMode = process.env.WARDMOTE_SECRETS_STRICT_MODE === "true";

  function parseObject(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  function assertCanAccessInstanceEnvironments(req: Request) {
    if (req.actor.type !== "board") {
      throw forbidden("Instance environment management is restricted to board operators");
    }
    if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return;
    throw forbidden("Instance admin access required");
  }

  function assertCanReadInstanceEnvironments(req: Request) {
    assertBoardOrgAccess(req);
  }

  function assertCustomImageCompanyAccess(req: Request, companyId: string) {
    if (req.actor.type !== "board") {
      throw forbidden("Board access required");
    }
    if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return;
    const allowedCompanies = req.actor.companyIds ?? [];
    if (!allowedCompanies.includes(companyId)) {
      throw forbidden("User does not have access to this company");
    }
  }

  function canReadFullInstanceEnvironment(req: Request) {
    return req.actor.type === "board"
      && (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin);
  }

  function redactEnvironmentForRestrictedView<T extends {
    config: Record<string, unknown> | null;
    envVars?: Record<string, unknown> | null;
    metadata: Record<string, unknown> | null;
  }>(environment: T): T {
    return {
      ...environment,
      config: {},
      ...(Object.prototype.hasOwnProperty.call(environment, "envVars") ? { envVars: {} } : {}),
      metadata: null,
    };
  }

  function presentEnvironmentForRead<T extends {
    config: Record<string, unknown> | null;
    envVars?: Record<string, unknown> | null;
    metadata: Record<string, unknown> | null;
  }>(req: Request, environment: T): T {
    return canReadFullInstanceEnvironment(req)
      ? environment
      : redactEnvironmentForRestrictedView(environment);
  }

  async function assertCanReadSecretsForDraftProbe(req: Request, companyId: string) {
    assertCanAccessInstanceEnvironments(req);
    return companyId;
  }

  async function logInstanceEnvironmentActivity(input: {
    actor: ReturnType<typeof getActorInfo>;
    action: string;
    entityId: string;
    details: Record<string, unknown>;
  }) {
    const companyIds = await instanceSettings.listCompanyIds();
    await Promise.all(
      companyIds.map((companyId) =>
        logActivity(db, {
          companyId,
          actorType: input.actor.actorType,
          actorId: input.actor.actorId,
          agentId: input.actor.agentId,
          runId: input.actor.runId,
          action: input.action,
          entityType: "environment",
          entityId: input.entityId,
          details: input.details,
        })
      ),
    );
  }

  async function logEnvironmentCustomImageActivity(input: {
    actor: ReturnType<typeof getActorInfo>;
    companyId: string;
    action: string;
    entityId: string;
    details: Record<string, unknown>;
  }) {
    await logActivity(db, {
      companyId: input.companyId,
      actorType: input.actor.actorType,
      actorId: input.actor.actorId,
      agentId: input.actor.agentId,
      runId: input.actor.runId,
      action: input.action,
      entityType: "environment",
      entityId: input.entityId,
      details: input.details,
    });
  }

  async function resolveCustomImageCompanyId(req: Request): Promise<string> {
    const queryCompanyId =
      typeof req.query.companyId === "string" && req.query.companyId.trim().length > 0
        ? req.query.companyId.trim()
        : null;
    if (queryCompanyId) {
      assertCustomImageCompanyAccess(req, queryCompanyId);
      return queryCompanyId;
    }
    if (req.actor.type === "board" && req.actor.companyIds?.length === 1) {
      return req.actor.companyIds[0]!;
    }
    const companyIds = await instanceSettings.listCompanyIds();
    if (companyIds.length === 1 && companyIds[0]) {
      const companyId = companyIds[0];
      assertCustomImageCompanyAccess(req, companyId);
      return companyId;
    }
    throw unprocessable("companyId query parameter is required for environment customImage setup.");
  }

  async function resolveCustomImageSessionCompanyId(
    req: Request,
    session: { metadata?: Record<string, unknown> | null },
  ): Promise<string> {
    const metadataCompanyId = readCustomImageSetupSessionCompanyId(session);
    if (metadataCompanyId) {
      assertCustomImageCompanyAccess(req, metadataCompanyId);
      return metadataCompanyId;
    }
    return await resolveCustomImageCompanyId(req);
  }

  /**
   * Pick the company context used to create new secrets from raw-pasted
   * values, normalize env-var bindings, and resolve probe secrets. An
   * explicit route param / query wins, then the single company the
   * environment's bindings already live in, then the actor's own company,
   * then the instance's only company (when exactly one exists).
   * Bindings must never veto an explicit caller context: config-derived
   * bindings live in the company that owns each referenced secret (see
   * `replaceSecretRefsForInstanceTarget`), so an environment's bindings may
   * legitimately sit in a different company — or several — than the board
   * that is editing it.
   */
  async function resolveEnvironmentSecretContextCompanyId(
    req: Request,
    environmentId: string,
    options: { required: boolean },
  ): Promise<string | null> {
    const routeCompanyId =
      typeof req.params.companyId === "string" && req.params.companyId.trim().length > 0
        ? req.params.companyId.trim()
        : typeof req.query.companyId === "string" && req.query.companyId.trim().length > 0
          ? req.query.companyId.trim()
          : null;
    if (routeCompanyId) return routeCompanyId;
    const bindingCompanyIds = await secrets.listBindingCompanyIdsForTarget({
      targetType: "environment",
      targetId: environmentId,
    });
    if (bindingCompanyIds.length === 1) return bindingCompanyIds[0] ?? null;
    if (req.actor.type === "agent" && req.actor.companyId) return req.actor.companyId;
    if (req.actor.type === "board" && Array.isArray(req.actor.companyIds) && req.actor.companyIds.length === 1) {
      return req.actor.companyIds[0] ?? null;
    }
    // Single-company instances have exactly one possible secret scope, so an
    // actor whose memberships cannot pin a company (none, or several — e.g. an
    // instance admin provisioned without a membership row) still resolves.
    // Mirrors the fallback in `resolveCustomImageCompanyId`.
    const instanceCompanyIds = await instanceSettings.listCompanyIds();
    if (instanceCompanyIds.length === 1 && instanceCompanyIds[0]) {
      return instanceCompanyIds[0];
    }
    if (!options.required) return null;
    throw unprocessable(
      "Environment secret management requires a companyId context during the instance-scoped transition.",
    );
  }

  function summarizeEnvironmentUpdate(
    patch: Record<string, unknown>,
    environment: {
      name: string;
      driver: string;
      status: string;
    },
  ): Record<string, unknown> {
    const details: Record<string, unknown> = {
      changedFields: Object.keys(patch).sort(),
    };

    if (patch.name !== undefined) details.name = environment.name;
    if (patch.driver !== undefined) details.driver = environment.driver;
    if (patch.status !== undefined) details.status = environment.status;
    if (patch.description !== undefined) details.descriptionChanged = true;
    if (patch.config !== undefined) {
      details.configChanged = true;
      details.configTopLevelKeyCount =
        patch.config && typeof patch.config === "object" && !Array.isArray(patch.config)
          ? Object.keys(patch.config as Record<string, unknown>).length
          : 0;
    }
    if (patch.metadata !== undefined) {
      details.metadataChanged = true;
      details.metadataTopLevelKeyCount =
        patch.metadata && typeof patch.metadata === "object" && !Array.isArray(patch.metadata)
          ? Object.keys(patch.metadata as Record<string, unknown>).length
          : 0;
    }

    return details;
  }

  function environmentDeleteBlockMessage(impact: EnvironmentDeleteBlastRadius): string | null {
    if (impact.staticReferences.isManagedLocal) {
      return "Cannot delete the managed local environment.";
    }
    if (impact.staticReferences.isInstanceDefault) {
      return "Cannot delete the current instance default environment. Set a new default environment before deleting this one.";
    }
    if (impact.pendingCleanupLeaseCount > 0) {
      return "Cannot delete this environment while a sandbox cleanup is pending. Wait for the cleanup sweep to destroy the orphan sandbox, then retry.";
    }
    if (impact.reusableSandboxLeaseCount > 0) {
      return "Cannot delete this environment while it has a reusable sandbox lease. Remove the associated execution workspace or issue so Wardmote can destroy the sandbox, then retry.";
    }
    return null;
  }

  function rejectEnvironmentDelete(input: {
    actor: ReturnType<typeof getActorInfo>;
    environment: { id: string; driver: string };
    impact: EnvironmentDeleteBlastRadius;
    // Sandboxes a consented delete destroyed before this rejection. Provider
    // destruction is not transactional with the delete guard, so a rejection
    // after a partial destroy must say what already happened.
    destroyedReusableSandboxLeaseCount?: number;
  }): never {
    const message =
      environmentDeleteBlockMessage(input.impact)
      ?? "Environment delete is currently blocked. Refresh the environment and retry.";
    logger.warn(
      {
        environmentId: input.environment.id,
        environmentDriver: input.environment.driver,
        deleteBlockedReasons: input.impact.deleteBlockedReasons,
        destroyedReusableSandboxLeaseCount: input.destroyedReusableSandboxLeaseCount ?? 0,
        actorType: input.actor.actorType,
        actorId: input.actor.actorId,
        agentId: input.actor.agentId,
        runId: input.actor.runId,
      },
      "environment delete rejected by guard",
    );
    throw conflict(message, {
      deleteBlockedReasons: input.impact.deleteBlockedReasons,
      ...(input.destroyedReusableSandboxLeaseCount
        ? { destroyedReusableSandboxLeaseCount: input.destroyedReusableSandboxLeaseCount }
        : {}),
    });
  }

  function setupSessionActivityDetails(session: {
    id: string;
    environmentId: string;
    provider: string;
    status: string;
    providerLeaseId: string | null;
    baseTemplateRef: string | null;
    connectionSummary?: Record<string, unknown> | null;
    connectionSecretRef: string | null;
    metadata?: Record<string, unknown> | null;
  }) {
    return redactEnvironmentCustomImageSetupSession({
      sessionId: session.id,
      environmentId: session.environmentId,
      provider: session.provider,
      status: session.status,
      providerLeaseId: session.providerLeaseId,
      baseTemplateRef: session.baseTemplateRef,
      connectionSummary: session.connectionSummary,
      connectionSecretRef: session.connectionSecretRef,
      metadata: session.metadata,
    });
  }

  function templateActivityDetails(template: {
    id: string;
    environmentId: string;
    provider: string;
    status: string;
    templateKind: string;
    templateRef: string | null;
    sourceTemplateRef: string | null;
    metadata?: Record<string, unknown> | null;
  }) {
    return redactEnvironmentCustomImageTemplate({
      templateId: template.id,
      environmentId: template.environmentId,
      provider: template.provider,
      status: template.status,
      templateKind: template.templateKind,
      templateRef: template.templateRef,
      sourceTemplateRef: template.sourceTemplateRef,
      metadata: template.metadata,
    });
  }

  function throwTerminalPayloadValidationFailure(
    failure: Extract<EnvironmentCustomImageTerminalPayloadValidationResult, { ok: false }>,
  ): never {
    if (failure.status === 409) {
      throw conflict(failure.message);
    }
    throw unprocessable(failure.message);
  }

  /**
   * Managed-sandbox-only policy (`enableManagedSandboxOnly`): the local
   * environment disappears from every read surface — the list and the
   * by-id read — for every actor, including instance admins. The row
   * itself stays in the database (company creation and the heartbeat
   * depend on `ensureLocalEnvironment`); run selection independently
   * refuses local under the same flag, so hiding here is presentation,
   * not the enforcement boundary.
   */
  async function isManagedSandboxOnlyInstance(): Promise<boolean> {
    return (await instanceSettings.getExperimental()).enableManagedSandboxOnly === true;
  }

  router.get("/companies/:companyId/environments", async (req, res) => {
    assertCanReadInstanceEnvironments(req);
    const rows = await svc.list({
      status: req.query.status as string | undefined,
      driver: req.query.driver as string | undefined,
    });
    const visible = (await isManagedSandboxOnlyInstance())
      ? rows.filter((row) => row.driver !== "local")
      : rows;
    res.json(visible.map((row) => presentEnvironmentForRead(req, row)));
  });

  router.get("/environments/:id/delete-blast-radius", async (req, res) => {
    assertCanAccessInstanceEnvironments(req);
    const impact = await svc.getDeleteBlastRadius(req.params.id as string);
    if (!impact) {
      res.status(404).json({ error: "Environment not found" });
      return;
    }
    res.json(impact);
  });

  router.get("/companies/:companyId/environments/capabilities", async (req, res) => {
    assertCanReadInstanceEnvironments(req);
    const pluginDrivers = await listReadyPluginEnvironmentDrivers({
      db,
      workerManager: options.pluginWorkerManager,
    });
    res.json(getEnvironmentCapabilities(
      AGENT_ADAPTER_TYPES,
      {
        sandboxProviders: Object.fromEntries(pluginDrivers.map((driver) => [
          driver.driverKey,
          {
            status: "supported" as const,
            supportsSavedProbe: true,
            supportsUnsavedProbe: true,
            supportsRunExecution: true,
            // Publish reusable-lease support only when the declaration allows it
            // AND the live worker verified all reuse lifecycle methods, so the
            // presentation matches the acquisition guard, which requires them.
            // The declaration part uses the same resolver acquisition uses, so
            // the nested `sandboxCapabilities` override wins over the legacy
            // `supportsReusableLeases` flag: a manifest with legacy `true` and
            // nested `false` presents as not reusable. Default an absent value
            // to false with `=== true`. A ready worker that omits any reuse
            // lifecycle method presents as not reusable, because acquisition
            // would always fall back to an ephemeral lease.
            supportsReusableLeases:
              resolveDeclaredSandboxCapabilities(driver).reusableLeases === true
              && driver.reusableLeaseMethodsVerified,
            supportsInteractiveSetup: driver.supportsInteractiveSetup,
            interactiveSetupConnectionTypes: driver.interactiveSetupConnectionTypes,
            supportsTemplateCapture: driver.supportsTemplateCapture,
            templateRefKind: driver.templateRefKind,
            templateConfigBinding: driver.templateConfigBinding,
            supportsTemplateDelete: driver.supportsTemplateDelete,
            supportsLoginPty: driver.supportsLoginPty ?? false,
            displayName: driver.displayName,
            description: driver.description,
            source: "plugin" as const,
            pluginKey: driver.pluginKey,
            pluginId: driver.pluginId,
            configSchema: driver.configSchema,
          },
        ])),
      },
    ));
  });

  router.get("/environments/:environmentId/custom-image-template", async (req, res) => {
    assertCanAccessInstanceEnvironments(req);
    await resolveCustomImageCompanyId(req);
    const overview = await customImages.getOverview({
      environmentId: req.params.environmentId as string,
    });
    res.json(overview);
  });

  router.post(
    "/environments/:environmentId/custom-image-setup-sessions",
    validate(startEnvironmentCustomImageSetupSessionSchema),
    async (req, res) => {
      assertCanAccessInstanceEnvironments(req);
      const companyId = await resolveCustomImageCompanyId(req);
      const actor = getActorInfo(req);
      const result = await customImages.startSetupSession({
        environmentId: req.params.environmentId as string,
        templateId: req.body.templateId ?? null,
        ttlSeconds: req.body.ttlSeconds ?? null,
        actor: {
          userId: actor.actorType === "user" ? actor.actorId : null,
          agentId: actor.agentId,
        },
        secretContextCompanyId: companyId,
      });
      await logEnvironmentCustomImageActivity({
        actor,
        companyId,
        action: "environment.custom_image_setup.started",
        entityId: result.session.environmentId,
        details: setupSessionActivityDetails(result.session),
      });
      res.status(201).json(result);
    },
  );

  router.get("/environment-custom-image-setup-sessions/:sessionId", async (req, res) => {
    assertCanAccessInstanceEnvironments(req);
    const session = await customImages.getSessionById(req.params.sessionId as string);
    if (!session) {
      res.status(404).json({ error: "Environment customImage setup session not found" });
      return;
    }
    await resolveCustomImageSessionCompanyId(req, session);
    const result = await customImages.refreshSetupSession({
      sessionId: session.id,
      includeConnectionPayload: true,
    });
    res.json(result);
  });

  router.post(
    "/environment-custom-image-setup-sessions/:sessionId/terminal-session-token",
    validate(createEnvironmentCustomImageTerminalSessionTokenSchema),
    async (req, res) => {
      assertCanAccessInstanceEnvironments(req);
      const session = await customImages.getSessionById(req.params.sessionId as string);
      if (!session) {
        res.status(404).json({ error: "Environment customImage setup session not found" });
        return;
      }
      const companyId = await resolveCustomImageSessionCompanyId(req, session);

      const refreshed = await customImages.refreshSetupSession({
        sessionId: session.id,
        includeConnectionPayload: true,
      });
      const now = new Date();
      if (refreshed.session.status !== "waiting_for_user") {
        throw conflict(`Cannot create terminal session token from setup status "${refreshed.session.status}".`);
      }
      const setupExpiresAt = requireFutureCustomImageSetupExpiry(refreshed.session, now);
      const payloadValidation = validateCustomImageSetupSshPayload(refreshed.connectionPayload, now);
      if (!payloadValidation.ok) {
        throwTerminalPayloadValidationFailure(payloadValidation);
      }

      const minted = environmentCustomImageTerminalSessionStore.create({
        setupSessionId: refreshed.session.id,
        companyId,
        environmentId: refreshed.session.environmentId,
        provider: refreshed.session.provider,
        ssh: payloadValidation.ssh,
        setupExpiresAt,
        connectionExpiresAt: payloadValidation.connectionExpiresAt,
        now,
      });
      const actor = getActorInfo(req);
      await logEnvironmentCustomImageActivity({
        actor,
        companyId,
        action: "environment.custom_image_terminal_session_token.created",
        entityId: refreshed.session.environmentId,
        details: {
          session: setupSessionActivityDetails(refreshed.session),
          terminalSession: {
            connectionType: "ssh",
            connectExpiresAt: minted.session.connectExpiresAt.toISOString(),
            sessionExpiresAt: minted.session.sessionExpiresAt.toISOString(),
          },
        },
      });
      res.status(201).json({
        id: minted.session.id,
        token: minted.token,
        expiresAt: minted.session.connectExpiresAt.toISOString(),
        setupSessionId: minted.session.setupSessionId,
        environmentId: minted.session.environmentId,
        connectionType: "ssh",
        websocketPath:
          `/api/environment-custom-image-setup-sessions/${encodeURIComponent(minted.session.setupSessionId)}/terminal/ws`
          + `?terminalSessionId=${encodeURIComponent(minted.session.id)}`,
      });
    },
  );

  router.post(
    "/environment-custom-image-setup-sessions/:sessionId/finish",
    validate(finishEnvironmentCustomImageSetupSessionSchema),
    async (req, res) => {
      assertCanAccessInstanceEnvironments(req);
      const session = await customImages.getSessionById(req.params.sessionId as string);
      if (!session) {
        res.status(404).json({ error: "Environment customImage setup session not found" });
        return;
      }
      const companyId = await resolveCustomImageSessionCompanyId(req, session);
      const actor = getActorInfo(req);
      const result = await customImages.finishSetupSession({
        sessionId: session.id,
        metadata: req.body.metadata,
      });
      environmentCustomImageTerminalSessionStore.deleteBySetupSessionId(session.id);
      environmentCustomImageTerminalConnectionRegistry.closeBySetupSessionId(session.id, "setup_finished");
      await logEnvironmentCustomImageActivity({
        actor,
        companyId,
        action: "environment.custom_image_setup.finished",
        entityId: result.session.environmentId,
        details: {
          session: setupSessionActivityDetails(result.session),
          template: templateActivityDetails(result.template),
        },
      });
      res.json(result);
    },
  );

  router.post(
    "/environment-custom-image-setup-sessions/:sessionId/cancel",
    validate(cancelEnvironmentCustomImageSetupSessionSchema),
    async (req, res) => {
      assertCanAccessInstanceEnvironments(req);
      const session = await customImages.getSessionById(req.params.sessionId as string);
      if (!session) {
        res.status(404).json({ error: "Environment customImage setup session not found" });
        return;
      }
      const companyId = await resolveCustomImageSessionCompanyId(req, session);
      const actor = getActorInfo(req);
      const cancelled = await customImages.cancelSetupSession({
        sessionId: session.id,
        reason: req.body.reason ?? null,
      });
      environmentCustomImageTerminalSessionStore.deleteBySetupSessionId(session.id);
      environmentCustomImageTerminalConnectionRegistry.closeBySetupSessionId(session.id, "setup_cancelled");
      await logEnvironmentCustomImageActivity({
        actor,
        companyId,
        action: "environment.custom_image_setup.cancelled",
        entityId: cancelled.environmentId,
        details: setupSessionActivityDetails(cancelled),
      });
      res.json(cancelled);
    },
  );

  router.post("/environments/:environmentId/custom-image-template/rollback", async (req, res) => {
    assertCanAccessInstanceEnvironments(req);
    const companyId = await resolveCustomImageCompanyId(req);
    const actor = getActorInfo(req);
    const result = await customImages.rollbackTemplate({
      environmentId: req.params.environmentId as string,
    });
    await logEnvironmentCustomImageActivity({
      actor,
      companyId,
      action: "environment.custom_image_template.rolled_back",
      entityId: req.params.environmentId as string,
      details: {
        activeTemplate: templateActivityDetails(result.activeTemplate),
        supersededTemplate: templateActivityDetails(result.supersededTemplate),
      },
    });
    res.json(result);
  });

  router.post(
    "/environments/:environmentId/custom-image-template/relink",
    validate(relinkEnvironmentCustomImageTemplateSchema),
    async (req, res) => {
      assertCanAccessInstanceEnvironments(req);
      const companyId = await resolveCustomImageCompanyId(req);
      const actor = getActorInfo(req);
      // The service classifies drift, re-stamps the fingerprint, and writes the
      // activity row in one transaction. The route never classifies.
      const result = await customImages.relinkActiveTemplate({
        environmentId: req.params.environmentId as string,
        confirmBootSourceDrift: req.body.confirmBootSourceDrift === true,
        actor: {
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          agentApiKeyId: actor.agentApiKeyId,
        },
        companyId,
      });
      res.json(result);
    },
  );

  router.delete("/environments/:environmentId/custom-image-template", async (req, res) => {
    assertCanAccessInstanceEnvironments(req);
    const companyId = await resolveCustomImageCompanyId(req);
    const actor = getActorInfo(req);
    const template = await customImages.disableTemplate({
      environmentId: req.params.environmentId as string,
      deleteProviderTemplate: req.query.deleteProviderTemplate === "true",
    });
    await logEnvironmentCustomImageActivity({
      actor,
      companyId,
      action: "environment.custom_image_template.disabled",
      entityId: req.params.environmentId as string,
      details: templateActivityDetails(template),
    });
    res.json(template);
  });

  router.post("/companies/:companyId/environments", validate(createEnvironmentSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCanAccessInstanceEnvironments(req);
    if (req.body.driver === "local") {
      const existingLocal = await svc.list({ driver: "local" });
      if (existingLocal.length > 0) {
        throw conflict("A local environment already exists for this instance.");
      }
    }
    const actor = getActorInfo(req);
    const input = {
      ...req.body,
      envVars: await secrets.normalizeEnvBindingsForPersistence(
        companyId,
        req.body.envVars,
        { strictMode: strictSecretsMode, fieldPath: "envVars" },
      ),
      config: await normalizeEnvironmentConfigForPersistence({
        db,
        companyId,
        environmentName: req.body.name,
        driver: req.body.driver,
        secretProvider: getConfiguredSecretProvider(),
        config: req.body.config,
        actor: {
          agentId: actor.agentId,
          userId: actor.actorType === "user" ? actor.actorId : null,
        },
        pluginWorkerManager: options.pluginWorkerManager,
      }),
    };
    // Create the row and its binding rows atomically so an invalid secret
    // ref cannot leave an environment persisted without its bindings.
    const environment = await db.transaction(async (tx) => {
      const created = await svc.create(input, undefined, { db: tx });
      await secrets.replaceSecretRefsForInstanceTarget(
        { targetType: "environment", targetId: created.id },
        await collectEnvironmentSecretRefs({ db, environment: created }),
        { db: tx },
      );
      await secrets.syncEnvBindingsForTarget(
        companyId,
        { targetType: "environment", targetId: created.id },
        created.envVars,
        { db: tx },
      );
      return created;
    });
    await logInstanceEnvironmentActivity({
      actor,
      action: "environment.created",
      entityId: environment.id,
      details: {
        name: environment.name,
        driver: environment.driver,
        status: environment.status,
      },
    });
    res.status(201).json(presentEnvironmentForRead(req, environment));
  });

  router.get("/environments/:id", async (req, res) => {
    assertCanReadInstanceEnvironments(req);
    const environment = await svc.getById(req.params.id as string);
    if (!environment || (environment.driver === "local" && (await isManagedSandboxOnlyInstance()))) {
      res.status(404).json({ error: "Environment not found" });
      return;
    }
    res.json(presentEnvironmentForRead(req, environment));
  });

  router.get("/environments/:id/secret-refs", async (req, res) => {
    assertCanAccessInstanceEnvironments(req);
    const environment = await svc.getById(req.params.id as string);
    if (!environment) {
      res.status(404).json({ error: "Environment not found" });
      return;
    }
    // Metadata only (name / status / owning company) — never secret values.
    // Environments are instance-scoped while secrets are company-scoped, so
    // the editor needs this to render refs whose secret a given company's
    // picker cannot list. Gated by the same instance-level access check as
    // environment editing.
    const refs = await collectEnvironmentSecretRefs({ db, environment });
    res.json({ refs: await secrets.describeSecretRefs(refs) });
  });

  router.get("/environments/:id/leases", async (req, res) => {
    assertCanReadInstanceEnvironments(req);
    const environment = await svc.getById(req.params.id as string);
    if (!environment) {
      res.status(404).json({ error: "Environment not found" });
      return;
    }
    const leases = await svc.listLeases(environment.id, {
      status: req.query.status as string | undefined,
    });
    res.json(leases);
  });

  router.get("/environment-leases/:leaseId", async (req, res) => {
    assertCanReadInstanceEnvironments(req);
    const lease = await svc.getLeaseById(req.params.leaseId as string);
    if (!lease) {
      res.status(404).json({ error: "Environment lease not found" });
      return;
    }
    res.json(lease);
  });

  router.patch("/environments/:id", validate(updateEnvironmentSchema), async (req, res) => {
    assertCanAccessInstanceEnvironments(req);
    const existing = await svc.getById(req.params.id as string);
    if (!existing) {
      res.status(404).json({ error: "Environment not found" });
      return;
    }
    // The durable `pending_cleanup` lease row stores the provider, the provider
    // lease id, and the immutable config metadata for an orphan sandbox. The
    // teardown retry reads that row alone and never reads the current environment
    // provider. So a provider change or an environment delete after the record
    // lands cannot strand the teardown. That immutable record is the correctness
    // invariant.
    //
    // This pre-transaction check is a best-effort fast-fail only. It rejects a
    // provider change while a known `pending_cleanup` lease exists, so the
    // operator resolves the cleanup first. An orphan record that lands after this
    // check still carries its own immutable teardown context, so the
    // time-of-check-to-time-of-use window here cannot strand a sandbox.
    const changesProviderTarget =
      (req.body.driver !== undefined && req.body.driver !== existing.driver) ||
      req.body.config !== undefined;
    if (changesProviderTarget && (await svc.hasUnresolvedPendingCleanupLeases(existing.id))) {
      throw conflict(
        "Cannot change the driver or provider config while a sandbox cleanup is pending. Wait for the cleanup sweep to destroy the orphan sandbox, then retry.",
        { code: "environment_pending_sandbox_cleanup" },
      );
    }
    const actor = getActorInfo(req);
    const nextDriver = req.body.driver ?? existing.driver;
    const nextName = req.body.name ?? existing.name;
    const companyIdForSecrets =
      req.body.config !== undefined || req.body.driver !== undefined || req.body.envVars !== undefined
        ? await resolveEnvironmentSecretContextCompanyId(req, existing.id, { required: true })
        : null;
    const configSource =
      req.body.config !== undefined
        ? req.body.driver !== undefined && req.body.driver !== existing.driver
          ? req.body.config
          : {
              ...parseObject(existing.config),
              ...parseObject(req.body.config),
            }
        : req.body.driver !== undefined && req.body.driver !== existing.driver
          ? {}
          : existing.config;
    const patch = {
      ...req.body,
      ...(req.body.envVars !== undefined
        ? {
            envVars: await secrets.normalizeEnvBindingsForPersistence(
              companyIdForSecrets!,
              req.body.envVars,
              { strictMode: strictSecretsMode, fieldPath: "envVars" },
            ),
          }
        : {}),
      ...(req.body.config !== undefined || req.body.driver !== undefined
        ? {
            config: await normalizeEnvironmentConfigForPersistence({
              db,
              companyId: companyIdForSecrets!,
              environmentName: nextName,
              driver: nextDriver,
              secretProvider: getConfiguredSecretProvider(),
              config: configSource,
              actor: {
                agentId: actor.agentId,
                userId: actor.actorType === "user" ? actor.actorId : null,
              },
              pluginWorkerManager: options.pluginWorkerManager,
            }),
          }
        : {}),
    };
    // Persist the config change and its binding rows atomically: a binding
    // ref that fails validation (e.g. a deleted secret) must roll the whole
    // save back instead of leaving the config re-pointed with stale bindings.
    const environment = await db.transaction(async (tx) => {
      const updated = await svc.update(existing.id, patch, { db: tx });
      if (!updated) return null;
      if (patch.config !== undefined || patch.driver !== undefined) {
        await secrets.replaceSecretRefsForInstanceTarget(
          { targetType: "environment", targetId: updated.id },
          await collectEnvironmentSecretRefs({ db, environment: updated }),
          { db: tx },
        );
      }
      if (patch.envVars !== undefined) {
        await secrets.syncEnvBindingsForTarget(
          companyIdForSecrets!,
          { targetType: "environment", targetId: updated.id },
          updated.envVars,
          { db: tx },
        );
      }
      return updated;
    });
    if (!environment) {
      res.status(404).json({ error: "Environment not found" });
      return;
    }
    let customImageReconciliation: Awaited<
      ReturnType<typeof customImages.reconcileActiveTemplateForConfigChange>
    > = { action: "none" };
    if (patch.config !== undefined || patch.driver !== undefined) {
      try {
        customImageReconciliation = await customImages.reconcileActiveTemplateForConfigChange({
          environmentId: environment.id,
          previous: existing,
          next: environment,
        });
      } catch {
        // Reconciliation is best-effort; a failure must not fail the save.
      }
    }
    await logInstanceEnvironmentActivity({
      actor,
      action: "environment.updated",
      entityId: environment.id,
      details: summarizeEnvironmentUpdate(patch as Record<string, unknown>, environment),
    });
    const presented = presentEnvironmentForRead(req, environment);
    res.json(customImageReconciliation.action === "none"
      ? presented
      : { ...presented, customImageReconciliation });
  });

  router.delete("/environments/:id", async (req, res) => {
    assertCanAccessInstanceEnvironments(req);
    const existing = await svc.getById(req.params.id as string);
    if (!existing) {
      res.status(404).json({ error: "Environment not found" });
      return;
    }
    const actor = getActorInfo(req);
    let impact = await svc.getDeleteBlastRadius(existing.id);
    if (!impact) {
      res.status(404).json({ error: "Environment not found" });
      return;
    }
    // With explicit consent, destroy the environment's reusable sandbox leases
    // so the delete can proceed — but only while those leases are the sole
    // blocker. Destroying provider resources and then rejecting on another
    // gate would be an irreversible action with nothing gained. The destroy
    // must run before the delete: the driver needs the environment config to
    // reach the provider. A lease whose teardown fails lands in
    // `pending_cleanup`, and the re-fetched blast radius rejects below until
    // the cleanup sweep resolves it — no sandbox is ever orphaned silently.
    // A lease held by an in-flight run is skipped, keeps blocking, and the
    // re-check rejects the delete without touching that run's sandbox.
    //
    // The gate above and the destroy are not one atomic step: provider calls
    // cannot join a database transaction, so a blocker that lands in the
    // window between them (a new instance default, a fresh pending cleanup)
    // rejects the delete only after some sandboxes are already gone. Those
    // sandboxes belonged to the environment the operator consented to
    // destroy; the rejection reports the count so nothing is silent.
    let destroyedReusableSandboxLeaseCount = 0;
    if (
      req.query.destroyReusableSandboxLeases === "true"
      && impact.reusableSandboxLeaseCount > 0
      && impact.deleteBlockedReasons.every((reason) => reason === "reusable_sandbox_lease")
    ) {
      const warmSessions = await closeWarmNativeSessionsForEnvironment({
        environmentId: existing.id,
        reason: "environment deleted",
      });
      if (warmSessions.busy > 0 || warmSessions.failed > 0) {
        throw conflict(
          warmSessions.busy > 0
            ? "Cannot delete this environment while a native runner session is active. Wait for its run to finish, then retry."
            : "Cannot delete this environment because its warm native runner did not shut down cleanly. Retry after the runner exits.",
          { nativeRunnerSessions: warmSessions },
        );
      }
      const destroyResult =
        await environmentRuntime.destroyReusableSandboxLeasesForEnvironment({
          environmentId: existing.id,
          failureReason: "environment_deleted",
        });
      destroyedReusableSandboxLeaseCount = destroyResult.destroyed;
      impact = await svc.getDeleteBlastRadius(existing.id);
      if (!impact) {
        res.status(404).json({ error: "Environment not found" });
        return;
      }
    }
    if (!impact.canDelete) {
      rejectEnvironmentDelete({
        actor,
        environment: existing,
        impact,
        destroyedReusableSandboxLeaseCount,
      });
    }

    const removed = await svc.removeIfDeletable(existing.id);
    if (!removed) {
      const latestImpact = await svc.getDeleteBlastRadius(existing.id);
      if (!latestImpact) {
        res.status(404).json({ error: "Environment not found" });
        return;
      }
      rejectEnvironmentDelete({ actor, environment: existing, impact: latestImpact });
    }
    const companyIds = await instanceSettings.listCompanyIds();
    await Promise.all(
      companyIds.flatMap((companyId) => [
        executionWorkspaces.clearEnvironmentSelection(companyId, existing.id),
        issues.clearExecutionWorkspaceEnvironmentSelection(companyId, existing.id),
        projects.clearExecutionWorkspaceEnvironmentSelection(companyId, existing.id),
        secrets.syncEnvBindingsForTarget(
          companyId,
          { targetType: "environment", targetId: existing.id },
          {},
        ),
        secrets.syncSecretRefsForTarget(
          companyId,
          { targetType: "environment", targetId: existing.id },
          [],
          { replaceAll: true },
        ),
      ]),
    );
    const secretId = readSshEnvironmentPrivateKeySecretId(existing);
    if (secretId) {
      await secrets.remove(secretId);
    }
    await logInstanceEnvironmentActivity({
      actor,
      action: "environment.deleted",
      entityId: removed.id,
      details: {
        name: removed.name,
        driver: removed.driver,
        status: removed.status,
        ...(destroyedReusableSandboxLeaseCount > 0
          ? { destroyedReusableSandboxLeaseCount }
          : {}),
      },
    });
    res.json({
      ...presentEnvironmentForRead(req, removed),
      destroyedReusableSandboxLeaseCount,
    });
  });

  router.post("/environments/:id/probe", async (req, res) => {
    assertCanAccessInstanceEnvironments(req);
    const environment = await svc.getById(req.params.id as string);
    if (!environment) {
      res.status(404).json({ error: "Environment not found" });
      return;
    }
    const actor = getActorInfo(req);
    const companyIdForSecrets = await resolveEnvironmentSecretContextCompanyId(req, environment.id, { required: false });
    const companyIdForProbe = companyIdForSecrets
      ?? (environment.driver === "sandbox" ? await resolveCustomImageCompanyId(req) : null);
    if (!companyIdForSecrets) {
      const secretRefs = await collectEnvironmentSecretRefs({ db, environment });
      if (secretRefs.length > 0) {
        throw unprocessable(
          "Environment probe requires an explicit companyId to resolve secret-backed config for this environment.",
        );
      }
    }
    const probe = await probeEnvironment(db, environment, {
      companyId: companyIdForProbe,
      pluginWorkerManager: options.pluginWorkerManager,
      applyCustomImageTemplate: environment.driver === "sandbox",
      acquireSandboxRuntimeLease: environment.driver === "sandbox",
    });
    await logInstanceEnvironmentActivity({
      actor,
      action: "environment.probed",
      entityId: environment.id,
      details: {
        driver: environment.driver,
        ok: probe.ok,
        summary: probe.summary,
      },
    });
    res.json(probe);
  });

  router.post(
    "/companies/:companyId/environments/probe-config",
    validate(probeEnvironmentConfigSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCanAccessInstanceEnvironments(req);
      if (req.body.driver === "sandbox") {
        await assertCanReadSecretsForDraftProbe(req, companyId);
      }
      const actor = getActorInfo(req);
      const normalizedConfig = await normalizeEnvironmentConfigForProbe({
        db,
        companyId,
        driver: req.body.driver,
        config: req.body.config,
        accessContext: {
          actorType: actor.actorType,
          actorId: actor.actorId,
          actorSource: actor.actorSource,
          heartbeatRunId: actor.runId,
        },
        pluginWorkerManager: options.pluginWorkerManager,
      });
      const environment = {
        id: "unsaved",
        companyId,
        name: req.body.name?.trim() || "Unsaved environment",
        description: req.body.description ?? null,
        driver: req.body.driver,
        status: "active" as const,
        config: normalizedConfig,
        envVars: {},
        metadata: req.body.metadata ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const probe = await probeEnvironment(db, environment, {
        companyId,
        pluginWorkerManager: options.pluginWorkerManager,
        resolvedConfig: {
          driver: req.body.driver,
          config: normalizedConfig,
        } as ParsedEnvironmentConfig,
      });
      await logInstanceEnvironmentActivity({
        actor,
        action: "environment.probed_unsaved",
        entityId: "unsaved",
        details: {
          driver: environment.driver,
          ok: probe.ok,
          summary: probe.summary,
          configTopLevelKeyCount: Object.keys(environment.config).length,
        },
      });
      res.json(probe);
    },
  );

  return router;
}
