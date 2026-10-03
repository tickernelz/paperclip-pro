import { and, eq, inArray } from "drizzle-orm";
import { chatEndpoints, type Db } from "@tickernelz/paperclip-pro-db";
import { findActiveServerAdapter } from "../../adapters/registry.js";
import { unprocessable } from "../../errors.js";

export const OPENWA_AGENT_ADAPTER_ATTENTION_MESSAGE =
  "The assigned agent's adapter cannot authenticate runs with signed run tokens; choose a supported adapter, then reconnect OpenWA";

/** True when the adapter authenticates runs with signed run-bound JWTs (spec D35). */
export function openwaAgentAdapterSupported(adapterType: string): boolean {
  return findActiveServerAdapter(adapterType)?.supportsLocalAgentJwt === true;
}

export function assertOpenwaAgentAdapterSupported(adapterType: string): void {
  if (openwaAgentAdapterSupported(adapterType)) return;
  throw unprocessable(
    "OpenWA needs an agent whose adapter authenticates runs with signed run tokens. Choose an agent that uses Claude, Codex, OpenCode, Pi, Gemini, Cursor, or another supported local adapter.",
    { code: "openwa_agent_adapter_unsupported", adapterType },
  );
}

/** Puts the agent's live OpenWA endpoints into attention when its adapter loses run-JWT support. */
export async function markOpenwaEndpointsForAgentAdapter(
  db: Pick<Db, "update">,
  agent: { companyId: string; id: string; adapterType: string },
): Promise<void> {
  if (openwaAgentAdapterSupported(agent.adapterType)) return;
  const now = new Date();
  await db
    .update(chatEndpoints)
    .set({
      status: "attention",
      healthMessage: OPENWA_AGENT_ADAPTER_ATTENTION_MESSAGE,
      lastError: OPENWA_AGENT_ADAPTER_ATTENTION_MESSAGE,
      updatedAt: now,
    })
    .where(
      and(
        eq(chatEndpoints.companyId, agent.companyId),
        eq(chatEndpoints.assignedAgentId, agent.id),
        eq(chatEndpoints.provider, "openwa"),
        inArray(chatEndpoints.status, ["verifying", "active"]),
      ),
    );
}
