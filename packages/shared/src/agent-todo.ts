import { z } from "zod";

export const AGENT_TODO_EVENT_TYPE = "agent.todo";
export const AGENT_TODO_STATUSES = ["pending", "in_progress", "completed", "blocked", "dropped"] as const;
export const AGENT_TODO_MAX_PHASES = 30;
export const AGENT_TODO_MAX_TASKS_PER_PHASE = 100;
export const AGENT_TODO_STORED_TASKS_PER_PHASE = 50;
export const AGENT_TODO_MAX_CONTENT_CHARS = 500;
export const AGENT_TODO_MAX_PHASE_NAME_CHARS = 200;

export const agentTodoStatusSchema = z.enum(AGENT_TODO_STATUSES);
export type AgentTodoStatus = z.infer<typeof agentTodoStatusSchema>;

export const agentTodoTaskSchema = z.object({
  content: z.string().max(AGENT_TODO_MAX_CONTENT_CHARS),
  status: agentTodoStatusSchema,
  blocker: z.string().max(AGENT_TODO_MAX_CONTENT_CHARS).optional(),
});
export type AgentTodoTask = z.infer<typeof agentTodoTaskSchema>;

export const agentTodoPhaseSchema = z.object({
  name: z.string().max(AGENT_TODO_MAX_PHASE_NAME_CHARS),
  tasks: z.array(agentTodoTaskSchema).max(AGENT_TODO_MAX_TASKS_PER_PHASE),
});
export type AgentTodoPhase = z.infer<typeof agentTodoPhaseSchema>;

const countSchema = z.number().int().nonnegative();

export const agentTodoCountsSchema = z.object({
  total: countSchema,
  completed: countSchema,
  inProgress: countSchema,
  pending: countSchema,
  blocked: countSchema,
  dropped: countSchema,
});
export type AgentTodoCounts = z.infer<typeof agentTodoCountsSchema>;

export const agentTodoPayloadSchema = z.object({
  version: z.literal(1),
  source: z.literal("omp"),
  op: z.string().max(64),
  toolCallId: z.string().max(256).optional(),
  phases: z.array(agentTodoPhaseSchema).max(AGENT_TODO_MAX_PHASES),
  counts: agentTodoCountsSchema,
});
export type AgentTodoPayload = z.infer<typeof agentTodoPayloadSchema>;

export const agentTodoSnapshotSchema = agentTodoPayloadSchema.extend({
  runId: z.string(),
  agentId: z.string(),
  issueId: z.string(),
  seq: z.number().int(),
  createdAt: z.string(),
  runStatus: z.string(),
});
export type AgentTodoSnapshot = z.infer<typeof agentTodoSnapshotSchema>;

export interface AgentTodoSummary {
  counts: AgentTodoCounts;
  current: string | null;
}

/** Counts tasks by status and names the first in-progress task. */
export function summarizeAgentTodo(
  phases: readonly { name?: string; tasks: readonly Pick<AgentTodoTask, "content" | "status">[] }[],
): AgentTodoSummary {
  const counts: AgentTodoCounts = { total: 0, completed: 0, inProgress: 0, pending: 0, blocked: 0, dropped: 0 };
  let current: string | null = null;
  for (const phase of phases) {
    for (const task of phase.tasks) {
      counts.total += 1;
      if (task.status === "completed") counts.completed += 1;
      else if (task.status === "in_progress") {
        counts.inProgress += 1;
        current ??= task.content;
      } else if (task.status === "pending") counts.pending += 1;
      else if (task.status === "blocked") counts.blocked += 1;
      else counts.dropped += 1;
    }
  }
  return { counts, current };
}

/** Maps an OMP todo status onto the Paperclip agent todo vocabulary. */
export function normalizeAgentTodoStatus(value: unknown): AgentTodoStatus | null {
  switch (value) {
    case "pending":
    case "in_progress":
    case "completed":
    case "blocked":
    case "dropped":
      return value;
    case "abandoned":
      return "dropped";
    default:
      return null;
  }
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Builds a bounded agent todo payload from OMP todo tool result details, or null when the details carry no list. */
export function buildAgentTodoPayloadFromOmpDetails(
  details: unknown,
  options: { toolCallId?: string | null; maxTasksPerPhase?: number } = {},
): AgentTodoPayload | null {
  const record = asRecord(details);
  if (!record || !Array.isArray(record.phases)) return null;
  const maxTasks = Math.min(options.maxTasksPerPhase ?? AGENT_TODO_STORED_TASKS_PER_PHASE, AGENT_TODO_MAX_TASKS_PER_PHASE);
  const fullPhases: AgentTodoPhase[] = [];
  for (const rawPhase of record.phases) {
    const phase = asRecord(rawPhase);
    if (!phase || !Array.isArray(phase.tasks)) continue;
    const tasks: AgentTodoTask[] = [];
    for (const rawTask of phase.tasks) {
      const task = asRecord(rawTask);
      const status = normalizeAgentTodoStatus(task?.status);
      if (!task || typeof task.content !== "string" || !status) continue;
      const blocker = typeof task.blocker === "string" && task.blocker.trim()
        ? clip(task.blocker, AGENT_TODO_MAX_CONTENT_CHARS)
        : undefined;
      tasks.push({ content: clip(task.content, AGENT_TODO_MAX_CONTENT_CHARS), status, ...(blocker ? { blocker } : {}) });
    }
    fullPhases.push({ name: clip(typeof phase.name === "string" ? phase.name : "", AGENT_TODO_MAX_PHASE_NAME_CHARS), tasks });
  }
  const { counts } = summarizeAgentTodo(fullPhases);
  const phases = fullPhases
    .slice(0, AGENT_TODO_MAX_PHASES)
    .map((phase) => ({ name: phase.name, tasks: phase.tasks.slice(0, maxTasks) }));
  const op = typeof record.op === "string" && record.op.trim() ? clip(record.op.trim(), 64) : "update";
  const toolCallId = options.toolCallId?.trim();
  return {
    version: 1,
    source: "omp",
    op,
    ...(toolCallId ? { toolCallId: clip(toolCallId, 256) } : {}),
    phases,
    counts,
  };
}

/** Current task of a stored payload, falling back to the first in-progress task in its phases. */
export function agentTodoCurrentTask(payload: Pick<AgentTodoPayload, "phases">): string | null {
  return summarizeAgentTodo(payload.phases).current;
}

/** One-line run event message for an agent todo update. */
export function agentTodoEventMessage(payload: Pick<AgentTodoPayload, "phases" | "counts">): string {
  const current = agentTodoCurrentTask(payload);
  return `Todo ${payload.counts.completed}/${payload.counts.total}${current ? ` · ${current}` : ""}`;
}

const AGENT_TODO_OP_LABELS: Record<string, string> = {
  init: "planned",
  start: "started",
  done: "completed",
  rm: "removed",
  drop: "dropped",
  block: "blocked",
  unblock: "unblocked",
  append: "added",
  view: "viewed",
};

/** Past-tense verb for an OMP todo operation, used in compact todo rows. */
export function agentTodoOpLabel(op: string | null | undefined): string {
  return (op && AGENT_TODO_OP_LABELS[op]) ?? "updated";
}

/** Parses an unknown value as an agent todo payload, returning null when it does not match. */
export function parseAgentTodoPayload(value: unknown): AgentTodoPayload | null {
  const parsed = agentTodoPayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
