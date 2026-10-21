import {
  LOCAL_BROWSER_TOOLS,
  LOCAL_BROWSER_TOOL_NAMES,
  type LocalBrowserSession,
} from "@tickernelz/paperclip-pro-shared";
import type { Db } from "@tickernelz/paperclip-pro-db";
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
}

function resourceLabel(session: LocalBrowserSession): string {
  const base = `${session.client} — ${session.label}`;
  return session.ownerUserId ? `${base} · owner ${session.ownerUserId}` : base;
}

export function localBrowserAssignedResources(
  db: Db,
  binding: { companyId: string },
): LocalBrowserConnectorResource[] {
  return localBrowserService(db)
    .listSessions(binding.companyId)
    .map((session) => ({
      id: session.sessionId,
      label: resourceLabel(session),
      connectionId: session.connectionId,
    }));
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
