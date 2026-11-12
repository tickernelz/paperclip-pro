import { useCallback } from "react";
import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { IssueRetryNowOutcome, IssueRetryNowResponse } from "@tickernelz/wardmote-shared";
import { ApiError } from "../api/client";
import { issuesApi } from "../api/issues";
import { useToastActions } from "../context/ToastContext";
import { getCachedIssueDetail, getIssueDetailCacheRefs } from "../lib/issueDetailCache";
import { queryKeys } from "../lib/queryKeys";

export type RetryNowError = {
  message: string;
  outcomeMessage: string | null;
  status: number | null;
};

function readErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (typeof error.message === "string" && error.message.trim().length > 0) return error.message;
    return `Request failed (${error.status})`;
  }
  if (error instanceof Error && error.message) return error.message;
  return "The request failed. Try again in a moment.";
}

export const RETRY_NOW_OUTCOME_HEADLINE: Record<IssueRetryNowOutcome, string> = {
  promoted: "Retry promoted",
  already_promoted: "Retry already running",
  waiting: "Retry waiting",
  no_scheduled_retry: "No scheduled retry",
  gate_suppressed: "Couldn't retry now",
  blocked: "Couldn't retry now",
};

function issueCacheRefs(queryClient: QueryClient, issueId: string): string[] {
  const cached = getCachedIssueDetail(queryClient, issueId);
  return [...new Set([issueId, ...(cached ? getIssueDetailCacheRefs(cached) : [])])];
}

export function useRetryNowMutation(
  issueId: string | null | undefined,
): UseMutationResult<IssueRetryNowResponse, unknown, void, unknown> & {
  lastError: RetryNowError | null;
} {
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();

  const mutation = useMutation({
    mutationFn: () => {
      if (!issueId) throw new Error("Missing issue id");
      return issuesApi.retryScheduledRetryNow(issueId);
    },
    onSuccess: (response) => {
      if (issueId) {
        for (const ref of issueCacheRefs(queryClient, issueId)) {
          queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(ref) });
          queryClient.invalidateQueries({ queryKey: queryKeys.issues.activity(ref) });
          queryClient.invalidateQueries({ queryKey: queryKeys.issues.runs(ref) });
          queryClient.invalidateQueries({ queryKey: queryKeys.issues.liveRuns(ref) });
          queryClient.invalidateQueries({ queryKey: queryKeys.issues.activeRun(ref) });
        }
      }
      if (response.outcome === "promoted") {
        pushToast({
          title: RETRY_NOW_OUTCOME_HEADLINE.promoted,
          body: response.message,
          tone: "success",
        });
      } else if (response.outcome === "gate_suppressed" || response.outcome === "blocked") {
        pushToast({
          title: RETRY_NOW_OUTCOME_HEADLINE[response.outcome],
          body: response.message,
          tone: "error",
        });
      }
    },
    onError: (error) => {
      pushToast({
        title: "Couldn't retry now",
        body: readErrorMessage(error),
        tone: "error",
      });
    },
  });

  const reset = mutation.reset;
  const wrappedReset = useCallback(() => reset(), [reset]);

  const lastError: RetryNowError | null = (() => {
    if (mutation.error) {
      const apiError = mutation.error instanceof ApiError ? mutation.error : null;
      return {
        message: readErrorMessage(mutation.error),
        outcomeMessage: null,
        status: apiError?.status ?? null,
      };
    }
    if (mutation.data && (mutation.data.outcome === "gate_suppressed" || mutation.data.outcome === "blocked")) {
      return {
        message: mutation.data.message,
        outcomeMessage: mutation.data.message,
        status: null,
      };
    }
    return null;
  })();

  return {
    ...mutation,
    reset: wrappedReset,
    lastError,
  } as UseMutationResult<IssueRetryNowResponse, unknown, void, unknown> & {
    lastError: RetryNowError | null;
  };
}
