import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PixelsOfficeSeatAssignment } from "@tickernelz/paperclip-pro-shared";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";
import { useToastActions } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { pixelsOfficeApi } from "../api/pixelsOffice";
import { heartbeatsApi } from "../api/heartbeats";
import { issuesApi } from "../api/issues";
import { accessApi } from "../api/access";
import { PixelsOfficeCanvas } from "../components/PixelsOfficeCanvas";
import { PageSkeleton } from "../components/PageSkeleton";
import { AgentPanel } from "../components/pixels-office/AgentPanel";
import { ObjectPanel } from "../components/pixels-office/ObjectPanel";
import { OfficeHud } from "../components/pixels-office/OfficeHud";
import { OfficeMinimap } from "../components/pixels-office/OfficeMinimap";
import { TimelineScrubber } from "../components/pixels-office/TimelineScrubber";
import { AMBIENT_SOUND_STORAGE_KEY } from "../components/pixels-office/constants";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getOfficeLiveStore, canBoardAssignIssues, type TickerEntry } from "@/lib/pixels-office/live";
import type { AgentVisual, OfficeController, OfficeObjectKind } from "@/lib/pixels-office/officeModel";
import { setAmbientEnabled } from "@/lib/pixels-office/audio";

const SNAPSHOT_REFETCH_DEBOUNCE_MS = 2000;

function seatKey(assignments: readonly PixelsOfficeSeatAssignment[]): string {
  return assignments
    .map((entry) => `${entry.agentId}:${entry.characterIndex}:${entry.seatId}`)
    .sort()
    .join("|");
}

interface OfficeRoomAnchor {
  id: string;
  label: string;
  centerX: number;
  centerY: number;
}

type OfficeControllerWithRooms = OfficeController & { rooms?: readonly OfficeRoomAnchor[] };

type OfficeSelection =
  | { kind: "agent"; agentId: string }
  | { kind: "object"; object: OfficeObjectKind }
  | null;

function readAmbientPreference(): boolean {
  try {
    return localStorage.getItem(AMBIENT_SOUND_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function PixelsOffice() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToastActions();
  const queryClient = useQueryClient();

  const [selection, setSelection] = useState<OfficeSelection>(null);
  const [visuals, setVisuals] = useState<readonly AgentVisual[]>([]);
  const [ticker, setTicker] = useState<readonly TickerEntry[]>([]);
  const [office, setOffice] = useState<OfficeController | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [ambient, setAmbient] = useState(readAmbientPreference);
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastPersistedRef = useRef<string | null>(null);

  const store = useMemo(
    () => getOfficeLiveStore(selectedCompanyId ?? "__none__"),
    [selectedCompanyId],
  );

  useEffect(() => {
    setBreadcrumbs([{ label: "Pixels Office" }]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    setAmbientEnabled(ambient);
    try {
      localStorage.setItem(AMBIENT_SOUND_STORAGE_KEY, ambient ? "on" : "off");
    } catch {
      return;
    }
  }, [ambient]);

  useEffect(() => () => setAmbientEnabled(false), []);

  const snapshotQuery = useQuery({
    queryKey: queryKeys.pixelsOffice.snapshot(selectedCompanyId ?? ""),
    queryFn: () => pixelsOfficeApi.snapshot(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const liveRunsQuery = useQuery({
    queryKey: queryKeys.liveRuns(selectedCompanyId ?? ""),
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!, { limit: 50 }),
    enabled: !!selectedCompanyId,
  });

  const { data: boardAccess } = useQuery({
    queryKey: queryKeys.access.currentBoardAccess,
    queryFn: () => accessApi.getCurrentBoardAccess(),
    retry: false,
  });
  const canAssign = canBoardAssignIssues(selectedCompanyId, boardAccess);

  const snapshot = snapshotQuery.data;

  useEffect(() => {
    if (!snapshot) return;
    store.seedSnapshot(snapshot);
    setVisuals(store.getVisuals());
  }, [snapshot, store]);

  useEffect(() => {
    if (!liveRunsQuery.data) return;
    store.seedLiveRuns(liveRunsQuery.data);
    setVisuals(store.getVisuals());
  }, [liveRunsQuery.data, store]);

  const scheduleRefetch = useCallback(() => {
    if (refetchTimerRef.current !== undefined) return;
    refetchTimerRef.current = setTimeout(() => {
      refetchTimerRef.current = undefined;
      if (typeof document !== "undefined" && document.hidden) return;
      void queryClient.invalidateQueries({
        queryKey: queryKeys.pixelsOffice.snapshot(selectedCompanyId ?? ""),
      });
    }, SNAPSHOT_REFETCH_DEBOUNCE_MS);
  }, [queryClient, selectedCompanyId]);

  useEffect(() => () => clearTimeout(refetchTimerRef.current), []);

  useEffect(() => {
    if (!office || !snapshot || !canAssign || replaying) return;
    const placements = office.readPlacements();
    const next = seatKey(placements);
    if (next === seatKey(snapshot.assignments) || next === lastPersistedRef.current) return;
    lastPersistedRef.current = next;
    void pixelsOfficeApi
      .replaceSeats(snapshot.companyId, placements)
      .then(() => scheduleRefetch())
      .catch(() => undefined);
  }, [canAssign, office, replaying, scheduleRefetch, snapshot, visuals]);

  useEffect(
    () =>
      store.subscribe((summary) => {
        if (summary.visualsChanged) setVisuals(summary.visuals);
        if (summary.tickerChanged) setTicker(summary.ticker.slice());
        if (summary.refetch) scheduleRefetch();
      }),
    [scheduleRefetch, store],
  );

  useCompanyLiveEvent(
    useCallback((event) => store.push(event), [store]),
  );

  useEffect(() => {
    const onKeyDown = (domEvent: KeyboardEvent) => {
      const target = domEvent.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
        return;
      }
      if (domEvent.key === "Escape") {
        setSelection(null);
        office?.select(null);
        return;
      }
      if (domEvent.key.toLowerCase() !== "f" || !office) return;
      const followed = office.camera.followAgentId;
      office.follow(followed ? null : office.selectedAgentId);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [office]);

  const assign = useMutation({
    mutationFn: (input: { issueId: string; agentId: string; previous: string | null }) =>
      issuesApi.update(input.issueId, { assigneeAgentId: input.agentId }),
    onSuccess: (_updated, input) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pixelsOffice.unassigned(selectedCompanyId ?? "") });
      scheduleRefetch();
      pushToast({
        title: "Task assigned",
        tone: "success",
        action: {
          label: "Undo",
          onClick: () => {
            void issuesApi
              .update(input.issueId, { assigneeAgentId: input.previous })
              .then(() => {
                void queryClient.invalidateQueries({
                  queryKey: queryKeys.pixelsOffice.unassigned(selectedCompanyId ?? ""),
                });
                scheduleRefetch();
              });
          },
        },
      });
    },
    onError: (cause: unknown) => {
      pushToast({
        title: "Could not assign the task",
        body: cause instanceof Error ? cause.message : String(cause),
        tone: "error",
      });
    },
  });

  const handleAssignIssue = useCallback(
    (issueId: string, agentId: string) => {
      if (!canAssign) return;
      assign.mutate({ issueId, agentId, previous: null });
    },
    [assign, canAssign],
  );

  const handleSelectAgent = useCallback((agentId: string) => {
    setSelection({ kind: "agent", agentId });
  }, []);

  const handleSelectObject = useCallback((object: OfficeObjectKind) => {
    setSelection({ kind: "object", object });
  }, []);

  const assignments = useMemo<readonly PixelsOfficeSeatAssignment[]>(
    () => snapshot?.assignments ?? [],
    [snapshot],
  );

  const selectedAgent = useMemo(
    () =>
      selection?.kind === "agent"
        ? (snapshot?.agents.find((agent) => agent.id === selection.agentId) ?? null)
        : null,
    [selection, snapshot],
  );

  const selectedVisual = useMemo(
    () =>
      selection?.kind === "agent"
        ? (visuals.find((visual) => visual.agentId === selection.agentId) ?? null)
        : null,
    [selection, visuals],
  );

  const rooms = useMemo<readonly OfficeRoomAnchor[]>(
    () => (office as OfficeControllerWithRooms | null)?.rooms ?? [],
    [office],
  );

  const jumpToObject = useCallback(
    (object: OfficeObjectKind) => {
      setSelection({ kind: "object", object });
      const anchor = office?.objectAnchor(object);
      if (anchor) office?.centerOn(anchor.x, anchor.y);
    },
    [office],
  );

  if (!selectedCompanyId) {
    return <div className="p-6 text-sm text-muted-foreground">Select a company to view the office.</div>;
  }

  if (snapshotQuery.isLoading) return <PageSkeleton />;

  if (snapshotQuery.isError) {
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm text-muted-foreground">
          {snapshotQuery.error instanceof Error
            ? snapshotQuery.error.message
            : "Could not load the office."}
        </p>
        <Button variant="outline" size="sm" onClick={() => void snapshotQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold text-foreground">Pixels Office</h1>
          <span className="text-xs text-muted-foreground">
            {visuals.length} agents{replaying ? " · replaying history" : ""}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {rooms.map((room) => (
            <Button
              key={room.id}
              size="sm"
              variant="ghost"
              onClick={() => office?.centerOn(room.centerX, room.centerY)}
            >
              {room.label}
            </Button>
          ))}
        </div>
      </div>

      <OfficeHud
        companyId={selectedCompanyId}
        ticker={ticker}
        canAssign={canAssign}
        ambientEnabled={ambient}
        onToggleAmbient={setAmbient}
        onOpenObject={jumpToObject}
      />

      <div className="flex min-h-0 flex-col gap-4 xl:flex-row">
        <Card className="relative min-w-0 flex-1 overflow-hidden p-0">
          <PixelsOfficeCanvas
            companyId={selectedCompanyId}
            visuals={visuals}
            assignments={assignments}
            store={store}
            onController={setOffice}
            onSelectAgent={handleSelectAgent}
            onSelectObject={handleSelectObject}
            onAssignIssue={handleAssignIssue}
          />
          <div className="absolute bottom-3 right-3">
            <OfficeMinimap office={office} />
          </div>
        </Card>

        {selection ? (
          <div className="w-full shrink-0 xl:w-(--sz-360px)">
            {selection.kind === "agent" && selectedAgent ? (
              <AgentPanel
                companyId={selectedCompanyId}
                agent={selectedAgent}
                visual={selectedVisual}
                onClose={() => setSelection(null)}
              />
            ) : null}
            {selection.kind === "object" ? (
              <ObjectPanel
                companyId={selectedCompanyId}
                object={selection.object}
                onClose={() => setSelection(null)}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <TimelineScrubber
          companyId={selectedCompanyId}
          store={store}
          onReplayingChange={setReplaying}
        />
      </div>
    </div>
  );
}
