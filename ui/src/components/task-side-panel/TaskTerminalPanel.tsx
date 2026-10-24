import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SquareTerminal } from "lucide-react";
import type { Issue, TerminalSession } from "@tickernelz/paperclip-pro-shared";
import { terminalApi, terminalQueryKeys } from "@/api/terminal";
import { TerminalView } from "@/components/terminal/TerminalView";
import { terminalAccessErrorMessage } from "@/components/terminal/terminal-access";
import { Button } from "@/components/ui/button";

export function findTaskTerminalSession(
  sessions: TerminalSession[] | undefined,
  issueId: string,
  unavailableIds: ReadonlySet<string> = new Set(),
): TerminalSession | null {
  return (sessions ?? [])
    .filter((session) =>
      session.issueId === issueId
      && session.kind === "local"
      && session.status === "running"
      && !unavailableIds.has(session.id))
    .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt))[0] ?? null;
}

export function TaskTerminalPanel({ issue, active }: { issue: Pick<Issue, "id" | "companyId" | "identifier" | "title">; active: boolean }) {
  const queryClient = useQueryClient();
  const sessionsKey = useMemo(() => terminalQueryKeys.sessions(issue.companyId), [issue.companyId]);
  const sessionsQuery = useQuery({
    queryKey: sessionsKey,
    queryFn: () => terminalApi.list(issue.companyId),
    refetchOnMount: "always",
  });
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const creatingRef = useRef(false);
  const unavailableIdsRef = useRef(new Set<string>());

  const startSession = useCallback(async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreateError(null);
    try {
      const session = await terminalApi.create(issue.companyId, {
        kind: "local",
        issueId: issue.id,
        title: issue.identifier ?? issue.title,
      });
      queryClient.setQueryData<TerminalSession[]>(sessionsKey, (current = []) => [
        ...current.filter((entry) => entry.id !== session.id),
        session,
      ]);
      setEnded(false);
      setSessionId(session.id);
    } catch (error) {
      setCreateError(terminalAccessErrorMessage(error, "Could not open a terminal for this task."));
    } finally {
      creatingRef.current = false;
    }
  }, [issue.companyId, issue.id, issue.identifier, issue.title, queryClient, sessionsKey]);

  const freshSessions = sessionsQuery.isSuccess && sessionsQuery.isFetchedAfterMount && !sessionsQuery.isFetching;

  useEffect(() => {
    if (sessionId || ended || createError || !freshSessions) return;
    const existing = findTaskTerminalSession(sessionsQuery.data, issue.id, unavailableIdsRef.current);
    if (existing) setSessionId(existing.id);
    else void startSession();
  }, [createError, ended, freshSessions, issue.id, sessionId, sessionsQuery.data, startSession]);

  const releaseUnavailableSession = useCallback(() => {
    setSessionId((current) => {
      if (current) unavailableIdsRef.current.add(current);
      return null;
    });
    void queryClient.invalidateQueries({ queryKey: sessionsKey });
  }, [queryClient, sessionsKey]);

  const error = sessionsQuery.isError
    ? terminalAccessErrorMessage(sessionsQuery.error, "Terminal sessions could not be loaded.")
    : createError;

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center" data-testid="task-terminal-error">
        <SquareTerminal className="size-6 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium text-foreground">Terminal unavailable</p>
        <p className="max-w-md text-sm text-muted-foreground">{error}</p>
        {createError ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void startSession()}>
            Try again
          </Button>
        ) : null}
      </div>
    );
  }

  if (!sessionId) {
    return <p className="p-4 text-sm text-muted-foreground">Opening a terminal in the task workspace…</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TerminalView
        key={sessionId}
        companyId={issue.companyId}
        sessionId={sessionId}
        active={active}
        onExit={() => setEnded(true)}
        onUnavailable={releaseUnavailableSession}
      />
      {ended ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <span>The shell for this task has ended.</span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => {
              setSessionId(null);
              void startSession();
            }}
          >
            New terminal
          </Button>
        </div>
      ) : null}
    </div>
  );
}
