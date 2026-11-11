import type { IssueCreationSource } from "@tickernelz/wardmote-shared";
import { GitBranch } from "lucide-react";
import {
  createIssueDetailPath,
  rememberIssueDetailLocationState,
} from "@/lib/issueDetailBreadcrumb";
import { Link } from "@/lib/router";
import { cn } from "@/lib/utils";

export interface IssueCreatedFromNoteProps {
  /** Access-checked creation provenance from the issue detail response. */
  createdFrom: IssueCreationSource | null | undefined;
  issueLinkState?: unknown;
  className?: string;
}

export function IssueCreatedFromNote({ createdFrom, issueLinkState, className }: IssueCreatedFromNoteProps) {
  if (!createdFrom) return null;
  const { issue, agent } = createdFrom;
  const ref = issue.identifier ?? issue.id;
  return (
    <p
      data-testid="issue-created-from"
      className={cn("flex min-w-0 items-center gap-1 text-xs text-ink-3", className)}
    >
      <GitBranch aria-hidden className="h-3 w-3 shrink-0" />
      <span className="shrink-0">Created from</span>
      <Link
        to={createIssueDetailPath(ref)}
        state={issueLinkState}
        onClickCapture={() => rememberIssueDetailLocationState(ref, issueLinkState)}
        className="min-w-0 truncate hover:text-ink transition-colors"
        title={issue.title}
      >
        {issue.identifier ? `${issue.identifier} ${issue.title}` : issue.title}
      </Link>
      {agent && <span className="shrink-0">by {agent.name}</span>}
    </p>
  );
}
