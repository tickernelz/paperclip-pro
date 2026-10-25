import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@tickernelz/paperclip-pro-db";
import {
  LOCAL_BROWSER_UPDATE_HINT,
  LOCAL_BROWSER_VIEWER_FRAME_INTERVAL_MS,
  localBrowserInputSchema,
  localBrowserPairingStartSchema,
  localBrowserSettingsSchema,
  localBrowserSettingsUpdateSchema,
  localBrowserViewerEventSchema,
  type LocalBrowserViewerEvent,
} from "@tickernelz/paperclip-pro-shared";
import { badRequest, forbidden, notFound, payloadTooLarge } from "../errors.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { localBrowserFailure } from "../services/local-browser/errors.js";
import { createPairing, pairingResult, pairingStatusForCompany } from "../services/local-browser/pairing.js";
import { subscribeViewer, viewerCount } from "../services/local-browser/registry.js";
import { localBrowserService } from "../services/local-browser/service.js";

const MAX_INPUT_BODY_BYTES = 16 * 1024;
export const LOCAL_BROWSER_JSON_BODY_LIMIT = "16kb";
const SSE_KEEPALIVE_MS = 15_000;

const sessionIdSchema = z.string().uuid();

export function localBrowserBodyLimit() {
  return (req: Request, res: import("express").Response, next: import("express").NextFunction) => {
    const declared = Number(req.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_INPUT_BODY_BYTES) {
      res.status(413).json({ error: "Local browser requests are limited to " + MAX_INPUT_BODY_BYTES + " bytes" });
      return;
    }
    next();
  };
}

export function localBrowserBodyErrorHandler() {
  return (err: unknown, _req: Request, res: import("express").Response, next: import("express").NextFunction) => {
    const candidate = err as { type?: unknown; status?: unknown } | null;
    if (candidate && (candidate.type === "entity.too.large" || candidate.status === 413)) {
      res.status(413).json({ error: "Local browser requests are limited to " + MAX_INPUT_BODY_BYTES + " bytes" });
      return;
    }
    next(err);
  };
}

function assertBoardUser(req: Request) {
  if (req.actor.type !== "board") {
    throw forbidden("Local browser takeover requires a signed-in board user");
  }
  assertBoard(req);
}

function auditActor(req: Request): { actorType: "user" | "agent" | "system"; actorId: string } {
  if (req.actor.type === "agent") {
    return { actorType: "agent", actorId: req.actor.agentId ?? req.actor.userId ?? "agent" };
  }
  if (req.actor.type === "board") {
    return { actorType: "user", actorId: req.actor.userId ?? "board-user" };
  }
  return { actorType: "system", actorId: "local-browser" };
}

function resolveCompanyId(req: Request): string {
  const raw = req.query.companyId;
  const requested = typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
  if (requested) {
    assertCompanyAccess(req, requested);
    return requested;
  }
  if (req.actor.type === "agent" && req.actor.companyId) return req.actor.companyId;
  const companies = req.actor.companyIds ?? [];
  if (companies.length === 1) {
    assertCompanyAccess(req, companies[0]!);
    return companies[0]!;
  }
  throw badRequest("companyId is required when the actor belongs to more than one company");
}

function bridgeConnectUrls(req: Request, code: string): string[] {
  const forwardedProto = String(req.get("x-forwarded-proto") ?? "").split(",")[0]?.trim();
  const proto = forwardedProto || req.protocol || "http";
  const host = req.get("host") ?? "localhost";
  const httpUrl = proto + "://" + host + "/api/local-browser/bridge?code=" + encodeURIComponent(code);
  const wsUrl = (proto === "https" ? "wss" : "ws") + "://" + host + "/api/local-browser/bridge?code=" + encodeURIComponent(code);
  return [wsUrl, httpUrl];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function bridgeHelpPage(code: string): string {
  const shown = escapeHtml(code);
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Paperclip Local Browser bridge</title>",
    "<style>",
    "body{margin:0;padding:48px 24px;font:16px/1.55 system-ui,-apple-system,'Segoe UI',sans-serif;",
    "color:#0a0a0a;background:#fff}",
    "main{max-width:34rem;margin:0 auto}",
    "h1{margin:0 0 12px;font-size:1.35rem;letter-spacing:-0.01em}",
    "p{margin:0 0 12px;color:#525252}",
    "code{display:inline-block;padding:2px 6px;border-radius:6px;background:#f5f5f5;",
    "font:600 1.05rem ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:0.08em}",
    "ol{margin:0;padding-left:1.25rem;color:#525252}",
    "li{margin-bottom:6px}",
    "@media (prefers-color-scheme:dark){body{color:#fafafa;background:#343434}p,ol{color:#a3a3a3}",
    "code{background:#262626}}",
    "</style></head><body><main>",
    "<h1>This address is a connection endpoint, not a page</h1>",
    "<p>The Paperclip Local Browser extension opens this address itself over a WebSocket. ",
    "Opening it in a browser tab cannot pair a browser, so this message is the whole page.</p>",
    "<p>To connect a browser:</p>",
    "<ol>",
    "<li>Copy the pairing link from the Local Browser page in Paperclip, or copy the code below.</li>",
    "<li>Open the Paperclip Local Browser extension from your browser toolbar.</li>",
    "<li>Paste the link into the extension and press Connect.</li>",
    "</ol>",
    code
      ? "<p style=\"margin-top:16px\">Pairing code: <code>" + shown + "</code></p>"
      : "<p style=\"margin-top:16px\">This address carries no pairing code. Start a pairing in Paperclip first.</p>",
    "</main></body></html>",
  ].join("");
}

export function localBrowserRoutes(db: Db, service = localBrowserService(db)) {
  const router = Router();

  router.use("/local-browser", (req, res, next) => {
    assertBoard(req);
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.get("/local-browser/bridge", (req, res) => {
    const code = String(req.query.code ?? "").trim();
    res.status(200).type("html").send(bridgeHelpPage(code));
  });

  router.post("/local-browser/pairing", async (req, res) => {
    const companyId = resolveCompanyId(req);
    const body = localBrowserPairingStartSchema.parse(req.body ?? {});
    const actor = getActorInfo(req);
    const pairing = createPairing({
      companyId,
      createdByUserId: actor.actorType === "user" ? actor.actorId : null,
      createdByAgentId: actor.actorType === "agent" ? actor.actorId : null,
      label: body.label ?? null,
      client: body.client ?? null,
    });
    res.status(201).json(pairingResult(pairing, bridgeConnectUrls(req, pairing.code)));
  });

  router.get("/local-browser/pairing/:code", async (req, res) => {
    const companyId = resolveCompanyId(req);
    const code = String(req.params.code ?? "").trim();
    res.json(pairingStatusForCompany(code, companyId));
  });

  router.get("/local-browser/sessions", async (req, res) => {
    const companyId = resolveCompanyId(req);
    res.json({ sessions: service.listSessions(companyId) });
  });

  router.delete("/local-browser/sessions/:id", async (req, res) => {
    const companyId = resolveCompanyId(req);
    const sessionId = sessionIdSchema.parse(req.params.id);
    const live = service.getSessionForCompany(companyId, sessionId);
    if (!live) throw notFound("Browser session is not connected");
    await service.disconnect(sessionId);
    res.json({ ok: true });
  });

  router.get("/local-browser/sessions/:id/viewer", async (req, res) => {
    assertBoardUser(req);
    const companyId = resolveCompanyId(req);
    const sessionId = sessionIdSchema.parse(req.params.id);
    const session = service.getSessionForCompany(companyId, sessionId);
    if (!session) throw notFound("Browser session is not connected");

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-store, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.flushHeaders?.();

    let finished = false;
    let keepalive: ReturnType<typeof setInterval> | null = null;
    let unsubscribe = () => {};

    const stopFrames = () => {
      void service
        .sendInternalCall(session, "local_browser_viewer", { op: "stop" })
        .catch(() => undefined);
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      if (keepalive) clearInterval(keepalive);
      unsubscribe();
      if (viewerCount(session) === 0) stopFrames();
      if (!res.writableEnded) res.end();
    };

    const write = (payload: LocalBrowserViewerEvent) => {
      const parsed = localBrowserViewerEventSchema.safeParse(payload);
      if (!parsed.success) return;
      if (!res.writableEnded) res.write("data: " + JSON.stringify(parsed.data) + "\n\n");
      if (parsed.data.type === "state" && parsed.data.state === "disconnected") finish();
    };

    write({ type: "state", state: "connected" });

    const wasIdle = viewerCount(session) === 0;
    const actor = auditActor(req);
    unsubscribe = subscribeViewer(session, write);
    if (wasIdle) {
      const startedAt = Date.now();
      void service
        .sendInternalCall(session, "local_browser_viewer", {
          op: "start",
          intervalMs: LOCAL_BROWSER_VIEWER_FRAME_INTERVAL_MS,
        })
        .then(() =>
          service.auditInternal({
            companyId,
            tool: "local_browser_viewer",
            sessionId,
            tabId: null,
            origin: null,
            tier: session.tier,
            ok: true,
            durationMs: Date.now() - startedAt,
            errorCode: null,
            ...actor,
          }),
        )
        .catch((error: unknown) => {
          const code =
            error && typeof error === "object" && "code" in error
              ? String((error as { code: unknown }).code)
              : "local_browser_protocol_error";
          write({ type: "state", state: "viewer_unavailable", message: "Live view is unavailable: " + code });
          return service.auditInternal({
            companyId,
            tool: "local_browser_viewer",
            sessionId,
            tabId: null,
            origin: null,
            tier: session.tier,
            ok: false,
            durationMs: Date.now() - startedAt,
            errorCode: code,
            ...actor,
          });
        });
    }

    keepalive = setInterval(() => {
      if (!res.writableEnded) res.write(": keepalive\n\n");
    }, SSE_KEEPALIVE_MS);
    keepalive.unref?.();

    req.on("close", finish);
  });

  router.post("/local-browser/sessions/:id/input", async (req, res) => {
    assertBoardUser(req);
    const companyId = resolveCompanyId(req);
    const sessionId = sessionIdSchema.parse(req.params.id);
    const session = service.getSessionForCompany(companyId, sessionId);
    if (!session) {
      throw localBrowserFailure("local_browser_extension_unavailable", "Browser session is not connected", {
        retryable: true,
      });
    }
    const raw = req.body ?? {};
    const size = Buffer.byteLength(JSON.stringify(raw), "utf8");
    if (size > MAX_INPUT_BODY_BYTES) {
      throw payloadTooLarge("Viewer input is limited to " + MAX_INPUT_BODY_BYTES + " bytes");
    }
    const parsedInput = localBrowserInputSchema.safeParse(raw);
    if (!parsedInput.success) {
      res.status(400).json({
        error: "Invalid viewer input",
        issues: parsedInput.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
      });
      return;
    }
    const body = parsedInput.data;
    const actor = auditActor(req);
    const startedAt = Date.now();
    try {
      await service.sendInternalCall(session, "local_browser_input", { ...body });
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code: unknown }).code)
          : "local_browser_protocol_error";
      await service.auditInternal({
        companyId,
        tool: "local_browser_input",
        sessionId,
        tabId: null,
        origin: null,
        tier: session.tier,
        ok: false,
        durationMs: Date.now() - startedAt,
        errorCode: code,
        ...actor,
      });
      throw error;
    }
    await service.auditInternal({
      companyId,
      tool: "local_browser_input",
      sessionId,
      tabId: null,
      origin: null,
      tier: session.tier,
      ok: true,
      durationMs: Date.now() - startedAt,
      errorCode: null,
      ...actor,
    });
    res.json({ ok: true });
  });

  router.post("/local-browser/sessions/:id/open-permissions", async (req, res) => {
    assertBoardUser(req);
    const companyId = resolveCompanyId(req);
    const sessionId = sessionIdSchema.parse(req.params.id);
    const session = service.getSessionForCompany(companyId, sessionId);
    if (!session) {
      throw localBrowserFailure("local_browser_extension_unavailable", "Browser session is not connected", {
        retryable: true,
      });
    }
    if (!session.capabilities.includes("permissions.v1")) {
      throw localBrowserFailure(
        "local_browser_unsupported",
        "This browser extension cannot open its permission page yet",
        { hint: LOCAL_BROWSER_UPDATE_HINT + ", then pair it again." },
      );
    }
    const actor = auditActor(req);
    const startedAt = Date.now();
    const record = (ok: boolean, errorCode: string | null) =>
      service.auditInternal({
        companyId,
        tool: "local_browser_ui",
        sessionId,
        tabId: null,
        origin: null,
        tier: session.tier,
        ok,
        durationMs: Date.now() - startedAt,
        errorCode,
        ...actor,
      });
    void service
      .sendInternalCall(session, "local_browser_ui", { op: "open_permissions" })
      .then(() => record(true, null))
      .catch((error: unknown) =>
        record(
          false,
          error && typeof error === "object" && "code" in error
            ? String((error as { code: unknown }).code)
            : "local_browser_protocol_error",
        ),
      );
    res.status(202).json({ ok: true });
  });

  router.get("/local-browser/settings", async (req, res) => {
    const companyId = resolveCompanyId(req);
    res.json(await service.getSettings(companyId));
  });

  router.post("/local-browser/settings", async (req, res) => {
    const companyId = resolveCompanyId(req);
    const update = localBrowserSettingsUpdateSchema.parse(req.body ?? {});
    const current = await service.getSettings(companyId);
    const settings = localBrowserSettingsSchema.parse({
      tier: update.tier ?? current.tier,
      allowedOrigins: update.allowedOrigins ?? current.allowedOrigins,
      limits: { ...current.limits, ...update.limits },
    });
    const actor = getActorInfo(req);
    res.json(
      await service.updateSettings(companyId, settings, {
        userId: actor.actorType === "user" ? actor.actorId : null,
        agentId: actor.actorType === "agent" ? actor.actorId : null,
      }),
    );
  });

  return router;
}

export function localBrowserRouteInternals() {
  return { resolveCompanyId, bridgeConnectUrls, MAX_INPUT_BODY_BYTES };
}
