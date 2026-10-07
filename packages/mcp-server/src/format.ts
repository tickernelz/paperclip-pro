import { z } from "zod";
import { PaperclipApiError } from "./client.js";

type McpTextResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
};

export const HTTP_STATUS_META_KEY = "paperclip/httpStatus";

export function formatTextResponse(value: unknown): McpTextResponse {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value),
      },
    ],
  };
}

function formatValidationIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message.replace(/^Invalid input: /, "")}`;
    })
    .join("\n");
}

export class UnknownArgumentError extends Error {}

function editDistance(left: string, right: string): number {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length]!;
}

const MONITOR_ARGUMENT_HINT =
  "schedule the issue monitor with advanced.executionPolicy.monitor.nextCheckAt on paperclipUpdateIssue";

function isMonitorArgument(key: string): boolean {
  return key === "monitor" || /^monitor[A-Z]/.test(key);
}

export function assertKnownArguments(input: Record<string, unknown>, known: readonly string[]): void {
  const unknown = Object.keys(input).filter((key) => !known.includes(key));
  if (unknown.length === 0) return;
  const messages = unknown.map((key) => {
    if (isMonitorArgument(key)) return `unknown argument "${key}"; ${MONITOR_ARGUMENT_HINT}`;
    const closest = known
      .map((candidate) => ({ candidate, distance: editDistance(key, candidate) }))
      .sort((left, right) => left.distance - right.distance)[0];
    return closest && closest.distance <= Math.max(2, Math.floor(key.length / 3))
      ? `unknown argument "${key}"; did you mean "${closest.candidate}"?`
      : `unknown argument "${key}"`;
  });
  throw new UnknownArgumentError(`${messages.join("\n")}\nvalid arguments: ${[...known].sort().join(", ")}`);
}

export function formatErrorResponse(error: unknown): McpTextResponse {
  if (error instanceof PaperclipApiError) {
    return {
      ...formatTextResponse({
        error: error.message,
        status: error.status,
        method: error.method,
        path: error.path,
        body: error.body,
      }),
      isError: true,
      _meta: { [HTTP_STATUS_META_KEY]: error.status },
    };
  }
  if (error instanceof z.ZodError) {
    return {
      ...formatTextResponse(formatValidationIssues(error)),
      isError: true,
    };
  }
  if (error instanceof UnknownArgumentError) {
    return { ...formatTextResponse(error.message), isError: true };
  }
  return {
    ...formatTextResponse({
      error: error instanceof Error ? error.message : String(error),
    }),
    isError: true,
  };
}
