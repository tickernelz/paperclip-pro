#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GATEWAY_VERSION = "0.24.0";
const DOC_PATH = resolve(repoRoot, "scripts/openwa/openapi-" + GATEWAY_VERSION + ".json");
const OUT_PATH = resolve(repoRoot, "packages/shared/src/openwa-operations.ts");
const EXPECTED_OPERATION_COUNT = 202;
const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];
const MAX_DESCRIPTION = 160;

const TAG_RULES = {
  audit: { default: "gateway_admin" },
  auth: { default: "gateway_admin", read: ["AuthValidateController_validate"] },
  automation: { default: "gateway_admin" },
  calls: { default: "write" },
  catalog: { default: "read", write: ["CatalogController_sendProduct"] },
  channels: {
    default: "wa_admin",
    read: ["ChannelController_findAll", "ChannelController_findOne", "ChannelController_getMessages"],
  },
  contacts: {
    default: "read",
    wa_admin: [
      "ContactController_blockContact",
      "ContactController_deleteContact",
      "ContactController_unblockContact",
      "ContactController_upsertContact",
    ],
  },
  groups: {
    default: "wa_admin",
    read: [
      "GroupController_findOne",
      "GroupController_getInviteCode",
      "GroupController_getMembershipRequests",
      "GroupController_getPicture",
      "GroupController_getSettings",
      "GroupController_joinInfo",
    ],
  },
  health: { default: "read" },
  infrastructure: { default: "gateway_admin" },
  integration: { default: "gateway_admin" },
  labels: {
    default: "read",
    wa_admin: [
      "LabelController_addLabelToChat",
      "LabelController_deleteLabel",
      "LabelController_removeLabelFromChat",
      "LabelController_upsertLabel",
    ],
  },
  media: { default: "read", read: ["MediaController_convertVideo", "MediaController_convertVoice"] },
  messages: {
    default: "write",
    read: [
      "MessageController_getBatchStatus",
      "MessageController_getChatHistory",
      "MessageController_getChatMedia",
      "MessageController_getMessages",
      "MessageController_getReactions",
    ],
    wa_admin: [
      "MessageController_deleteMessage",
      "MessageController_edit",
      "MessageController_pinMessage",
      "MessageController_starMessage",
      "MessageController_unpinMessage",
    ],
  },
  metrics: { default: "gateway_admin" },
  plugins: { default: "gateway_admin" },
  profile: { default: "wa_admin" },
  search: { default: "read" },
  sessions: {
    default: "read",
    gateway_admin: [
      "SessionController_create",
      "SessionController_delete",
      "SessionController_forceKill",
      "SessionController_getQRCode",
      "SessionController_getStats",
      "SessionController_logout",
      "SessionController_requestPairingCode",
      "SessionController_start",
      "SessionController_stop",
      "SessionController_updateConfig",
      "SessionController_updateProxy",
    ],
    write: [
      "SessionController_markChatRead",
      "SessionController_markChatUnread",
      "SessionController_sendChatState",
      "SessionController_setOnlinePresence",
      "SessionController_subscribeToPresence",
    ],
    wa_admin: [
      "SessionController_archiveChat",
      "SessionController_clearChatMessages",
      "SessionController_deleteChat",
      "SessionController_muteChat",
      "SessionController_pinChat",
    ],
  },
  settings: { default: "gateway_admin" },
  statistics: { default: "gateway_admin", read: ["StatsController_getSessionStats"] },
  status: {
    default: "wa_admin",
    read: ["StatusController_getContactStatus", "StatusController_getStatusMedia", "StatusController_getStatuses"],
  },
  templates: { default: "gateway_admin", read: ["TemplateController_findBySession", "TemplateController_findOne"] },
  webhooks: { default: "gateway_admin" },
};

const OPERATOR_ROLE = [
  "AutomationRuleController_create", "AutomationRuleController_findAll", "AutomationRuleController_findOne",
  "AutomationRuleController_remove", "AutomationRuleController_update", "CallController_createLink",
  "CallController_reject", "CatalogController_sendProduct", "ChannelController_create",
  "ChannelController_demoteAdmin", "ChannelController_mute", "ChannelController_remove",
  "ChannelController_subscribe", "ChannelController_transferOwnership", "ChannelController_unsubscribe",
  "ContactController_blockContact", "ContactController_deleteContact", "ContactController_unblockContact",
  "ContactController_upsertContact", "GroupController_addParticipants", "GroupController_approveMembershipRequests",
  "GroupController_create", "GroupController_deletePicture", "GroupController_demoteParticipants",
  "GroupController_getInviteCode", "GroupController_join", "GroupController_leave",
  "GroupController_promoteParticipants", "GroupController_rejectMembershipRequests",
  "GroupController_removeParticipants", "GroupController_revokeInviteCode", "GroupController_setDescription",
  "GroupController_setPicture", "GroupController_setSubject", "GroupController_updateSettings",
  "LabelController_addLabelToChat", "LabelController_deleteLabel", "LabelController_removeLabelFromChat",
  "LabelController_upsertLabel", "MediaController_convertVideo", "MediaController_convertVoice",
  "MessageController_cancelBatch", "MessageController_clickButton", "MessageController_deleteMessage",
  "MessageController_edit", "MessageController_forward", "MessageController_pinMessage", "MessageController_react",
  "MessageController_reply", "MessageController_sendAudio", "MessageController_sendBulk",
  "MessageController_sendContact", "MessageController_sendDocument", "MessageController_sendImage",
  "MessageController_sendLocation", "MessageController_sendPoll", "MessageController_sendSticker",
  "MessageController_sendTemplate", "MessageController_sendText", "MessageController_sendVideo",
  "MessageController_starMessage", "MessageController_unpinMessage", "MessageController_votePoll",
  "ProfileController_deletePicture", "ProfileController_setName", "ProfileController_setPicture",
  "ProfileController_setStatus", "SearchController_search", "SessionController_archiveChat",
  "SessionController_clearChatMessages", "SessionController_create", "SessionController_delete",
  "SessionController_deleteChat", "SessionController_forceKill", "SessionController_getQRCode",
  "SessionController_logout", "SessionController_markChatRead", "SessionController_markChatUnread",
  "SessionController_muteChat", "SessionController_pinChat", "SessionController_requestPairingCode",
  "SessionController_sendChatState", "SessionController_setOnlinePresence", "SessionController_start",
  "SessionController_stop", "SessionController_subscribeToPresence", "SessionController_updateConfig",
  "SessionController_updateProxy", "StatusController_deleteStatus", "StatusController_sendImageStatus",
  "StatusController_sendTextStatus", "StatusController_sendVideoStatus", "StatusController_sendVoiceStatus",
  "TemplateController_create", "TemplateController_delete", "TemplateController_findBySession",
  "TemplateController_findOne", "TemplateController_update", "WebhookController_create",
  "WebhookController_delete", "WebhookController_findBySession", "WebhookController_findOne",
  "WebhookController_test", "WebhookController_update", "WebhooksListController_findAll",
];

const ADMIN_ROLE = [
  "AuditController_findAll", "AuthController_create", "AuthController_delete", "AuthController_findAll",
  "AuthController_findOne", "AuthController_revoke", "AuthController_update", "InfraConfigController_getConfig",
  "InfraConfigController_requestRestart", "InfraConfigController_saveConfig", "InfraDataController_exportData",
  "InfraDataController_importData", "InfraStatusController_getCurrentEngine", "InfraStatusController_getEngines",
  "InfraStatusController_getStatus", "InfraStatusController_getUpdateCheck", "InfraStorageController_exportStorage",
  "InfraStorageController_getStorageFileCount", "InfraStorageController_importStorage",
  "IntegrationInstanceController_create", "IntegrationInstanceController_getOne", "IntegrationInstanceController_list",
  "IntegrationInstanceController_patch", "IntegrationInstanceController_regenerate",
  "IntegrationInstanceController_remove", "PluginsController_catalog", "PluginsController_disable",
  "PluginsController_enable", "PluginsController_findAll", "PluginsController_findOne",
  "PluginsController_getConfigUi", "PluginsController_healthCheck", "PluginsController_install",
  "PluginsController_installFromUrl", "PluginsController_uninstall", "PluginsController_update",
  "PluginsController_updateConfig", "PluginsController_updateSessionConfig", "PluginsController_updateSessions",
  "RedriveController_redriveInstance", "SettingsController_get", "StatsController_getMessageStats",
  "StatsController_getOverview", "WebhooksListController_deliveryFailures",
];

const UNSCOPED_KEY = [
  "AuthController_create", "AuthController_delete", "AuthController_findAll", "AuthController_findOne",
  "AuthController_revoke", "AuthController_update", "InfraConfigController_getConfig",
  "InfraConfigController_requestRestart", "InfraConfigController_saveConfig", "InfraDataController_exportData",
  "InfraDataController_importData", "InfraStatusController_getCurrentEngine", "InfraStatusController_getEngines",
  "InfraStatusController_getStatus", "InfraStatusController_getUpdateCheck", "InfraStorageController_exportStorage",
  "InfraStorageController_getStorageFileCount", "InfraStorageController_importStorage", "PluginsController_catalog",
  "PluginsController_disable", "PluginsController_enable", "PluginsController_findAll", "PluginsController_findOne",
  "PluginsController_getConfigUi", "PluginsController_healthCheck", "PluginsController_install",
  "PluginsController_installFromUrl", "PluginsController_uninstall", "PluginsController_update",
  "PluginsController_updateConfig", "PluginsController_updateSessions", "SessionController_create",
  "SessionController_updateProxy", "SettingsController_get", "StatsController_getMessageStats",
  "StatsController_getOverview",
];

const NO_KEY = [
  "HealthController_check", "HealthController_liveness", "HealthController_readiness",
  "InfraStatusController_healthCheck", "IngressController_receive_delete", "IngressController_receive_get",
  "IngressController_receive_head", "IngressController_receive_options", "IngressController_receive_patch",
  "IngressController_receive_post", "IngressController_receive_put",
];

const METRICS_TOKEN = ["MetricsController_scrape"];

const UNAVAILABLE_ON_ENGINE = {
  "whatsapp-web.js": [
    "CallController_reject", "CatalogController_getCatalog", "CatalogController_getProduct",
    "CatalogController_getProducts", "CatalogController_sendProduct", "ChannelController_demoteAdmin",
    "ChannelController_subscribe", "ChannelController_transferOwnership", "GroupController_create",
    "LabelController_deleteLabel", "LabelController_upsertLabel", "MessageController_clickButton",
    "SessionController_subscribeToPresence",
  ],
  baileys: [
    "ChannelController_findAll", "ChannelController_getMessages", "LabelController_findAll",
    "LabelController_findOne", "LabelController_getChatLabels", "LabelController_getChatsByLabel",
    "MessageController_getChatHistory", "MessageController_getReactions", "MessageController_votePoll",
  ],
};

const SENDS_MESSAGE = [
  "CatalogController_sendProduct", "MessageController_forward", "MessageController_reply",
  "MessageController_sendAudio", "MessageController_sendBulk", "MessageController_sendContact",
  "MessageController_sendDocument", "MessageController_sendImage", "MessageController_sendLocation",
  "MessageController_sendPoll", "MessageController_sendSticker", "MessageController_sendTemplate",
  "MessageController_sendText", "MessageController_sendVideo",
];

const TARGET_CHAT_ARG = {
  CatalogController_sendProduct: "chatId",
  MessageController_clickButton: "chatId",
  MessageController_forward: "toChatId",
  MessageController_react: "chatId",
  MessageController_reply: "chatId",
  MessageController_sendAudio: "chatId",
  MessageController_sendBulk: "messages[].chatId",
  MessageController_sendContact: "chatId",
  MessageController_sendDocument: "chatId",
  MessageController_sendImage: "chatId",
  MessageController_sendLocation: "chatId",
  MessageController_sendPoll: "chatId",
  MessageController_sendSticker: "chatId",
  MessageController_sendTemplate: "chatId",
  MessageController_sendText: "chatId",
  MessageController_sendVideo: "chatId",
  MessageController_votePoll: "chatId",
  SessionController_markChatRead: "chatId",
  SessionController_markChatUnread: "chatId",
  SessionController_sendChatState: "chatId",
  SessionController_subscribeToPresence: "chatId",
};

const KEPT_SCHEMA_KEYS = new Set([
  "type", "properties", "required", "items", "enum", "description", "minimum", "maximum", "minLength",
  "maxLength", "minItems", "maxItems", "pattern", "additionalProperties", "oneOf", "anyOf", "allOf", "default",
  "format", "nullable", "$ref",
]);
const DROPPED_SCHEMA_KEYS = new Set(["example", "examples", "writeOnly", "readOnly", "deprecated", "title"]);

function fail(message) {
  throw new Error("generate-openwa-operations: " + message);
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep(value[key]);
    return out;
  }
  return value;
}

function shortDescription(text) {
  const flat = String(text).replace(/\s+/g, " ").trim();
  const sentence = flat.match(/^(.+?(?<!\b(?:e\.g|i\.e|etc|vs))[.!?])(?=\s+[A-Z`*]|$)/);
  const first = sentence ? sentence[1] : flat;
  if (first.length <= MAX_DESCRIPTION) return first;
  const cut = first.slice(0, MAX_DESCRIPTION - 1);
  const space = cut.lastIndexOf(" ");
  return (space > MAX_DESCRIPTION / 2 ? cut.slice(0, space) : cut).trimEnd() + "…";
}

function resolveRef(doc, ref) {
  const prefix = "#/components/schemas/";
  if (!ref.startsWith(prefix)) fail("unsupported $ref " + ref);
  const schema = doc.components.schemas[ref.slice(prefix.length)];
  if (!schema) fail("missing schema " + ref);
  return schema;
}

function convertSchema(doc, input, context, stack = []) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("bad schema at " + context);
  for (const key of Object.keys(input)) {
    if (!KEPT_SCHEMA_KEYS.has(key) && !DROPPED_SCHEMA_KEYS.has(key)) fail("unreviewed schema keyword " + key + " at " + context);
  }
  if (input.$ref) {
    if (stack.includes(input.$ref)) fail("cyclic $ref " + input.$ref + " at " + context);
    const resolved = convertSchema(doc, resolveRef(doc, input.$ref), context, [...stack, input.$ref]);
    if (input.description) resolved.description = shortDescription(input.description);
    return resolved;
  }
  let schema = {};
  if (input.allOf && input.allOf.length === 1 && !input.type && !input.properties) {
    schema = convertSchema(doc, input.allOf[0], context, stack);
  } else if (input.allOf) {
    schema.allOf = input.allOf.map((entry, i) => convertSchema(doc, entry, context + ".allOf[" + i + "]", stack));
  }
  if (input.type !== undefined) schema.type = input.type;
  if (input.description) schema.description = shortDescription(input.description);
  for (const key of ["enum", "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems", "pattern", "default"]) {
    if (input[key] !== undefined) schema[key] = input[key];
  }
  if (input.format !== undefined) {
    if (input.format === "binary") schema.description = (schema.description ? schema.description + " " : "") + "(base64)";
    else if (input.format === "date-time") schema.format = "date-time";
    else fail("unreviewed format " + input.format + " at " + context);
  }
  if (input.properties) {
    schema.properties = {};
    for (const [name, prop] of Object.entries(input.properties)) {
      schema.properties[name] = convertSchema(doc, prop, context + "." + name, stack);
    }
  }
  if (input.required && input.required.length > 0) schema.required = [...input.required];
  if (input.items) schema.items = convertSchema(doc, input.items, context + "[]", stack);
  if (input.additionalProperties !== undefined) {
    schema.additionalProperties = typeof input.additionalProperties === "object"
      ? convertSchema(doc, input.additionalProperties, context + "{}", stack)
      : input.additionalProperties;
  }
  for (const key of ["oneOf", "anyOf"]) {
    if (input[key]) schema[key] = input[key].map((entry, i) => convertSchema(doc, entry, context + "." + key + "[" + i + "]", stack));
  }
  if (input.nullable === true) {
    if (typeof schema.type === "string") schema.type = [schema.type, "null"];
    else schema = { anyOf: [schema, { type: "null" }] };
  }
  return schema;
}

function categoryFor(op) {
  const rule = TAG_RULES[op.tag];
  if (!rule) fail("tag " + op.tag + " has no classification rule (" + op.id + ")");
  for (const category of ["read", "write", "wa_admin", "gateway_admin"]) {
    if (rule[category] && rule[category].includes(op.id)) return { category, explicit: true };
  }
  return { category: rule.default, explicit: false };
}

function checkTableIds(ids, known, label) {
  for (const id of ids) if (!known.has(id)) fail(label + " names unknown operation " + id);
}

function readDocument() {
  return JSON.parse(readFileSync(DOC_PATH, "utf8"));
}

function buildOperations(doc) {
  if (doc.info?.version !== GATEWAY_VERSION) fail("document version " + doc.info?.version + " != " + GATEWAY_VERSION);
  const raw = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    if (item.parameters) fail("path-level parameters are not supported (" + path + ")");
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op) continue;
      if (!op.operationId) fail("missing operationId on " + method + " " + path);
      if (!op.tags || op.tags.length !== 1) fail("operation " + op.operationId + " must carry exactly one tag");
      raw.push({ id: op.operationId, method: method.toUpperCase(), path, tag: op.tags[0], op });
    }
  }
  const known = new Set(raw.map((entry) => entry.id));
  if (known.size !== raw.length) fail("duplicate operationId");
  if (raw.length !== EXPECTED_OPERATION_COUNT) fail("expected " + EXPECTED_OPERATION_COUNT + " operations, found " + raw.length);
  for (const [tag, rule] of Object.entries(TAG_RULES)) {
    for (const category of ["read", "write", "wa_admin", "gateway_admin"]) {
      for (const id of rule[category] ?? []) {
        const entry = raw.find((candidate) => candidate.id === id);
        if (!entry) fail("TAG_RULES." + tag + " names unknown operation " + id);
        if (entry.tag !== tag) fail("TAG_RULES." + tag + " names " + id + " from tag " + entry.tag);
      }
    }
  }
  checkTableIds(OPERATOR_ROLE, known, "OPERATOR_ROLE");
  checkTableIds(ADMIN_ROLE, known, "ADMIN_ROLE");
  checkTableIds(UNSCOPED_KEY, known, "UNSCOPED_KEY");
  checkTableIds(NO_KEY, known, "NO_KEY");
  checkTableIds(METRICS_TOKEN, known, "METRICS_TOKEN");
  checkTableIds(SENDS_MESSAGE, known, "SENDS_MESSAGE");
  checkTableIds(Object.keys(TARGET_CHAT_ARG), known, "TARGET_CHAT_ARG");
  for (const ids of Object.values(UNAVAILABLE_ON_ENGINE)) checkTableIds(ids, known, "UNAVAILABLE_ON_ENGINE");

  const operations = raw.map(({ id, method, path, tag, op }) => {
    const { category, explicit } = categoryFor({ id, tag });
    if (category === "read" && method !== "GET" && !explicit) fail(id + " is a " + method + " defaulted to read; classify it explicitly");
    if ((category === "write" || category === "wa_admin") && method === "GET" && !explicit) {
      fail(id + " is a GET defaulted to " + category + "; classify it explicitly");
    }
    const properties = {};
    const required = [];
    const pathParams = [];
    const queryParams = [];
    let sessionParam = null;
    for (const param of op.parameters ?? []) {
      if (param.in === "header") continue;
      if (param.in !== "path" && param.in !== "query") fail("unsupported parameter location " + param.in + " on " + id);
      if (param.name === "sessionId") {
        sessionParam = param.in;
        continue;
      }
      if (properties[param.name]) fail("duplicate argument " + param.name + " on " + id);
      const schema = convertSchema(doc, param.schema ?? { type: "string" }, id + "." + param.name);
      if (param.description) schema.description = shortDescription(param.description);
      properties[param.name] = schema;
      if (param.required || param.in === "path") required.push(param.name);
      (param.in === "path" ? pathParams : queryParams).push(param.name);
    }
    for (const name of path.matchAll(/\{(\w+)\}/g)) {
      if (name[1] !== "sessionId" && !pathParams.includes(name[1])) fail("path parameter " + name[1] + " undocumented on " + id);
    }
    const bodyParams = [];
    const fileParams = [];
    let bodyMode = "none";
    if (op.requestBody) {
      const types = Object.keys(op.requestBody.content ?? {});
      if (types.length !== 1) fail("expected one request content type on " + id);
      bodyMode = types[0] === "application/json" ? "json" : types[0] === "multipart/form-data" ? "multipart" : fail("unsupported request type " + types[0] + " on " + id);
      const body = convertSchema(doc, op.requestBody.content[types[0]].schema, id + ".body");
      if (body.type !== "object" || !body.properties) fail("request body of " + id + " is not an object schema");
      for (const [name, schema] of Object.entries(body.properties)) {
        if (properties[name] || name === "sessionId") fail("body argument " + name + " collides on " + id);
        properties[name] = schema;
        bodyParams.push(name);
      }
      if (op.requestBody.required === true) for (const name of body.required ?? []) required.push(name);
      const rawBody = op.requestBody.content[types[0]].schema;
      const rawProperties = (rawBody.$ref ? resolveRef(doc, rawBody.$ref) : rawBody).properties ?? {};
      for (const [name, prop] of Object.entries(rawProperties)) if (prop.format === "binary") fileParams.push(name);
      if (bodyMode === "multipart" && fileParams.length === 0) fail("multipart body without a binary field on " + id);
      if (bodyMode !== "multipart" && fileParams.length > 0) fail("binary field outside a multipart body on " + id);
    }
    const args = { type: "object", properties, additionalProperties: false };
    if (required.length > 0) args.required = required;
    const targetChatArg = TARGET_CHAT_ARG[id] ?? null;
    if (SENDS_MESSAGE.includes(id) && !targetChatArg) fail(id + " sends a message but has no targetChatArg");
    if (targetChatArg) {
      const [head, tail] = targetChatArg.split("[].");
      if (!properties[head]) fail("targetChatArg " + targetChatArg + " is not an argument of " + id);
      if (tail && !properties[head].items?.properties?.[tail]) fail("targetChatArg " + targetChatArg + " does not resolve on " + id);
    }
    const auth = METRICS_TOKEN.includes(id) ? "metrics_token" : NO_KEY.includes(id) ? "none" : "api_key";
    const requiredRole = ADMIN_ROLE.includes(id) ? "admin" : OPERATOR_ROLE.includes(id) ? "operator" : "viewer";
    const requiresUnscopedKey = auth === "api_key" && UNSCOPED_KEY.includes(id);
    if (requiresUnscopedKey && category !== "gateway_admin") fail(id + " needs an unscoped key but is not gateway_admin");
    const engines = ["whatsapp-web.js", "baileys"].filter((engine) => !UNAVAILABLE_ON_ENGINE[engine].includes(id));
    const responseTypes = Object.entries(op.responses ?? {})
      .filter(([status]) => status.startsWith("2"))
      .flatMap(([, response]) => Object.keys(response.content ?? {}));
    const response = responseTypes.length === 0 ? "none" : responseTypes.every((type) => type === "application/json") ? "json" : responseTypes.some((type) => type.startsWith("text/")) ? "text" : "binary";
    return {
      id,
      method,
      path,
      tag,
      summary: op.summary ? shortDescription(op.summary) : method + " " + path,
      category,
      requiredRole,
      requiresUnscopedKey,
      auth,
      sessionScoped: sessionParam === "path",
      sessionParam,
      targetChatArg,
      sendsMessage: SENDS_MESSAGE.includes(id),
      engines,
      pathParams,
      queryParams,
      bodyParams,
      fileParams,
      bodyMode,
      response,
      args,
    };
  });
  operations.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return operations;
}

function render(operations) {
  const lines = [
    "// GENERATED by scripts/generate-openwa-operations.mjs from scripts/openwa/openapi-" + GATEWAY_VERSION + ".json; DO NOT EDIT.",
    "",
    "export const OPENWA_GATEWAY_VERSION = " + JSON.stringify(GATEWAY_VERSION) + ";",
    "",
    'export type OpenwaOperationCategory = "read" | "write" | "wa_admin" | "gateway_admin";',
    'export type OpenwaEngine = "whatsapp-web.js" | "baileys";',
    'export type OpenwaRole = "viewer" | "operator" | "admin";',
    'export type OpenwaHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";',
    "",
    "export interface OpenwaJsonSchema {",
    "  type?: string | string[];",
    "  description?: string;",
    "  properties?: Record<string, OpenwaJsonSchema>;",
    "  required?: string[];",
    "  items?: OpenwaJsonSchema;",
    "  enum?: unknown[];",
    "  minimum?: number;",
    "  maximum?: number;",
    "  minLength?: number;",
    "  maxLength?: number;",
    "  minItems?: number;",
    "  maxItems?: number;",
    "  pattern?: string;",
    "  format?: string;",
    "  default?: unknown;",
    "  additionalProperties?: boolean | OpenwaJsonSchema;",
    "  oneOf?: OpenwaJsonSchema[];",
    "  anyOf?: OpenwaJsonSchema[];",
    "  allOf?: OpenwaJsonSchema[];",
    "}",
    "",
    "export interface OpenwaOperation {",
    "  id: string;",
    "  method: OpenwaHttpMethod;",
    "  path: string;",
    "  tag: string;",
    "  summary: string;",
    "  category: OpenwaOperationCategory;",
    "  requiredRole: OpenwaRole;",
    "  requiresUnscopedKey: boolean;",
    '  auth: "api_key" | "none" | "metrics_token";',
    "  sessionScoped: boolean;",
    '  sessionParam: "path" | "query" | null;',
    "  targetChatArg: string | null;",
    "  sendsMessage: boolean;",
    "  engines: readonly OpenwaEngine[];",
    "  pathParams: readonly string[];",
    "  queryParams: readonly string[];",
    "  bodyParams: readonly string[];",
    "  fileParams: readonly string[];",
    '  bodyMode: "none" | "json" | "multipart";',
    '  response: "none" | "json" | "text" | "binary";',
    "  args: OpenwaJsonSchema;",
    "}",
    "",
    "export const OPENWA_OPERATIONS: readonly OpenwaOperation[] = " + JSON.stringify(operations, null, 2) + ";",
    "",
  ];
  return lines.join("\n");
}

function main() {
  const importIndex = process.argv.indexOf("--import");
  if (importIndex !== -1) {
    const source = process.argv[importIndex + 1];
    if (!source) fail("--import needs a path to a raw OpenAPI JSON document");
    const normalized = sortKeysDeep(JSON.parse(readFileSync(source, "utf8")));
    writeFileSync(DOC_PATH, JSON.stringify(normalized, null, 2) + "\n");
  }
  const operations = buildOperations(readDocument());
  writeFileSync(OUT_PATH, render(operations));
  process.stdout.write("openwa operations: " + operations.length + " -> " + OUT_PATH + "\n");
}

main();
