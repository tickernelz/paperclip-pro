import { z } from "zod";
import {
  CHAT_AUDIT_ACTOR_KINDS,
  CHAT_AUDIT_ENTRY_KINDS,
  type OpenwaGatewayAdminToolLevel,
} from "@tickernelz/paperclip-pro-shared";
import {
  OPENWA_GATEWAY_VERSION,
  OPENWA_OPERATIONS,
  type OpenwaEngine,
  type OpenwaJsonSchema,
  type OpenwaOperation,
  type OpenwaOperationCategory,
} from "@tickernelz/paperclip-pro-shared/openwa-operations";

export const OPENWA_AUDIT_LIST_OPERATION = "paperclip.audit.list";
export const OPENWA_SELF_SESSION_OPERATIONS: ReadonlySet<string> = new Set([
  "SessionController_logout",
  "SessionController_stop",
  "SessionController_delete",
  "SessionController_forceKill",
]);
export const OPENWA_SECRET_ISSUING_OPERATIONS: ReadonlySet<string> = new Set([
  "AuthController_create",
  "IntegrationInstanceController_create",
  "IntegrationInstanceController_regenerate",
  "SessionController_requestPairingCode",
  "SessionController_getQRCode",
]);
const LIST_SESSIONS_OPERATION = "SessionController_findAll";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ENGINES: readonly OpenwaEngine[] = ["whatsapp-web.js", "baileys"];
const LEARNED_LIMIT = 4096;
const SUMMARY_LIMIT = 120;

export type OpenwaCatalogCategory = OpenwaOperationCategory | "paperclip";
export type OpenwaUnavailableReason = "secret_issuing_operation" | "unavailable_on_engine" | "unavailable_without_admin_key";
export type OpenwaOperationGate =
  | "none"
  | "reply_or_cross_chat_send"
  | "cross_chat_send"
  | "wa_admin"
  | "gateway_admin"
  | "owner_confirmation"
  | "owner_only";

export interface OpenwaCatalogScope {
  engine: OpenwaEngine | null;
  engineKey: string;
  hasAdminKey: boolean;
  operatorKeyIsAdmin: boolean;
  gatewayAdminTools: OpenwaGatewayAdminToolLevel;
}

export interface OpenwaEffectiveOperation {
  operation: OpenwaOperation;
  category: OpenwaOperationCategory;
  useAdminKey: boolean;
  instanceGlobal: boolean;
  gate: OpenwaOperationGate;
}

export interface OpenwaCatalogEntry {
  operation: string;
  category: OpenwaCatalogCategory;
  summary: string;
  available: boolean;
  reason?: OpenwaUnavailableReason;
  gate: OpenwaOperationGate;
  instanceGlobal?: true;
}

export const openwaAuditListArgsSchema = z
  .object({
    kinds: z.array(z.enum(CHAT_AUDIT_ENTRY_KINDS)).min(1).max(CHAT_AUDIT_ENTRY_KINDS.length).optional(),
    chat: z.string().min(3).max(200).optional(),
    actorKind: z.enum(CHAT_AUDIT_ACTOR_KINDS).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

const { $schema: _auditSchemaDialect, ...auditListArgs } = z.toJSONSchema(openwaAuditListArgsSchema, { io: "input" }) as Record<string, unknown>;

const operationsById: ReadonlyMap<string, OpenwaOperation> = new Map(OPENWA_OPERATIONS.map((operation) => [operation.id, operation]));
const learnedUnavailable = new Set<string>();

export function openwaCatalogOperation(id: string): OpenwaOperation | undefined {
  return operationsById.get(id);
}

export function openwaEngine(value: unknown): OpenwaEngine | null {
  return ENGINES.includes(value as OpenwaEngine) ? (value as OpenwaEngine) : null;
}

function learnedKey(scope: Pick<OpenwaCatalogScope, "engineKey">, operationId: string): string {
  return OPENWA_GATEWAY_VERSION + "|" + scope.engineKey + "|" + operationId;
}

/** Records a 501 for (version, engine): the operation is never sent to that engine again in this process. */
export function learnOpenwaOperationUnavailable(scope: Pick<OpenwaCatalogScope, "engineKey">, operationId: string): void {
  const key = learnedKey(scope, operationId);
  learnedUnavailable.delete(key);
  learnedUnavailable.add(key);
  if (learnedUnavailable.size > LEARNED_LIMIT) learnedUnavailable.delete(learnedUnavailable.values().next().value!);
}

/** Category, credential and gate an operation takes for this endpoint; listing sessions becomes instance-global admin with an admin key at full. */
export function openwaEffectiveOperation(operation: OpenwaOperation, scope: OpenwaCatalogScope): OpenwaEffectiveOperation {
  if (operation.id === LIST_SESSIONS_OPERATION && scope.gatewayAdminTools === "full" && scope.hasAdminKey)
    return { operation, category: "gateway_admin", useAdminKey: true, instanceGlobal: true, gate: "gateway_admin" };
  const instanceGlobal = operation.category === "gateway_admin" && !operation.sessionScoped && operation.sessionParam === null;
  const gate: OpenwaOperationGate =
    operation.category === "read"
      ? "none"
      : operation.category === "write"
        ? operation.targetChatArg
          ? "reply_or_cross_chat_send"
          : "cross_chat_send"
        : operation.category === "wa_admin"
          ? "wa_admin"
          : OPENWA_SELF_SESSION_OPERATIONS.has(operation.id)
            ? "owner_confirmation"
            : "gateway_admin";
  return { operation, category: operation.category, useAdminKey: false, instanceGlobal, gate };
}

/** True when the call changes state and therefore runs through a durable receipt with an idempotency key. */
export function openwaOperationMutating(effective: OpenwaEffectiveOperation): boolean {
  return effective.category !== "read" && !SAFE_METHODS.has(effective.operation.method);
}

export function openwaOperationVisible(effective: OpenwaEffectiveOperation, scope: OpenwaCatalogScope): boolean {
  if (effective.category !== "gateway_admin") return true;
  if (scope.gatewayAdminTools === "off") return false;
  return scope.gatewayAdminTools === "full" || SAFE_METHODS.has(effective.operation.method);
}

/** Static engine matrix, the 501 learning cache and the configured keys; null when the operation can be sent. */
export function openwaOperationUnavailable(effective: OpenwaEffectiveOperation, scope: OpenwaCatalogScope): OpenwaUnavailableReason | null {
  const { operation } = effective;
  if (OPENWA_SECRET_ISSUING_OPERATIONS.has(operation.id)) return "secret_issuing_operation";
  if (scope.engine && !operation.engines.includes(scope.engine)) return "unavailable_on_engine";
  if (learnedUnavailable.has(learnedKey(scope, operation.id))) return "unavailable_on_engine";
  if (operation.auth !== "api_key" || scope.hasAdminKey) return null;
  if (operation.requiresUnscopedKey) return "unavailable_without_admin_key";
  if (operation.requiredRole === "admin" && !scope.operatorKeyIsAdmin) return "unavailable_without_admin_key";
  return null;
}

function clipSummary(summary: string): string {
  return summary.length > SUMMARY_LIMIT ? summary.slice(0, SUMMARY_LIMIT - 1) + "…" : summary;
}

function auditEntry(): OpenwaCatalogEntry {
  return {
    operation: OPENWA_AUDIT_LIST_OPERATION,
    category: "paperclip",
    summary: "List this endpoint's audit entries, newest first (owner runs only)",
    available: true,
    gate: "owner_only",
  };
}

export function openwaCatalog(
  scope: OpenwaCatalogScope,
  filter: { category?: OpenwaCatalogCategory; query?: string } = {},
): OpenwaCatalogEntry[] {
  const needle = filter.query?.trim().toLowerCase() || null;
  const matches = (...values: string[]) => !needle || values.some((value) => value.toLowerCase().includes(needle));
  const entries: OpenwaCatalogEntry[] = [];
  for (const operation of OPENWA_OPERATIONS) {
    const effective = openwaEffectiveOperation(operation, scope);
    if (!openwaOperationVisible(effective, scope)) continue;
    if (filter.category && filter.category !== effective.category) continue;
    if (!matches(operation.id, operation.summary, operation.tag)) continue;
    const reason = openwaOperationUnavailable(effective, scope);
    entries.push({
      operation: operation.id,
      category: effective.category,
      summary: clipSummary(operation.summary),
      available: reason === null,
      ...(reason ? { reason } : {}),
      gate: effective.gate,
      ...(effective.instanceGlobal ? { instanceGlobal: true as const } : {}),
    });
  }
  const audit = auditEntry();
  if ((!filter.category || filter.category === "paperclip") && matches(audit.operation, audit.summary, "audit")) entries.push(audit);
  return entries;
}

export interface OpenwaOperationDescription extends OpenwaCatalogEntry {
  method?: string;
  requiresIdempotencyKey: boolean;
  args: OpenwaJsonSchema | Record<string, unknown>;
}

export function openwaDescribe(scope: OpenwaCatalogScope, operationId: string): OpenwaOperationDescription | null {
  if (operationId === OPENWA_AUDIT_LIST_OPERATION) return { ...auditEntry(), requiresIdempotencyKey: false, args: auditListArgs };
  const operation = operationsById.get(operationId);
  if (!operation) return null;
  const effective = openwaEffectiveOperation(operation, scope);
  if (!openwaOperationVisible(effective, scope)) return null;
  const reason = openwaOperationUnavailable(effective, scope);
  return {
    operation: operation.id,
    category: effective.category,
    summary: operation.summary,
    available: reason === null,
    ...(reason ? { reason } : {}),
    gate: effective.gate,
    ...(effective.instanceGlobal ? { instanceGlobal: true as const } : {}),
    method: operation.method,
    requiresIdempotencyKey: openwaOperationMutating(effective),
    args: operation.args,
  };
}
