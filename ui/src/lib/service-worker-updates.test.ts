import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SKIP_WAITING_MESSAGE, startServiceWorkerUpdates } from "./service-worker-updates";

type Listener = () => void;

function emitter() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    addEventListener: vi.fn((type: string, listener: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: Listener) => {
      listeners.get(type)?.delete(listener);
    }),
    emit(type: string) {
      for (const listener of listeners.get(type) ?? []) listener();
    },
  };
}

function fakeWorker() {
  const events = emitter();
  return Object.assign(events, { state: "installing" as ServiceWorkerState, postMessage: vi.fn() });
}

function fakeContainer(opts: { controlled: boolean; waiting?: ReturnType<typeof fakeWorker> }) {
  const regEvents = emitter();
  const registration = Object.assign(regEvents, {
    update: vi.fn(() => Promise.resolve()),
    waiting: opts.waiting ?? null,
    installing: null as ReturnType<typeof fakeWorker> | null,
  });
  const events = emitter();
  const container = Object.assign(events, {
    controller: opts.controlled ? ({} as ServiceWorker) : null,
    register: vi.fn(() => Promise.resolve(registration)),
  });
  return { container, registration };
}

function fakeDocument() {
  return Object.assign(emitter(), { visibilityState: "visible" as DocumentVisibilityState });
}

function start(container: ReturnType<typeof fakeContainer>["container"], doc = fakeDocument()) {
  const reload = vi.fn();
  const onUpdateReady = vi.fn();
  const stop = startServiceWorkerUpdates({
    container: container as unknown as ServiceWorkerContainer,
    documentRef: doc as unknown as Document,
    reload,
    onUpdateReady,
  });
  return { reload, onUpdateReady, stop, doc };
}

describe("startServiceWorkerUpdates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers /sw.js", () => {
    const { container } = fakeContainer({ controlled: false });
    start(container);
    expect(container.register).toHaveBeenCalledWith("/sw.js");
  });

  it("offers a worker that finished installing over a controlled page and never reloads by itself", async () => {
    const { container, registration } = fakeContainer({ controlled: true });
    const { reload, onUpdateReady, doc } = start(container);
    await vi.runOnlyPendingTimersAsync();
    const worker = fakeWorker();
    registration.installing = worker;
    registration.emit("updatefound");
    worker.state = "installed";
    worker.emit("statechange");
    doc.visibilityState = "hidden";
    doc.emit("visibilitychange");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onUpdateReady).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });

  it("applies an offered update by activating the waiting worker, then reloads once on takeover", async () => {
    const waiting = fakeWorker();
    const { container } = fakeContainer({ controlled: true, waiting });
    const { reload, onUpdateReady } = start(container);
    await vi.runOnlyPendingTimersAsync();
    expect(onUpdateReady).toHaveBeenCalledOnce();
    onUpdateReady.mock.calls[0]![0]();
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: SKIP_WAITING_MESSAGE });
    container.emit("controllerchange");
    container.emit("controllerchange");
    await vi.advanceTimersByTimeAsync(5000);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("still reloads when the activated worker never takes control", async () => {
    const waiting = fakeWorker();
    const { container } = fakeContainer({ controlled: true, waiting });
    const { reload, onUpdateReady } = start(container);
    await vi.runOnlyPendingTimersAsync();
    onUpdateReady.mock.calls[0]![0]();
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("offers a reload instead of reloading when another tab activated the new worker", async () => {
    const { container } = fakeContainer({ controlled: true });
    const { reload, onUpdateReady } = start(container);
    await vi.runOnlyPendingTimersAsync();
    container.emit("controllerchange");
    expect(reload).not.toHaveBeenCalled();
    expect(onUpdateReady).toHaveBeenCalledOnce();
    onUpdateReady.mock.calls[0]![0]();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("offers nothing on the first install of an uncontrolled page", async () => {
    const waiting = fakeWorker();
    const { container } = fakeContainer({ controlled: false, waiting });
    const { reload, onUpdateReady } = start(container);
    await vi.runOnlyPendingTimersAsync();
    container.emit("controllerchange");
    expect(onUpdateReady).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("checks for a new worker when the tab becomes visible and hourly", async () => {
    const { container, registration } = fakeContainer({ controlled: true });
    const { doc } = start(container);
    await Promise.resolve();
    await Promise.resolve();
    doc.emit("visibilitychange");
    expect(registration.update).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(registration.update).toHaveBeenCalledTimes(2);
  });

  it("stops listening after cleanup", async () => {
    const { container, registration } = fakeContainer({ controlled: true });
    const { stop, doc, onUpdateReady } = start(container);
    await Promise.resolve();
    await Promise.resolve();
    stop();
    doc.emit("visibilitychange");
    container.emit("controllerchange");
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
    expect(registration.update).not.toHaveBeenCalled();
    expect(onUpdateReady).not.toHaveBeenCalled();
  });
});
