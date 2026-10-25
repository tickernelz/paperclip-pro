export const LOCAL_BROWSER_PROTOCOL_VERSION = 1;
export const LOCAL_BROWSER_CALL_TIMEOUT_MS = 30_000;
export const LOCAL_BROWSER_SNAPSHOT_DEFAULT_NODES = 120;
export const LOCAL_BROWSER_TEXT_DEFAULT_CHARS = 8_000;
export const LOCAL_BROWSER_VIEWER_FRAME_INTERVAL_MS = 1_000;
export const LOCAL_BROWSER_CALL_GRACE_MS = 5_000;
export const LOCAL_BROWSER_EXTENSION_BUDGET_MARGIN_MS = 1_000;

export const LOCAL_BROWSER_TIERS = ["refine", "full"] as const;
export const LOCAL_BROWSER_CLIENTS = ["chromium", "firefox"] as const;

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
  "local_browser_permission_required",
] as const;

export const LOCAL_BROWSER_CAPABILITIES = [
  "cookies.v2",
  "permissions.v1",
  "context.v1",
  "network.headers",
  "tabs.container",
  "document.state",
  "api.v1",
  "act.force",
  "budget.v1",
] as const;

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
export const LOCAL_BROWSER_MOUSE_ACTIONS = ["move", "down", "up"] as const;
export const LOCAL_BROWSER_KEY_ACTIONS = ["down", "up"] as const;
export const LOCAL_BROWSER_VIEWER_STATES = [
  "connected",
  "viewer_unavailable",
  "agent_streaming",
  "agent_idle",
  "disconnected",
] as const;
export const LOCAL_BROWSER_COOKIE_SAME_SITE = ["no_restriction", "lax", "strict", "unspecified"] as const;
export const LOCAL_BROWSER_NAVIGATION_TYPES = ["navigate", "reload", "back_forward", "prerender", "unknown"] as const;
export const LOCAL_BROWSER_SITE_ACCESS = ["all", "limited", "unknown"] as const;
export const LOCAL_BROWSER_CONTENT_SCRIPT_STATES = ["connected", "missing", "blocked"] as const;
export const LOCAL_BROWSER_UI_OPS = ["open_permissions", "open_control_center"] as const;

export const LOCAL_BROWSER_CURSOR_PATTERN = /^\d+$/;
export const LOCAL_BROWSER_API_PATH_PATTERN = /^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)+$/;

export type LocalBrowserPermissionAvailability = "required" | "optional" | "unsupported";

export interface LocalBrowserPermissionDefinition {
  id: string;
  kind: "api" | "origin";
  label: string;
  grants: string;
  chromium: LocalBrowserPermissionAvailability;
  firefox: LocalBrowserPermissionAvailability;
}

export const LOCAL_BROWSER_PERMISSIONS: readonly LocalBrowserPermissionDefinition[] = [
  { id: "<all_urls>", kind: "origin", label: "Every website", grants: "Agents can open, read and act on any website in this browser.", chromium: "optional", firefox: "optional" },
  { id: "tabs", kind: "api", label: "Tabs", grants: "Agents can see the title and address of every open tab.", chromium: "optional", firefox: "optional" },
  { id: "scripting", kind: "api", label: "Page scripting", grants: "Agents can read pages, click, type and run scripts in the pages they can reach.", chromium: "optional", firefox: "optional" },
  { id: "cookies", kind: "api", label: "Cookies", grants: "Agents can read, set and clear cookies, including signed-in sessions.", chromium: "optional", firefox: "optional" },
  { id: "downloads", kind: "api", label: "Downloads", grants: "Agents can list downloads and save downloaded files into a task.", chromium: "optional", firefox: "optional" },
  { id: "downloads.open", kind: "api", label: "Open downloads", grants: "Agents can open files the browser downloaded.", chromium: "optional", firefox: "optional" },
  { id: "webRequest", kind: "api", label: "Network activity", grants: "Agents can see the requests pages make, with their headers.", chromium: "required", firefox: "optional" },
  { id: "webRequestBlocking", kind: "api", label: "Network response bodies", grants: "Agents can read the response bodies of the requests pages make.", chromium: "unsupported", firefox: "optional" },
  { id: "webNavigation", kind: "api", label: "Navigation events", grants: "Agents can tell when a page loads, reloads or comes back from the back-forward cache.", chromium: "optional", firefox: "optional" },
  { id: "history", kind: "api", label: "History", grants: "Agents can search and read your browsing history.", chromium: "optional", firefox: "optional" },
  { id: "bookmarks", kind: "api", label: "Bookmarks", grants: "Agents can search, read and change your bookmarks.", chromium: "optional", firefox: "optional" },
  { id: "browsingData", kind: "api", label: "Browsing data", grants: "Agents can clear browsing data such as cache, cookies and history.", chromium: "optional", firefox: "optional" },
  { id: "sessions", kind: "api", label: "Recently closed", grants: "Agents can list and restore recently closed tabs and windows.", chromium: "optional", firefox: "optional" },
  { id: "topSites", kind: "api", label: "Top sites", grants: "Agents can read the sites you visit most.", chromium: "optional", firefox: "optional" },
  { id: "clipboardRead", kind: "api", label: "Read clipboard", grants: "Agents can read what you copied to the clipboard.", chromium: "optional", firefox: "optional" },
  { id: "clipboardWrite", kind: "api", label: "Write clipboard", grants: "Agents can put text on your clipboard.", chromium: "optional", firefox: "optional" },
  { id: "notifications", kind: "api", label: "Notifications", grants: "The extension can show a desktop notice when an agent asks for a permission.", chromium: "optional", firefox: "optional" },
  { id: "management", kind: "api", label: "Extensions", grants: "Agents can list your installed extensions and turn them on or off.", chromium: "optional", firefox: "optional" },
  { id: "privacy", kind: "api", label: "Privacy settings", grants: "Agents can read and change the browser privacy settings.", chromium: "optional", firefox: "optional" },
  { id: "search", kind: "api", label: "Search", grants: "Agents can run a search with your default search engine.", chromium: "optional", firefox: "optional" },
  { id: "pageCapture", kind: "api", label: "Save page", grants: "Agents can save a whole page as one MHTML file.", chromium: "optional", firefox: "unsupported" },
  { id: "tabGroups", kind: "api", label: "Tab groups", grants: "Agents can read and arrange tab groups.", chromium: "optional", firefox: "unsupported" },
  { id: "contentSettings", kind: "api", label: "Site settings", grants: "Agents can read and change per-site settings such as cookies, JavaScript and pop-ups.", chromium: "optional", firefox: "unsupported" },
  { id: "proxy", kind: "api", label: "Proxy", grants: "Agents can read and change the browser proxy settings.", chromium: "unsupported", firefox: "optional" },
  { id: "tabHide", kind: "api", label: "Hide tabs", grants: "Agents can hide and show tabs.", chromium: "unsupported", firefox: "optional" },
  { id: "find", kind: "api", label: "Find in page", grants: "Agents can search page text the way Find in page does.", chromium: "unsupported", firefox: "optional" },
  { id: "browserSettings", kind: "api", label: "Browser settings", grants: "Agents can read and change some global browser settings.", chromium: "unsupported", firefox: "optional" },
  { id: "debugger", kind: "api", label: "Debugger", grants: "The extension can send trusted clicks and keys and read response bodies through the browser debugging protocol.", chromium: "required", firefox: "unsupported" },
  { id: "contextualIdentities", kind: "api", label: "Containers", grants: "Agents can see and open your Firefox containers, each with its own cookie jar.", chromium: "unsupported", firefox: "required" },
  { id: "storage", kind: "api", label: "Extension storage", grants: "The extension keeps its pairing and your settings.", chromium: "required", firefox: "required" },
  { id: "alarms", kind: "api", label: "Background timers", grants: "The extension stays connected while the browser runs.", chromium: "required", firefox: "unsupported" },
  { id: "activeTab", kind: "api", label: "Current tab", grants: "The extension can work with the tab you open it on.", chromium: "required", firefox: "required" },
];

export const LOCAL_BROWSER_PERMISSION_IDS = LOCAL_BROWSER_PERMISSIONS.map((permission) => permission.id);

export const LOCAL_BROWSER_LIMIT_KEYS = [
  "resultMaxChars",
  "snapshotMaxNodes",
  "readMaxChars",
  "screenshotMaxBytes",
  "transferMaxBytes",
  "callMaxMs",
  "networkMaxEntries",
] as const;
export type LocalBrowserLimitKey = (typeof LOCAL_BROWSER_LIMIT_KEYS)[number];

export interface LocalBrowserLimitRange {
  default: number;
  min: number;
  ceiling: number;
}

export const LOCAL_BROWSER_LIMITS: Readonly<Record<LocalBrowserLimitKey, LocalBrowserLimitRange>> = {
  resultMaxChars: { default: 60_000, min: 1_000, ceiling: 2_000_000 },
  snapshotMaxNodes: { default: 400, min: 10, ceiling: 20_000 },
  readMaxChars: { default: 40_000, min: 200, ceiling: 2_000_000 },
  screenshotMaxBytes: { default: 2_097_152, min: 65_536, ceiling: 52_428_800 },
  transferMaxBytes: { default: 20_971_520, min: 1_048_576, ceiling: 268_435_456 },
  callMaxMs: { default: 120_000, min: 5_000, ceiling: 600_000 },
  networkMaxEntries: { default: 200, min: 10, ceiling: 5_000 },
};

export const LOCAL_BROWSER_GUARD_DEFAULTS = {
  protectPaperclipTab: true,
  protectFocusedTab: true,
  networkBufferSize: 1_000,
} as const;
export const LOCAL_BROWSER_NETWORK_BUFFER_RANGE = { min: 50, max: 20_000 } as const;

export const LOCAL_BROWSER_TOOL_TIERS = {
  local_browser_sessions: "refine",
  local_browser_open: "refine",
  local_browser_navigate: "refine",
  local_browser_snapshot: "refine",
  local_browser_act: "refine",
  local_browser_read: "refine",
  local_browser_screenshot: "refine",
  local_browser_wait: "refine",
  local_browser_evaluate: "full",
  local_browser_storage: "full",
  local_browser_network: "full",
  local_browser_upload: "full",
  local_browser_download: "full",
  local_browser_close: "refine",
  local_browser_context: "refine",
  local_browser_permissions: "refine",
  local_browser_api: "full",
} as const;
export type LocalBrowserToolName = keyof typeof LOCAL_BROWSER_TOOL_TIERS;

export const LOCAL_BROWSER_TOOL_CAPABILITIES: Readonly<Partial<Record<LocalBrowserToolName, string>>> = {
  local_browser_context: "context.v1",
  local_browser_permissions: "permissions.v1",
  local_browser_api: "api.v1",
};

export const LOCAL_BROWSER_ORIGIN_EXEMPT_TOOL_NAMES = [
  "local_browser_sessions",
  "local_browser_close",
  "local_browser_permissions",
  "local_browser_api",
] as const;

export const LOCAL_BROWSER_INTERNAL_TOOL_NAMES = ["local_browser_viewer", "local_browser_input", "local_browser_ui"] as const;
