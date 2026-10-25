import { and, eq } from "drizzle-orm";
import type { Db } from "@tickernelz/paperclip-pro-db";
import { localBrowserConnections, localBrowserSettings as localBrowserSettingsTable } from "@tickernelz/paperclip-pro-db";
import {
  LOCAL_BROWSER_SCREENSHOT_MAX_BYTES,
  LOCAL_BROWSER_TEXT_DEFAULT_CHARS,
  LOCAL_BROWSER_TEXT_MAX_CHARS,
  localBrowserActInputSchema,
  localBrowserCloseInputSchema,
  localBrowserDownloadInputSchema,
  localBrowserEvaluateInputSchema,
  localBrowserNavigateInputSchema,
  localBrowserNetworkInputSchema,
  localBrowserOpenInputSchema,
  localBrowserOriginAllowed,
  localBrowserOriginOf,
  LOCAL_BROWSER_COOKIE_CAPABILITY,
  localBrowserReadInputSchema,
  localBrowserScreenshotInputSchema,
  localBrowserSettingsSchema,
  localBrowserSnapshotInputSchema,
  localBrowserStorageInputSchema,
  localBrowserTargetSchema,
  localBrowserToolRequiresFullTier,
  localBrowserUploadInputSchema,
  localBrowserWaitInputSchema,
  type LocalBrowserSettings,
  type LocalBrowserSession,
  type LocalBrowserTab,
} from "@tickernelz/paperclip-pro-shared";
import type { z } from "zod";
import type { StorageService } from "../../storage/types.js";
import { logActivity } from "../activity-log.js";
import {
  decodeDataUrl,
  LOCAL_BROWSER_UPLOAD_MAX_BYTES,
  readTaskAttachment,
  storeLocalBrowserAttachment,
} from "./attachments.js";
import { localBrowserFailure } from "./errors.js";
import {
  addPendingCall,
  getSession,
  liveSessionsForCompany,
  nextCallId,
  removeSession,
  takePendingCall,
  toPublicSession,
  updateSessionTier,
} from "./registry.js";
import { boundRenderedSnapshot, renderSnapshot } from "./snapshot.js";
import { localBrowserCallBudget } from "./timeouts.js";
import type { LiveSession, LocalBrowserBinding } from "./types.js";

const INTERNAL_TOOLS = new Set(["local_browser_viewer", "local_browser_input"]);
const ORIGIN_EXEMPT_TOOLS = new Set(["local_browser_sessions", "local_browser_close"]);
const RESULT_CAP_CHARS = 60_000;

const INPUT_SCHEMAS: Record<string, z.ZodTypeAny> = {
  local_browser_sessions: localBrowserTargetSchema,
  local_browser_open: localBrowserOpenInputSchema,
  local_browser_navigate: localBrowserNavigateInputSchema,
  local_browser_snapshot: localBrowserSnapshotInputSchema,
  local_browser_act: localBrowserActInputSchema,
  local_browser_read: localBrowserReadInputSchema,
  local_browser_screenshot: localBrowserScreenshotInputSchema,
  local_browser_wait: localBrowserWaitInputSchema,
  local_browser_evaluate: localBrowserEvaluateInputSchema,
  local_browser_storage: localBrowserStorageInputSchema,
  local_browser_network: localBrowserNetworkInputSchema,
  local_browser_upload: localBrowserUploadInputSchema,
  local_browser_download: localBrowserDownloadInputSchema,
  local_browser_close: localBrowserCloseInputSchema,
};

export interface LocalBrowserServiceOptions {
  callTimeoutMs?: number;
  storage?: StorageService;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function activeTab(session: LiveSession, tabId: number | undefined): LocalBrowserTab | null {
  if (tabId !== undefined) return session.tabs.find((tab) => tab.tabId === tabId) ?? null;
  return session.tabs.find((tab) => tab.active) ?? session.tabs[0] ?? null;
}

function capResult(value: unknown, limit = RESULT_CAP_CHARS): unknown {
  if (value === undefined || value === null) return value ?? null;
  const text = JSON.stringify(value);
  if (text.length <= limit) return value;
  return { truncated: true, totalChars: text.length, preview: text.slice(0, limit) };
}

function bytesOfBase64(base64: string): number {
  const cleaned = base64.replace(/\s+/g, "");
  const padding = cleaned.endsWith("==") ? 2 : cleaned.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((cleaned.length * 3) / 4) - padding);
}

export function localBrowserService(db: Db, options: LocalBrowserServiceOptions = {}) {
  const budgetFor = (tool: string, args: Record<string, unknown>): number =>
    options.callTimeoutMs ?? localBrowserCallBudget(tool, args);

  function resolveSession(binding: LocalBrowserBinding, sessionId: string | undefined): LiveSession {
    if (sessionId) {
      const session = getSession(sessionId);
      if (!session || session.companyId !== binding.companyId) {
        throw localBrowserFailure("local_browser_extension_unavailable", "That browser session is no longer connected", {
          retryable: true,
          hint: "Call local_browser_sessions to see the live browsers, or pair the extension again.",
        });
      }
      return session;
    }
    const candidates = liveSessionsForCompany(binding.companyId);
    if (candidates.length === 0) {
      throw localBrowserFailure("local_browser_not_paired", "No browser is paired for this company", {
        hint: "Ask the user to open the Paperclip Local Browser extension and pair it with the code from the Apps panel.",
      });
    }
    if (binding.agentId) {
      const own = candidates.filter((session) => session.createdByAgentId === binding.agentId);
      if (own.length > 0) return own[own.length - 1]!;
    }
    const owners = new Set(
      candidates.map((session) => session.createdByUserId).filter((owner): owner is string => Boolean(owner)),
    );
    if (owners.size > 1) {
      throw localBrowserFailure(
        "local_browser_not_paired",
        "More than one person's browser is paired for this company",
        {
          hint: "Pass sessionId from local_browser_sessions so the call targets one browser.",
        },
      );
    }
    return candidates[candidates.length - 1]!;
  }

  function enforceCookieCapability(session: LiveSession, tool: string, args: Record<string, unknown>) {
    if (tool !== "local_browser_storage" || args.kind !== "cookies") return;
    const modern =
      args.domain !== undefined ||
      args.allDomains === true ||
      args.storeId !== undefined ||
      args.limit !== undefined ||
      args.confirmAll !== undefined ||
      (Array.isArray(args.entries) &&
        args.entries.some(
          (entry) =>
            entry &&
            typeof entry === "object" &&
            ["domain", "path", "secure", "httpOnly", "sameSite", "expirationDate", "storeId"].some(
              (key) => (entry as Record<string, unknown>)[key] !== undefined,
            ),
        ));
    if (!modern || session.capabilities.includes(LOCAL_BROWSER_COOKIE_CAPABILITY)) return;
    throw localBrowserFailure(
      "local_browser_unsupported",
      "This browser build only reads cookies for the page url; update the Local Browser extension to use domain, allDomains, limits or cookie attributes",
      { hint: "Install the current extension from the Apps page and pair again." },
    );
  }

  function enforceTier(session: LiveSession, tool: string) {
    if (session.tier === "full") return;
    if (!localBrowserToolRequiresFullTier(tool)) return;
    throw localBrowserFailure(
      "local_browser_tier_denied",
      tool + " needs the full tier, and this browser is paired in refine tier",
      { hint: "Ask the owner to switch the Local Browser tier to full in the Apps panel, then retry." },
    );
  }

  function originForCall(tool: string, args: Record<string, unknown>, session: LiveSession): string | null {
    if (ORIGIN_EXEMPT_TOOLS.has(tool)) return null;
    if (typeof args.url === "string") return localBrowserOriginOf(args.url);
    if (typeof args.domain === "string" || args.allDomains === true) return null;
    const tab = activeTab(session, typeof args.tabId === "number" ? args.tabId : undefined);
    if (!tab || !tab.url) return null;
    return localBrowserOriginOf(tab.url);
  }

  function enforceOrigin(session: LiveSession, tool: string, origin: string | null) {
    if (ORIGIN_EXEMPT_TOOLS.has(tool)) return;
    if (!origin) {
      if (session.tier === "full") return;
      throw localBrowserFailure(
        "local_browser_origin_denied",
        "The page origin is unknown, so refine tier cannot allow " + tool,
        {
          hint: "Call local_browser_sessions or local_browser_snapshot to refresh the tab list, then retry with a known tabId. Ask the owner for the full tier when the origin truly cannot be read.",
        },
      );
    }
    if (localBrowserOriginAllowed({ tier: session.tier, allowedOrigins: session.allowedOrigins }, origin)) return;
    throw localBrowserFailure("local_browser_origin_denied", origin + " is not on this browser's allowlist", {
      hint: "Ask the owner to add the origin in the Local Browser settings, or switch the tier to full.",
    });
  }

  function dispatch(session: LiveSession, tool: string, args: Record<string, unknown>): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const id = nextCallId();
      const budget = budgetFor(tool, args);
      const timer = setTimeout(() => {
        session.pending.delete(id);
        reject(
          localBrowserFailure(
            "local_browser_timeout",
            "The browser did not answer " + tool + " within " + budget + "ms",
            {
              retryable: true,
              hint: "The page may still be loading. Retry once, or call local_browser_wait first.",
            },
          ),
        );
      }, budget);
      timer.unref?.();
      addPendingCall(session, {
        id,
        tool,
        sessionId: session.sessionId,
        startedAt: Date.now(),
        budgetMs: budget,
        resolve,
        reject,
        timer,
      });
      try {
        session.socket.send(JSON.stringify({ type: "call", id, tool, args }));
      } catch {
        takePendingCall(session, id);
        reject(
          localBrowserFailure("local_browser_extension_unavailable", "The browser extension stopped accepting calls", {
            retryable: true,
          }),
        );
      }
    });
  }

  async function audit(input: {
    binding: LocalBrowserBinding;
    tool: string;
    session: LiveSession | null;
    sessionId: string | null;
    tabId: number | null;
    origin: string | null;
    ok: boolean;
    durationMs: number;
    errorCode: string | null;
  }) {
    try {
      await logActivity(db, {
        companyId: input.binding.companyId,
        actorType: input.binding.agentId ? "agent" : input.binding.userId ? "user" : "system",
        actorId: input.binding.agentId ?? input.binding.userId ?? "local-browser",
        agentId: input.binding.agentId ?? null,
        runId: input.binding.runId ?? null,
        action: "local_browser.tool_called",
        entityType: "local_browser_session",
        entityId: input.sessionId ?? "unpaired",
        details: {
          tool: input.tool,
          sessionId: input.sessionId,
          tabId: input.tabId,
          origin: input.origin,
          tier: input.session?.tier ?? null,
          ok: input.ok,
          durationMs: input.durationMs,
          errorCode: input.errorCode,
        },
      });
    } catch {
      return;
    }
  }

  async function uploadFiles(binding: LocalBrowserBinding, args: Record<string, unknown>) {
    const attachmentIds = Array.isArray(args.attachmentIds) ? (args.attachmentIds as string[]) : [];
    const files: Array<{ name: string; mimeType: string; base64: string }> = [];
    let total = 0;
    for (const attachmentId of attachmentIds) {
      const file = await readTaskAttachment(db, {
        companyId: binding.companyId,
        attachmentId,
        issueId: binding.issueId ?? null,
        storage: options.storage,
      });
      total += file.bytes.length;
      if (total > LOCAL_BROWSER_UPLOAD_MAX_BYTES) {
        throw localBrowserFailure(
          "local_browser_result_too_large",
          "The files together exceed the " + LOCAL_BROWSER_UPLOAD_MAX_BYTES + " byte upload limit",
          { status: 413 },
        );
      }
      files.push({ name: file.originalFilename, mimeType: file.contentType, base64: file.bytes.toString("base64") });
    }
    const rest: Record<string, unknown> = { ...args };
    delete rest.attachmentIds;
    return { ...rest, files };
  }

  async function finishResult(
    binding: LocalBrowserBinding,
    tool: string,
    args: Record<string, unknown>,
    raw: unknown,
  ): Promise<unknown> {
    const payload = record(raw);
    if (tool === "local_browser_snapshot") {
      return boundRenderedSnapshot(
        renderSnapshot(payload, {
          maxNodes: typeof args.maxNodes === "number" ? args.maxNodes : undefined,
          cursor: typeof args.cursor === "string" ? args.cursor : undefined,
        }),
      );
    }
    if (tool === "local_browser_read") {
      const requested = typeof args.maxChars === "number" ? args.maxChars : LOCAL_BROWSER_TEXT_DEFAULT_CHARS;
      const maxChars = Math.min(Math.max(requested, 200), LOCAL_BROWSER_TEXT_MAX_CHARS);
      const content =
        typeof payload.content === "string" ? payload.content : typeof payload.text === "string" ? payload.text : "";
      const totalChars = typeof payload.totalChars === "number" ? payload.totalChars : content.length;
      const clipped = content.length > maxChars ? content.slice(0, maxChars) : content;
      return {
        url: typeof payload.url === "string" ? payload.url : null,
        format:
          typeof payload.format === "string"
            ? payload.format
            : typeof args.format === "string"
              ? args.format
              : "text",
        content: clipped,
        totalChars,
        truncated: payload.truncated === true || clipped.length < content.length || content.length < totalChars,
      };
    }
    if (tool === "local_browser_screenshot") {
      const dataUrl = typeof payload.dataUrl === "string" ? payload.dataUrl : "";
      const decoded = decodeDataUrl(dataUrl);
      if (!decoded) {
        throw localBrowserFailure("local_browser_protocol_error", "The extension returned an unusable screenshot", {
          retryable: true,
        });
      }
      if (decoded.bytes.length > LOCAL_BROWSER_SCREENSHOT_MAX_BYTES) {
        throw localBrowserFailure(
          "local_browser_result_too_large",
          "The screenshot is " +
            decoded.bytes.length +
            " bytes, above the " +
            LOCAL_BROWSER_SCREENSHOT_MAX_BYTES +
            " byte limit",
          { status: 413, hint: "Capture an element instead of the full page, or reduce the window size." },
        );
      }
      const stored = await storeLocalBrowserAttachment(db, {
        companyId: binding.companyId,
        namespace: "local-browser/screenshots",
        originalFilename: "screenshot.png",
        contentType: decoded.contentType.startsWith("image/") ? decoded.contentType : "image/png",
        bytes: decoded.bytes,
        createdByUserId: binding.userId ?? null,
        createdByAgentId: binding.agentId ?? null,
        runId: binding.runId ?? null,
        issueId: binding.issueId ?? null,
        storage: options.storage,
      });
      return {
        attachmentId: stored.attachmentId,
        width: typeof payload.width === "number" ? payload.width : null,
        height: typeof payload.height === "number" ? payload.height : null,
        byteSize: stored.byteSize,
      };
    }
    if (tool === "local_browser_download" && args.op === "save") {
      const base64 = typeof payload.base64 === "string" ? payload.base64 : "";
      if (!base64) {
        throw localBrowserFailure("local_browser_protocol_error", "The extension returned no download bytes", {
          retryable: true,
        });
      }
      if (bytesOfBase64(base64) > LOCAL_BROWSER_UPLOAD_MAX_BYTES) {
        throw localBrowserFailure("local_browser_result_too_large", "The download is larger than 20 MB", {
          status: 413,
        });
      }
      const stored = await storeLocalBrowserAttachment(db, {
        companyId: binding.companyId,
        namespace: "local-browser/downloads",
        originalFilename: typeof payload.name === "string" && payload.name ? payload.name : "download.bin",
        contentType:
          typeof payload.mimeType === "string" && payload.mimeType ? payload.mimeType : "application/octet-stream",
        bytes: Buffer.from(base64, "base64"),
        createdByUserId: binding.userId ?? null,
        createdByAgentId: binding.agentId ?? null,
        runId: binding.runId ?? null,
        issueId: binding.issueId ?? null,
        storage: options.storage,
      });
      return {
        downloadId: typeof payload.downloadId === "number" ? payload.downloadId : null,
        attachmentId: stored.attachmentId,
        name: stored.originalFilename,
        byteSize: stored.byteSize,
      };
    }
    return capResult(raw);
  }

  async function teardownSession(session: LiveSession): Promise<void> {
    removeSession(session.sessionId, "closed");
    session.socket.close(1000, "session closed");
    try {
      await db
        .update(localBrowserConnections)
        .set({ status: "closed", closedAt: new Date(), updatedAt: new Date() })
        .where(eq(localBrowserConnections.id, session.connectionId));
    } catch {
      return;
    }
  }

  async function auditInternal(input: {
    companyId: string;
    tool: string;
    sessionId: string | null;
    tabId: number | null;
    origin: string | null;
    tier: string | null;
    ok: boolean;
    durationMs: number;
    errorCode: string | null;
    actorType?: "user" | "agent" | "system";
    actorId?: string;
  }): Promise<void> {
    try {
      await logActivity(db, {
        companyId: input.companyId,
        actorType: input.actorType ?? "system",
        actorId: input.actorId ?? "local-browser-viewer",
        action: "local_browser.tool_called",
        entityType: "local_browser_session",
        entityId: input.sessionId ?? "unpaired",
        details: {
          tool: input.tool,
          sessionId: input.sessionId,
          tabId: input.tabId,
          origin: input.origin,
          tier: input.tier,
          ok: input.ok,
          durationMs: input.durationMs,
          errorCode: input.errorCode,
        },
      });
    } catch {
      return;
    }
  }

  return {
    async executeTool(binding: LocalBrowserBinding, name: string, rawArgs: unknown): Promise<unknown> {
      const startedAt = Date.now();
      let session: LiveSession | null = null;
      let tabId: number | null = null;
      let origin: string | null = null;
      try {
        if (INTERNAL_TOOLS.has(name)) {
          throw localBrowserFailure(
            "local_browser_unsupported",
            name + " is driven by the Paperclip viewer and is not an agent tool",
          );
        }
        const schema = INPUT_SCHEMAS[name];
        if (!schema) {
          throw localBrowserFailure("local_browser_unsupported", "Unknown local browser tool " + name);
        }
        const parsed = schema.safeParse(rawArgs ?? {});
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          throw localBrowserFailure(
            "local_browser_unsupported",
            "Invalid arguments for " +
              name +
              ": " +
              (issue ? (issue.path.join(".") || "args") + " " + issue.message : "unexpected shape"),
            { status: 400 },
          );
        }
        const args = record(parsed.data);
        tabId = typeof args.tabId === "number" ? args.tabId : null;
        if (name === "local_browser_sessions") {
          const sessions: LocalBrowserSession[] = liveSessionsForCompany(binding.companyId).map(toPublicSession);
          await audit({
            binding,
            tool: name,
            session: null,
            sessionId: typeof args.sessionId === "string" ? args.sessionId : null,
            tabId,
            origin: null,
            ok: true,
            durationMs: Date.now() - startedAt,
            errorCode: null,
          });
          return { sessions };
        }
        session = resolveSession(binding, typeof args.sessionId === "string" ? args.sessionId : undefined);
        enforceTier(session, name);
        enforceCookieCapability(session, name, args);
        origin = originForCall(name, args, session);
        enforceOrigin(session, name, origin);
        const callArgs = name === "local_browser_upload" ? await uploadFiles(binding, args) : args;
        const raw = await dispatch(session, name, callArgs);
        const result = await finishResult(binding, name, args, raw);
        if (name === "local_browser_close" && args.closeSession === true) {
          await teardownSession(session);
        }
        await audit({
          binding,
          tool: name,
          session,
          sessionId: session.sessionId,
          tabId,
          origin,
          ok: true,
          durationMs: Date.now() - startedAt,
          errorCode: null,
        });
        return result;
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string"
            ? (error as { code: string }).code
            : "local_browser_protocol_error";
        await audit({
          binding,
          tool: name,
          session,
          sessionId: session?.sessionId ?? null,
          tabId,
          origin,
          ok: false,
          durationMs: Date.now() - startedAt,
          errorCode: code,
        });
        throw error;
      }
    },

    sendInternalCall(session: LiveSession, tool: string, args: Record<string, unknown>): Promise<unknown> {
      return dispatch(session, tool, args);
    },

    auditInternal,

    listSessions(companyId: string): LocalBrowserSession[] {
      return liveSessionsForCompany(companyId).map(toPublicSession);
    },

    hasLiveSession(companyId: string, sessionId: string): boolean {
      const session = getSession(sessionId);
      return Boolean(session && session.companyId === companyId);
    },

    getSessionForCompany(companyId: string, sessionId: string): LiveSession | null {
      const session = getSession(sessionId);
      return session && session.companyId === companyId ? session : null;
    },

    async disconnect(sessionId: string): Promise<boolean> {
      const session = getSession(sessionId);
      if (!session) return false;
      await teardownSession(session);
      return true;
    },

    async getSettings(companyId: string): Promise<LocalBrowserSettings> {
      const [row] = await db
        .select({ tier: localBrowserSettingsTable.tier, allowedOrigins: localBrowserSettingsTable.allowedOrigins })
        .from(localBrowserSettingsTable)
        .where(eq(localBrowserSettingsTable.companyId, companyId))
        .limit(1);
      if (!row) return { tier: "refine", allowedOrigins: [] };
      return localBrowserSettingsSchema.parse({
        tier: row.tier === "full" ? "full" : "refine",
        allowedOrigins: Array.isArray(row.allowedOrigins) ? row.allowedOrigins : [],
      });
    },

    async updateSettings(
      companyId: string,
      settings: LocalBrowserSettings,
      actor: { userId?: string | null; agentId?: string | null } = {},
    ): Promise<LocalBrowserSettings> {
      const parsed = localBrowserSettingsSchema.parse(settings);
      const now = new Date();
      await db
        .insert(localBrowserSettingsTable)
        .values({
          companyId,
          tier: parsed.tier,
          allowedOrigins: parsed.allowedOrigins,
          updatedByUserId: actor.userId ?? null,
          updatedByAgentId: actor.agentId ?? null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: localBrowserSettingsTable.companyId,
          set: {
            tier: parsed.tier,
            allowedOrigins: parsed.allowedOrigins,
            updatedByUserId: actor.userId ?? null,
            updatedByAgentId: actor.agentId ?? null,
            updatedAt: now,
          },
        });
      await db
        .update(localBrowserConnections)
        .set({ tier: parsed.tier, allowedOrigins: parsed.allowedOrigins, updatedAt: now })
        .where(and(eq(localBrowserConnections.companyId, companyId), eq(localBrowserConnections.status, "active")));
      for (const session of liveSessionsForCompany(companyId)) {
        updateSessionTier(session, parsed.tier, parsed.allowedOrigins);
      }
      return parsed;
    },
  };
}

export type LocalBrowserService = ReturnType<typeof localBrowserService>;
