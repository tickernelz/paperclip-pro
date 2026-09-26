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
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
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
  return {
    ...formatTextResponse({
      error: error instanceof Error ? error.message : String(error),
    }),
    isError: true,
  };
}
