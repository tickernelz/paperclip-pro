import { z } from "zod";

export const AUTONOMY_WINDOW_STATUSES = ["live", "revoked", "expired"] as const;
export type AutonomyWindowStatus = (typeof AUTONOMY_WINDOW_STATUSES)[number];

export const AUTONOMY_WINDOW_GRANT_CHANNELS = ["whatsapp", "paperclip"] as const;
export type AutonomyWindowGrantChannel = (typeof AUTONOMY_WINDOW_GRANT_CHANNELS)[number];

export const AUTONOMY_WINDOW_DEFAULT_HOURS = 12;
export const AUTONOMY_WINDOW_MAX_HOURS = 24;
export const AUTONOMY_WINDOW_MAX_ROOTS = 20;
export const AUTONOMY_WINDOW_SYSTEM_ACTOR_ID = "system:autonomy-window";
export const AUTONOMY_WINDOW_RESOLUTION_SOURCE = "autonomy_window";

export interface IssueAutonomyWindow {
  id: string;
  companyId: string;
  rootIssueId: string;
  rootIssueIdentifier: string | null;
  rootIssueTitle: string | null;
  grantedByUserId: string;
  grantedVia: AutonomyWindowGrantChannel;
  status: AutonomyWindowStatus;
  expiresAt: Date;
  maxAccepts: number | null;
  acceptCount: number;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
  closedByUserId: string | null;
}

export interface IssueAutonomyWindowList {
  windows: IssueAutonomyWindow[];
}

export interface IssueAutonomyWindowCoverage {
  window: IssueAutonomyWindow | null;
}

export const autonomyWindowResolutionDetailsSchema = z.object({
  source: z.literal(AUTONOMY_WINDOW_RESOLUTION_SOURCE),
  windowId: z.string().uuid(),
  rootIssueId: z.string().uuid(),
  grantedByUserId: z.string().min(1),
  expiresAt: z.string().datetime({ offset: true }),
});

export type AutonomyWindowResolutionDetails = z.infer<typeof autonomyWindowResolutionDetailsSchema>;

export const openIssueAutonomyWindowSchema = z
  .object({
    issueIds: z.array(z.string().trim().min(1).max(200)).min(1).max(AUTONOMY_WINDOW_MAX_ROOTS),
    hours: z.number().int().min(1).max(AUTONOMY_WINDOW_MAX_HOURS).optional(),
    maxAccepts: z.number().int().min(1).max(1000).nullable().optional(),
    note: z.string().trim().min(1).max(1000).nullable().optional(),
  })
  .strict();

export type OpenIssueAutonomyWindow = z.infer<typeof openIssueAutonomyWindowSchema>;
