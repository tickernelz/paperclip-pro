import { experimentalApiMetadata } from "./experimental-api-metadata.js";
import { attachmentRetentionPreviewSchema } from "./instance-attachment-retention.js";
import {
  experimentalApiPaths,
  experimentalApiQueries,
} from "./experimental-api-paths.js";
import { Router } from "express";
import { z } from "zod";
import {
  createAiConnectionSchema,
  ENVIRONMENT_DRIVERS,
  ENVIRONMENT_LEASE_STATUSES,
  ENVIRONMENT_STATUSES,
  FEEDBACK_TARGET_TYPES,
  FEEDBACK_TRACE_STATUSES,
  FEEDBACK_VOTE_VALUES,
  PLUGIN_JOB_STATUSES,
  PLUGIN_STATUSES,
  TOOL_ACTION_REQUEST_STATUSES,
  catalogSkillListQuerySchema,
  catalogTeamListQuerySchema,
  aiConnectionPoolConfigSchema,
  aiConnectionLoginIntentSchema,
  localAiConnectionSchema,
  localAiLoginStartSchema,
  emailEndpointSetupSchema,
  emailConnectionSchema,
  emailAddressCheckSchema,
  emailSendSchema,
  browserUseControlSchema,
  browserUseSettingsSchema,
  browserUseViewportSchema,
  browserUseViewerSchema,
  slackToolCallSchema,
  openwaToolCallSchema,
  slackSearchConfigSchema,
  // Agent
  AGENT_PALETTE_IDS,
  AGENT_AVATAR_SIZES,
  CHARACTER_STATES,
  agentAppearanceSchema,
  createAgentSchema,
  createAgentHireSchema,
  updateAgentSchema,
  updateAgentPermissionsSchema,
  agentAdapterConfigBatchPreviewSchema,
  agentAdapterConfigBatchUpdateSchema,
  updateAgentInstructionsPathSchema,
  updateAgentInstructionsBundleSchema,
  upsertAgentInstructionsFileSchema,
  restoreAgentInstructionSchema,
  resolveAgentInstructionCandidateSchema,
  createAgentKeySchema,
  builtInAgentEmptyMutationSchema,
  builtInAgentProvisionSchema,
  generateSummarySlotSchema,
  writeSummarySlotSchema,
  createStatusCardSchema,
  patchStatusCardSchema,
  refreshStatusCardSchema,
  writeStatusCardQuerySchema,
  writeStatusCardSummarySchema,
  wakeAgentSchema,
  resetAgentSessionSchema,
  agentSkillSyncSchema,
  testAdapterEnvironmentSchema,
  agentMineInboxQuerySchema,
  // Issue
  createIssueSchema,
  setIssueTitleSchema,
  updateIssueSchema,
  stalledReviewDecisionSchema,
  createIssueLabelSchema,
  issueCountQuerySchema,
  addIssueCommentSchema,
  checkoutIssueSchema,
  linkIssueApprovalSchema,
  createIssueWorkProductSchema,
  updateIssueCommentPublicShareSchema,
  updateIssueWorkProductSchema,
  upsertIssueDocumentSchema,
  restoreIssueDocumentRevisionSchema,
  upsertIssueFeedbackVoteSchema,
  upsertIssueWatchdogSchema,
  runnerGoalActionRequestSchema,
  issueRunModelOverrideUpdateSchema,
  // Project
  createProjectSchema,
  updateProjectSchema,
  createProjectWorkspaceSchema,
  updateProjectWorkspaceSchema,
  // Company
  createCompanySchema,
  updateCompanySchema,
  updateCompanyBrandingSchema,
  companyArtifactsQuerySchema,
  companyArtifactsResponseSchema,
  companySearchExtractQuerySchema,
  // Decisions
  addDecisionQueueItemSchema,
  createDecisionQueueSchema,
  createDecisionArchiveProposalSchema,
  decisionAttentionSourceKindSchema,
  decisionInputsSchema,
  decisionOptionsSchema,
  removeDecisionQueueItemSchema,
  updateDecisionQueueSchema,
  updateDecisionTriageSchema,
  updateDecisionRetentionSchema,
  // Routine
  createRoutineSchema,
  updateRoutineSchema,
  createRoutineTriggerSchema,
  updateRoutineTriggerSchema,
  rotateRoutineTriggerSecretSchema,
  runRoutineSchema,
  // Folders
  createFolderSchema,
  ensureMySkillFolderSchema,
  folderKindSchema,
  moveFolderItemSchema,
  moveFolderSchema,
  updateFolderSchema,
  // Goal
  createGoalSchema,
  openIssueAutonomyWindowSchema,
  updateGoalSchema,
  // Secret
  createSecretSchema,
  updateSecretSchema,
  rotateSecretSchema,
  rotateUserSecretValueSchema,
  createUserSecretDefinitionSchema,
  updateUserSecretDefinitionSchema,
  createUserSecretValueSchema,
  updateUserSecretValueSchema,
  // Approval
  createApprovalSchema,
  resolveApprovalSchema,
  requestApprovalRevisionSchema,
  resubmitApprovalSchema,
  addApprovalCommentSchema,
  // Cost / budget
  createCostEventSchema,
  createFinanceEventSchema,
  updateBudgetSchema,
  upsertBudgetPolicySchema,
  resolveBudgetIncidentSchema,
  // Sidebar
  upsertSidebarOrderPreferenceSchema,
  upsertWebPushSubscriptionSchema,
  deleteWebPushSubscriptionSchema,
  // Announcements
  announcementIdSchema,
  announcementSchema,
  dismissAnnouncementSchema,
  // Execution workspaces
  reconcileExecutionWorkspaceBranchSchema,
  updateExecutionWorkspaceSchema,
  workspaceOverviewQuerySchema,
  workspaceRuntimeControlTargetSchema,
  // Environments
  createEnvironmentSchema,
  cancelEnvironmentCustomImageSetupSessionSchema,
  createEnvironmentCustomImageTerminalSessionTokenSchema,
  environmentCustomImageSetupSessionSchema,
  environmentCustomImageTerminalSessionTokenSchema,
  environmentCustomImageTemplateSchema,
  finishEnvironmentCustomImageSetupSessionSchema,
  relinkEnvironmentCustomImageTemplateSchema,
  updateEnvironmentSchema,
  probeEnvironmentConfigSchema,
  startEnvironmentCustomImageSetupSessionSchema,
  // Company skills
  skillSourceDiscoverySchema,
  skillSourcePreviewSchema,
  skillSourceCreateSchema,
  skillSourceSelectionSchema,
  companySkillCreateSchema,
  companySkillFileDeleteSchema,
  companySkillFileUpdateSchema,
  companySkillImportSchema,
  companySkillProjectBrowseRequestSchema,
  companySkillProjectBrowseResultSchema,
  companySkillProjectScanRequestSchema,
  companySkillProjectScanResultSchema,
  companySkillRenameResultSchema,
  companySkillRenameSchema,
  companySkillTestInputCreateSchema,
  companySkillTestInputUpdateSchema,
  companySkillTestRunCreateSchema,
  companySkillTestRunListQuerySchema,
  companySkillTestRunTemplateCreateSchema,
  companySkillTestRunTemplateUpdateSchema,
  evaluateSkillPolicySchema,
  replaceSkillPolicySchema,
  updateInboxAgentPolicySchema,
  // Issue tree
  createIssueTreeHoldSchema,
  previewIssueTreeControlSchema,
  releaseIssueTreeHoldSchema,
  // Issue interactions
  createIssueThreadInteractionSchema,
  createChildIssueSchema,
  acceptIssueThreadInteractionSchema,
  resolveConfirmationFromCommentSchema,
  rejectIssueThreadInteractionSchema,
  respondIssueThreadInteractionSchema,
  skipIssueThreadInteractionSchema,
  submitIssueThreadInteractionVerdictsSchema,
  withdrawIssueThreadInteractionSchema,
  // Auth / profile
  updateCurrentUserProfileSchema,
  // Company portability (legacy routes)
  companyPortabilityExportSchema,
  companyPortabilityPreviewSchema,
  companyPortabilityImportSchema,
  // Access / membership
  acceptInviteSchema,
  createCompanyInviteSchema,
  createOpenClawInvitePromptSchema,
  claimJoinRequestApiKeySchema,
  createCliAuthChallengeSchema,
  resolveCliAuthChallengeSchema,
  createBoardApiKeySchema,
  updateCompanyMemberSchema,
  updateCompanyMemberWithPermissionsSchema,
  archiveCompanyMemberSchema,
  updateMemberPermissionsSchema,
  updateUserCompanyAccessSchema,
  // Instance settings
  patchInstanceGeneralSettingsSchema,
  patchInstanceExperimentalSettingsSchema,
  patchInstanceSettingsSchema,
  startTaskDrainRequestSchema,
  // Resource memberships
  updateDocumentResourceMembershipSchema,
  updateResourceMembershipSchema,
  // Document annotations
  createDocumentAnnotationCommentSchema,
  createDocumentAnnotationThreadSchema,
  updateDocumentAnnotationThreadSchema,
  // Issue recovery and decomposition
  createAcceptedPlanDecompositionSchema,
  resolveIssueRecoveryActionSchema,
  retryWorkspaceExportSchema,
  cancelIssueThreadInteractionSchema,
  // Secret provider configs and remote import
  createSecretProviderConfigSchema,
  updateSecretProviderConfigSchema,
  secretProviderConfigDiscoveryPreviewSchema,
  remoteSecretImportPreviewSchema,
  remoteSecretImportSchema,
  workspaceFileAvailabilityRequestSchema,
  workspaceFileAvailabilityResponseSchema,
  workspaceFileListQuerySchema,
  workspaceFileResourceQuerySchema,
  // Tool access
  connectToolAppSchema,
  configureRailwaySshSchema,
  createToolApplicationSchema,
  updateToolApplicationSchema,
  createToolConnectionSchema,
  createConnectionGrantDelegationSchema,
  connectionTokenRequestSchema,
  startConnectionAuthorizationSchema,
  createToolStdioCommandTemplateSchema,
  disableToolStdioCommandTemplateSchema,
  finalizeOAuthAccessSchema,
  finishToolAppSchema,
  reconnectToolAppSchema,
  startToolOAuthSchema,
  updateToolConnectionSchema,
  putToolConnectionInstallsSchema,
  toolConnectionTestCallSchema,
  createToolPolicySchema,
  duplicateToolPolicySchema,
  createToolProfileBindingForProfileSchema,
  createToolProfileEntryForProfileSchema,
  createToolProfileWithEntriesSchema,
  deleteToolProfileSchema,
  duplicateToolProfileSchema,
  reorderToolPoliciesSchema,
  reviewToolProfileNewToolsSchema,
  updateToolPolicySchema,
  updateToolProfileEntrySchema,
  updateToolProfileWithEntriesSchema,
  createToolTrustRuleFromActionRequestSchema,
  revokeToolTrustRuleSchema,
  unbindToolProfileBindingSchema,
  importMcpJsonSchema,
  toolPolicyTestRequestSchema,
  createToolMcpGatewaySchema,
  completeConnectionIntentSchema,
  connectionRequestInputSchema,
  connectionsSearchInputSchema,
  declineConnectionIntentSchema,
  startClaudeSetupTokenSessionRequestSchema,
  submitBrowserCodeRequestSchema,
  claudeSetupTokenSessionResponseSchema,
  claudeSetupTokenSessionPromptSchema,
  claudeSetupTokenSessionOwnerResponseSchema,
  claudeSetupTokenCompletionResponseSchema,
  claudeOAuthTokenStatusResponseSchema,
  startAdapterAuthSessionRequestSchema,
  // Chat channels
  githubChatConfigurationSchema,
  githubReviewAssessmentSchema,
  updateGitHubChatConfigurationSchema,
  chatDeliveryStateSchema,
  chatEndpointStatusSchema,
  chatIdentityLinkStatusSchema,
  chatProviderSchema,
  CHAT_FILE_TRANSFER_PHASES,
  chatPublicationStateSchema,
  chatResourceAvailabilitySchema,
  configureChatEndpointSchema,
  confirmChatIdentityLinkSchema,
  createChatEndpointSchema,
  createChatIdentityLinkIntentSchema,
  inspectPhotonProjectSchema,
  inspectOpenwaGatewaySchema,
  CHAT_AUDIT_ACTOR_KINDS,
  CHAT_AUDIT_ENTRY_KINDS,
  addOpenwaOwnerSchema,
  createOpenwaSenderRuleSchema,
  linkOpenwaSessionSchema,
  updateOpenwaLinkedChatsSchema,
  updateOpenwaChatSettingsSchema,
  updateOpenwaEndpointPolicySchema,
  listOpenwaApprovalsQuerySchema,
  resolveOpenwaApprovalSchema,
  openwaChatSettingsSchema,
  chatInflightModeSchema,
  openwaGatewayAdminToolLevelSchema,
  openwaNumberModeSchema,
  openwaReplyPolicySchema,
  openwaSenderPolicyModeSchema,
  photonProjectIdSchema,
  photonLineIdSchema,
  publishChatPublicationSchema,
  resolveChatActionSchema,
  resolveChatPublicationSchema,
  replaceChatEndpointResourcesSchema,
  updateChatEndpointSchema,
  pixelsOfficeSeatAssignmentsSchema,
} from "@tickernelz/paperclip-pro-shared";
import { aggregatorAppsSyncSchema, aggregatorAppsRefreshSchema, arcadeDiscoverySetupSchema } from "@tickernelz/paperclip-pro-shared/aggregator-apps";
import { composioAppsSyncSchema, composioAppsRefreshSchema, composioAppSetupSchema, composioAppAccountSchema } from "@tickernelz/paperclip-pro-shared/composio-app-setup";
import {
  COMPANY_IMPORT_TRANSFERS_API_PATH,
  companyImportTransferDeclarationSchema,
} from "@tickernelz/paperclip-pro-shared/company-import-transfer";

type JsonSchema = Record<string, unknown>;
type OpenApiResponse = Record<string, unknown>;
type OpenApiPathRegistration = {
  method: string;
  path: string;
  request?: {
    params?: z.ZodTypeAny;
    query?: z.ZodTypeAny;
    body?: {
      content: Record<string, { schema: unknown }>;
      required?: boolean;
    };
  };
  responses?: Record<string, OpenApiResponse>;
  [key: string]: unknown;
};

// Zod 4 stores each schema definition on `_def` with a lowercase `type`
// discriminator and moves the wrapped members onto that def. This loose view
// lets the converter read those members, because Zod 4 does not export a
// public type for every internal def shape.
type ZodDefAny = Record<string, unknown> & { type: string };

const zodDef = (schema: z.ZodTypeAny): ZodDefAny =>
  schema._def as unknown as ZodDefAny;
const zodTypeName = (schema: z.ZodTypeAny): string => zodDef(schema).type;

function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  const def = zodDef(schema);
  if (
    def.type === "optional" ||
    def.type === "default" ||
    def.type === "catch"
  ) {
    return unwrapSchema(def.innerType as z.ZodTypeAny);
  }
  // A `.transform()` or `.pipe()` becomes a pipe. Read the input schema so the
  // published contract describes the value a client sends.
  if (def.type === "pipe") {
    return unwrapSchema(def.in as z.ZodTypeAny);
  }
  return schema;
}

function isOptionalSchema(schema: z.ZodTypeAny): boolean {
  const def = zodDef(schema);
  if (
    def.type === "optional" ||
    def.type === "default" ||
    def.type === "catch"
  ) {
    return true;
  }
  if (def.type === "pipe") {
    return isOptionalSchema(def.in as z.ZodTypeAny);
  }
  if (def.type === "nullable") {
    return isOptionalSchema(def.innerType as z.ZodTypeAny);
  }
  return false;
}

// Zod 4 stores each check as an object with a `_zod.def` that carries a `check`
// name and the check members. Read that def to describe the constraint.
function checkDef(check: unknown): Record<string, unknown> | undefined {
  return (check as { _zod?: { def?: Record<string, unknown> } })._zod?.def;
}

function applyStringChecks(
  jsonSchema: JsonSchema,
  checks: ReadonlyArray<unknown>,
) {
  for (const check of checks) {
    const def = checkDef(check);
    if (!def) continue;
    if (def.check === "min_length") jsonSchema.minLength = def.minimum;
    else if (def.check === "max_length") jsonSchema.maxLength = def.maximum;
    else if (def.check === "string_format") {
      if (def.format === "email") jsonSchema.format = "email";
      else if (def.format === "url") jsonSchema.format = "uri";
      // Zod 3 `.uuid()` maps to `.guid()` in zod 4 to keep the loose UUID
      // format. Publish both as the OpenAPI `uuid` format so the spec does not
      // change.
      else if (def.format === "uuid" || def.format === "guid")
        jsonSchema.format = "uuid";
      else if (def.format === "datetime") jsonSchema.format = "date-time";
      // Zod 4 stores a `.regex()` pattern as a `RegExp`; publish its source.
      else if (def.format === "regex") {
        if (def.pattern instanceof RegExp)
          jsonSchema.pattern = def.pattern.source;
        else if (typeof def.pattern === "string")
          jsonSchema.pattern = def.pattern;
      }
    }
  }
}

function applyNumberChecks(
  jsonSchema: JsonSchema,
  checks: ReadonlyArray<unknown>,
) {
  for (const check of checks) {
    const def = checkDef(check);
    if (!def) continue;
    // `.int()` records a number-format check such as `safeint`.
    if (def.check === "number_format") {
      if (typeof def.format === "string" && def.format.includes("int")) {
        jsonSchema.type = "integer";
      }
    } else if (def.check === "greater_than") {
      jsonSchema.minimum = def.value;
      if (!def.inclusive) jsonSchema.exclusiveMinimum = true;
    } else if (def.check === "less_than") {
      jsonSchema.maximum = def.value;
      if (!def.inclusive) jsonSchema.exclusiveMaximum = true;
    }
  }
}

function zodToOpenApiSchema(schema: z.ZodTypeAny): JsonSchema {
  const unwrapped = unwrapSchema(schema);
  const def = zodDef(unwrapped);
  const typeName = def.type;

  if (typeName === "string") {
    const jsonSchema: JsonSchema = { type: "string" };
    applyStringChecks(jsonSchema, (def.checks as unknown[]) ?? []);
    return jsonSchema;
  }

  if (typeName === "number") {
    const jsonSchema: JsonSchema = { type: "number" };
    applyNumberChecks(jsonSchema, (def.checks as unknown[]) ?? []);
    return jsonSchema;
  }

  if (typeName === "boolean") return { type: "boolean" };
  if (typeName === "date") return { type: "string", format: "date-time" };
  if (typeName === "any" || typeName === "unknown") return {};

  if (typeName === "literal") {
    const values = def.values as unknown[];
    return { type: typeof values[0], enum: values };
  }

  // Zod 4 merges string enums and native enums into one `enum` type and stores
  // the members on `entries`. A pure string enum keeps `type: "string"`; a
  // native enum can hold numbers, so it publishes the values without a type.
  if (typeName === "enum") {
    const values = Array.from(
      new Set(
        Object.values(def.entries as Record<string, unknown>).filter(
          (value) => typeof value === "string" || typeof value === "number",
        ),
      ),
    );
    if (values.every((value) => typeof value === "string")) {
      return { type: "string", enum: values };
    }
    return { enum: values };
  }

  if (typeName === "array") {
    return {
      type: "array",
      items: zodToOpenApiSchema(def.element as z.ZodTypeAny),
    };
  }

  if (typeName === "record") {
    return {
      type: "object",
      additionalProperties: zodToOpenApiSchema(def.valueType as z.ZodTypeAny),
    };
  }

  if (typeName === "nullable") {
    return {
      ...zodToOpenApiSchema(def.innerType as z.ZodTypeAny),
      nullable: true,
    };
  }

  // Zod 4 represents a plain union and a discriminated union as one `union`
  // type with the members on `options`.
  if (typeName === "union") {
    return {
      oneOf: (def.options as z.ZodTypeAny[]).map((option) =>
        zodToOpenApiSchema(option),
      ),
    };
  }

  if (typeName === "intersection") {
    return {
      allOf: [
        zodToOpenApiSchema(def.left as z.ZodTypeAny),
        zodToOpenApiSchema(def.right as z.ZodTypeAny),
      ],
    };
  }

  if (typeName === "object") {
    const shape = def.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToOpenApiSchema(value);
      if (!isOptionalSchema(value)) required.push(key);
    }
    const jsonSchema: JsonSchema = { type: "object", properties };
    if (required.length > 0) jsonSchema.required = required;
    // A `.strict()` Zod object forbids an unknown key. Zod 4 records that as a
    // `never` catchall. Publish the constraint as `additionalProperties: false`,
    // so a client, a gateway, or a handler that treats the contract as
    // authoritative rejects an extra property too.
    const catchall = def.catchall as z.ZodTypeAny | undefined;
    if (catchall && zodDef(catchall).type === "never") {
      jsonSchema.additionalProperties = false;
    }
    return jsonSchema;
  }

  return {};
}

function normalizeContent(content: Record<string, { schema: unknown }>) {
  return Object.fromEntries(
    Object.entries(content).map(([contentType, media]) => [
      contentType,
      {
        ...media,
        schema: isZodSchema(media.schema)
          ? zodToOpenApiSchema(media.schema)
          : media.schema,
      },
    ]),
  );
}

function isZodSchema(value: unknown): value is z.ZodTypeAny {
  return Boolean(
    value &&
    typeof value === "object" &&
    "_def" in value &&
    typeof (value as z.ZodTypeAny).safeParse === "function",
  );
}

function normalizeResponses(responses: Record<string, OpenApiResponse> = {}) {
  return Object.fromEntries(
    Object.entries(responses).map(([status, response]) => {
      const content = response.content as
        Record<string, { schema: unknown }> | undefined;
      return [
        status,
        content
          ? {
              ...response,
              content: normalizeContent(content),
            }
          : response,
      ];
    }),
  );
}

function parametersFromSchema(
  schema: z.ZodTypeAny,
  location: "path" | "query",
) {
  const objectSchema = unwrapSchema(schema);
  if (zodTypeName(objectSchema) !== "object") return [];
  const shape = zodDef(objectSchema).shape as Record<string, z.ZodTypeAny>;
  return Object.entries(shape).map(([name, value]) => ({
    name,
    in: location,
    required: location === "path" ? true : !isOptionalSchema(value),
    schema: zodToOpenApiSchema(value),
  }));
}

class OpenAPIRegistry {
  private readonly schemas: Record<string, JsonSchema> = {};
  private readonly paths: Array<OpenApiPathRegistration> = [];

  register(name: string, schema: z.ZodTypeAny) {
    this.schemas[name] = zodToOpenApiSchema(schema);
    return { $ref: `#/components/schemas/${name}` };
  }

  registerPath(pathRegistration: OpenApiPathRegistration) {
    this.paths.push(pathRegistration);
  }

  declareQuery(method: string, path: string, query: z.ZodObject<z.ZodRawShape>) {
    const matches = this.paths.filter((entry) => entry.method === method && entry.path === path);
    if (matches.length !== 1) {
      throw new Error(`declareQuery expected one ${method.toUpperCase()} ${path}, found ${matches.length}`);
    }
    const entry = matches[0]!;
    const existing = entry.request?.query ? unwrapSchema(entry.request.query) : null;
    const shape = existing && zodTypeName(existing) === "object"
      ? (zodDef(existing).shape as z.ZodRawShape)
      : {};
    const overlap = Object.keys(query.shape).filter((name) => name in shape);
    if (overlap.length > 0) {
      throw new Error(`declareQuery ${method.toUpperCase()} ${path} redeclares ${overlap.join(", ")}`);
    }
    entry.request = { ...entry.request, query: z.object({ ...shape, ...query.shape }) };
  }

  buildPaths() {
    const paths: Record<string, Record<string, unknown>> = {};
    for (const { method, path, request, responses, ...operation } of this
      .paths) {
      const normalizedOperation: Record<string, unknown> = {
        ...operation,
        responses: normalizeResponses(responses),
      };
      if (request?.params) {
        normalizedOperation.parameters = parametersFromSchema(
          request.params,
          "path",
        );
      }
      if (request?.query) {
        normalizedOperation.parameters = [
          ...((normalizedOperation.parameters as unknown[]) ?? []),
          ...parametersFromSchema(request.query, "query"),
        ];
      }
      if (request?.body) {
        normalizedOperation.requestBody = {
          ...request.body,
          content: normalizeContent(request.body.content),
        };
      }
      paths[path] ??= {};
      paths[path][method] = normalizedOperation;
    }
    return paths;
  }

  buildComponents() {
    return { schemas: this.schemas };
  }
}

const registry = new OpenAPIRegistry();

// ─── Common schemas ──────────────────────────────────────────────────────────

// Match the route's isUuidLike check without its whitespace trimming. Spell
// out both cases because OpenAPI patterns do not carry RegExp flags.
const heartbeatRunIdParamSchema = z.string()
  .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/)
  .describe("Heartbeat run UUID; malformed values return 400");

const cliAuthChallengeIdParamSchema = z.string().trim()
  .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/)
  .describe("CLI auth challenge UUID; malformed values return 400");

const ErrorSchema = registry.register("Error", z.object({ error: z.string() }));

const responses = {
  ok: (schema: z.ZodTypeAny = z.record(z.string(), z.unknown())) => ({
    description: "Success",
    content: { "application/json": { schema } },
  }),
  noContent: { description: "No content" },
  badRequest: {
    description: "Bad request",
    content: { "application/json": { schema: ErrorSchema } },
  },
  unauthorized: {
    description: "Unauthorized",
    content: { "application/json": { schema: ErrorSchema } },
  },
  forbidden: {
    description: "Forbidden",
    content: { "application/json": { schema: ErrorSchema } },
  },
  notFound: {
    description: "Not found",
    content: { "application/json": { schema: ErrorSchema } },
  },
  conflict: {
    description: "Conflict",
    content: { "application/json": { schema: ErrorSchema } },
  },
  payloadTooLarge: {
    description: "Payload too large",
    content: { "application/json": { schema: ErrorSchema } },
  },
  unsupportedMediaType: {
    description: "Unsupported media type",
    content: { "application/json": { schema: ErrorSchema } },
  },
  unprocessable: {
    description: "Unprocessable entity",
    content: { "application/json": { schema: ErrorSchema } },
  },
  serverError: {
    description: "Internal server error",
    content: { "application/json": { schema: ErrorSchema } },
  },
  tooManyRequests: {
    description: "Too many requests",
    content: { "application/json": { schema: ErrorSchema } },
  },
};

const jsonBody = (schema: z.ZodTypeAny) => ({
  content: { "application/json": { schema } },
  required: true as const,
});

// A multipart-only route must declare it: an undeclared requestBody reads as a
// JSON route to supportsJsonRequest() in scripts/generate-mcp-tools.ts, which
// then advertises a tool with no way to carry the file.
const multipartFileRequestBody = (field: string, description: string) => ({
  content: {
    "multipart/form-data": {
      schema: {
        type: "object",
        properties: {
          [field]: { type: "string", format: "binary", description },
        },
        required: [field],
      },
    },
  },
  required: true as const,
});

// The company import + preview routes accept the inline JSON body or the raw
// company package as a compressed zip upload. Document both content types: the
// JSON variant keeps its zod schema; the multipart variant carries the zip in a
// `package` file field plus the other import fields as a JSON `meta` field.
const importRequestBody = (schema: z.ZodTypeAny) => ({
  content: {
    "application/json": { schema },
    "multipart/form-data": {
      schema: {
        type: "object",
        properties: {
          package: {
            type: "string",
            format: "binary",
            description: "The company package as a compressed .zip.",
          },
          meta: {
            type: "string",
            description:
              "JSON-encoded import fields (include, target, collisionStrategy, and, for " +
              "the apply route, nameOverrides / selectedFiles / adapterOverrides / " +
              "pauseAutomations). A `source` here is ignored — the source is the zip.",
          },
        },
        required: ["package"],
      },
    },
    "application/zip": {
      schema: { type: "string", format: "binary" },
    },
  },
  required: true as const,
});

const r = responses;

const externalObjectSummariesBodySchema = z
  .object({
    issueIds: z.array(z.string().guid()).max(1000),
  })
  .strict();

const refreshExternalObjectsBodySchema = z
  .object({
    objectIds: z.array(z.string().guid()).max(50).optional(),
  })
  .strict();

// Chat-channel response contracts live here until the shared package exposes
// response validators. Request bodies and enum vocabularies deliberately reuse
// the shared validators used by the handlers, so the public API cannot drift
// from provider, lifecycle, or mutation inputs.
const chatAdapterCapabilitiesResponseSchema = z
  .object({
    threads: z.boolean(),
    directMessages: z.boolean(),
    nativeStreaming: z.boolean(),
    messageEdits: z.boolean(),
    messageDeletes: z.boolean(),
    reactions: z.boolean(),
    files: z.boolean(),
    cards: z.boolean(),
    actions: z.boolean(),
    modals: z.boolean(),
    slashCommands: z.boolean(),
    ephemeralMessages: z.boolean(),
    proactiveDirectMessages: z.boolean(),
  })
  .strict();

const chatEndpointSetupResponseSchema = z
  .object({
    step: z.enum(["choose_agent", "provider_setup", "test", "complete"]),
    testStartedAt: z.string().datetime().nullable().optional(),
    authorizationUrl: z.string().nullable().optional(),
    providerUrl: z.string().nullable().optional(),
    command: z.string().nullable().optional(),
    webhookUrl: z.string().nullable().optional(),
    messagingEndpoint: z.string().nullable().optional(),
    webhookVerifiedAt: z.string().datetime().nullable().optional(),
    webhookSecretConfigured: z.boolean().optional(),
    callbackSurfaces: z
      .object({
        events: z.object({
          status: z.enum(["current", "stale", "unverified"]),
          observedAt: z.string().datetime().nullable().optional(),
        }),
        interactivity: z.object({
          status: z.enum(["current", "stale", "unverified"]),
          observedAt: z.string().datetime().nullable().optional(),
        }),
        slashCommands: z.object({
          status: z.enum(["current", "stale", "unverified"]),
          observedAt: z.string().datetime().nullable().optional(),
        }),
      })
      .strict()
      .optional(),
    callbacksNeedUpdate: z.boolean().optional(),
  })
  .strict();

const chatEndpointSetupSecretResponseSchema = z
  .object({ webhookSecret: z.string().length(64) })
  .strict();

const openwaEndpointPolicyResponseSchema = z
  .object({
    numberMode: openwaNumberModeSchema,
    senderPolicyMode: openwaSenderPolicyModeSchema,
    replyPolicy: openwaReplyPolicySchema,
    groupMemberReplies: z.boolean(),
    triggers: z
      .object({
        directMessage: z.boolean(),
        agentMentioned: z.boolean(),
        replyToAgent: z.boolean(),
        commandPrefix: z
          .object({ enabled: z.boolean(), prefix: z.string() })
          .strict(),
        selfChat: z.boolean(),
        ownerMentionedAbsent: z.boolean(),
        keywords: z.array(z.string()),
        allMessages: z.boolean(),
      })
      .strict(),
    absenceSeconds: z.number().int(),
    approvals: z
      .object({
        createTask: z.boolean(),
        externalTools: z.boolean(),
        crossChatSend: z.boolean(),
        waAdmin: z.boolean(),
        gatewayAdmin: z.boolean(),
        reminderMinutes: z.number().int(),
        maxReminders: z.number().int(),
        grantTtlHours: z.number().int(),
        pendingTtlHours: z.number().int(),
      })
      .strict(),
    rotateAfterIdleHours: z.number().int(),
    progressNudgeSeconds: z.number().int(),
    typingIndicator: z.boolean(),
    ownerNumberPrefix: z
      .object({ enabled: z.boolean(), text: z.string() })
      .strict(),
    gatewayAdminTools: openwaGatewayAdminToolLevelSchema,
    customInstructions: z.string(),
    auditContentRetentionDays: z.number().int(),
    attestations: z
      .object({ pacing: z.boolean(), soleClient: z.boolean() })
      .strict(),
  })
  .strict();

const chatEndpointResponseSchema = z
  .object({
    id: z.string().uuid(),
    companyId: z.string().uuid(),
    connectionId: z.string().uuid(),
    publicationMode: z.enum(["automatic", "explicit"]),
    externalExecutionPolicy: z.enum(["restricted", "agent"]),
    provider: chatProviderSchema,
    publicId: z.string(),
    status: chatEndpointStatusSchema,
    deploymentMode: z.enum(["direct", "relay"]),
    assignedAgentId: z.string().uuid(),
    assignedAgentName: z.string().nullable(),
    sponsorUserId: z.string().nullable(),
    providerAccountId: z.string().nullable(),
    providerAccountLabel: z.string().nullable(),
    botExternalId: z.string().nullable(),
    photonAllocation: z.enum(["dedicated", "shared"]).optional(),
    policy: openwaEndpointPolicyResponseSchema.optional(),
    policyRevision: z.number().int().min(0).optional(),
    inflightMode: chatInflightModeSchema.optional(),
    botUsername: z.string().nullable(),
    botLabel: z.string().nullable(),
    botAvatarUrl: z.string().nullable(),
    allowDirectMessages: z.boolean(),
    allowGroupChats: z.boolean(),
    allowUnlinkedPeople: z.boolean(),
    replyMode: z.literal("subscribed"),
    capabilities: chatAdapterCapabilitiesResponseSchema,
    setup: chatEndpointSetupResponseSchema,
    healthMessage: z.string().nullable(),
    lastError: z.string().nullable(),
    lastActivityAt: z.string().datetime().nullable(),
    lastPublicationAt: z.string().datetime().nullable(),
    activatedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

const chatEndpointResourceResponseSchema = z
  .object({
    id: z.string().uuid(),
    companyId: z.string().uuid(),
    endpointId: z.string().uuid(),
    type: z.string(),
    providerResourceId: z.string(),
    parentProviderResourceId: z.string().nullable(),
    label: z.string(),
    detail: z.string().nullable(),
    providerUrl: z.string().nullable(),
    availability: chatResourceAvailabilitySchema,
    enabled: z.boolean(),
    metadata: z.record(z.string(), z.unknown()),
    participants: z.array(z.string()).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

const chatPrincipalLinkResponseSchema = z
  .object({
    id: z.string().uuid(),
    principalId: z.string().uuid(),
    externalLabel: z.string(),
    externalDetail: z.string(),
    paperclipUserId: z.string().nullable(),
    paperclipUserLabel: z.string().nullable(),
    status: chatIdentityLinkStatusSchema,
  })
  .strict();

const chatIdentityLinkIntentResponseSchema = z
  .object({
    confirmationUrl: z.string(),
    expiresAt: z.string().datetime(),
  })
  .strict();

const chatIdentityLinkPreviewResponseSchema = z
  .object({
    selfService: z.boolean().optional(),
    canConfirm: z.boolean().optional(),
    endpointId: z.string().uuid(),
    companyId: z.string().uuid(),
    companyName: z.string(),
    companyPrefix: z.string(),
    provider: chatProviderSchema,
    providerAccountLabel: z.string().nullable(),
    botLabel: z.string().nullable(),
    externalLabel: z.string(),
    externalDetail: z.string(),
    expiresAt: z.string().datetime(),
  })
  .strict();

const chatIdentityLinkConfirmationResponseSchema = z
  .object({
    ok: z.literal(true),
    endpointId: z.string().uuid(),
  })
  .strict();

const chatConversationResponseSchema = z
  .object({
    id: z.string().uuid(),
    companyId: z.string().uuid(),
    endpointId: z.string().uuid(),
    resourceId: z.string().uuid().nullable(),
    issueId: z.string().uuid(),
    issueIdentifier: z.string().nullable(),
    issueTitle: z.string().nullable(),
    externalConversationId: z.string(),
    externalThreadId: z.string(),
    sessionGeneration: z.number().int().positive(),
    externalLabel: z.string(),
    externalUrl: z.string().nullable(),
    isDirectMessage: z.boolean(),
    state: z.enum([
      "active",
      "waiting",
      "completed",
      "unavailable",
      "endpoint_removed",
    ]),
    lastPublicationStatus: chatPublicationStateSchema.nullable(),
    lastActivityAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

const chatFileTransferResponseSchema = z
  .object({
    provider: z.literal("microsoft-teams"),
    phase: z.enum(CHAT_FILE_TRANSFER_PHASES),
    filename: z.string().min(1).max(255),
    expiresAt: z.string().datetime().nullable().optional(),
    version: z.number().int().positive(),
  })
  .strict();

const chatActivityResponseSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(["delivery", "publication", "action", "health", "repair"]),
    actionType: z
      .enum([
        "slash_task_start",
        "provider_effect",
        "github_webhook_ingress",
        "slack_session_sync",
        "slack_session_stop",
      ])
      .optional(),
    status: z.union([
      chatDeliveryStateSchema,
      chatPublicationStateSchema,
      z.string(),
    ]),
    summary: z.string(),
    detail: z.string().nullable(),
    createdAt: z.string().datetime(),
    replayable: z.boolean(),
    resolutionActions: z.array(
      z.enum(["mark_delivered", "retry_anyway", "cancel"]),
    ),
    fileTransfer: chatFileTransferResponseSchema.optional(),
  })
  .strict();

const safeExternalChatCardResponseSchema = z
  .object({
    schema: z.literal("paperclip.chat.card.v1"),
    kind: z.enum(["status", "question", "confirmation"]),
    title: z.string(),
    body: z.string().optional(),
    actions: z
      .array(
        z.union([
          z
            .object({
              type: z.literal("callback"),
              actionId: z.string(),
              label: z.string(),
              style: z.enum(["default", "primary", "danger"]).optional(),
            })
            .strict(),
          z
            .object({
              type: z.literal("link"),
              label: z.string(),
              url: z.string().url(),
            })
            .strict(),
        ]),
      )
      .optional(),
  })
  .strict();

const safeChatPublicationPayloadResponseSchema = z
  .object({
    text: z.string(),
    attachmentIds: z.array(z.string().uuid()).optional(),
    interactionId: z.string().uuid().optional(),
    card: safeExternalChatCardResponseSchema.optional(),
    progressState: z
      .enum([
        "queued",
        "working",
        "waiting_for_input",
        "approval_needed",
        "completed",
        "failed",
      ])
      .optional(),
  })
  .strict();

const chatPublicationResponseSchema = z
  .object({
    id: z.string().uuid(),
    companyId: z.string().uuid(),
    endpointId: z.string().uuid(),
    conversationId: z.string().uuid(),
    issueId: z.string().uuid(),
    commentId: z.string().uuid().nullable(),
    idempotencyKey: z.string(),
    payload: safeChatPublicationPayloadResponseSchema,
    state: chatPublicationStateSchema,
    fileTransfer: chatFileTransferResponseSchema.optional(),
    providerMessageId: z.string().nullable(),
    providerUrl: z.string().nullable(),
    attempts: z.number().int().nonnegative(),
    redactedError: z.string().nullable(),
    nextAttemptAt: z.string().datetime().nullable(),
    publishedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

const externalChannelBindingResponseSchema = z
  .object({
    endpointId: z.string().uuid(),
    provider: chatProviderSchema,
    botLabel: z.string().nullable(),
    externalLabel: z.string(),
    externalUrl: z.string().nullable(),
    conversationId: z.string().uuid(),
    publicationState: chatPublicationStateSchema.nullable(),
    assignedAgentLocked: z.literal(true),
  })
  .strict();

// The route enforces the shared strict request schema. The route spine
// injects the adapter type from the path, so the client body never carries
// it; derive the documented body from the shared schema and omit that field,
// so the documented body cannot drift from the route again.
const startAdapterLoginSessionSchema =
  startAdapterAuthSessionRequestSchema.omit({
    adapterType: true,
  });

const environmentCustomImageCompanyQuerySchema = z
  .object({
    companyId: z.string().optional(),
  })
  .strict();

const disableEnvironmentCustomImageTemplateQuerySchema =
  environmentCustomImageCompanyQuerySchema.extend({
    deleteProviderTemplate: z.enum(["true", "false"]).optional(),
  });

const environmentCustomImageOverviewSchema = z
  .object({
    activeTemplate: environmentCustomImageTemplateSchema.nullable(),
    activeSession: environmentCustomImageSetupSessionSchema.nullable(),
    latestSession: environmentCustomImageSetupSessionSchema.nullable(),
  })
  .strict();

const environmentCustomImageSetupSessionResultSchema = z
  .object({
    session: environmentCustomImageSetupSessionSchema,
    connectionPayload: z.record(z.string(), z.unknown()).nullable(),
  })
  .strict();

const environmentCustomImageSetupSessionFinishResultSchema =
  environmentCustomImageSetupSessionResultSchema.extend({
    template: environmentCustomImageTemplateSchema,
  });

const environmentCustomImageTemplateRollbackResultSchema = z
  .object({
    activeTemplate: environmentCustomImageTemplateSchema,
    supersededTemplate: environmentCustomImageTemplateSchema,
  })
  .strict();

const environmentCustomImageTemplateRelinkResultSchema = z
  .object({
    template: environmentCustomImageTemplateSchema,
    classification: z.enum(["knob_only", "boot_source_drift", "unclassified"]),
  })
  .strict();

const workTimelineQuerySchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
    userId: z.string().optional(),
    goalId: z.string().guid().optional(),
    projectId: z.string().guid().optional(),
    issueId: z.string().guid().optional(),
    limit: z.string().optional(),
    offset: z.string().optional(),
  })
  .strict();

const workTimelineResponseSchema = z
  .object({
    actors: z.array(
      z
        .object({
          id: z.string(),
          type: z.enum(["agent", "user", "system", "plugin"]),
          name: z.string(),
          avatar: z.string().nullable().optional(),
        })
        .strict(),
    ),
    spans: z.array(
      z
        .object({
          actorId: z.string(),
          laneHint: z.string().nullable(),
          runId: z.string(),
          issueId: z.string(),
          issueIdentifier: z.string().nullable(),
          start: z.string(),
          end: z.string().nullable(),
          status: z.string(),
          retryOfRunId: z.string().nullable().optional(),
          continuationAttempt: z.number().optional(),
          invocationSource: z.string().nullable().optional(),
        })
        .strict(),
    ),
    events: z.array(
      z
        .object({
          actorId: z.string(),
          kind: z.enum([
            "created",
            "commented",
            "approved",
            "delegated",
            "assigned",
          ]),
          issueId: z.string(),
          at: z.string(),
        })
        .strict(),
    ),
    edges: z.array(
      z
        .object({
          fromActorId: z.string(),
          toActorId: z.string(),
          issueId: z.string(),
          at: z.string(),
          kind: z.enum(["delegation", "assignment", "mention"]),
        })
        .strict(),
    ),
    pagination: z
      .object({
        limit: z.number().int().positive(),
        offset: z.number().int().nonnegative(),
        totalIssues: z.number().int().nonnegative(),
        hasMore: z.boolean(),
      })
      .strict(),
    window: z
      .object({
        from: z.string(),
        to: z.string(),
        capped: z.boolean(),
      })
      .strict(),
  })
  .strict();

function paramsSchemaFromPath(
  routePath: string,
): z.ZodObject<z.ZodRawShape> | undefined {
  const names = [...routePath.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(
    (match) => match[1],
  );
  if (names.length === 0) return undefined;
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const name of names) {
    shape[name] = z.string();
  }
  return z.object(shape);
}

function registerCurrentRoute(input: {
  method: string;
  path: string;
  tags: string[];
  summary: string;
  query?: z.ZodTypeAny;
  body?: z.ZodTypeAny;
  responses?: Record<string, OpenApiResponse>;
}) {
  const params = paramsSchemaFromPath(input.path);
  const request =
    params || input.query || input.body
      ? {
          ...(params ? { params } : {}),
          ...(input.query ? { query: input.query } : {}),
          ...(input.body ? { body: jsonBody(input.body) } : {}),
        }
      : undefined;
  registry.registerPath({
    method: input.method,
    path: input.path,
    tags: input.tags,
    summary: input.summary,
    ...(request ? { request } : {}),
    responses: input.responses ?? {
      200: r.ok(),
      400: r.badRequest,
      401: r.unauthorized,
      404: r.notFound,
    },
  });
}

type OpenApiAuthLevel =
  | "public"
  | "agent_run"
  | "runtime_tools"
  | "authenticated"
  | "board"
  | "instance_admin";

const BOARD_SESSION_AUTH_SCHEME = "BoardSessionAuth";
const BOARD_API_KEY_AUTH_SCHEME = "BoardApiKeyAuth";
const AGENT_BEARER_AUTH_SCHEME = "AgentBearerAuth";
const AGENT_RUN_AUTH_SCHEME = "AgentRunAuth";
const RUNTIME_TOOLS_BEARER_AUTH_SCHEME = "RuntimeToolsBearerAuth";

function securityRequirement(name: string): Record<string, string[]> {
  return { [name]: [] };
}

const BOARD_SECURITY: Array<Record<string, string[]>> = [
  securityRequirement(BOARD_SESSION_AUTH_SCHEME),
  securityRequirement(BOARD_API_KEY_AUTH_SCHEME),
];

const AUTHENTICATED_SECURITY: Array<Record<string, string[]>> = [
  ...BOARD_SECURITY,
  securityRequirement(AGENT_BEARER_AUTH_SCHEME),
];

const RUNTIME_TOOLS_SECURITY: Array<Record<string, string[]>> = [
  securityRequirement(RUNTIME_TOOLS_BEARER_AUTH_SCHEME),
];

const RUNTIME_TOOLS_OPERATIONS = new Set([
  "POST /runtime-tools/github/credentials",
  "GET /mcp/runtime-tools",
  "POST /mcp/runtime-tools",
  "POST /runtime-tools/connections/search",
  "POST /runtime-tools/connections/request",
]);

const PUBLIC_OPERATIONS = new Set([
  "GET /api/agent-avatars/{version}/{palette}/{file}",
  "GET /api/health",
  "GET /api/openapi.json",
  "GET /api/board-claim/{token}",
  "POST /api/cli-auth/challenges",
  "GET /api/cli-auth/challenges/{id}",
  "POST /api/cli-auth/challenges/{id}/cancel",
  "GET /api/invites/{token}",
  "GET /api/public/share/{token}",
  "GET /api/public/share/{token}/issues/{issueId}",
  "GET /api/public/share/{token}/attachments/{attachmentId}/content",
  "GET /api/public/share/{token}/assets/{assetId}/content",
  "GET /api/public/share/{token}/issues/{issueId}/documents/{key}/pdf",
  "GET /api/invites/{token}/logo",
  "GET /api/invites/{token}/onboarding",
  "GET /api/invites/{token}/onboarding.txt",
  "GET /api/invites/{token}/skills/index",
  "GET /api/invites/{token}/skills/{skillName}",
  "GET /api/invites/{token}/test-resolution",
  "POST /api/invites/{token}/accept",
  "POST /api/join-requests/{requestId}/claim-api-key",
  "GET /mcp/gateways/{gatewayPublicId}",
  "POST /mcp/gateways/{gatewayPublicId}",
  "GET /api/tool-gateway/gateways/{gatewayId}/mcp",
  "POST /api/tool-gateway/gateways/{gatewayId}/mcp",
]);

const BOARD_ONLY_PREFIXES = [
  "/api/announcements/",
  "/api/notifications/",
  "/api/auth/",
  "/api/admin/",
  "/api/plugins",
  "/api/instance/",
];

const browserUseOperations = [
  ["get", "/api/issues/{issueId}/browsers", "List authorized task browsers", undefined],
  ["get", "/api/issues/{issueId}/browsers/{browserId}/viewer", "Get a private live browser viewer", undefined],
  ["post", "/api/issues/{issueId}/browsers/{browserId}/presence", "Renew visible browser presence", undefined],
  ["post", "/api/issues/{issueId}/browsers/{browserId}/control", "Control a task browser", browserUseControlSchema],
  ["post", "/api/issues/{issueId}/browsers/{browserId}/viewport", "Set the browser viewport", browserUseViewportSchema],
  ["post", "/api/issues/{issueId}/browsers/{browserId}/viewport/release", "Release viewport ownership", browserUseViewerSchema],
  ["get", "/api/companies/{companyId}/browser-use-cloud/grants/{grantId}/profiles", "List available browser profiles", undefined],
  ["get", "/api/companies/{companyId}/browser-use-cloud/grants/{grantId}/settings", "Read browser credential settings", undefined],
  ["put", "/api/companies/{companyId}/browser-use-cloud/grants/{grantId}/settings", "Update browser credential settings", browserUseSettingsSchema],
] as const;

const BOARD_ONLY_OPERATIONS = new Set([
  "PATCH /api/issues/{id}/comments/{commentId}/public-share",
  ...browserUseOperations.map(([method, path]) => `${method.toUpperCase()} ${path}`),
  "GET /api/companies/{companyId}/ai-connections",
  "POST /api/companies/{companyId}/ai-connections",
  "POST /api/companies/{companyId}/ai-connections/local",
  "POST /api/companies/{companyId}/ai-connections/local/attempts",
  "POST /api/companies/{companyId}/ai-connections/local/check",
  "DELETE /api/companies/{companyId}/ai-connections/local/attempts/{sessionId}",
  "PUT /api/companies/{companyId}/ai-connections/default",
  "GET /api/companies/{companyId}/ai-connections/{connectionId}/active-runs",
  "GET /api/companies/{companyId}/ai-connections/{connectionId}/usage",
  "GET /api/companies/{companyId}/ai-connections/login/{sessionId}",
  "GET /api/companies/{companyId}/ai-connection-pools",
  "POST /api/companies/{companyId}/ai-connection-pools",
  "DELETE /api/companies/{companyId}/ai-connection-pools/{poolId}",
  "GET /api/companies/{companyId}/ai-connection-pools/{poolId}/inspection",

  "GET /api/companies/{companyId}/project-repositories",
  "PUT /api/projects/{id}/repositories",
  "DELETE /api/issues/{id}/documents/{key}",
  "GET /api/companies/{companyId}/decisions",
  "GET /api/cloud/stacks",
  "GET /api/companies",
  "POST /api/companies",
  "GET /api/companies/stats",
  "GET /api/companies/issues",
  "GET /api/companies/import/jobs/{jobId}",
  "POST /api/board-claim/{token}/claim",
  "GET /api/cli-auth/me",
  "POST /api/companies/{companyId}/invites",
  "GET /api/companies/{companyId}/invites",
  "POST /api/companies/{companyId}/openclaw/invite-prompt",
  "GET /api/companies/{companyId}/join-requests",
  "POST /api/companies/{companyId}/join-requests/{requestId}/approve",
  "POST /api/companies/{companyId}/join-requests/{requestId}/reject",
  "GET /api/companies/{companyId}/members",
  "PATCH /api/companies/{companyId}/members/{memberId}",
  "PATCH /api/companies/{companyId}/members/{memberId}/role-and-grants",
  "POST /api/companies/{companyId}/members/{memberId}/archive",
  "PATCH /api/companies/{companyId}/members/{memberId}/permissions",
  "GET /api/companies/{companyId}/user-directory",
  "GET /api/companies/{companyId}/managed-agent-profiles",
  "POST /api/companies/{companyId}/managed-agent-profiles",
  "GET /api/companies/{companyId}/remote-agent-profiles",
  "POST /api/companies/{companyId}/remote-agent-profiles",
  "POST /api/execution-workspaces/{id}/reconcile-branch",
  "POST /api/execution-workspaces/{id}/login-handoff",
  "GET /api/board-api-keys",
  "POST /api/board-api-keys",
  "DELETE /api/board-api-keys/{keyId}",
  "POST /api/bootstrap/claim",
  "GET /api/companies/{companyId}/resource-memberships/me",
  "PUT /api/companies/{companyId}/resource-memberships/me/agents/{agentId}",
  "PUT /api/companies/{companyId}/resource-memberships/me/documents/{documentId}",
  "PUT /api/companies/{companyId}/resource-memberships/me/projects/{projectId}",
  "GET /api/companies/{companyId}/secret-provider-configs",
  "POST /api/companies/{companyId}/secret-provider-configs",
  "GET /api/companies/{companyId}/secret-providers/health",
  "POST /api/companies/{companyId}/secret-provider-configs/discovery/preview",
  "GET /api/secret-provider-configs/{id}",
  "PATCH /api/secret-provider-configs/{id}",
  "DELETE /api/secret-provider-configs/{id}",
  "POST /api/secret-provider-configs/{id}/default",
  "POST /api/secret-provider-configs/{id}/health",
  "GET /api/companies/{companyId}/user-secret-definitions",
  "POST /api/companies/{companyId}/user-secret-definitions",
  "PATCH /api/companies/{companyId}/user-secret-definitions/{definitionId}",
  "DELETE /api/companies/{companyId}/user-secret-definitions/{definitionId}",
  "GET /api/companies/{companyId}/user-secret-definitions/{definitionId}/coverage",
  "GET /api/companies/{companyId}/me/user-secrets",
  "POST /api/companies/{companyId}/me/user-secrets",
  "PATCH /api/companies/{companyId}/me/user-secrets/{secretId}",
  "POST /api/companies/{companyId}/me/user-secrets/{secretId}/rotate",
  "DELETE /api/companies/{companyId}/me/user-secrets/{secretId}",
  "POST /api/companies/{companyId}/secrets/remote-import",
  "POST /api/companies/{companyId}/secrets/remote-import/preview",
  "GET /api/secrets/{id}/usage",
  "GET /api/secrets/{id}/access-events",
  "POST /api/health/dev-server/restart",
  "POST /api/issues/{issueId}/file-resources/availability",
  "GET /api/issues/{issueId}/file-resources/content",
  "GET /api/issues/{issueId}/file-resources/list",
  "GET /api/issues/{issueId}/file-resources/resolve",
  "POST /api/issues/{id}/interactions/{interactionId}/accept",
  "POST /api/issues/{id}/interactions/{interactionId}/reject",
  "POST /api/issues/{id}/interactions/{interactionId}/respond",
  "POST /api/issues/{id}/interactions/{interactionId}/skip",
  "POST /api/issues/{id}/interactions/{interactionId}/withdraw",
  "GET /api/companies/{companyId}/tools/gallery",
  "GET /api/companies/{companyId}/tools/apps/{galleryKey}/preflight",
  "POST /api/companies/{companyId}/tools/apps/connect",
  "POST /api/companies/{companyId}/tools/apps/{connectionId}/finalize-oauth-access",
  "POST /api/companies/{companyId}/tools/apps/{connectionId}/finish",
  "GET /api/companies/{companyId}/tools/apps/attention",
  "GET /api/companies/{companyId}/tools/action-requests",
  "GET /api/companies/{companyId}/tools/examples",
  "POST /api/companies/{companyId}/tools/examples/{id}/install",
  "POST /api/companies/{companyId}/tools/examples/{id}/smoke",
  "GET /api/companies/{companyId}/tools/applications",
  "POST /api/companies/{companyId}/tools/applications",
  "PATCH /api/tool-applications/{applicationId}",
  "DELETE /api/tool-applications/{applicationId}",
  "GET /api/companies/{companyId}/tools/connections",
  "POST /api/companies/{companyId}/tools/connections",
  "POST /api/companies/{companyId}/tools/connections/{connectionId}/start-authorization",
  "GET /api/tool-connections/{connectionId}",
  "GET /api/tool-connections/{connectionId}/grants",
  "POST /api/tool-connections/{connectionId}/grants/installations",
  "POST /api/tool-connections/{connectionId}/grants/{grantId}/delegations",
  "DELETE /api/tool-connections/{connectionId}/grants/{grantId}/delegations/{delegationId}",
  "DELETE /api/tool-connections/{connectionId}/grants/{grantId}",
  "GET /api/tool-connections/{connectionId}/usage",
  "PATCH /api/tool-connections/{connectionId}",
  "DELETE /api/tool-connections/{connectionId}",
  "POST /api/tool-connections/{connectionId}/health-check",
  "POST /api/tool-connections/{connectionId}/reconnect",
  "POST /api/tool-connections/{connectionId}/railway/ssh",
  "POST /api/tool-connections/{connectionId}/catalog/refresh",
  "GET /api/tool-connections/{connectionId}/catalog",
  "GET /api/tool-connections/{connectionId}/aggregator/apps",
  "POST /api/tool-connections/{connectionId}/aggregator/apps/sync",
  "POST /api/tool-connections/{connectionId}/aggregator/apps/refresh",
  "PUT /api/tool-connections/{connectionId}/aggregator/discovery",
  "GET /api/tool-connections/{connectionId}/composio/apps",
  "POST /api/tool-connections/{connectionId}/composio/apps/sync",
  "POST /api/tool-connections/{connectionId}/composio/apps/refresh",
  "POST /api/tool-connections/{connectionId}/composio/apps/{toolkit}/setup",
  "POST /api/tool-connections/{connectionId}/composio/apps/{toolkit}/accounts",
  "GET /api/tool-connections/{connectionId}/activity",
  "GET /api/tool-connections/{connectionId}/test-agents",
  "GET /api/tool-connections/{connectionId}/test-agents/{agentId}/access",
  "POST /api/tool-connections/{connectionId}/test-calls",
  "GET /api/tool-connections/{connectionId}/test-calls/{actionRequestId}",
  "POST /api/agents/me/connections/{connectionId}/start-authorization",
  "POST /api/agents/me/connections/{connectionId}/token",
  "POST /api/tools/oauth/{connectionId}/start",
  "GET /api/tools/oauth/callback",
  "GET /api/tools/vercel-connect/callback",
  "GET /api/connection-intents/{interactionId}/setup-options",
  "POST /api/connection-intents/{interactionId}/phase",
  "POST /api/connection-intents/{interactionId}/complete",
  "POST /api/agents/{id}/connection-intents/{interactionId}/adopt",
  "POST /api/connection-intents/{interactionId}/decline",
  "GET /api/companies/{companyId}/tools/profiles",
  "POST /api/companies/{companyId}/tools/profiles",
  "GET /api/companies/{companyId}/tools/profiles/effective/agents/{agentId}",
  "GET /api/tool-profiles/{profileId}/new-tools",
  "PATCH /api/tool-profiles/{profileId}",
  "POST /api/tool-profiles/{profileId}/duplicate",
  "DELETE /api/tool-profiles/{profileId}",
  "POST /api/tool-profiles/{profileId}/new-tools/review",
  "POST /api/tool-profiles/{profileId}/entries",
  "PATCH /api/tool-profile-entries/{entryId}",
  "DELETE /api/tool-profile-entries/{entryId}",
  "POST /api/companies/{companyId}/tools/profiles/{profileId}/bind",
  "POST /api/companies/{companyId}/tools/profiles/{profileId}/unbind",
  "GET /api/companies/{companyId}/tools/runtime-slots",
  "POST /api/companies/{companyId}/tools/runtime-slots/{id}/stop",
  "POST /api/companies/{companyId}/tools/runtime-slots/{id}/restart",
  "GET /api/companies/{companyId}/tools/runtime-health",
  "GET /api/companies/{companyId}/tools/runs/{runId}/decisions",
  "GET /api/companies/{companyId}/tools/trust-rules",
  "GET /api/companies/{companyId}/tools/policies",
  "POST /api/companies/{companyId}/tools/policies/reorder",
  "POST /api/companies/{companyId}/tools/policies",
  "POST /api/companies/{companyId}/tools/policies/{policyId}/duplicate",
  "PATCH /api/companies/{companyId}/tools/policies/{policyId}",
  "DELETE /api/companies/{companyId}/tools/policies/{policyId}",
  "POST /api/companies/{companyId}/tools/action-requests/{actionRequestId}/trust-rule",
  "POST /api/companies/{companyId}/tools/trust-rules/{policyId}/revoke",
  "GET /api/companies/{companyId}/tools/stdio-templates",
  "POST /api/companies/{companyId}/tools/stdio-templates",
  "POST /api/companies/{companyId}/tools/stdio-templates/{templateId}/disable",
  "POST /api/companies/{companyId}/tools/mcp/import-json",
  "POST /api/companies/{companyId}/tools/policy/test",
  "GET /api/companies/{companyId}/tools/gateways",
  "POST /api/companies/{companyId}/tools/gateways",
  "PATCH /api/tool-gateway/gateways/{gatewayId}",
  "POST /api/tool-gateway/gateways/{gatewayId}/tokens",
  "POST /api/tool-gateway/gateway-tokens/{tokenId}/revoke",
  "POST /api/tool-gateway/action-requests/{id}/approve",
  "POST /api/tool-gateway/action-requests/{id}/decline",
  "POST /api/companies/{companyId}/email/inspect",
  "POST /api/companies/{companyId}/email/inboxes",
  "GET /api/companies/{companyId}/email/connections",
  "POST /api/companies/{companyId}/email/connections",
  "POST /api/companies/{companyId}/email/connections/{connectionId}/inspect",
  "POST /api/companies/{companyId}/email/connections/{connectionId}/check-address",
  "POST /api/email/inboxes/{endpointId}/control",
  "POST /api/email/inboxes/{endpointId}/reconnect",
  "POST /api/companies/{companyId}/email/deliveries/{publicationId}/resolve",
  // Chat endpoints expose provider credentials, identity mappings, access
  // policy, and replay controls. Every mounted handler asserts a board actor;
  // keep the generated security contract equally restrictive.
  "GET /api/slack/search/callback",
  "GET /api/companies/{companyId}/slack/endpoints/{endpointId}/capabilities",
  "GET /api/companies/{companyId}/slack/endpoints/{endpointId}/search",
  "PUT /api/companies/{companyId}/slack/endpoints/{endpointId}/search",
  "POST /api/companies/{companyId}/slack/endpoints/{endpointId}/search/connect",
  "DELETE /api/companies/{companyId}/slack/endpoints/{endpointId}/search",
  "GET /api/companies/{companyId}/chat-endpoints",
  "POST /api/companies/{companyId}/chat-endpoints",
  "GET /api/chat-endpoints/{endpointId}",
  "GET /api/chat-endpoints/{endpointId}/github/configuration",
  "PUT /api/chat-endpoints/{endpointId}/github/configuration",
  "POST /api/chat-endpoints/{endpointId}/github/verify",
  "PUT /api/chat-endpoints/{endpointId}/github/progress",
  "GET /api/chat-endpoints/{endpointId}/github/reviews",
  "GET /api/chat-endpoints/{endpointId}/github/personal-connections",
  "POST /api/chat-endpoints/{endpointId}/github/identity",
  "POST /api/chat-endpoints/{endpointId}/github/people/lookup",
  "POST /api/chat-endpoints/{endpointId}/github/registration",
  "POST /api/chat-endpoints/{endpointId}/github/app",
  "POST /api/chat-endpoints/{endpointId}/github/repositories/refresh",
  "PATCH /api/chat-endpoints/{endpointId}",
  "POST /api/chat-endpoints/{endpointId}/setup",
  "POST /api/chat-endpoints/{endpointId}/setup-secret",
  "POST /api/chat-endpoints/{endpointId}/test",
  "POST /api/chat-endpoints/{endpointId}/finish",
  "GET /api/chat-endpoints/{endpointId}/test-status",
  "POST /api/chat-endpoints/{endpointId}/photon/inspect",
  "POST /api/chat-endpoints/{endpointId}/openwa/inspect",
  "GET /api/chat-endpoints/{endpointId}/openwa/owners",
  "POST /api/chat-endpoints/{endpointId}/openwa/owners",
  "DELETE /api/chat-endpoints/{endpointId}/openwa/owners/{ownerId}",
  "GET /api/chat-endpoints/{endpointId}/openwa/sender-rules",
  "POST /api/chat-endpoints/{endpointId}/openwa/sender-rules",
  "DELETE /api/chat-endpoints/{endpointId}/openwa/sender-rules/{ruleId}",
  "GET /api/chat-endpoints/{endpointId}/openwa/chats",
  "PUT /api/chat-endpoints/{endpointId}/openwa/chats",
  "GET /api/chat-endpoints/{endpointId}/openwa/gateway-chats",
  "GET /api/chat-endpoints/{endpointId}/openwa/linked-sessions",
  "POST /api/chat-endpoints/{endpointId}/openwa/linked-sessions",
  "GET /api/chat-endpoints/{endpointId}/openwa/linkable-sessions",
  "PUT /api/chat-endpoints/{endpointId}/openwa/linked-sessions/{linkedId}/chats",
  "DELETE /api/chat-endpoints/{endpointId}/openwa/linked-sessions/{linkedId}",
  "GET /api/chat-endpoints/{endpointId}/openwa/linked-sessions/{linkedId}/gateway-chats",
  "GET /api/chat-endpoints/{endpointId}/openwa/health",
  "PATCH /api/chat-endpoints/{endpointId}/openwa/policy",
  "GET /api/chat-endpoints/{endpointId}/openwa/approvals",
  "POST /api/chat-endpoints/{endpointId}/openwa/approvals/{requestId}/resolve",
  "POST /api/chat-endpoints/{endpointId}/openwa/approvals/{requestId}/cancel",
  "GET /api/chat-endpoints/{endpointId}/resources",
  "PUT /api/chat-endpoints/{endpointId}/resources",
  "GET /api/chat-endpoints/{endpointId}/principals",
  "POST /api/chat-endpoints/{endpointId}/principals/{principalId}/link-intent",
  "DELETE /api/chat-endpoints/{endpointId}/principals/{principalId}/link",
  "POST /api/chat-identity-links/confirm",
  "GET /api/chat-identity-links/preview",
  "POST /api/chat-identity-links/request-access",
  "GET /api/chat-endpoints/{endpointId}/conversations",
  "GET /api/chat-endpoints/{endpointId}/activity",
  "GET /api/chat-endpoints/{endpointId}/audit",
  "POST /api/chat-endpoints/{endpointId}/deliveries/{deliveryId}/replay",
  "POST /api/chat-endpoints/{endpointId}/publications/{publicationId}/replay",
  "POST /api/chat-endpoints/{endpointId}/publications/{publicationId}/resolve",
  "POST /api/chat-endpoints/{endpointId}/actions/{actionId}/resolve",
  "POST /api/chat-endpoints/{endpointId}/conversations/{conversationId}/publications",
  "GET /api/chat-endpoints/{endpointId}/conversations/{conversationId}/publications/{publicationId}/status",
  "GET /api/issues/{issueId}/chat-binding",
]);

const INSTANCE_ADMIN_OPERATIONS = new Set([
  "POST /api/companies",
  "POST /api/plugins/install",
  "POST /api/instance/database-backups",
  "GET /api/instance/attachment-retention",
  "POST /api/instance/attachment-retention/preview",
  "POST /api/instance/attachment-retention/run",
  "POST /api/admin/users/{userId}/promote-instance-admin",
  "POST /api/admin/users/{userId}/demote-instance-admin",
  "PUT /api/admin/users/{userId}/company-access",
  "POST /api/companies/{companyId}/smoke-lab/services/start",
  "POST /api/companies/{companyId}/smoke-lab/install-fixtures",
  "POST /api/companies/{companyId}/smoke-lab/reset",
]);

const CREATED_OPERATIONS = new Set([
  "POST /api/adapters/install",
  "POST /api/chat-endpoints/{endpointId}/setup-secret",
  "POST /api/companies/{companyId}/agent-hires",
  "POST /api/companies/{companyId}/agents",
  "POST /api/agents/{id}/keys",
  "POST /api/companies/{companyId}/approvals",
  "POST /api/approvals/{id}/comments",
  "POST /api/companies/{companyId}/assets/images",
  "POST /api/companies/{companyId}/logo",
  "POST /api/companies/{companyId}/onboarding-seed",
  "POST /api/cli-auth/challenges",
  "POST /api/board-api-keys",
  "POST /api/companies",
  "POST /api/companies/{companyId}/invites",
  "POST /api/companies/{companyId}/openclaw/invite-prompt",
  "POST /api/companies/{companyId}/cost-events",
  "POST /api/companies/{companyId}/finance-events",
  "POST /api/companies/{companyId}/secret-provider-configs",
  "POST /api/companies/{companyId}/environments",
  "POST /api/environments/{environmentId}/custom-image-setup-sessions",
  "POST /api/companies/{companyId}/goals",
  "POST /api/companies/{companyId}/labels",
  "POST /api/issues/{id}/documents/{key}/annotations",
  "POST /api/issues/{id}/documents/{key}/annotations/{threadId}/comments",
  "POST /api/routines/{id}/description/annotations",
  "POST /api/routines/{id}/description/annotations/{threadId}/comments",
  "POST /api/issues/{id}/work-products",
  "POST /api/issues/{id}/low-trust/promotions",
  "POST /api/issues/{id}/approvals",
  "POST /api/companies/{companyId}/issues",
  "POST /api/issues/{id}/children",
  "POST /api/issues/{id}/interactions",
  "POST /api/issues/{id}/comments",
  "POST /api/companies/{companyId}/issues/{issueId}/attachments",
  "POST /api/companies/{companyId}/projects",
  "POST /api/projects/{id}/workspaces",
  "POST /api/companies/{companyId}/routines",
  "POST /api/companies/{companyId}/folders",
  "POST /api/companies/{companyId}/folders/ensure-my",
  "POST /api/routines/{id}/triggers",
  "POST /api/companies/{companyId}/secrets",
  "POST /api/companies/{companyId}/user-secret-definitions",
  "POST /api/companies/{companyId}/me/user-secrets",
  "POST /api/companies/{companyId}/skills",
  "POST /api/companies/{companyId}/skills/import",
  "POST /api/join-requests/{requestId}/claim-api-key",
  "POST /api/admin/users/{userId}/promote-instance-admin",
  "POST /api/plugins/install",
  "POST /api/instance/database-backups",
  "POST /api/companies/{companyId}/tools/applications",
  "POST /api/companies/{companyId}/tools/connections",
  "POST /api/companies/{companyId}/tools/action-requests/{actionRequestId}/trust-rule",
  "POST /api/companies/{companyId}/tools/gateways",
  "POST /api/tool-gateway/gateways/{gatewayId}/tokens",
  "POST /api/tool-gateway/sessions",
]);

const ACCEPTED_OPERATIONS = new Set([
  "POST /api/companies/{companyId}/email/send",
  "POST /api/companies/import",
  "POST /api/health/dev-server/restart",
  "POST /api/invites/{token}/accept",
]);

const FORBIDDEN_RESPONSE = {
  description: "Forbidden",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/Error" },
    },
  },
};

function operationKey(method: string, path: string) {
  return `${method.toUpperCase()} ${path}`;
}

function isBoardOnlyOperation(method: string, path: string) {
  const key = operationKey(method, path);
  if (BOARD_ONLY_OPERATIONS.has(key)) return true;
  return BOARD_ONLY_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function resolveOperationAuthLevel(
  method: string,
  path: string,
): OpenApiAuthLevel {
  const key = operationKey(method, path);
  if (PUBLIC_OPERATIONS.has(key)) return "public";
  if (key === "POST /api/mcp/project-tools" || key === "POST /api/companies/{companyId}/slack/tasks/{issueId}/tools" || key === "POST /api/companies/{companyId}/openwa/tasks/{issueId}/tools") return "agent_run";
  if (RUNTIME_TOOLS_OPERATIONS.has(key)) return "runtime_tools";
  if (INSTANCE_ADMIN_OPERATIONS.has(key)) return "instance_admin";
  if (
    isBoardOnlyOperation(method, path) ||
    experimentalApiMetadata[`${method.toUpperCase()} ${path}`]?.boardOnly
  )
    return "board";
  return "authenticated";
}

function applyOperationStatusOverride(
  operation: Record<string, unknown>,
  fromStatus: string,
  toStatus: string,
) {
  const responses = operation.responses as Record<string, unknown> | undefined;
  if (!responses || !responses[fromStatus] || responses[toStatus]) return;
  responses[toStatus] = responses[fromStatus];
  delete responses[fromStatus];
}

function applyDocumentFixups(document: any): any {
  document.components ??= {};
  document.components.securitySchemes = {
    [BOARD_SESSION_AUTH_SCHEME]: {
      type: "apiKey",
      in: "cookie",
      name: "paperclip_session",
      description:
        "Board session cookie in authenticated mode. Paperclip uses Better Auth; cookie transport may vary by deployment.",
    },
    [BOARD_API_KEY_AUTH_SCHEME]: {
      type: "http",
      scheme: "bearer",
      bearerFormat: "Board API Key",
      description:
        "Board API key presented in the Authorization bearer header.",
    },
    [AGENT_BEARER_AUTH_SCHEME]: {
      type: "http",
      scheme: "bearer",
      bearerFormat: "Agent API Key or Agent JWT",
      description:
        "Agent API key or Paperclip-issued local agent JWT presented in the Authorization bearer header.",
    },
    [RUNTIME_TOOLS_BEARER_AUTH_SCHEME]: {
      type: "http",
      scheme: "bearer",
      bearerFormat: "Heartbeat-bound runtime tools token",
      description:
        "Scoped token bound to an active heartbeat run and presented in the Authorization bearer header. The GitHub credential endpoint requires the distinct github_credentials scope.",
    },
    [AGENT_RUN_AUTH_SCHEME]: {
      type: "http",
      scheme: "bearer",
      bearerFormat: "Task-bound agent JWT",
      description: "Paperclip-issued JWT bound to an active task run. Agent API keys, board sessions, and connection-only tokens are rejected.",
    },
  };
  document.security = AUTHENTICATED_SECURITY;

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(
      pathItem as Record<string, any>,
    )) {
      const authLevel = resolveOperationAuthLevel(method, path);
      if (authLevel === "public") {
        operation.security = [];
      } else if (authLevel === "agent_run") {
        operation.security = [securityRequirement(AGENT_RUN_AUTH_SCHEME)];
      } else if (authLevel === "runtime_tools") {
        operation.security = RUNTIME_TOOLS_SECURITY;
      } else if (authLevel === "authenticated") {
        operation.security = AUTHENTICATED_SECURITY;
      } else {
        operation.security = BOARD_SECURITY;
      }

      operation["x-paperclip-authorization"] =
        authLevel === "instance_admin"
          ? { actor: "board", instanceAdmin: true }
          : authLevel === "board"
            ? { actor: "board" }
            : authLevel === "agent_run"
              ? { actor: "agent", heartbeatBound: true, taskBound: true }
            : authLevel === "runtime_tools"
              ? { actor: "runtime_tools", heartbeatBound: true }
              : authLevel === "authenticated"
                ? { actor: "board_or_agent" }
                : { actor: "public" };

      const key = operationKey(method, path);
      if (authLevel !== "public") {
        const responses = (operation.responses ??= {}) as Record<
          string,
          unknown
        >;
        if (!responses["403"]) {
          responses["403"] = FORBIDDEN_RESPONSE;
        }
      }
      if (CREATED_OPERATIONS.has(key)) {
        applyOperationStatusOverride(operation, "200", "201");
      }
      if (ACCEPTED_OPERATIONS.has(key)) {
        applyOperationStatusOverride(operation, "200", "202");
      }
    }
  }

  return document;
}

// ─── Health ──────────────────────────────────────────────────────────────────

// Shared by the healthy and database-unreachable responses: full details
// (including serverInfo) ride only on board/agent-actor responses.
const healthServerInfoSchema = z
  .object({
    processStartedAt: z.string().datetime(),
    git: z.union([
      z
        .object({
          available: z.literal(true),
          fullSha: z.string(),
          shortSha: z.string(),
          branchName: z.string().nullable(),
          subject: z.string(),
          committedAt: z.string().datetime().nullable(),
          localChanges: z.union([
            z
              .object({
                available: z.literal(true),
                hasLocalChanges: z.boolean(),
                stagedFileCount: z.number().int().nonnegative(),
                unstagedFileCount: z.number().int().nonnegative(),
                untrackedFileCount: z.number().int().nonnegative(),
              })
              .strict(),
            z
              .object({
                available: z.literal(false),
                unavailableReason: z.enum(["git_status_unavailable"]),
              })
              .strict(),
          ]),
        })
        .strict(),
      z
        .object({
          available: z.literal(false),
          unavailableReason: z.enum([
            "git_unavailable",
            "invalid_git_metadata",
          ]),
        })
        .strict(),
    ]),
  })
  .strict();

registry.registerPath({
  method: "get",
  path: "/api/health",
  tags: ["health"],
  summary: "Health check",
  responses: {
    200: r.ok(
      z.object({
        status: z.enum(["ok", "unhealthy"]),
        version: z.string().optional(),
        // Running build commit (full git SHA), or null when git metadata is
        // unavailable. Present on every response shape, including redacted ones.
        commit: z.string().nullable(),
        deploymentMode: z.string().optional(),
        cloud: z
          .object({
            managed: z.literal(true),
            managedBy: z.literal("paperclip-cloud"),
            stackSlug: z.string().nullable(),
            stackDisplayName: z.string().optional(),
            cloudBaseUrl: z.string().nullable(),
          })
          .strict()
          .optional(),
        bootstrapStatus: z.enum(["ready", "bootstrap_pending"]).optional(),
        bootstrapInviteActive: z.boolean().optional(),
        databaseBackup: z
          .object({
            enabled: z.boolean(),
            status: z.enum(["ok", "warning"]),
            backupDir: z.string().optional(),
            maxAgeHours: z.number().optional(),
            latestBackup: z
              .object({
                name: z.string(),
                path: z.string(),
                mtime: z.string().datetime(),
                ageHours: z.number(),
                sizeBytes: z.number(),
              })
              .nullable()
              .optional(),
            lastFailure: z
              .object({
                path: z.string(),
                mtime: z.string().datetime(),
                message: z.string(),
              })
              .nullable()
              .optional(),
            warnings: z.array(
              z.object({
                code: z.enum([
                  "database_backup_check_failed",
                  "database_backup_last_failure",
                  "database_backup_missing",
                  "database_backup_stale",
                ]),
                message: z.string(),
              }),
            ),
          })
          .optional(),
        warnings: z
          .array(
            z.object({
              code: z.string(),
              message: z.string(),
            }),
          )
          .optional(),
        serverInfo: healthServerInfoSchema.optional(),
      }),
    ),
    // The database-unreachable body still carries version and commit so
    // deployment tooling can verify the running build during an outage;
    // serverInfo rides only on full-details (board/agent) responses.
    503: {
      description: "Service unavailable",
      content: {
        "application/json": {
          schema: z.object({
            status: z.literal("unhealthy"),
            version: z.string(),
            serverVersion: z.string(),
            commit: z.string().nullable(),
            error: z.literal("database_unreachable"),
            serverInfo: healthServerInfoSchema.optional(),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/openapi.json",
  tags: ["health"],
  summary: "Get the generated OpenAPI document",
  responses: { 200: r.ok() },
});

// ─── Companies ───────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/cloud/stacks",
  tags: ["cloud"],
  summary: "List the current Cloud tenant user's stacks",
  responses: {
    200: r.ok(),
    403: r.forbidden,
    404: r.notFound,
    502: r.serverError,
    503: r.serverError,
    500: r.serverError,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/companies",
  tags: ["companies"],
  summary: "List companies",
  description:
    "Requires a board user. Instance admins can list the full directory; scope=accessible limits the list to companies the caller can enter.",
  request: {
    query: z.object({ scope: z.enum(["accessible"]).optional() }),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/companies",
  tags: ["companies"],
  summary: "Create a company",
  request: { body: jsonBody(createCompanySchema) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/stats",
  tags: ["companies"],
  summary: "Company stats",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}",
  tags: ["companies"],
  summary: "Get a company",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/artifacts",
  tags: ["companies"],
  summary: "List company artifacts",
  request: {
    params: z.object({ companyId: z.string() }),
    query: companyArtifactsQuerySchema,
  },
  responses: {
    200: {
      description: "Company artifact projection",
      content: {
        "application/json": {
          schema: companyArtifactsResponseSchema,
        },
      },
    },
    401: r.unauthorized,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/timeline",
  tags: ["companies"],
  summary: "Get company work timeline",
  request: {
    params: z.object({ companyId: z.string() }),
    query: workTimelineQuerySchema,
  },
  responses: {
    200: r.ok(workTimelineResponseSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/companies/{companyId}",
  tags: ["companies"],
  summary: "Update a company",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(updateCompanySchema.partial()),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/companies/{companyId}/branding",
  tags: ["companies"],
  summary: "Update company branding",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(updateCompanyBrandingSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/archive",
  tags: ["companies"],
  summary: "Archive a company",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "delete",
  path: "/api/companies/{companyId}",
  tags: ["companies"],
  summary: "Delete a company",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/feedback-traces",
  tags: ["companies"],
  summary: "List company feedback traces",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/exports",
  tags: ["companies"],
  summary: "Export company data",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/exports/preview",
  tags: ["companies"],
  summary: "Preview company export",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/imports/preview",
  tags: ["companies"],
  summary: "Preview company import",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/imports/apply",
  tags: ["companies"],
  summary: "Apply company import",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

for (const [method, path, summary, body] of browserUseOperations) {
  registerCurrentRoute({
    method, path, summary, body, tags: ["Browser Use Cloud"],
    ...(path.endsWith("/viewer") ? { query: browserUseViewerSchema.partial() } : {}),
    responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
  });
}

// Explicit task-bound email. Board setup and agent actions share the same vaulted
// connection, while automatic chat publication never applies to these endpoints.
registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/email/connections/{connectionId}/check-address",
  tags: ["Email"],
  summary: "Check for an existing AgentMail address using a saved credential",
  description: "Requires a board connection manager and enabled chat connectors. Read-only: does not create or reserve an inbox. A missing inbox returns unknown because AgentMail hides resources outside the credential scope; it is never proof of availability.",
  request: {
    params: z.object({ companyId: z.string().uuid(), connectionId: z.string().uuid() }),
    body: jsonBody(emailAddressCheckSchema),
  },
  responses: {
    200: r.ok(z.object({ address: z.string(), status: z.enum(["taken", "unknown"]) })),
    400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound,
    422: r.unprocessable, 429: { description: "AgentMail request limit reached; retry later" },
    502: r.serverError,
  },
});
for (const [method, path, summary, body, success] of [
  ["get", "/api/companies/{companyId}/email/connections", "List accessible saved AgentMail API keys (metadata only)", undefined, 200],
  ["post", "/api/companies/{companyId}/email/connections", "Save AgentMail credential and access", emailConnectionSchema, 201],
  ["post", "/api/companies/{companyId}/email/connections/{connectionId}/inspect", "Inspect inboxes using a saved AgentMail credential", undefined, 200],
  ["get", "/api/companies/{companyId}/email/inboxes", "List authorized AgentMail inboxes", undefined, 200],
  ["post", "/api/companies/{companyId}/email/inspect", "Inspect AgentMail inboxes and verified domains for setup", z.object({ apiKey: z.string().min(1).max(4096) }).strict(), 200],
  ["post", "/api/companies/{companyId}/email/inboxes", "Create or attach an agent email inbox", emailEndpointSetupSchema, 201],
  ["post", "/api/email/inboxes/{endpointId}/control", "Pause, resume or disconnect an email inbox", z.object({ action: z.enum(["pause", "resume", "remove"]) }).strict(), 200],
  ["post", "/api/email/inboxes/{endpointId}/reconnect", "Reconnect the same email inbox", z.object({ apiKey: z.string().min(1).max(4096), receiveMode: z.enum(["websocket", "webhook"]) }).strict(), 200],
  ["post", "/api/companies/{companyId}/email/send", "Explicitly send email: start a child task or reply to a bound conversation", emailSendSchema, 202],
  ["get", "/api/companies/{companyId}/email/tasks/{issueId}", "Read a task's email thread, full text context, recipients and delivery outcomes", undefined, 200],
  ["get", "/api/companies/{companyId}/email/deliveries/{publicationId}", "Check queued, sent, delivered, failed or uncertain email delivery", undefined, 200],
  ["post", "/api/companies/{companyId}/email/deliveries/{publicationId}/resolve", "Resolve uncertain email after checking the provider", z.object({ outcome: z.enum(["sent", "failed"]), providerMessageId: z.string().min(1).max(998).optional() }).strict(), 200],
] as const) {
  registry.registerPath({ method, path, tags: ["Email"], summary,
    description: "AgentMail email connection. Available without the experimental chat setting. Internal comments never send email. Agent sends require assigned inbox and task ownership, active run authority, and configured action policies. Preserve the same idempotencyKey and payload across retries. New conversations create an email child task; replies require conversationId and replyToMessageId. Reply-all is deliberate and never includes Bcc.",
    request: { params: z.object(Object.fromEntries([...path.matchAll(/\{([^}]+)\}/g)].map(match => [match[1], z.string().uuid()]))), ...(body ? { body: jsonBody(body) } : {}) },
    responses: { [success]: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
  });
}

// Slack bot tools use the verified task/run identity; setup and search grants
// remain board-only and company/endpoint scoped.
for (const [method, path, summary, body] of [
  ["get", "/api/companies/{companyId}/slack/endpoints/{endpointId}/capabilities", "Inspect Slack bot capabilities and missing scopes", undefined],
  ["get", "/api/companies/{companyId}/slack/endpoints/{endpointId}/search", "Read personal Slack search authorization status", undefined],
  ["put", "/api/companies/{companyId}/slack/endpoints/{endpointId}/search", "Configure optional Slack search OAuth credentials", slackSearchConfigSchema],
  ["post", "/api/companies/{companyId}/slack/endpoints/{endpointId}/search/connect", "Begin personal Slack search authorization", undefined],
  ["delete", "/api/companies/{companyId}/slack/endpoints/{endpointId}/search", "Disconnect personal Slack search and invalidate pending authorization", undefined],
  ["post", "/api/companies/{companyId}/slack/tasks/{issueId}/tools", "Execute a task-bound Slack bot tool", slackToolCallSchema],
] as const) {
  registry.registerPath({ method, path, tags: ["chat-channels"], summary,
    description: "Experimental Slack task tools. Current company, endpoint, linked requester, task/run authority and action permissions are revalidated. Bot credentials remain server-side. Search grants never authorize writes or expand bot membership. Native search is unavailable until the runtime qualifies transient result handling.",
    request: { params: z.object(Object.fromEntries([...path.matchAll(/\{([^}]+)\}/g)].map(match => [match[1], z.string().uuid()]))), ...(body ? { body: jsonBody(body) } : {}) },
    responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
  });
}
registry.registerPath({ method: "post", path: "/api/companies/{companyId}/openwa/tasks/{issueId}/tools", tags: ["chat-channels"], summary: "Execute a task-bound OpenWA WhatsApp tool",
  description: "Experimental OpenWA agent tools for runs on an OpenWA conversation issue or its child issues. Company, endpoint, session, run profile and approval grants come from the signed run, never from arguments. Errors carry a typed code such as approval_required, reply_denied, retry_after or number_not_on_whatsapp.",
  request: { params: z.object({ companyId: z.string().uuid(), issueId: z.string().uuid() }), body: jsonBody(openwaToolCallSchema) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});
registry.registerPath({ method: "get", path: "/api/slack/search/callback", tags: ["chat-channels"], summary: "Complete personal Slack search OAuth",
  description: "Requires the same signed-in user, single-use state, linked Slack identity and workspace; redirects to connector Access. Never accepts model-supplied identity.",
  request: { query: z.object({ state: z.string(), code: z.string() }) },
  responses: { 302: { description: "Redirect to connector Access" }, 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden },
});

// ─── Chat Channels ─────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/chat-endpoints",
  tags: ["chat-channels"],
  summary: "List chat endpoints in a company",
  description:
    "Lists non-archived provider bot endpoints visible to the current board user. Endpoints are company-scoped.",
  request: { params: z.object({ companyId: z.string().uuid() }) },
  responses: {
    200: r.ok(z.array(chatEndpointResponseSchema)),
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/chat-endpoints",
  tags: ["chat-channels"],
  summary: "Create a chat endpoint",
  description:
    "Creates one provider bot endpoint bound permanently to one Paperclip agent. Provider setup and verification happen in later calls.",
  request: {
    params: z.object({ companyId: z.string().uuid() }),
    body: jsonBody(createChatEndpointSchema),
  },
  responses: {
    201: r.ok(chatEndpointResponseSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/chat-endpoints/{endpointId}",
  tags: ["chat-channels"],
  summary: "Get a chat endpoint",
  description:
    "Returns a chat endpoint only when it belongs to a company accessible to the current board user; an inaccessible endpoint is reported as not found.",
  request: { params: z.object({ endpointId: z.string().uuid() }) },
  responses: {
    200: r.ok(chatEndpointResponseSchema),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

const githubConfigurationResponseSchema = z.object({
  companyId: z.string().uuid(),
  endpointId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  configuration: githubChatConfigurationSchema,
  updatedByUserId: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
const githubPersonResponseSchema = z.object({ githubUserId: z.string(), login: z.string() });
const githubBotOperations: Array<{
  method: string;
  suffix: string;
  summary: string;
  description: string;
  body?: z.ZodTypeAny;
  response: z.ZodTypeAny;
}> = [
  {
    method: "get", suffix: "configuration", summary: "Read GitHub bot review configuration",
    description: "Returns saved company-scoped configuration and its revision, or disabled defaults for an existing chat connection. Requires connection-management access.",
    response: githubConfigurationResponseSchema,
  },
  {
    method: "put", suffix: "configuration", summary: "Save GitHub bot review configuration",
    description: "Compares the configuration revision and rechecks members, sponsors, repositories, and agent tool governance. Does not change the bot's assigned agent or enable formal reviews implicitly.",
    body: updateGitHubChatConfigurationSchema, response: githubConfigurationResponseSchema,
  },
  {
    method: "post", suffix: "verify", summary: "Verify GitHub bot and assigned-agent capabilities",
    description: "Separately checks signed delivery, App identity, current repository permissions, effective tool access, and runtime support. Requires connection-management access.",
    response: z.object({ ready: z.boolean(), checks: z.array(z.object({ key: z.string(), label: z.string(), ok: z.boolean(), detail: z.string() })) }),
  },
  {
    method: "put", suffix: "progress", summary: "Save GitHub setup progress",
    description: "Saves the resumable wizard stage without granting access or bypassing verification.",
    body: z.object({ stage: z.enum(["connect", "install", "repositories", "verify", "identity", "behavior", "test"]) }).strict(),
    response: chatEndpointResponseSchema,
  },
  {
    method: "get", suffix: "reviews", summary: "List review evidence attached to Paperclip tasks",
    description: "Returns up to 100 newest review records for this endpoint. Each review references ordinary Paperclip tasks and runs; it is not an independent scheduler.",
    response: z.array(z.object({
      id: z.string().uuid(), companyId: z.string().uuid(), endpointId: z.string().uuid(),
      issueId: z.string().uuid(), runId: z.string().uuid().nullable(), repositoryId: z.string(),
      repository: z.string(), pullNumber: z.number().int(), headSha: z.string(),
      configurationRevision: z.number().int(), state: z.enum(["queued", "running", "completed", "incomplete", "error", "superseded", "manual_required"]),
      assessment: githubReviewAssessmentSchema.nullable(),
      conclusion: z.enum(["success", "failure", "neutral", "action_required"]).nullable(),
      checkUrl: z.string().nullable(), summaryUrl: z.string().nullable(),
      createdAt: z.string(), updatedAt: z.string(),
    }).passthrough()),
  },
  {
    method: "get", suffix: "personal-connections", summary: "List the current user's GitHub identity connections",
    description: "Lists only the signed-in user's GitHub grants in this company. Shared and agent credentials cannot prove a person's identity.",
    response: z.array(z.object({ connectionId: z.string().uuid(), name: z.string(), status: z.string(), login: z.string().nullable(), enabled: z.boolean() })),
  },
  {
    method: "post", suffix: "identity", summary: "Verify or confirm your own GitHub identity",
    description: "Resolves the current user's personal connection and verifies GET /user with GitHub. Omitting confirmedGithubUserId previews the identity; supplying its exact ID explicitly confirms ownership after revalidation.",
    body: z.object({ connectionId: z.string().uuid(), confirmedGithubUserId: z.string().regex(/^[1-9][0-9]*$/).optional() }).strict(),
    response: githubPersonResponseSchema.extend({ avatarUrl: z.string().nullable(), connectionId: z.string().uuid(), grantId: z.string().uuid() }),
  },
  {
    method: "post", suffix: "people/lookup", summary: "Resolve a GitHub username to its stable identity",
    description: "Verifies the account with GitHub. Lookup does not grant bot access, link a teammate, or confer the sponsor's credentials.",
    body: z.object({ login: z.string().min(1).max(44) }).strict(), response: githubPersonResponseSchema,
  },
  {
    method: "post", suffix: "registration", summary: "Prepare GitHub App manifest registration",
    description: "Creates expiring single-use state bound to the current user, company, endpoint, and trusted HTTPS origin. Return data contains the manifest and registration URL, never private App credentials. Response is not cached.",
    body: z.object({ name: z.string().trim().min(1).max(34) }).strict(),
    response: z.object({ expiresAt: z.string(), registrationUrl: z.string().url(), manifest: z.record(z.string(), z.unknown()) }),
  },
  {
    method: "post", suffix: "app", summary: "Connect an existing GitHub App",
    description: "Validates App identity with GitHub and vaults write-only credentials server-side. Installation and signed webhook delivery must still be verified.",
    body: z.object({ appId: z.string().regex(/^[1-9][0-9]*$/), privateKey: z.string().min(1).max(32000), webhookSecret: z.string().min(16).max(1024) }).strict(),
    response: chatEndpointResponseSchema,
  },
  {
    method: "post", suffix: "repositories/refresh", summary: "Refresh repositories available to the bot installation",
    description: "Fetches current installation access from GitHub and reconciles resources while preserving Paperclip repository enablement. Return parameters alone never prove installation access.",
    response: z.array(chatEndpointResourceResponseSchema),
  },
];
for (const operation of githubBotOperations) {
  registry.registerPath({
    method: operation.method,
    path: `/api/chat-endpoints/{endpointId}/github/${operation.suffix}`,
    tags: ["chat-channels"], summary: operation.summary, description: operation.description,
    request: {
      params: z.object({ endpointId: z.string().uuid() }),
      ...(operation.body ? { body: jsonBody(operation.body) } : {}),
    },
    responses: {
      200: r.ok(operation.response), 400: r.badRequest, 401: r.unauthorized,
      403: r.forbidden, 404: r.notFound, 409: r.conflict, 422: r.unprocessable,
      502: { description: "GitHub returned an invalid response or unavailable capability" },
      503: { description: "GitHub is temporarily unavailable" },
    },
  });
}

registry.registerPath({
  method: "patch",
  path: "/api/chat-endpoints/{endpointId}",
  tags: ["chat-channels"],
  summary: "Update chat endpoint access behavior",
  description:
    "Updates the small set of user-configurable access toggles. Provider identity, assigned agent, delivery mode, and maximal provider capabilities are not mutable here.",
  request: {
    params: z.object({ endpointId: z.string().uuid() }),
    body: jsonBody(updateChatEndpointSchema),
  },
  responses: {
    200: r.ok(chatEndpointResponseSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/chat-endpoints/{endpointId}/setup",
  tags: ["chat-channels"],
  summary: "Configure or change chat endpoint lifecycle state",
  description:
    "Runs a setup or lifecycle action. `configure` and `reconnect` accept provider credentials (Slack: `botToken`, `signingSecret`; GitHub: `appId`, `privateKey` after Paperclip generates the webhook secret; Discord: `applicationId`, `guildId`, `botToken`; Microsoft Teams: `clientId`, `tenantId`, `clientSecret`; Telegram: `botToken`; iMessage Photon: `projectSecret`, with nonsecret `photon.projectId` and `photon.lineId` configuration; OpenWA: `apiKey` and optional `adminApiKey`, with nonsecret `openwa.baseUrl`, `openwa.sessionId`, `openwa.numberMode`, and required `openwa.attestations`). Credentials are stored as Paperclip secret references and are never returned. Other actions do not require credentials.",
  request: {
    params: z.object({ endpointId: z.string().uuid() }),
    body: jsonBody(configureChatEndpointSchema),
  },
  responses: {
    200: r.ok(chatEndpointResponseSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
    429: { description: "Provider request limit reached; retry later" },
    502: { description: "Provider returned an invalid response; inspect provider health" },
    503: { description: "Provider temporarily unavailable; retry later" },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/chat-endpoints/{endpointId}/setup-secret",
  tags: ["chat-channels"],
  summary: "Generate a GitHub webhook secret",
  description:
    "Generates and vaults a new GitHub webhook secret. The plaintext value is returned exactly once for entry in GitHub; normal endpoint reads expose only whether one is configured. Regeneration immediately rotates the server-side value.",
  request: { params: z.object({ endpointId: z.string().uuid() }) },
  responses: {
    201: r.ok(chatEndpointSetupSecretResponseSchema),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/chat-endpoints/{endpointId}/photon/inspect",
  tags: ["chat-channels"],
  summary: "Inspect Photon shared project or dedicated numbers for channel setup",
  description:
    "Requires a board user with connection-management access. The project secret is write-only input. Returns the project's actual allocation and eligibility for shared DMs or dedicated lines, never project secrets or minted line tokens. Responses are not cached. Inspection alone does not activate the channel.",
  request: {
    params: z.object({ endpointId: z.string().uuid() }),
    body: jsonBody(inspectPhotonProjectSchema),
  },
  responses: {
    200: r.ok(z.object({
      projectId: photonProjectIdSchema,
      projectName: z.string(),
      allocation: z.enum(["dedicated", "shared"]),
      eligible: z.boolean(),
      lines: z.array(z.object({
        lineId: photonLineIdSchema,
        phoneNumber: z.string(),
        eligible: z.boolean(),
        unavailableReason: z.string().optional(),
      }).strict()),
    }).strict()),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
    429: { description: "Photon request limit reached; retry later" },
    502: { description: "Photon returned an invalid response; inspect provider health" },
    503: { description: "Photon temporarily unavailable; retry later" },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/chat-endpoints/{endpointId}/openwa/inspect",
  tags: ["chat-channels"],
  summary: "Inspect an OpenWA gateway and its sessions for channel setup",
  description:
    "Requires a board user with connection-management access. The API keys are write-only input. Rejects agents whose adapter cannot authenticate runs with signed run tokens and keys restricted to selected chats. Returns the gateway version, engine, key role, visible sessions with masked numbers, and warnings; never keys or full phone numbers. Responses are not cached. Inspection alone does not activate the channel.",
  request: {
    params: z.object({ endpointId: z.string().uuid() }),
    body: jsonBody(inspectOpenwaGatewaySchema),
  },
  responses: {
    200: r.ok(z.object({
      baseUrl: z.string(),
      gatewayVersion: z.string().nullable(),
      pinnedVersion: z.string(),
      engine: z.string().nullable(),
      keyRole: z.enum(["operator", "admin", "viewer"]),
      adminKey: z.object({ role: z.enum(["operator", "admin", "viewer"]) }).strict().nullable(),
      warnings: z.array(z.string()),
      eligible: z.boolean(),
      sessions: z.array(z.object({
        sessionId: z.string(),
        name: z.string(),
        status: z.string(),
        maskedNumber: z.string().nullable(),
        pushName: z.string().nullable(),
        eligible: z.boolean(),
        unavailableReason: z.string().optional(),
      }).strict()),
    }).strict()),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
    429: { description: "OpenWA gateway request limit reached; retry later" },
    502: { description: "OpenWA gateway returned an invalid response; inspect gateway health" },
    503: { description: "OpenWA gateway unreachable; do not replace credentials" },
  },
});

const openwaOwnerResponseSchema = z
  .object({
    id: z.string().uuid(),
    identityLinkId: z.string().uuid(),
    principalId: z.string().uuid(),
    numberMasked: z.string(),
    displayName: z.string().nullable(),
    linkStatus: chatIdentityLinkStatusSchema,
    paperclipUserId: z.string().nullable(),
    effective: z.boolean(),
    createdAt: z.string(),
  })
  .strict();

const openwaSenderRuleResponseSchema = z
  .object({
    id: z.string().uuid(),
    list: z.enum(["allow", "deny"]),
    e164: z.string(),
    label: z.string().nullable(),
    createdAt: z.string(),
  })
  .strict();

const openwaChatResponseSchema = z
  .object({
    id: z.string().uuid(),
    chatId: z.string(),
    chatKey: z.string(),
    type: z.string(),
    label: z.string(),
    availability: chatResourceAvailabilitySchema,
    enabled: z.boolean(),
    settings: openwaChatSettingsSchema,
    ownerPresent: z.boolean().nullable(),
    participantCount: z.number().int().nullable(),
  })
  .strict();

const openwaEndpointParams = z.object({ endpointId: z.string().uuid() });

registry.registerPath({
  method: "get",
  path: "/api/chat-endpoints/{endpointId}/openwa/owners",
  tags: ["chat-channels"],
  summary: "List OpenWA owners",
  description:
    "Lists the WhatsApp numbers registered as owners of an OpenWA endpoint, with masked numbers and whether each owner is currently effective (identity link confirmed and active, non-viewer company membership). Responses are not cached.",
  request: { params: openwaEndpointParams },
  responses: { 200: r.ok(z.array(openwaOwnerResponseSchema)), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/chat-endpoints/{endpointId}/openwa/owners",
  tags: ["chat-channels"],
  summary: "Add an OpenWA owner",
  description:
    "Requires connection-management access. Registers an E.164 WhatsApp number as an owner and, unless that number is already linked, returns a short-lived identity-link confirmation URL. The owner gains authority only after a Paperclip user with active, non-viewer membership confirms the link. Returns 201 when a new owner row is created and 200 when it already existed. Records openwa.owner_added.",
  request: { params: openwaEndpointParams, body: jsonBody(addOpenwaOwnerSchema) },
  responses: {
    200: r.ok(z.object({ owner: openwaOwnerResponseSchema.nullable(), created: z.boolean(), confirmationUrl: z.string().nullable(), expiresAt: z.string().nullable() }).strict()),
    201: r.ok(z.object({ owner: openwaOwnerResponseSchema.nullable(), created: z.boolean(), confirmationUrl: z.string().nullable(), expiresAt: z.string().nullable() }).strict()),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/chat-endpoints/{endpointId}/openwa/owners/{ownerId}",
  tags: ["chat-channels"],
  summary: "Remove an OpenWA owner",
  description: "Requires connection-management access. Removes the owner role; the identity link itself is kept. Records openwa.owner_removed.",
  request: { params: z.object({ endpointId: z.string().uuid(), ownerId: z.string().uuid() }) },
  responses: { 204: r.noContent, 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/chat-endpoints/{endpointId}/openwa/sender-rules",
  tags: ["chat-channels"],
  summary: "List OpenWA sender allow and deny rules",
  request: { params: openwaEndpointParams },
  responses: { 200: r.ok(z.array(openwaSenderRuleResponseSchema)), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/chat-endpoints/{endpointId}/openwa/sender-rules",
  tags: ["chat-channels"],
  summary: "Add an OpenWA sender rule",
  description:
    "Requires connection-management access. Adds an E.164 number to the allowlist or denylist; re-adding an existing entry updates its label. Owners are never blocked by the denylist. Records openwa.sender_rule_changed with a masked number.",
  request: { params: openwaEndpointParams, body: jsonBody(createOpenwaSenderRuleSchema) },
  responses: { 201: r.ok(openwaSenderRuleResponseSchema), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict, 422: r.unprocessable },
});

registry.registerPath({
  method: "delete",
  path: "/api/chat-endpoints/{endpointId}/openwa/sender-rules/{ruleId}",
  tags: ["chat-channels"],
  summary: "Remove an OpenWA sender rule",
  description: "Requires connection-management access. Records openwa.sender_rule_changed.",
  request: { params: z.object({ endpointId: z.string().uuid(), ruleId: z.string().uuid() }) },
  responses: { 204: r.noContent, 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/chat-endpoints/{endpointId}/openwa/chats",
  tags: ["chat-channels"],
  summary: "List configured OpenWA chats",
  description: "Lists WhatsApp chats known to the endpoint with their activation, trigger overrides, reply policy, and owner presence for groups.",
  request: { params: openwaEndpointParams },
  responses: { 200: r.ok(z.array(openwaChatResponseSchema)), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

registry.registerPath({
  method: "put",
  path: "/api/chat-endpoints/{endpointId}/openwa/chats",
  tags: ["chat-channels"],
  summary: "Save OpenWA per-chat settings",
  description:
    "Requires connection-management access. Upserts activation (off, on, auto), trigger overrides, absence seconds, and reply policy for one chat. Per-chat settings win over endpoint defaults. Records openwa.chat_activation_changed and openwa.config_changed.",
  request: { params: openwaEndpointParams, body: jsonBody(updateOpenwaChatSettingsSchema) },
  responses: { 200: r.ok(openwaChatResponseSchema), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict, 422: r.unprocessable },
});

registry.registerPath({
  method: "get",
  path: "/api/chat-endpoints/{endpointId}/openwa/gateway-chats",
  tags: ["chat-channels"],
  summary: "List chats from the OpenWA gateway for the chat picker",
  description:
    "Requires connection-management access. Reads the session's chats from the gateway and annotates each with its configured activation. Direct-chat names are masked. Responses are not cached.",
  request: {
    params: openwaEndpointParams,
    query: z.object({ limit: z.coerce.number().int().min(1).max(500).optional(), offset: z.coerce.number().int().min(0).max(100_000).optional() }),
  },
  responses: {
    200: r.ok(z.array(z.object({ chatId: z.string(), isGroup: z.boolean(), name: z.string(), lastActivityAt: z.string().nullable(), activation: z.enum(["off", "on", "auto"]), configured: z.boolean() }).strict())),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
    502: { description: "OpenWA gateway returned an invalid response" },
    503: { description: "OpenWA gateway unreachable" },
  },
});

const openwaLinkedChatResponseSchema = z.object({ chatId: z.string(), label: z.string(), isGroup: z.boolean() }).strict();

const openwaLinkedSessionResponseSchema = z
  .object({
    id: z.string().uuid(),
    sessionId: z.string(),
    label: z.string(),
    phoneMasked: z.string().nullable(),
    pushName: z.string().nullable(),
    status: z.enum(["active", "unavailable"]),
    allowedChats: z.array(openwaLinkedChatResponseSchema),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

const openwaLinkedParams = z.object({ endpointId: z.string().uuid(), linkedId: z.string().uuid() });

const openwaLinkedGatewayErrors = {
  502: { description: "OpenWA gateway returned an invalid response" },
  503: { description: "OpenWA gateway unreachable" },
};

registry.registerPath({
  method: "get",
  path: "/api/chat-endpoints/{endpointId}/openwa/linked-sessions",
  tags: ["chat-channels"],
  summary: "List linked read-only OpenWA numbers",
  description:
    "Lists OpenWA sessions linked to this endpoint for owner-run reads, with their allowed chats. Never returns the viewer key or its secret id. Responses are not cached.",
  request: { params: openwaEndpointParams },
  responses: { 200: r.ok(z.array(openwaLinkedSessionResponseSchema)), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/chat-endpoints/{endpointId}/openwa/linkable-sessions",
  tags: ["chat-channels"],
  summary: "List gateway sessions that can be linked",
  description:
    "Requires connection-management access and the endpoint's OpenWA admin key. Lists gateway sessions other than the agent's own session and those already linked. Numbers are masked.",
  request: { params: openwaEndpointParams },
  responses: {
    200: r.ok(z.array(z.object({ sessionId: z.string(), name: z.string(), status: z.string(), phoneMasked: z.string().nullable(), pushName: z.string().nullable() }).strict())),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
    ...openwaLinkedGatewayErrors,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/chat-endpoints/{endpointId}/openwa/linked-sessions",
  tags: ["chat-channels"],
  summary: "Link a read-only OpenWA number",
  description:
    "Requires connection-management access. Creates a viewer OpenWA API key scoped to the session with the endpoint's admin key, stores it as a Paperclip-managed secret, and links the session with no allowed chats. Fails 422 openwa_admin_key_required without an admin key and 422 openwa_linked_is_agent_session for the agent's own session. Records openwa.linked_session_added.",
  request: { params: openwaEndpointParams, body: jsonBody(linkOpenwaSessionSchema) },
  responses: {
    201: r.ok(openwaLinkedSessionResponseSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
    ...openwaLinkedGatewayErrors,
  },
});

registry.registerPath({
  method: "put",
  path: "/api/chat-endpoints/{endpointId}/openwa/linked-sessions/{linkedId}/chats",
  tags: ["chat-channels"],
  summary: "Replace the allowed chats of a linked OpenWA number",
  description:
    "Requires connection-management access. Replaces the chat allowlist the assigned agent may read in owner-triggered runs. Records openwa.linked_session_chats_changed with counts only.",
  request: { params: openwaLinkedParams, body: jsonBody(updateOpenwaLinkedChatsSchema) },
  responses: { 200: r.ok(openwaLinkedSessionResponseSchema), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});

registry.registerPath({
  method: "delete",
  path: "/api/chat-endpoints/{endpointId}/openwa/linked-sessions/{linkedId}",
  tags: ["chat-channels"],
  summary: "Unlink a read-only OpenWA number",
  description:
    "Requires connection-management access. Removes the link, deletes the stored secret, and records openwa.linked_session_removed. Revoking the viewer key on the gateway is best-effort: when the admin key is missing or rejected or the gateway is unreachable, the link is still removed and the response has revoked=false with a warning naming the key to revoke in the OpenWA dashboard.",
  request: { params: openwaLinkedParams },
  responses: {
    200: r.ok(z.object({ revoked: z.boolean(), warning: z.string().optional() }).strict()),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/chat-endpoints/{endpointId}/openwa/linked-sessions/{linkedId}/gateway-chats",
  tags: ["chat-channels"],
  summary: "List a linked number's chats for the allowlist picker",
  description:
    "Requires connection-management access. Reads the linked session's chats with its viewer key: names and ids only, never message bodies. Direct-chat names are masked. Responses are not cached.",
  request: {
    params: openwaLinkedParams,
    query: z.object({ limit: z.coerce.number().int().min(1).max(500).optional(), offset: z.coerce.number().int().min(0).max(100_000).optional() }),
  },
  responses: {
    200: r.ok(z.array(z.object({ chatId: z.string(), isGroup: z.boolean(), name: z.string(), allowed: z.boolean() }).strict())),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    ...openwaLinkedGatewayErrors,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/chat-endpoints/{endpointId}/openwa/health",
  tags: ["chat-channels"],
  summary: "Read OpenWA gateway and session health",
  description:
    "Connection managers only. Reads the gateway version, engine, session status, and restriction with the stored operator key, plus pacing attestation and the latest observed pacing limit from the endpoint audit. Never returns keys or full phone numbers. Gateway failures are reported in gatewayError instead of an error status. Responses are not cached.",
  request: { params: openwaEndpointParams },
  responses: {
    200: r.ok(
      z
        .object({
          gatewayVersion: z.string().nullable(),
          pinnedVersion: z.string(),
          engine: z.string().nullable(),
          session: z
            .object({
              status: z.string().nullable(),
              maskedNumber: z.string().nullable(),
              restriction: z.object({ active: z.boolean(), kind: z.string().nullable(), expiresAt: z.string().nullable() }).strict().nullable(),
            })
            .strict(),
          pacing: z.object({ attested: z.boolean(), observedAt: z.string().nullable() }).strict(),
          adminKeyConfigured: z.boolean(),
          gatewayError: z.string().nullable(),
          checkedAt: z.string(),
        })
        .strict(),
    ),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/chat-endpoints/{endpointId}/openwa/policy",
  tags: ["chat-channels"],
  summary: "Update the OpenWA endpoint policy",
  description:
    "Requires connection-management access. Merges the patch into the stored policy, validates the result against the full OpenWA policy schema, and bumps the policy revision when anything changed. The optional inflightMode key (steer or queue) sets how messages arriving during a run are handled and is stored outside the policy. Records openwa.config_changed with the changed keys only, plus inflightMode before/after when it changed.",
  request: { params: openwaEndpointParams, body: jsonBody(updateOpenwaEndpointPolicySchema) },
  responses: {
    200: r.ok(
      z
        .object({
          policy: openwaEndpointPolicyResponseSchema,
          policyRevision: z.number().int().min(0),
          inflightMode: chatInflightModeSchema,
        })
        .strict(),
    ),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

const openwaApprovalResponseSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(["pending", "approved", "rejected", "cancelled"]),
    categories: z.array(z.string()),
    scope: z.enum(["one_action", "requester"]),
    summary: z.string(),
    proposedAction: z.string(),
    originChat: z.string(),
    requester: z.string().nullable(),
    originConversationId: z.string().uuid().nullable(),
    interactionId: z.string().uuid().nullable(),
    reminderCount: z.number().int().min(0),
    resolvedVia: z.enum(["whatsapp", "paperclip"]).nullable(),
    resolvedByUserId: z.string().nullable(),
    ownerText: z.string().nullable(),
    agentConditions: z.string().nullable(),
    resolvedAt: z.string().nullable(),
    createdAt: z.string(),
    grants: z.array(z.object({ id: z.string().uuid(), category: z.string(), status: z.string(), expiresAt: z.string() }).strict()),
    canResolve: z.boolean(),
  })
  .strict();

registry.registerPath({
  method: "get",
  path: "/api/chat-endpoints/{endpointId}/openwa/approvals",
  tags: ["chat-channels"],
  summary: "List OpenWA owner approval requests",
  description:
    "Lists the newest 100 owner approval requests of an OpenWA endpoint, optionally filtered by status, with their grants. Owner text and agent conditions are returned only to current endpoint owners; canResolve is true for a current owner on a pending request. Responses are not cached.",
  request: { params: openwaEndpointParams, query: listOpenwaApprovalsQuerySchema },
  responses: { 200: r.ok(z.array(openwaApprovalResponseSchema)), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/chat-endpoints/{endpointId}/openwa/approvals/{requestId}/resolve",
  tags: ["chat-channels"],
  summary: "Approve or reject an OpenWA owner approval request",
  description:
    "Only a board user linked as a current owner of the endpoint may resolve. Uses the same first-resolution-wins path as WhatsApp replies and the generic interaction routes: approving writes the grants and wakes the agent with approval_resolved (grant); rejecting wakes it with approval_resolved (other). A request already resolved returns 409 already_resolved. Records openwa.approval_resolved.",
  request: { params: z.object({ endpointId: z.string().uuid(), requestId: z.string().uuid() }), body: jsonBody(resolveOpenwaApprovalSchema) },
  responses: {
    200: r.ok(z.object({ requestId: z.string().uuid(), status: z.enum(["approved", "rejected"]), grantIds: z.array(z.string().uuid()) }).strict()),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/chat-endpoints/{endpointId}/openwa/approvals/{requestId}/cancel",
  tags: ["chat-channels"],
  summary: "Cancel a pending OpenWA owner approval request",
  description:
    "Only a board user linked as a current owner of the endpoint may cancel. Only a pending request can be cancelled: it becomes cancelled, its reminders stop and its approval card is withdrawn. No grant is written and the agent is not woken; later wakes no longer list it as pending. A request that is no longer pending returns 409 already_resolved with requestStatus. Records openwa.approval_cancelled.",
  request: { params: z.object({ endpointId: z.string().uuid(), requestId: z.string().uuid() }) },
  responses: {
    200: r.ok(z.object({ requestId: z.string().uuid(), status: z.literal("cancelled") }).strict()),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "post", path: "/api/chat-endpoints/{endpointId}/finish", tags: ["chat-channels"],
  summary: "Finish Slack or GitHub onboarding with an optional conversation test",
  description: "Requires verified provider delivery and an authorized identity linked to the current user. GitHub also checks the assigned agent’s current bot capabilities. Records that a full conversation test was not required.",
  request: { params: z.object({ endpointId: z.string().uuid() }) },
  responses: { 200: r.ok(chatEndpointResponseSchema), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});
registry.registerPath({
  method: "get", path: "/api/chat-endpoints/{endpointId}/test-status", tags: ["chat-channels"],
  summary: "Check for the current user's first setup message",
  request: { params: z.object({ endpointId: z.string().uuid() }) },
  responses: { 200: r.ok(z.object({ messageReceivedAt: z.string().nullable() })), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});
registry.registerPath({
  method: "post", path: "/api/chat-identity-links/request-access", tags: ["chat-channels"],
  summary: "Request company membership using a private Slack identity link",
  description: "Creates a pending human join request for admin approval. Requires a valid, unexpired self-service token and a signed-in user. Does not grant access or link an identity.",
  request: { body: jsonBody(confirmChatIdentityLinkSchema) },
  responses: { 200: r.ok(z.object({ status: z.enum(["member", "pending_approval"]) })), 401: r.unauthorized, 403: r.forbidden, 422: r.unprocessable },
});

registry.registerPath({
  method: "post",
  path: "/api/chat-endpoints/{endpointId}/test",
  tags: ["chat-channels"],
  summary: "Complete a chat endpoint setup test",
  description:
    "Activates a verifying endpoint only after Paperclip has received a real provider event since the server-issued setup test boundary. iMessage Photon additionally requires a fresh linked sender's task and a successful outbound agent publication.",
  request: { params: z.object({ endpointId: z.string().uuid() }) },
  responses: {
    200: r.ok(chatEndpointResponseSchema),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/chat-endpoints/{endpointId}/resources",
  tags: ["chat-channels"],
  summary: "List destinations discovered for a chat endpoint",
  description:
    "Lists provider destinations such as Slack and Discord channels, Teams channels, GitHub repositories, Telegram chats, and iMessage Photon groups. Direct-message resources are intentionally omitted.",
  request: { params: z.object({ endpointId: z.string().uuid() }) },
  responses: {
    200: r.ok(z.array(chatEndpointResourceResponseSchema)),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "put",
  path: "/api/chat-endpoints/{endpointId}/resources",
  tags: ["chat-channels"],
  summary: "Replace chat endpoint destination access",
  description:
    "Enables or disables known provider destinations. Every resource must belong to the endpoint, and an unavailable or removed provider destination cannot be enabled.",
  request: {
    params: z.object({ endpointId: z.string().uuid() }),
    body: jsonBody(replaceChatEndpointResourcesSchema),
  },
  responses: {
    200: r.ok(z.array(chatEndpointResourceResponseSchema)),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/chat-endpoints/{endpointId}/principals",
  tags: ["chat-channels"],
  summary: "List external identities seen by a chat endpoint",
  description:
    "Lists provider identities and their explicit Paperclip identity-link status for this endpoint's provider account.",
  request: { params: z.object({ endpointId: z.string().uuid() }) },
  responses: {
    200: r.ok(z.array(chatPrincipalLinkResponseSchema)),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/chat-endpoints/{endpointId}/principals/{principalId}/link-intent",
  tags: ["chat-channels"],
  summary: "Create an external identity-link intent",
  description:
    "Creates a short-lived confirmation URL for a human external identity belonging to this endpoint. The signed-in Paperclip user must confirm the link separately.",
  request: {
    params: z.object({
      endpointId: z.string().uuid(),
      principalId: z.string().uuid(),
    }),
    body: jsonBody(createChatIdentityLinkIntentSchema),
  },
  responses: {
    201: r.ok(chatIdentityLinkIntentResponseSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/chat-endpoints/{endpointId}/principals/{principalId}/link",
  tags: ["chat-channels"],
  summary: "Revoke an external identity link",
  description:
    "Revokes the endpoint-scoped link for the external identity. An inaccessible endpoint or missing link is reported as not found.",
  request: {
    params: z.object({
      endpointId: z.string().uuid(),
      principalId: z.string().uuid(),
    }),
  },
  responses: {
    204: r.noContent,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/chat-identity-links/preview",
  tags: ["chat-channels"],
  summary: "Preview an external identity-link intent",
  description:
    "Returns the company and provider identity that a valid, unexpired confirmation token would link. Admin-created links require company access. Private links issued to a signed Slack sender allow a signed-in recipient to preview that identity and request company access.",
  request: {
    query: z.object({ token: z.string().min(32).max(4096) }).strict(),
  },
  responses: {
    200: r.ok(chatIdentityLinkPreviewResponseSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/chat-identity-links/confirm",
  tags: ["chat-channels"],
  summary: "Confirm an external identity link",
  description:
    "Links the token's external identity to the currently signed-in Paperclip user after rechecking active company membership and canonical-link conflicts.",
  request: { body: jsonBody(confirmChatIdentityLinkSchema) },
  responses: {
    200: r.ok(chatIdentityLinkConfirmationResponseSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/chat-endpoints/{endpointId}/conversations",
  tags: ["chat-channels"],
  summary: "List external conversations and bound tasks",
  description:
    "Lists each durable provider conversation-to-Paperclip-task binding for the endpoint, including provider and task links and the latest publication state.",
  request: { params: z.object({ endpointId: z.string().uuid() }) },
  responses: {
    200: r.ok(z.array(chatConversationResponseSchema)),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/chat-endpoints/{endpointId}/activity",
  tags: ["chat-channels"],
  summary: "List chat endpoint delivery and publication activity",
  description:
    "Returns the endpoint's recent redacted inbound-delivery and outbound-publication ledger, including whether a failed item can be replayed. Supply limit (1–100) for a page object and follow nextCursor for older activity. Requests without pagination parameters retain the legacy recent-100 array.",
  request: { params: z.object({ endpointId: z.string().uuid() }), query: z.object({ limit: z.coerce.number().int().min(1).max(100).optional(), cursor: z.string().max(256).optional() }) },
  responses: {
    200: r.ok(z.union([z.array(chatActivityResponseSchema), z.object({ items: z.array(chatActivityResponseSchema), nextCursor: z.string().nullable() })])),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

const chatAuditEntryResponseSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(CHAT_AUDIT_ENTRY_KINDS),
  actorKind: z.enum(CHAT_AUDIT_ACTOR_KINDS),
  actorRef: z.string().nullable(),
  chatKey: z.string().nullable(),
  conversationId: z.string().uuid().nullable(),
  runId: z.string().uuid().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  content: z.record(z.string(), z.unknown()).nullable(),
  contentPurged: z.boolean(),
  occurredAt: z.string(),
}).strict();

registry.registerPath({
  method: "get",
  path: "/api/chat-endpoints/{endpointId}/audit",
  tags: ["chat-channels"],
  summary: "List the OpenWA endpoint audit trail",
  description:
    "Returns the endpoint's audit entries newest first with cursor paging (limit 1–100, default 25; follow nextCursor). Filters: kind (comma-separated or repeated), chatKey, actorKind, actorRef, from and to (ISO timestamps, inclusive). Endpoint owners and company owners receive content (message text, owner text, redacted tool arguments); other board users with endpoint access receive metadata only and `access` is `metadata`. Content is purged after the endpoint's retention period; purged entries keep their metadata and report contentPurged.",
  request: {
    params: z.object({ endpointId: z.string().uuid() }),
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).optional(),
      cursor: z.string().max(256).optional(),
      kind: z.string().optional(),
      chatKey: z.string().max(256).optional(),
      actorKind: z.enum(CHAT_AUDIT_ACTOR_KINDS).optional(),
      actorRef: z.string().max(256).optional(),
      from: z.string().datetime({ offset: true }).optional(),
      to: z.string().datetime({ offset: true }).optional(),
    }),
  },
  responses: {
    200: r.ok(z.object({
      items: z.array(chatAuditEntryResponseSchema),
      nextCursor: z.string().nullable(),
      access: z.enum(["content", "metadata"]),
    }).strict()),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/chat-endpoints/{endpointId}/deliveries/{deliveryId}/replay",
  tags: ["chat-channels"],
  summary: "Replay a failed inbound chat delivery",
  description:
    "Retries a failed delivery only when it is already bound to a task. Concurrent or ineligible replay attempts return a conflict.",
  request: {
    params: z.object({
      endpointId: z.string().uuid(),
      deliveryId: z.string().uuid(),
    }),
  },
  responses: {
    204: r.noContent,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/chat-endpoints/{endpointId}/publications/{publicationId}/replay",
  tags: ["chat-channels"],
  summary: "Replay a failed chat publication",
  description:
    "Retries only a publication in `failed` state. Ambiguous `delivery_unknown` rows require an explicit operator resolution instead.",
  request: {
    params: z.object({
      endpointId: z.string().uuid(),
      publicationId: z.string().uuid(),
    }),
  },
  responses: {
    204: r.noContent,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/chat-endpoints/{endpointId}/publications/{publicationId}/resolve",
  tags: ["chat-channels"],
  summary: "Resolve an unconfirmed chat publication",
  description:
    "After checking the provider conversation, an operator may mark an ambiguous publication delivered, retry it while accepting duplicate risk, or cancel it. Every resolution is audited.",
  request: {
    params: z.object({
      endpointId: z.string().uuid(),
      publicationId: z.string().uuid(),
    }),
    body: jsonBody(resolveChatPublicationSchema),
  },
  responses: {
    204: r.noContent,
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/chat-endpoints/{endpointId}/actions/{actionId}/resolve",
  tags: ["chat-channels"],
  summary: "Resolve an unconfirmed provider action",
  description:
    "After checking the provider, an operator may mark an ambiguous durable provider reply delivered, retry it while accepting duplicate risk, or cancel it. Slack slash-command task starts support explicit retry or cancel only. Paperclip never replays an ambiguous provider action automatically, and every resolution is audited.",
  request: {
    params: z.object({
      endpointId: z.string().uuid(),
      actionId: z.string().uuid(),
    }),
    body: jsonBody(resolveChatActionSchema),
  },
  responses: {
    204: r.noContent,
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/chat-endpoints/{endpointId}/conversations/{conversationId}/publications",
  tags: ["chat-channels"],
  summary: "Publish a Paperclip task comment to an external conversation",
  description:
    "Explicitly projects an eligible comment from the bound Paperclip task into the provider conversation. The endpoint, conversation, and comment must belong to the same binding. A Board send with an already-bound attachment returns 409 with code chat_board_send_attachments_already_bound and request-scoped details (endpointId, conversationId, idempotencyKey, attachmentIds). This durable rejection queues no publication and is replayed for the same key even if the file later becomes unbound. Correcting it requires an explicit new send identity. Other errors do not establish non-delivery.",
  request: {
    params: z.object({
      endpointId: z.string().uuid(),
      conversationId: z.string().uuid(),
    }),
    body: jsonBody(publishChatPublicationSchema),
  },
  responses: {
    201: r.ok(chatPublicationResponseSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{issueId}/chat-binding",
  tags: ["chat-channels", "issues"],
  summary: "Get a task's external chat binding",
  description:
    "Returns the task's current external conversation binding, or `null` when it has none. Requires a task UUID; synthetic agent-chat view IDs are invalid. A binding in another company is reported as not found.",
  request: { params: z.object({ issueId: z.string().uuid() }) },
  responses: {
    200: r.ok(externalChannelBindingResponseSchema.nullable()),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/chat-endpoints/{endpointId}/conversations/{conversationId}/publications/{publicationId}/status",
  tags: ["chat-channels"],
  summary: "Read authoritative delivery status for a Board publication batch",
  description:
    "Returns the complete ordered batch, its first unresolved part and separate delivered, waiting, declined, expired and cancelled counts. Dismissal is allowed only when every part is settled; a consent card or upload receipt is not final file delivery. This read-only endpoint never retries or sends provider messages. The original publication ID remains a stable batch anchor.",
  request: {
    params: z.object({
      endpointId: z.string().uuid(),
      conversationId: z.string().uuid(),
      publicationId: z.string().uuid(),
    }),
  },
  responses: {
    200: r.ok(
      z
        .object({
          publication: chatPublicationResponseSchema.pick({
            id: true,
            state: true,
            providerUrl: true,
            attempts: true,
            redactedError: true,
            nextAttemptAt: true,
            publishedAt: true,
            fileTransfer: true,
          }),
          total: z.number().int().positive(),
          published: z.number().int().nonnegative(),
          parts: z.array(
            chatPublicationResponseSchema.pick({
              id: true,
              state: true,
              providerUrl: true,
              attempts: true,
              redactedError: true,
              nextAttemptAt: true,
              publishedAt: true,
              fileTransfer: true,
            }),
          ),
          awaitingConsent: z.number().int().nonnegative(),
          declined: z.number().int().nonnegative(),
          expired: z.number().int().nonnegative(),
          cancelled: z.number().int().nonnegative(),
          settled: z.number().int().nonnegative(),
          canDismiss: z.boolean(),
        })
        .strict(),
    ),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

// ─── Teams Catalog ──────────────────────────────────────────────────────────

for (const route of [
  ["get", "/api/teams/catalog", "List catalog teams"],
  ["get", "/api/teams/catalog/{catalogId}/files", "Get catalog team file"],
  ["get", "/api/teams/catalog/{catalogId}", "Get catalog team"],
  [
    "get",
    "/api/companies/{companyId}/teams/catalog/installed",
    "List installed catalog teams",
  ],
  [
    "post",
    "/api/companies/{companyId}/teams/catalog/{catalogId}/preview",
    "Preview catalog team install",
  ],
  [
    "post",
    "/api/companies/{companyId}/teams/catalog/{catalogId}/install",
    "Install catalog team",
  ],
] as const) {
  registerCurrentRoute({
    method: route[0],
    path: route[1],
    tags: ["teams"],
    summary: route[2],
  });
}

// ─── Agents ──────────────────────────────────────────────────────────────────

registry.register("AgentAppearance", agentAppearanceSchema);
registry.registerPath({
  method: "get",
  path: "/api/agent-avatars/{version}/{palette}/{file}",
  tags: ["agents"],
  summary: "Render or retrieve a public preset agent portrait",
  description: "On-demand PNG artwork; no agent or company lookup. Logical size determines face detail independently of density. Successful URLs are immutable for one year and return a content-derived ETag. Cache entries regenerate after deletion.",
  request: {
    params: z.object({
      version: z.literal("cap-v1"),
      palette: z.enum([...AGENT_PALETTE_IDS, "muted-dream"]),
      file: z.enum(CHARACTER_STATES.map(pose => `${pose}.png`)),
    }),
    query: z.object({
      size: z.enum(AGENT_AVATAR_SIZES.map(String)).optional().default("512"),
      scale: z.enum(["1", "2"]).optional().default("1"),
    }).strict(),
  },
  responses: {
    200: { description: "PNG portrait; Cache-Control: public, max-age=31536000, immutable; ETag: SHA-256 of PNG bytes", content: { "image/png": { schema: { type: "string", format: "binary" } } } },
    304: { description: "If-None-Match matches the cached content ETag" },
    400: r.badRequest,
    429: { description: "Cold-render admission limit for this client; Cache-Control: no-store; Retry-After in seconds. Cached portraits remain available." },
    503: { description: "Retryable rendering/storage failure; Cache-Control: no-store; Retry-After: 5" },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/built-in-agents",
  tags: ["agents"],
  summary: "List built-in agent provisioning state",
  request: { params: z.object({ companyId: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/built-in-agents/{key}/status",
  tags: ["agents"],
  summary: "Get built-in agent bundle status",
  request: { params: z.object({ companyId: z.string(), key: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/built-in-agents/{key}/reconcile",
  tags: ["agents"],
  summary: "Reconcile built-in agent managed resources",
  request: {
    params: z.object({ companyId: z.string(), key: z.string() }),
    body: jsonBody(builtInAgentEmptyMutationSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/built-in-agents/{key}/provision",
  tags: ["agents"],
  summary: "Provision a built-in agent",
  request: {
    params: z.object({ companyId: z.string(), key: z.string() }),
    body: jsonBody(builtInAgentProvisionSchema),
  },
  responses: {
    200: r.ok(),
    202: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/built-in-agents/{key}/reset",
  tags: ["agents"],
  summary: "Reset a built-in agent",
  request: { params: z.object({ companyId: z.string(), key: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

for (const route of [
  ["enable", "Enable a built-in routine schedule", 200],
  ["disable", "Disable a built-in routine schedule", 200],
  ["run", "Run a built-in routine once", 202],
] as const) {
  registry.registerPath({
    method: "post",
    path: `/api/companies/{companyId}/built-in-agents/{key}/routines/{routineKey}/${route[0]}`,
    tags: ["agents"],
    summary: route[1],
    request: {
      params: z.object({
        companyId: z.string(),
        key: z.string(),
        routineKey: z.string(),
      }),
      body: jsonBody(builtInAgentEmptyMutationSchema),
    },
    responses: {
      [route[2]]: r.ok(),
      400: r.badRequest,
      401: r.unauthorized,
      403: r.forbidden,
      404: r.notFound,
      409: r.conflict,
      422: r.unprocessable,
    },
  });
}

const summarySlotParams = z.object({
  companyId: z.string(),
  scopeKind: z.string(),
  slotKey: z.string(),
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/summary-slots/{scopeKind}/{slotKey}",
  tags: ["summaries"],
  summary: "Get a summary slot with its latest document and generation state",
  request: { params: summarySlotParams },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/summary-slots/{scopeKind}/{slotKey}/revisions",
  tags: ["summaries"],
  summary: "List dated revisions for a summary slot",
  request: { params: summarySlotParams },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/summary-slots/{scopeKind}/{slotKey}/generate",
  tags: ["summaries"],
  summary: "Manually generate (or refresh) a summary slot",
  request: {
    params: summarySlotParams,
    body: jsonBody(generateSummarySlotSchema),
  },
  responses: {
    200: r.ok(),
    202: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "put",
  path: "/api/companies/{companyId}/summary-slots/{scopeKind}/{slotKey}",
  tags: ["summaries"],
  summary: "Write a summary revision (Summarizer built-in agent only)",
  request: {
    params: summarySlotParams,
    body: jsonBody(writeSummarySlotSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/status-cards",
  tags: ["status-cards"],
  summary: "List status cards",
  request: { params: z.object({ companyId: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/status-cards",
  tags: ["status-cards"],
  summary: "Create a status card",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(createStatusCardSchema),
  },
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

for (const route of [
  ["get", "/api/status-cards/{id}", "Get a status card"],
  ["delete", "/api/status-cards/{id}", "Delete a status card"],
  ["post", "/api/status-cards/{id}/recompile", "Recompile a status card query"],
  [
    "get",
    "/api/status-cards/{id}/dry-run",
    "Execute stored status card queries without an LLM",
  ],
  ["get", "/api/status-cards/{id}/updates", "List status card updates"],
  [
    "get",
    "/api/status-cards/{id}/summary-revisions",
    "List status card summary revisions",
  ],
] as const) {
  registerCurrentRoute({
    method: route[0],
    path: route[1],
    tags: ["status-cards"],
    summary: route[2],
  });
}

registerCurrentRoute({
  method: "patch",
  path: "/api/status-cards/{id}",
  tags: ["status-cards"],
  summary: "Update, archive, or restore a status card",
  body: patchStatusCardSchema,
});

registerCurrentRoute({
  method: "post",
  path: "/api/status-cards/{id}/refresh",
  tags: ["status-cards"],
  summary: "Refresh a status card",
  body: refreshStatusCardSchema,
});

registerCurrentRoute({
  method: "put",
  path: "/api/status-cards/{id}/query",
  tags: ["status-cards"],
  summary: "Write a compiled status card query",
  body: writeStatusCardQuerySchema,
});

registerCurrentRoute({
  method: "put",
  path: "/api/status-cards/{id}/summary",
  tags: ["status-cards"],
  summary: "Write a generated status card summary",
  body: writeStatusCardSummarySchema,
});

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/pixels-office",
  tags: ["pixels-office"],
  summary: "Read the Pixels Office snapshot for a company",
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/pixels-office/timeline",
  tags: ["pixels-office"],
  summary: "Replay Pixels Office activity for a bounded window",
  query: z.object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    cursor: z.string().min(1).max(200).optional(),
  }),
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "put",
  path: "/api/companies/{companyId}/pixels-office/seats",
  tags: ["pixels-office"],
  summary: "Replace the Pixels Office character seat assignments",
  body: pixelsOfficeSeatAssignmentsSchema,
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/agents",
  tags: ["agents"],
  summary: "List agents in a company",
  description:
    "Pass `view=compact` to drop the per-row `orgChainHealth`, `appearance` and `avatarUrl` fields; `GET /api/agents/{id}` keeps the full shape.",
  request: {
    params: z.object({ companyId: z.string() }),
    query: z.object({ view: z.enum(["compact"]).optional() }),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/agents",
  tags: ["agents"],
  summary: "Create an agent",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(createAgentSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/agent-hires",
  tags: ["agents"],
  summary: "Hire an agent",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(createAgentHireSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/agent-configurations",
  tags: ["agents"],
  summary: "List agent configurations for a company",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/org",
  tags: ["agents"],
  summary: "Get org chart data",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/agents/me",
  tags: ["agents"],
  summary: "Get the current agent",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/agents/me/inbox-lite",
  tags: ["agents"],
  summary: "Get current agent inbox (lite)",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

const AgentSecretListResponseSchema = z.object({
  secrets: z.array(
    z.object({
      secretRef: z.string().guid(),
      key: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      delivery: z.enum(["env", "api", "both"]),
      projectionClass: z.string(),
      latestVersion: z.number().int().nonnegative(),
      versionSelector: z.union([
        z.literal("latest"),
        z.number().int().positive(),
      ]),
      resolvedVersion: z.number().int().positive(),
    }),
  ),
});

const createAgentSecretProposalSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("secret"),
      name: z.string().min(1),
      description: z.string().optional().nullable(),
      value: z.string().min(1),
      justification: z.string().min(1),
    }),
    z.object({
      kind: z.literal("binding"),
      secretId: z.string().guid().optional(),
      sourceConfigPath: z.string().min(1).optional(),
      secretProposalId: z.string().guid().optional(),
      targetAgentId: z.string().guid().optional(),
      configPath: z.string().min(1),
      justification: z.string().min(1),
    }),
  ])
  .superRefine((value, ctx) => {
    if (
      value.kind === "binding" &&
      [value.secretId, value.sourceConfigPath, value.secretProposalId].filter(
        (reference) => Boolean(reference),
      ).length !== 1
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Provide exactly one of secretId, sourceConfigPath, or secretProposalId",
      });
    }
  });

const approveSecretProposalSchema = z.object({
  cascade: z.boolean().optional(),
  overrides: z
    .object({
      name: z.string().min(1).optional(),
      description: z.string().optional().nullable(),
      providerConfigId: z.string().guid().optional().nullable(),
    })
    .optional(),
});

const rejectSecretProposalSchema = z.object({ reason: z.string().min(1) });

registry.registerPath({
  method: "post",
  path: "/api/agents/me/secret-proposals",
  tags: ["secrets"],
  summary: "Propose a company secret or agent secret binding",
  request: { body: jsonBody(createAgentSecretProposalSchema) },
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/agents/me/secret-proposals",
  tags: ["secrets"],
  summary: "List secret proposals visible to the current agent run",
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "delete",
  path: "/api/agents/me/secret-proposals/{id}",
  tags: ["secrets"],
  summary: "Withdraw a pending secret proposal",
  request: { params: z.object({ id: z.string().guid() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/agents/me/secrets",
  tags: ["secrets"],
  summary: "List secrets accessible to the current agent run",
  responses: {
    200: {
      description: "Accessible secret metadata",
      content: {
        "application/json": { schema: AgentSecretListResponseSchema },
      },
    },
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/me/secrets/{key}/value",
  tags: ["secrets"],
  summary: "Fetch one secret value for the current agent run",
  request: { params: z.object({ key: z.string() }) },
  responses: {
    200: {
      description: "Decrypted secret value",
      content: {
        "application/json": {
          schema: z.object({
            key: z.string(),
            value: z.string(),
            version: z.number().int().positive(),
          }),
        },
      },
    },
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/me/connections/{connectionId}/token",
  tags: ["tools"],
  summary: "Mint a short-lived token for an agent connection",
  request: {
    params: z.object({ connectionId: z.string() }),
    body: jsonBody(connectionTokenRequestSchema),
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    409: r.conflict,
    429: r.tooManyRequests,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/agents/me/inbox/mine",
  tags: ["agents"],
  summary: "Get current agent assigned inbox items",
  request: { query: agentMineInboxQuerySchema },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/agents/{id}",
  tags: ["agents"],
  summary: "Get an agent",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "patch",
  path: "/api/agents/{id}",
  tags: ["agents"],
  summary: "Update an agent",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(updateAgentSchema.omit({ permissions: true })),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/agents/{id}",
  tags: ["agents"],
  summary: "Delete an agent",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/batch/adapter-config/preview",
  tags: ["agents"],
  summary: "List the adapter config fields a batch of agents shares",
  request: { body: jsonBody(agentAdapterConfigBatchPreviewSchema) },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/batch/adapter-config",
  tags: ["agents"],
  summary: "Apply adapter config values to many agents at once",
  request: { body: jsonBody(agentAdapterConfigBatchUpdateSchema) },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/agents/{id}/permissions",
  tags: ["agents"],
  summary: "Update agent permissions",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(updateAgentPermissionsSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "patch",
  path: "/api/agents/{id}/instructions-path",
  tags: ["agents"],
  summary: "Update agent instructions path",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(updateAgentInstructionsPathSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/agents/{id}/instructions-bundle",
  tags: ["agents"],
  summary: "Get agent instructions bundle",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "patch",
  path: "/api/agents/{id}/instructions-bundle",
  tags: ["agents"],
  summary: "Update agent instructions bundle",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(updateAgentInstructionsBundleSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/agents/{id}/instructions-bundle/file",
  tags: ["agents"],
  summary: "Get agent file content or download its original bytes",
  request: { params: z.object({ id: z.string() }), query: z.object({ path: z.string(), download: z.enum(["true", "false"]).optional() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "put",
  path: "/api/agents/{id}/instructions-bundle/file",
  tags: ["agents"],
  summary: "Upsert agent instructions file",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(upsertAgentInstructionsFileSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

for (const operation of [
  { suffix: "history", summary: "List immutable instruction revisions", query: z.object({ path: z.string().optional(), cursor: z.string().uuid().optional() }) },
  { suffix: "revision/{revisionId}", summary: "Read exact instruction content at a revision", query: z.object({ path: z.string().optional() }) },
  { suffix: "diff", summary: "Compare instruction revisions (exact common prefix, removed, added, suffix)", query: z.object({ path: z.string().optional(), from: z.string().uuid(), to: z.string().uuid() }) },
]) {
  registry.registerPath({ method: "get", path: `/api/agents/{id}/instructions-bundle/${operation.suffix}`, tags: ["agents"], summary: operation.summary,
    request: { params: operation.suffix.includes("revisionId") ? z.object({ id: z.string(), revisionId: z.string().uuid() }) : z.object({ id: z.string() }), query: operation.query },
    responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound } });
}
registry.registerPath({ method: "post", path: "/api/agents/{id}/instructions-bundle/restore", tags: ["agents"], summary: "Restore a pre-upgrade instruction snapshot into current files with compare-and-swap",
  request: { params: z.object({ id: z.string() }), body: jsonBody(restoreAgentInstructionSchema) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict } });

registry.registerPath({
  method: "get",
  path: "/api/agents/{id}/instructions-bundle/candidates",
  tags: ["agents"],
  summary: "List preserved instruction edits and collection diagnostics",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/{id}/instructions-bundle/candidates/{runId}/resolve",
  tags: ["agents"],
  summary: "Explicitly save a preserved instruction edit with compare-and-swap",
  request: {
    params: z.object({ id: z.string(), runId: z.string().uuid() }),
    body: jsonBody(resolveAgentInstructionCandidateSchema),
  },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict, 422: r.unprocessable },
});

registry.registerPath({
  method: "delete",
  path: "/api/agents/{id}/instructions-bundle/file",
  tags: ["agents"],
  summary: "Delete agent file with compare-and-swap for managed storage",
  request: { params: z.object({ id: z.string() }), query: z.object({ path: z.string(), baseHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/agents/{id}/configuration",
  tags: ["agents"],
  summary: "Get agent configuration",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/agents/{id}/config-revisions",
  tags: ["agents"],
  summary: "List agent config revisions",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/agents/{id}/config-revisions/{revisionId}",
  tags: ["agents"],
  summary: "Get an agent config revision",
  request: { params: z.object({ id: z.string(), revisionId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/{id}/config-revisions/{revisionId}/rollback",
  tags: ["agents"],
  summary: "Roll back to a config revision",
  request: { params: z.object({ id: z.string(), revisionId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/agents/{id}/runtime-state",
  tags: ["agents"],
  summary: "Get agent runtime state",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/{id}/runtime-state/reset-session",
  tags: ["agents"],
  summary: "Reset agent session",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(resetAgentSessionSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/agents/{id}/task-sessions",
  tags: ["agents"],
  summary: "List agent task sessions",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/agents/{id}/skills",
  tags: ["agents"],
  summary: "List agent skills",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/{id}/skills/sync",
  tags: ["agents"],
  summary: "Sync desired skills onto an agent configuration",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(agentSkillSyncSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/agents/{id}/keys",
  tags: ["agents"],
  summary: "List agent API keys",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/{id}/keys",
  tags: ["agents"],
  summary: "Create an agent API key",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(createAgentKeySchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "delete",
  path: "/api/agents/{id}/keys/{keyId}",
  tags: ["agents"],
  summary: "Delete an agent API key",
  request: { params: z.object({ id: z.string(), keyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/{id}/wakeup",
  tags: ["agents"],
  summary: "Wake up an agent",
  description:
    "Board failed-run retries supply failedRunId with reason retry_failed_run. Paperclip derives the exact request and current authorization; a chat retry may return a durable queued/deferred receipt before a run exists. Caller task/comment markers and fresh-session overrides do not authorize replay.",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(wakeAgentSchema),
  },
  responses: {
    202: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/{id}/pause",
  tags: ["agents"],
  summary: "Pause an agent",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/{id}/resume",
  tags: ["agents"],
  summary: "Resume an agent",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/{id}/clear-error",
  tags: ["agents"],
  summary: "Clear an agent error",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/{id}/terminate",
  tags: ["agents"],
  summary: "Terminate an agent",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/instance/scheduler-heartbeats",
  tags: ["agents"],
  summary: "List scheduler heartbeats",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

// ─── Adapters ────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/adapters/{type}/models",
  tags: ["adapters"],
  summary: "List models for an adapter type and runner provider",
  request: {
    params: z.object({ companyId: z.string(), type: z.string() }),
    query: z.object({
      provider: z
        .enum(["codex", "acpx", "opencode", "claude_managed", "aws_agentcore"])
        .optional(),
      environmentId: z.string().optional(),
      refresh: z.string().optional(),
      poolId: z.string().optional(),
    }),
  },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/adapters/{type}/detect-model",
  tags: ["adapters"],
  summary: "Detect active model for an adapter",
  request: { params: z.object({ companyId: z.string(), type: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/adapters/{type}/test-environment",
  tags: ["adapters"],
  summary: "Validate adapter environment access for a company",
  request: {
    params: z.object({ companyId: z.string(), type: z.string() }),
    body: jsonBody(testAdapterEnvironmentSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/adapters/{type}/auth-signal",
  tags: ["adapters"],
  summary:
    "Read the cheap host-local authentication signal for an adapter type",
  request: {
    params: z.object({ companyId: z.string(), type: z.string() }),
    query: z.object({ environmentId: z.string().optional() }),
  },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/adapters/{type}/login-sessions",
  tags: ["adapters"],
  summary: "Start a company-scoped adapter device login",
  request: {
    params: z.object({ companyId: z.string(), type: z.string() }),
    body: jsonBody(startAdapterLoginSessionSchema),
  },
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/adapters/{type}/login-sessions/active",
  tags: ["adapters"],
  summary: "Read the caller's active adapter device login session",
  request: {
    params: z.object({ companyId: z.string(), type: z.string() }),
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/adapters/{type}/login-sessions/{sessionId}",
  tags: ["adapters"],
  summary: "Read an adapter device login session",
  request: {
    params: z.object({
      companyId: z.string(),
      type: z.string(),
      sessionId: z.string(),
    }),
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/adapters/{type}/login-sessions/{sessionId}/cancel",
  tags: ["adapters"],
  summary: "Cancel an adapter device login session",
  request: {
    params: z.object({
      companyId: z.string(),
      type: z.string(),
      sessionId: z.string(),
    }),
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

// ─── Issues ──────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/chats",
  tags: ["issues"],
  summary: "List the current board user's agent conversations",
  description: "Requires Agent Chat to be enabled. Returns accessible conversations in the company, ordered by most recent activity. Each agent has one conversation per user.",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/issues",
  tags: ["issues"],
  summary: "List issues in a company",
  description:
    "Use `view=compact` for the board issue-list row contract. The default response remains the broad compatibility contract. Pass `includeConversations=true` to also return the caller's own persistent conversation threads, which are hidden from every other board query; rows belonging to another agent or user are never included.",
  request: {
    params: z.object({ companyId: z.string() }),
    query: z
      .object({
        view: z.enum(["compact"]).optional(),
        includeConversations: z.enum(["true", "1"]).optional(),
      })
      .passthrough(),
  },
  responses: {
    200: r.ok(),
    304: { description: "Not Modified" },
    401: r.unauthorized,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/issues",
  tags: ["issues"],
  summary: "Create an issue",
  description:
    "When an agent run working on an issue creates an issue without parentId, the issue is still created and the response carries `warnings: [{ code: \"parent_missing\", message, suggestedParentIssueId, suggestedParentIdentifier }]`. Work that arises from the issue the run holds (follow-up, deploy, fix, review) belongs under it: pass parentId or use `POST /api/issues/{id}/children`. No warning is returned for board users, creates with parentId, runs without an issue, or handoffs from a conversation issue. Title is optional when description contains the task prompt. The server seeds a provisional title from the first 120 characters of the whitespace-normalized prompt and asks the assigned agent to refine it early. Explicit titles are preserved.",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(createIssueSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}",
  tags: ["issues"],
  summary: "Get an issue",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "put",
  path: "/api/issues/{id}/title",
  tags: ["issues"],
  summary: "Set a task title",
  description: "Changes only the title. onlyIfProvisional preserves an explicit title, including concurrent user edits. Agent callers must own the task's active run. Allowed in Ask and Plan modes.",
  request: { params: z.object({ id: z.string() }), body: jsonBody(setIssueTitleSchema) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});

registry.registerPath({
  method: "patch",
  path: "/api/issues/{id}",
  tags: ["issues"],
  summary: "Update an issue",
  description:
    "When posting a comment, attachmentIds selects up to 20 unique uploaded attachments from this exact task and company. The comment, attachment binding, and issue update commit atomically. attachmentIds without a comment is rejected; Markdown links alone do not bind uploads.",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(updateIssueSchema.partial()),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/stalled-review-decision",
  tags: ["issues"],
  summary: "Resolve a stalled issue review",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(stalledReviewDecisionSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/issues/{id}",
  tags: ["issues"],
  summary: "Delete an issue",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/heartbeat-context",
  tags: ["issues"],
  summary: "Get issue heartbeat context",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/runner-goal",
  tags: ["issues"],
  summary: "Get the effective agent session goal for an issue",
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({ agentId: z.string().optional() }),
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/runner-goal/actions",
  tags: ["issues"],
  summary: "Queue a control action for an agent session goal",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(runnerGoalActionRequestSchema),
  },
  responses: {
    202: { description: "Goal control accepted" },
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/model-override",
  tags: ["issues"],
  summary: "Get the per-task adapter model and thinking override",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "put",
  path: "/api/issues/{id}/model-override",
  tags: ["issues"],
  summary: "Set or clear the per-task adapter model and thinking override",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(issueRunModelOverrideUpdateSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/watchdog",
  tags: ["issues"],
  summary: "Get active issue watchdog",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "put",
  path: "/api/issues/{id}/watchdog",
  tags: ["issues"],
  summary: "Create or update an issue watchdog",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(upsertIssueWatchdogSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/issues/{id}/watchdog",
  tags: ["issues"],
  summary: "Disable an issue watchdog",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/work-products",
  tags: ["issues"],
  summary: "List issue work products",
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({ refreshPullRequests: z.enum(["true"]).optional() }),
  },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/work-products",
  tags: ["issues"],
  summary: "Create an issue work product",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(createIssueWorkProductSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/share-link",
  tags: ["issues"],
  summary: "Get the active public share link of an issue",
  description: "Returns the active read-only public link (url, token, createdAt) or null when the issue is not shared.",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/share-link",
  tags: ["issues"],
  summary: "Create or return the public share link of an issue",
  description: "Idempotent: returns the existing active link (200) or creates one (201). Requires issue read access only; another agent's checkout does not block it. Anyone holding the URL can read the issue, its agent comments, documents, attachments and one-hop related issues without logging in, until the link is revoked.",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 201: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

registry.registerPath({
  method: "delete",
  path: "/api/issues/{id}/share-link",
  tags: ["issues"],
  summary: "Revoke the public share link of an issue",
  description: "Requires issue read access only; another agent's checkout does not block it. The old URL and every download under it stop working; creating a link again issues a new token.",
  request: { params: z.object({ id: z.string() }) },
  responses: { 204: r.noContent, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

registry.registerPath({
  method: "patch",
  path: "/api/issues/{id}/comments/{commentId}/public-share",
  tags: ["issues"],
  summary: "Show or hide a person's comment on the public share link",
  request: {
    params: z.object({ id: z.string(), commentId: z.string() }),
    body: jsonBody(updateIssueCommentPublicShareSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/work-products/{workProductId}/review-document",
  tags: ["issues"],
  summary: "Ensure the review document for a Markdown work product",
  request: { params: z.object({ id: z.string(), workProductId: z.string() }) },
  responses: {
    200: r.ok(),
    201: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    413: r.payloadTooLarge,
    415: r.unsupportedMediaType,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/work-products/{id}",
  tags: ["issues"],
  summary: "Update a work product",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(updateIssueWorkProductSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "delete",
  path: "/api/work-products/{id}",
  tags: ["issues"],
  summary: "Delete a work product",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/documents",
  tags: ["issues"],
  summary: "List issue documents",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/documents/{key}",
  tags: ["issues"],
  summary: "Get an issue document",
  request: { params: z.object({ id: z.string(), key: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/documents/{key}/pdf",
  tags: ["issues"],
  summary: "Export an issue document as PDF",
  request: { params: z.object({ id: z.string(), key: z.string() }) },
  responses: {
    200: {
      description: "Rendered PDF document",
      content: { "application/pdf": { schema: z.string() } },
    },
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "put",
  path: "/api/issues/{id}/documents/{key}",
  tags: ["issues"],
  summary: "Upsert an issue document",
  request: {
    params: z.object({ id: z.string(), key: z.string() }),
    body: jsonBody(upsertIssueDocumentSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "delete",
  path: "/api/issues/{id}/documents/{key}",
  tags: ["issues"],
  summary: "Delete an issue document",
  request: { params: z.object({ id: z.string(), key: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/documents/{key}/revisions",
  tags: ["issues"],
  summary: "List issue document revisions",
  request: { params: z.object({ id: z.string(), key: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/documents/{key}/revisions/{revisionId}/restore",
  tags: ["issues"],
  summary: "Restore a document revision",
  request: {
    params: z.object({
      id: z.string(),
      key: z.string(),
      revisionId: z.string(),
    }),
    body: jsonBody(restoreIssueDocumentRevisionSchema),
  },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/comments",
  tags: ["issues"],
  summary: "List issue comments",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/comments",
  tags: ["issues"],
  summary: "Add a comment to an issue",
  description:
    "Set deliver to steer or queue to override the instance default message delivery for this one comment; omit it to use the global setting. An agent's comment on another agent's task steers that agent's running turn by default and is queued only when asked; a comment on the author's own assigned task always waits for the next turn. The response reports the disposition: deliveredAs is queued or steered, and steeringUnavailable names why whenever deliveredAs is queued, with not_requested when no steer was needed (queue was asked for, or the default steer found no running turn), identity_mismatch when the message answers to a different user than the running turn does, board_only when the author cannot steer that run at all, and otherwise no_active_run, legacy_protocol, conversation_order or steering_failed.",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(addIssueCommentSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "delete",
  path: "/api/issues/{id}/comments/{commentId}",
  tags: ["issues"],
  summary: "Delete an issue comment",
  request: { params: z.object({ id: z.string(), commentId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/approvals",
  tags: ["issues"],
  summary: "List issue approvals",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/approvals",
  tags: ["issues"],
  summary: "Link an approval to an issue",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(linkIssueApprovalSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "delete",
  path: "/api/issues/{id}/approvals/{approvalId}",
  tags: ["issues"],
  summary: "Unlink an approval from an issue",
  request: { params: z.object({ id: z.string(), approvalId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/checkout",
  tags: ["issues"],
  summary: "Check out an issue",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(checkoutIssueSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/release",
  tags: ["issues"],
  summary: "Release an issue",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/read",
  tags: ["issues"],
  summary: "Mark an issue as read",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "delete",
  path: "/api/issues/{id}/read",
  tags: ["issues"],
  summary: "Mark an issue as unread",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/inbox-archive",
  tags: ["issues"],
  summary: "Archive issue from inbox",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(z.object({ userId: z.string().min(1).optional() })),
  },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "delete",
  path: "/api/issues/{id}/inbox-archive",
  tags: ["issues"],
  summary: "Un-archive issue from inbox",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(z.object({ userId: z.string().min(1).optional() })),
  },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/feedback-votes",
  tags: ["issues"],
  summary: "List issue feedback votes",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/feedback-votes",
  tags: ["issues"],
  summary: "Upsert a feedback vote",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(upsertIssueFeedbackVoteSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/feedback-traces",
  tags: ["issues"],
  summary: "List issue feedback traces",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/feedback-traces/{traceId}",
  tags: ["issues"],
  summary: "Get a feedback trace",
  request: { params: z.object({ traceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/feedback-traces/{traceId}/bundle",
  tags: ["issues"],
  summary: "Get a feedback trace bundle",
  request: { params: z.object({ traceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{issueId}/file-resources/availability",
  tags: ["issues"],
  summary: "Check whether issue workspace files can be opened",
  request: {
    params: z.object({ issueId: z.string() }),
    body: {
      required: true,
      content: {
        "application/json": { schema: workspaceFileAvailabilityRequestSchema },
      },
    },
  },
  responses: {
    200: r.ok(workspaceFileAvailabilityResponseSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    429: r.tooManyRequests,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{issueId}/file-resources/list",
  tags: ["issues"],
  summary: "List workspace files for an issue",
  request: {
    params: z.object({ issueId: z.string() }),
    query: workspaceFileListQuerySchema,
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    404: r.notFound,
    422: r.unprocessable,
    429: r.tooManyRequests,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{issueId}/file-resources/resolve",
  tags: ["issues"],
  summary: "Resolve an issue workspace file",
  request: {
    params: z.object({ issueId: z.string() }),
    query: workspaceFileResourceQuerySchema,
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    404: r.notFound,
    422: r.unprocessable,
    429: r.tooManyRequests,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{issueId}/file-resources/content",
  tags: ["issues"],
  summary: "Read issue workspace file content",
  request: {
    params: z.object({ issueId: z.string() }),
    query: workspaceFileResourceQuerySchema,
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    404: r.notFound,
    422: r.unprocessable,
    429: r.tooManyRequests,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/attachments",
  tags: ["issues"],
  summary: "List issue attachments",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/labels",
  tags: ["issues"],
  summary: "List labels in a company",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/labels",
  tags: ["issues"],
  summary: "Create a label",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(createIssueLabelSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "delete",
  path: "/api/labels/{labelId}",
  tags: ["issues"],
  summary: "Delete a label",
  request: { params: z.object({ labelId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

// ─── Projects ────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/project-repositories",
  tags: ["projects"],
  summary: "Discover GitHub repositories available to the current board user",
  description:
    "Deduplicates repositories across usable personal and company-shared GitHub connections. Failed connections are reported without discarding successful results.",
  request: { params: z.object({ companyId: z.string() }) },
  responses: {
    200: r.ok(
      z.object({
        repositories: z.array(
          z.object({
            id: z.string(),
            fullName: z.string(),
            url: z.string(),
            private: z.boolean().optional(),
            connections: z.array(z.string()),
          }),
        ),
        connectionCount: z.number().int().nonnegative(),
        failedConnectionCount: z.number().int().nonnegative(),
      }),
    ),
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registry.registerPath({
  method: "put",
  path: "/api/projects/{id}/repositories",
  tags: ["projects"],
  summary: "Replace selected GitHub source repositories",
  description:
    "Saves provider IDs transactionally, refreshes canonical names and URLs, and preserves legacy workspace URLs. Unavailable existing selections can remain; new selections must be available to the caller.",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(
      createProjectSchema.pick({ repositoryIds: true }).required(),
    ),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/projects",
  tags: ["projects"],
  summary: "List projects in a company",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/projects",
  tags: ["projects"],
  summary: "Create a project",
  description:
    "The optional repositoryIds field selects GitHub source repositories and requires a board caller. It cannot be combined with workspace. All selections are validated before the project and repository workspaces are created atomically.",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(createProjectSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/projects/{id}",
  tags: ["projects"],
  summary: "Get a project",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "patch",
  path: "/api/projects/{id}",
  tags: ["projects"],
  summary: "Update a project",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(updateProjectSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "delete",
  path: "/api/projects/{id}",
  tags: ["projects"],
  summary: "Delete a project",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/projects/{id}/workspaces",
  tags: ["projects"],
  summary: "List project workspaces",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/projects/{id}/workspaces",
  tags: ["projects"],
  summary: "Create a project workspace",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(createProjectWorkspaceSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "patch",
  path: "/api/projects/{id}/workspaces/{workspaceId}",
  tags: ["projects"],
  summary: "Update a project workspace",
  request: {
    params: z.object({ id: z.string(), workspaceId: z.string() }),
    body: jsonBody(updateProjectWorkspaceSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/projects/{id}/workspaces/{workspaceId}",
  tags: ["projects"],
  summary: "Delete a project workspace",
  request: { params: z.object({ id: z.string(), workspaceId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

// ─── Routines ────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/routines",
  tags: ["routines"],
  summary: "List routines in a company",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/routines",
  tags: ["routines"],
  summary: "Create a routine",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(createRoutineSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/routines/{id}",
  tags: ["routines"],
  summary: "Get a routine",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "patch",
  path: "/api/routines/{id}",
  tags: ["routines"],
  summary: "Update a routine",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(updateRoutineSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/routines/{id}/runs",
  tags: ["routines"],
  summary: "List runs for a routine",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/routines/{id}/run",
  tags: ["routines"],
  summary: "Manually run a routine",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(runRoutineSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/routines/{id}/triggers",
  tags: ["routines"],
  summary: "Create a routine trigger",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(createRoutineTriggerSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "patch",
  path: "/api/routine-triggers/{id}",
  tags: ["routines"],
  summary: "Update a routine trigger",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(updateRoutineTriggerSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "delete",
  path: "/api/routine-triggers/{id}",
  tags: ["routines"],
  summary: "Delete a routine trigger",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/routine-triggers/{id}/rotate-secret",
  tags: ["routines"],
  summary: "Rotate a routine trigger secret",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(rotateRoutineTriggerSecretSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/routine-triggers/public/{publicId}/fire",
  tags: ["routines"],
  summary: "Fire a public routine trigger",
  request: { params: z.object({ publicId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

// ─── Goals ───────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/goals",
  tags: ["goals"],
  summary: "List goals in a company",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/goals",
  tags: ["goals"],
  summary: "Create a goal",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(createGoalSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/goals/{id}",
  tags: ["goals"],
  summary: "Get a goal",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "patch",
  path: "/api/goals/{id}",
  tags: ["goals"],
  summary: "Update a goal",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(updateGoalSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "delete",
  path: "/api/goals/{id}",
  tags: ["goals"],
  summary: "Delete a goal",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

// ─── Secrets ─────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/secret-providers",
  tags: ["secrets"],
  summary: "List secret providers",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/secrets/catalog",
  tags: ["secrets"],
  summary:
    "List secret metadata (id, name, key, status) — accessible to agents",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/secrets",
  tags: ["secrets"],
  summary: "List secrets in a company",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/secrets",
  tags: ["secrets"],
  summary: "Create a secret",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(createSecretSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/secret-proposals",
  tags: ["secrets"],
  summary: "List company secret proposals for board review",
  request: {
    params: z.object({ companyId: z.string().guid() }),
    query: z.object({
      status: z
        .enum(["pending", "approved", "rejected", "withdrawn", "expired"])
        .optional(),
    }),
  },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/secret-proposals/{id}/approve",
  tags: ["secrets"],
  summary: "Approve and execute a secret proposal as the approving board user",
  request: {
    params: z.object({ companyId: z.string().guid(), id: z.string().guid() }),
    body: jsonBody(approveSecretProposalSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/secret-proposals/{id}/reject",
  tags: ["secrets"],
  summary: "Reject a pending secret proposal and dependent bindings",
  request: {
    params: z.object({ companyId: z.string().guid(), id: z.string().guid() }),
    body: jsonBody(rejectSecretProposalSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/secrets/{id}",
  tags: ["secrets"],
  summary: "Update a secret",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(updateSecretSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/secrets/{id}/rotate",
  tags: ["secrets"],
  summary: "Rotate a secret",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(rotateSecretSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "delete",
  path: "/api/secrets/{id}",
  tags: ["secrets"],
  summary: "Delete a secret",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/user-secret-definitions",
  tags: ["secrets"],
  summary: "List user secret definitions",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/user-secret-definitions",
  tags: ["secrets"],
  summary: "Create a user secret definition",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(createUserSecretDefinitionSchema),
  },
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/companies/{companyId}/user-secret-definitions/{definitionId}",
  tags: ["secrets"],
  summary: "Update a user secret definition",
  request: {
    params: z.object({ companyId: z.string(), definitionId: z.string() }),
    body: jsonBody(updateUserSecretDefinitionSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/companies/{companyId}/user-secret-definitions/{definitionId}",
  tags: ["secrets"],
  summary: "Delete a user secret definition",
  request: {
    params: z.object({ companyId: z.string(), definitionId: z.string() }),
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/user-secret-definitions/{definitionId}/coverage",
  tags: ["secrets"],
  summary: "Get user secret definition coverage",
  request: {
    params: z.object({ companyId: z.string(), definitionId: z.string() }),
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/me/user-secrets",
  tags: ["secrets"],
  summary: "List my user secret values",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/me/user-secrets",
  tags: ["secrets"],
  summary: "Create my user secret value",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(createUserSecretValueSchema),
  },
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/companies/{companyId}/me/user-secrets/{secretId}",
  tags: ["secrets"],
  summary: "Update my user secret value",
  request: {
    params: z.object({ companyId: z.string(), secretId: z.string() }),
    body: jsonBody(updateUserSecretValueSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/me/user-secrets/{secretId}/rotate",
  tags: ["secrets"],
  summary: "Rotate my user secret value",
  request: {
    params: z.object({ companyId: z.string(), secretId: z.string() }),
    body: jsonBody(rotateUserSecretValueSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/companies/{companyId}/me/user-secrets/{secretId}",
  tags: ["secrets"],
  summary: "Delete my user secret value",
  request: {
    params: z.object({ companyId: z.string(), secretId: z.string() }),
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

// ─── Approvals ───────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/approvals",
  tags: ["approvals"],
  summary: "List approvals in a company",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/approvals",
  tags: ["approvals"],
  summary: "Create an approval",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(createApprovalSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/approvals/{id}",
  tags: ["approvals"],
  summary: "Get an approval",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/approvals/{id}/issues",
  tags: ["approvals"],
  summary: "List issues linked to an approval",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/approvals/{id}/approve",
  tags: ["approvals"],
  summary: "Approve an approval",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(resolveApprovalSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/approvals/{id}/reject",
  tags: ["approvals"],
  summary: "Reject an approval",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(resolveApprovalSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/approvals/{id}/request-revision",
  tags: ["approvals"],
  summary: "Request revision on an approval",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(requestApprovalRevisionSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/approvals/{id}/resubmit",
  tags: ["approvals"],
  summary: "Resubmit an approval",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(resubmitApprovalSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/approvals/{id}/comments",
  tags: ["approvals"],
  summary: "List approval comments",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/approvals/{id}/comments",
  tags: ["approvals"],
  summary: "Add a comment to an approval",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(addApprovalCommentSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

// ─── Costs ───────────────────────────────────────────────────────────────────

const costSummaryPaths = [
  "summary",
  "by-agent",
  "by-agent-model",
  "by-provider",
  "by-biller",
  "by-project",
  "finance-summary",
  "finance-by-biller",
  "finance-by-kind",
  "finance-events",
  "window-spend",
  "quota-windows",
] as const;

for (const segment of costSummaryPaths) {
  registry.registerPath({
    method: "get",
    path: `/api/companies/{companyId}/costs/${segment}`,
    tags: ["costs"],
    summary: `Cost report: ${segment}`,
    request: { params: z.object({ companyId: z.string() }) },
    responses: { 200: r.ok(), 401: r.unauthorized },
  });
}

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/cost-events",
  tags: ["costs"],
  summary: "Record a cost event",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(createCostEventSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/finance-events",
  tags: ["costs"],
  summary: "Record a finance event",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(createFinanceEventSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/budgets/policies",
  tags: ["costs"],
  summary: "Create or update a budget policy",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(upsertBudgetPolicySchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/budget-incidents/{incidentId}/resolve",
  tags: ["costs"],
  summary: "Resolve a budget incident",
  request: {
    params: z.object({ companyId: z.string(), incidentId: z.string() }),
    body: jsonBody(resolveBudgetIncidentSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/budgets/overview",
  tags: ["costs"],
  summary: "Get budget overview",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "patch",
  path: "/api/companies/{companyId}/budgets",
  tags: ["costs"],
  summary: "Update company budget",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(updateBudgetSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "patch",
  path: "/api/agents/{agentId}/budgets",
  tags: ["costs"],
  summary: "Update agent budget",
  request: {
    params: z.object({ agentId: z.string() }),
    body: jsonBody(updateBudgetSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

// ─── Activity ────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/activity",
  tags: ["activity"],
  summary: "List company activity",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/audit/agent-actions",
  tags: ["activity"],
  summary: "List agent action audit entries",
  request: {
    params: z.object({ companyId: z.string() }),
    query: z.object({
      agentId: z.string().guid().optional(),
      responsibleUserId: z.string().min(1).optional(),
      runId: z.string().guid().optional(),
      entityType: z.string().min(1).optional(),
      entityId: z.string().min(1).optional(),
      action: z.string().min(1).optional(),
      actorType: z.enum(["agent", "user", "system", "plugin"]).optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      cursor: z.string().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/audit/agent-actions.csv",
  tags: ["activity"],
  summary: "Export agent action audit entries as CSV",
  request: {
    params: z.object({ companyId: z.string() }),
    query: z.object({
      agentId: z.string().guid().optional(),
      responsibleUserId: z.string().min(1).optional(),
      runId: z.string().guid().optional(),
      entityType: z.string().min(1).optional(),
      entityId: z.string().min(1).optional(),
      action: z.string().min(1).optional(),
      actorType: z.enum(["agent", "user", "system", "plugin"]).optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      cursor: z.string().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: {
      description: "Agent action audit export",
      content: { "text/csv": { schema: z.string() } },
    },
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/activity",
  tags: ["activity"],
  summary: "Create an activity entry",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(
      z.object({
        actorType: z.enum(["agent", "user", "system", "plugin"]).optional(),
        actorId: z.string().min(1),
        action: z.string().min(1),
        entityType: z.string().min(1),
        entityId: z.string().min(1),
        agentId: z.string().guid().optional().nullable(),
        details: z.record(z.string(), z.unknown()).optional().nullable(),
      }),
    ),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/activity",
  tags: ["activity"],
  summary: "List activity for an issue",
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({
      limit: z.coerce.number().int().min(1).max(500).optional(),
      before: z.string().uuid().optional(),
    }),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/runs",
  tags: ["activity"],
  summary: "List runs for an issue",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/heartbeat-runs/{runId}/issues",
  tags: ["activity"],
  summary: "List issues for a heartbeat run",
  request: { params: z.object({ runId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

// ─── Dashboard ───────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/dashboard",
  tags: ["dashboard"],
  summary: "Get dashboard data",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/recovery-observability",
  tags: ["dashboard"],
  summary: "Get recovery observability report",
  request: {
    params: z.object({ companyId: z.string() }),
    query: z.object({
      weeks: z.string().optional(),
      threshold: z.string().optional(),
    }),
  },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

// ─── Sidebar ─────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/sidebar-badges",
  tags: ["sidebar"],
  summary: "Get sidebar badge counts",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/attention",
  tags: ["inbox"],
  summary: "List decision-only attention feed items",
  request: {
    params: z.object({ companyId: z.string() }),
    query: z.object({
      includeDismissed: z.enum(["true", "false"]).optional(),
      archived: z.enum(["true", "false"]).optional(),
      all: z.enum(["true", "false"]).optional(),
      activitySince: z.string().datetime().optional(),
      activityUntil: z.string().datetime().optional(),
      queue: z.string().min(1).optional(),
      sort: z.enum(["activity", "decide"]).optional(),
      cursor: z.string().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

// ─── Decisions ──────────────────────────────────────────────────────────────

// Decision queues and triage

const decisionQueueSeedRuleSchema = z
  .object({
    key: z.string(),
    description: z.string(),
    signal: z.enum([
      "issue_has_pull_request_work_product",
      "plan_document_confirmation",
      "ask_user_questions",
    ]),
  })
  .strict();

const decisionQueueSchema = z
  .object({
    id: z.string(),
    companyId: z.string(),
    key: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    createdByType: z.enum(["agent", "user", "system"]),
    createdByAgentId: z.string().nullable(),
    createdByUserId: z.string().nullable(),
    createdByRunId: z.string().nullable(),
    retentionDays: z.number().int().nullable(),
    seedRules: z.array(decisionQueueSeedRuleSchema),
    seedRulesEnabled: z.boolean(),
    itemCount: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

const decisionQueueItemSchema = z
  .object({
    id: z.string(),
    companyId: z.string(),
    queueId: z.string(),
    sourceKind: decisionAttentionSourceKindSchema,
    sourceId: z.string(),
    addedByType: z.enum(["agent", "user", "system"]),
    addedByAgentId: z.string().nullable(),
    addedByUserId: z.string().nullable(),
    addedByRunId: z.string().nullable(),
    responsibleUserId: z.string().nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();

const decisionTriageSchema = z
  .object({
    id: z.string(),
    companyId: z.string(),
    sourceKind: decisionAttentionSourceKindSchema,
    sourceId: z.string(),
    decideBy: z.string().nullable(),
    snoozedUntil: z.string().datetime().nullable(),
    setByType: z.enum(["agent", "user"]),
    setByAgentId: z.string().nullable(),
    setByUserId: z.string().nullable(),
    setByRunId: z.string().nullable(),
    responsibleUserId: z.string().nullable(),
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

const decisionRetentionSchema = z
  .object({
    id: z.string(),
    companyId: z.string(),
    sourceKind: decisionAttentionSourceKindSchema,
    sourceId: z.string(),
    sourceActivityAt: z.string().datetime(),
    keep: z.boolean(),
    archivedAt: z.string().datetime().nullable(),
    archivedReason: z.string().nullable(),
    archivedByType: z.enum(["agent", "user", "system"]).nullable(),
    archivedByAgentId: z.string().nullable(),
    archivedByUserId: z.string().nullable(),
    archivedByRunId: z.string().nullable(),
    version: z.number().int().positive(),
    archiveVersion: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/decision-queue-seed-rules",
  tags: ["decision-queues"],
  summary: "List built-in decision queue seed rules",
  responses: {
    200: r.ok(z.array(decisionQueueSeedRuleSchema)),
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/decision-queues",
  tags: ["decision-queues"],
  summary: "List decision queues",
  responses: {
    200: r.ok(z.array(decisionQueueSchema)),
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/decision-queues",
  tags: ["decision-queues"],
  summary: "Create a decision queue",
  body: createDecisionQueueSchema,
  responses: {
    200: r.ok(decisionQueueSchema),
    201: r.ok(decisionQueueSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registerCurrentRoute({
  method: "patch",
  path: "/api/companies/{companyId}/decision-queues/{key}",
  tags: ["decision-queues"],
  summary: "Update a decision queue",
  body: updateDecisionQueueSchema,
  responses: {
    200: r.ok(decisionQueueSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/decision-queues/{key}/items",
  tags: ["decision-queues"],
  summary: "List visible items in a decision queue",
  responses: {
    200: r.ok(z.array(decisionQueueItemSchema)),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/decision-queues/{key}/items",
  tags: ["decision-queues"],
  summary: "Add an item to a decision queue",
  body: addDecisionQueueItemSchema,
  responses: {
    200: r.ok(decisionQueueItemSchema),
    201: r.ok(decisionQueueItemSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "delete",
  path: "/api/companies/{companyId}/decision-queues/{key}/items/{sourceKind}/{sourceId}",
  tags: ["decision-queues"],
  summary: "Remove an item from a decision queue",
  body: removeDecisionQueueItemSchema,
  responses: {
    200: r.ok(decisionQueueItemSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/decision-triage/{sourceKind}/{sourceId}",
  tags: ["decision-queues"],
  summary: "Get decision triage for an attention source",
  responses: {
    200: r.ok(decisionTriageSchema.nullable()),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "put",
  path: "/api/companies/{companyId}/decision-triage/{sourceKind}/{sourceId}",
  tags: ["decision-queues"],
  summary: "Set decision triage for an attention source",
  body: updateDecisionTriageSchema,
  responses: {
    200: r.ok(decisionTriageSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  method: "patch",
  path: "/api/companies/{companyId}/decision-retention/{sourceKind}/{sourceId}",
  tags: ["decision-queues"],
  summary: "Set Keep for an attention source",
  body: updateDecisionRetentionSchema,
  responses: {
    200: r.ok(decisionRetentionSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

for (const action of ["archive", "revive"] as const) {
  registerCurrentRoute({
    method: "post",
    path: `/api/companies/{companyId}/decision-retention/{sourceKind}/{sourceId}/${action}`,
    tags: ["decision-queues"],
    summary:
      action === "archive"
        ? "Archive an attention source"
        : "Revive an archived attention source",
    responses: {
      200: r.ok(decisionRetentionSchema),
      400: r.badRequest,
      401: r.unauthorized,
      403: r.forbidden,
      404: r.notFound,
    },
  });
}

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/decision-archive-proposals",
  tags: ["decisions"],
  summary: "Propose one signed bulk archive decision",
  body: createDecisionArchiveProposalSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    409: r.conflict,
    422: r.unprocessable,
  },
});

// Decisions

const createDecisionBodySchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    body: z.string().max(100_000),
    ruleKey: z.string().trim().max(240).nullable().optional(),
    options: decisionOptionsSchema,
    inputs: decisionInputsSchema.nullable().optional(),
    expiresAt: z.string().datetime().optional(),
    idempotencyKey: z.string().trim().min(1).max(500).nullable().optional(),
    continuationPolicy: z.enum(["none", "wake_origin_agent"]).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/decisions",
  tags: ["decisions"],
  summary: "Propose a decision",
  body: createDecisionBodySchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    409: r.conflict,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/decision-bundles",
  tags: ["decisions"],
  summary: "Propose a decision bundle",
  body: z
    .object({
      title: z.string().trim().min(1).max(500),
      summary: z.string().max(100_000),
      decisions: z.array(createDecisionBodySchema).min(1).max(50),
    })
    .strict(),
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    409: r.conflict,
  },
});

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/decisions",
  tags: ["decisions"],
  summary: "List decisions",
  query: z.object({
    status: z.enum(["open", "decided", "expired", "cancelled"]).optional(),
    bundleId: z.string().guid().optional(),
    targetIssueId: z.string().guid().optional(),
    originAgentId: z.string().guid().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  }),
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/decisions/stats",
  tags: ["decisions"],
  summary: "Get decision telemetry grouped by rule key",
  query: z.object({
    groupBy: z.literal("ruleKey"),
    originAgentId: z.string().guid().optional(),
    since: z.string().datetime().optional(),
  }),
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registerCurrentRoute({
  method: "get",
  path: "/api/decisions/{id}",
  tags: ["decisions"],
  summary: "Get a decision outcome",
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/decisions/{id}/decide",
  tags: ["decisions"],
  summary: "Resolve a decision",
  body: z
    .object({
      optionId: z.string().trim().min(1).max(120),
      inputValues: z.record(z.string(), z.string().max(20_000)).optional(),
      idempotencyKey: z.string().trim().min(1).max(500).nullable().optional(),
    })
    .strict(),
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/decisions/{id}/dismiss",
  tags: ["decisions"],
  summary: "Dismiss a decision",
  body: z
    .object({ reason: z.string().max(20_000).nullable().optional() })
    .strict(),
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/decisions/{id}/cancel",
  tags: ["decisions"],
  summary: "Cancel a decision",
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

// ─── Decision training ──────────────────────────────────────────────────────

const decisionTrainingSourceKindSchema = z.enum([
  "interaction",
  "approval",
  "execution_decision",
]);

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/decision-training",
  tags: ["decision-training"],
  summary: "Capture a decision training example",
  body: z
    .object({
      sourceKind: decisionTrainingSourceKindSchema,
      sourceId: z.string().guid(),
      issueId: z.string().guid(),
      notes: z.string().max(100_000).default(""),
    })
    .strict(),
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/decision-training/preview",
  tags: ["decision-training"],
  summary: "Preview a decision training snapshot",
  body: z
    .object({
      sourceKind: decisionTrainingSourceKindSchema,
      sourceId: z.string().guid(),
      issueId: z.string().guid(),
    })
    .strict(),
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/decision-training",
  tags: ["decision-training"],
  summary: "List decision training examples",
  query: z.object({
    project: z.string().guid().optional(),
    kind: decisionTrainingSourceKindSchema.optional(),
    author: z.string().optional(),
    q: z.string().max(500).optional(),
  }),
});

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/decision-training/export.jsonl",
  tags: ["decision-training"],
  summary: "Export decision training examples as JSONL",
});

registerCurrentRoute({
  method: "get",
  path: "/api/decision-training/{id}",
  tags: ["decision-training"],
  summary: "Get a decision training example",
});

registerCurrentRoute({
  method: "patch",
  path: "/api/decision-training/{id}",
  tags: ["decision-training"],
  summary: "Update decision training notes",
  body: z.object({ notes: z.string().max(100_000) }).strict(),
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "delete",
  path: "/api/decision-training/{id}",
  tags: ["decision-training"],
  summary: "Delete a decision training example",
  responses: {
    204: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/notifications/web-push/config",
  tags: ["notifications"],
  summary: "Get Web Push configuration for the current board user",
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "put",
  path: "/api/notifications/web-push/subscription",
  tags: ["notifications"],
  summary: "Register or update this device's Web Push subscription",
  request: { body: jsonBody(upsertWebPushSubscriptionSchema) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "delete",
  path: "/api/notifications/web-push/subscription",
  tags: ["notifications"],
  summary: "Remove one of the current user's Web Push subscriptions",
  request: { body: jsonBody(deleteWebPushSubscriptionSchema) },
  responses: { 204: r.noContent, 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "post",
  path: "/api/notifications/web-push/test",
  tags: ["notifications"],
  summary: "Send a test push to the current user's subscriptions",
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 503: { description: "Web Push unavailable" } },
});

registry.registerPath({
  method: "get",
  path: "/api/sidebar-preferences/me",
  tags: ["sidebar"],
  summary: "Get current user sidebar preferences",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "put",
  path: "/api/sidebar-preferences/me",
  tags: ["sidebar"],
  summary: "Update current user sidebar preferences",
  request: { body: jsonBody(upsertSidebarOrderPreferenceSchema) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/sidebar-preferences/me",
  tags: ["sidebar"],
  summary: "Get sidebar preferences for company",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "put",
  path: "/api/companies/{companyId}/sidebar-preferences/me",
  tags: ["sidebar"],
  summary: "Update sidebar preferences for company",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(upsertSidebarOrderPreferenceSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

// ─── Announcements ───────────────────────────────────────────────────────────

const announcementResponseHeaders = {
  "Cache-Control": { schema: { type: "string", enum: ["private, no-store"] } },
};

registry.registerPath({
  method: "get",
  path: "/api/announcements/current",
  tags: ["announcements"],
  summary: "Get the current user's eligible announcement",
  description: "Returns null for dismissed, disabled, unavailable, expired or incompatible content. Dismissals follow the board user across companies within this instance; no-login installations use local-board.",
  responses: {
    200: { ...r.ok(announcementSchema.nullable()), headers: announcementResponseHeaders },
    401: r.unauthorized,
    403: r.forbidden,
    500: r.serverError,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/announcements/{id}/image",
  tags: ["announcements"],
  summary: "Get the current announcement's validated image",
  description: "Proxies only the content-addressed raster asset in the eligible manifest. Arbitrary URLs and asset paths are not accepted.",
  request: { params: z.object({ id: announcementIdSchema }) },
  responses: {
    200: {
      description: "Validated announcement image",
      headers: announcementResponseHeaders,
      content: {
        "image/png": { schema: { type: "string", format: "binary" } },
        "image/jpeg": { schema: { type: "string", format: "binary" } },
        "image/webp": { schema: { type: "string", format: "binary" } },
      },
    },
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/announcements/{id}/animation",
  tags: ["announcements"],
  summary: "Get the current announcement's isolated HTML/CSS animation",
  description: "Board-only, validated content-addressed HTML. Scripts, links, forms and embedded resources are rejected; CSP sandbox and resource restrictions also apply to direct visits. Missing or invalid assets return 404 and the card uses its static image.",
  request: { params: z.object({ id: announcementIdSchema }) },
  responses: {
    200: {
      description: "Validated visual HTML/CSS document",
      headers: { ...announcementResponseHeaders, "Content-Security-Policy": { schema: { type: "string" } } },
      content: { "text/html": { schema: { type: "string" } } },
    },
    400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/announcements/{id}/dismiss",
  tags: ["announcements"],
  summary: "Dismiss an announcement for the current user",
  description: "Idempotently saves a personal preference. The supplied company is validated audit context; viewers may dismiss their own announcement. The first dismissal and its audit entry commit together. IDs from a previously validated feed remain valid for offline retries; unknown IDs return 404 without creating records.",
  request: {
    params: z.object({ id: announcementIdSchema }),
    body: jsonBody(dismissAnnouncementSchema),
  },
  responses: {
    204: { ...r.noContent, headers: announcementResponseHeaders },
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    500: r.serverError,
  },
});

// ─── Inbox dismissals ────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/inbox-dismissals",
  tags: ["inbox"],
  summary: "List inbox dismissals",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/inbox-dismissals",
  tags: ["inbox"],
  summary: "Create an inbox dismissal or snooze",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(
      z.object({
        itemKey: z
          .string()
          .trim()
          .min(1)
          .regex(
            /^(approval|join|run|attention):.+$/,
            "Unsupported inbox item key",
          ),
        kind: z.enum(["dismiss", "snooze"]).optional(),
        snoozedUntil: z.string().datetime().optional(),
      }),
    ),
  },
  responses: { 201: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "delete",
  path: "/api/companies/{companyId}/inbox-dismissals/{itemKey}",
  tags: ["inbox"],
  summary: "Restore an inbox dismissal or snooze",
  request: { params: z.object({ companyId: z.string(), itemKey: z.string() }) },
  responses: { 204: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/autonomy-windows",
  tags: ["issues"],
  summary: "List live autonomy windows",
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/autonomy-windows",
  tags: ["issues"],
  summary: "Open autonomy windows that auto-accept plain confirmations in issue trees",
  body: openIssueAutonomyWindowSchema,
  responses: { 201: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

registerCurrentRoute({
  method: "delete",
  path: "/api/autonomy-windows/{id}",
  tags: ["issues"],
  summary: "Close an autonomy window",
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});

// ─── Instance settings ────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/instance/settings",
  tags: ["instance"],
  summary: "Get instance settings",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "patch",
  path: "/api/instance/settings",
  tags: ["instance"],
  summary: "Update instance settings",
  request: { body: jsonBody(patchInstanceSettingsSchema) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/instance/settings/general",
  tags: ["instance"],
  summary: "Get general instance settings",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "patch",
  path: "/api/instance/settings/general",
  tags: ["instance"],
  summary: "Update general instance settings",
  request: { body: jsonBody(patchInstanceGeneralSettingsSchema) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/instance/settings/experimental",
  tags: ["instance"],
  summary: "Get experimental instance settings",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "patch",
  path: "/api/instance/settings/experimental",
  tags: ["instance"],
  summary: "Update experimental instance settings",
  request: { body: jsonBody(patchInstanceExperimentalSettingsSchema) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/instance/task-drain",
  tags: ["instance"],
  summary:
    "Get the task-drain status for this process only; quiescent counts in-process work, and a process restart clears it even when the database still holds running rows",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/instance/task-drain",
  tags: ["instance"],
  summary:
    "Start a task drain, so new run admission holds until active runs finish",
  request: { body: jsonBody(startTaskDrainRequestSchema) },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/instance/task-drain",
  tags: ["instance"],
  summary: "End a task drain and restore run admission",
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "get",
  path: "/api/instance/live-runs",
  tags: ["instance"],
  summary:
    "List the run executions this process is still running, with the current task-drain status, so a restart can wait for them to settle",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/instance/lifecycle",
  tags: ["instance"],
  summary:
    "Read the Cloud-pinned primary company's lifecycle status and how many other companies are not archived; 404 when the instance is not Cloud-managed",
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/instance/lifecycle/unarchive-primary",
  tags: ["instance"],
  summary:
    "Unarchive the Cloud-pinned primary company (idempotent); used by the Cloud control plane while restoring an archived stack",
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

// ─── Board chat (Conference Room Chat, experimental) ──────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/board/chat/stream",
  tags: ["instance"],
  summary:
    "Stream a board-level chat response (requires enableConferenceRoomChat)",
  request: {
    body: jsonBody(
      z.object({
        companyId: z.string(),
        message: z.string(),
        taskId: z.string().optional(),
      }),
    ),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
  },
});

// ─── Access / invites / members ───────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/invites",
  tags: ["access"],
  summary: "List company invites",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/invites",
  tags: ["access"],
  summary: "Create a company invite",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(createCompanyInviteSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/join-requests",
  tags: ["access"],
  summary: "List company join requests",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/join-requests/{requestId}/approve",
  tags: ["access"],
  summary: "Approve a company join request",
  request: {
    params: z.object({ companyId: z.string(), requestId: z.string() }),
  },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/join-requests/{requestId}/reject",
  tags: ["access"],
  summary: "Reject a company join request",
  request: {
    params: z.object({ companyId: z.string(), requestId: z.string() }),
  },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/invites/{inviteId}/revoke",
  tags: ["access"],
  summary: "Revoke an invite",
  request: { params: z.object({ inviteId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/invites/{token}",
  tags: ["access"],
  summary: "Get an invite by token",
  request: { params: z.object({ token: z.string() }) },
  responses: { 200: r.ok(), 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/invites/{token}/accept",
  tags: ["access"],
  summary: "Accept an invite and create or replay a join request",
  request: {
    params: z.object({ token: z.string() }),
    body: jsonBody(acceptInviteSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/members",
  tags: ["access"],
  summary: "List company members",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "patch",
  path: "/api/companies/{companyId}/members/{memberId}",
  tags: ["access"],
  summary: "Update a company member status or role",
  request: {
    params: z.object({ companyId: z.string(), memberId: z.string() }),
    body: jsonBody(updateCompanyMemberSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/companies/{companyId}/members/{memberId}/role-and-grants",
  tags: ["access"],
  summary: "Update a company member role and explicit grants",
  request: {
    params: z.object({ companyId: z.string(), memberId: z.string() }),
    body: jsonBody(updateCompanyMemberWithPermissionsSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/members/{memberId}/archive",
  tags: ["access"],
  summary: "Archive a company member",
  request: {
    params: z.object({ companyId: z.string(), memberId: z.string() }),
    body: jsonBody(archiveCompanyMemberSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/companies/{companyId}/members/{memberId}/permissions",
  tags: ["access"],
  summary: "Update explicit company member permissions",
  request: {
    params: z.object({ companyId: z.string(), memberId: z.string() }),
    body: jsonBody(updateMemberPermissionsSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/user-directory",
  tags: ["access"],
  summary: "Get company user directory",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/cli-auth/me",
  tags: ["access"],
  summary: "Get current CLI auth session",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/openclaw/invite-prompt",
  tags: ["access"],
  summary: "Create an OpenClaw invite prompt bundle",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(createOpenClawInvitePromptSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/cli-auth/challenges",
  tags: ["access"],
  summary: "Create a CLI auth challenge",
  request: { body: jsonBody(createCliAuthChallengeSchema) },
  responses: { 200: r.ok(), 400: r.badRequest },
});

registry.registerPath({
  method: "post",
  path: "/api/cli-auth/challenges/{id}/approve",
  tags: ["access"],
  summary: "Approve a CLI auth challenge",
  request: {
    params: z.object({ id: cliAuthChallengeIdParamSchema }),
    body: jsonBody(resolveCliAuthChallengeSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/cli-auth/challenges/{id}/cancel",
  tags: ["access"],
  summary: "Cancel a CLI auth challenge",
  request: {
    params: z.object({ id: cliAuthChallengeIdParamSchema }),
    body: jsonBody(resolveCliAuthChallengeSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/cli-auth/revoke-current",
  tags: ["access"],
  summary: "Revoke current CLI auth session",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/skills/available",
  tags: ["access"],
  summary: "List available skills",
  responses: { 200: r.ok() },
});

registry.registerPath({
  method: "get",
  path: "/api/skills/index",
  tags: ["access"],
  summary: "Get skills index",
  responses: { 200: r.ok() },
});

registry.registerPath({
  method: "get",
  path: "/api/skills/{skillName}",
  tags: ["access"],
  summary: "Get a skill by name",
  request: { params: z.object({ skillName: z.string() }) },
  responses: { 200: r.ok(), 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/join-requests/{requestId}/claim-api-key",
  tags: ["access"],
  summary: "Claim the initial API key for an approved agent join request",
  request: {
    params: z.object({ requestId: z.string() }),
    body: jsonBody(claimJoinRequestApiKeySchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/admin/users",
  tags: ["admin"],
  summary: "List all users (admin)",
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

// ─── Auth / profile ──────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/auth/get-session",
  tags: ["auth"],
  summary: "Get current session",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/auth/profile",
  tags: ["auth"],
  summary: "Get current user profile",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "patch",
  path: "/api/auth/profile",
  tags: ["auth"],
  summary: "Update current user profile",
  request: { body: jsonBody(updateCurrentUserProfileSchema) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/users/{userSlug}/profile",
  tags: ["auth"],
  summary: "Get a user profile within a company",
  request: {
    params: z.object({ companyId: z.string(), userSlug: z.string() }),
  },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/managed-agent-profiles",
  tags: ["agents"],
  summary: "List Claude Managed Agent profiles for a company",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/managed-agent-profiles",
  tags: ["agents"],
  summary: "Create or operator-attest a Claude Managed Agent profile",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(
      z.object({
        profileKey: z.string(),
        displayName: z.string(),
        anthropicAgentId: z.string(),
        agentVersion: z.string(),
        environmentId: z.string(),
        defaultModel: z.literal("claude-sonnet-5").optional(),
        defaultMaxListCostUsd: z.number().positive().optional(),
        apiKeySecretId: z.string(),
        enabled: z.boolean().optional(),
        retentionAcknowledged: z.boolean().optional(),
        qualification: z
          .object({
            probedAt: z.string().datetime(),
            betaVersion: z.literal("managed-agents-2026-04-01"),
            environmentPolicy: z.literal("limited_no_hosts_no_packages"),
            agentCapabilities: z.literal(
              "no_tools_no_mcp_no_skills_no_multiagent",
            ),
          })
          .strict()
          .optional(),
      }),
    ),
  },
  responses: {
    201: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/remote-agent-profiles",
  tags: ["agents"],
  summary: "List remote AgentCore profiles for a company",
  request: {
    params: z.object({ companyId: z.string() }),
    query: z.object({
      service: z.literal("aws_bedrock_agentcore_harness").optional(),
    }),
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/remote-agent-profiles",
  tags: ["agents"],
  summary: "Create or operator-attest a remote AgentCore profile",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(
      z.object({
        profileKey: z.string(),
        displayName: z.string(),
        service: z.literal("aws_bedrock_agentcore_harness"),
        configuration: z.record(z.string(), z.unknown()),
        enabled: z.boolean().optional(),
        retentionAcknowledged: z.boolean().optional(),
        qualification: z
          .object({ suite: z.literal("aws-agentcore-harness-context-v2") })
          .strict()
          .optional(),
      }),
    ),
  },
  responses: {
    201: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    409: r.conflict,
    422: r.unprocessable,
  },
});

// ─── Heartbeat runs ──────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/heartbeat-runs",
  tags: ["runs"],
  summary: "List heartbeat runs for a company",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/provider-traces",
  tags: ["runs"],
  summary: "List provider trace metadata for selected runs",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/live-runs",
  tags: ["runs"],
  summary: "List live runs for a company",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{issueId}/live-runs",
  tags: ["runs"],
  summary: "List live runs for an issue",
  request: { params: z.object({ issueId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{issueId}/execution",
  tags: ["runs"],
  summary: "Get the current issue execution and permitted recovery actions",
  request: { params: z.object({ issueId: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{issueId}/active-run",
  tags: ["runs"],
  summary: "Get active run for an issue",
  request: { params: z.object({ issueId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/heartbeat-runs/{runId}",
  tags: ["runs"],
  summary: "Get a heartbeat run",
  request: { params: z.object({ runId: heartbeatRunIdParamSchema }) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/heartbeat-runs/{runId}/cancel",
  tags: ["runs"],
  summary: "Cancel a heartbeat run",
  request: { params: z.object({ runId: heartbeatRunIdParamSchema }) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/heartbeat-runs/{runId}/provider-trace",
  tags: ["runs"],
  summary: "Inspect a redacted provider trace",
  request: { params: z.object({ runId: heartbeatRunIdParamSchema }) },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/heartbeat-runs/{runId}/provider-trace/reproject-workspace-diffs",
  tags: ["runs"],
  summary: "Reproject retained Codex workspace diffs into run events",
  request: { params: z.object({ runId: heartbeatRunIdParamSchema }) },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/heartbeat-runs/{runId}/provider-trace/frames/{frameId}/reveal",
  tags: ["runs"],
  summary: "Reveal one exact provider trace frame",
  request: {
    params: z.object({
      runId: heartbeatRunIdParamSchema,
      frameId: z.coerce.number().int().positive(),
    }),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/heartbeat-runs/{runId}/provider-trace/download",
  tags: ["runs"],
  summary: "Download an exact provider trace as NDJSON",
  request: { params: z.object({ runId: heartbeatRunIdParamSchema }) },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/heartbeat-runs/{runId}/provider-trace",
  tags: ["runs"],
  summary: "Permanently delete a provider trace",
  request: { params: z.object({ runId: heartbeatRunIdParamSchema }) },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/queued-comments",
  tags: ["issues"],
  summary: "List queued comments for an issue",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "patch",
  path: "/api/issues/{id}/queued-comments/{commentId}",
  tags: ["issues"],
  summary: "Edit a queued issue comment",
  request: {
    params: z.object({ id: z.string(), commentId: z.string() }),
    body: jsonBody(
      z.object({
        queueId: z.string().min(1),
        revision: z.string().min(1),
        body: z.string().min(1).max(200_000),
      }),
    ),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "put",
  path: "/api/issues/{id}/queued-comments/order",
  tags: ["issues"],
  summary: "Reorder queued issue comments",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(
      z.object({
        queueId: z.string().min(1),
        revision: z.string().min(1),
        orderedCommentIds: z.array(z.string().min(1)).max(500),
      }),
    ),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/issues/{id}/queued-comments/{commentId}",
  tags: ["issues"],
  summary: "Delete a queued issue comment",
  request: {
    params: z.object({ id: z.string(), commentId: z.string() }),
    body: jsonBody(
      z.object({
        queueId: z.string().min(1),
        revision: z.string().min(1),
      }),
    ),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/queued-comments/interrupt",
  tags: ["issues"],
  summary: "Interrupt the active legacy run and continue its queued comments",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(
      z.object({
        queueId: z.string().min(1),
        revision: z.string().min(1),
        targetRunId: z.string().min(1),
      }),
    ),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/queued-comments/{commentId}/steer",
  tags: ["issues"],
  summary: "Steer a queued issue comment into the active native run",
  request: {
    params: z.object({ id: z.string(), commentId: z.string() }),
    body: jsonBody(
      z.object({
        queueId: z.string().min(1),
        revision: z.string().min(1),
        targetRunId: z.string().min(1),
      }),
    ),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/heartbeat-runs/{runId}/runtime-requests/{requestId}/resolve",
  tags: ["runs"],
  summary: "Resolve a pending Paperclip runner runtime request",
  request: {
    params: z.object({ runId: heartbeatRunIdParamSchema, requestId: z.string() }),
    body: jsonBody(
      z.object({
        turnId: z.string().min(1).max(160),
        requestKind: z.enum([
          "command_approval",
          "file_approval",
          "permission_approval",
          "user_input",
          "elicitation",
        ]),
        resolution: z.union([
          z.object({
            action: z.enum([
              "accept",
              "accept_for_session",
              "decline",
              "cancel",
            ]),
          }),
          z.object({
            action: z.literal("submit"),
            answers: z.record(
              z.string(),
              z.object({ answers: z.array(z.string()) }),
            ),
          }),
          z.object({
            action: z.literal("submit"),
            content: z.record(z.string(), z.unknown()),
          }),
        ]),
      }),
    ),
  },
  responses: {
    202: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/heartbeat-runs/{runId}/watchdog-decisions",
  tags: ["runs"],
  summary: "Submit watchdog decisions for a run",
  request: {
    params: z.object({ runId: heartbeatRunIdParamSchema }),
    body: jsonBody(
      z.object({
        decision: z.enum(["snooze", "continue", "dismissed_false_positive"]),
        evaluationIssueId: z.string().optional().nullable(),
        reason: z.string().optional().nullable(),
        snoozedUntil: z.string().datetime().optional().nullable(),
      }),
    ),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/heartbeat-runs/{runId}/events",
  tags: ["runs"],
  summary: "Get events for a heartbeat run",
  request: { params: z.object({ runId: heartbeatRunIdParamSchema }) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/heartbeat-runs/{runId}/log",
  tags: ["runs"],
  summary: "Get log for a heartbeat run",
  request: { params: z.object({ runId: heartbeatRunIdParamSchema }) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/heartbeat-runs/{runId}/workspace-operations",
  tags: ["runs"],
  summary: "List workspace operations for a run",
  request: { params: z.object({ runId: heartbeatRunIdParamSchema }) },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/workspace-operations/{operationId}/log",
  tags: ["runs"],
  summary: "Get log for a workspace operation",
  request: { params: z.object({ operationId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

// ─── Agent runs & heartbeat ───────────────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/agents/{id}/approve",
  tags: ["agents"],
  summary: "Approve a pending agent action",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/{id}/heartbeat/invoke",
  tags: ["agents"],
  summary: "Invoke agent heartbeat",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/{id}/claude-login",
  tags: ["agents"],
  summary: "Trigger Claude login for agent",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

// Company-and-environment Claude setup-token login session routes. The owner
// user starts one session for one adapter in one environment. The scope carries
// no agent id, so a hire flow with no agent still starts one session. The owner
// reads the login prompt, submits the browser code from the browser, and reads
// the completion claim. The prompt, code, and completion responses require a
// confidential transport; the guard returns 403 when the transport is not
// confidential. No response carries a token; the completion returns the
// non-secret `storedSessionId` claim.
//
// The stored-token status read returns only the secret id and the latest version
// of the owner value; it returns no token. The server derives the owner from the
// authenticated actor. A missing or a foreign value returns the same fixed 404,
// so the read discloses no existence distinction. The response is `no-store`.
registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/claude-oauth-token-status",
  tags: ["companies"],
  summary:
    "Read the stored Claude OAuth token status for the authenticated owner",
  request: { params: z.object({ companyId: z.string() }) },
  responses: {
    200: r.ok(claudeOAuthTokenStatusResponseSchema),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/setup-token-login-sessions",
  tags: ["companies"],
  summary: "Start a company-and-environment Claude setup-token login session",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(startClaudeSetupTokenSessionRequestSchema),
  },
  responses: {
    201: r.ok(claudeSetupTokenSessionOwnerResponseSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    503: r.serverError,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/setup-token-login-sessions/active",
  tags: ["companies"],
  summary: "Read the caller's active Claude setup-token login session",
  request: { params: z.object({ companyId: z.string() }) },
  responses: {
    200: r.ok(claudeSetupTokenSessionOwnerResponseSchema),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/setup-token-login-sessions/{sessionId}",
  tags: ["companies"],
  summary: "Read the status of a Claude setup-token login session",
  request: {
    params: z.object({ companyId: z.string(), sessionId: z.string() }),
  },
  responses: {
    200: r.ok(claudeSetupTokenSessionResponseSchema),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/setup-token-login-sessions/{sessionId}/prompt",
  tags: ["companies"],
  summary: "Read the login prompt for a Claude setup-token login session",
  request: {
    params: z.object({ companyId: z.string(), sessionId: z.string() }),
  },
  responses: {
    200: r.ok(claudeSetupTokenSessionPromptSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/setup-token-login-sessions/{sessionId}/code",
  tags: ["companies"],
  summary: "Submit the browser code for a Claude setup-token login session",
  request: {
    params: z.object({ companyId: z.string(), sessionId: z.string() }),
    body: jsonBody(submitBrowserCodeRequestSchema),
  },
  responses: {
    200: r.ok(claudeSetupTokenSessionResponseSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/setup-token-login-sessions/{sessionId}/completion",
  tags: ["companies"],
  summary: "Read the completion claim of a Claude setup-token login session",
  request: {
    params: z.object({ companyId: z.string(), sessionId: z.string() }),
  },
  responses: {
    200: r.ok(claudeSetupTokenCompletionResponseSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/setup-token-login-sessions/{sessionId}/cancel",
  tags: ["companies"],
  summary: "Cancel a Claude setup-token login session",
  // The 404 is reserved for the pre-scope non-member gate. The company-access
  // gate runs before the cancel logic and returns a fixed 404 for a non-member.
  // Cancel itself is idempotent and stays uniform: a same-company owner-scoped
  // missing, terminal, or foreign session id all return 200. So the route never
  // confirms a session exists for the owner.
  request: {
    params: z.object({ companyId: z.string(), sessionId: z.string() }),
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

// ─── Issue interactions & tree ───────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/interactions",
  tags: ["issues"],
  summary: "List issue thread interactions",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/interactions",
  tags: ["issues"],
  summary: "Create an issue thread interaction",
  description:
    "Resolver policy defaults to canonical `anyone` for every interaction kind. `not_creator` and `human_only` are opt-in restrictions; deprecated `board_or_agents` and `board_only` inputs are accepted as compatibility aliases.",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(createIssueThreadInteractionSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/interactions/{interactionId}/resolve-from-comment",
  tags: ["issues"],
  summary: "Record a user's conversational confirmation answer",
  description: "An eligible active agent run resolves a confirmation on its own task using the latest user comment. Resolver permissions, target staleness and conversation reset boundaries remain enforced. Matching retries are idempotent. No new wake is scheduled.",
  request: {
    params: z.object({ id: z.string(), interactionId: z.string() }),
    body: jsonBody(resolveConfirmationFromCommentSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound,
    409: { description: "Stale or conflicting decision" }, 422: { description: "Invalid answer evidence or selection" } },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/interactions/{interactionId}/accept",
  tags: ["issues"],
  summary: "Accept an issue thread interaction",
  request: {
    params: z.object({ id: z.string(), interactionId: z.string() }),
    body: jsonBody(acceptIssueThreadInteractionSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
    422: { description: "A note sent by a non-user actor, or on a suggested-task, tool-review or chat-approval card" },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/interactions/{interactionId}/reject",
  tags: ["issues"],
  summary: "Reject an issue thread interaction",
  request: {
    params: z.object({ id: z.string(), interactionId: z.string() }),
    body: jsonBody(rejectIssueThreadInteractionSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
    422: { description: "A required decline reason is missing, or a note was sent by a non-user actor or on a suggested-task, tool-review or chat-approval card" },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/interactions/{interactionId}/respond",
  tags: ["issues"],
  summary: "Answer questions on an issue thread interaction",
  request: {
    params: z.object({ id: z.string(), interactionId: z.string() }),
    body: jsonBody(respondIssueThreadInteractionSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
    422: { description: "Invalid answer, or a note sent by a non-user actor" },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/interactions/{interactionId}/verdicts",
  tags: ["issues"],
  summary: "Submit item verdicts on an issue thread interaction",
  request: {
    params: z.object({ id: z.string(), interactionId: z.string() }),
    body: jsonBody(submitIssueThreadInteractionVerdictsSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/interactions/{interactionId}/withdraw",
  tags: ["issues"],
  summary: "Withdraw a pending issue thread interaction",
  request: {
    params: z.object({ id: z.string(), interactionId: z.string() }),
    body: jsonBody(withdrawIssueThreadInteractionSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/children",
  tags: ["issues"],
  summary: "Create child issues",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(createChildIssueSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/admin/force-release",
  tags: ["issues"],
  summary: "Force-release an issue (admin)",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/tree-control/state",
  tags: ["issues"],
  summary: "Get issue tree control state",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/tree-control/preview",
  tags: ["issues"],
  summary: "Preview issue tree control changes",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(previewIssueTreeControlSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/tree-holds",
  tags: ["issues"],
  summary: "List issue tree holds",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/tree-holds",
  tags: ["issues"],
  summary: "Create an issue tree hold",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(createIssueTreeHoldSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/tree-holds/{holdId}",
  tags: ["issues"],
  summary: "Get an issue tree hold",
  request: { params: z.object({ id: z.string(), holdId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/tree-holds/{holdId}/release",
  tags: ["issues"],
  summary: "Release an issue tree hold",
  request: {
    params: z.object({ id: z.string(), holdId: z.string() }),
    body: jsonBody(releaseIssueTreeHoldSchema),
  },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

// ─── Attachments ──────────────────────────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/issues/{issueId}/attachments",
  tags: ["assets"],
  summary: "Upload an attachment to an issue",
  request: { params: z.object({ companyId: z.string(), issueId: z.string() }) },
  requestBody: multipartFileRequestBody("file", "The attachment file."),
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/attachments/{attachmentId}/content",
  tags: ["assets"],
  summary: "Download attachment content",
  request: { params: z.object({ attachmentId: z.string() }) },
  responses: {
    200: { description: "File content" },
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/attachments/{attachmentId}",
  tags: ["assets"],
  summary: "Delete an attachment",
  request: { params: z.object({ attachmentId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

// ─── Assets ──────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/assets/images",
  tags: ["assets"],
  summary: "Upload an image asset",
  request: { params: z.object({ companyId: z.string() }) },
  requestBody: multipartFileRequestBody("file", "The image file."),
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/logo",
  tags: ["assets"],
  summary: "Upload company logo",
  request: { params: z.object({ companyId: z.string() }) },
  requestBody: multipartFileRequestBody("file", "The company logo image."),
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/onboarding-seed",
  tags: ["companies"],
  summary: "Apply the onboarding seed Paperclip Cloud collected at signup",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 422: r.unprocessable },
});

registry.registerPath({
  method: "get",
  path: "/api/assets/{assetId}/content",
  tags: ["assets"],
  summary: "Download asset content",
  request: { params: z.object({ assetId: z.string() }) },
  responses: {
    200: { description: "File content" },
    401: r.unauthorized,
    404: r.notFound,
  },
});

// ─── Company skills ───────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/skills",
  tags: ["skills"],
  summary: "List skills for a company",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/skills/{skillId}",
  tags: ["skills"],
  summary: "Get a company skill",
  request: { params: z.object({ companyId: z.string(), skillId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/skills/{skillId}/update-status",
  tags: ["skills"],
  summary: "Get skill update status",
  request: { params: z.object({ companyId: z.string(), skillId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/skills/{skillId}/files",
  tags: ["skills"],
  summary: "List skill files",
  request: { params: z.object({ companyId: z.string(), skillId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/skills/{skillId}/rename",
  tags: ["skills"],
  summary: "Rename a managed company skill",
  request: {
    params: z.object({ companyId: z.string(), skillId: z.string() }),
    body: jsonBody(companySkillRenameSchema),
  },
  responses: {
    200: r.ok(companySkillRenameResultSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/skills",
  tags: ["skills"],
  summary: "Create a company skill",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(companySkillCreateSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "patch",
  path: "/api/companies/{companyId}/skills/{skillId}/files",
  tags: ["skills"],
  summary: "Update a skill file (optional expectedVersionId and idempotencyKey guard agent retries)",
  request: {
    params: z.object({ companyId: z.string(), skillId: z.string() }),
    body: jsonBody(companySkillFileUpdateSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 409: r.conflict },
});

registry.registerPath({
  method: "delete",
  path: "/api/companies/{companyId}/skills/{skillId}/files",
  tags: ["skills"],
  summary: "Delete a skill file or folder",
  request: {
    params: z.object({ companyId: z.string(), skillId: z.string() }),
    body: jsonBody(companySkillFileDeleteSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/skills/{skillId}/test-inputs",
  tags: ["skills"],
  summary: "List skill test inputs",
  request: { params: z.object({ companyId: z.string(), skillId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/skills/{skillId}/test-inputs",
  tags: ["skills"],
  summary: "Create a skill test input",
  request: {
    params: z.object({ companyId: z.string(), skillId: z.string() }),
    body: jsonBody(companySkillTestInputCreateSchema),
  },
  responses: { 201: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "patch",
  path: "/api/companies/{companyId}/skills/{skillId}/test-inputs/{inputId}",
  tags: ["skills"],
  summary: "Update a skill test input",
  request: {
    params: z.object({
      companyId: z.string(),
      skillId: z.string(),
      inputId: z.string(),
    }),
    body: jsonBody(companySkillTestInputUpdateSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/companies/{companyId}/skills/{skillId}/test-inputs/{inputId}",
  tags: ["skills"],
  summary: "Delete a skill test input",
  request: {
    params: z.object({
      companyId: z.string(),
      skillId: z.string(),
      inputId: z.string(),
    }),
  },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/skill-test-run-templates",
  tags: ["skills"],
  summary: "List skill test-run templates",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/skill-test-run-templates",
  tags: ["skills"],
  summary: "Create a skill test-run template",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(companySkillTestRunTemplateCreateSchema),
  },
  responses: { 201: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "patch",
  path: "/api/companies/{companyId}/skill-test-run-templates/{templateId}",
  tags: ["skills"],
  summary: "Update a skill test-run template",
  request: {
    params: z.object({ companyId: z.string(), templateId: z.string() }),
    body: jsonBody(companySkillTestRunTemplateUpdateSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/companies/{companyId}/skill-test-run-templates/{templateId}",
  tags: ["skills"],
  summary: "Delete a skill test-run template",
  request: {
    params: z.object({ companyId: z.string(), templateId: z.string() }),
  },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/skills/{skillId}/test-runs",
  tags: ["skills"],
  summary: "List skill test runs",
  request: {
    params: z.object({ companyId: z.string(), skillId: z.string() }),
    query: companySkillTestRunListQuerySchema,
  },
  responses: { 200: r.ok(), 401: r.unauthorized, 422: r.unprocessable },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/skills/{skillId}/test-runs/{runId}",
  tags: ["skills"],
  summary: "Get a skill test run",
  request: {
    params: z.object({
      companyId: z.string(),
      skillId: z.string(),
      runId: z.string(),
    }),
  },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/skills/{skillId}/test-runs",
  tags: ["skills"],
  summary: "Create a skill test run",
  request: {
    params: z.object({ companyId: z.string(), skillId: z.string() }),
    body: jsonBody(companySkillTestRunCreateSchema),
  },
  responses: { 201: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/skills/{skillId}/test-runs/{runId}/cancel",
  tags: ["skills"],
  summary: "Cancel a skill test run",
  request: {
    params: z.object({
      companyId: z.string(),
      skillId: z.string(),
      runId: z.string(),
    }),
  },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "delete",
  path: "/api/companies/{companyId}/skills/{skillId}/test-runs/{runId}",
  tags: ["skills"],
  summary: "Delete a skill test run",
  request: {
    params: z.object({
      companyId: z.string(),
      skillId: z.string(),
      runId: z.string(),
    }),
  },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/skills/import",
  tags: ["skills"],
  summary: "Import a skill",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(companySkillImportSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/skills/browse-project",
  tags: ["skills"],
  summary: "Browse a project workspace for skills",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(companySkillProjectBrowseRequestSchema),
  },
  responses: {
    200: r.ok(companySkillProjectBrowseResultSchema),
    400: r.badRequest,
    401: r.unauthorized,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/skills/scan-projects",
  tags: ["skills"],
  summary: "Scan project for skills",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(companySkillProjectScanRequestSchema),
  },
  responses: {
    200: r.ok(companySkillProjectScanResultSchema),
    400: r.badRequest,
    401: r.unauthorized,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/skills/{skillId}/install-update",
  tags: ["skills"],
  summary: "Install a skill update",
  request: { params: z.object({ companyId: z.string(), skillId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "delete",
  path: "/api/companies/{companyId}/skills/{skillId}",
  tags: ["skills"],
  summary: "Delete a company skill",
  request: { params: z.object({ companyId: z.string(), skillId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/skill-policy",
  tags: ["skills"],
  summary: "Get the effective company skill policy",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "put",
  path: "/api/companies/{companyId}/skill-policy",
  tags: ["skills"],
  summary: "Replace the company skill policy",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(replaceSkillPolicySchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/companies/{companyId}/skill-policy",
  tags: ["skills"],
  summary: "Reset the company skill policy to the open default",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/skill-policy/evaluate",
  tags: ["skills"],
  summary: "Evaluate a company skill policy decision",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(evaluateSkillPolicySchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/users/me/inbox-agent-policy",
  tags: ["companies"],
  summary: "Get the current user's inbox agent policy",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "put",
  path: "/api/companies/{companyId}/users/me/inbox-agent-policy",
  tags: ["companies"],
  summary: "Update the current user's inbox agent policy",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(updateInboxAgentPolicySchema),
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/users/{userId}/inbox-agent-policy",
  tags: ["companies"],
  summary: "Get a company user's inbox agent policy",
  request: { params: z.object({ companyId: z.string(), userId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "put",
  path: "/api/companies/{companyId}/users/{userId}/inbox-agent-policy",
  tags: ["companies"],
  summary: "Update a company user's inbox agent policy",
  request: {
    params: z.object({ companyId: z.string(), userId: z.string() }),
    body: jsonBody(updateInboxAgentPolicySchema),
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    422: r.unprocessable,
  },
});

// ─── Execution workspaces ─────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/execution-workspaces",
  tags: ["execution-workspaces"],
  summary: "List execution workspaces for a company",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/workspace-overview",
  tags: ["execution-workspaces"],
  summary: "List bounded execution workspace overview rows for a company",
  request: {
    params: z.object({ companyId: z.string() }),
    query: workspaceOverviewQuerySchema,
  },
  responses: { 200: r.ok(), 401: r.unauthorized, 422: r.unprocessable },
});

registry.registerPath({
  method: "get",
  path: "/api/execution-workspaces/{id}",
  tags: ["execution-workspaces"],
  summary: "Get an execution workspace",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/execution-workspaces/{id}/close-readiness",
  tags: ["execution-workspaces"],
  summary: "Check close-readiness of a workspace",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/execution-workspaces/{id}/workspace-operations",
  tags: ["execution-workspaces"],
  summary: "List workspace operations",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "patch",
  path: "/api/execution-workspaces/{id}",
  tags: ["execution-workspaces"],
  summary: "Update an execution workspace",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(updateExecutionWorkspaceSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/execution-workspaces/{id}/reconcile-branch",
  tags: ["execution-workspaces"],
  summary: "Reconcile an execution workspace branch record",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(reconcileExecutionWorkspaceBranchSchema),
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/execution-workspaces/{id}/login-handoff",
  tags: ["execution-workspaces"],
  summary: "Issue a single-use workspace login handoff",
  description:
    "Mints a short-lived, single-use ticket the isolated workspace exchanges for its own " +
    "instance-scoped session, so opening a managed workspace does not depend on a cloned " +
    "password. Board actors only. The response `url` must be navigated to, not stored: the " +
    "workspace answers it with a redirect so the ticket never enters browser history. A refusal " +
    "carries a machine `reason` and, where the control plane probed it, the workspace's own " +
    "readiness.",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(
      z.object({
        next: z
          .string()
          .optional()
          .describe(
            "Same-origin path to land on; anything else collapses to `/`.",
          ),
      }),
    ),
  },
  responses: {
    201: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    501: r.serverError,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/execution-workspaces/{id}/runtime-services/{action}",
  tags: ["execution-workspaces"],
  summary: "Control a runtime service in a workspace",
  request: {
    params: z.object({ id: z.string(), action: z.string() }),
    body: jsonBody(workspaceRuntimeControlTargetSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/execution-workspaces/{id}/runtime-commands/{action}",
  tags: ["execution-workspaces"],
  summary: "Run a runtime command in a workspace",
  request: {
    params: z.object({ id: z.string(), action: z.string() }),
    body: jsonBody(workspaceRuntimeControlTargetSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

// ─── Environments ─────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/environments",
  tags: ["environments"],
  summary: "List environments for a company",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/environments/capabilities",
  tags: ["environments"],
  summary: "Get environment capabilities",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/environments",
  tags: ["environments"],
  summary: "Create an environment",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(createEnvironmentSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/environments/{id}",
  tags: ["environments"],
  summary: "Get an environment",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/environments/{id}/delete-blast-radius",
  tags: ["environments"],
  summary: "Get environment delete blast radius",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/environments/{id}/secret-refs",
  tags: ["environments"],
  summary:
    "Describe an environment's config secret refs (name, status, owning company — never values)",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/environments/{id}/leases",
  tags: ["environments"],
  summary: "List leases for an environment",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/environment-leases/{leaseId}",
  tags: ["environments"],
  summary: "Get an environment lease",
  request: { params: z.object({ leaseId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "patch",
  path: "/api/environments/{id}",
  tags: ["environments"],
  summary: "Update an environment",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(updateEnvironmentSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "delete",
  path: "/api/environments/{id}",
  tags: ["environments"],
  summary: "Delete an environment",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/environments/{id}/probe",
  tags: ["environments"],
  summary: "Probe an environment",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/environments/probe-config",
  tags: ["environments"],
  summary: "Probe environment config",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(probeEnvironmentConfigSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/environments/{environmentId}/custom-image-template",
  tags: ["environments"],
  summary:
    "Get the active customImage template and setup status for an environment",
  request: {
    params: z.object({ environmentId: z.string() }),
    query: environmentCustomImageCompanyQuerySchema,
  },
  responses: {
    200: r.ok(environmentCustomImageOverviewSchema),
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/environments/{environmentId}/custom-image-setup-sessions",
  tags: ["environments"],
  summary: "Start an interactive environment customImage setup session",
  request: {
    params: z.object({ environmentId: z.string() }),
    query: environmentCustomImageCompanyQuerySchema,
    body: jsonBody(startEnvironmentCustomImageSetupSessionSchema),
  },
  responses: {
    201: r.ok(environmentCustomImageSetupSessionResultSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/environment-custom-image-setup-sessions/{sessionId}",
  tags: ["environments"],
  summary: "Get and refresh an environment customImage setup session",
  request: { params: z.object({ sessionId: z.string() }) },
  responses: {
    200: r.ok(environmentCustomImageSetupSessionResultSchema),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/environment-custom-image-setup-sessions/{sessionId}/terminal-session-token",
  tags: ["environments"],
  summary:
    "Mint a short-lived terminal websocket token for a customImage SSH setup session",
  request: {
    params: z.object({ sessionId: z.string() }),
    body: jsonBody(createEnvironmentCustomImageTerminalSessionTokenSchema),
  },
  responses: {
    201: r.ok(environmentCustomImageTerminalSessionTokenSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/environment-custom-image-setup-sessions/{sessionId}/finish",
  tags: ["environments"],
  summary: "Capture and promote an environment customImage setup session",
  request: {
    params: z.object({ sessionId: z.string() }),
    body: jsonBody(finishEnvironmentCustomImageSetupSessionSchema),
  },
  responses: {
    200: r.ok(environmentCustomImageSetupSessionFinishResultSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/environment-custom-image-setup-sessions/{sessionId}/cancel",
  tags: ["environments"],
  summary: "Cancel an environment customImage setup session",
  request: {
    params: z.object({ sessionId: z.string() }),
    body: jsonBody(cancelEnvironmentCustomImageSetupSessionSchema),
  },
  responses: {
    200: r.ok(environmentCustomImageSetupSessionSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/environments/{environmentId}/custom-image-template/rollback",
  tags: ["environments"],
  summary:
    "Roll back an environment customImage template to the previous captured template",
  request: {
    params: z.object({ environmentId: z.string() }),
    query: environmentCustomImageCompanyQuerySchema,
  },
  responses: {
    200: r.ok(environmentCustomImageTemplateRollbackResultSchema),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/environments/{environmentId}/custom-image-template/relink",
  tags: ["environments"],
  summary:
    "Relink a detached environment customImage template to the current config",
  request: {
    params: z.object({ environmentId: z.string() }),
    query: environmentCustomImageCompanyQuerySchema,
    body: jsonBody(relinkEnvironmentCustomImageTemplateSchema),
  },
  responses: {
    200: r.ok(environmentCustomImageTemplateRelinkResultSchema),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/environments/{environmentId}/custom-image-template",
  tags: ["environments"],
  summary: "Disable the active environment customImage template",
  request: {
    params: z.object({ environmentId: z.string() }),
    query: disableEnvironmentCustomImageTemplateQuerySchema,
  },
  responses: {
    200: r.ok(environmentCustomImageTemplateSchema),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

// ─── Adapters (full) ──────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/adapters",
  tags: ["adapters"],
  summary: "List all adapters",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/adapters/install",
  tags: ["adapters"],
  summary: "Install an adapter",
  request: {
    body: jsonBody(
      z.object({
        packageName: z.string(),
        isLocalPath: z.boolean().optional(),
        version: z.string().optional(),
      }),
    ),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "patch",
  path: "/api/adapters/{type}",
  tags: ["adapters"],
  summary: "Enable or disable an adapter",
  request: {
    params: z.object({ type: z.string() }),
    body: jsonBody(z.object({ disabled: z.boolean() })),
  },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "patch",
  path: "/api/adapters/{type}/override",
  tags: ["adapters"],
  summary: "Pause or resume an adapter's override of a builtin",
  request: {
    params: z.object({ type: z.string() }),
    body: jsonBody(z.object({ paused: z.boolean() })),
  },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "delete",
  path: "/api/adapters/{type}",
  tags: ["adapters"],
  summary: "Delete an adapter",
  request: { params: z.object({ type: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/adapters/{type}/reload",
  tags: ["adapters"],
  summary: "Reload an adapter",
  request: { params: z.object({ type: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/adapters/{type}/reinstall",
  tags: ["adapters"],
  summary: "Reinstall an adapter",
  request: { params: z.object({ type: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/adapters/{type}/config-schema",
  tags: ["adapters"],
  summary: "Get adapter config schema",
  request: { params: z.object({ type: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

// ─── Plugins ──────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/plugins",
  tags: ["plugins"],
  summary: "List installed plugins",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/plugins/examples",
  tags: ["plugins"],
  summary: "List example plugins",
  responses: { 200: r.ok() },
});

registry.registerPath({
  method: "get",
  path: "/api/plugins/ui-contributions",
  tags: ["plugins"],
  summary: "List plugin UI contributions",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/plugins/tools",
  tags: ["plugins"],
  summary: "List plugin tools",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/plugins/tools/execute",
  tags: ["plugins"],
  summary: "Execute a plugin tool",
  request: {
    body: jsonBody(
      z.object({
        tool: z.string(),
        parameters: z.record(z.string(), z.unknown()).optional(),
        runContext: z.object({
          agentId: z.string(),
          runId: z.string(),
          companyId: z.string(),
          projectId: z.string(),
        }),
      }),
    ),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/plugins/install",
  tags: ["plugins"],
  summary: "Install a plugin",
  request: {
    body: jsonBody(
      z.object({
        packageName: z.string(),
        version: z.string().optional(),
        isLocalPath: z.boolean().optional(),
      }),
    ),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/plugins/{pluginId}",
  tags: ["plugins"],
  summary: "Get a plugin",
  request: { params: z.object({ pluginId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "delete",
  path: "/api/plugins/{pluginId}",
  tags: ["plugins"],
  summary: "Delete a plugin",
  request: { params: z.object({ pluginId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/plugins/{pluginId}/enable",
  tags: ["plugins"],
  summary: "Enable a plugin",
  request: { params: z.object({ pluginId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/plugins/{pluginId}/disable",
  tags: ["plugins"],
  summary: "Disable a plugin",
  request: { params: z.object({ pluginId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/plugins/{pluginId}/health",
  tags: ["plugins"],
  summary: "Get plugin health",
  request: { params: z.object({ pluginId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/plugins/{pluginId}/logs",
  tags: ["plugins"],
  summary: "Get plugin logs",
  request: { params: z.object({ pluginId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/plugins/{pluginId}/upgrade",
  tags: ["plugins"],
  summary: "Upgrade a plugin",
  request: { params: z.object({ pluginId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/plugins/{pluginId}/config",
  tags: ["plugins"],
  summary: "Get company-scoped plugin config",
  request: {
    params: z.object({ pluginId: z.string() }),
    query: z.object({ companyId: z.string() }),
  },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/plugins/{pluginId}/config",
  tags: ["plugins"],
  summary: "Set company-scoped plugin config",
  request: {
    params: z.object({ pluginId: z.string() }),
    body: jsonBody(
      z.object({
        companyId: z.string(),
        configJson: z.record(z.string(), z.unknown()),
      }),
    ),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/plugins/{pluginId}/config/test",
  tags: ["plugins"],
  summary: "Test company-scoped plugin config",
  request: {
    params: z.object({ pluginId: z.string() }),
    body: jsonBody(
      z.object({
        companyId: z.string(),
        configJson: z.record(z.string(), z.unknown()),
      }),
    ),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/plugins/{pluginId}/jobs",
  tags: ["plugins"],
  summary: "List plugin jobs",
  request: { params: z.object({ pluginId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/plugins/{pluginId}/jobs/{jobId}/runs",
  tags: ["plugins"],
  summary: "List runs for a plugin job",
  request: { params: z.object({ pluginId: z.string(), jobId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/plugins/{pluginId}/jobs/{jobId}/trigger",
  tags: ["plugins"],
  summary: "Trigger a plugin job",
  request: { params: z.object({ pluginId: z.string(), jobId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/plugins/{pluginId}/webhooks/{endpointKey}",
  tags: ["plugins"],
  summary: "Deliver an external webhook payload to a plugin",
  request: {
    params: z.object({ pluginId: z.string(), endpointKey: z.string() }),
  },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/plugins/{pluginId}/dashboard",
  tags: ["plugins"],
  summary: "Get plugin dashboard data",
  request: { params: z.object({ pluginId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/plugins/{pluginId}/bridge/data",
  tags: ["plugins"],
  summary: "Send data via plugin bridge",
  request: {
    params: z.object({ pluginId: z.string() }),
    body: jsonBody(
      z.object({
        key: z.string(),
        companyId: z.string().optional(),
        params: z.record(z.string(), z.unknown()).optional(),
      }),
    ),
  },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/plugins/{pluginId}/bridge/action",
  tags: ["plugins"],
  summary: "Send action via plugin bridge",
  request: {
    params: z.object({ pluginId: z.string() }),
    body: jsonBody(
      z.object({
        key: z.string(),
        companyId: z.string().optional(),
        params: z.record(z.string(), z.unknown()).optional(),
      }),
    ),
  },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/plugins/{pluginId}/data/{key}",
  tags: ["plugins"],
  summary: "Get plugin data by key (URL-keyed bridge)",
  request: {
    params: z.object({ pluginId: z.string(), key: z.string() }),
    body: jsonBody(
      z.object({
        companyId: z.string().optional(),
        params: z.record(z.string(), z.unknown()).optional(),
      }),
    ),
  },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/plugins/{pluginId}/actions/{key}",
  tags: ["plugins"],
  summary: "Invoke a plugin action (URL-keyed bridge)",
  request: {
    params: z.object({ pluginId: z.string(), key: z.string() }),
    body: jsonBody(
      z.object({
        companyId: z.string().optional(),
        params: z.record(z.string(), z.unknown()).optional(),
      }),
    ),
  },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

// ─── Instance database backups ────────────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/instance/database-backups",
  tags: ["instance"],
  summary: "Trigger a database backup",
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registerCurrentRoute({
  method: "get",
  path: "/api/instance/attachment-retention",
  tags: ["instance"],
  summary: "Get the attachment retention policy and the last retention run",
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registerCurrentRoute({
  method: "post",
  path: "/api/instance/attachment-retention/preview",
  tags: ["instance"],
  summary: "Preview which attachment files retention would remove, without deleting anything",
  body: attachmentRetentionPreviewSchema,
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden },
});

registerCurrentRoute({
  method: "post",
  path: "/api/instance/attachment-retention/run",
  tags: ["instance"],
  summary: "Run attachment retention now with the saved policy",
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 409: r.conflict },
});

// ─── LLM text endpoints ───────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/llms/agent-configuration.txt",
  tags: ["llms"],
  summary: "Get agent configuration as plain text (for LLM context)",
  responses: {
    200: { description: "Plain text agent configuration" },
    401: r.unauthorized,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/llms/agent-configuration/{adapterType}.txt",
  tags: ["llms"],
  summary: "Get agent configuration for a specific adapter type",
  request: { params: z.object({ adapterType: z.string() }) },
  responses: {
    200: { description: "Plain text agent configuration" },
    401: r.unauthorized,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/llms/agent-icons.txt",
  tags: ["llms"],
  summary: "Get agent icon names as plain text",
  responses: {
    200: { description: "Plain text icon list" },
    401: r.unauthorized,
  },
});

// ─── Issues (legacy / misc) ───────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/issues",
  tags: ["issues"],
  summary:
    "Legacy — returns error directing to /api/companies/{companyId}/issues",
  responses: { 400: r.badRequest },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/comments/{commentId}",
  tags: ["issues"],
  summary: "Get a single issue comment",
  request: { params: z.object({ id: z.string(), commentId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/external-objects",
  tags: ["issues"],
  summary: "List external objects mentioned by an issue",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/issues/{id}/external-object-summary",
  tags: ["issues"],
  summary: "Get external object status summary for an issue",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/issues/external-object-summaries",
  tags: ["issues"],
  summary: "Get external object status summaries for issues",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(externalObjectSummariesBodySchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/issues/{id}/external-objects/refresh",
  tags: ["issues"],
  summary: "Refresh external objects mentioned by an issue",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(refreshExternalObjectsBodySchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/projects/{id}/external-object-summary",
  tags: ["projects"],
  summary: "Get external object status summary for a project",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

// ─── Org chart images ─────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/org.svg",
  tags: ["companies"],
  summary: "Get org chart as SVG",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: { description: "SVG image" }, 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/org.png",
  tags: ["companies"],
  summary: "Get org chart as PNG",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: { description: "PNG image" }, 401: r.unauthorized },
});

// ─── Company portability (legacy routes) ─────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/companies/issues",
  tags: ["companies"],
  summary: "Legacy — returns error directing to correct issues path",
  responses: { 400: r.badRequest },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/{companyId}/export",
  tags: ["companies"],
  summary: "Export a company (legacy singular form)",
  request: {
    params: z.object({ companyId: z.string() }),
    body: jsonBody(companyPortabilityExportSchema),
  },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "get",
  path: "/api/companies/{companyId}/export/fidelity",
  tags: ["companies"],
  summary: "Report company data that an export bundle does not include",
  request: { params: z.object({ companyId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/import/preview",
  tags: ["companies"],
  summary: "Preview a company import (legacy route)",
  description:
    "Accepts either the inline JSON body (`application/json`) or the raw company " +
    "package uploaded as a compressed zip (`multipart/form-data` with a `package` " +
    "file field plus a JSON `meta` field carrying the other import fields, or a bare " +
    "`application/zip` body with the `meta` JSON in the `meta` query parameter). The " +
    'zip is unzipped server-side into the same `{ source: { type: "inline", ... } }` ' +
    "bundle the JSON body carries.",
  request: { body: importRequestBody(companyPortabilityPreviewSchema) },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/companies/import",
  tags: ["companies"],
  summary: "Apply a company import (legacy route)",
  description:
    "Accepts either the inline JSON body (`application/json`) or the raw company package " +
    "uploaded as a compressed zip (`multipart/form-data` with a `package` file field plus a " +
    "JSON `meta` field, or a bare `application/zip` body with the `meta` JSON in the `meta` " +
    "query parameter); the zip is unzipped server-side into the same import bundle. " +
    "Callers can opt into asynchronous processing: trusted Cloud tenants set the " +
    "`x-paperclip-cloud-async-import: 1` header (browsers cannot — the Cloud harness proxy " +
    "strips inbound `x-paperclip-cloud-*` headers), while board sessions use the proxy-safe " +
    "`?async=1` query parameter. Either way the server responds 202 with a job id and status " +
    "URL instead of holding the connection open for the whole import. While a board actor " +
    "already has an async job running, a resubmit returns 409 carrying the running job's id " +
    "and status URL. Jobs are held in memory and are lost on restart.",
  request: {
    query: z.object({ async: z.enum(["1"]).optional() }),
    body: importRequestBody(companyPortabilityImportSchema),
  },
  responses: {
    200: r.ok(),
    202: { description: "Async import job accepted" },
    400: r.badRequest,
    401: r.unauthorized,
    409: {
      description: "An async import job is already running for this actor",
    },
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: COMPANY_IMPORT_TRANSFERS_API_PATH,
  tags: ["companies"],
  summary: "Declare a chunked company import transfer",
  description:
    "Declares the caller's existing company package .zip as content-addressed byte-range parts " +
    "(whole-file plus per-part sha256). Re-declaring the same zip resumes the prior transfer " +
    "with its uploaded parts intact; the response carries the transfer id and the part indexes " +
    "still missing.",
  request: { body: jsonBody(companyImportTransferDeclarationSchema) },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "put",
  path: `${COMPANY_IMPORT_TRANSFERS_API_PATH}/{transferId}/parts/{partIndex}`,
  tags: ["companies"],
  summary: "Upload one declared part of a company import transfer",
  description:
    "Raw part bytes as the request body. The upload is verified against the declared byte size " +
    "and sha256 before it is spooled; re-uploading an already completed part is a no-op success. " +
    "Uploading against a transfer the abandoned-spool sweep has expired returns 410 — the client " +
    "re-creates the transfer.",
  request: {
    params: z.object({ transferId: z.string(), partIndex: z.string() }),
    body: {
      content: {
        "application/octet-stream": {
          schema: {
            type: "string",
            format: "binary",
            description: "The raw part bytes.",
          },
        },
      },
      required: true as const,
    },
  },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    404: r.notFound,
    409: { description: "The transfer has already been applied" },
    410: {
      description: "The transfer expired and its spooled parts were deleted",
    },
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "get",
  path: `${COMPANY_IMPORT_TRANSFERS_API_PATH}/{transferId}`,
  tags: ["companies"],
  summary: "Get company import transfer progress",
  description:
    "Resume polling for a chunked import transfer: the transfer status plus which declared " +
    "parts are completed and which are still missing.",
  request: { params: z.object({ transferId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: `${COMPANY_IMPORT_TRANSFERS_API_PATH}/{transferId}/preview`,
  tags: ["companies"],
  summary: "Preview a completed company import transfer",
  description:
    "Runs the import preview against the assembled spool without consuming the transfer: the " +
    "ledger run stays open and the parts stay spooled, so the subsequent apply reuses them " +
    "instead of re-uploading. The JSON body carries the same fields as the multipart preview " +
    "route's `meta` field (include, target, collisionStrategy, ...).",
  request: {
    params: z.object({ transferId: z.string() }),
    body: jsonBody(companyPortabilityPreviewSchema.omit({ source: true })),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
    409: {
      description:
        "Parts are still missing, an apply is in progress, or the transfer was already applied",
    },
    410: {
      description: "The transfer expired and its spooled parts were deleted",
    },
    422: r.unprocessable,
  },
});

registry.registerPath({
  method: "post",
  path: `${COMPANY_IMPORT_TRANSFERS_API_PATH}/{transferId}/apply`,
  tags: ["companies"],
  summary: "Apply a completed company import transfer",
  description:
    "Assembles the spooled parts back into the original zip, verifies the whole file against " +
    "the declared hash fail-closed, and runs it through the same import pipeline as the " +
    "single-shot upload — including the async import job machinery via the proxy-safe " +
    "`?async=1` query parameter. The JSON body carries the same import fields as the multipart " +
    "route's `meta` field (include, target, collisionStrategy, ...). Overlapping applies of " +
    "the same transfer are serialized: exactly one proceeds, the rest get 409.",
  request: {
    params: z.object({ transferId: z.string() }),
    query: z.object({ async: z.enum(["1"]).optional() }),
    body: jsonBody(companyPortabilityImportSchema.omit({ source: true })),
  },
  responses: {
    200: r.ok(),
    202: { description: "Async import job accepted" },
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
    409: {
      description:
        "Parts are still missing, an apply is already in progress, or the transfer was already applied",
    },
    410: {
      description: "The transfer expired and its spooled parts were deleted",
    },
    422: r.unprocessable,
  },
});

// ─── Board claim & CLI auth ───────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/board-claim/{token}",
  tags: ["access"],
  summary: "Get board claim details by token",
  request: { params: z.object({ token: z.string() }) },
  responses: { 200: r.ok(), 404: r.notFound },
});

registry.registerPath({
  method: "post",
  path: "/api/board-claim/{token}/claim",
  tags: ["access"],
  summary: "Claim a board token",
  request: { params: z.object({ token: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/cli-auth/challenges/{id}",
  tags: ["access"],
  summary: "Get a CLI auth challenge",
  request: { params: z.object({ id: cliAuthChallengeIdParamSchema }) },
  responses: { 200: r.ok(), 400: r.badRequest, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/public/share/{token}",
  tags: ["public-share"],
  summary: "Read the public projection of a shared issue",
  request: { params: z.object({ token: z.string() }) },
  responses: { 200: r.ok(), 404: r.notFound, 429: r.tooManyRequests },
});

registry.registerPath({
  method: "get",
  path: "/api/public/share/{token}/issues/{issueId}",
  tags: ["public-share"],
  summary: "Read the public projection of an issue one hop from the shared issue",
  request: { params: z.object({ token: z.string(), issueId: z.string() }) },
  responses: { 200: r.ok(), 404: r.notFound, 429: r.tooManyRequests },
});

registry.registerPath({
  method: "get",
  path: "/api/public/share/{token}/attachments/{attachmentId}/content",
  tags: ["public-share"],
  summary: "Download a publicly visible attachment of a shared issue",
  request: { params: z.object({ token: z.string(), attachmentId: z.string() }) },
  responses: { 200: { description: "File content" }, 206: { description: "Partial file content" }, 404: r.notFound, 416: { description: "Range not satisfiable" }, 429: r.tooManyRequests },
});

registry.registerPath({
  method: "get",
  path: "/api/public/share/{token}/assets/{assetId}/content",
  tags: ["public-share"],
  summary: "Download a publicly visible work-product file or company logo of a shared issue",
  request: { params: z.object({ token: z.string(), assetId: z.string() }) },
  responses: { 200: { description: "File content" }, 206: { description: "Partial file content" }, 404: r.notFound, 416: { description: "Range not satisfiable" }, 429: r.tooManyRequests },
});

registry.registerPath({
  method: "get",
  path: "/api/public/share/{token}/issues/{issueId}/documents/{key}/pdf",
  tags: ["public-share"],
  summary: "Download a document of a shared issue as PDF",
  request: { params: z.object({ token: z.string(), issueId: z.string(), key: z.string() }) },
  responses: { 200: { description: "PDF document" }, 404: r.notFound, 429: r.tooManyRequests },
});

// ─── Invite onboarding ────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/invites/{token}/logo",
  tags: ["access"],
  summary: "Get company logo for an invite",
  request: { params: z.object({ token: z.string() }) },
  responses: { 200: { description: "Image file" }, 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/invites/{token}/onboarding",
  tags: ["access"],
  summary: "Get onboarding data for an invite",
  request: { params: z.object({ token: z.string() }) },
  responses: { 200: r.ok(), 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/invites/{token}/onboarding.txt",
  tags: ["access"],
  summary: "Get onboarding instructions as plain text",
  request: { params: z.object({ token: z.string() }) },
  responses: {
    200: { description: "Plain text onboarding instructions" },
    404: r.notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/invites/{token}/skills/index",
  tags: ["access"],
  summary: "Get skills index for an invite",
  request: { params: z.object({ token: z.string() }) },
  responses: { 200: r.ok(), 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/invites/{token}/skills/{skillName}",
  tags: ["access"],
  summary: "Get a skill by name for an invite",
  request: { params: z.object({ token: z.string(), skillName: z.string() }) },
  responses: { 200: r.ok(), 404: r.notFound },
});

registry.registerPath({
  method: "get",
  path: "/api/invites/{token}/test-resolution",
  tags: ["access"],
  summary: "Test invite token resolution",
  request: { params: z.object({ token: z.string() }) },
  responses: { 200: r.ok(), 404: r.notFound },
});

// ─── Admin ────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/admin/users/{userId}/company-access",
  tags: ["admin"],
  summary: "Get company access for a user (admin)",
  request: { params: z.object({ userId: z.string() }) },
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registry.registerPath({
  method: "put",
  path: "/api/admin/users/{userId}/company-access",
  tags: ["admin"],
  summary: "Set company access for a user (admin)",
  request: {
    params: z.object({ userId: z.string() }),
    body: jsonBody(updateUserCompanyAccessSchema),
  },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/admin/users/{userId}/promote-instance-admin",
  tags: ["admin"],
  summary: "Promote a user to instance admin",
  request: { params: z.object({ userId: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/admin/users/{userId}/demote-instance-admin",
  tags: ["admin"],
  summary: "Demote a user from instance admin",
  request: { params: z.object({ userId: z.string() }) },
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

// ─── Project workspace runtime ────────────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/projects/{id}/workspaces/{workspaceId}/runtime-services/{action}",
  tags: ["projects"],
  summary: "Control a runtime service in a project workspace",
  request: {
    params: z.object({
      id: z.string(),
      workspaceId: z.string(),
      action: z.string(),
    }),
    body: jsonBody(workspaceRuntimeControlTargetSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registry.registerPath({
  method: "post",
  path: "/api/projects/{id}/workspaces/{workspaceId}/runtime-commands/{action}",
  tags: ["projects"],
  summary: "Run a runtime command in a project workspace",
  request: {
    params: z.object({
      id: z.string(),
      workspaceId: z.string(),
      action: z.string(),
    }),
    body: jsonBody(workspaceRuntimeControlTargetSchema),
  },
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

// ─── Plugin bridge stream ─────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/plugins/{pluginId}/bridge/stream/{channel}",
  tags: ["plugins"],
  summary: "Subscribe to a plugin bridge SSE stream",
  request: {
    params: z.object({ pluginId: z.string(), channel: z.string() }),
    query: z.object({ companyId: z.string() }),
  },
  responses: {
    200: { description: "Server-sent event stream (text/event-stream)" },
    401: r.unauthorized,
  },
});

// ─── Plugin UI static ─────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/_plugins/{pluginId}/ui/{filePath}",
  tags: ["plugins"],
  summary: "Serve plugin UI static file",
  request: { params: z.object({ pluginId: z.string(), filePath: z.string() }) },
  responses: { 200: { description: "Static file content" }, 404: r.notFound },
});

// ─── Adapter UI parser ────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/adapters/{type}/ui-parser.js",
  tags: ["adapters"],
  summary: "Get adapter UI parser script",
  request: { params: z.object({ type: z.string() }) },
  responses: { 200: { description: "JavaScript file" }, 404: r.notFound },
});

// ─── Current route coverage ─────────────────────────────────────────────────

registerCurrentRoute({
  method: "get",
  path: "/api/adapters/{type}",
  tags: ["adapters"],
  summary: "Get adapter registration details",
});

registerCurrentRoute({
  method: "post",
  path: "/api/health/dev-server/restart",
  tags: ["health"],
  summary: "Request a managed dev-server restart",
  responses: {
    202: r.ok(),
    403: r.forbidden,
    404: r.notFound,
    409: { description: "Restart is not required" },
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/bootstrap/claim",
  tags: ["access"],
  summary: "Claim first instance admin from a browser session",
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    404: r.notFound,
    409: { description: "Instance admin already claimed" },
  },
});

registerCurrentRoute({
  method: "get",
  path: "/api/board-api-keys",
  tags: ["access"],
  summary: "List board API keys",
  responses: { 200: r.ok(), 401: r.unauthorized },
});

registerCurrentRoute({
  method: "post",
  path: "/api/board-api-keys",
  tags: ["access"],
  summary: "Create a named board API key",
  body: createBoardApiKeySchema,
  responses: { 201: r.ok(), 400: r.badRequest, 401: r.unauthorized },
});

registerCurrentRoute({
  method: "delete",
  path: "/api/board-api-keys/{keyId}",
  tags: ["access"],
  summary: "Revoke a board API key",
});

registry.registerPath({
  method: "get",
  path: "/api/companies/import/jobs/{jobId}",
  tags: ["companies"],
  summary: "Get company import job status",
  description:
    "A job is readable only by the actor that created it — the board user or the trusted Cloud " +
    "tenant identity from the async import submission. Any other caller gets the same 404 as an " +
    "unknown id. Jobs are held in memory: they are dropped a few minutes after finishing and do " +
    "not survive a server restart.",
  request: { params: z.object({ jobId: z.string() }) },
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

for (const route of [
  ["get", "/api/companies/{companyId}/search", "Search company data", undefined],
  [
    "get",
    "/api/companies/{companyId}/search/extract",
    "Extract company search matches",
    companySearchExtractQuerySchema,
  ],
  [
    "get",
    "/api/companies/{companyId}/issues/count",
    "Count issues in a company",
    issueCountQuerySchema,
  ],
] as const) {
  registerCurrentRoute({
    method: route[0],
    path: route[1],
    tags: ["companies"],
    summary: route[2],
    ...(route[3] ? { query: route[3] } : {}),
  });
}

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/folders",
  tags: ["folders"],
  summary: "List folders for a company item kind",
  query: z.object({ kind: folderKindSchema }),
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/folders",
  tags: ["folders"],
  summary: "Create a folder",
  body: createFolderSchema,
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/folders/ensure-my",
  tags: ["folders"],
  summary: "Ensure the current user's personal skill folder exists",
  body: ensureMySkillFolderSchema,
});

registerCurrentRoute({
  method: "patch",
  path: "/api/companies/{companyId}/folders/{folderId}",
  tags: ["folders"],
  summary: "Update a folder",
  body: updateFolderSchema,
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/folders/items/move",
  tags: ["folders"],
  summary: "Move an item into or out of a folder",
  body: moveFolderItemSchema,
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/folders/{folderId}/move",
  tags: ["folders"],
  summary: "Move or reorder a folder",
  body: moveFolderSchema,
});

registerCurrentRoute({
  method: "delete",
  path: "/api/companies/{companyId}/folders/{folderId}",
  tags: ["folders"],
  summary: "Delete a folder",
});

registerCurrentRoute({
  method: "get",
  path: "/api/issues/{id}/cost-summary",
  tags: ["costs"],
  summary: "Get issue cost summary",
});

registerCurrentRoute({
  method: "put",
  path: "/api/companies/{companyId}/resource-memberships/me/documents/{documentId}",
  tags: ["resource-memberships"],
  summary: "Star or unstar a document resource",
  body: updateDocumentResourceMembershipSchema,
});

for (const route of [
  [
    "get",
    "/api/companies/{companyId}/resource-memberships/me",
    "List current user's resource memberships",
  ],
  [
    "put",
    "/api/companies/{companyId}/resource-memberships/me/agents/{agentId}",
    "Join or leave an agent resource",
  ],
  [
    "put",
    "/api/companies/{companyId}/resource-memberships/me/projects/{projectId}",
    "Join or leave a project resource",
  ],
] as const) {
  registerCurrentRoute({
    method: route[0],
    path: route[1],
    tags: ["resource-memberships"],
    summary: route[2],
    ...(route[0] === "put" ? { body: updateResourceMembershipSchema } : {}),
  });
}

for (const route of [
  [
    "get",
    "/api/companies/{companyId}/secret-providers/health",
    "Check configured secret providers",
  ],
  [
    "get",
    "/api/companies/{companyId}/secret-provider-configs",
    "List secret provider configurations",
  ],
  [
    "get",
    "/api/secret-provider-configs/{id}",
    "Get a secret provider configuration",
  ],
  [
    "delete",
    "/api/secret-provider-configs/{id}",
    "Delete a secret provider configuration",
  ],
  [
    "post",
    "/api/secret-provider-configs/{id}/default",
    "Set the default secret provider configuration",
  ],
  [
    "post",
    "/api/secret-provider-configs/{id}/health",
    "Check a secret provider configuration",
  ],
  ["get", "/api/secrets/{id}/usage", "Get secret usage"],
  ["get", "/api/secrets/{id}/access-events", "List secret access events"],
] as const) {
  registerCurrentRoute({
    method: route[0],
    path: route[1],
    tags: ["secrets"],
    summary: route[2],
  });
}

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/secret-provider-configs",
  tags: ["secrets"],
  summary: "Create a secret provider configuration",
  body: createSecretProviderConfigSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "patch",
  path: "/api/secret-provider-configs/{id}",
  tags: ["secrets"],
  summary: "Update a secret provider configuration",
  body: updateSecretProviderConfigSchema,
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/secret-provider-configs/discovery/preview",
  tags: ["secrets"],
  summary: "Preview secret provider discovery",
  body: secretProviderConfigDiscoveryPreviewSchema,
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/secrets/remote-import/preview",
  tags: ["secrets"],
  summary: "Preview remote secret import",
  body: remoteSecretImportPreviewSchema,
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/secrets/remote-import",
  tags: ["secrets"],
  summary: "Import remote secrets",
  body: remoteSecretImportSchema,
});

for (const route of [
  ["get", "/api/skills/catalog", "List catalog skills"],
  ["get", "/api/skills/catalog/{catalogId}", "Get a catalog skill"],
  ["get", "/api/skills/catalog/{catalogId}/files", "List catalog skill files"],
  [
    "post",
    "/api/companies/{companyId}/skills/install-catalog",
    "Install a catalog skill",
  ],
  [
    "get",
    "/api/companies/{companyId}/skills/categories",
    "List company skill categories",
  ],
  [
    "post",
    "/api/companies/{companyId}/skills/{skillId}/audit",
    "Audit a company skill",
  ],
  [
    "patch",
    "/api/companies/{companyId}/skills/{skillId}",
    "Update a company skill",
  ],
  [
    "get",
    "/api/companies/{companyId}/skills/{skillId}/versions",
    "List skill versions",
  ],
  [
    "post",
    "/api/companies/{companyId}/skills/{skillId}/versions",
    "Create a skill version",
  ],
  [
    "get",
    "/api/companies/{companyId}/skills/{skillId}/versions/{versionId}",
    "Get a skill version",
  ],
  [
    "post",
    "/api/companies/{companyId}/skills/{skillId}/star",
    "Star a company skill",
  ],
  [
    "delete",
    "/api/companies/{companyId}/skills/{skillId}/star",
    "Unstar a company skill",
  ],
  [
    "get",
    "/api/companies/{companyId}/skills/{skillId}/fork-precheck",
    "Preview company skill fork impact",
  ],
  [
    "post",
    "/api/companies/{companyId}/skills/{skillId}/fork",
    "Fork a company skill",
  ],
  [
    "get",
    "/api/companies/{companyId}/skills/{skillId}/comments",
    "List skill comments",
  ],
  [
    "post",
    "/api/companies/{companyId}/skills/{skillId}/comments",
    "Create a skill comment",
  ],
  [
    "patch",
    "/api/companies/{companyId}/skills/{skillId}/comments/{commentId}",
    "Update a skill comment",
  ],
  [
    "delete",
    "/api/companies/{companyId}/skills/{skillId}/comments/{commentId}",
    "Delete a skill comment",
  ],
  [
    "post",
    "/api/companies/{companyId}/skills/{skillId}/reset",
    "Reset a company skill",
  ],
] as const) {
  registerCurrentRoute({
    method: route[0],
    path: route[1],
    tags: ["skills"],
    summary: route[2],
    ...(route[0] === "post"
      ? { body: z.record(z.string(), z.unknown()).optional() }
      : {}),
  });
}

registerCurrentRoute({
  method: "get",
  path: "/api/issues/{id}/accepted-plan-decompositions",
  tags: ["issues"],
  summary: "List accepted plan decompositions",
});

registerCurrentRoute({
  method: "post",
  path: "/api/issues/{id}/accepted-plan-decompositions",
  tags: ["issues"],
  summary: "Create accepted plan decomposition child issues",
  body: createAcceptedPlanDecompositionSchema,
});

for (const route of [
  [
    "get",
    "/api/issues/{id}/documents/{key}/annotations",
    "List document annotation threads",
  ],
  [
    "get",
    "/api/issues/{id}/documents/{key}/annotations/{threadId}",
    "Get a document annotation thread",
  ],
  ["post", "/api/issues/{id}/documents/{key}/lock", "Lock an issue document"],
  [
    "post",
    "/api/issues/{id}/documents/{key}/unlock",
    "Unlock an issue document",
  ],
] as const) {
  registerCurrentRoute({
    method: route[0],
    path: route[1],
    tags: ["issues"],
    summary: route[2],
  });
}

registerCurrentRoute({
  method: "post",
  path: "/api/issues/{id}/documents/{key}/annotations",
  tags: ["issues"],
  summary: "Create a document annotation thread",
  body: createDocumentAnnotationThreadSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/issues/{id}/documents/{key}/annotations/{threadId}/comments",
  tags: ["issues"],
  summary: "Add a document annotation comment",
  body: createDocumentAnnotationCommentSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/issues/{id}/low-trust/promotions",
  tags: ["issues"],
  summary: "Promote quarantined low-trust output",
  body: z.object({
    sourceArtifactKind: z.enum([
      "comment",
      "document",
      "work_product",
      "issue",
    ]),
    sourceArtifactId: z.string().guid(),
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(8_000),
  }),
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  method: "patch",
  path: "/api/issues/{id}/documents/{key}/annotations/{threadId}",
  tags: ["issues"],
  summary: "Update a document annotation thread",
  body: updateDocumentAnnotationThreadSchema,
});

registerCurrentRoute({
  method: "get",
  path: "/api/issues/{id}/diagnostics/blockers",
  tags: ["issues"],
  summary: "Get blocker diagnostics for an issue",
});

registerCurrentRoute({
  method: "get",
  path: "/api/issues/{id}/diagnostics/wakes",
  tags: ["issues"],
  summary: "Get wake diagnostics for an issue",
});

registerCurrentRoute({
  method: "get",
  path: "/api/issues/{id}/diagnostics/subtree",
  tags: ["issues"],
  summary: "Get bounded subtree wake and blocker diagnostics for an issue",
});

registerCurrentRoute({
  method: "get",
  path: "/api/issues/{id}/recovery-actions",
  tags: ["issues"],
  summary: "List issue recovery actions",
});

registerCurrentRoute({
  method: "post",
  path: "/api/issues/{id}/recovery-actions/retry-workspace-export",
  tags: ["issues"],
  summary: "Retry only workspace export for a repaired accepted native result",
  body: retryWorkspaceExportSchema,
  responses: { 202: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});

registerCurrentRoute({
  method: "post",
  path: "/api/issues/{id}/recovery-actions/resolve",
  tags: ["issues"],
  summary: "Resolve an issue recovery action",
  body: resolveIssueRecoveryActionSchema,
});

registerCurrentRoute({
  method: "post",
  path: "/api/issues/{id}/scheduled-retry/retry-now",
  tags: ["issues"],
  summary: "Retry a scheduled issue run now",
});

registerCurrentRoute({
  method: "post",
  path: "/api/issues/{id}/monitor/check-now",
  tags: ["issues"],
  summary: "Run an issue monitor check now",
});

registerCurrentRoute({
  method: "post",
  path: "/api/issues/{id}/interactions/{interactionId}/cancel",
  tags: ["issues"],
  summary: "Cancel an issue question interaction",
  body: cancelIssueThreadInteractionSchema,
});

registerCurrentRoute({
  method: "post",
  path: "/api/issues/{id}/interactions/{interactionId}/skip",
  tags: ["issues"],
  summary: "Skip a pending issue thread interaction",
  body: skipIssueThreadInteractionSchema,
});

registerCurrentRoute({
  method: "post",
  path: "/api/issues/{id}/interactions/{interactionId}/withdraw",
  tags: ["issues"],
  summary: "Withdraw a pending issue thread interaction",
  body: withdrawIssueThreadInteractionSchema,
});

for (const route of [
  ["get", "/api/routines/{id}/revisions", "List routine revisions"],
  [
    "post",
    "/api/routines/{id}/revisions/{revisionId}/restore",
    "Restore a routine revision",
  ],
  [
    "get",
    "/api/routines/{id}/description/annotations",
    "List routine description annotation threads",
  ],
  [
    "get",
    "/api/routines/{id}/description/annotations/{threadId}",
    "Get a routine description annotation thread",
  ],
] as const) {
  registerCurrentRoute({
    method: route[0],
    path: route[1],
    tags: ["routines"],
    summary: route[2],
  });
}

registerCurrentRoute({
  method: "post",
  path: "/api/routines/{id}/description/annotations",
  tags: ["routines"],
  summary: "Create a routine description annotation thread",
  body: createDocumentAnnotationThreadSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/routines/{id}/description/annotations/{threadId}/comments",
  tags: ["routines"],
  summary: "Add a routine description annotation comment",
  body: createDocumentAnnotationCommentSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "patch",
  path: "/api/routines/{id}/description/annotations/{threadId}",
  tags: ["routines"],
  summary: "Update a routine description annotation thread",
  body: updateDocumentAnnotationThreadSchema,
});

const pluginLocalFolderRequestSchema = z.object({
  path: z.string().min(1),
  access: z.enum(["read", "readWrite"]).optional(),
  requiredDirectories: z.array(z.string()).optional(),
  requiredFiles: z.array(z.string()).optional(),
});

for (const route of [
  [
    "get",
    "/api/plugins/{pluginId}/companies/{companyId}/local-folders",
    "List plugin local folders",
  ],
  [
    "get",
    "/api/plugins/{pluginId}/companies/{companyId}/local-folders/{folderKey}/status",
    "Get plugin local folder status",
  ],
  [
    "post",
    "/api/plugins/{pluginId}/companies/{companyId}/local-folders/{folderKey}/validate",
    "Validate a plugin local folder",
  ],
  [
    "put",
    "/api/plugins/{pluginId}/companies/{companyId}/local-folders/{folderKey}",
    "Save a plugin local folder",
  ],
] as const) {
  registerCurrentRoute({
    method: route[0],
    path: route[1],
    tags: ["plugins"],
    summary: route[2],
    ...(route[0] === "post" || route[0] === "put"
      ? { body: pluginLocalFolderRequestSchema }
      : {}),
  });
}

// --- Connection intents ------------------------------------------------------

registerCurrentRoute({
  method: "post",
  path: "/api/mcp/project-tools",
  tags: ["projects"],
  summary: "Call project and task tools through the active task run's MCP transport",
  body: z.object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number()]).nullable().optional(),
    method: z.string(),
    params: z.record(z.string(), z.unknown()).optional(),
  }),
  responses: { 200: r.ok(), 202: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 409: r.conflict },
});

registerCurrentRoute({
  method: "post",
  path: "/api/mcp/paperclip",
  tags: ["projects"],
  summary: "Call the Paperclip tool surface over the server-hosted MCP endpoint",
  body: z.object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number()]).nullable().optional(),
    method: z.string(),
    params: z.record(z.string(), z.unknown()).optional(),
  }),
  responses: { 200: r.ok(), 202: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden },
});

registerCurrentRoute({
  method: "get",
  path: "/api/mcp/paperclip",
  tags: ["projects"],
  summary: "Reject the server-to-client stream the stateless Paperclip MCP endpoint does not offer",
});

registerCurrentRoute({
  method: "delete",
  path: "/api/mcp/paperclip",
  tags: ["projects"],
  summary: "Reject session termination the stateless Paperclip MCP endpoint does not implement",
});

registerCurrentRoute({
  method: "post",
  path: "/runtime-tools/github/credentials",
  tags: ["connection-intents"],
  summary:
    "Resolve operation credentials using a run capability with github_credentials scope; browser sessions are rejected",
  responses: {
    200: r.ok(),
    401: r.unauthorized,
    403: r.forbidden,
    409: r.conflict,
  },
});

registerCurrentRoute({
  method: "get",
  path: "/mcp/runtime-tools",
  tags: ["connection-intents"],
  summary: "Reject SSE discovery because the runtime tools endpoint supports POST only",
  responses: { 405: { description: "SSE stream is not supported" }, 401: r.unauthorized, 403: r.forbidden },
});

registerCurrentRoute({
  method: "post",
  path: "/mcp/runtime-tools",
  tags: ["connection-intents"],
  summary: "Call the heartbeat-bound runtime tools MCP endpoint",
  responses: {
    200: r.ok(),
    202: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/runtime-tools/connections/search",
  tags: ["connection-intents"],
  summary: "Search connections available to the active heartbeat run",
  body: connectionsSearchInputSchema,
});

registerCurrentRoute({
  method: "post",
  path: "/runtime-tools/connections/request",
  tags: ["connection-intents"],
  summary: "Request a connection for the active heartbeat run",
  body: connectionRequestInputSchema,
});

registerCurrentRoute({
  method: "get",
  path: "/api/connection-intents/{interactionId}/setup-options",
  tags: ["connection-intents"],
  summary: "Get setup options for an addressed connection request",
});

registerCurrentRoute({
  method: "post",
  path: "/api/connection-intents/{interactionId}/phase",
  tags: ["connection-intents"],
  summary: "Update the setup phase for an addressed connection request",
  body: z
    .object({
      phase: z.enum(["requested", "authorizing", "needs_retry"]),
    })
    .strict(),
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/connection-intents/{interactionId}/complete",
  tags: ["connection-intents"],
  summary: "Complete an addressed connection request",
  body: completeConnectionIntentSchema,
});

registerCurrentRoute({
  method: "post",
  path: "/api/agents/{id}/connection-intents/{interactionId}/adopt",
  tags: ["connection-intents", "agents"],
  summary: "Validate and atomically adopt an AI connection for a legacy agent",
  body: completeConnectionIntentSchema,
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/connection-intents/{interactionId}/decline",
  tags: ["connection-intents"],
  summary: "Decline an addressed connection request",
  body: declineConnectionIntentSchema,
});

// --- AI runtime connections -------------------------------------------------

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/ai-connection-pools",
  tags: ["ai-connections"],
  summary: "List company AI connection pools for connection managers",
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/ai-connection-pools",
  tags: ["ai-connections"],
  summary: "Create or revise an experimental plugin-owned connection pool",
  body: z.object({ pluginKey: z.string().min(1), id: z.string().uuid().optional(), expectedRevision: z.number().int().positive().optional(), config: aiConnectionPoolConfigSchema }).strict(),
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict, 422: r.unprocessable },
});

registerCurrentRoute({
  method: "delete",
  path: "/api/companies/{companyId}/ai-connection-pools/{poolId}",
  tags: ["ai-connections"],
  summary: "Delete a connection pool while retaining task and run records",
  body: z.object({ expectedRevision: z.number().int().positive() }).strict(),
  responses: { 200: r.ok(z.object({ ok: z.literal(true) })), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 409: r.conflict },
});

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/ai-connection-pools/{poolId}/inspection",
  tags: ["ai-connections"],
  summary: "Inspect authorized pool members and fresh cached usage without probing",
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/ai-connections/{connectionId}/usage",
  tags: ["ai-connections"],
  summary: "Probe the selected AI account’s provider usage limits on demand",
  query: z.object({ grantId: z.string().uuid().optional() }),
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 422: r.unprocessable },
});

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/ai-connections",
  tags: ["ai-connections"],
  summary: "List available AI connections, personal defaults, and connection-manager access",
  query: z.object({ agentId: z.string().uuid().optional() }),
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 422: r.unprocessable },
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/ai-connections",
  tags: ["ai-connections"],
  summary: "Validate and connect an AI API key, or reconnect its existing grant",
  body: createAiConnectionSchema,
  responses: { 201: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 422: r.unprocessable },
});

registerCurrentRoute({
  method: "put",
  path: "/api/companies/{companyId}/ai-connections/default",
  tags: ["ai-connections"],
  summary: "Set the signed-in owner’s personal AI default",
  body: z.object({ grantId: z.string().uuid() }),
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 422: r.unprocessable },
});

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/ai-connections/{connectionId}/active-runs",
  tags: ["ai-connections"],
  summary: "List active runs attributed to an AI connection",
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 422: r.unprocessable },
});

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/ai-connections/login/{sessionId}",
  tags: ["ai-connections"],
  summary: "Get the connection saved by an owned completed login",
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 422: r.unprocessable },
});

// --- Tool access -------------------------------------------------------------

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/tools/gallery",
  tags: ["tool-access"],
  summary: "List tool app gallery entries",
});

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/tools/apps/{galleryKey}/preflight",
  tags: ["tool-access"],
  summary:
    "Inspect a curated app's public MCP and OAuth metadata without credentials or registration",
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/tools/apps/connect",
  tags: ["tool-access"],
  summary: "Create a draft app connection from gallery input",
  body: connectToolAppSchema,
  responses: {
    200: r.ok(),
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/tools/apps/{connectionId}/finish",
  tags: ["tool-access"],
  summary: "Finish a gallery app connection and profile setup",
  body: finishToolAppSchema,
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/tools/apps/{connectionId}/finalize-oauth-access",
  tags: ["tool-access"],
  summary: "Choose personal or company-wide access after OAuth sign-in",
  body: finalizeOAuthAccessSchema,
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/tools/apps/attention",
  tags: ["tool-access"],
  summary: "List tool apps needing attention",
});

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/tools/action-requests",
  tags: ["tool-access"],
  summary: "List pending tool action requests",
});

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/tools/examples",
  tags: ["tool-access"],
  summary: "List installable tool examples",
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/tools/examples/{id}/install",
  tags: ["tool-access"],
  summary: "Install a safe tool example",
  responses: {
    200: r.ok(),
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/tools/examples/{id}/smoke",
  tags: ["tool-access"],
  summary: "Run tool example governance smoke checks",
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/tools/applications",
  tags: ["tool-access"],
  summary: "List tool applications",
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/tools/applications",
  tags: ["tool-access"],
  summary: "Create a tool application",
  body: createToolApplicationSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "patch",
  path: "/api/tool-applications/{applicationId}",
  tags: ["tool-access"],
  summary: "Update a tool application",
  body: updateToolApplicationSchema,
});

registerCurrentRoute({
  method: "delete",
  path: "/api/tool-applications/{applicationId}",
  tags: ["tool-access"],
  summary: "Delete a tool application",
});

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/tools/connections",
  tags: ["tool-access"],
  summary: "List tool connections",
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/tools/connections",
  tags: ["tool-access"],
  summary: "Create a tool connection",
  body: createToolConnectionSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "get",
  path: "/api/tool-connections/{connectionId}",
  tags: ["tool-access"],
  summary: "Get a tool connection",
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/tools/connections/{connectionId}/start-authorization",
  tags: ["tool-access"],
  summary: "Start user authorization for a tool connection",
  body: startConnectionAuthorizationSchema,
});

registerCurrentRoute({
  method: "post",
  path: "/api/agents/me/connections/{connectionId}/start-authorization",
  tags: ["tool-access"],
  summary: "Start user authorization for an agent tool connection",
  body: startConnectionAuthorizationSchema,
});

registerCurrentRoute({
  method: "get",
  path: "/api/tool-connections/{connectionId}/grants",
  tags: ["tool-access"],
  summary: "List tool connection grants",
});

registerCurrentRoute({
  method: "post",
  path: "/api/tool-connections/{connectionId}/grants/installations",
  tags: ["tool-access"],
  summary: "Add an installation grant to a tool connection",
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/tool-connections/{connectionId}/grants/{grantId}/delegations",
  tags: ["tool-access"],
  summary: "Delegate a personal tool connection grant to an agent",
  body: createConnectionGrantDelegationSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "delete",
  path: "/api/tool-connections/{connectionId}/grants/{grantId}/delegations/{delegationId}",
  tags: ["tool-access"],
  summary: "Revoke a personal tool connection grant delegation",
});

registerCurrentRoute({
  method: "delete",
  path: "/api/tool-connections/{connectionId}/grants/{grantId}",
  tags: ["tool-access"],
  summary: "Revoke a tool connection grant",
});

registerCurrentRoute({
  method: "get",
  path: "/api/tool-connections/{connectionId}/usage",
  tags: ["tool-access"],
  summary: "Get tool connection usage",
});

registerCurrentRoute({
  method: "put",
  path: "/api/tool-connections/{connectionId}/grants/{grantId}/members",
  tags: ["tool-access"],
  summary: "Replace the member audience of a tool connection grant",
});

registerCurrentRoute({
  method: "post",
  path: "/api/tool-connections/{connectionId}/railway/ssh",
  tags: ["tool-access"],
  summary: "Prepare, enable, or remove a Railway container SSH key",
  body: configureRailwaySshSchema,
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  method: "get",
  path: "/api/tool-connections/{connectionId}/installs",
  tags: ["tool-access"],
  summary: "List tool connection installs",
});

registerCurrentRoute({
  method: "put",
  path: "/api/tool-connections/{connectionId}/installs",
  tags: ["tool-access"],
  summary: "Sync tool connection installs",
  body: putToolConnectionInstallsSchema,
});

registerCurrentRoute({
  method: "patch",
  path: "/api/tool-connections/{connectionId}",
  tags: ["tool-access"],
  summary: "Update a tool connection",
  body: updateToolConnectionSchema,
});

registerCurrentRoute({
  method: "delete",
  path: "/api/tool-connections/{connectionId}",
  tags: ["tool-access"],
  summary: "Archive a tool connection",
});

registerCurrentRoute({
  method: "post",
  path: "/api/tool-connections/{connectionId}/health-check",
  tags: ["tool-access"],
  summary: "Run a tool connection health check",
});

registerCurrentRoute({
  method: "post",
  path: "/api/tool-connections/{connectionId}/reconnect",
  tags: ["tool-access"],
  summary: "Reconnect a tool app with replacement credentials",
  body: reconnectToolAppSchema,
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/tool-connections/{connectionId}/catalog/refresh",
  tags: ["tool-access"],
  summary: "Refresh a tool connection catalog",
});

registerCurrentRoute({
  method: "get",
  path: "/api/tool-connections/{connectionId}/catalog",
  tags: ["tool-access"],
  summary: "List a tool connection catalog",
});

registerCurrentRoute({
  method: "get",
  path: "/api/tool-connections/{connectionId}/activity",
  tags: ["tool-access"],
  summary: "List tool connection activity",
});

for (const provider of ["aggregator", "composio"] as const) {
  registerCurrentRoute({
    method: "get", path: `/api/tool-connections/{connectionId}/${provider}/apps`, tags: ["tool-access"],
    summary: "List upstream account observations for the current connection manager",
  });
  registerCurrentRoute({
    method: "post", path: `/api/tool-connections/{connectionId}/${provider}/apps/sync`, tags: ["tool-access"],
    summary: "Start upstream account discovery without changing tool access",
    body: provider === "aggregator" ? aggregatorAppsSyncSchema : composioAppsSyncSchema,
  });
  registerCurrentRoute({
    method: "post", path: `/api/tool-connections/{connectionId}/${provider}/apps/refresh`, tags: ["tool-access"],
    summary: "Refresh upstream account observations",
    body: provider === "aggregator" ? aggregatorAppsRefreshSchema : composioAppsRefreshSchema,
  });
}
registerCurrentRoute({
  method: "put", path: "/api/tool-connections/{connectionId}/aggregator/discovery", tags: ["tool-access"],
  summary: "Save manager-owned optional Arcade account discovery credentials",
  body: arcadeDiscoverySetupSchema,
});
registerCurrentRoute({
  method: "post", path: "/api/tool-connections/{connectionId}/composio/apps/{toolkit}/setup", tags: ["tool-access"],
  summary: "Start or verify Composio app authorization through a saved gateway",
  body: composioAppSetupSchema,
});
registerCurrentRoute({
  method: "post", path: "/api/tool-connections/{connectionId}/composio/apps/{toolkit}/accounts", tags: ["tool-access"],
  summary: "Manage a Composio account through a saved gateway",
  body: composioAppAccountSchema,
});

registerCurrentRoute({
  method: "get",
  path: "/api/tool-connections/{connectionId}/test-agents",
  tags: ["tool-access"],
  summary: "List agents available for tool connection test calls",
});

registerCurrentRoute({
  method: "get",
  path: "/api/tool-connections/{connectionId}/test-agents/{agentId}/access",
  tags: ["tool-access"],
  summary: "Summarize one agent's effective access to a tool connection",
});

registerCurrentRoute({
  method: "post",
  path: "/api/tool-connections/{connectionId}/test-calls",
  tags: ["tool-access"],
  summary: "Run a tool connection test call",
  body: toolConnectionTestCallSchema,
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
    501: r.ok(),
  },
});

registerCurrentRoute({
  method: "get",
  path: "/api/tool-connections/{connectionId}/test-calls/{actionRequestId}",
  tags: ["tool-access"],
  summary: "Get a tool connection test call status",
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    501: r.ok(),
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/tools/oauth/{connectionId}/start",
  tags: ["tool-access"],
  summary: "Start OAuth sign-in for a tool connection",
  body: startToolOAuthSchema,
});

registerCurrentRoute({
  method: "get",
  path: "/api/tools/oauth/callback",
  tags: ["tool-access"],
  summary: "Handle a tool app OAuth callback",
});

registerCurrentRoute({
  method: "get",
  path: "/api/tools/oauth/cloud-connector/callback",
  tags: ["tool-access"],
  summary: "Handle a brokered Paperclip Cloud OAuth callback",
});

registerCurrentRoute({
  method: "get",
  path: "/api/tools/oauth/paperclip-id/callback",
  tags: ["tool-access"],
  summary: "Handle a legacy brokered Paperclip ID OAuth callback",
});

registerCurrentRoute({
  method: "get",
  path: "/api/tools/oauth/cloud-connector/enrollment",
  tags: ["tool-access"],
  summary: "Get Paperclip Cloud connector enrollment status",
});

registerCurrentRoute({
  method: "post",
  path: "/api/tools/oauth/cloud-connector/enrollment",
  tags: ["tool-access"],
  summary: "Start Paperclip Cloud connector enrollment",
  body: z
    .object({ companyId: z.string().min(1), label: z.string().optional() })
    .strict(),
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  method: "get",
  path: "/api/tools/oauth/cloud-connector/enrollment-callback",
  tags: ["tool-access"],
  summary: "Complete Paperclip Cloud connector enrollment",
  query: z
    .object({
      enrollment_id: z.string().min(1),
      approval_code: z.string().min(1),
      state: z.string().min(1),
    })
    .strict(),
});

registerCurrentRoute({
  method: "get",
  path: "/api/tools/vercel-connect/callback",
  tags: ["tool-access"],
  summary: "Handle a managed Vercel Connect OAuth callback",
});

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/tools/profiles",
  tags: ["tool-access"],
  summary: "List tool access profiles with entries and bindings",
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/tools/profiles",
  tags: ["tool-access"],
  summary: "Create a tool access profile",
  body: createToolProfileWithEntriesSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    409: r.conflict,
  },
});

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/tools/profiles/effective/agents/{agentId}",
  tags: ["tool-access"],
  summary: "Resolve effective tool access profiles for an agent",
});

registerCurrentRoute({
  method: "get",
  path: "/api/tool-profiles/{profileId}/new-tools",
  tags: ["tool-access"],
  summary: "List new catalog tools pending profile review",
});

registerCurrentRoute({
  method: "patch",
  path: "/api/tool-profiles/{profileId}",
  tags: ["tool-access"],
  summary: "Update a tool access profile",
  body: updateToolProfileWithEntriesSchema,
});

registerCurrentRoute({
  method: "post",
  path: "/api/tool-profiles/{profileId}/duplicate",
  tags: ["tool-access"],
  summary: "Duplicate a tool access profile",
  body: duplicateToolProfileSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    409: r.conflict,
  },
});

registerCurrentRoute({
  method: "delete",
  path: "/api/tool-profiles/{profileId}",
  tags: ["tool-access"],
  summary: "Delete a tool access profile",
  body: deleteToolProfileSchema,
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/tool-profiles/{profileId}/new-tools/review",
  tags: ["tool-access"],
  summary: "Review new catalog tools for a profile",
  body: reviewToolProfileNewToolsSchema,
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/tool-profiles/{profileId}/entries",
  tags: ["tool-access"],
  summary: "Create a tool access profile entry",
  body: createToolProfileEntryForProfileSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  method: "patch",
  path: "/api/tool-profile-entries/{entryId}",
  tags: ["tool-access"],
  summary: "Update a tool access profile entry",
  body: updateToolProfileEntrySchema,
});

registerCurrentRoute({
  method: "delete",
  path: "/api/tool-profile-entries/{entryId}",
  tags: ["tool-access"],
  summary: "Delete a tool access profile entry",
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/tools/profiles/{profileId}/bind",
  tags: ["tool-access"],
  summary:
    "Bind a tool access profile to a company, agent, project, routine, or issue",
  body: createToolProfileBindingForProfileSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    409: r.conflict,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/tools/profiles/{profileId}/unbind",
  tags: ["tool-access"],
  summary:
    "Unbind a tool access profile from a company, agent, project, routine, or issue",
  body: unbindToolProfileBindingSchema,
});

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/tools/runtime-slots",
  tags: ["tool-access"],
  summary: "List MCP runtime slots",
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/tools/runtime-slots/{id}/stop",
  tags: ["tool-access"],
  summary: "Stop a local stdio MCP runtime slot",
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/tools/runtime-slots/{id}/restart",
  tags: ["tool-access"],
  summary: "Restart a local stdio MCP runtime slot",
});

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/tools/runtime-health",
  tags: ["tool-access"],
  summary: "Summarize MCP runtime health and alert recommendations",
});

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/tools/runs/{runId}/decisions",
  tags: ["tool-access"],
  summary: "Get governed tool decisions for a run transcript",
});

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/tools/trust-rules",
  tags: ["tool-access"],
  summary: "List tool trust rules",
});

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/tools/policies",
  tags: ["tool-access"],
  summary: "List tool policies",
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/tools/policies/reorder",
  tags: ["tool-access"],
  summary: "Reorder tool policies",
  body: reorderToolPoliciesSchema,
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/tools/policies",
  tags: ["tool-access"],
  summary: "Create a tool policy",
  body: createToolPolicySchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    409: r.conflict,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/tools/policies/{policyId}/duplicate",
  tags: ["tool-access"],
  summary: "Duplicate a tool policy",
  body: duplicateToolPolicySchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    409: r.conflict,
  },
});

registerCurrentRoute({
  method: "patch",
  path: "/api/companies/{companyId}/tools/policies/{policyId}",
  tags: ["tool-access"],
  summary: "Update a tool policy",
  body: updateToolPolicySchema,
});

registerCurrentRoute({
  method: "delete",
  path: "/api/companies/{companyId}/tools/policies/{policyId}",
  tags: ["tool-access"],
  summary: "Delete a tool policy",
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/tools/action-requests/{actionRequestId}/trust-rule",
  tags: ["tool-access"],
  summary: "Create a tool trust rule from an action request",
  body: createToolTrustRuleFromActionRequestSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/tools/trust-rules/{policyId}/revoke",
  tags: ["tool-access"],
  summary: "Revoke a tool trust rule",
  body: revokeToolTrustRuleSchema,
});

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/tools/stdio-templates",
  tags: ["tool-access"],
  summary: "List approved stdio MCP templates",
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/tools/stdio-templates",
  tags: ["tool-access"],
  summary: "Create an approved stdio MCP template",
  body: createToolStdioCommandTemplateSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    409: r.conflict,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/tools/stdio-templates/{templateId}/disable",
  tags: ["tool-access"],
  summary: "Disable an approved stdio MCP template",
  body: disableToolStdioCommandTemplateSchema,
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/tools/mcp/import-json",
  tags: ["tool-access"],
  summary: "Preview MCP JSON import",
  body: importMcpJsonSchema,
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/tools/policy/test",
  tags: ["tool-access"],
  summary: "Test tool policy decision",
  body: toolPolicyTestRequestSchema,
});

// --- Tool gateway ------------------------------------------------------------

const toolGatewaySessionSchema = z.object({
  companyId: z.string().optional(),
  agentId: z.string().optional(),
  runId: z.string().optional(),
  issueId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  ttlMs: z.number().int().positive().optional(),
});

const toolGatewayCallSchema = z.object({
  tool: z.string(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  timeoutMs: z.number().int().positive().optional(),
  approvedActionRequestId: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

const toolGatewayCompanyQuerySchema = z.object({
  companyId: z.string().optional(),
});
const toolGatewayCompanyBodySchema = z
  .object({
    companyId: z.string(),
  })
  .passthrough();

const mcpGatewayProtocolSchema = z.record(z.string(), z.unknown());

registerCurrentRoute({
  method: "get",
  path: "/mcp/gateways/{gatewayPublicId}",
  tags: ["tool-gateway"],
  summary: "Describe a public MCP gateway endpoint",
});

registerCurrentRoute({
  method: "post",
  path: "/mcp/gateways/{gatewayPublicId}",
  tags: ["tool-gateway"],
  summary: "Handle MCP gateway protocol requests by public id",
  body: mcpGatewayProtocolSchema,
  responses: {
    200: r.ok(),
    202: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    429: r.ok(),
  },
});

registerCurrentRoute({
  method: "get",
  path: "/api/companies/{companyId}/tools/gateways",
  tags: ["tool-gateway"],
  summary: "List named MCP gateways",
});

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/tools/gateways",
  tags: ["tool-gateway"],
  summary: "Create a named MCP gateway",
  body: createToolMcpGatewaySchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  method: "patch",
  path: "/api/tool-gateway/gateways/{gatewayId}",
  tags: ["tool-gateway"],
  summary: "Update a named MCP gateway",
  body: toolGatewayCompanyBodySchema,
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/tool-gateway/gateways/{gatewayId}/tokens",
  tags: ["tool-gateway"],
  summary: "Create a named MCP gateway token",
  body: toolGatewayCompanyBodySchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    422: r.unprocessable,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/tool-gateway/gateway-tokens/{tokenId}/revoke",
  tags: ["tool-gateway"],
  summary: "Revoke a named MCP gateway token",
  body: toolGatewayCompanyQuerySchema.required({ companyId: true }),
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "get",
  path: "/api/tool-gateway/gateways/{gatewayId}/mcp",
  tags: ["tool-gateway"],
  summary: "Describe a named MCP gateway endpoint",
});

registerCurrentRoute({
  method: "post",
  path: "/api/tool-gateway/gateways/{gatewayId}/mcp",
  tags: ["tool-gateway"],
  summary: "Handle named MCP gateway protocol requests",
  body: mcpGatewayProtocolSchema,
  responses: {
    200: r.ok(),
    202: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
    429: r.ok(),
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/tool-gateway/sessions",
  tags: ["tool-gateway"],
  summary: "Create a tool gateway session",
  body: toolGatewaySessionSchema,
  responses: {
    201: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/tool-gateway/sessions/{sessionId}/revoke",
  tags: ["tool-gateway"],
  summary: "Revoke a tool gateway session",
  body: toolGatewayCompanyQuerySchema,
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
    404: r.notFound,
  },
});

registerCurrentRoute({
  method: "get",
  path: "/api/tool-gateway/tools",
  tags: ["tool-gateway"],
  summary: "List tools available to a gateway session",
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden },
});

registerCurrentRoute({
  method: "post",
  path: "/api/tool-gateway/tools/call",
  tags: ["tool-gateway"],
  summary: "Execute a tool through the gateway",
  body: toolGatewayCallSchema,
  responses: {
    200: r.ok(),
    400: r.badRequest,
    401: r.unauthorized,
    403: r.forbidden,
  },
});

registerCurrentRoute({
  method: "post",
  path: "/api/tool-gateway/action-requests/{id}/approve",
  tags: ["tool-gateway"],
  summary: "Approve a deferred tool gateway action request",
  query: toolGatewayCompanyQuerySchema,
  body: z.object({ companyId: z.string().optional() }),
});

registerCurrentRoute({
  method: "post",
  path: "/api/tool-gateway/action-requests/{id}/decline",
  tags: ["tool-gateway"],
  summary: "Decline a deferred tool gateway action request",
  query: toolGatewayCompanyQuerySchema,
  body: z.object({ companyId: z.string().optional() }),
});

registerCurrentRoute({
  method: "get",
  path: "/api/tool-gateway/runtime-slots",
  tags: ["tool-gateway"],
  summary: "List gateway runtime slots",
  query: toolGatewayCompanyQuerySchema,
});

registerCurrentRoute({
  method: "post",
  path: "/api/tool-gateway/runtime-slots/{slotId}/stop",
  tags: ["tool-gateway"],
  summary: "Stop a gateway runtime slot",
  query: toolGatewayCompanyQuerySchema,
  body: z.object({ companyId: z.string().optional() }),
});

registerCurrentRoute({
  method: "post",
  path: "/api/tool-gateway/runtime-slots/{slotId}/restart",
  tags: ["tool-gateway"],
  summary: "Restart a gateway runtime slot",
  query: toolGatewayCompanyQuerySchema,
  body: z.object({ companyId: z.string().optional() }),
});

registerCurrentRoute({
  method: "get",
  path: "/api/tool-gateway/audit",
  tags: ["tool-gateway"],
  summary: "List tool gateway audit events",
  query: z.object({
    companyId: z.string().optional(),
    limit: z.number().int().positive().optional(),
    app: z.string().optional(),
    agent: z.string().optional(),
    outcome: z.string().optional(),
    window: z.enum(["1h", "24h", "7d", "30d"]).optional(),
    search: z.string().optional(),
    cursor: z.string().optional(),
  }),
});

// Every experimental REST route remains discoverable while its runtime feature
// flag and actor checks stay authoritative. Shared validators prevent drift.
for (const [method, path, body] of experimentalApiPaths) {
  const query = experimentalApiQueries[`${method.toUpperCase()} ${path}`];
  const metadata = experimentalApiMetadata[`${method.toUpperCase()} ${path}`];
  registry.registerPath({
    method,
    path,
    tags: ["Experimental"],
    summary: `${method.toUpperCase()} ${path
      .replace(/\{[^}]+\}/g, "")
      .replace(/\/api\//, "")
      .replaceAll("/", " ")}`,
    description:
      "Experimental API; the corresponding instance feature must be enabled. Existing route authorization applies." +
      (path.startsWith("/api/cases/{caseId}")
        ? " Pipeline case resource. On overlapping /cases routes the server selects the handler by resource identity; use a pipeline case ID."
        : path.startsWith("/api/cases/{id}")
          ? " Cases resource (not a pipeline case). Overlapping /cases routes select their handler by resource identity."
          : ""),
    request: {
      params: z.object(
        Object.fromEntries(
          [...path.matchAll(/\{([^}]+)\}/g)].map((match) => [
            match[1],
            z.string(),
          ]),
        ),
      ),
      ...(query ? { query } : {}),
      ...(path === "/api/cases/{id}/attachments"
        ? {
            body: {
              required: true,
              content: {
                "multipart/form-data": {
                  schema: {
                    type: "object",
                    required: ["file"],
                    properties: { file: { type: "string", format: "binary" } },
                  },
                },
              },
            },
          }
        : body
          ? {
              body: {
                required: true,
                content: { "application/json": { schema: body } },
              },
            }
          : {}),
    },
    responses: {
      ...Object.fromEntries(
        (metadata?.successStatuses ?? [200]).map((status) => [
          status,
          responses.ok(),
        ]),
      ),
      400: responses.badRequest,
      403: responses.forbidden,
      404: responses.notFound,
    },
  });
}

const queryFlag = z.boolean();
const annotationListQuery = z.object({
  status: z.enum(["open", "resolved", "all"]).optional(),
  includeComments: queryFlag.optional(),
});
const catalogRefQuery = z.object({
  ref: z.string().optional(),
});
const feedbackTraceQuery = {
  targetType: z.enum(FEEDBACK_TARGET_TYPES).optional(),
  vote: z.enum(FEEDBACK_VOTE_VALUES).optional(),
  status: z.enum(FEEDBACK_TRACE_STATUSES).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  sharedOnly: queryFlag.optional(),
  includePayload: queryFlag.optional(),
};
const runLogQuery = z.object({
  offset: z.coerce.number().int().min(0).optional(),
  limitBytes: z.coerce.number().int().min(1).max(1024 * 1024).optional(),
});

for (const [method, path, query] of [
  ["get", "/api/companies/{companyId}/activity", z.object({
    agentId: z.string().optional(),
    entityType: z.string().optional(),
    entityId: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })],
  ["get", "/api/companies/{companyId}/audit/agent-actions", z.object({
    actorScope: z.enum(["agents", "all"]).optional(),
  })],
  ["get", "/api/companies/{companyId}/heartbeat-runs", z.object({
    agentId: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(1000).optional(),
    summary: queryFlag.optional(),
  })],
  ["get", "/api/companies/{companyId}/provider-traces", z.object({
    runIds: z.string().optional(),
  })],
  ["get", "/api/companies/{companyId}/live-runs", z.object({
    limit: z.coerce.number().int().min(1).max(50).optional(),
    minCount: z.coerce.number().int().min(0).max(50).optional(),
    distinctTasks: queryFlag.optional(),
  })],
  ["get", "/api/heartbeat-runs/{runId}/log", runLogQuery],
  ["get", "/api/workspace-operations/{operationId}/log", runLogQuery],
  ["get", "/api/cases/{id}/documents/{key}/annotations", annotationListQuery],
  ["get", "/api/issues/{id}/documents/{key}/annotations", annotationListQuery],
  ["get", "/api/routines/{id}/description/annotations", annotationListQuery],
  ["get", "/api/companies/{companyId}/feedback-traces", z.object({
    ...feedbackTraceQuery,
    issueId: z.string().optional(),
    projectId: z.string().optional(),
  })],
  ["get", "/api/issues/{id}/feedback-traces", z.object(feedbackTraceQuery)],
  ["get", "/api/feedback-traces/{traceId}", z.object({
    includePayload: queryFlag.optional(),
  })],
  ["get", "/api/skills/catalog", catalogSkillListQuerySchema],
  ["get", "/api/skills/catalog/{catalogId}", catalogRefQuery],
  ["get", "/api/teams/catalog", catalogTeamListQuerySchema],
  ["get", "/api/teams/catalog/{catalogId}", catalogRefQuery],
  ["post", "/api/companies/{companyId}/teams/catalog/{catalogId}/preview", catalogRefQuery],
  ["post", "/api/companies/{companyId}/teams/catalog/{catalogId}/install", catalogRefQuery],
  ["get", "/api/issues/{id}/cost-summary", z.object({ excludeRoot: queryFlag.optional() })],
  ["get", "/api/companies/{companyId}/environments", z.object({
    driver: z.enum(ENVIRONMENT_DRIVERS).optional(),
    status: z.enum(ENVIRONMENT_STATUSES).optional(),
  })],
  ["get", "/api/environments/{id}/leases", z.object({ status: z.enum(ENVIRONMENT_LEASE_STATUSES).optional() })],
  ["delete", "/api/environments/{id}", z.object({ destroyReusableSandboxLeases: queryFlag.optional() })],
  ["get", "/api/companies/{companyId}/execution-workspaces", z.object({
    projectId: z.string().optional(),
    projectWorkspaceId: z.string().optional(),
    issueId: z.string().optional(),
    status: z.string().optional(),
    reuseEligible: queryFlag.optional(),
    summary: queryFlag.optional(),
  })],
  ["get", "/api/issues/{id}/tree-holds", z.object({
    status: z.enum(["active", "released"]).optional(),
    mode: z.enum(["pause", "resume", "cancel", "restore"]).optional(),
    includeMembers: queryFlag.optional(),
  })],
  ["delete", "/api/issues/{id}/comments/{commentId}", z.object({
    mode: z.enum(["delete", "cancel"]).optional(),
  })],
  ["get", "/api/plugins", z.object({ status: z.enum(PLUGIN_STATUSES).optional() })],
  ["get", "/api/plugins/tools", z.object({ pluginId: z.string().optional() })],
  ["delete", "/api/plugins/{pluginId}", z.object({ purge: queryFlag.optional() })],
  ["get", "/api/plugins/{pluginId}/logs", z.object({
    level: z.string().optional(),
    since: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })],
  ["get", "/api/plugins/{pluginId}/jobs", z.object({ status: z.enum(PLUGIN_JOB_STATUSES).optional() })],
  ["get", "/api/plugins/{pluginId}/jobs/{jobId}/runs", z.object({
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })],
  ["get", "/api/companies/{companyId}/routines", z.object({ projectId: z.string().optional() })],
  ["get", "/api/routines/{id}/runs", z.object({
    limit: z.coerce.number().int().min(1).optional(),
  })],
  ["get", "/api/companies/{companyId}/tools/apps/{galleryKey}/preflight", z.object({ methodKey: z.string().optional() })],
  ["get", "/api/companies/{companyId}/tools/action-requests", z.object({
    status: z.enum(TOOL_ACTION_REQUEST_STATUSES).optional(),
  })],
  ["get", "/api/tool-connections/{connectionId}/usage", z.object({ range: z.enum(["7d", "30d"]).optional() })],
  ["get", "/api/tool-connections/{connectionId}/activity", z.object({
    limit: z.coerce.number().int().min(1).optional(),
  })],
  ["get", "/api/tool-gateway/audit", z.object({ gateway: z.string().optional() })],
] as const) {
  registry.declareQuery(method, path, query);
}

// ─── Spec builder ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildOpenApiDocument(): any {
  return applyDocumentFixups({
    openapi: "3.0.0",
    info: {
      title: "Paperclip API",
      version: "1.0.0",
      description: "REST API for the Paperclip AI agent management platform",
    },
    servers: [{ url: "/" }],
    components: registry.buildComponents(),
    paths: registry.buildPaths(),
  });
}

export const buildOpenApiSpec = buildOpenApiDocument;

export function openApiRoutes() {
  const router = Router();
  router.get("/openapi.json", (_req, res) => {
    res.json(buildOpenApiDocument());
  });
  return router;
}

registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/ai-connections/local",
  tags: ["ai-connections"],
  summary: "Verify and save the local operator's CLI subscription account",
  body: localAiConnectionSchema,
  responses: { 201: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 422: r.unprocessable },
});
registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/ai-connections/local/attempts",
  tags: ["ai-connections"], summary: "Prepare an isolated local subscription sign-in",
  body: localAiLoginStartSchema,
  responses: { 201: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 422: r.unprocessable },
});
registerCurrentRoute({
  method: "delete",
  path: "/api/companies/{companyId}/ai-connections/local/attempts/{sessionId}",
  tags: ["ai-connections"], summary: "Cancel an owned local subscription sign-in",
  responses: { 200: r.ok(), 401: r.unauthorized, 403: r.forbidden, 404: r.notFound },
});
registerCurrentRoute({
  method: "post",
  path: "/api/companies/{companyId}/ai-connections/local/check",
  tags: ["ai-connections"], summary: "Check the local operator's subscription sign-in without saving a connection",
  body: localAiConnectionSchema,
  responses: { 200: r.ok(), 400: r.badRequest, 401: r.unauthorized, 403: r.forbidden, 404: r.notFound, 422: r.unprocessable },
});

for (const [method, path, summary] of [
  ["get", "/api/companies/{companyId}/skill-sources", "List GitHub skill sources"],
  ["get", "/api/companies/{companyId}/skill-sources/repositories", "Browse authorized GitHub repositories for skills"],
  ["get", "/api/companies/{companyId}/skill-sources/{sourceId}", "Get a skill source and entries"],
  ["post", "/api/companies/{companyId}/skill-sources/discover", "Discover and validate repository skills"],
  ["post", "/api/companies/{companyId}/skill-sources/preview", "Preview an audited skill package file at an immutable commit"],
  ["post", "/api/companies/{companyId}/skill-sources", "Import a GitHub skill source"],
  ["patch", "/api/companies/{companyId}/skill-sources/{sourceId}", "Save skill source selection and connection"],
  ["post", "/api/companies/{companyId}/skill-sources/{sourceId}/refresh", "Refresh installed source skills"],
  ["delete", "/api/companies/{companyId}/skill-sources/{sourceId}", "Disconnect a skill source and retain installed skills"],
] as const) registerCurrentRoute({
  method, path, tags: ["skills"], summary,
  ...(method === "patch" ? { body: skillSourceSelectionSchema }
    : method === "post" && path.endsWith("/discover") ? { body: skillSourceDiscoverySchema }
    : method === "post" && path.endsWith("/preview") ? { body: skillSourcePreviewSchema }
    : method === "post" && path.endsWith("/skill-sources") ? { body: skillSourceCreateSchema } : {}),
  responses: {
    [method === "post" && path.endsWith("/skill-sources") ? 201 : 200]: path.endsWith("/discover") ? {
      description: "JSON discovery by default. Accept: application/x-ndjson streams progress (phase, measured Git download percentages, and package/file counts), candidate metadata, then complete with discovery. An error event terminates a failed scan; partial candidates cannot be imported. Disconnecting cancels further provider reads.",
      content: { "application/json": { schema: z.unknown() }, "application/x-ndjson": { schema: z.string() } },
    } : r.ok(),
    400: r.badRequest, 401: r.unauthorized, 403: r.forbidden,
    404: r.notFound, 409: r.conflict, 422: r.unprocessable,
  },
});
