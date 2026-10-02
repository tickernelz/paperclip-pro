import { z } from "zod";
import { AGENT_STATUSES, ISSUE_STATUSES } from "../constants.js";

export const pixelsOfficeTaskStatusSchema = z.enum(ISSUE_STATUSES);
export type PixelsOfficeTaskStatus = z.infer<typeof pixelsOfficeTaskStatusSchema>;

export const pixelsOfficeAgentStatusSchema = z.enum(AGENT_STATUSES);
export type PixelsOfficeAgentStatus = z.infer<typeof pixelsOfficeAgentStatusSchema>;

export const pixelsOfficeRunStatusSchema = z.enum(["queued", "running"]);
export type PixelsOfficeRunStatus = z.infer<typeof pixelsOfficeRunStatusSchema>;

export interface PixelsOfficeTask {
  issueId: string;
  identifier: string;
  title: string;
  status: PixelsOfficeTaskStatus;
  runId: string | null;
  runStatus: PixelsOfficeRunStatus | null;
  active: boolean;
}

export interface PixelsOfficeAgentProgress {
  runId: string;
  message: string | null;
  toolName: string | null;
  updatedAt: string;
}

export interface PixelsOfficeAgent {
  id: string;
  name: string;
  title: string | null;
  role: string;
  status: PixelsOfficeAgentStatus;
  urlKey: string | null;
  activeRunId: string | null;
  queuedRunId: string | null;
  activeTaskCount: number;
  queuedTaskCount: number;
  maxConcurrentRuns: number;
  pendingInteractionCount: number;
  awaitingBoardCount: number;
  budgetPaused: boolean;
  progress: PixelsOfficeAgentProgress | null;
  tasks: PixelsOfficeTask[];
}

export const pixelsOfficeCollaborationKindSchema = z.enum(["interaction", "delegation"]);
export type PixelsOfficeCollaborationKind = z.infer<typeof pixelsOfficeCollaborationKindSchema>;

export interface PixelsOfficeCollaborationEdge {
  fromAgentId: string;
  toAgentId: string;
  kind: PixelsOfficeCollaborationKind;
  issueId: string;
  since: string;
}

export interface PixelsOfficeSnapshot {
  companyId: string;
  agents: PixelsOfficeAgent[];
  assignments: PixelsOfficeSeatAssignment[];
  collaboration: PixelsOfficeCollaborationEdge[];
  generatedAt: string;
}

export const PIXELS_OFFICE_TIMELINE_MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
export const PIXELS_OFFICE_TIMELINE_PAGE_LIMIT = 5000;

export const pixelsOfficeTimelineEventKindSchema = z.enum([
  "run_started",
  "run_finished",
  "issue_status",
  "interaction",
  "approval",
  "routine",
  "budget",
]);
export type PixelsOfficeTimelineEventKind = z.infer<typeof pixelsOfficeTimelineEventKindSchema>;

export interface PixelsOfficeTimelineEvent {
  at: string;
  agentId: string | null;
  kind: PixelsOfficeTimelineEventKind;
  issueId?: string;
  runId?: string;
  status?: string;
  otherAgentId?: string;
}

export interface PixelsOfficeTimeline {
  from: string;
  to: string;
  events: PixelsOfficeTimelineEvent[];
  nextCursor: string | null;
}

export const pixelsOfficeTimelineQuerySchema = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    cursor: z.string().min(1).max(200).optional(),
  })
  .strict()
  .refine((query) => Date.parse(query.to) > Date.parse(query.from), { message: "to must be after from" })
  .refine((query) => Date.parse(query.to) - Date.parse(query.from) <= PIXELS_OFFICE_TIMELINE_MAX_WINDOW_MS, {
    message: "Timeline window cannot exceed 24 hours",
  });
export type PixelsOfficeTimelineQuery = z.infer<typeof pixelsOfficeTimelineQuerySchema>;

export const pixelsOfficeSeatAssignmentSchema = z.object({
  agentId: z.string().guid(),
  characterIndex: z.number().int().min(0),
  seatId: z.string().min(1).max(200),
});

export const pixelsOfficeSeatAssignmentsSchema = z
  .object({
    assignments: z
      .array(pixelsOfficeSeatAssignmentSchema)
      .max(500)
      .refine((list) => new Set(list.map((entry) => entry.agentId)).size === list.length, {
        message: "Each agent can hold at most one seat assignment",
      }),
  })
  .strict();

export type PixelsOfficeSeatAssignment = z.infer<typeof pixelsOfficeSeatAssignmentSchema>;
export type PixelsOfficeSeatAssignments = z.infer<typeof pixelsOfficeSeatAssignmentsSchema>;
