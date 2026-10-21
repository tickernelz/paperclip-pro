import { useCallback, useEffect, useRef, useState } from "react";
import {
  LOCAL_BROWSER_VIEWER_MAX_RETRIES,
  LOCAL_BROWSER_VIEWER_RECONNECT_BASE_MS,
  LOCAL_BROWSER_VIEWER_RECONNECT_MAX_MS,
  keyInput,
  localBrowserViewerUrl,
  mouseInput,
  parseLocalBrowserViewerEvent,
  postLocalBrowserInput,
  wheelInput,
  type LocalBrowserInput,
  type LocalBrowserKeyDescriptor,
  type LocalBrowserMouseButton,
  type LocalBrowserViewerFrame,
  type LocalBrowserViewerStateName,
} from "./local-browser-api";

export type LocalBrowserViewerStatus = "connecting" | "live" | "reconnecting" | "error";

const CLICK_RUN_GAP_MS = 500;
const CLICK_RUN_DISTANCE_PX = 4;
const CLICK_RUN_MAX = 3;

function clickCountOf(run: ClickRun | null, point: LocalBrowserPointerPoint, now: number): number {
  if (!run) return 1;
  if (run.button !== point.button) return 1;
  if (now - run.at > CLICK_RUN_GAP_MS) return 1;
  if (Math.abs(point.cssX - run.cssX) > CLICK_RUN_DISTANCE_PX) return 1;
  if (Math.abs(point.cssY - run.cssY) > CLICK_RUN_DISTANCE_PX) return 1;
  if (run.count >= CLICK_RUN_MAX) return 1;
  return run.count + 1;
}

export interface LocalBrowserPointerPoint {
  x: number;
  y: number;
  cssX: number;
  cssY: number;
  button: LocalBrowserMouseButton;
}

interface PointerPress {
  point: LocalBrowserPointerPoint;
  released: boolean;
  clickCount: number;
}

interface ClickRun {
  button: LocalBrowserMouseButton;
  cssX: number;
  cssY: number;
  at: number;
  count: number;
}

export interface UseLocalBrowserViewerResult {
  frame: LocalBrowserViewerFrame | null;
  status: LocalBrowserViewerStatus;
  error: string | null;
  viewerState: LocalBrowserViewerStateName | null;
  viewerMessage: string | null;
  controlledByViewer: boolean;
  setControlledByViewer: (next: boolean) => void;
  pressPointer: (point: LocalBrowserPointerPoint) => void;
  releasePointer: (point: LocalBrowserPointerPoint) => void;
  cancelPointer: () => void;
  queuePointerMove: (point: LocalBrowserPointerPoint) => void;
  sendWheel: (deltaX: number, deltaY: number, x: number, y: number) => void;
  pressKey: (descriptor: LocalBrowserKeyDescriptor) => void;
  releaseKey: (descriptor: LocalBrowserKeyDescriptor) => void;
  flushHeldInput: () => void;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function keyIdOf(descriptor: LocalBrowserKeyDescriptor): string {
  return descriptor.code || descriptor.key;
}

export function useLocalBrowserViewer(sessionId: string, companyId?: string): UseLocalBrowserViewerResult {
  const [frame, setFrame] = useState<LocalBrowserViewerFrame | null>(null);
  const [status, setStatus] = useState<LocalBrowserViewerStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [viewerState, setViewerState] = useState<LocalBrowserViewerStateName | null>(null);
  const [viewerMessage, setViewerMessage] = useState<string | null>(null);
  const [controlledByViewer, setControlState] = useState(false);

  const heldKeysRef = useRef(new Map<string, LocalBrowserKeyDescriptor>());
  const pointerPressRef = useRef<PointerPress | null>(null);
  const clickRunRef = useRef<ClickRun | null>(null);
  const pendingMoveRef = useRef<LocalBrowserPointerPoint | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastMoveRef = useRef("");

  useEffect(() => {
    setFrame(null);
    setError(null);
    setViewerState(null);
    setViewerMessage(null);
    setControlState(false);
    setStatus("connecting");
    if (!sessionId) {
      setStatus("error");
      setError("No browser session is selected.");
      return;
    }
    if (typeof EventSource === "undefined") {
      setStatus("error");
      setError("This browser cannot show the live view.");
      return;
    }

    const url = localBrowserViewerUrl(sessionId, companyId);
    let disposed = false;
    let source: EventSource | null = null;
    let retries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function retry() {
      retries += 1;
      const exhausted = retries > LOCAL_BROWSER_VIEWER_MAX_RETRIES;
      setStatus(exhausted ? "error" : "reconnecting");
      if (exhausted) setError("The live view keeps dropping. Still retrying in the background.");
      const delay = Math.min(
        LOCAL_BROWSER_VIEWER_RECONNECT_BASE_MS * 2 ** (retries - 1),
        LOCAL_BROWSER_VIEWER_RECONNECT_MAX_MS,
      );
      timer = setTimeout(connect, delay);
    }

    function connect() {
      if (disposed) return;
      let next: EventSource;
      try {
        next = new EventSource(url, { withCredentials: true });
      } catch (cause) {
        setError(messageOf(cause));
        retry();
        return;
      }
      source = next;
      next.onopen = () => {
        if (disposed) return;
        retries = 0;
        setStatus("live");
        setError(null);
      };
      next.onmessage = (event: MessageEvent<string>) => {
        if (disposed) return;
        const parsed = parseLocalBrowserViewerEvent(event.data);
        if (!parsed) return;
        if (parsed.type === "frame") {
          setFrame(parsed);
          return;
        }
        setViewerState(parsed.state);
        setViewerMessage(parsed.message ?? null);
      };
      next.onerror = () => {
        if (disposed) return;
        next.close();
        if (source === next) source = null;
        retry();
      };
    }

    connect();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      source?.close();
      source = null;
    };
  }, [sessionId, companyId]);

  useEffect(() => {
    lastMoveRef.current = "";
    pendingMoveRef.current = null;
    pointerPressRef.current = null;
    clickRunRef.current = null;
    heldKeysRef.current.clear();
  }, [sessionId, companyId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const resetRun = () => {
      clickRunRef.current = null;
    };
    window.addEventListener("blur", resetRun);
    return () => window.removeEventListener("blur", resetRun);
  }, []);

  useEffect(() => {
    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, []);

  const send = useCallback(
    (input: LocalBrowserInput | null) => {
      if (!sessionId || !input) return;
      void postLocalBrowserInput(sessionId, input, companyId).catch((cause: unknown) => {
        setError(messageOf(cause));
      });
    },
    [sessionId, companyId],
  );

  const flushPointerMove = useCallback(() => {
    animationRef.current = null;
    const move = pendingMoveRef.current;
    pendingMoveRef.current = null;
    if (!move) return;
    const signature = `${move.x}:${move.y}:${move.button}`;
    if (signature === lastMoveRef.current) return;
    lastMoveRef.current = signature;
    send(mouseInput("move", move.x, move.y, move.button));
  }, [send]);

  const queuePointerMove = useCallback(
    (point: LocalBrowserPointerPoint) => {
      const run = clickRunRef.current;
      if (
        run
        && (Math.abs(point.cssX - run.cssX) > CLICK_RUN_DISTANCE_PX
          || Math.abs(point.cssY - run.cssY) > CLICK_RUN_DISTANCE_PX)
      ) {
        clickRunRef.current = null;
      }
      pendingMoveRef.current = point;
      if (animationRef.current !== null) return;
      animationRef.current = requestAnimationFrame(flushPointerMove);
    },
    [flushPointerMove],
  );

  const pressPointer = useCallback(
    (point: LocalBrowserPointerPoint) => {
      const now = Date.now();
      const clickCount = clickCountOf(clickRunRef.current, point, now);
      clickRunRef.current = { button: point.button, cssX: point.cssX, cssY: point.cssY, at: now, count: clickCount };
      pointerPressRef.current = { point, released: false, clickCount };
      lastMoveRef.current = `${point.x}:${point.y}:${point.button}`;
      send(mouseInput("down", point.x, point.y, point.button, clickCount));
    },
    [send],
  );

  const releasePointer = useCallback(
    (point: LocalBrowserPointerPoint) => {
      const press = pointerPressRef.current;
      pointerPressRef.current = null;
      if (press?.released) return;
      send(mouseInput("up", point.x, point.y, point.button, press?.clickCount ?? 1));
    },
    [send],
  );

  const cancelPointer = useCallback(() => {
    const press = pointerPressRef.current;
    if (!press || press.released) return;
    press.released = true;
    send(mouseInput("up", press.point.x, press.point.y, press.point.button, press.clickCount));
  }, [send]);

  const sendWheel = useCallback(
    (deltaX: number, deltaY: number, x: number, y: number) => {
      send(wheelInput(deltaX, deltaY, x, y));
    },
    [send],
  );

  const pressKey = useCallback(
    (descriptor: LocalBrowserKeyDescriptor) => {
      heldKeysRef.current.set(keyIdOf(descriptor), descriptor);
      send(keyInput("down", descriptor));
    },
    [send],
  );

  const releaseKey = useCallback(
    (descriptor: LocalBrowserKeyDescriptor) => {
      heldKeysRef.current.delete(keyIdOf(descriptor));
      send(keyInput("up", descriptor));
    },
    [send],
  );

  const flushHeldInput = useCallback(() => {
    const held = Array.from(heldKeysRef.current.values());
    heldKeysRef.current.clear();
    cancelPointer();
    for (const descriptor of held) send(keyInput("up", descriptor));
  }, [cancelPointer, send]);

  const flushRef = useRef(flushHeldInput);

  useEffect(() => {
    flushRef.current = flushHeldInput;
  }, [flushHeldInput]);

  useEffect(() => {
    return () => {
      flushRef.current();
      clickRunRef.current = null;
    };
  }, [sessionId]);

  const setControlledByViewer = useCallback(
    (next: boolean) => {
      if (!next) flushHeldInput();
      setControlState(next);
    },
    [flushHeldInput],
  );

  return {
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
    flushHeldInput,
  };
}
