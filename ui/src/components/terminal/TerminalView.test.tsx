// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import { TerminalView } from "./TerminalView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { DEVICE_ATTRIBUTES_QUERY, DEVICE_ATTRIBUTES_REPLY } = vi.hoisted(() => ({
  DEVICE_ATTRIBUTES_QUERY: "\u001b[c",
  DEVICE_ATTRIBUTES_REPLY: "\u001b[?1;2c",
}));

const xterm = vi.hoisted(() => {
  class MockTerminal {
    readonly options: Record<string, unknown>;
    cols: number;
    rows: number;
    writes: string[] = [];
    resets = 0;
    disposed = false;
    unicode = { activeVersion: "6" };
    addons: unknown[] = [];
    private dataHandlers: Array<(data: string) => void> = [];

    constructor(options: Record<string, unknown> = {}) {
      this.options = options;
      this.cols = typeof options.cols === "number" ? options.cols : 80;
      this.rows = typeof options.rows === "number" ? options.rows : 24;
      xterm.terminals.push(this);
    }

    loadAddon(addon: { activate?: (terminal: MockTerminal) => void }) {
      this.addons.push(addon);
      addon.activate?.(this);
    }

    open() {}

    onData(handler: (data: string) => void) {
      this.dataHandlers.push(handler);
      return { dispose: () => { this.dataHandlers = this.dataHandlers.filter((entry) => entry !== handler); } };
    }

    emitData(data: string) {
      for (const handler of this.dataHandlers) handler(data);
    }

    keyHandler: ((event: KeyboardEvent) => boolean) | null = null;
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) { this.keyHandler = handler; }
    write(data: string, callback?: () => void) {
      this.writes.push(data);
      if (data.includes(DEVICE_ATTRIBUTES_QUERY)) this.emitData(DEVICE_ATTRIBUTES_REPLY);
      callback?.();
    }
    reset() { this.resets += 1; this.writes = []; }
    resize(cols: number, rows: number) { this.cols = cols; this.rows = rows; }
    focus() {}
    clearSelection() {}
    hasSelection() { return false; }
    getSelection() { return ""; }
    paste(data: string) { this.emitData(data); }
    selectAll() {}
    clear() {}
    dispose() { this.disposed = true; }
  }

  class MockFitAddon {
    terminal: MockTerminal | null = null;
    activate(terminal: MockTerminal) { this.terminal = terminal; }
    fit() { this.terminal?.resize(120, 32); }
    dispose() {}
  }

  class MockAddon {
    activate() {}
    dispose() {}
    onContextLoss() { return { dispose() {} }; }
    findNext() { return true; }
    findPrevious() { return true; }
    clearDecorations() {}
  }

  return { MockTerminal, MockFitAddon, MockAddon, terminals: [] as MockTerminal[], clipboardProviders: [] as unknown[] };
});

vi.mock("@xterm/xterm", () => ({ Terminal: xterm.MockTerminal }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: xterm.MockFitAddon }));
vi.mock("@xterm/addon-webgl", () => ({ WebglAddon: xterm.MockAddon }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: xterm.MockAddon }));
vi.mock("@xterm/addon-search", () => ({ SearchAddon: xterm.MockAddon }));
vi.mock("@xterm/addon-clipboard", () => ({
  ClipboardAddon: class {
    constructor(_base64: unknown, provider: unknown) {
      xterm.clipboardProviders.push(provider);
    }
    activate() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-image", () => ({ ImageAddon: xterm.MockAddon }));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: xterm.MockAddon }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

const terminalApiMock = vi.hoisted(() => ({
  createToken: vi.fn(),
  upload: vi.fn(),
  pasteImage: vi.fn(),
  download: vi.fn(),
}));

vi.mock("@/api/terminal", () => ({ terminalApi: terminalApiMock }));

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.(new Event("close") as CloseEvent);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  receive(frame: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(frame) }));
  }

  frames() {
    return this.sent.map((entry) => JSON.parse(entry) as Record<string, unknown>);
  }
}

const session = {
  id: "session-1",
  companyId: "company-1",
  kind: "local",
  title: "bash",
  cwd: "/work",
  issueId: null,
  environmentId: null,
  status: "running",
  exitCode: null,
  cols: 120,
  rows: 32,
  attachedClients: 1,
  createdAt: "2026-10-24T00:00:00.000Z",
  lastActivityAt: "2026-10-24T00:00:00.000Z",
  createdByUserId: "user-1",
  sshHost: null,
};

function token(value: string) {
  return { sessionId: "session-1", token: value, expiresAt: "2026-10-24T00:01:00.000Z", websocketPath: "/api/terminal/ws" };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

describe("TerminalView", () => {
  let root: Root;
  let container: HTMLDivElement;
  let originalWebSocket: typeof WebSocket | undefined;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    FakeWebSocket.instances = [];
    xterm.terminals.length = 0;
    terminalApiMock.createToken.mockReset();
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    };
    window.cancelAnimationFrame = () => {};
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    if (originalWebSocket) globalThis.WebSocket = originalWebSocket;
  });

  async function mount(onUnavailable?: () => void) {
    await act(async () => {
      root.render(<TerminalView companyId="company-1" sessionId="session-1" reconnectBaseDelayMs={0} onUnavailable={onUnavailable} />);
    });
    await flush();
  }

  function view() {
    return container.querySelector<HTMLElement>('[data-testid="terminal-view"]');
  }

  it("authenticates first, then sends the fitted size, then streams frames both ways", async () => {
    terminalApiMock.createToken.mockResolvedValueOnce(token("token-1"));
    await mount();

    expect(terminalApiMock.createToken).toHaveBeenCalledWith("company-1", "session-1");
    expect(FakeWebSocket.instances).toHaveLength(1);
    const socket = FakeWebSocket.instances[0]!;
    expect(new URL(socket.url).pathname).toBe("/api/terminal/ws");
    expect(socket.url).not.toContain("token-1");
    expect(socket.sent).toHaveLength(0);

    await act(async () => socket.open());
    const [first, second] = socket.frames();
    expect(first).toEqual({ type: "auth", token: "token-1" });
    expect(second).toEqual({ type: "resize", cols: 120, rows: 32 });

    await act(async () => xterm.terminals[0]!.emitData("early"));
    expect(socket.frames().map((frame) => frame.type)).toEqual(["auth", "resize"]);

    await act(async () => {
      socket.receive({ type: "ready", session });
      socket.receive({ type: "replay", data: "previous screen" });
      socket.receive({ type: "output", data: "$ " });
    });
    const terminal = xterm.terminals[0]!;
    expect(view()?.dataset.connection).toBe("connected");
    expect(terminal.resets).toBe(1);
    expect(terminal.writes).toEqual(["previous screen", "$ "]);
    expect(terminal.unicode.activeVersion).toBe("11");

    await act(async () => terminal.emitData("ls\r"));
    expect(socket.frames().at(-1)).toEqual({ type: "input", data: "ls\r" });
  });

  it("keeps replayed history from answering old terminal queries into the shell", async () => {
    terminalApiMock.createToken.mockResolvedValueOnce(token("token-1"));
    await mount();
    const socket = FakeWebSocket.instances[0]!;
    await act(async () => socket.open());

    await act(async () => {
      socket.receive({ type: "ready", session });
      socket.receive({ type: "replay", data: `vim${DEVICE_ATTRIBUTES_QUERY}` });
    });
    expect(socket.frames().filter((frame) => frame.type === "input")).toEqual([]);

    await act(async () => socket.receive({ type: "output", data: DEVICE_ATTRIBUTES_QUERY }));
    expect(socket.frames().filter((frame) => frame.type === "input")).toEqual([
      { type: "input", data: DEVICE_ATTRIBUTES_REPLY },
    ]);
  });

  it("mints a fresh token and reattaches after the socket closes", async () => {
    terminalApiMock.createToken
      .mockResolvedValueOnce(token("token-1"))
      .mockResolvedValueOnce(token("token-2"));
    await mount();
    const first = FakeWebSocket.instances[0]!;
    await act(async () => {
      first.open();
      first.receive({ type: "ready", session });
    });

    await act(async () => first.close());
    await flush();
    await flush();

    expect(terminalApiMock.createToken).toHaveBeenCalledTimes(2);
    expect(FakeWebSocket.instances).toHaveLength(2);
    const second = FakeWebSocket.instances[1]!;
    expect(view()?.dataset.connection).toBe("reconnecting");
    await act(async () => second.open());
    expect(second.frames()[0]).toEqual({ type: "auth", token: "token-2" });
    await act(async () => second.receive({ type: "ready", session }));
    expect(view()?.dataset.connection).toBe("connected");
  });

  it("does not reconnect after the shell exits", async () => {
    terminalApiMock.createToken.mockResolvedValue(token("token-1"));
    await mount();
    const socket = FakeWebSocket.instances[0]!;
    await act(async () => {
      socket.open();
      socket.receive({ type: "ready", session });
      socket.receive({ type: "exit", exitCode: 0, signal: null });
    });
    await act(async () => socket.close());
    await flush();

    expect(terminalApiMock.createToken).toHaveBeenCalledTimes(1);
    expect(view()?.dataset.connection).toBe("exited");
    expect(view()?.textContent).toContain("Process exited with code 0.");
  });

  it("stops with a clear error when the server refuses the attach token", async () => {
    terminalApiMock.createToken.mockRejectedValue(new ApiError("Instance admin access required", 403, null));
    await mount();
    await flush();

    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(terminalApiMock.createToken).toHaveBeenCalledTimes(1);
    expect(view()?.dataset.connection).toBe("failed");
    expect(view()?.textContent).toContain("Instance admin access required");
  });

  it("never reports the user's clipboard back to the shell when output asks for it", async () => {
    terminalApiMock.createToken.mockResolvedValue(token("token-1"));
    xterm.clipboardProviders.length = 0;
    await mount();
    await flush();
    const provider = xterm.clipboardProviders.at(-1) as { readText: (selection: string) => string | Promise<string> };
    expect(provider).toBeDefined();
    const readSpy = vi.fn().mockResolvedValue("secret-from-clipboard");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText: readSpy, writeText: vi.fn() } });

    expect(await provider.readText("c")).toBe("");
    expect(readSpy).not.toHaveBeenCalled();
  });

  it("lets the user's own copy reach the clipboard", async () => {
    terminalApiMock.createToken.mockResolvedValue(token("token-1"));
    xterm.clipboardProviders.length = 0;
    await mount();
    await flush();
    const provider = xterm.clipboardProviders.at(-1) as { writeText: (selection: string, text: string) => void | Promise<void> };
    const writeSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText: vi.fn(), writeText: writeSpy } });

    await provider.writeText("c", "copied");
    expect(writeSpy).toHaveBeenCalledWith("copied");
  });

  async function connected() {
    terminalApiMock.createToken.mockResolvedValue(token("token-1"));
    await mount();
    const socket = FakeWebSocket.instances[0]!;
    await act(async () => {
      socket.open();
      socket.receive({ type: "ready", session });
    });
    return { socket, terminal: xterm.terminals[0]! };
  }

  function inputs(socket: FakeWebSocket) {
    return socket.frames().filter((frame) => frame.type === "input").map((frame) => frame.data);
  }

  function pasteEvent(types: string[], file: File | null) {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    const items = file ? [{ kind: "file", type: file.type, getAsFile: () => file }] : [];
    Object.defineProperty(event, "clipboardData", { value: { types, items } });
    return event;
  }

  function stubClipboard(items: Array<Record<string, Blob>>) {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const read = vi.fn(async () => {
      await gate;
      return items.map((entry) => ({ types: Object.keys(entry), getType: async (type: string) => entry[type]! }));
    });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { read, readText: vi.fn().mockResolvedValue("") } });
    return { read, release: () => release() };
  }

  function ctrlV() {
    return { type: "keydown", key: "v", ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, preventDefault: vi.fn() } as unknown as KeyboardEvent;
  }

  it("saves a pasted image on the terminal host and types its shell-escaped path", async () => {
    terminalApiMock.pasteImage.mockReset().mockResolvedValue({ path: "/tmp/paperclip pasted/shot.png", bytes: 4 });
    const { socket } = await connected();
    const image = new File([new Uint8Array([1, 2, 3, 4])], "image.png", { type: "image/png" });
    const event = pasteEvent(["Files"], image);

    await act(async () => {
      container.querySelector('[data-testid="terminal-screen"]')!.dispatchEvent(event);
    });
    await flush();

    expect(event.defaultPrevented).toBe(true);
    expect(terminalApiMock.pasteImage).toHaveBeenCalledWith("company-1", "session-1", image);
    expect(inputs(socket)).toEqual(["'/tmp/paperclip pasted/shot.png' "]);
  });

  it("leaves a paste that carries text to the terminal's normal text paste", async () => {
    terminalApiMock.pasteImage.mockReset();
    await connected();
    const image = new File([new Uint8Array([1])], "image.png", { type: "image/png" });
    const event = pasteEvent(["text/plain", "Files"], image);

    await act(async () => {
      container.querySelector('[data-testid="terminal-screen"]')!.dispatchEvent(event);
    });
    await flush();

    expect(event.defaultPrevented).toBe(false);
    expect(terminalApiMock.pasteImage).not.toHaveBeenCalled();
  });

  it("sends Ctrl+V to the shell in typing order when the clipboard holds no image", async () => {
    terminalApiMock.pasteImage.mockReset();
    const { socket, terminal } = await connected();
    const clipboard = stubClipboard([{ "text/plain": new Blob(["hello"], { type: "text/plain" }) }]);

    expect(terminal.keyHandler!(ctrlV())).toBe(false);
    await act(async () => terminal.emitData("x"));
    expect(inputs(socket)).toEqual([]);

    await act(async () => clipboard.release());
    await flush();

    expect(inputs(socket)).toEqual(["\x16", "x"]);
    expect(terminalApiMock.pasteImage).not.toHaveBeenCalled();
  });

  it("turns Ctrl+V with an image in the clipboard into a pasted image path", async () => {
    terminalApiMock.pasteImage.mockReset().mockResolvedValue({ path: "/tmp/p/shot.png", bytes: 1 });
    const { socket, terminal } = await connected();
    const image = new Blob([new Uint8Array([9])], { type: "image/png" });
    const clipboard = stubClipboard([{ "image/png": image }]);

    terminal.keyHandler!(ctrlV());
    await act(async () => clipboard.release());
    await flush();

    expect(terminalApiMock.pasteImage).toHaveBeenCalledWith("company-1", "session-1", image);
    expect(inputs(socket)).toEqual(["/tmp/p/shot.png "]);
  });

  it("prefers the image when Ctrl+V finds both an image and text in the clipboard", async () => {
    terminalApiMock.pasteImage.mockReset().mockResolvedValue({ path: "/tmp/p/both.png", bytes: 1 });
    const { socket, terminal } = await connected();
    const image = new Blob([new Uint8Array([7])], { type: "image/png" });
    const clipboard = stubClipboard([{ "text/plain": new Blob(["caption"], { type: "text/plain" }), "image/png": image }]);

    terminal.keyHandler!(ctrlV());
    await act(async () => clipboard.release());
    await flush();

    expect(terminalApiMock.pasteImage).toHaveBeenCalledWith("company-1", "session-1", image);
    expect(inputs(socket)).toEqual(["/tmp/p/both.png "]);
  });

  it("reports a missing session so the owner can start a new one", async () => {
    terminalApiMock.createToken.mockRejectedValue(new ApiError("Terminal session not found", 404, null));
    const onUnavailable = vi.fn();
    await mount(onUnavailable);
    await flush();

    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(view()?.dataset.connection).toBe("failed");
  });

  it("does not ask for a new session when access is refused", async () => {
    terminalApiMock.createToken.mockRejectedValue(new ApiError("Instance admin access required", 403, null));
    const onUnavailable = vi.fn();
    await mount(onUnavailable);
    await flush();

    expect(onUnavailable).not.toHaveBeenCalled();
  });
});
