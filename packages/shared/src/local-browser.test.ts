import { describe, expect, it } from "vitest";
import {
  LOCAL_BROWSER_CAPABILITIES,
  LOCAL_BROWSER_INTERNAL_TOOL_NAMES,
  LOCAL_BROWSER_LIMIT_DEFAULTS,
  LOCAL_BROWSER_LIMIT_KEYS,
  LOCAL_BROWSER_LIMITS,
  LOCAL_BROWSER_TOOL_NAMES,
  LOCAL_BROWSER_TOOL_TIERS,
  LOCAL_BROWSER_TOOLS,
  localBrowserActInputSchema,
  localBrowserApiInputSchema,
  localBrowserBridgeFrameSchema,
  localBrowserExtensionEventFrameSchema,
  localBrowserGuardsSchema,
  localBrowserLimitsSchema,
  localBrowserPermissionsForClient,
  localBrowserPermissionsInputSchema,
  localBrowserSettingsSchema,
  localBrowserSnapshotInputSchema,
  localBrowserStorageInputSchema,
  localBrowserTool,
} from "./local-browser.js";

const parse = (value: unknown) => localBrowserStorageInputSchema.safeParse(value);
const cookie = { kind: "cookies", op: "get" } as const;

describe("local browser storage input", () => {
  it("accepts a cookie write with every attribute the browser can store", () => {
    const result = parse({
      ...cookie,
      op: "set",
      url: "https://app.test/",
      entries: [
        { name: "sid", value: "v", domain: ".app.test", path: "/admin", secure: true, httpOnly: true, sameSite: "strict", expirationDate: 1893456000, storeId: "2" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts domain, whole-jar and store scopes for reads and clears", () => {
    expect(parse({ ...cookie, domain: "example.com" }).success).toBe(true);
    expect(parse({ ...cookie, allDomains: true, storeId: "3" }).success).toBe(true);
    expect(parse({ ...cookie, op: "clear", allDomains: true, confirmAll: true }).success).toBe(true);
  });

  it("refuses a scope it cannot honour", () => {
    expect(parse({ ...cookie, allDomains: true, url: "https://app.test/" }).success).toBe(false);
    expect(parse({ ...cookie, allDomains: true, domain: "app.test" }).success).toBe(false);
    expect(parse({ ...cookie, url: "https://app.test/", domain: "app.test" }).success).toBe(false);
  });

  it("refuses cookie options on page storage and empty writes", () => {
    expect(parse({ kind: "local", op: "get", domain: "app.test" }).success).toBe(false);
    expect(parse({ kind: "session", op: "get", storeId: "2" }).success).toBe(false);
    expect(parse({ ...cookie, entries: [{ name: "a", value: "b" }] }).success).toBe(false);
    expect(parse({ ...cookie, op: "set", url: "https://app.test/", entries: [] }).success).toBe(false);
    expect(parse({ ...cookie, op: "set", entries: [{ name: "a", value: "b" }] }).success).toBe(false);
  });

  it("lets a per-entry domain stand in for the call target", () => {
    expect(parse({ ...cookie, op: "set", entries: [{ name: "a", value: "b", domain: ".app.test" }] }).success).toBe(true);
    expect(parse({ ...cookie, op: "set", entries: [{ name: "a", value: "b" }] }).success).toBe(false);
  });

  it("refuses a domain that is not a bare host", () => {
    for (const domain of ["*.app.test", "https://app.test", "app.test/path", "-bad.test", "bad host"]) {
      expect(parse({ ...cookie, domain }).success).toBe(false);
    }
    for (const domain of ["app.test", ".app.test", "localhost", "app.test."]) {
      expect(parse({ ...cookie, domain }).success).toBe(true);
    }
  });

  it("refuses to clear the whole jar without a name or a confirmation", () => {
    expect(parse({ ...cookie, op: "clear", allDomains: true }).success).toBe(false);
    expect(parse({ ...cookie, op: "clear", allDomains: true, name: "sid" }).success).toBe(true);
    expect(parse({ ...cookie, op: "clear", allDomains: true, confirmAll: true }).success).toBe(true);
    expect(parse({ ...cookie, op: "clear", domain: "app.test" }).success).toBe(true);
  });

  it("keeps cookie-only options off page storage", () => {
    expect(parse({ kind: "local", op: "set", url: "https://app.test/", entries: [{ name: "a", value: "b", secure: true }] }).success).toBe(false);
    expect(parse({ kind: "local", op: "set", url: "https://app.test/", entries: [{ name: "a", value: "b" }] }).success).toBe(true);
    expect(parse({ ...cookie, limit: 10 }).success).toBe(true);
    expect(parse({ ...cookie, op: "clear", limit: 10 }).success).toBe(false);
  });

  it("keeps the same-site values the browsers speak", () => {
    for (const sameSite of ["no_restriction", "lax", "strict", "unspecified"]) {
      expect(parse({ ...cookie, op: "set", url: "https://app.test/", entries: [{ name: "a", value: "b", sameSite }] }).success).toBe(true);
    }
    expect(parse({ ...cookie, op: "set", url: "https://app.test/", entries: [{ name: "a", value: "b", sameSite: "none" }] }).success).toBe(false);
  });
});

describe("local browser permission catalog", () => {
  it("filters the catalog per client", () => {
    const chromium = localBrowserPermissionsForClient("chromium").map((entry) => entry.id);
    const firefox = localBrowserPermissionsForClient("firefox").map((entry) => entry.id);
    expect(chromium).toContain("debugger");
    expect(chromium).not.toContain("contextualIdentities");
    expect(firefox).toContain("contextualIdentities");
    expect(firefox).not.toContain("debugger");
  });
});

describe("local browser tool contract", () => {
  it("publishes seventeen agent tools in the tier table order, with no internal tool", () => {
    expect(LOCAL_BROWSER_TOOL_NAMES).toEqual(Object.keys(LOCAL_BROWSER_TOOL_TIERS));
    expect(LOCAL_BROWSER_TOOL_NAMES).toHaveLength(17);
    for (const internal of LOCAL_BROWSER_INTERNAL_TOOL_NAMES) expect(LOCAL_BROWSER_TOOL_NAMES).not.toContain(internal);
  });

  it("generates a JSON Schema for every tool from its zod schema", () => {
    for (const tool of LOCAL_BROWSER_TOOLS) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.inputSchema.$schema).toBeUndefined();
      expect(tool.description.length).toBeGreaterThan(40);
    }
    expect(localBrowserTool("local_browser_api")?.inputSchema).toMatchObject({ required: ["path"] });
    expect(localBrowserTool("local_browser_evaluate")?.inputSchema).toMatchObject({ required: ["expression"] });
  });

  it("raises tool maxima to the limit ceilings", () => {
    expect(localBrowserSnapshotInputSchema.safeParse({ maxNodes: LOCAL_BROWSER_LIMITS.snapshotMaxNodes.ceiling }).success).toBe(true);
    expect(localBrowserSnapshotInputSchema.safeParse({ maxNodes: LOCAL_BROWSER_LIMITS.snapshotMaxNodes.ceiling + 1 }).success).toBe(false);
    expect(localBrowserActInputSchema.safeParse({ action: "click", ref: "e1", force: true, timeoutMs: 600_000 }).success).toBe(true);
  });

  it("validates permission requests and api paths", () => {
    expect(localBrowserPermissionsInputSchema.safeParse({ op: "status" }).success).toBe(true);
    expect(localBrowserPermissionsInputSchema.safeParse({ op: "request", permissions: ["history"], reason: "Search past invoices" }).success).toBe(true);
    expect(localBrowserPermissionsInputSchema.safeParse({ op: "request" }).success).toBe(false);
    expect(localBrowserPermissionsInputSchema.safeParse({ op: "request", permissions: ["root"] }).success).toBe(false);
    expect(localBrowserApiInputSchema.safeParse({ path: "history.search", args: [{ text: "a" }] }).success).toBe(true);
    expect(localBrowserApiInputSchema.safeParse({ path: "privacy.websites.thirdPartyCookiesAllowed.get" }).success).toBe(true);
    for (const path of ["history", "history..search", "1tabs.query", "tabs.query()", ""]) {
      expect(localBrowserApiInputSchema.safeParse({ path }).success).toBe(false);
    }
    expect(localBrowserApiInputSchema.safeParse({ path: "tabs.query", args: new Array(21).fill(1) }).success).toBe(false);
  });

  it("accepts session cookies and refuses a session cookie with an expiry", () => {
    const base = { kind: "cookies", op: "set", url: "https://app.test/" } as const;
    expect(localBrowserStorageInputSchema.safeParse({ ...base, entries: [{ name: "a", value: "b", session: true }] }).success).toBe(true);
    expect(
      localBrowserStorageInputSchema.safeParse({ ...base, entries: [{ name: "a", value: "b", session: true, expirationDate: 1893456000 }] }).success,
    ).toBe(false);
  });
});

describe("local browser limits and frames", () => {
  it("fills defaults and enforces min and ceiling", () => {
    expect(localBrowserSettingsSchema.parse({}).limits).toEqual(LOCAL_BROWSER_LIMIT_DEFAULTS);
    expect(localBrowserSettingsSchema.parse({ limits: { callMaxMs: 9_000 } }).limits.callMaxMs).toBe(9_000);
    for (const key of LOCAL_BROWSER_LIMIT_KEYS) {
      const range = LOCAL_BROWSER_LIMITS[key];
      expect(range.min).toBeLessThanOrEqual(range.default);
      expect(range.default).toBeLessThanOrEqual(range.ceiling);
      expect(localBrowserLimitsSchema.safeParse({ [key]: range.ceiling + 1 }).success).toBe(false);
      expect(localBrowserLimitsSchema.safeParse({ [key]: range.min - 1 }).success).toBe(false);
    }
  });

  it("carries access, guards and budgets on bridge frames", () => {
    const access = { siteAccess: "limited", granted: ["tabs"], missing: ["cookies"], pending: [{ permission: "cookies", reason: "Read session", at: 1 }] };
    const hello = localBrowserBridgeFrameSchema.parse({
      type: "hello",
      protocol: 1,
      client: "firefox",
      clientVersion: "1.1.0",
      label: "x",
      profileName: null,
      tabs: [{ tabId: 1, title: "t", url: "https://a.test/", active: true, cookieStoreId: "firefox-container-1", containerName: "Work" }],
      capabilities: [...LOCAL_BROWSER_CAPABILITIES],
      access,
      guards: {},
    });
    expect(hello).toMatchObject({ access, guards: { protectPaperclipTab: true, protectFocusedTab: true, networkBufferSize: 1000 } });
    const broken = localBrowserBridgeFrameSchema.parse({ type: "hello", protocol: 1, client: "chromium", clientVersion: "1", label: "x", profileName: null, tabs: [], access: { siteAccess: "nope" } });
    expect(broken).toMatchObject({ type: "hello" });
    expect((broken as { access?: unknown }).access).toBeUndefined();
    expect(localBrowserBridgeFrameSchema.safeParse({ type: "call", id: "1", tool: "local_browser_snapshot", args: {}, budgetMs: 35_000 }).success).toBe(true);
    expect(localBrowserExtensionEventFrameSchema.safeParse({ type: "event", event: "access", data: access }).success).toBe(true);
    expect(localBrowserExtensionEventFrameSchema.safeParse({ type: "event", event: "guards", data: { networkBufferSize: 10 } }).success).toBe(false);
    expect(localBrowserGuardsSchema.parse({ networkBufferSize: 20_000 }).networkBufferSize).toBe(20_000);
  });
});
