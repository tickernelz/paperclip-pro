import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLocalBrowserViewer, type LocalBrowserViewerStatus } from "./use-local-browser-viewer";
import {
  mouseButtonOf,
  type LocalBrowserKeyDescriptor,
  type LocalBrowserViewerFrame,
} from "./local-browser-api";

export interface LocalBrowserViewerProps {
  sessionId: string;
  companyId?: string;
  tabId?: number;
  className?: string;
}

interface ContentBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface LetterboxCache {
  frameRatio: number;
  rectKey: string;
  box: ContentBox;
}

interface SurfaceNotice {
  tone: "error" | "info";
  text: string;
}

const STATUS_LABEL: Record<LocalBrowserViewerStatus, string> = {
  connecting: "Connecting to the live view",
  live: "Live",
  reconnecting: "Reconnecting",
  error: "Live view unavailable",
};

const WAITING_FOR_FRAME = "Waiting for the first frame from the browser";
const LETTERBOX_RATIO_TOLERANCE = 0.02;

function contentBoxOf(box: DOMRect, frame: LocalBrowserViewerFrame): ContentBox {
  const frameRatio = frame.width / frame.height;
  const boxRatio = box.width / box.height;
  if (!Number.isFinite(boxRatio) || boxRatio <= 0) {
    return { left: box.left, top: box.top, width: box.width, height: box.height };
  }
  if (boxRatio > frameRatio) {
    const width = box.height * frameRatio;
    return { left: box.left + (box.width - width) / 2, top: box.top, width, height: box.height };
  }
  const height = box.width / frameRatio;
  return { left: box.left, top: box.top + (box.height - height) / 2, width: box.width, height };
}

function letterboxOf(
  rect: DOMRect,
  frame: LocalBrowserViewerFrame,
  cached: LetterboxCache | null,
): LetterboxCache {
  const frameRatio = frame.width / frame.height;
  const rectKey = `${rect.left}:${rect.top}:${rect.width}:${rect.height}`;
  if (cached && cached.rectKey === rectKey) {
    const ratioShift = Math.abs(frameRatio - cached.frameRatio) / cached.frameRatio;
    if (ratioShift <= LETTERBOX_RATIO_TOLERANCE) return cached;
  }
  return { frameRatio, rectKey, box: contentBoxOf(rect, frame) };
}

function clampToFrame(value: number, size: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.round(value), 0), Math.max(size - 1, 0));
}

function capturePointer(element: HTMLElement, pointerId: number): void {
  if (typeof element.setPointerCapture !== "function") return;
  try {
    element.setPointerCapture(pointerId);
  } catch {
    return;
  }
}

function dropPointerCapture(element: HTMLElement, pointerId: number): void {
  if (typeof element.releasePointerCapture !== "function") return;
  try {
    element.releasePointerCapture(pointerId);
  } catch {
    return;
  }
}

function keyDescriptorOf(event: {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): LocalBrowserKeyDescriptor {
  return {
    key: event.key,
    code: event.code,
    alt: event.altKey,
    ctrl: event.ctrlKey,
    meta: event.metaKey,
    shift: event.shiftKey,
  };
}

export function LocalBrowserViewer({ sessionId, companyId, tabId, className }: LocalBrowserViewerProps) {
  const {
    frame,
    status,
    error,
    viewerState,
    viewerMessage,
    controlledByViewer,
    setControlledByViewer,
    pressPointer,
    releasePointer,
    cancelPointer,
    queuePointerMove,
    sendWheel,
    pressKey,
    releaseKey,
  } = useLocalBrowserViewer(sessionId, companyId, tabId);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const letterboxRef = useRef<LetterboxCache | null>(null);
  const hintId = useId();

  useEffect(() => {
    if (!controlledByViewer) return;
    const owner = surfaceRef.current?.ownerDocument ?? document;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setControlledByViewer(false);
    };
    owner.addEventListener("keydown", onKeyDown);
    return () => owner.removeEventListener("keydown", onKeyDown);
  }, [controlledByViewer, setControlledByViewer]);

  const pointOf = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const surface = surfaceRef.current;
      if (!surface || !frame) return null;
      const letterbox = letterboxOf(surface.getBoundingClientRect(), frame, letterboxRef.current);
      letterboxRef.current = letterbox;
      const { box } = letterbox;
      if (box.width <= 0 || box.height <= 0) return null;
      return {
        x: clampToFrame(((event.clientX - box.left) / box.width) * frame.width, frame.width),
        y: clampToFrame(((event.clientY - box.top) / box.height) * frame.height, frame.height),
        cssX: event.clientX,
        cssY: event.clientY,
      };
    },
    [frame],
  );

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!controlledByViewer) return;
    const point = pointOf(event);
    if (!point) return;
    event.preventDefault();
    capturePointer(event.currentTarget, event.pointerId);
    event.currentTarget.focus();
    pressPointer({ ...point, button: mouseButtonOf(event.button) });
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!controlledByViewer) return;
    const point = pointOf(event);
    if (!point) return;
    dropPointerCapture(event.currentTarget, event.pointerId);
    releasePointer({ ...point, button: mouseButtonOf(event.button) });
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!controlledByViewer) return;
    dropPointerCapture(event.currentTarget, event.pointerId);
    cancelPointer();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!controlledByViewer) return;
    const point = pointOf(event);
    if (!point) return;
    queuePointerMove({ ...point, button: mouseButtonOf(event.button) });
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!controlledByViewer) return;
    const point = pointOf(event);
    if (!point) return;
    sendWheel(event.deltaX, event.deltaY, point.x, point.y);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!controlledByViewer || event.key === "Escape") return;
    event.preventDefault();
    pressKey(keyDescriptorOf(event));
  };

  const handleKeyUp = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!controlledByViewer || event.key === "Escape") return;
    event.preventDefault();
    releaseKey(keyDescriptorOf(event));
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (controlledByViewer) event.preventDefault();
  };

  const stateNotice: SurfaceNotice | null =
    viewerState === "viewer_unavailable"
      ? { tone: "error", text: viewerMessage ?? "The browser cannot be shown right now." }
      : viewerState === "disconnected"
        ? { tone: "info", text: viewerMessage ?? "The browser disconnected. The live view reconnects when it returns." }
        : viewerState === "agent_idle"
          ? { tone: "info", text: viewerMessage ?? "The agent is idle in this tab." }
          : viewerState === "agent_streaming"
            ? { tone: "info", text: viewerMessage ?? "The agent is working in this tab." }
            : null;

  const notice: SurfaceNotice | null = error ? { tone: "error", text: error } : stateNotice;
  const placeholder: SurfaceNotice = notice ?? { tone: "info", text: WAITING_FOR_FRAME };

  return (
    <div className={cn("flex w-full flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground" data-testid="local-browser-status">
          {STATUS_LABEL[status]}
        </span>
        <Button
          type="button"
          size="sm"
          variant={controlledByViewer ? "outline" : "default"}
          aria-pressed={controlledByViewer}
          onClick={() => setControlledByViewer(!controlledByViewer)}
        >
          {controlledByViewer ? "Release" : "Take over"}
        </Button>
      </div>

      <div
        ref={surfaceRef}
        role="region"
        aria-label="Browser live view"
        aria-describedby={hintId}
        tabIndex={0}
        data-testid="local-browser-surface"
        className={cn(
          "relative w-full overflow-hidden rounded-md border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring",
          controlledByViewer ? "cursor-crosshair" : "cursor-default",
        )}
        style={{ aspectRatio: frame ? `${frame.width} / ${frame.height}` : "16 / 9" }}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerMove={handlePointerMove}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onContextMenu={handleContextMenu}
      >
        {frame ? (
          <img
            src={frame.dataUrl}
            alt=""
            draggable={false}
            className="size-full select-none object-contain"
            data-testid="local-browser-frame"
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1 px-4 text-center">
            <p className={cn("text-sm", placeholder.tone === "error" ? "text-destructive" : "text-muted-foreground")}>
              {placeholder.text}
            </p>
          </div>
        )}

        {frame && !controlledByViewer ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-background/90 px-3 py-2">
            <p className="text-xs text-muted-foreground">
              The agent has control of this tab. Take over to use the mouse and keyboard.
            </p>
          </div>
        ) : null}
      </div>

      {frame && notice ? (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={cn("text-xs", notice.tone === "error" ? "text-destructive" : "text-muted-foreground")}
        >
          {notice.text}
        </p>
      ) : null}

      <p id={hintId} className="text-xs text-muted-foreground">
        Press Escape to release control back to the agent.
      </p>
    </div>
  );
}
