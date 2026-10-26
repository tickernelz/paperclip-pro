import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  localBrowserActivityEventSchema,
  type LocalBrowserSession,
} from "@tickernelz/paperclip-pro-shared";
import { authApi } from "@/api/auth";
import { localBrowserApi } from "@/api/local-browser";
import { Button } from "@/components/ui/button";
import { useCompanyLiveEvent } from "@/context/LiveUpdatesProvider";
import { queryKeys } from "@/lib/queryKeys";
import { LocalBrowserViewer } from "./LocalBrowserViewer";
import { useLocalBrowserFloatWindow } from "./use-local-browser-float-window";

interface Watch {
  sessionId: string;
  tabId: number;
}

interface SessionsData {
  sessions: LocalBrowserSession[];
}

function watchKey(watch: Watch): string {
  return watch.sessionId + ":" + watch.tabId;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function viewableBy(session: LocalBrowserSession, userId: string | null): boolean {
  return !session.ownerUserId || session.ownerUserId === userId;
}

function operatedWatch(sessions: LocalBrowserSession[], userId: string | null): Watch | null {
  for (const session of sessions) {
    const activity = session.agentActivity;
    if (!activity || activity.state !== "operating" || activity.tabId === null) continue;
    if (!viewableBy(session, userId)) continue;
    if (!session.tabs.some((tab) => tab.tabId === activity.tabId)) continue;
    return { sessionId: session.sessionId, tabId: activity.tabId };
  }
  return null;
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}

export function LocalBrowserFloatHost({ companyId }: { companyId: string | null | undefined }) {
  const queryClient = useQueryClient();
  const sessionsKey = useMemo(() => ["local-browser-sessions", companyId] as const, [companyId]);
  const [watch, setWatch] = useState<Watch | null>(null);
  const watchRef = useRef<Watch | null>(null);
  watchRef.current = watch;
  const dismissedRef = useRef<string | null>(null);
  const floatRequestedRef = useRef(false);
  const documentVisible = useDocumentVisible();

  const authSession = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });
  const currentUserId = authSession.data?.user?.id ?? authSession.data?.session?.userId ?? null;
  const currentUserIdRef = useRef<string | null>(currentUserId);
  currentUserIdRef.current = currentUserId;

  const dismiss = useCallback(() => {
    if (watchRef.current) dismissedRef.current = watchKey(watchRef.current);
    setWatch(null);
  }, []);
  const float = useLocalBrowserFloatWindow(dismiss);
  const { open: openFloat, close: closeFloat } = float;

  const sessions = useQuery({
    queryKey: sessionsKey,
    queryFn: () => localBrowserApi.sessions(companyId as string),
    enabled: Boolean(companyId),
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (watch || !sessions.data) return;
    const found = operatedWatch(sessions.data.sessions, currentUserId);
    if (!found || dismissedRef.current === watchKey(found)) return;
    dismissedRef.current = null;
    setWatch(found);
  }, [sessions.data, watch, currentUserId]);

  useCompanyLiveEvent(
    useCallback(
      (event) => {
        if (event.type !== "local_browser.activity") return;
        const parsed = localBrowserActivityEventSchema.safeParse(event.payload);
        if (!parsed.success) return;
        const { sessionId, state, tabId, at } = parsed.data;
        if (state === "closed") {
          dismissedRef.current = null;
          setWatch((current) => (current && current.sessionId === sessionId ? null : current));
          void queryClient.invalidateQueries({ queryKey: sessionsKey });
          return;
        }
        const target = queryClient.getQueryData<SessionsData>(sessionsKey)?.sessions.find((entry) => entry.sessionId === sessionId);
        if (!target || (tabId !== null && !target.tabs.some((tab) => tab.tabId === tabId))) {
          void queryClient.invalidateQueries({ queryKey: sessionsKey });
        }
        if (!target) return;
        queryClient.setQueryData<SessionsData>(sessionsKey, (current) =>
          current
            ? {
                ...current,
                sessions: current.sessions.map((entry) =>
                  entry.sessionId === sessionId ? { ...entry, agentActivity: { state, tabId, at } } : entry,
                ),
              }
            : current,
        );
        if (tabId === null || !viewableBy(target, currentUserIdRef.current)) return;
        const next = { sessionId, tabId };
        if (dismissedRef.current === watchKey(next)) return;
        dismissedRef.current = null;
        setWatch((current) => (current && watchKey(current) === watchKey(next) ? current : next));
      },
      [queryClient, sessionsKey],
    ),
  );

  useEffect(() => {
    if (watch) return;
    floatRequestedRef.current = false;
    closeFloat();
  }, [watch, closeFloat]);

  useEffect(() => {
    if (!watch || floatRequestedRef.current) return;
    floatRequestedRef.current = true;
    if (typeof navigator !== "undefined" && navigator.userActivation?.isActive) void openFloat();
  }, [watch, openFloat]);

  const tabTitle = useMemo(() => {
    if (!watch) return "";
    const session = sessions.data?.sessions.find((entry) => entry.sessionId === watch.sessionId);
    const tab = session?.tabs.find((entry) => entry.tabId === watch.tabId);
    if (!tab) return "Browser tab";
    return tab.title || hostOf(tab.url);
  }, [sessions.data, watch]);

  if (!watch) return null;

  const viewer =
    float.target || documentVisible ? (
      <LocalBrowserViewer sessionId={watch.sessionId} companyId={companyId ?? undefined} tabId={watch.tabId} />
    ) : null;

  if (float.target) {
    return createPortal(
      <div className="flex min-h-screen flex-col gap-2 bg-background p-3 text-foreground" data-testid="local-browser-float-window">
        <p className="truncate text-xs font-medium text-muted-foreground">{tabTitle}</p>
        {viewer}
      </div>,
      float.target.container,
    );
  }

  return (
    <aside
      aria-label="Agent browser"
      data-testid="local-browser-float-panel"
      className="fixed bottom-4 right-4 z-50 flex w-(--sz-22rem) max-w-(--sz-calc-4) flex-col gap-2 rounded-lg border bg-background p-3 shadow-xl"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-medium">{tabTitle}</p>
        <div className="flex shrink-0 gap-1">
          <Button type="button" size="sm" variant="outline" onClick={() => void openFloat()}>
            Pop out
          </Button>
          <Button type="button" size="sm" variant="ghost" aria-label="Close agent browser" onClick={dismiss}>
            Close
          </Button>
        </div>
      </div>
      {viewer}
    </aside>
  );
}
