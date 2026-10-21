// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { localBrowserInputSchema } from "@tickernelz/paperclip-pro-shared";
import { LocalBrowserViewer } from "./LocalBrowserViewer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const FRAME_DATA_URL = "data:image/png;base64,AAAA";

class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  closed = false;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent<string>);
  }

  fail() {
    this.onerror?.(new Event("error"));
  }
}

let container: HTMLDivElement;
let root: Root;
let mounted = false;
let rafQueue: FrameRequestCallback[] = [];
let fetchMock: ReturnType<typeof vi.fn>;
let captureMock: ReturnType<typeof vi.fn>;
let releaseCaptureMock: ReturnType<typeof vi.fn>;

function surface(): HTMLElement {
  const element = container.querySelector<HTMLElement>('[data-testid="local-browser-surface"]');
  if (!element) throw new Error("live-view surface is missing");
  return element;
}

function controlButton(): HTMLButtonElement {
  const element = container.querySelector<HTMLButtonElement>("button");
  if (!element) throw new Error("control button is missing");
  return element;
}

function lastSource(): MockEventSource {
  const source = MockEventSource.instances.at(-1);
  if (!source) throw new Error("no EventSource was opened");
  return source;
}

function sizeSurface(width: number, height: number) {
  surface().getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    }) as DOMRect;
}

function pointerEvent(
  type: string,
  init: { clientX: number; clientY: number; button?: number; pointerId?: number },
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX,
    clientY: init.clientY,
    button: init.button ?? 0,
  });
  Object.defineProperty(event, "pointerId", { value: init.pointerId ?? 1 });
  return event;
}

async function renderViewer() {
  await act(async () => {
    root.render(<LocalBrowserViewer sessionId={SESSION_ID} companyId={COMPANY_ID} />);
  });
  mounted = true;
  captureMock = vi.fn();
  releaseCaptureMock = vi.fn();
  surface().setPointerCapture = captureMock as unknown as HTMLElement["setPointerCapture"];
  surface().releasePointerCapture = releaseCaptureMock as unknown as HTMLElement["releasePointerCapture"];
  return lastSource();
}

async function unmountViewer() {
  if (!mounted) return;
  mounted = false;
  await act(async () => {
    root.unmount();
  });
}

async function emitOpen() {
  await act(async () => {
    lastSource().onopen?.(new Event("open"));
  });
}

async function emitFrame(width = 1280, height = 800) {
  await act(async () => {
    lastSource().emit({ type: "frame", dataUrl: FRAME_DATA_URL, width, height, tabId: 3 });
  });
}

async function emitState(state: string, message?: string) {
  await act(async () => {
    lastSource().emit({ type: "state", state, tabId: 3, message });
  });
}

async function takeOver() {
  await act(async () => {
    controlButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function pointer(
  type: string,
  init: { clientX: number; clientY: number; button?: number; pointerId?: number },
) {
  await act(async () => {
    surface().dispatchEvent(pointerEvent(type, init));
  });
}

async function key(type: "keydown" | "keyup", init: KeyboardEventInit) {
  await act(async () => {
    surface().dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }));
  });
}

async function wheel(init: { deltaX: number; deltaY: number; clientX: number; clientY: number }) {
  await act(async () => {
    surface().dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaX: init.deltaX,
        deltaY: init.deltaY,
        clientX: init.clientX,
        clientY: init.clientY,
      }),
    );
  });
}

async function pressEscape() {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

async function flushAnimationFrame() {
  const queued = rafQueue;
  rafQueue = [];
  await act(async () => {
    for (const callback of queued) callback(0);
  });
}

function postedInputs(): Array<{ url: string; body: Record<string, unknown> }> {
  return fetchMock.mock.calls.map((call) => {
    const [url, init] = call as [string, RequestInit | undefined];
    return { url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> };
  });
}

function clickCounts(): Array<unknown> {
  return postedInputs()
    .map((posted) => posted.body)
    .filter((body) => body.action === "down" || body.action === "up")
    .map((body) => body.clickCount);
}

beforeEach(() => {
  MockEventSource.instances = [];
  rafQueue = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 }));
  vi.stubGlobal("EventSource", MockEventSource);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    rafQueue.push(callback);
    return rafQueue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(async () => {
  await unmountViewer();
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("renders the first frame after an SSE frame event", async () => {
  await renderViewer();
  expect(container.querySelector('[data-testid="local-browser-frame"]')).toBeNull();

  await emitOpen();
  await emitFrame();

  const image = container.querySelector<HTMLImageElement>('[data-testid="local-browser-frame"]');
  expect(image).not.toBeNull();
  expect(image?.getAttribute("src")).toBe(FRAME_DATA_URL);
  expect(container.querySelector('[data-testid="local-browser-status"]')?.textContent).toBe("Live");
});

it("shows the placeholder before any frame arrives", async () => {
  await renderViewer();

  expect(container.querySelector('[data-testid="local-browser-frame"]')).toBeNull();
  expect(container.textContent).toContain("Waiting for the first frame");
  expect(container.querySelector('[data-testid="local-browser-status"]')?.textContent).toBe(
    "Connecting to the live view",
  );
});

it("posts scaled mouse coordinates with action down when taken over", async () => {
  await renderViewer();
  await emitFrame();
  await takeOver();
  expect(controlButton().getAttribute("aria-pressed")).toBe("true");
  expect(controlButton().textContent).toBe("Release");

  sizeSurface(640, 400);
  await pointer("pointerdown", { clientX: 100, clientY: 50, button: 0 });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [posted] = postedInputs();
  expect(posted.url).toBe(`/api/local-browser/sessions/${SESSION_ID}/input?companyId=${COMPANY_ID}`);
  expect(posted.body).toEqual({
    kind: "mouse",
    action: "down",
    x: 200,
    y: 100,
    button: "left",
    clickCount: 1,
  });
});

it("throttles pointermove to one action move call per animation frame and drops duplicates", async () => {
  await renderViewer();
  await emitFrame();
  await takeOver();
  sizeSurface(640, 400);

  await pointer("pointermove", { clientX: 10, clientY: 10 });
  await pointer("pointermove", { clientX: 20, clientY: 20 });
  await pointer("pointermove", { clientX: 30, clientY: 30 });
  expect(fetchMock).not.toHaveBeenCalled();

  await flushAnimationFrame();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(postedInputs()[0].body).toEqual({ kind: "mouse", action: "move", x: 60, y: 60, button: "left" });

  await pointer("pointermove", { clientX: 30, clientY: 30 });
  await flushAnimationFrame();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("sends flat modifier booleans on keydown and a matching keyup", async () => {
  await renderViewer();
  await emitFrame();
  await takeOver();

  await key("keydown", { key: "a", code: "KeyA", ctrlKey: true });
  await key("keyup", { key: "a", code: "KeyA", ctrlKey: true });
  await key("keydown", { key: "b", code: "KeyB" });

  const [down, up, plain] = postedInputs();
  expect(down.body).toEqual({ kind: "key", action: "down", key: "a", code: "KeyA", ctrl: true });
  expect(up.body).toEqual({ kind: "key", action: "up", key: "a", code: "KeyA", ctrl: true });
  expect(plain.body).toEqual({ kind: "key", action: "down", key: "b", code: "KeyB", text: "b" });
  for (const posted of postedInputs()) {
    expect(posted.body).not.toHaveProperty("modifiers");
    expect(posted.body).not.toHaveProperty("type");
  }
});

it("posts payloads the frozen input schema accepts and rejects the old shapes", async () => {
  await renderViewer();
  await emitFrame();
  await takeOver();
  sizeSurface(640, 400);

  await pointer("pointermove", { clientX: 16, clientY: 8 });
  await flushAnimationFrame();
  await pointer("pointerdown", { clientX: 32, clientY: 16, pointerId: 4 });
  await pointer("pointerup", { clientX: 32, clientY: 16, pointerId: 4 });
  await wheel({ deltaX: 0, deltaY: 120, clientX: 64, clientY: 32 });
  await key("keydown", { key: "Enter", code: "Enter" });
  await key("keyup", { key: "Enter", code: "Enter" });

  const bodies = postedInputs().map((posted) => posted.body);
  expect(bodies).toHaveLength(6);
  for (const body of bodies) {
    expect(localBrowserInputSchema.safeParse(body).success).toBe(true);
  }
  expect(localBrowserInputSchema.safeParse({ kind: "key", type: "keydown", key: "a", modifiers: {} }).success).toBe(
    false,
  );
  expect(localBrowserInputSchema.safeParse({ kind: "mouse", type: "pointermove", x: 1, y: 1 }).success).toBe(false);
});

it("recomputes the letterbox box when a later frame has a different aspect ratio", async () => {
  await renderViewer();
  await emitFrame(1280, 800);
  await takeOver();
  sizeSurface(640, 400);

  await pointer("pointerdown", { clientX: 320, clientY: 200, pointerId: 1 });
  await pointer("pointerup", { clientX: 320, clientY: 200, pointerId: 1 });
  expect(postedInputs()[0].body).toEqual({
    kind: "mouse",
    action: "down",
    x: 640,
    y: 400,
    button: "left",
    clickCount: 1,
  });

  await emitFrame(1000, 500);
  expect(surface().style.aspectRatio).toBe("1000 / 500");

  await pointer("pointerdown", { clientX: 160, clientY: 120, pointerId: 1 });

  expect(postedInputs()[2].body).toEqual({
    kind: "mouse",
    action: "down",
    x: 250,
    y: 125,
    button: "left",
    clickCount: 1,
  });
});

it("releases control on Escape, flushes held keys, and stops posting input", async () => {
  await renderViewer();
  await emitFrame();
  await takeOver();
  sizeSurface(640, 400);

  await key("keydown", { key: "Control", code: "ControlLeft", ctrlKey: true });
  expect(postedInputs()[0].body).toEqual({
    kind: "key",
    action: "down",
    key: "Control",
    code: "ControlLeft",
    ctrl: true,
  });

  await pressEscape();

  expect(controlButton().getAttribute("aria-pressed")).toBe("false");
  expect(controlButton().textContent).toBe("Take over");
  expect(postedInputs()[1].body).toEqual({
    kind: "key",
    action: "up",
    key: "Control",
    code: "ControlLeft",
    ctrl: true,
  });

  fetchMock.mockClear();
  await pointer("pointerdown", { clientX: 10, clientY: 10 });
  await key("keydown", { key: "d", code: "KeyD" });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("reconnects after a stream error and shows the reconnecting state", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await renderViewer();
  expect(MockEventSource.instances).toHaveLength(1);

  await act(async () => {
    lastSource().fail();
  });

  expect(MockEventSource.instances[0].closed).toBe(true);
  expect(container.textContent).toContain("Reconnecting");

  await act(async () => {
    vi.advanceTimersByTime(500);
  });

  expect(MockEventSource.instances).toHaveLength(2);
  expect(MockEventSource.instances[1].url).toContain(`/api/local-browser/sessions/${SESSION_ID}/viewer`);
});

it("closes the EventSource on unmount", async () => {
  const source = await renderViewer();

  await unmountViewer();

  expect(source.closed).toBe(true);
});

it("captures the pointer and releases the remote button outside the surface", async () => {
  await renderViewer();
  await emitFrame();
  await takeOver();
  sizeSurface(640, 400);

  await pointer("pointerdown", { clientX: 10, clientY: 10, pointerId: 7 });
  expect(captureMock).toHaveBeenCalledWith(7);

  await pointer("pointerup", { clientX: 5000, clientY: 5000, pointerId: 7 });

  expect(releaseCaptureMock).toHaveBeenCalledWith(7);
  const bodies = postedInputs().map((posted) => posted.body);
  expect(bodies[0]).toEqual({ kind: "mouse", action: "down", x: 20, y: 20, button: "left", clickCount: 1 });
  expect(bodies[1]).toEqual({ kind: "mouse", action: "up", x: 1279, y: 799, button: "left", clickCount: 1 });
});

it("cancels an outstanding pointerup when the pointer is cancelled", async () => {
  await renderViewer();
  await emitFrame();
  await takeOver();
  sizeSurface(640, 400);

  await pointer("pointerdown", { clientX: 320, clientY: 200, pointerId: 9 });
  await pointer("pointercancel", { clientX: 320, clientY: 200, pointerId: 9 });

  expect(releaseCaptureMock).toHaveBeenCalledWith(9);
  const bodies = postedInputs().map((posted) => posted.body);
  expect(bodies[1]).toEqual({ kind: "mouse", action: "up", x: 640, y: 400, button: "left", clickCount: 1 });
});

it("flushes an outstanding pointerup and held keys when control is released", async () => {
  await renderViewer();
  await emitFrame();
  await takeOver();
  sizeSurface(640, 400);

  await pointer("pointerdown", { clientX: 32, clientY: 20, pointerId: 3 });
  await key("keydown", { key: "Shift", code: "ShiftLeft", shiftKey: true });

  await takeOver();

  expect(controlButton().getAttribute("aria-pressed")).toBe("false");
  const bodies = postedInputs().map((posted) => posted.body);
  expect(bodies).toContainEqual({ kind: "mouse", action: "up", x: 64, y: 40, button: "left", clickCount: 1 });
  expect(bodies).toContainEqual({
    kind: "key",
    action: "up",
    key: "Shift",
    code: "ShiftLeft",
    shift: true,
  });
});

it("does not post a second up when pointerup follows pointercancel", async () => {
  await renderViewer();
  await emitFrame();
  await takeOver();
  sizeSurface(640, 400);

  await pointer("pointerdown", { clientX: 320, clientY: 200, pointerId: 11 });
  await pointer("pointercancel", { clientX: 320, clientY: 200, pointerId: 11 });
  await pointer("pointerup", { clientX: 320, clientY: 200, pointerId: 11 });

  const ups = postedInputs().filter((posted) => posted.body.action === "up");
  expect(ups).toHaveLength(1);
  expect(ups[0].body).toEqual({ kind: "mouse", action: "up", x: 640, y: 400, button: "left", clickCount: 1 });
});

it("flushes held input when the viewer unmounts while control is held", async () => {
  await renderViewer();
  await emitFrame();
  await takeOver();
  sizeSurface(640, 400);

  await pointer("pointerdown", { clientX: 32, clientY: 20, pointerId: 5 });
  await key("keydown", { key: "Alt", code: "AltLeft", altKey: true });

  await unmountViewer();

  const bodies = postedInputs().map((posted) => posted.body);
  expect(bodies).toContainEqual({ kind: "mouse", action: "up", x: 64, y: 40, button: "left", clickCount: 1 });
  expect(bodies).toContainEqual({ kind: "key", action: "up", key: "Alt", code: "AltLeft", alt: true });
});

it("flushes held input to the previous session when sessionId changes", async () => {
  const otherSession = "33333333-3333-4333-8333-333333333333";
  await renderViewer();
  await emitFrame();
  await takeOver();
  sizeSurface(640, 400);

  await pointer("pointerdown", { clientX: 32, clientY: 20, pointerId: 6 });

  await act(async () => {
    root.render(<LocalBrowserViewer sessionId={otherSession} companyId={COMPANY_ID} />);
  });

  const flushed = postedInputs().find((posted) => posted.body.action === "up");
  expect(flushed?.url).toBe(`/api/local-browser/sessions/${SESSION_ID}/input?companyId=${COMPANY_ID}`);
  expect(flushed?.body).toEqual({ kind: "mouse", action: "up", x: 64, y: 40, button: "left", clickCount: 1 });
  expect(lastSource().url).toContain(otherSession);
});

it("counts a double click as 1,1,2,2 on the down and up pairs", async () => {
  await renderViewer();
  await emitFrame();
  await takeOver();
  sizeSurface(640, 400);

  await pointer("pointerdown", { clientX: 100, clientY: 100, pointerId: 1 });
  await pointer("pointerup", { clientX: 100, clientY: 100, pointerId: 1 });
  await pointer("pointerdown", { clientX: 101, clientY: 100, pointerId: 1 });
  await pointer("pointerup", { clientX: 101, clientY: 100, pointerId: 1 });

  expect(clickCounts()).toEqual([1, 1, 2, 2]);
});

it("restarts the click run when the second press comes too late or moves too far", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-22T00:00:00.000Z"));
  await renderViewer();
  await emitFrame();
  await takeOver();
  sizeSurface(640, 400);

  await pointer("pointerdown", { clientX: 100, clientY: 100, pointerId: 1 });
  await pointer("pointerup", { clientX: 100, clientY: 100, pointerId: 1 });

  vi.setSystemTime(new Date("2026-10-22T00:00:00.900Z"));
  await pointer("pointerdown", { clientX: 100, clientY: 100, pointerId: 1 });
  await pointer("pointerup", { clientX: 100, clientY: 100, pointerId: 1 });

  vi.setSystemTime(new Date("2026-10-22T00:00:01.000Z"));
  await pointer("pointermove", { clientX: 110, clientY: 100, pointerId: 1 });
  await flushAnimationFrame();
  await pointer("pointerdown", { clientX: 110, clientY: 100, pointerId: 1 });
  await pointer("pointerup", { clientX: 110, clientY: 100, pointerId: 1 });

  expect(clickCounts()).toEqual([1, 1, 1, 1, 1, 1]);
});

it("keeps a 4 CSS px gesture inside one click run at any surface width", async () => {
  await renderViewer();
  await emitFrame();
  await takeOver();

  const results: number[][] = [];
  for (const width of [1280, 640, 320]) {
    fetchMock.mockClear();
    sizeSurface(width, width / 1.6);
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });

    await pointer("pointerdown", { clientX: 100, clientY: 100, pointerId: 1 });
    await pointer("pointerup", { clientX: 100, clientY: 100, pointerId: 1 });
    await pointer("pointerdown", { clientX: 104, clientY: 100, pointerId: 1 });
    await pointer("pointerup", { clientX: 104, clientY: 100, pointerId: 1 });

    results.push(clickCounts() as number[]);
  }

  expect(results).toEqual([
    [1, 1, 2, 2],
    [1, 1, 2, 2],
    [1, 1, 2, 2],
  ]);
});

it("restarts the click run at 1 after reaching a triple click", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-22T00:00:00.000Z"));
  await renderViewer();
  await emitFrame();
  await takeOver();
  sizeSurface(640, 400);

  for (let press = 0; press < 4; press += 1) {
    vi.setSystemTime(new Date(`2026-10-22T00:00:00.${String(press * 100).padStart(3, "0")}Z`));
    await pointer("pointerdown", { clientX: 100, clientY: 100, pointerId: 1 });
    await pointer("pointerup", { clientX: 100, clientY: 100, pointerId: 1 });
  }

  const downs = postedInputs()
    .map((posted) => posted.body)
    .filter((body) => body.action === "down")
    .map((body) => body.clickCount);
  expect(downs).toEqual([1, 2, 3, 1]);
  expect(clickCounts()).toEqual([1, 1, 2, 2, 3, 3, 1, 1]);
});

it("resets the click run on window blur", async () => {
  await renderViewer();
  await emitFrame();
  await takeOver();
  sizeSurface(640, 400);

  await pointer("pointerdown", { clientX: 100, clientY: 100, pointerId: 1 });
  await pointer("pointerup", { clientX: 100, clientY: 100, pointerId: 1 });

  await act(async () => {
    window.dispatchEvent(new Event("blur"));
  });

  await pointer("pointerdown", { clientX: 100, clientY: 100, pointerId: 1 });
  await pointer("pointerup", { clientX: 100, clientY: 100, pointerId: 1 });

  expect(clickCounts()).toEqual([1, 1, 1, 1]);
});

it("shows viewer_unavailable as an error and keeps takeover independent of agent state", async () => {
  await renderViewer();
  await emitFrame();

  await emitState("viewer_unavailable", "The browser is not answering.");

  const alert = container.querySelector('[role="alert"]');
  expect(alert?.textContent).toBe("The browser is not answering.");
  expect(alert?.className).toContain("text-destructive");

  await takeOver();
  expect(controlButton().getAttribute("aria-pressed")).toBe("true");

  await emitState("agent_streaming");
  expect(controlButton().getAttribute("aria-pressed")).toBe("true");
  expect(container.textContent).toContain("The agent is working in this tab.");

  sizeSurface(640, 400);
  await pointer("pointerdown", { clientX: 10, clientY: 10 });
  expect(postedInputs()[0].body).toEqual({
    kind: "mouse",
    action: "down",
    x: 20,
    y: 20,
    button: "left",
    clickCount: 1,
  });

  await emitState("agent_idle");
  expect(container.textContent).toContain("The agent is idle in this tab.");
  expect(controlButton().getAttribute("aria-pressed")).toBe("true");
});
