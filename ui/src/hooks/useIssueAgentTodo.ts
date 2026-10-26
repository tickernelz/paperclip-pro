import { useQuery } from "@tanstack/react-query";
import type { AgentTodoSnapshot } from "@tickernelz/paperclip-pro-shared";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";

/** Latest agent todo snapshot for the issue; live run events patch the same cache entry. */
export function useIssueAgentTodo(issueId: string | null | undefined) {
  return useQuery<AgentTodoSnapshot | null>({
    queryKey: queryKeys.issues.agentTodo(issueId ?? ""),
    enabled: Boolean(issueId) && !issueId?.startsWith("chat:"),
    queryFn: async () => (await issuesApi.getAgentTodo(issueId!)).snapshot,
  });
}
