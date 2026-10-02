import { useEffect, useMemo, useRef, useState } from "react";
import type { PixelsOfficeAgent } from "@tickernelz/paperclip-pro-shared";
import { OfficeState } from "@/lib/pixels-office/engine/officeState";
import { startGameLoop } from "@/lib/pixels-office/engine/gameLoop";
import { renderFrame } from "@/lib/pixels-office/engine/renderer";
import { drawAgentLabels } from "@/lib/pixels-office/engine/agentLabels";
import { loadPixelAssets, type CameraBounds } from "@/lib/pixels-office/assetLoader";
import { TILE_SIZE } from "@/lib/pixels-office/types";
import { usePageVisibility } from "@/lib/page-visibility";

export type PixelsOfficeCamera = "office" | "boardroomKitchen" | "overflowOffice";

export type PixelsOfficeCanvasHandle = {
  showWaitingBubble: (agentId: string) => void;
};

type PixelsOfficeCanvasProps = {
  agents: PixelsOfficeAgent[];
  camera: PixelsOfficeCamera;
  seatAssignments: Record<string, number>;
  onReady?: (handle: PixelsOfficeCanvasHandle) => void;
};

export function PixelsOfficeCanvas({ agents, camera, seatAssignments, onReady }: PixelsOfficeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const officeRef = useRef<OfficeState | null>(null);
  const cameraBoundsRef = useRef<Record<PixelsOfficeCamera, CameraBounds> | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const visibility = usePageVisibility();

  const labelById = useMemo(
    () =>
      new Map(
        agents.map((agent) => [
          agent.id,
          agent.activeTaskCount > 1 ? `${agent.name} (${agent.activeTaskCount})` : agent.name,
        ]),
      ),
    [agents],
  );

  useEffect(() => {
    let cancelled = false;

    void loadPixelAssets()
      .then(({ layouts, cameraBounds }) => {
        if (cancelled) return;
        officeRef.current = new OfficeState(layouts.combined);
        cameraBoundsRef.current = cameraBounds;
        setReady(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const office = officeRef.current;
    if (!office || !ready) return;

    const incoming = new Set(agents.map((agent) => agent.id));
    for (const agent of agents) {
      office.addAgent(agent.id, seatAssignments[agent.id] ?? undefined);
      const character = office.characters.get(agent.id);
      if (!character) continue;
      const palette = seatAssignments[agent.id];
      if (palette !== undefined && character.palette !== palette) character.palette = palette;
      if (character.hueShift !== 0) character.hueShift = 0;
      const isWorking = agent.activeRunId !== null;
      if (character.isActive !== isWorking) office.setAgentActive(agent.id, isWorking);
      const nextTool = isWorking ? "Edit" : null;
      if (character.currentTool !== nextTool) office.setAgentTool(agent.id, nextTool);
    }
    for (const id of Array.from(office.characters.keys())) {
      if (!incoming.has(id)) office.removeAgent(id);
    }
  }, [agents, ready, seatAssignments]);

  useEffect(() => {
    const office = officeRef.current;
    if (!office || !ready) return;
    onReady?.({
      showWaitingBubble: (agentId: string) => {
        office.showWaitingBubble(agentId);
      },
    });
  }, [onReady, ready]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const office = officeRef.current;
    const cameraBounds = cameraBoundsRef.current;
    if (!canvas || !wrap || !office || !cameraBounds || !ready) return;
    if (!visibility.visible) return;

    const activeCanvas = canvas;
    const activeWrap = wrap;

    function resize() {
      const rect = activeWrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      activeCanvas.width = Math.max(1, Math.round(rect.width * dpr));
      activeCanvas.height = Math.max(1, Math.round(rect.height * dpr));
      activeCanvas.style.width = `${rect.width}px`;
      activeCanvas.style.height = `${rect.height}px`;
    }

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(activeWrap);

    const stop = startGameLoop(canvas, {
      update: (dt) => office.update(dt),
      render: (ctx) => {
        const layout = office.getLayout();
        const focus = cameraBounds[camera];
        const dpr = window.devicePixelRatio || 1;
        const fitZoom = Math.min(
          canvas.width / (focus.cols * TILE_SIZE),
          canvas.height / (focus.rows * TILE_SIZE),
        ) * 0.92;
        const zoom = Math.max(dpr, fitZoom);
        const mapCenterCol = layout.cols / 2;
        const mapCenterRow = layout.rows / 2;
        const focusCenterCol = focus.col + focus.cols / 2;
        const focusCenterRow = focus.row + focus.rows / 2;
        const panX = (mapCenterCol - focusCenterCol) * TILE_SIZE * zoom;
        const panY = (mapCenterRow - focusCenterRow) * TILE_SIZE * zoom;

        const { offsetX, offsetY } = renderFrame(
          ctx,
          canvas.width,
          canvas.height,
          office.tileMap,
          office.furniture,
          Array.from(office.characters.values()),
          zoom,
          panX,
          panY,
          {
            selectedAgentId: null,
            hoveredAgentId: null,
            hoveredTile: null,
            seats: office.seats,
            characters: office.characters,
          },
          undefined,
          layout.tileColors,
          layout.cols,
          layout.rows,
        );

        drawAgentLabels(ctx, office.characters.values(), labelById, offsetX, offsetY, zoom);
      },
    });

    return () => {
      observer.disconnect();
      stop();
    };
  }, [camera, labelById, ready, visibility.visible]);

  return (
    <div ref={wrapRef} className="relative h-(--sz-calc-44) min-h-(--sz-520px) w-full">
      {!ready ? (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted-foreground">
          {loadError ? `Office unavailable: ${loadError}` : "Loading office..."}
        </div>
      ) : null}
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        style={{ imageRendering: "pixelated" }}
      />
    </div>
  );
}
