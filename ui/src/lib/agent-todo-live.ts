import type { QueryClient } from "@tanstack/react-query";
import {
  AGENT_TODO_EVENT_TYPE,
  parseAgentTodoPayload,
  type AgentTodoSnapshot,
  type LiveEvent,
} from "@tickernelz/paperclip-pro-shared";
import { queryKeys } from "./queryKeys";

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isAgentTodoQueryKey(queryKey: readonly unknown[]): boolean {
  return queryKey.length === 3 && queryKey[0] === "issues" && queryKey[2] === "agent-todo";
}

/** Builds the snapshot an `agent.todo` heartbeat.run.event carries, or null for any other event. */
export function readAgentTodoSnapshotFromLiveEvent(event: LiveEvent): AgentTodoSnapshot | null {
  if (event.type !== "heartbeat.run.event") return null;
  const payload = event.payload ?? {};
  if (payload.eventType !== AGENT_TODO_EVENT_TYPE) return null;
  const runId = readString(payload.runId);
  const agentId = readString(payload.agentId);
  const issueId = readString(payload.issueId);
  const seq = payload.seq;
  if (!runId || !agentId || !issueId || typeof seq !== "number" || !Number.isInteger(seq)) return null;
  const todo = parseAgentTodoPayload(payload.payload);
  if (!todo) return null;
  return {
    ...todo,
    runId,
    agentId,
    issueId,
    seq,
    createdAt: readString(payload.lastEventAt) ?? event.createdAt,
    runStatus: "running",
  };
}

/** Patches cached issue agent todo snapshots from agent.todo run events and run status changes. */
export function applyAgentTodoLiveEvent(queryClient: QueryClient, event: LiveEvent): void {
  if (event.type === "heartbeat.run.status") {
    const payload = event.payload ?? {};
    const runId = readString(payload.runId);
    const status = readString(payload.status);
    if (!runId || !status) return;
    queryClient.setQueriesData<AgentTodoSnapshot | null>(
      { predicate: (query) => isAgentTodoQueryKey(query.queryKey) },
      (current) =>
        current && current.runId === runId && current.runStatus !== status
          ? { ...current, runStatus: status }
          : current,
    );
    return;
  }
  const snapshot = readAgentTodoSnapshotFromLiveEvent(event);
  if (!snapshot) return;
  queryClient.setQueryData<AgentTodoSnapshot | null>(
    queryKeys.issues.agentTodo(snapshot.issueId),
    (current) =>
      current && current.runId === snapshot.runId && current.seq >= snapshot.seq
        ? current
        : snapshot,
  );
}
