import { useEffect, useRef, useState } from "react";
import type { PixelsOfficeSeatAssignment } from "@tickernelz/paperclip-pro-shared";
import { getOfficeController } from "@/lib/pixels-office/engine/registry";
import { createOfficeOverlays } from "@/lib/pixels-office/engine/overlays";
import { playEffectSound, setTypingLevel } from "@/lib/pixels-office/audio";
import { agentVisualsKey, type OfficeLiveStore } from "@/lib/pixels-office/live";
import type {
  AgentVisual,
  OfficeController,
  OfficeHit,
  OfficeObjectKind,
} from "@/lib/pixels-office/officeModel";
import { relativeTime } from "@/lib/utils";
import { ISSUE_DRAG_MIME } from "./pixels-office/constants";

const DRAG_THRESHOLD_PX = 3;
const TOUCH_DRAG_THRESHOLD_PX = 8;
const PINCH_STEP_RATIO = 1.25;

interface HoverTip {
  x: number;
  y: number;
  title: string;
  body: string | null;
  age: string | null;
}

interface PixelsOfficeCanvasProps {
  companyId: string;
  visuals: readonly AgentVisual[];
  assignments: readonly PixelsOfficeSeatAssignment[];
  store: OfficeLiveStore;
  onController: (office: OfficeController | null) => void;
  onSelectAgent: (agentId: string) => void;
  onSelectObject: (object: OfficeObjectKind) => void;
  onAssignIssue: (issueId: string, agentId: string) => void;
}

export function PixelsOfficeCanvas({
  companyId,
  visuals,
  assignments,
  store,
  onController,
  onSelectAgent,
  onSelectObject,
  onAssignIssue,
}: PixelsOfficeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const officeRef = useRef<OfficeController | null>(null);
  const syncedKeyRef = useRef("");
  const dragRef = useRef<{ x: number; y: number; moved: boolean; touch: boolean } | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number } | null>(null);
  const [office, setOffice] = useState<OfficeController | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tip, setTip] = useState<HoverTip | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    void getOfficeController(companyId)
      .then((controller) => {
        if (cancelled) return;
        officeRef.current = controller;
        controller.setOverlayLayers(createOfficeOverlays(controller));
        const canvas = canvasRef.current;
        if (canvas) controller.attach(canvas);
        syncedKeyRef.current = "";
        setOffice(controller);
        onController(controller);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setLoadError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
      officeRef.current?.detach();
      officeRef.current = null;
      onController(null);
      setOffice(null);
    };
  }, [companyId, onController]);

  useEffect(() => {
    if (!office) return;
    const key = agentVisualsKey(visuals);
    if (key === syncedKeyRef.current) return;
    syncedKeyRef.current = key;
    office.syncAgents(visuals, assignments);
    let running = 0;
    for (const visual of visuals) if (visual.status === "running") running += 1;
    setTypingLevel(running);
  }, [assignments, office, visuals]);

  useEffect(() => {
    if (!office) return;
    return store.subscribe((summary) => {
      for (const effect of summary.effects) office.emit(effect);
      for (const sound of summary.sounds) playEffectSound(sound);
    });
  }, [office, store]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !office) return;
    const onWheel = (domEvent: WheelEvent) => {
      domEvent.preventDefault();
      const rect = canvas.getBoundingClientRect();
      office.zoomAt(
        domEvent.clientX - rect.left,
        domEvent.clientY - rect.top,
        domEvent.deltaY < 0 ? 1 : -1,
      );
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [office]);

  const hitAt = (clientX: number, clientY: number): OfficeHit => {
    const canvas = canvasRef.current;
    const controller = officeRef.current;
    if (!canvas || !controller) return null;
    const rect = canvas.getBoundingClientRect();
    return controller.hitTest(clientX - rect.left, clientY - rect.top);
  };

  return (
    <div className="relative h-(--sz-pixels-office-mobile-canvas) w-full xl:h-(--sz-calc-44) xl:min-h-(--sz-520px)">
      <canvas
        ref={canvasRef}
        className={tip ? "size-full cursor-pointer touch-none" : "size-full touch-none"}
        onPointerDown={(domEvent) => {
          pointersRef.current.set(domEvent.pointerId, { x: domEvent.clientX, y: domEvent.clientY });
          domEvent.currentTarget.setPointerCapture(domEvent.pointerId);
          if (pointersRef.current.size === 2) {
            const [a, b] = [...pointersRef.current.values()];
            pinchRef.current = { distance: Math.hypot(a.x - b.x, a.y - b.y) };
            dragRef.current = null;
            setTip(null);
            return;
          }
          dragRef.current = {
            x: domEvent.clientX,
            y: domEvent.clientY,
            moved: false,
            touch: domEvent.pointerType === "touch",
          };
        }}
        onPointerMove={(domEvent) => {
          const controller = officeRef.current;
          if (!controller) return;
          if (pointersRef.current.has(domEvent.pointerId)) {
            pointersRef.current.set(domEvent.pointerId, { x: domEvent.clientX, y: domEvent.clientY });
          }
          const pinch = pinchRef.current;
          if (pinch && pointersRef.current.size === 2) {
            const [a, b] = [...pointersRef.current.values()];
            const distance = Math.hypot(a.x - b.x, a.y - b.y);
            const ratio = distance / pinch.distance;
            if (ratio >= PINCH_STEP_RATIO || ratio <= 1 / PINCH_STEP_RATIO) {
              const rect = domEvent.currentTarget.getBoundingClientRect();
              controller.zoomAt((a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top, ratio > 1 ? 1 : -1);
              pinch.distance = distance;
            }
            return;
          }
          const drag = dragRef.current;
          if (drag) {
            const dx = domEvent.clientX - drag.x;
            const dy = domEvent.clientY - drag.y;
            const threshold = drag.touch ? TOUCH_DRAG_THRESHOLD_PX : DRAG_THRESHOLD_PX;
            if (drag.moved || Math.abs(dx) > threshold || Math.abs(dy) > threshold) {
              drag.moved = true;
              drag.x = domEvent.clientX;
              drag.y = domEvent.clientY;
              controller.panBy(dx, dy);
            }
            return;
          }
          if (domEvent.pointerType === "touch") return;
          const hit = hitAt(domEvent.clientX, domEvent.clientY);
          controller.hover(hit);
          if (!hit) {
            setTip(null);
            return;
          }
          const rect = domEvent.currentTarget.getBoundingClientRect();
          if (hit.kind === "object") {
            setTip({
              x: domEvent.clientX - rect.left,
              y: domEvent.clientY - rect.top,
              title: hit.object,
              body: null,
              age: null,
            });
            return;
          }
          const visual = controller.visual(hit.agentId);
          setTip({
            x: domEvent.clientX - rect.left,
            y: domEvent.clientY - rect.top,
            title: visual?.shortName ?? hit.agentId.slice(0, 8),
            body: visual?.activity?.message ?? visual?.status ?? null,
            age:
              visual?.activity && visual.activity.updatedAtMs > 0
                ? relativeTime(new Date(visual.activity.updatedAtMs))
                : null,
          });
        }}
        onPointerUp={(domEvent) => {
          const controller = officeRef.current;
          const drag = dragRef.current;
          const wasPinching = pinchRef.current !== null;
          pointersRef.current.delete(domEvent.pointerId);
          if (pointersRef.current.size < 2) pinchRef.current = null;
          dragRef.current = null;
          domEvent.currentTarget.releasePointerCapture(domEvent.pointerId);
          if (!controller || drag?.moved || wasPinching || !drag) return;
          const hit = hitAt(domEvent.clientX, domEvent.clientY);
          if (!hit) {
            controller.select(null);
            return;
          }
          if (hit.kind === "agent") {
            controller.select(hit.agentId);
            onSelectAgent(hit.agentId);
            return;
          }
          onSelectObject(hit.object);
        }}
        onPointerCancel={(domEvent) => {
          pointersRef.current.delete(domEvent.pointerId);
          pinchRef.current = null;
          dragRef.current = null;
        }}
        onPointerLeave={(domEvent) => {
          if (domEvent.pointerType === "touch") return;
          dragRef.current = null;
          officeRef.current?.hover(null);
          setTip(null);
        }}
        onDoubleClick={(domEvent) => {
          const hit = hitAt(domEvent.clientX, domEvent.clientY);
          if (hit?.kind === "agent") officeRef.current?.follow(hit.agentId);
        }}
        onDragOver={(domEvent) => {
          if (!domEvent.dataTransfer.types.includes(ISSUE_DRAG_MIME)) return;
          domEvent.preventDefault();
          domEvent.dataTransfer.dropEffect = "move";
          officeRef.current?.hover(hitAt(domEvent.clientX, domEvent.clientY));
        }}
        onDrop={(domEvent) => {
          const issueId = domEvent.dataTransfer.getData(ISSUE_DRAG_MIME);
          if (!issueId) return;
          domEvent.preventDefault();
          const hit = hitAt(domEvent.clientX, domEvent.clientY);
          officeRef.current?.hover(null);
          if (hit?.kind === "agent") onAssignIssue(issueId, hit.agentId);
        }}
      />
      {tip ? (
        <div
          role="tooltip"
          style={{ left: tip.x + 12, top: tip.y + 12 }}
          className="pointer-events-none absolute z-10 max-w-(--sz-320px) rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
        >
          <p className="font-medium">{tip.title}</p>
          {tip.body ? <p className="text-muted-foreground">{tip.body}</p> : null}
          {tip.age ? <p className="text-muted-foreground">{tip.age}</p> : null}
        </div>
      ) : null}
      {loadError ? (
        <p className="absolute inset-x-0 bottom-2 text-center text-sm text-destructive">
          {loadError}
        </p>
      ) : null}
    </div>
  );
}
