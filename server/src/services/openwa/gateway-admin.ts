import { eq } from "drizzle-orm";
import { chatEndpoints, type Db } from "@tickernelz/wardmote-db";
import type { OpenwaBoardGatewayOperation, OpenwaGatewayAdminResult } from "@tickernelz/wardmote-shared";
import { HttpError, badRequest, conflict, notFound, unprocessable } from "../../errors.js";
import { logOpenwaActivity, recordOpenwaAudit } from "./audit.js";
import { OPENWA_SECRET_ISSUING_OPERATIONS, OPENWA_SELF_SESSION_OPERATIONS } from "./catalog.js";
import { createOpenwaGatewayClient, openwaOperation, OpenwaGatewayError, type OpenwaCallResult, type OpenwaGatewayClient } from "./gateway.js";
import { openwaEndpointAccount } from "./linked.js";
import { redactOpenwaSecrets } from "./redact.js";
import { openwaSetupError } from "./setup.js";

type EndpointRow = typeof chatEndpoints.$inferSelect;
type Args = Record<string, unknown>;

const GATEWAY_TIMEOUT_MS = 30_000;

interface Snapshot {
  operationId: OpenwaBoardGatewayOperation;
  args(args: Args): Args;
}

const SESSION_SNAPSHOT: Snapshot = { operationId: "SessionController_findOne", args: () => ({}) };
const KEY_SNAPSHOT: Snapshot = { operationId: "AuthController_findOne", args: (args) => ({ id: args.id }) };
const WEBHOOK_SNAPSHOT: Snapshot = { operationId: "WebhookController_findOne", args: (args) => ({ id: args.id }) };
const INSTANCE_SNAPSHOT: Snapshot = {
  operationId: "IntegrationInstanceController_getOne",
  args: (args) => ({ pluginId: args.pluginId, instanceId: args.instanceId }),
};

const SNAPSHOTS: Partial<Record<OpenwaBoardGatewayOperation, Snapshot>> = {
  SessionController_start: SESSION_SNAPSHOT,
  SessionController_stop: SESSION_SNAPSHOT,
  SessionController_logout: SESSION_SNAPSHOT,
  SessionController_forceKill: SESSION_SNAPSHOT,
  SessionController_delete: SESSION_SNAPSHOT,
  SessionController_updateConfig: { operationId: "SessionController_getConfig", args: () => ({}) },
  AuthController_update: KEY_SNAPSHOT,
  AuthController_revoke: KEY_SNAPSHOT,
  AuthController_delete: KEY_SNAPSHOT,
  WebhookController_update: WEBHOOK_SNAPSHOT,
  WebhookController_delete: WEBHOOK_SNAPSHOT,
  IntegrationInstanceController_patch: INSTANCE_SNAPSHOT,
  IntegrationInstanceController_regenerate: INSTANCE_SNAPSHOT,
  IntegrationInstanceController_remove: INSTANCE_SNAPSHOT,
};

const REMOVING: Partial<Record<OpenwaBoardGatewayOperation, true>> = {
  SessionController_delete: true,
  AuthController_delete: true,
  WebhookController_delete: true,
  IntegrationInstanceController_remove: true,
};

export interface OpenwaGatewayAdminDeps {
  adminApiKey(endpoint: EndpointRow): Promise<string | null>;
  fetchImpl?: typeof fetch;
}

export interface OpenwaGatewayAdminCall {
  operationId: OpenwaBoardGatewayOperation;
  sessionId?: string;
  args: Args;
  confirmOwnSession?: boolean;
}

export interface OpenwaGatewayAdminService {
  call(endpointId: string, input: OpenwaGatewayAdminCall, actorUserId: string | null): Promise<OpenwaGatewayAdminResult>;
}

function payload(result: OpenwaCallResult): unknown {
  if (result.kind === "json" || result.kind === "text") return result.data;
  if (result.kind === "binary") {
    result.media.stream.destroy();
    return { contentType: result.media.contentType, contentLength: result.media.contentLength };
  }
  return null;
}

function httpError(error: unknown, baseUrl: string): Error {
  if (error instanceof OpenwaGatewayError) {
    if (error.code === "unauthorized" || error.code === "forbidden")
      return unprocessable("OpenWA rejected the admin key. Replace it with an active admin key in the channel's OpenWA connection.", {
        code: "openwa_admin_key_invalid",
      });
    if (error.code === "unavailable_without_admin_key")
      return unprocessable("This action needs the OpenWA admin key. Add an admin API key to this channel's OpenWA connection.", {
        code: "openwa_admin_key_required",
      });
    if (error.code === "bad_request") return badRequest(error.message, { code: "openwa_bad_request" });
    if (error.code === "not_found") return notFound(error.message);
    if (error.code === "conflict") return conflict(error.message, { code: "openwa_conflict" });
  }
  return openwaSetupError(error, baseUrl);
}

/** Board-only OpenWA gateway administration: sessions, API keys, webhooks and integration instances, audited before and after. */
export function openwaGatewayAdminService(db: Db, deps: OpenwaGatewayAdminDeps): OpenwaGatewayAdminService {
  async function endpointFor(endpointId: string): Promise<EndpointRow> {
    const [endpoint] = await db.select().from(chatEndpoints).where(eq(chatEndpoints.id, endpointId));
    if (!endpoint) throw notFound("Chat endpoint not found");
    if (endpoint.provider !== "openwa") throw badRequest("This action is only valid for OpenWA endpoints");
    if (endpoint.status === "archived") throw conflict("This channel was removed");
    return endpoint;
  }

  async function clientFor(endpoint: EndpointRow, sessionId: string): Promise<{ client: OpenwaGatewayClient; baseUrl: string }> {
    const { baseUrl } = openwaEndpointAccount(endpoint);
    if (!baseUrl) throw unprocessable("Connect the OpenWA gateway first", { code: "openwa_session_required" });
    const adminApiKey = await deps.adminApiKey(endpoint);
    if (!adminApiKey)
      throw unprocessable("Managing OpenWA sessions needs the OpenWA admin key. Add an admin API key to this channel's OpenWA connection.", {
        code: "openwa_admin_key_required",
      });
    const client = createOpenwaGatewayClient({
      baseUrl,
      apiKey: adminApiKey,
      adminApiKey,
      sessionId,
      timeoutMs: GATEWAY_TIMEOUT_MS,
      fetchImpl: deps.fetchImpl,
    });
    return { client, baseUrl };
  }

  async function snapshot(client: OpenwaGatewayClient, operationId: OpenwaBoardGatewayOperation, args: Args): Promise<unknown> {
    const read = SNAPSHOTS[operationId];
    if (!read) return null;
    return client
      .call(read.operationId, read.args(args), { useAdminKey: true })
      .then(payload)
      .catch((error: unknown) => (error instanceof OpenwaGatewayError && error.code === "not_found" ? null : { unavailable: true }));
  }

  async function audit(
    endpoint: EndpointRow,
    input: OpenwaGatewayAdminCall,
    sessionId: string | null,
    actorUserId: string | null,
    outcome: { ok: true; before: unknown; after: unknown } | { ok: false; before: unknown; errorCode: string },
  ): Promise<void> {
    await db.transaction(async (tx) => {
      await recordOpenwaAudit(tx, {
        companyId: endpoint.companyId,
        endpointId: endpoint.id,
        kind: "config_changed",
        actorKind: "user",
        actorRef: actorUserId,
        metadata: {
          source: "board_gateway_admin",
          operation: input.operationId,
          sessionId,
          outcome: outcome.ok ? "ok" : "failed",
          ...(outcome.ok ? {} : { errorCode: outcome.errorCode }),
        },
        content: redactOpenwaSecrets({
          args: input.args,
          before: outcome.before,
          ...(outcome.ok ? { after: outcome.after } : {}),
        }),
      });
      await logOpenwaActivity(tx, {
        companyId: endpoint.companyId,
        endpointId: endpoint.id,
        action: "openwa.gateway_admin_called",
        actorUserId,
        details: { operationId: input.operationId, sessionId, outcome: outcome.ok ? "ok" : "failed", source: "board" },
      });
    });
  }

  function result(input: OpenwaGatewayAdminCall, sessionId: string | null, data: unknown): OpenwaGatewayAdminResult {
    const revealed = OPENWA_SECRET_ISSUING_OPERATIONS.has(input.operationId);
    return { operationId: input.operationId, sessionId, data: revealed ? data : redactOpenwaSecrets(data), revealed };
  }

  async function call(endpointId: string, input: OpenwaGatewayAdminCall, actorUserId: string | null): Promise<OpenwaGatewayAdminResult> {
    const endpoint = await endpointFor(endpointId);
    const operation = openwaOperation(input.operationId);
    if (!operation) throw badRequest("Unknown OpenWA operation");
    const own = openwaEndpointAccount(endpoint).sessionId;
    const sessionId = operation.sessionScoped ? (input.sessionId ?? null) : null;
    if (operation.sessionScoped && !sessionId) throw badRequest("Choose the OpenWA session for this action", { code: "openwa_session_id_required" });
    if (sessionId && sessionId === own && OPENWA_SELF_SESSION_OPERATIONS.has(operation.id) && input.confirmOwnSession !== true)
      throw conflict("This is the session the agent uses on this channel. Confirm that you want to change it.", {
        code: "openwa_own_session_confirmation_required",
      });
    const { client, baseUrl } = await clientFor(endpoint, sessionId ?? own);
    if (operation.method === "GET") {
      const data = await client
        .call(operation.id, input.args, { useAdminKey: true })
        .then(payload)
        .catch((error: unknown) => {
          throw httpError(error, baseUrl);
        });
      return result(input, sessionId, data);
    }
    const before = await snapshot(client, input.operationId, input.args);
    let data: unknown;
    try {
      data = payload(await client.call(operation.id, input.args, { useAdminKey: true }));
    } catch (error) {
      const mapped = httpError(error, baseUrl);
      const errorCode = error instanceof OpenwaGatewayError ? error.code : mapped instanceof HttpError ? "http_" + mapped.status : "internal_error";
      await audit(endpoint, input, sessionId, actorUserId, { ok: false, before, errorCode });
      throw mapped;
    }
    const after = REMOVING[input.operationId]
      ? null
      : OPENWA_SECRET_ISSUING_OPERATIONS.has(input.operationId)
        ? { revealedOnce: true }
        : SNAPSHOTS[input.operationId]
          ? await snapshot(client, input.operationId, input.args)
          : data;
    await audit(endpoint, input, sessionId, actorUserId, { ok: true, before, after });
    return result(input, sessionId, data);
  }

  return { call };
}
