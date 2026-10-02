import { useQuery } from "@tanstack/react-query";
import { GripVertical } from "lucide-react";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";
import { ISSUE_DRAG_MIME } from "./constants";

const TRAY_STATUSES: Record<string, true> = { todo: true, backlog: true };
const TRAY_LIMIT = 20;

interface UnassignedTrayProps {
  companyId: string;
  canAssign: boolean;
  armedIssueId: string | null;
  onArmIssue: (issueId: string | null) => void;
}

export function UnassignedTray({ companyId, canAssign, armedIssueId, onArmIssue }: UnassignedTrayProps) {
  const { data } = useQuery({
    queryKey: queryKeys.pixelsOffice.unassigned(companyId),
    queryFn: () => issuesApi.listCompact(companyId, { limit: 200, sortField: "updated", sortDir: "desc" }),
    enabled: canAssign,
  });

  if (!canAssign) return null;

  const issues = (data ?? [])
    .filter(
      (issue) =>
        TRAY_STATUSES[issue.status] && !issue.assigneeAgentId && !issue.assigneeUserId,
    )
    .slice(0, TRAY_LIMIT);

  return (
    <div className="flex w-full min-w-0 flex-col gap-1 md:w-auto md:max-w-full">
      <span className="text-xs font-semibold uppercase tracking-(--tracking-eyebrow) text-muted-foreground">
        Unassigned · {issues.length}
      </span>
      {issues.length === 0 ? (
        <span className="text-xs text-muted-foreground">Everything has an owner.</span>
      ) : (
        <ul className="flex max-w-full gap-1 overflow-x-auto pb-1">
          {issues.map((issue) => (
            <li key={issue.id} className="shrink-0">
              <div
                draggable
                role="button"
                tabIndex={0}
                title={issue.title}
                aria-pressed={armedIssueId === issue.id}
                data-issue-id={issue.id}
                onClick={() => onArmIssue(armedIssueId === issue.id ? null : issue.id)}
                onKeyDown={(domEvent) => {
                  if (domEvent.key !== "Enter" && domEvent.key !== " ") return;
                  domEvent.preventDefault();
                  onArmIssue(armedIssueId === issue.id ? null : issue.id);
                }}
                onDragStart={(domEvent) => {
                  domEvent.dataTransfer.effectAllowed = "move";
                  domEvent.dataTransfer.setData(ISSUE_DRAG_MIME, issue.id);
                  domEvent.dataTransfer.setData("text/plain", issue.identifier ?? issue.id);
                }}
                className={
                  armedIssueId === issue.id
                    ? "flex min-h-8 cursor-grab items-center gap-1 rounded-md border border-primary bg-primary/10 px-2 py-1 text-xs text-foreground active:cursor-grabbing"
                    : "flex min-h-8 cursor-grab items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground active:cursor-grabbing"
                }
              >
                <GripVertical className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                <span className="whitespace-nowrap font-mono text-muted-foreground">{issue.identifier ?? issue.id.slice(0, 8)}</span>
                <span className="max-w-(--sz-150px) truncate">{issue.title}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
