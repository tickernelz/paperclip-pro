import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pause, Play, Radio } from "lucide-react";
import {
  PIXELS_OFFICE_TIMELINE_MAX_WINDOW_MS,
  type PixelsOfficeTimelineEvent,
} from "@tickernelz/paperclip-pro-shared";
import { Button } from "@/components/ui/button";
import { pixelsOfficeApi } from "@/api/pixelsOffice";
import { queryKeys } from "@/lib/queryKeys";
import { usePageVisibility } from "@/lib/page-visibility";
import type { OfficeLiveStore } from "@/lib/pixels-office/live";

const SPEEDS = [1, 10, 60] as const;
const TICK_MS = 250;
const WINDOW_BUCKET_MS = 5 * 60_000;

interface TimelineScrubberProps {
  companyId: string;
  store: OfficeLiveStore;
  onReplayingChange: (replaying: boolean) => void;
}

export function TimelineScrubber({ companyId, store, onReplayingChange }: TimelineScrubberProps) {
  const visibility = usePageVisibility();
  const [replaying, setReplaying] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(10);
  const [cursorMs, setCursorMs] = useState(0);
  const appliedRef = useRef(0);

  const range = useMemo(() => {
    const to = Math.ceil(Date.now() / WINDOW_BUCKET_MS) * WINDOW_BUCKET_MS;
    return { fromMs: to - PIXELS_OFFICE_TIMELINE_MAX_WINDOW_MS, toMs: to };
  }, []);

  const { data, isFetching, error } = useQuery({
    queryKey: queryKeys.pixelsOffice.timeline(
      companyId,
      new Date(range.fromMs).toISOString(),
      new Date(range.toMs).toISOString(),
    ),
    queryFn: () =>
      pixelsOfficeApi.timeline(companyId, {
        from: new Date(range.fromMs).toISOString(),
        to: new Date(range.toMs).toISOString(),
      }),
    enabled: replaying,
    staleTime: WINDOW_BUCKET_MS,
  });

  const events = useMemo<PixelsOfficeTimelineEvent[]>(() => data?.events ?? [], [data]);

  const applyUpTo = useCallback(
    (targetMs: number, reset: boolean) => {
      if (reset) appliedRef.current = 0;
      const batch: PixelsOfficeTimelineEvent[] = [];
      while (appliedRef.current < events.length) {
        const event = events[appliedRef.current];
        if (!event || Date.parse(event.at) > targetMs) break;
        batch.push(event);
        appliedRef.current += 1;
      }
      if (batch.length === 0 && !reset) return;
      store.applyTimelineFrame(batch, reset);
    },
    [events, store],
  );

  const enterReplay = useCallback(() => {
    store.startReplay();
    appliedRef.current = 0;
    setCursorMs(range.fromMs);
    setReplaying(true);
    setPlaying(true);
    onReplayingChange(true);
  }, [onReplayingChange, store, range.fromMs]);

  const returnToLive = useCallback(() => {
    setPlaying(false);
    setReplaying(false);
    appliedRef.current = 0;
    store.stopReplay();
    onReplayingChange(false);
  }, [onReplayingChange, store]);

  useEffect(() => {
    if (!replaying || !playing || !visibility.visible || events.length === 0) return;
    const timer = setInterval(() => {
      setCursorMs((current) => {
        const next = current + TICK_MS * speed;
        if (next >= range.toMs) {
          setPlaying(false);
          return range.toMs;
        }
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [events.length, playing, replaying, speed, visibility.visible, range.toMs]);

  useEffect(() => {
    if (!replaying || events.length === 0) return;
    applyUpTo(cursorMs, false);
  }, [applyUpTo, cursorMs, events.length, replaying]);

  useEffect(() => () => {
    if (store.isReplaying()) store.stopReplay();
  }, [store]);

  if (!replaying) {
    return (
      <Button size="sm" variant="outline" onClick={enterReplay}>
        <Play className="size-4" aria-hidden />
        Replay last 24 h
      </Button>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <Button size="sm" variant="ghost" onClick={() => setPlaying((value) => !value)}>
        {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
        {playing ? "Pause" : "Play"}
      </Button>
      <input
        type="range"
        aria-label="Replay position"
        min={range.fromMs}
        max={range.toMs}
        step={60_000}
        value={cursorMs}
        onChange={(domEvent) => {
          const next = Number(domEvent.target.value);
          const backwards = next < cursorMs;
          setCursorMs(next);
          applyUpTo(next, backwards);
        }}
        className="min-w-0 flex-1"
      />
      <span className="shrink-0 font-mono text-xs text-muted-foreground">
        {new Date(cursorMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </span>
      <div className="flex items-center gap-1">
        {SPEEDS.map((option) => (
          <Button
            key={option}
            size="sm"
            variant={speed === option ? "secondary" : "ghost"}
            onClick={() => setSpeed(option)}
          >
            {option}x
          </Button>
        ))}
      </div>
      <Button size="sm" variant="default" onClick={returnToLive}>
        <Radio className="size-4" aria-hidden />
        Live
      </Button>
      {isFetching ? <span className="text-xs text-muted-foreground">Loading history…</span> : null}
      {error ? (
        <span className="text-xs text-destructive">
          {error instanceof Error ? error.message : "Timeline unavailable"}
        </span>
      ) : null}
    </div>
  );
}
