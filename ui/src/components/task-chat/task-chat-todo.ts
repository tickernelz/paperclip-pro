import {
  agentTodoCurrentTask,
  agentTodoOpLabel,
  buildAgentTodoPayloadFromOmpDetails,
} from "@tickernelz/paperclip-pro-shared";
import type { TaskChatTodoItem } from "./task-chat-model";

const SUBJECT_MAX = 80;
const ERROR_MAX = 500;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  const content = record(value)?.content;
  return typeof content === "string" && content.trim() ? content.trim() : undefined;
}

function firstText(values: unknown): string | undefined {
  if (!Array.isArray(values)) return undefined;
  for (const value of values) {
    const found = text(value);
    if (found) return found;
  }
  return undefined;
}

function clipSubject(value: string): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > SUBJECT_MAX ? `${oneLine.slice(0, SUBJECT_MAX - 1)}…` : oneLine;
}

function subjectFromArgs(args: Record<string, unknown> | null): string | undefined {
  if (!args) return undefined;
  const task = text(args.task);
  if (task) return task;
  const newItem =
    firstText(args.items) ??
    (Array.isArray(args.list)
      ? args.list.map((phase) => firstText(record(phase)?.items)).find(Boolean)
      : undefined);
  return newItem ?? text(args.phase);
}

/** True when a transcript tool call is an OMP todo operation. */
export function isAgentTodoCall(name: string | null | undefined, input: unknown): boolean {
  return name?.trim().toLowerCase() === "todo" && typeof record(input)?.op === "string";
}

/** Pending todo row built from the tool call arguments. */
export function todoItemFromCall(id: string, input: unknown): TaskChatTodoItem {
  const args = record(input);
  const subject = subjectFromArgs(args);
  return {
    id,
    kind: "todo",
    op: typeof args?.op === "string" && args.op.trim() ? args.op.trim() : null,
    status: "in_progress",
    ...(subject ? { subject: clipSubject(subject) } : {}),
  };
}

/** Settles a todo row with its tool result, taking counts from the structured OMP details. */
export function applyTodoResult(
  item: TaskChatTodoItem,
  result: { isError: boolean; delta?: boolean; details?: unknown; content?: string },
): void {
  item.status = result.delta ? "in_progress" : result.isError ? "failed" : "completed";
  const error = result.isError && !result.delta ? result.content?.trim() : undefined;
  if (error) item.error = error.length > ERROR_MAX ? `${error.slice(0, ERROR_MAX - 1)}…` : error;
  const payload = buildAgentTodoPayloadFromOmpDetails(result.details);
  if (!payload) return;
  item.op ??= payload.op;
  item.counts = { completed: payload.counts.completed, total: payload.counts.total };
  if (!item.subject) {
    const current = agentTodoCurrentTask(payload);
    if (current) item.subject = clipSubject(current);
  }
}

/** One-line label for a todo row, e.g. `Todo · started "Write tests" · 3/8`. */
export function todoRowText(item: TaskChatTodoItem): string {
  const parts = ["Todo"];
  const subject = item.subject ? ` "${item.subject}"` : "";
  parts.push(
    item.status === "failed"
      ? `${item.op ?? "update"} failed${subject}`
      : `${agentTodoOpLabel(item.op)}${subject}`,
  );
  if (item.counts && item.status !== "failed") {
    parts.push(`${item.counts.completed}/${item.counts.total}`);
  }
  return parts.join(" · ");
}
