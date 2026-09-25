import { Router, type Request } from "express";
import { agents, type Db } from "@tickernelz/paperclip-pro-db";
import { and, eq } from "drizzle-orm";
import { agentAuthorityCapabilities } from "@tickernelz/paperclip-pro-shared";
import {
  paperclipToolCatalog,
  parseToolsets,
  PaperclipApiClient,
} from "@tickernelz/paperclip-pro-mcp-server/catalog";
import { forbidden, unauthorized } from "../errors.js";

const PROTOCOL_VERSION = "2025-06-18";

/** The server's own listen address, so a tool call re-enters the REST API over loopback. */
function loopbackApiUrl(req: Request): string {
  const port = req.socket.localPort;
  if (!port) {
    const configured = process.env.PAPERCLIP_API_URL?.replace(/\/+$/, "");
    if (!configured) throw new Error("Paperclip API origin is unavailable");
    return configured.endsWith("/api") ? configured : `${configured}/api`;
  }
  const address = req.socket.localAddress ?? "127.0.0.1";
  return `http://${address.includes(":") ? `[${address}]` : address}:${port}/api`;
}

/** Mounted after actor middleware; only run-scoped agent credentials authenticate here. */
export function paperclipMcpRoutes(db: Db) {
  const router = Router();

  router.get("/mcp/paperclip", (_req, res) => {
    res.status(405).json({ error: "Method not allowed" });
  });
  router.delete("/mcp/paperclip", (_req, res) => {
    res.status(405).json({ error: "Method not allowed" });
  });

  router.post("/mcp/paperclip", async (req, res) => {
    if (req.actor.type === "none") throw unauthorized();
    if (req.actor.type !== "agent") throw forbidden("Agent credentials required");
    const token = req.header("authorization")?.replace(/^Bearer\s+/i, "").trim();
    if (!token) throw unauthorized();
    const agentId = req.actor.agentId;
    const companyId = req.actor.companyId;
    if (!agentId || !companyId) throw forbidden("Agent credentials required");

    const { id = null, method, params } = (req.body ?? {}) as {
      id?: string | number | null;
      method?: string;
      params?: { name?: string; arguments?: Record<string, unknown> };
    };
    const send = (result: unknown) => res.json({ jsonrpc: "2.0", id, result });

    if (method === "initialize") {
      return send({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "paperclip", version: "0.1.0" },
      });
    }
    if (typeof method === "string" && method.startsWith("notifications/")) {
      return res.status(202).end();
    }
    if (method !== "tools/list" && method !== "tools/call") {
      return res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
    }

    const [agent] = await db
      .select({ role: agents.role })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.companyId, companyId)))
      .limit(1);
    const toolsets = parseToolsets(typeof req.query.toolsets === "string" ? req.query.toolsets : null);
    const client = new PaperclipApiClient({
      apiUrl: loopbackApiUrl(req),
      apiKey: token,
      companyId,
      agentId,
      runId: req.actor.runId ?? req.header("x-paperclip-run-id")?.trim() ?? null,
      toolsets,
      agentRole: agent?.role ?? null,
    });
    const { definitions, listing } = paperclipToolCatalog(
      client,
      toolsets,
      agentAuthorityCapabilities(agent?.role).some((capability) =>
        capability.startsWith("company:"),
      ),
    );

    if (method === "tools/list") return send(listing);

    const tool = definitions.find((entry) => entry.name === params?.name);
    if (!tool) {
      return send({
        isError: true,
        content: [{ type: "text", text: `Tool ${params?.name ?? ""} is unavailable to this agent` }],
      });
    }
    return send(await tool.execute(params?.arguments ?? {}));
  });

  return router;
}
