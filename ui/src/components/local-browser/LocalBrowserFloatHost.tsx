import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  localBrowserActivityEventSchema,
  type LocalBrowserSession,
} from "@tickernelz/paperclip-pro-shared";
import { localBrowserApi } from "@/api/local-browser";
import { Button } from "@/components/ui/button";
import { useCompanyLiveEvent } from "@/context/LiveUpdatesProvider";
import { LocalBrowserViewer } from "./LocalBrowserViewer";
import { useLocalBrowserFloatWindow } from "./use-local-browser-float-window";

export const LOCAL_BROWSER_FLOAT_IDLE_LINGER_MS = 20_000;

interface Watch {
  sessionId: string;
  tabId: number;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function operatedWatch(sessions: LocalBrowserSession[]): Watch | null {
  for (const session of sessions) {
    const activity = session.agentActivity;
    if (!activity || activity.state !== "operating" || activity.tabId === null) continue;
    if (!session.tabs.some((tab) => tab.tabId === activity.tabId)) continue;
    return { sessionId: session.sessionId, tabId: activity.tabId };
  }
  return null;
}

export function LocalBrowserFloatHost({ companyId }: { companyId: string | null | undefined }) {
  const queryClient = useQueryClient();
  const [watch, setWatch] = useState<Watch | null>(null);
  const [operating, setOperating] = useState(false);
  const [controlled, setControlled] = useState(false);
  const dismissedRef = useRef(false);
  const floatRequestedRef = useRef(false);

  const handleFloatClosed = useCallback(() => {
    dismissedRef.current = true;
    setWatch(null);
  }, []);
  const float = useLocalBrowserFloatWindow(handleFloatClosed);
  const { open: openFloat, close: closeFloat } = float;

  const sessions = useQuery({
    queryKey: ["local-browser-sessions", companyId],
    queryFn: () => localBrowserApi.sessions(companyId as string),
    enabled: Boolean(companyId),
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (watch || dismissedRef.current || !sessions.data) return;
    const found = operatedWatch(sessions.data.sessions);
    if (found) {
      setWatch(found);
      setOperating(true);
    }
  }, [sessions.data, watch]);

  useCompanyLiveEvent(
    useCallback(
      (event) => {
        if (event.type !== "local_browser.activity") return;
        const parsed = localBrowserActivityEventSchema.safeParse(event.payload);
        if (!parsed.success) return;
        const { sessionId, state, tabId } = parsed.data;
        void queryClient.invalidateQueries({ queryKey: ["local-browser-sessions", companyId] });
        if (state === "closed") {
          setWatch((current) => (current && current.sessionId === sessionId ? null : current));
          dismissedRef.current = false;
          return;
        }
        if (state === "idle") {
          dismissedRef.current = false;
          setOperating(false);
        } else {
          setOperating(true);
        }
        if (tabId === null || dismissedRef.current) return;
        setWatch((current) =>
          current && current.sessionId === sessionId && current.tabId === tabId ? current : { sessionId, tabId },
        );
      },
      [companyId, queryClient],
    ),
  );

  useEffect(() => {
    if (!watch || operating || controlled) return;
    const timer = setTimeout(() => setWatch(null), LOCAL_BROWSER_FLOAT_IDLE_LINGER_MS);
    return () => clearTimeout(timer);
  }, [watch, operating, controlled]);

  useEffect(() => {
    if (watch) return;
    floatRequestedRef.current = false;
    closeFloat();
    setControlled(false);
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

  const dismiss = useCallback(() => {
    dismissedRef.current = true;
    setWatch(null);
  }, []);

  if (!watch) return null;

  const viewer = (
    <LocalBrowserViewer
      sessionId={watch.sessionId}
      companyId={companyId ?? undefined}
      tabId={watch.tabId}
      onControlledChange={setControlled}
    />
  );

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
      className="fixed bottom-4 right-4 z-50 flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-lg border bg-background p-3 shadow-xl"
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
