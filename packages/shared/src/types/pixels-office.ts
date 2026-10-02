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
  tasks: PixelsOfficeTask[];
}

export interface PixelsOfficeSnapshot {
  companyId: string;
  agents: PixelsOfficeAgent[];
  assignments: PixelsOfficeSeatAssignment[];
  generatedAt: string;
}

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
