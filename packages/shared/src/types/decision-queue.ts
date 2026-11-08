import type { AttentionSourceKind } from "./attention.js";

export type DecisionQueueSeedRuleSignal =
  | "issue_has_pull_request_work_product"
  | "plan_document_confirmation"
  | "ask_user_questions";

export interface DecisionQueueSeedRule {
  key: string;
  description: string;
  signal: DecisionQueueSeedRuleSignal;
}

export interface DecisionQueueItem {
  id: string;
  companyId: string;
  queueId: string;
  sourceKind: AttentionSourceKind;
  sourceId: string;
  addedByType: "agent" | "user" | "system";
  addedByAgentId: string | null;
  addedByUserId: string | null;
  addedByRunId: string | null;
  responsibleUserId: string | null;
  createdAt: Date;
}

export interface DecisionQueue {
  id: string;
  companyId: string;
  key: string;
  title: string;
  description: string | null;
  createdByType: "agent" | "user" | "system";
  createdByAgentId: string | null;
  createdByUserId: string | null;
  createdByRunId: string | null;
  retentionDays: number | null;
  seedRules: DecisionQueueSeedRule[];
  seedRulesEnabled: boolean;
  /** Open items in the queue page's live list for this reader; the Aging shelf is excluded. */
  itemCount: number;
  /** Decided or expired members visible in decision history; null for agent readers. */
  resolvedCount: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export type DecisionTriageDecideBy = "today" | "this_week" | "whenever" | string;

export interface DecisionTriage {
  id: string;
  companyId: string;
  sourceKind: AttentionSourceKind;
  sourceId: string;
  decideBy: DecisionTriageDecideBy | null;
  snoozedUntil: Date | null;
  setByType: "agent" | "user";
  setByAgentId: string | null;
  setByUserId: string | null;
  setByRunId: string | null;
  responsibleUserId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export const DECISION_HISTORY_SOURCE_KINDS = [
  "issue_thread_interaction",
  "approval",
  "decision",
  "join_request",
] as const satisfies readonly AttentionSourceKind[];

export type ResolvedDecisionSourceKind = (typeof DECISION_HISTORY_SOURCE_KINDS)[number];

export const DECISION_HISTORY_STATUSES = ["decided", "expired"] as const;

export type ResolvedDecisionStatus = (typeof DECISION_HISTORY_STATUSES)[number];

export interface ResolvedDecisionActor {
  type: "user" | "agent" | "system";
  userId: string | null;
  agentId: string | null;
  name: string | null;
}

export interface ResolvedDecisionIssueRef {
  id: string;
  identifier: string | null;
  title: string;
  href: string;
}

export interface ResolvedDecisionEntry {
  id: string;
  sourceKind: ResolvedDecisionSourceKind;
  sourceId: string;
  kind: string;
  kindLabel: string;
  status: string;
  outcome: ResolvedDecisionStatus;
  title: string;
  result: string | null;
  decidedBy: ResolvedDecisionActor;
  decidedAt: string;
  issue: ResolvedDecisionIssueRef | null;
  href: string | null;
}

export interface ResolvedDecisionPage {
  items: ResolvedDecisionEntry[];
  nextCursor: string | null;
  /** Matching rows across every page; returned only for the first page. */
  totalCount: number | null;
}

