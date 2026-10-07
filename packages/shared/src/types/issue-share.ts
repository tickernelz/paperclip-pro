import type { IssuePriority, IssueStatus } from "../constants.js";

export const ISSUE_SHARE_TOKEN_LENGTH = 10;
export const ISSUE_SHARE_TOKEN_PATTERN = /^[0-9A-Za-z]{10}$/;

export interface IssueShareLink {
  id: string;
  issueId: string;
  token: string;
  url: string;
  createdAt: string;
  createdByAgentId: string | null;
  createdByUserId: string | null;
}

export interface PublicShareActor {
  kind: "agent" | "user";
  name: string;
  iconUrl: string | null;
}

export interface PublicShareAttachment {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  url: string;
}

export type PublicIssueComment =
  | {
      id: string;
      kind: "comment";
      author: PublicShareActor;
      body: string;
      attachments: PublicShareAttachment[];
      createdAt: string;
    }
  | {
      id: string;
      kind: "redacted";
      author: PublicShareActor;
      createdAt: string;
    };

export interface PublicShareDocument {
  key: string;
  title: string | null;
  body: string;
  updatedAt: string;
  pdfUrl: string;
}

export interface PublicShareWorkProduct {
  id: string;
  type: string;
  title: string;
  status: string;
  url: string | null;
  downloadUrl: string | null;
}

export interface PublicIssueRelatedIssue {
  id: string;
  identifier: string | null;
  title: string;
  status: IssueStatus;
  relation: "parent" | "child" | "blocked_by" | "blocks";
  navigable: boolean;
}

export interface PublicIssueShareView {
  company: { name: string; logoUrl: string | null };
  issue: {
    id: string;
    identifier: string | null;
    title: string;
    description: string | null;
    status: IssueStatus;
    priority: IssuePriority;
    projectName: string | null;
    assignee: PublicShareActor | null;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
  };
  isSharedRoot: boolean;
  activeRun: { agentName: string; startedAt: string } | null;
  related: PublicIssueRelatedIssue[];
  comments: PublicIssueComment[];
  documents: PublicShareDocument[];
  attachments: PublicShareAttachment[];
  workProducts: PublicShareWorkProduct[];
}
