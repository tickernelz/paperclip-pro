import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Terminal as XTermTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { ImageAddon } from "@xterm/addon-image";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import "@xterm/xterm/css/xterm.css";
import { ArrowDown, ArrowUp, ClipboardPaste, Copy, Download, Eraser, RotateCw, Search, TextSelect, Upload, X } from "lucide-react";
import {
  clampTerminalCols,
  clampTerminalRows,
  type TerminalClientFrame,
  type TerminalSession,
} from "@tickernelz/paperclip-pro-shared";
import { ApiError } from "@/api/client";
import { terminalApi } from "@/api/terminal";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { useCopyToast } from "@/lib/use-copy-action";
import { cn } from "@/lib/utils";
import { buildSameOriginWebSocketUrl } from "@/lib/websocket-url";
import {
  downloadFileName,
  isFatalTerminalError,
  parseTerminalServerFrame,
  reconnectDelayMs,
  resolveTerminalFont,
  resolveTerminalTheme,
  TERMINAL_RECONNECT_BASE_DELAY_MS,
} from "./terminal-frames";
import { pastedImageFromTransfer, readClipboardImage, readTerminalClipboard, shellEscapePath } from "./terminal-clipboard";

export type TerminalConnectionState = "connecting" | "connected" | "reconnecting" | "exited" | "failed";

export interface TerminalExitInfo {
  exitCode: number | null;
  signal: string | null;
}

export interface TerminalViewProps {
  companyId: string;
  sessionId: string;
  active?: boolean;
  className?: string;
  reconnectBaseDelayMs?: number;
  onSessionChange?: (session: TerminalSession) => void;
  onExit?: (exit: TerminalExitInfo) => void;
  onUnavailable?: () => void;
}

const DEFAULT_COLS = 100;
const DEFAULT_ROWS = 30;
const SCROLLBACK_ROWS = 10_000;
const KEEPALIVE_INTERVAL_MS = 25_000;
const FATAL_HTTP_STATUSES = new Set([401, 403, 404, 410]);

const SESSION_GONE_HTTP_STATUSES = new Set([404, 410]);

const SESSION_GONE_FRAME_CODES = new Set(["not_found", "session_exited"]);

const STATUS_LABEL: Record<TerminalConnectionState, string> = {
  connecting: "Connecting",
  connected: "Connected",
  reconnecting: "Reconnecting",
  exited: "Session ended",
  failed: "Disconnected",
};

const STATUS_DOT: Record<TerminalConnectionState, string> = {
  connecting: "bg-amber-500",
  connected: "bg-emerald-500",
  reconnecting: "bg-amber-500",
  exited: "bg-muted-foreground",
  failed: "bg-destructive",
};

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function exitText(exit: TerminalExitInfo): string {
  if (exit.signal) return `Process ended by ${exit.signal}.`;
  if (exit.exitCode !== null) return `Process exited with code ${exit.exitCode}.`;
  return "Process exited.";
}

function hasFiles(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

export function TerminalView({
  companyId,
  sessionId,
  active = true,
  className,
  reconnectBaseDelayMs = TERMINAL_RECONNECT_BASE_DELAY_MS,
  onSessionChange,
  onExit,
  onUnavailable,
}: TerminalViewProps) {
  const screenRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTermTerminal | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const fitRef = useRef<() => void>(() => {});
  const retryRef = useRef<() => void>(() => {});
  const onSessionChangeRef = useRef(onSessionChange);
  const onExitRef = useRef(onExit);
  const onUnavailableRef = useRef(onUnavailable);
  const copyWithToast = useCopyToast();
  const copyWithToastRef = useRef(copyWithToast);
  const reconnectBaseDelayRef = useRef(reconnectBaseDelayMs);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pasteImageRef = useRef<(image: Blob) => Promise<void>>(async () => {});
  const pasteClipboardRef = useRef<() => Promise<void>>(async () => {});

  const [connection, setConnection] = useState<TerminalConnectionState>("connecting");
  const [renderer, setRenderer] = useState<"webgl" | "dom">("dom");
  const [message, setMessage] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [downloadPath, setDownloadPath] = useState("");
  const [dragging, setDragging] = useState(false);
  const [menuHasSelection, setMenuHasSelection] = useState(false);

  onSessionChangeRef.current = onSessionChange;
  onExitRef.current = onExit;
  onUnavailableRef.current = onUnavailable;
  copyWithToastRef.current = copyWithToast;
  reconnectBaseDelayRef.current = reconnectBaseDelayMs;

  useEffect(() => {
    const element = screenRef.current;
    if (!element) return undefined;

    let disposed = false;
    let finished = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let fitFrame: number | null = null;
    let attempt = 0;
    let attached = false;
    let replaysInFlight = 0;
    let heldInput: string[] | null = null;
    let lastSize: { cols: number; rows: number } | null = null;

    const terminal = new XTermTerminal({
      allowProposedApi: true,
      allowTransparency: false,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      cursorBlink: true,
      cursorStyle: "bar",
      cursorInactiveStyle: "outline",
      lineHeight: 1.2,
      scrollback: SCROLLBACK_ROWS,
      theme: resolveTerminalTheme(element),
      ...resolveTerminalFont(element),
    });
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(new WebLinksAddon((event, uri) => {
      event.preventDefault();
      window.open(uri, "_blank", "noopener,noreferrer");
    }));
    terminal.loadAddon(new ClipboardAddon(undefined, {
      readText: () => "",
      writeText: async (_selection, text) => {
        await copyWithToastRef.current(text, "Copied from terminal");
      },
    }));
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = "11";
    terminal.loadAddon(new ImageAddon({ sixelSupport: true, iipSupport: true, kittySupport: true }));
    terminal.open(element);
    terminalRef.current = terminal;
    searchAddonRef.current = searchAddon;

    if (typeof WebGL2RenderingContext !== "undefined") {
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => {
          webgl.dispose();
          if (!disposed) setRenderer("dom");
        });
        terminal.loadAddon(webgl);
        setRenderer("webgl");
      } catch {
        setRenderer("dom");
      }
    }

    const send = (frame: TerminalClientFrame) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      if (!attached && frame.type !== "auth" && frame.type !== "resize") return;
      socket.send(JSON.stringify(frame));
    };

    const sendResize = (force: boolean) => {
      const size = { cols: clampTerminalCols(terminal.cols), rows: clampTerminalRows(terminal.rows) };
      if (!force && lastSize?.cols === size.cols && lastSize.rows === size.rows) return;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      lastSize = size;
      send({ type: "resize", ...size });
    };

    const fitNow = () => {
      try {
        fitAddon.fit();
      } catch {
        return;
      }
      sendResize(false);
    };

    const requestFit = () => {
      if (fitFrame !== null) window.cancelAnimationFrame(fitFrame);
      fitFrame = window.requestAnimationFrame(() => {
        fitFrame = null;
        fitNow();
      });
    };
    fitRef.current = requestFit;

    const fail = (text: string, sessionGone: boolean) => {
      finished = true;
      setConnection("failed");
      setMessage(text);
      const current = socket;
      socket = null;
      if (current && current.readyState < WebSocket.CLOSING) current.close(1000, "client_failed");
      if (sessionGone) onUnavailableRef.current?.();
    };

    const scheduleReconnect = () => {
      if (disposed || finished || reconnectTimer !== null) return;
      const delay = reconnectDelayMs(attempt, reconnectBaseDelayRef.current);
      attempt += 1;
      setConnection("reconnecting");
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, delay);
    };

    const connect = async () => {
      if (disposed || finished) return;
      setConnection(attempt === 0 ? "connecting" : "reconnecting");
      let token;
      try {
        token = await terminalApi.createToken(companyId, sessionId);
      } catch (error) {
        if (disposed) return;
        if (error instanceof ApiError && FATAL_HTTP_STATUSES.has(error.status)) {
          fail(errorText(error, "Terminal session is unavailable."), SESSION_GONE_HTTP_STATUSES.has(error.status));
          return;
        }
        setMessage(errorText(error, "Could not reach the terminal service."));
        scheduleReconnect();
        return;
      }
      if (disposed || finished) return;

      const ws = new WebSocket(buildSameOriginWebSocketUrl(token.websocketPath));
      socket = ws;
      attached = false;
      lastSize = null;

      ws.onopen = () => {
        if (socket !== ws) return;
        send({ type: "auth", token: token.token });
        fitNow();
      };

      ws.onmessage = (event: MessageEvent) => {
        if (socket !== ws) return;
        const frame = parseTerminalServerFrame(event.data);
        if (!frame) return;
        switch (frame.type) {
          case "ready":
            attached = true;
            attempt = 0;
            setConnection("connected");
            setMessage(null);
            onSessionChangeRef.current?.(frame.session);
            sendResize(true);
            return;
          case "replay":
            terminal.reset();
            if (frame.data) {
              replaysInFlight += 1;
              terminal.write(frame.data, () => { replaysInFlight -= 1; });
            }
            return;
          case "output":
            terminal.write(frame.data);
            return;
          case "exit": {
            finished = true;
            const exit = { exitCode: frame.exitCode, signal: frame.signal };
            setConnection("exited");
            setMessage(exitText(exit));
            onExitRef.current?.(exit);
            return;
          }
          case "error":
            if (isFatalTerminalError(frame.code)) fail(frame.message, SESSION_GONE_FRAME_CODES.has(frame.code));
            else setMessage(frame.message);
            return;
          case "pong":
            return;
        }
      };

      ws.onclose = () => {
        if (socket !== ws) return;
        socket = null;
        attached = false;
        scheduleReconnect();
      };
    };

    retryRef.current = () => {
      if (disposed) return;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      finished = false;
      attempt = 0;
      setMessage(null);
      void connect();
    };

    const inputDisposable = terminal.onData((data) => {
      if (replaysInFlight > 0) return;
      if (heldInput) {
        heldInput.push(data);
        return;
      }
      send({ type: "input", data });
    });

    const pasteImageOrControlV = async () => {
      const held: string[] = [];
      heldInput = held;
      let image: Blob | null = null;
      try {
        image = await readClipboardImage();
      } finally {
        heldInput = null;
        if (!image) send({ type: "input", data: "\x16" });
        for (const data of held) send({ type: "input", data });
      }
      if (image && !disposed) await pasteImageRef.current(image);
    };

    const onPasteCapture = (event: ClipboardEvent) => {
      const image = pastedImageFromTransfer(event.clipboardData);
      if (!image) return;
      event.preventDefault();
      event.stopPropagation();
      void pasteImageRef.current(image);
    };
    element.addEventListener("paste", onPasteCapture, true);
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      const key = event.key.toLowerCase();
      if (key === "f" && (event.metaKey || (event.ctrlKey && event.shiftKey))) {
        event.preventDefault();
        setSearchOpen(true);
        return false;
      }
      if (event.ctrlKey && event.shiftKey && key === "c" && terminal.hasSelection()) {
        event.preventDefault();
        void copyWithToastRef.current(terminal.getSelection(), "Copied selection");
        return false;
      }
      if (event.ctrlKey && event.shiftKey && key === "v") {
        event.preventDefault();
        void pasteClipboardRef.current();
        return false;
      }
      if (event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && key === "v") {
        event.preventDefault();
        if (!heldInput) void pasteImageOrControlV();
        return false;
      }
      return true;
    });

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => requestFit());
    resizeObserver?.observe(element);
    const themeObserver = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(() => {
          terminal.options.theme = resolveTerminalTheme(element);
        });
    themeObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    const keepalive = window.setInterval(() => send({ type: "ping" }), KEEPALIVE_INTERVAL_MS);

    fitNow();
    void connect();

    return () => {
      disposed = true;
      window.clearInterval(keepalive);
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (fitFrame !== null) window.cancelAnimationFrame(fitFrame);
      resizeObserver?.disconnect();
      themeObserver?.disconnect();
      element.removeEventListener("paste", onPasteCapture, true);
      inputDisposable.dispose();
      const current = socket;
      socket = null;
      if (current && current.readyState < WebSocket.CLOSING) current.close(1000, "client_closed");
      fitRef.current = () => {};
      retryRef.current = () => {};
      terminalRef.current = null;
      searchAddonRef.current = null;
      terminal.dispose();
    };
  }, [companyId, sessionId]);

  useEffect(() => {
    if (!active) return;
    fitRef.current();
    terminalRef.current?.focus();
  }, [active]);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const findNext = useCallback((backwards = false) => {
    const addon = searchAddonRef.current;
    if (!addon || !searchTerm) return;
    if (backwards) addon.findPrevious(searchTerm);
    else addon.findNext(searchTerm);
  }, [searchTerm]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    searchAddonRef.current?.clearDecorations();
    terminalRef.current?.clearSelection();
    terminalRef.current?.focus();
  }, []);

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      findNext(event.shiftKey);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
    }
  };

  const uploadFiles = useCallback(async (files: File[]) => {
    for (const file of files) {
      setMessage(`Uploading ${file.name}…`);
      try {
        const result = await terminalApi.upload(companyId, sessionId, file);
        setMessage(`Uploaded ${file.name} to ${result.path}`);
      } catch (error) {
        setMessage(`Upload of ${file.name} failed: ${errorText(error, "unknown error")}`);
        return;
      }
    }
    terminalRef.current?.focus();
  }, [companyId, sessionId]);

  const pasteImage = useCallback(async (image: Blob) => {
    setMessage("Uploading pasted image…");
    try {
      const result = await terminalApi.pasteImage(companyId, sessionId, image);
      terminalRef.current?.paste(`${shellEscapePath(result.path)} `);
      setMessage(`Pasted image saved to ${result.path}`);
    } catch (error) {
      setMessage(`Image paste failed: ${errorText(error, "unknown error")}`);
    }
    terminalRef.current?.focus();
  }, [companyId, sessionId]);
  pasteImageRef.current = pasteImage;

  const pasteClipboard = useCallback(async () => {
    const content = await readTerminalClipboard();
    if (content.image) {
      await pasteImageRef.current(content.image);
      return;
    }
    if (content.text) terminalRef.current?.paste(content.text);
    terminalRef.current?.focus();
  }, []);
  pasteClipboardRef.current = pasteClipboard;

  const copySelection = () => {
    const terminal = terminalRef.current;
    if (terminal?.hasSelection()) void copyWithToast(terminal.getSelection(), "Copied selection");
  };

  const runFromMenu = (action: (terminal: XTermTerminal) => void) => {
    const terminal = terminalRef.current;
    if (terminal) action(terminal);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragging(true);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    setDragging(false);
    void uploadFiles(Array.from(event.dataTransfer.files));
  };

  const submitDownload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const path = downloadPath.trim();
    if (!path) return;
    try {
      const blob = await terminalApi.download(companyId, sessionId, path);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = downloadFileName(path);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setDownloadOpen(false);
      setDownloadPath("");
      setMessage(`Downloaded ${path}`);
    } catch (error) {
      setMessage(`Download of ${path} failed: ${errorText(error, "unknown error")}`);
    }
  };

  return (
    <div
      className={cn("relative flex h-full min-h-0 flex-col bg-background", className)}
      data-testid="terminal-view"
      data-session-id={sessionId}
      data-connection={connection}
      data-renderer={renderer}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1 text-xs">
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[connection])} />
        <span className="shrink-0 text-muted-foreground" role="status">{STATUS_LABEL[connection]}</span>
        {message ? <span className="min-w-0 truncate text-muted-foreground" title={message}>{message}</span> : null}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {connection === "failed" ? (
            <Button type="button" variant="ghost" size="xs" onClick={() => retryRef.current()}>
              <RotateCw aria-hidden />
              Reconnect
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Search terminal"
            aria-pressed={searchOpen}
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
          >
            <Search aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Download file from session"
            aria-pressed={downloadOpen}
            onClick={() => setDownloadOpen((open) => !open)}
          >
            <Download aria-hidden />
          </Button>
        </div>
      </div>
      {searchOpen ? (
        <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
          <Input
            ref={searchInputRef}
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Find in terminal"
            aria-label="Find in terminal"
            className="h-7 text-xs md:text-xs"
          />
          <Button type="button" variant="ghost" size="icon-xs" aria-label="Previous match" onClick={() => findNext(true)}>
            <ArrowUp aria-hidden />
          </Button>
          <Button type="button" variant="ghost" size="icon-xs" aria-label="Next match" onClick={() => findNext(false)}>
            <ArrowDown aria-hidden />
          </Button>
          <Button type="button" variant="ghost" size="icon-xs" aria-label="Close search" onClick={closeSearch}>
            <X aria-hidden />
          </Button>
        </div>
      ) : null}
      {downloadOpen ? (
        <form className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1" onSubmit={(event) => void submitDownload(event)}>
          <Input
            value={downloadPath}
            onChange={(event) => setDownloadPath(event.target.value)}
            placeholder="Path relative to the session folder"
            aria-label="Path to download"
            className="h-7 font-mono text-xs md:text-xs"
            autoFocus
          />
          <Button type="submit" variant="outline" size="xs" disabled={!downloadPath.trim()}>
            Download
          </Button>
        </form>
      ) : null}
      <div
        className="relative min-h-0 flex-1 p-1"
        onDragOver={onDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <ContextMenu onOpenChange={(open) => { if (open) setMenuHasSelection(terminalRef.current?.hasSelection() ?? false); }}>
          <ContextMenuTrigger asChild>
            <div
              ref={screenRef}
              role="application"
              aria-label="Terminal"
              data-testid="terminal-screen"
              className="h-full w-full overflow-hidden text-xs [&_.xterm]:h-full [&_.xterm-viewport]:!overflow-y-auto [&_.xterm-viewport]:!bg-transparent"
              onClick={() => terminalRef.current?.focus()}
            />
          </ContextMenuTrigger>
          <ContextMenuContent
            data-testid="terminal-context-menu"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              terminalRef.current?.focus();
            }}
          >
            <ContextMenuItem disabled={!menuHasSelection} onSelect={copySelection}>
              <Copy aria-hidden />
              Copy
              <ContextMenuShortcut>Ctrl+Shift+C</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => void pasteClipboard()}>
              <ClipboardPaste aria-hidden />
              Paste
              <ContextMenuShortcut>Ctrl+Shift+V</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => runFromMenu((terminal) => terminal.selectAll())}>
              <TextSelect aria-hidden />
              Select all
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => setSearchOpen(true)}>
              <Search aria-hidden />
              Find
              <ContextMenuShortcut>Ctrl+Shift+F</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => runFromMenu((terminal) => terminal.clear())}>
              <Eraser aria-hidden />
              Clear scrollback
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => fileInputRef.current?.click()}>
              <Upload aria-hidden />
              Upload file
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => setDownloadOpen(true)}>
              <Download aria-hidden />
              Download file
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          aria-hidden
          tabIndex={-1}
          data-testid="terminal-upload-input"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length > 0) void uploadFiles(files);
          }}
        />
        {dragging ? (
          <div className="pointer-events-none absolute inset-1 flex items-center justify-center rounded-md border-2 border-dashed border-ring bg-background/80 text-sm text-foreground">
            Drop files to upload into the session folder
          </div>
        ) : null}
      </div>
    </div>
  );
}
