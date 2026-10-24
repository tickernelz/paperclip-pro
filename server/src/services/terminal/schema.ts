import { z } from "zod";
import {
  TERMINAL_MAX_COLS,
  TERMINAL_MAX_ROWS,
  TERMINAL_MIN_COLS,
  TERMINAL_MIN_ROWS,
  TERMINAL_WEBSOCKET_PATH,
} from "@tickernelz/paperclip-pro-shared";

export const createTerminalSessionSchema = z
  .object({
    kind: z.enum(["local", "ssh"]),
    issueId: z.string().uuid().optional(),
    environmentId: z.string().uuid().optional(),
    cols: z.number().int().min(TERMINAL_MIN_COLS).max(TERMINAL_MAX_COLS).optional(),
    rows: z.number().int().min(TERMINAL_MIN_ROWS).max(TERMINAL_MAX_ROWS).optional(),
    title: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === "ssh" && !value.environmentId) {
      ctx.addIssue({ code: "custom", path: ["environmentId"], message: "SSH terminals require environmentId" });
    }
  });

export const terminalSessionResponseSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  kind: z.enum(["local", "ssh"]),
  title: z.string(),
  cwd: z.string().nullable(),
  issueId: z.string().nullable(),
  environmentId: z.string().nullable(),
  status: z.enum(["running", "exited"]),
  exitCode: z.number().int().nullable(),
  cols: z.number().int(),
  rows: z.number().int(),
  attachedClients: z.number().int(),
  createdAt: z.string(),
  lastActivityAt: z.string(),
  createdByUserId: z.string().nullable(),
});

export const terminalAttachTokenResponseSchema = z.object({
  sessionId: z.string(),
  token: z.string(),
  expiresAt: z.string(),
  websocketPath: z.literal(TERMINAL_WEBSOCKET_PATH),
});

export const terminalUploadResultSchema = z.object({
  path: z.string(),
  bytes: z.number().int(),
});

export const terminalDownloadQuerySchema = z.object({
  path: z.string().min(1),
});
