import {
  LOCAL_BROWSER_TOOLS,
  LOCAL_BROWSER_TOOL_NAMES,
  type LocalBrowserSession,
} from "@tickernelz/paperclip-pro-shared";
import { and, desc, eq } from "drizzle-orm";
import { localBrowserConnections, type Db } from "@tickernelz/paperclip-pro-db";
import { localBrowserService } from "../../local-browser/service.js";
import { forbidden } from "../../../errors.js";

export const LOCAL_BROWSER_CONNECTOR_TOOLS = LOCAL_BROWSER_TOOLS.map(
  ({ name, description, inputSchema }) => ({ name, description, inputSchema }),
);

const TOOL_NAMES = new Set<string>(LOCAL_BROWSER_TOOL_NAMES);

export interface LocalBrowserConnectorBinding {
  companyId: string;
  agentId: string;
  runId?: string;
  issueId?: string;
}

export interface LocalBrowserConnectorResource {
  id: string;
  label: string;
  connectionId: string;
  metadata?: Record<string, unknown>;
}

function resourceLabel(session: LocalBrowserSession): string {
  const base = session.client + " — " + session.label;
  return session.ownerUserId ? base + " · owner " + session.ownerUserId : base;
}

export async function localBrowserAssignedResources(
  db: Db,
  binding: { companyId: string },
): Promise<LocalBrowserConnectorResource[]> {
  const live: LocalBrowserConnectorResource[] = localBrowserService(db)
    .listSessions(binding.companyId)
    .map((session) => ({
      id: session.sessionId,
      label: resourceLabel(session),
      connectionId: session.connectionId,
      metadata: { live: true, client: session.client, tier: session.tier },
    }));
  const liveConnectionIds = new Set(live.map((entry) => entry.connectionId));
  const paired = await db
    .select({
      id: localBrowserConnections.id,
      label: localBrowserConnections.label,
      client: localBrowserConnections.client,
      tier: localBrowserConnections.tier,
      createdByUserId: localBrowserConnections.createdByUserId,
    })
    .from(localBrowserConnections)
    .where(
      and(
        eq(localBrowserConnections.companyId, binding.companyId),
        eq(localBrowserConnections.status, "active"),
      ),
    )
    .orderBy(desc(localBrowserConnections.connectedAt));
  const offline: LocalBrowserConnectorResource[] = paired
    .filter((connection) => !liveConnectionIds.has(connection.id))
    .map((connection) => ({
      id: connection.id,
      label: connection.client + " — " + connection.label + " · paired, extension not connected",
      connectionId: connection.id,
      metadata: {
        live: false,
        client: connection.client,
        tier: connection.tier,
        createdByUserId: connection.createdByUserId,
      },
    }));
  return [...live, ...offline];
}

export async function executeLocalBrowserTool(
  db: Db,
  binding: LocalBrowserConnectorBinding,
  name: string,
  value: unknown,
): Promise<unknown> {
  if (!TOOL_NAMES.has(name)) throw forbidden("Unknown Local Browser tool");
  const args = value ?? {};
  if (typeof args !== "object" || Array.isArray(args))
    throw forbidden("Expected tool arguments");
  return localBrowserService(db).executeTool(
    {
      companyId: binding.companyId,
      agentId: binding.agentId,
      runId: binding.runId ?? null,
      issueId: binding.issueId ?? null,
    },
    name,
    args,
  );
}
