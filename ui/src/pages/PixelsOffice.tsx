import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { pixelsOfficeApi } from "../api/pixelsOffice";
import {
  PixelsOfficeCanvas,
  type PixelsOfficeCamera,
  type PixelsOfficeCanvasHandle,
} from "../components/PixelsOfficeCanvas";
import { PageSkeleton } from "../components/PageSkeleton";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LiveEventType, PixelsOfficeAgent } from "@tickernelz/paperclip-pro-shared";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";

const CAMERAS: Array<{ id: PixelsOfficeCamera; label: string }> = [
  { id: "office", label: "Office" },
  { id: "boardroomKitchen", label: "Boardroom" },
  { id: "overflowOffice", label: "Overflow" },
];

const PIXELS_OFFICE_EVENT_TYPES: ReadonlySet<LiveEventType> = new Set<LiveEventType>([
  "heartbeat.run.queued",
  "heartbeat.run.status",
  "agent.status",
  "activity.logged",
]);

export function PixelsOffice() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [camera, setCamera] = useState<PixelsOfficeCamera>("office");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const canvasHandleRef = useRef<PixelsOfficeCanvasHandle | null>(null);

  const handleCanvasReady = useCallback((handle: PixelsOfficeCanvasHandle) => {
    canvasHandleRef.current = handle;
  }, []);

  useEffect(() => {
    setBreadcrumbs([{ label: "Pixels Office" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.pixelsOffice.snapshot(selectedCompanyId ?? ""),
    queryFn: () => pixelsOfficeApi.snapshot(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  useCompanyLiveEvent((event) => {
    if (!PIXELS_OFFICE_EVENT_TYPES.has(event.type)) return;
    if (event.type === "heartbeat.run.queued") {
      const agentId = event.payload.agentId;
      if (typeof agentId === "string") canvasHandleRef.current?.showWaitingBubble(agentId);
    }
    void refetch();
  });

  const seatAssignments = useMemo(() => {
    const map: Record<string, number> = {};
    for (const agent of data?.agents ?? []) {
      map[agent.id] = agent.activeTaskCount;
    }
    return map;
  }, [data]);

  const selectedAgent = useMemo(
    () => data?.agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [data, selectedAgentId],
  );

  const totalActive = useMemo(
    () => (data?.agents ?? []).reduce((sum, agent) => sum + agent.activeTaskCount, 0),
    [data],
  );

  if (!selectedCompanyId) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Select a company to view the office.</div>
    );
  }

  if (isLoading) return <PageSkeleton />;

  if (isError) {
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm text-muted-foreground">
          {error instanceof Error ? error.message : "Could not load the office."}
        </p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
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
            {data?.agents.length ?? 0} agents · {totalActive} tasks in flight
          </span>
        </div>
        <div className="flex items-center gap-2">
          {CAMERAS.map((entry) => (
            <Button
              key={entry.id}
              size="sm"
              variant={camera === entry.id ? "secondary" : "ghost"}
              onClick={() => setCamera(entry.id)}
            >
              {entry.label}
            </Button>
          ))}
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <PixelsOfficeCanvas
          agents={data?.agents ?? []}
          camera={camera}
          seatAssignments={seatAssignments}
          onReady={handleCanvasReady}
        />
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(data?.agents ?? []).map((agent) => (
          <Card
            key={agent.id}
            className={
              selectedAgentId === agent.id
                ? "cursor-pointer border-primary p-3"
                : "cursor-pointer p-3"
            }
            onClick={() => setSelectedAgentId(agent.id === selectedAgentId ? null : agent.id)}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-foreground">{agent.name}</span>
              <Badge variant={agent.activeRunId ? "default" : "outline"}>
                {agent.activeRunId ? "running" : agent.status}
              </Badge>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {agent.activeTaskCount} active · {agent.tasks.length} open · cap {agent.maxConcurrentRuns}
            </div>
            {selectedAgent?.id === agent.id && agent.tasks.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {agent.tasks.map((task) => (
                  <li key={task.issueId} className="flex items-center gap-2 text-xs">
                    <span className="font-mono text-muted-foreground">{task.identifier}</span>
                    <span className="truncate text-foreground">{task.title}</span>
                    {task.active ? <Badge variant="secondary">live</Badge> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        ))}
      </div>
    </div>
  );
}
