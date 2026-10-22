import { z } from "zod";

export const LOCAL_BROWSER_PROTOCOL_VERSION = 1;
export const LOCAL_BROWSER_CONNECTOR_KEY = "local-browser";
export const LOCAL_BROWSER_SKILL_NAME = "local-browser";
export const LOCAL_BROWSER_PAIRING_TTL_MS = 10 * 60 * 1000;
export const LOCAL_BROWSER_CALL_TIMEOUT_MS = 30_000;
export const LOCAL_BROWSER_SNAPSHOT_DEFAULT_NODES = 120;
export const LOCAL_BROWSER_SNAPSHOT_MAX_NODES = 400;
export const LOCAL_BROWSER_TEXT_DEFAULT_CHARS = 8_000;
export const LOCAL_BROWSER_TEXT_MAX_CHARS = 40_000;
export const LOCAL_BROWSER_SCREENSHOT_MAX_BYTES = 2 * 1024 * 1024;
export const LOCAL_BROWSER_VIEWER_FRAME_INTERVAL_MS = 1_000;
/** Viewer frame and input coordinates are CSS pixels of the page viewport, never device pixels. */
export const LOCAL_BROWSER_VIEWER_COORDINATE_SPACE = "css-pixels";

export const LOCAL_BROWSER_TIERS = ["refine", "full"] as const;
export type LocalBrowserTier = (typeof LOCAL_BROWSER_TIERS)[number];
export const localBrowserTierSchema = z.enum(LOCAL_BROWSER_TIERS);

export const LOCAL_BROWSER_CLIENTS = ["chromium", "firefox"] as const;
export type LocalBrowserClient = (typeof LOCAL_BROWSER_CLIENTS)[number];
export const localBrowserClientSchema = z.enum(LOCAL_BROWSER_CLIENTS);

export const LOCAL_BROWSER_ERROR_CODES = [
  "local_browser_not_paired",
  "local_browser_extension_unavailable",
  "local_browser_origin_denied",
  "local_browser_tier_denied",
  "local_browser_tab_missing",
  "local_browser_ref_stale",
  "local_browser_element_missing",
  "local_browser_timeout",
  "local_browser_navigation_blocked",
  "local_browser_protocol_error",
  "local_browser_result_too_large",
  "local_browser_unsupported",
] as const;
export type LocalBrowserErrorCode = (typeof LOCAL_BROWSER_ERROR_CODES)[number];

export const localBrowserToolErrorSchema = z
  .object({
    code: z.enum(LOCAL_BROWSER_ERROR_CODES),
    message: z.string().min(1),
    hint: z.string().min(1).optional(),
    retryable: z.boolean().optional(),
  })
  .strict();
export type LocalBrowserToolError = z.infer<typeof localBrowserToolErrorSchema>;

export const LOCAL_BROWSER_CURSOR_PATTERN = /^\d+$/;
export const localBrowserCursorSchema = z
  .string()
  .regex(LOCAL_BROWSER_CURSOR_PATTERN, "Cursors are the decimal node offset returned by the previous snapshot");

export const localBrowserRefSchema = z
  .string()
  .regex(/^e\d+$/, "Element refs look like e12; take a fresh snapshot when a ref is rejected");

export const localBrowserTabSchema = z
  .object({
    tabId: z.number().int().nonnegative(),
    windowId: z.number().int().nonnegative().optional(),
    title: z.string(),
    url: z.string(),
    active: z.boolean(),
    status: z.string().optional(),
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
  })
  .strict();
export type LocalBrowserSession = z.infer<typeof localBrowserSessionSchema>;

export const localBrowserTargetSchema = z
  .object({
    sessionId: z.string().uuid().optional(),
    tabId: z.number().int().nonnegative().optional(),
  })
  .strict();

export const localBrowserOpenInputSchema = localBrowserTargetSchema
  .extend({
    url: z.string().url().optional(),
    newTab: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .strict();

export const localBrowserNavigateInputSchema = localBrowserTargetSchema
  .extend({
    url: z.string().url().optional(),
    back: z.boolean().optional(),
    forward: z.boolean().optional(),
    reload: z.boolean().optional(),
    waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).optional(),
    timeoutMs: z.number().int().min(100).max(120_000).optional(),
  })
  .strict();

export const localBrowserSnapshotInputSchema = localBrowserTargetSchema
  .extend({
    selector: z.string().min(1).optional(),
    maxNodes: z.number().int().min(10).max(LOCAL_BROWSER_SNAPSHOT_MAX_NODES).optional(),
    includeText: z.boolean().optional(),
    includeHidden: z.boolean().optional(),
    cursor: z.string().min(1).optional(),
  })
  .strict();

export const LOCAL_BROWSER_ACTIONS = [
  "click",
  "dblclick",
  "type",
  "press",
  "hover",
  "focus",
  "check",
  "uncheck",
  "select",
  "scroll",
  "scroll_into_view",
] as const;
export type LocalBrowserAction = (typeof LOCAL_BROWSER_ACTIONS)[number];

export const localBrowserActInputSchema = localBrowserTargetSchema
  .extend({
    action: z.enum(LOCAL_BROWSER_ACTIONS),
    ref: localBrowserRefSchema.optional(),
    selector: z.string().min(1).optional(),
    text: z.string().optional(),
    key: z.string().min(1).optional(),
    value: z.string().optional(),
    values: z.array(z.string()).max(50).optional(),
    deltaY: z.number().optional(),
    deltaX: z.number().optional(),
    submit: z.boolean().optional(),
    timeoutMs: z.number().int().min(100).max(60_000).optional(),
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
    maxChars: z.number().int().min(200).max(LOCAL_BROWSER_TEXT_MAX_CHARS).optional(),
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
    timeoutMs: z.number().int().min(100).max(120_000).optional(),
  })
  .strict();

export const localBrowserEvaluateInputSchema = localBrowserTargetSchema
  .extend({
    expression: z.string().min(1),
    world: z.enum(["main", "isolated"]).optional(),
    awaitPromise: z.boolean().optional(),
    timeoutMs: z.number().int().min(100).max(60_000).optional(),
  })
  .strict();

export const localBrowserStorageInputSchema = localBrowserTargetSchema
  .extend({
    kind: z.enum(["cookies", "local", "session"]),
    op: z.enum(["get", "set", "clear"]),
    url: z.string().url().optional(),
    name: z.string().min(1).optional(),
    entries: z.array(z.object({ name: z.string().min(1), value: z.string() }).strict()).max(200).optional(),
  })
  .strict();

export const localBrowserNetworkInputSchema = localBrowserTargetSchema
  .extend({
    op: z.enum(["list", "clear"]),
    limit: z.number().int().min(1).max(200).optional(),
    includeBodies: z.boolean().optional(),
    urlIncludes: z.string().min(1).optional(),
    method: z.string().min(1).optional(),
  })
  .strict();

export const localBrowserUploadInputSchema = localBrowserTargetSchema
  .extend({
    ref: localBrowserRefSchema.optional(),
    selector: z.string().min(1).optional(),
    attachmentIds: z.array(z.string().uuid()).min(1).max(20),
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

export interface LocalBrowserToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  tier: LocalBrowserTier;
}

const targetHint = "Omit sessionId when exactly one browser is paired; omit tabId to use the active tab.";

export const LOCAL_BROWSER_TOOLS: readonly LocalBrowserToolDefinition[] = [
  {
    name: "local_browser_sessions",
    description: `List the paired browsers and their open tabs. ${targetHint} Start here when you do not know the current tab.`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    tier: "refine",
  },
  {
    name: "local_browser_open",
    description:
      "Open a URL in the user's real browser. It reuses the tab you already opened for this work, and creates one only when you have none, so repeated opens never pile up tabs. Never navigates the tab the user is looking at or the Paperclip tab itself.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Paired browser session id" },
        tabId: { type: "integer", description: "Target this tab instead of your own; refused for the tab the user is looking at and for the Paperclip tab" },
        url: { type: "string", description: "Absolute http(s) URL" },
        newTab: { type: "boolean", description: "Accepted for compatibility; a url reuses your own tab when you have one" },
        active: { type: "boolean", description: "Focus the tab when opening it" },
      },
      additionalProperties: false,
    },
    tier: "refine",
  },
  {
    name: "local_browser_navigate",
    description:
      "Navigate the current tab: pass url, or one of back, forward, reload. Prefer this over local_browser_open when the tab is already on the site you need. Refused for the tab the user is looking at and for the Paperclip tab itself; call local_browser_open for those.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        tabId: { type: "integer" },
        url: { type: "string" },
        back: { type: "boolean" },
        forward: { type: "boolean" },
        reload: { type: "boolean" },
        waitUntil: { type: "string", enum: ["load", "domcontentloaded", "networkidle"] },
        timeoutMs: { type: "integer", description: "Default 15000, max 120000" },
      },
      additionalProperties: false,
    },
    tier: "refine",
  },
  {
    name: "local_browser_snapshot",
    description:
      "Read the page as a compact accessibility tree where every interactive element has a ref like e12. This is the primary way to see a page: call it after every navigation or click, then pass those refs to local_browser_act. Output is capped; pass cursor from the previous result to continue.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        tabId: { type: "integer" },
        selector: { type: "string", description: "Scope the snapshot to a subtree" },
        maxNodes: { type: "integer", description: "Default 120, max 400" },
        includeText: { type: "boolean", description: "Include short text content per node" },
        includeHidden: { type: "boolean" },
        cursor: { type: "string", description: "Continue after the previous page" },
      },
      additionalProperties: false,
    },
    tier: "refine",
  },
  {
    name: "local_browser_act",
    description:
      "Do one thing on the page: click, dblclick, type, press, hover, focus, check, uncheck, select, scroll, scroll_into_view. Target an element with ref from the latest snapshot, or a CSS selector. After a click or press that changes the page, take a new snapshot because old refs go stale.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        tabId: { type: "integer" },
        action: {
          type: "string",
          enum: ["click", "dblclick", "type", "press", "hover", "focus", "check", "uncheck", "select", "scroll", "scroll_into_view"],
        },
        ref: { type: "string", description: "Element ref from the latest snapshot, for example e12" },
        selector: { type: "string", description: "CSS selector when you have no ref" },
        text: { type: "string", description: "Text for type; replaces the field value unless submit is set" },
        key: { type: "string", description: "Key for press, for example Enter" },
        value: { type: "string", description: "Option value for select" },
        values: { type: "array", items: { type: "string" }, description: "Multiple option values for select" },
        deltaY: { type: "number", description: "Scroll distance; positive is down" },
        deltaX: { type: "number" },
        submit: { type: "boolean", description: "Press Enter after typing" },
        timeoutMs: { type: "integer" },
      },
      additionalProperties: false,
    },
    tier: "refine",
  },
  {
    name: "local_browser_read",
    description:
      "Extract text, markdown or html from the page or one element. Use this instead of a snapshot when you need the content itself rather than the controls. Output is capped at maxChars; the result says when it was truncated.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        tabId: { type: "integer" },
        selector: { type: "string" },
        format: { type: "string", enum: ["text", "markdown", "html"] },
        maxChars: { type: "integer", description: "Default 8000, max 40000" },
      },
      additionalProperties: false,
    },
    tier: "refine",
  },
  {
    name: "local_browser_screenshot",
    description:
      "Capture the visible tab, or one element, as an image attachment for the human. Use it for visual checks, layout problems and canvas or image content that a snapshot cannot describe.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        tabId: { type: "integer" },
        selector: { type: "string" },
        fullPage: { type: "boolean" },
      },
      additionalProperties: false,
    },
    tier: "refine",
  },
  {
    name: "local_browser_wait",
    description:
      "Wait for a condition before acting: a selector appears, text appears, the URL contains a string, or the page is idle. Prefer this over repeating snapshots in a loop.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        tabId: { type: "integer" },
        selector: { type: "string" },
        text: { type: "string" },
        urlIncludes: { type: "string" },
        idle: { type: "boolean" },
        timeoutMs: { type: "integer", description: "Default 10000, max 120000" },
      },
      additionalProperties: false,
    },
    tier: "refine",
  },
  {
    name: "local_browser_evaluate",
    description:
      "Run JavaScript in the page and return its value as JSON. Full-power tier only. The page is the user's real browser: read what you need, do not exfiltrate credentials, and prefer snapshot and act for ordinary interaction.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        tabId: { type: "integer" },
        expression: { type: "string", description: "An expression or a function body; return a JSON-serializable value" },
        world: { type: "string", enum: ["main", "isolated"] },
        awaitPromise: { type: "boolean" },
        timeoutMs: { type: "integer" },
      },
      required: ["expression"],
      additionalProperties: false,
    },
    tier: "full",
  },
  {
    name: "local_browser_storage",
    description:
      "Read or write cookies, localStorage or sessionStorage for the page. Full-power tier only. Never print secret values into the task; report only what the task needs.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        tabId: { type: "integer" },
        kind: { type: "string", enum: ["cookies", "local", "session"] },
        op: { type: "string", enum: ["get", "set", "clear"] },
        url: { type: "string" },
        name: { type: "string" },
        entries: { type: "array", items: { type: "object", properties: { name: { type: "string" }, value: { type: "string" } }, required: ["name", "value"], additionalProperties: false } },
      },
      required: ["kind", "op"],
      additionalProperties: false,
    },
    tier: "full",
  },
  {
    name: "local_browser_network",
    description:
      "List recent network requests of the tab, optionally with response bodies. Full-power tier only. Use it to diagnose a failing call instead of guessing from the page.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        tabId: { type: "integer" },
        op: { type: "string", enum: ["list", "clear"] },
        limit: { type: "integer", description: "Default 50, max 200" },
        includeBodies: { type: "boolean" },
        urlIncludes: { type: "string" },
        method: { type: "string" },
      },
      required: ["op"],
      additionalProperties: false,
    },
    tier: "full",
  },
  {
    name: "local_browser_upload",
    description:
      "Attach files from the task to a file input on the page. Full-power tier only. Pass attachmentIds from the task's attachments.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        tabId: { type: "integer" },
        ref: { type: "string" },
        selector: { type: "string" },
        attachmentIds: { type: "array", items: { type: "string" } },
      },
      required: ["attachmentIds"],
      additionalProperties: false,
    },
    tier: "full",
  },
  {
    name: "local_browser_download",
    description:
      "List the tab's downloads, or save one into the task as an attachment. Full-power tier only.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        tabId: { type: "integer" },
        op: { type: "string", enum: ["list", "save"] },
        downloadId: { type: "integer" },
      },
      required: ["op"],
      additionalProperties: false,
    },
    tier: "full",
  },
  {
    name: "local_browser_close",
    description:
      "Close a tab, or the whole paired browser session, when you are done. Closing a session does not sign the user out; it disconnects Paperclip from that browser.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        tabId: { type: "integer" },
        closeSession: { type: "boolean" },
      },
      additionalProperties: false,
    },
    tier: "refine",
  },
];

export const LOCAL_BROWSER_TOOL_NAMES = LOCAL_BROWSER_TOOLS.map((tool) => tool.name);
export const LOCAL_BROWSER_FULL_TIER_TOOL_NAMES = LOCAL_BROWSER_TOOLS.filter(
  (tool) => tool.tier === "full",
).map((tool) => tool.name);

export function localBrowserToolRequiresFullTier(name: string): boolean {
  return LOCAL_BROWSER_FULL_TIER_TOOL_NAMES.includes(name);
}

export const localBrowserSettingsSchema = z
  .object({
    tier: localBrowserTierSchema.default("refine"),
    allowedOrigins: z.array(z.string().min(1)).max(200).default([]),
  })
  .strict();
export type LocalBrowserSettings = z.infer<typeof localBrowserSettingsSchema>;

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
  settings: LocalBrowserSettings,
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

export const LOCAL_BROWSER_MOUSE_ACTIONS = ["move", "down", "up"] as const;
export const LOCAL_BROWSER_KEY_ACTIONS = ["down", "up"] as const;

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
    state: z.enum(["connected", "viewer_unavailable", "agent_streaming", "agent_idle", "disconnected"]),
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
        state: z.enum(["connected", "viewer_unavailable", "agent_streaming", "agent_idle", "disconnected"]),
        tabId: z.number().int().nonnegative().optional(),
        message: z.string().max(400).optional(),
      })
      .strict(),
  })
  .strict();

export const localBrowserExtensionEventFrameSchema = z.discriminatedUnion("event", [
  localBrowserTabsEventSchema,
  localBrowserFrameEventSchema,
  localBrowserStateEventSchema,
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
  z.object({ type: z.literal("hello"), protocol: z.number().int(), client: localBrowserClientSchema, clientVersion: z.string(), label: z.string(), profileName: z.string().nullable(), tabs: z.array(localBrowserTabSchema) }).strict(),
  z.object({ type: z.literal("hello_ack"), sessionId: z.string().uuid(), sessionToken: z.string(), tier: localBrowserTierSchema, allowedOrigins: z.array(z.string()) }).strict(),
  z.object({ type: z.literal("call"), id: z.string(), tool: z.string(), args: z.unknown() }).strict(),
  z.object({ type: z.literal("result"), id: z.string(), ok: z.boolean(), result: z.unknown().optional(), error: localBrowserToolErrorSchema.optional() }).strict(),
  z.object({ type: z.literal("event"), event: z.string(), data: z.unknown() }).strict(),
  z.object({ type: z.literal("ping"), at: z.string() }).strict(),
  z.object({ type: z.literal("pong"), at: z.string() }).strict(),
]);
export type LocalBrowserBridgeFrame = z.infer<typeof localBrowserBridgeFrameSchema>;
