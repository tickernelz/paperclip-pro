import { z } from "zod";
import {
  LOCAL_BROWSER_ACT_INPUT_MODES,
  LOCAL_BROWSER_ACTIONS,
  LOCAL_BROWSER_API_PATH_PATTERN,
  LOCAL_BROWSER_CAPABILITIES,
  LOCAL_BROWSER_CLIENTS,
  LOCAL_BROWSER_CONTENT_SCRIPT_STATES,
  LOCAL_BROWSER_COOKIE_SAME_SITE,
  LOCAL_BROWSER_CURSOR_PATTERN,
  LOCAL_BROWSER_ERROR_CODES,
  LOCAL_BROWSER_GUARD_DEFAULTS,
  LOCAL_BROWSER_INTERNAL_TOOL_NAMES,
  LOCAL_BROWSER_KEY_ACTIONS,
  LOCAL_BROWSER_LIMIT_KEYS,
  LOCAL_BROWSER_LIMITS,
  LOCAL_BROWSER_MOUSE_ACTIONS,
  LOCAL_BROWSER_NAVIGATION_TYPES,
  LOCAL_BROWSER_NETWORK_BUFFER_RANGE,
  LOCAL_BROWSER_ORIGIN_EXEMPT_TOOL_NAMES,
  LOCAL_BROWSER_PERMISSION_IDS,
  LOCAL_BROWSER_PERMISSIONS,
  LOCAL_BROWSER_SITE_ACCESS,
  LOCAL_BROWSER_TIERS,
  LOCAL_BROWSER_TOOL_CAPABILITIES,
  LOCAL_BROWSER_TOOL_TIERS,
  LOCAL_BROWSER_UI_OPS,
  LOCAL_BROWSER_VIEWER_STATES,
  type LocalBrowserLimitKey,
  type LocalBrowserPermissionDefinition,
  type LocalBrowserToolName,
} from "./local-browser-contract.js";

export * from "./local-browser-contract.js";

export const LOCAL_BROWSER_CONNECTOR_KEY = "local-browser";
export const LOCAL_BROWSER_SKILL_NAME = "local-browser";
export const LOCAL_BROWSER_PAIRING_TTL_MS = 10 * 60 * 1000;
/** Viewer frame and input coordinates are CSS pixels of the page viewport, never device pixels. */
export const LOCAL_BROWSER_VIEWER_COORDINATE_SPACE = "css-pixels";
export const LOCAL_BROWSER_COOKIE_CAPABILITY = "cookies.v2";
export const LOCAL_BROWSER_UPDATE_HINT = "Update the Paperclip Local Browser extension";

export type LocalBrowserTier = (typeof LOCAL_BROWSER_TIERS)[number];
export const localBrowserTierSchema = z.enum(LOCAL_BROWSER_TIERS);

export type LocalBrowserClient = (typeof LOCAL_BROWSER_CLIENTS)[number];
export const localBrowserClientSchema = z.enum(LOCAL_BROWSER_CLIENTS);

export type LocalBrowserErrorCode = (typeof LOCAL_BROWSER_ERROR_CODES)[number];
export type LocalBrowserCapability = (typeof LOCAL_BROWSER_CAPABILITIES)[number];
export type LocalBrowserAction = (typeof LOCAL_BROWSER_ACTIONS)[number];

const permissionIdSchema = z.string().min(1).max(200);

export const localBrowserToolErrorSchema = z
  .object({
    code: z.enum(LOCAL_BROWSER_ERROR_CODES),
    message: z.string().min(1),
    hint: z.string().min(1).optional(),
    retryable: z.boolean().optional(),
    permissions: z.array(permissionIdSchema).max(64).optional(),
  })
  .strict();
export type LocalBrowserToolError = z.infer<typeof localBrowserToolErrorSchema>;

export const localBrowserCursorSchema = z
  .string()
  .regex(LOCAL_BROWSER_CURSOR_PATTERN, "Cursors are the decimal node offset returned by the previous snapshot");

export const localBrowserRefSchema = z
  .string()
  .regex(/^e\d+$/, "Element refs look like e12; take a fresh snapshot when a ref is rejected");

export const localBrowserAccessSchema = z.object({
  siteAccess: z.enum(LOCAL_BROWSER_SITE_ACCESS),
  granted: z.array(permissionIdSchema).max(200),
  missing: z.array(permissionIdSchema).max(200),
  pending: z
    .array(
      z.object({
        permission: permissionIdSchema,
        reason: z.string().max(300),
        tool: z.string().min(1).max(80).optional(),
        at: z.number(),
      }),
    )
    .max(50),
});
export type LocalBrowserAccess = z.infer<typeof localBrowserAccessSchema>;

export const localBrowserGuardsSchema = z.object({
  protectPaperclipTab: z.boolean().default(LOCAL_BROWSER_GUARD_DEFAULTS.protectPaperclipTab),
  protectFocusedTab: z.boolean().default(LOCAL_BROWSER_GUARD_DEFAULTS.protectFocusedTab),
  networkBufferSize: z
    .number()
    .int()
    .min(LOCAL_BROWSER_NETWORK_BUFFER_RANGE.min)
    .max(LOCAL_BROWSER_NETWORK_BUFFER_RANGE.max)
    .default(LOCAL_BROWSER_GUARD_DEFAULTS.networkBufferSize),
});
export type LocalBrowserGuards = z.infer<typeof localBrowserGuardsSchema>;

export const localBrowserDocumentStateSchema = z.object({
  documentId: z.string(),
  url: z.string(),
  readyState: z.string(),
  visibilityState: z.string(),
  navigationType: z.enum(LOCAL_BROWSER_NAVIGATION_TYPES),
  restoredFromBfcache: z.boolean(),
  wasDiscarded: z.boolean(),
  prerendering: z.boolean(),
  loadedAt: z.number(),
  ageMs: z.number(),
  requestsSinceLoad: z.number(),
  xhrSinceLoad: z.number(),
  stale: z.boolean(),
  staleReasons: z.array(z.string()),
});
export type LocalBrowserDocumentState = z.infer<typeof localBrowserDocumentStateSchema>;

export const localBrowserTabSchema = z
  .object({
    tabId: z.number().int().nonnegative(),
    windowId: z.number().int().nonnegative().optional(),
    title: z.string(),
    url: z.string(),
    active: z.boolean(),
    status: z.string().optional(),
    cookieStoreId: z.string().optional(),
    containerName: z.string().optional(),
    incognito: z.boolean().optional(),
    discarded: z.boolean().optional(),
    frozen: z.boolean().optional(),
    pinned: z.boolean().optional(),
    audible: z.boolean().optional(),
  })
  .strict();
export type LocalBrowserTab = z.infer<typeof localBrowserTabSchema>;

export const localBrowserSessionSchema = z
  .object({
    sessionId: z.string().uuid(),
    connectionId: z.string().uuid(),
    client: localBrowserClientSchema,
    clientVersion: z.string(),
    label: z.string(),
    profileName: z.string().nullable(),
    ownerUserId: z.string().nullable().optional(),
    tier: localBrowserTierSchema,
    connectedAt: z.string(),
    lastSeenAt: z.string(),
    tabs: z.array(localBrowserTabSchema),
    controlledByViewer: z.boolean(),
    capabilities: z.array(z.string()).default([]),
    access: localBrowserAccessSchema.optional(),
    guards: localBrowserGuardsSchema.optional(),
  })
  .strict();
export type LocalBrowserSession = z.infer<typeof localBrowserSessionSchema>;

function limitField(key: LocalBrowserLimitKey) {
  const range = LOCAL_BROWSER_LIMITS[key];
  return z.number().int().min(range.min).max(range.ceiling).default(range.default);
}

export const localBrowserLimitsSchema = z
  .object({
    resultMaxChars: limitField("resultMaxChars"),
    snapshotMaxNodes: limitField("snapshotMaxNodes"),
    readMaxChars: limitField("readMaxChars"),
    screenshotMaxBytes: limitField("screenshotMaxBytes"),
    transferMaxBytes: limitField("transferMaxBytes"),
    callMaxMs: limitField("callMaxMs"),
    networkMaxEntries: limitField("networkMaxEntries"),
  })
  .strict();
export type LocalBrowserLimits = z.infer<typeof localBrowserLimitsSchema>;

export const LOCAL_BROWSER_LIMIT_DEFAULTS: LocalBrowserLimits = Object.fromEntries(
  LOCAL_BROWSER_LIMIT_KEYS.map((key) => [key, LOCAL_BROWSER_LIMITS[key].default]),
) as LocalBrowserLimits;

export const localBrowserLimitedSchema = z.array(
  z.object({ field: z.string(), requested: z.number(), applied: z.number() }).strict(),
);
export type LocalBrowserLimited = z.infer<typeof localBrowserLimitedSchema>;

const ceiling = (key: LocalBrowserLimitKey) => LOCAL_BROWSER_LIMITS[key].ceiling;
const timeoutSchema = z.number().int().min(100).max(ceiling("callMaxMs"));

export const localBrowserTargetSchema = z
  .object({
    sessionId: z.string().uuid().optional().describe("Paired browser session id; omit when one browser is paired"),
    tabId: z.number().int().nonnegative().optional().describe("Tab id from local_browser_sessions; omit for the active tab"),
  })
  .strict();

const sessionOnlySchema = z
  .object({
    sessionId: z.string().uuid().optional().describe("Paired browser session id; omit when one browser is paired"),
  })
  .strict();

export const localBrowserSessionsInputSchema = localBrowserTargetSchema;

export const localBrowserOpenInputSchema = localBrowserTargetSchema
  .extend({
    url: z.string().url().optional().describe("Absolute http(s) URL"),
    newTab: z.boolean().optional().describe("Accepted for compatibility; a url reuses your own tab when you have one"),
    active: z.boolean().optional().describe("Focus the tab when opening it"),
    cookieStoreId: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe("Open the tab in this cookie jar, for example a Firefox container id from local_browser_context"),
    incognito: z.boolean().optional().describe("Open in a private window; the extension must be allowed in private windows"),
    newWindow: z.boolean().optional().describe("Open in a new window instead of a tab"),
  })
  .strict();

export const localBrowserNavigateInputSchema = localBrowserTargetSchema
  .extend({
    url: z.string().url().optional(),
    back: z.boolean().optional(),
    forward: z.boolean().optional(),
    reload: z.boolean().optional(),
    waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).optional(),
    timeoutMs: timeoutSchema.optional().describe("Default 15000; capped by the company call limit"),
  })
  .strict();

export const localBrowserSnapshotInputSchema = localBrowserTargetSchema
  .extend({
    selector: z.string().min(1).optional().describe("Scope the snapshot to a subtree"),
    maxNodes: z
      .number()
      .int()
      .min(10)
      .max(ceiling("snapshotMaxNodes"))
      .optional()
      .describe("Default 120; capped by the company snapshot limit"),
    includeText: z.boolean().optional().describe("Include short text content per node"),
    includeHidden: z.boolean().optional(),
    cursor: z.string().min(1).optional().describe("Continue after the previous page"),
  })
  .strict();

export const localBrowserActInputSchema = localBrowserTargetSchema
  .extend({
    action: z.enum(LOCAL_BROWSER_ACTIONS),
    ref: localBrowserRefSchema.optional().describe("Element ref from the latest snapshot, for example e12"),
    selector: z.string().min(1).optional().describe("CSS selector when you have no ref"),
    text: z.string().optional().describe("Text for type; replaces the field value unless submit is set"),
    key: z.string().min(1).optional().describe("Key for press, for example Enter"),
    value: z.string().optional().describe("Option value for select"),
    values: z.array(z.string()).max(1_000).optional().describe("Multiple option values for select"),
    deltaY: z.number().optional().describe("Scroll distance; positive is down"),
    deltaX: z.number().optional(),
    submit: z.boolean().optional().describe("Press Enter after typing"),
    force: z
      .boolean()
      .optional()
      .describe("Act even when another element covers the target; use after a refusal that says the element is covered"),
    input: z
      .enum(LOCAL_BROWSER_ACT_INPUT_MODES)
      .optional()
      .describe(
        "auto (default) uses real browser clicks and keys when the extension can send them and falls back to page events; trusted fails instead of falling back; synthetic always uses page events",
      ),
    timeoutMs: timeoutSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.ref && !value.selector) {
      ctx.addIssue({ code: "custom", message: "Pass ref from the latest snapshot, or a CSS selector", path: ["ref"] });
    }
    if (value.action === "type" && value.text === undefined) {
      ctx.addIssue({ code: "custom", message: "type needs text", path: ["text"] });
    }
    if (value.action === "press" && !value.key) {
      ctx.addIssue({ code: "custom", message: "press needs key, for example Enter", path: ["key"] });
    }
    if (value.action === "select" && !value.value && !value.values?.length) {
      ctx.addIssue({ code: "custom", message: "select needs value or values", path: ["value"] });
    }
  });

export const localBrowserReadInputSchema = localBrowserTargetSchema
  .extend({
    selector: z.string().min(1).optional(),
    format: z.enum(["text", "markdown", "html"]).optional(),
    maxChars: z
      .number()
      .int()
      .min(200)
      .max(ceiling("readMaxChars"))
      .optional()
      .describe("Default 8000; capped by the company read limit"),
  })
  .strict();

export const localBrowserScreenshotInputSchema = localBrowserTargetSchema
  .extend({
    selector: z.string().min(1).optional(),
    fullPage: z.boolean().optional(),
  })
  .strict();

export const localBrowserWaitInputSchema = localBrowserTargetSchema
  .extend({
    selector: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    urlIncludes: z.string().min(1).optional(),
    idle: z.boolean().optional(),
    timeoutMs: timeoutSchema.optional().describe("Default 10000; capped by the company call limit"),
  })
  .strict();

export const localBrowserEvaluateInputSchema = localBrowserTargetSchema
  .extend({
    expression: z.string().min(1).describe("An expression or a function body; return a JSON-serializable value"),
    world: z.enum(["main", "isolated"]).optional(),
    awaitPromise: z.boolean().optional(),
    timeoutMs: timeoutSchema.optional(),
  })
  .strict();

const localBrowserDomainPattern = /^\.?(?!-)[a-z0-9-]{1,63}(?:\.(?!-)[a-z0-9-]{1,63})*\.?$/i;

const COOKIE_ENTRY_KEYS = ["domain", "path", "secure", "httpOnly", "sameSite", "expirationDate", "storeId", "session"] as const;

const localBrowserCookieEntrySchema = z
  .object({
    name: z.string().min(1),
    value: z.string(),
    domain: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    secure: z.boolean().optional(),
    httpOnly: z.boolean().optional(),
    sameSite: z.enum(LOCAL_BROWSER_COOKIE_SAME_SITE).optional(),
    expirationDate: z.number().positive().optional().describe("Seconds since the Unix epoch; omit for a session cookie"),
    session: z.boolean().optional().describe("true writes a session cookie that ends with the browser; omit expirationDate"),
    storeId: z.string().min(1).optional(),
  })
  .strict();

export const localBrowserStorageInputSchema = localBrowserTargetSchema
  .extend({
    kind: z.enum(["cookies", "local", "session"]),
    op: z.enum(["get", "set", "clear"]),
    url: z.string().url().optional(),
    domain: z
      .string()
      .min(1)
      .max(253)
      .regex(localBrowserDomainPattern, "domain must be a bare host name, without a scheme, wildcard or path")
      .optional()
      .describe("Bare host such as example.com or .example.com; includes subdomains"),
    allDomains: z.boolean().optional().describe("Whole cookie jar; needs confirmAll with op clear"),
    storeId: z.string().min(1).optional().describe("Cookie store for reads and the default for writes"),
    name: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(100_000).optional().describe("Maximum cookies returned by get; default all"),
    confirmAll: z.boolean().optional(),
    entries: z.array(localBrowserCookieEntrySchema).max(1_000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind !== "cookies") {
      for (const key of ["domain", "allDomains", "storeId", "limit", "confirmAll"] as const) {
        if (value[key] !== undefined) {
          ctx.addIssue({ code: "custom", path: [key], message: key + " applies to cookies only" });
        }
      }
      for (const [index, entry] of (value.entries ?? []).entries()) {
        for (const key of COOKIE_ENTRY_KEYS) {
          if (entry[key] !== undefined) {
            ctx.addIssue({ code: "custom", path: ["entries", index, key], message: key + " applies to cookies only" });
          }
        }
      }
      return;
    }
    for (const [index, entry] of (value.entries ?? []).entries()) {
      if (entry.session === true && entry.expirationDate !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["entries", index, "expirationDate"],
          message: "A session cookie has no expirationDate",
        });
      }
    }
    if (value.limit !== undefined && value.op !== "get") {
      ctx.addIssue({ code: "custom", path: ["limit"], message: "limit is for get only" });
    }
    if (value.op === "clear" && value.allDomains === true && value.name === undefined && value.confirmAll !== true) {
      ctx.addIssue({ code: "custom", path: ["confirmAll"], message: "Clearing the whole jar needs a name filter or confirmAll" });
    }
    if (value.allDomains === true && (value.url !== undefined || value.domain !== undefined)) {
      ctx.addIssue({ code: "custom", path: ["allDomains"], message: "allDomains reads the whole cookie jar, so omit url and domain" });
    }
    if (value.domain !== undefined && value.url !== undefined) {
      ctx.addIssue({ code: "custom", path: ["domain"], message: "Pass either url or domain, not both" });
    }
    if (value.op !== "get" && value.op !== "clear" && value.allDomains === true) {
      ctx.addIssue({ code: "custom", path: ["allDomains"], message: "allDomains is for get and clear only" });
    }
    if (value.op !== "set" && value.entries !== undefined) {
      ctx.addIssue({ code: "custom", path: ["entries"], message: "entries is for set only" });
    }
    if (value.op === "set" && (value.entries?.length ?? 0) === 0) {
      ctx.addIssue({ code: "custom", path: ["entries"], message: "set needs at least one entry" });
    }
    if (
      value.op === "set" &&
      value.url === undefined &&
      value.domain === undefined &&
      !(value.entries ?? []).some((entry) => entry.domain !== undefined)
    ) {
      ctx.addIssue({ code: "custom", path: ["url"], message: "Set needs a url, a domain, or an entry with a domain" });
    }
  });

export const localBrowserNetworkInputSchema = localBrowserTargetSchema
  .extend({
    op: z.enum(["list", "clear"]),
    limit: z
      .number()
      .int()
      .min(1)
      .max(ceiling("networkMaxEntries"))
      .optional()
      .describe("Maximum requests returned; capped by the company network limit"),
    includeBodies: z.boolean().optional(),
    includeHeaders: z.boolean().optional().describe("Return request and response headers; default true"),
    since: z.number().nonnegative().optional().describe("Only requests that started at or after this epoch millisecond"),
    types: z
      .array(z.string().min(1).max(40))
      .max(40)
      .optional()
      .describe("Resource types to keep, for example xmlhttprequest, fetch, document, script"),
    urlIncludes: z.string().min(1).optional(),
    method: z.string().min(1).optional(),
  })
  .strict();

export const localBrowserUploadInputSchema = localBrowserTargetSchema
  .extend({
    ref: localBrowserRefSchema.optional(),
    selector: z.string().min(1).optional(),
    attachmentIds: z.array(z.string().uuid()).min(1).max(100),
  })
  .strict();

export const localBrowserDownloadInputSchema = localBrowserTargetSchema
  .extend({
    op: z.enum(["list", "save"]),
    downloadId: z.number().int().optional(),
  })
  .strict();

export const localBrowserCloseInputSchema = localBrowserTargetSchema
  .extend({ closeSession: z.boolean().optional() })
  .strict();

export const localBrowserContextInputSchema = localBrowserTargetSchema
  .extend({
    cookies: z.boolean().optional().describe("List the tab's cookies without their values; default true"),
  })
  .strict();

export const localBrowserPermissionIdSchema = z.enum(LOCAL_BROWSER_PERMISSION_IDS as [string, ...string[]]);

export const localBrowserPermissionsInputSchema = sessionOnlySchema
  .extend({
    op: z.enum(["status", "request"]),
    permissions: z
      .array(localBrowserPermissionIdSchema)
      .min(1)
      .max(40)
      .optional()
      .describe("Permission ids to request, from the missing list of op status"),
    reason: z.string().min(1).max(300).optional().describe("One sentence the user sees next to the request"),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.op === "request" && !value.permissions?.length) {
      ctx.addIssue({ code: "custom", path: ["permissions"], message: "request needs permissions; call op status to see what is missing" });
    }
    if (value.op === "status" && value.permissions !== undefined) {
      ctx.addIssue({ code: "custom", path: ["permissions"], message: "permissions is for op request only" });
    }
  });

export const localBrowserApiInputSchema = sessionOnlySchema
  .extend({
    path: z
      .string()
      .max(200)
      .regex(LOCAL_BROWSER_API_PATH_PATTERN, "path is a dotted browser API name such as history.search")
      .describe("Browser extension API function, for example history.search or tabs.query"),
    args: z.array(z.unknown()).max(20).optional().describe("Arguments passed to the function, as JSON"),
  })
  .strict();

export const localBrowserUiInputSchema = z.object({ op: z.enum(LOCAL_BROWSER_UI_OPS) }).strict();
export type LocalBrowserUiInput = z.infer<typeof localBrowserUiInputSchema>;

export const localBrowserNetworkRequestSchema = z.object({
  requestHeaders: z.record(z.string(), z.string()).optional(),
  responseHeaders: z.record(z.string(), z.string()).optional(),
  hasCookie: z.boolean(),
  hasAuthorization: z.boolean(),
  fromCache: z.boolean().optional(),
  initiator: z.string().optional(),
  error: z.string().optional(),
  documentId: z.string().optional(),
});

export const localBrowserNetworkCaptureSchema = z.object({
  mode: z.enum(["continuous", "window"]),
  since: z.number(),
  windowMs: z.number().optional(),
});

export const localBrowserCookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string(),
  path: z.string(),
  secure: z.boolean(),
  httpOnly: z.boolean(),
  sameSite: z.string(),
  session: z.boolean(),
  expirationDate: z.number().optional(),
  hostOnly: z.boolean(),
  storeId: z.string(),
  partitionKey: z.unknown().optional(),
});

export const localBrowserContextResultSchema = z.object({
  tab: localBrowserTabSchema,
  container: z.object({
    cookieStoreId: z.string(),
    name: z.string().optional(),
    color: z.string().optional(),
    isDefault: z.boolean(),
  }),
  cookies: z.object({
    storeId: z.string(),
    url: z.string(),
    count: z.number(),
    items: z.array(
      z.object({
        name: z.string(),
        domain: z.string(),
        path: z.string(),
        session: z.boolean(),
        expirationDate: z.number().optional(),
        httpOnly: z.boolean(),
        secure: z.boolean(),
        sameSite: z.string(),
        hostOnly: z.boolean(),
      }),
    ),
  }),
  document: localBrowserDocumentStateSchema.nullable(),
  contentScript: z.enum(LOCAL_BROWSER_CONTENT_SCRIPT_STATES),
  network: z.object({
    capturing: z.boolean(),
    lastRequestAt: z.number().optional(),
    requestsSinceLoad: z.number().optional(),
  }),
  access: localBrowserAccessSchema,
});
export type LocalBrowserContextResult = z.infer<typeof localBrowserContextResultSchema>;

export const localBrowserPermissionsResultSchema = z.object({
  granted: z.array(z.string()),
  missing: z.array(z.string()),
  pending: localBrowserAccessSchema.shape.pending,
  siteAccess: z.enum(LOCAL_BROWSER_SITE_ACCESS),
  requested: z.array(z.string()).optional(),
  alreadyGranted: z.array(z.string()).optional(),
  note: z.string(),
});

export const localBrowserApiResultSchema = z.object({ value: z.unknown(), type: z.string() });

export interface LocalBrowserToolDefinition {
  name: LocalBrowserToolName;
  description: string;
  schema: z.ZodType;
  inputSchema: Record<string, unknown>;
  tier: LocalBrowserTier;
  capability: string | null;
  originExempt: boolean;
}

const ORIGIN_EXEMPT = new Set<string>(LOCAL_BROWSER_ORIGIN_EXEMPT_TOOL_NAMES);

function defineTool(name: LocalBrowserToolName, description: string, schema: z.ZodType): LocalBrowserToolDefinition {
  const { $schema: _schema, ...inputSchema } = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  return {
    name,
    description,
    schema,
    inputSchema,
    tier: LOCAL_BROWSER_TOOL_TIERS[name],
    capability: LOCAL_BROWSER_TOOL_CAPABILITIES[name] ?? null,
    originExempt: ORIGIN_EXEMPT.has(name),
  };
}

const targetHint = "Omit sessionId when exactly one browser is paired; omit tabId to use the active tab.";

export const LOCAL_BROWSER_TOOLS: readonly LocalBrowserToolDefinition[] = [
  defineTool(
    "local_browser_sessions",
    "List the paired browsers with their open tabs, capabilities, granted permissions and guards. " + targetHint + " Start here when you do not know the current tab.",
    localBrowserSessionsInputSchema,
  ),
  defineTool(
    "local_browser_open",
    "Open a URL in the user's real browser. It reuses the tab you already opened for this work and creates one only when you have none, so repeated opens never pile up tabs. Pass cookieStoreId to open in a container or another cookie jar, incognito for a private window, newWindow for a separate window. Never navigates the tab the user is looking at or the Paperclip tab itself. Returns the tab and a first snapshot.",
    localBrowserOpenInputSchema,
  ),
  defineTool(
    "local_browser_navigate",
    "Navigate the current tab: pass url, or one of back, forward, reload. Prefer this over local_browser_open when the tab is already on the site you need. Refused for the tab the user is looking at and for the Paperclip tab itself; call local_browser_open for those.",
    localBrowserNavigateInputSchema,
  ),
  defineTool(
    "local_browser_snapshot",
    "Read the page as a compact accessibility tree where every interactive element has a ref like e12. This is the primary way to see a page: call it after every navigation or click, then pass those refs to local_browser_act. Pass cursor from the previous result to continue. The result carries document; when document.stale is true, reload before you trust it.",
    localBrowserSnapshotInputSchema,
  ),
  defineTool(
    "local_browser_act",
    "Do one thing on the page: click, dblclick, type, press, hover, focus, check, uncheck, select, scroll, scroll_into_view. Target an element with ref from the latest snapshot, or a CSS selector. Clicks, hovers, typing and key presses use real browser input when the extension can send it; the result field input says whether trusted or synthetic events ran, and note explains a fallback. Pass input trusted when the site ignores page events. Pass force to act on an element another element covers. After a click or press that changes the page, take a new snapshot because old refs go stale.",
    localBrowserActInputSchema,
  ),
  defineTool(
    "local_browser_read",
    "Extract text, markdown or html from the page or one element. Use this instead of a snapshot when you need the content itself rather than the controls. The result says when it was truncated and carries document state.",
    localBrowserReadInputSchema,
  ),
  defineTool(
    "local_browser_screenshot",
    "Capture the visible tab, or one element, as an image attachment for the human. Use it for visual checks, layout problems and canvas or image content that a snapshot cannot describe.",
    localBrowserScreenshotInputSchema,
  ),
  defineTool(
    "local_browser_wait",
    "Wait for a condition before acting: a selector appears, text appears, the URL contains a string, or the page is idle. Prefer this over repeating snapshots in a loop.",
    localBrowserWaitInputSchema,
  ),
  defineTool(
    "local_browser_evaluate",
    "Run JavaScript in the page and return its value as JSON. Full tier only. The page is the user's real browser: read what you need, do not exfiltrate credentials, and prefer snapshot and act for ordinary interaction.",
    localBrowserEvaluateInputSchema,
  ),
  defineTool(
    "local_browser_storage",
    "Read or write cookies, localStorage or sessionStorage. Cookies can be scoped by url, by domain (includes subdomains) or with allDomains for the whole jar, and each cookie reports session, expirationDate, httpOnly, secure, sameSite, hostOnly, storeId and partitionKey. Full tier only. Never print secret values into the task; report only what the task needs.",
    localBrowserStorageInputSchema,
  ),
  defineTool(
    "local_browser_network",
    "List the requests the tab made, with request and response headers, status, timing and optionally bodies. Capture runs continuously, so pass since or urlIncludes to narrow it. Full tier only. Use it to diagnose a failing call instead of guessing from the page.",
    localBrowserNetworkInputSchema,
  ),
  defineTool(
    "local_browser_upload",
    "Attach files from the task to a file input on the page. Full tier only. Pass attachmentIds from the task's attachments.",
    localBrowserUploadInputSchema,
  ),
  defineTool(
    "local_browser_download",
    "List the tab's downloads, or save one into the task as an attachment. Full tier only.",
    localBrowserDownloadInputSchema,
  ),
  defineTool(
    "local_browser_close",
    "Close a tab, or the whole paired browser session, when you are done. Closing a session does not sign the user out; it disconnects Paperclip from that browser.",
    localBrowserCloseInputSchema,
  ),
  defineTool(
    "local_browser_context",
    "Probe one tab before you work in it: its container and cookie jar, the cookies for its URL without values, whether the page is stale or came back from the back-forward cache, whether the content script is connected, network capture state and the browser permissions. Call it when a page behaves oddly or before cookie and network work.",
    localBrowserContextInputSchema,
  ),
  defineTool(
    "local_browser_permissions",
    "See which browser permissions the extension has, or ask the user for missing ones. op request cannot grant anything by itself: it shows the request in the extension, and you must tell the user to press Allow there. Call op status again after the user answers.",
    localBrowserPermissionsInputSchema,
  ),
  defineTool(
    "local_browser_api",
    "Call any browser extension API function directly, for example history.search, bookmarks.search, tabs.query or windows.getAll, and get its result as JSON. Full tier only. A function whose permission is missing fails with local_browser_permission_required; the extension's own storage is off limits.",
    localBrowserApiInputSchema,
  ),
];

export const LOCAL_BROWSER_TOOL_NAMES = LOCAL_BROWSER_TOOLS.map((tool) => tool.name);
export const LOCAL_BROWSER_FULL_TIER_TOOL_NAMES = LOCAL_BROWSER_TOOLS.filter((tool) => tool.tier === "full").map(
  (tool) => tool.name,
);

const TOOLS_BY_NAME = new Map<string, LocalBrowserToolDefinition>(LOCAL_BROWSER_TOOLS.map((tool) => [tool.name, tool]));
const INTERNAL_TOOLS = new Set<string>(LOCAL_BROWSER_INTERNAL_TOOL_NAMES);

export function localBrowserTool(name: string): LocalBrowserToolDefinition | null {
  return TOOLS_BY_NAME.get(name) ?? null;
}

export function localBrowserIsInternalTool(name: string): boolean {
  return INTERNAL_TOOLS.has(name);
}

export function localBrowserToolRequiresFullTier(name: string): boolean {
  return TOOLS_BY_NAME.get(name)?.tier === "full";
}

export function localBrowserPermissionsForClient(client: LocalBrowserClient): LocalBrowserPermissionDefinition[] {
  return LOCAL_BROWSER_PERMISSIONS.filter((permission) => permission[client] !== "unsupported");
}

export const localBrowserSettingsSchema = z
  .object({
    tier: localBrowserTierSchema.default("refine"),
    allowedOrigins: z.array(z.string().min(1)).max(200).default([]),
    limits: localBrowserLimitsSchema.prefault({}),
  })
  .strict();
export type LocalBrowserSettings = z.infer<typeof localBrowserSettingsSchema>;
export type LocalBrowserSettingsInput = z.input<typeof localBrowserSettingsSchema>;

function limitRange(key: LocalBrowserLimitKey) {
  const range = LOCAL_BROWSER_LIMITS[key];
  return z.number().int().min(range.min).max(range.ceiling).optional();
}

export const localBrowserSettingsUpdateSchema = z
  .object({
    tier: localBrowserTierSchema.optional(),
    allowedOrigins: z.array(z.string().min(1)).max(200).optional(),
    limits: z
      .object({
        resultMaxChars: limitRange("resultMaxChars"),
        snapshotMaxNodes: limitRange("snapshotMaxNodes"),
        readMaxChars: limitRange("readMaxChars"),
        screenshotMaxBytes: limitRange("screenshotMaxBytes"),
        transferMaxBytes: limitRange("transferMaxBytes"),
        callMaxMs: limitRange("callMaxMs"),
        networkMaxEntries: limitRange("networkMaxEntries"),
      })
      .strict()
      .optional(),
  })
  .strict();
export type LocalBrowserSettingsUpdate = z.infer<typeof localBrowserSettingsUpdateSchema>;

export function localBrowserOriginOf(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function localBrowserOriginAllowed(
  settings: Pick<LocalBrowserSettings, "tier" | "allowedOrigins">,
  rawUrl: string,
): boolean {
  if (settings.tier === "full") return true;
  const origin = localBrowserOriginOf(rawUrl);
  if (!origin) return false;
  return settings.allowedOrigins.some((entry) => {
    const rule = entry.trim().toLowerCase();
    if (!rule) return false;
    if (rule === "*") return true;
    if (rule.startsWith("*.")) {
      const suffix = rule.slice(1);
      const host = new URL(origin).host.toLowerCase();
      return host.endsWith(suffix) || host === suffix.slice(1);
    }
    const normalized = localBrowserOriginOf(rule) ?? rule;
    return normalized.toLowerCase() === origin.toLowerCase();
  });
}

export const localBrowserInputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("mouse"),
      action: z.enum(LOCAL_BROWSER_MOUSE_ACTIONS),
      x: z.number().int().min(0),
      y: z.number().int().min(0),
      button: z.enum(["left", "middle", "right"]).optional(),
      clickCount: z.number().int().min(1).max(3).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("wheel"),
      deltaX: z.number(),
      deltaY: z.number(),
      x: z.number().int().min(0),
      y: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      kind: z.literal("key"),
      action: z.enum(LOCAL_BROWSER_KEY_ACTIONS),
      key: z.string().min(1).max(64),
      code: z.string().min(1).max(64).optional(),
      text: z.string().max(4000).optional(),
      alt: z.boolean().optional(),
      ctrl: z.boolean().optional(),
      meta: z.boolean().optional(),
      shift: z.boolean().optional(),
    })
    .strict(),
]);
export type LocalBrowserInput = z.infer<typeof localBrowserInputSchema>;

const viewerStateSchema = z.enum(LOCAL_BROWSER_VIEWER_STATES);

export const localBrowserViewerFrameEventSchema = z
  .object({
    type: z.literal("frame"),
    dataUrl: z.string().startsWith("data:image/"),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    tabId: z.number().int().nonnegative().optional(),
  })
  .strict();

export const localBrowserViewerStateEventSchema = z
  .object({
    type: z.literal("state"),
    state: viewerStateSchema,
    tabId: z.number().int().nonnegative().optional(),
    message: z.string().max(400).optional(),
  })
  .strict();

export const localBrowserViewerEventSchema = z.discriminatedUnion("type", [
  localBrowserViewerFrameEventSchema,
  localBrowserViewerStateEventSchema,
]);
export type LocalBrowserViewerEvent = z.infer<typeof localBrowserViewerEventSchema>;

export const localBrowserTabsEventSchema = z
  .object({
    type: z.literal("event"),
    event: z.literal("tabs"),
    data: z.object({ tabs: z.array(localBrowserTabSchema) }).strict(),
  })
  .strict();

export const localBrowserFrameEventSchema = z
  .object({
    type: z.literal("event"),
    event: z.literal("frame"),
    data: z
      .object({
        dataUrl: z.string().startsWith("data:image/"),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        tabId: z.number().int().nonnegative().optional(),
      })
      .strict(),
  })
  .strict();

export const localBrowserStateEventSchema = z
  .object({
    type: z.literal("event"),
    event: z.literal("state"),
    data: z
      .object({
        state: viewerStateSchema,
        tabId: z.number().int().nonnegative().optional(),
        message: z.string().max(400).optional(),
      })
      .strict(),
  })
  .strict();

export const localBrowserAccessEventSchema = z
  .object({
    type: z.literal("event"),
    event: z.literal("access"),
    data: localBrowserAccessSchema,
  })
  .strict();

export const localBrowserGuardsEventSchema = z
  .object({
    type: z.literal("event"),
    event: z.literal("guards"),
    data: localBrowserGuardsSchema,
  })
  .strict();

export const localBrowserExtensionEventFrameSchema = z.discriminatedUnion("event", [
  localBrowserTabsEventSchema,
  localBrowserFrameEventSchema,
  localBrowserStateEventSchema,
  localBrowserAccessEventSchema,
  localBrowserGuardsEventSchema,
]);
export type LocalBrowserExtensionEventFrame = z.infer<typeof localBrowserExtensionEventFrameSchema>;

export const LOCAL_BROWSER_PAIRING_CODE_LENGTH = 8;

export const localBrowserPairingStartSchema = z
  .object({
    client: localBrowserClientSchema.optional(),
    label: z.string().min(1).max(80).optional(),
  })
  .strict();

export const localBrowserPairingStartResultSchema = z
  .object({
    code: z.string().length(LOCAL_BROWSER_PAIRING_CODE_LENGTH),
    expiresAt: z.string(),
    connectUrls: z.array(z.string()),
  })
  .strict();
export type LocalBrowserPairingStartResult = z.infer<typeof localBrowserPairingStartResultSchema>;

export const localBrowserBridgeFrameSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("hello"),
      protocol: z.number().int(),
      client: localBrowserClientSchema,
      clientVersion: z.string(),
      label: z.string(),
      profileName: z.string().nullable(),
      tabs: z.array(localBrowserTabSchema),
      capabilities: z.array(z.string().min(1).max(40)).max(40).optional(),
      access: localBrowserAccessSchema.optional().catch(undefined),
      guards: localBrowserGuardsSchema.optional().catch(undefined),
    })
    .strict(),
  z
    .object({
      type: z.literal("hello_ack"),
      sessionId: z.string().uuid(),
      sessionToken: z.string(),
      tier: localBrowserTierSchema,
      allowedOrigins: z.array(z.string()),
    })
    .strict(),
  z
    .object({
      type: z.literal("call"),
      id: z.string(),
      tool: z.string(),
      args: z.unknown(),
      budgetMs: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("result"),
      id: z.string(),
      ok: z.boolean(),
      result: z.unknown().optional(),
      error: localBrowserToolErrorSchema.optional(),
    })
    .strict(),
  z.object({ type: z.literal("event"), event: z.string(), data: z.unknown() }).strict(),
  z.object({ type: z.literal("ping"), at: z.string() }).strict(),
  z.object({ type: z.literal("pong"), at: z.string() }).strict(),
]);
export type LocalBrowserBridgeFrame = z.infer<typeof localBrowserBridgeFrameSchema>;
