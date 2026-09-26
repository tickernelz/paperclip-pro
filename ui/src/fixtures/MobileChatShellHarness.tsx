import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "@/context/ThemeContext";
import { InlineEntitySelector } from "@/components/InlineEntitySelector";
import { SearchableSelect } from "@/components/SearchableSelect";
import { MobilePickerSheetHeader } from "@/components/ui/mobile-picker-sheet";
import { composerDockClassName } from "@/components/task-chat/composer-dock";
import { useComposerDockReserve } from "@/components/task-chat/useComposerDockReserve";
import { useMobileNavAutoHide } from "@/hooks/useMobileNavAutoHide";
import { useMobileViewportInsets } from "@/hooks/useMobileViewportInsets";
import { TaskChatWindowScroll } from "@/components/task-chat/useWindowAutoFollow";
import { cn } from "@/lib/utils";
import "@/index.css";

const TASK_PATH = "/PAP/issues/PAP-1";
const COMPANY_PREFIX = "PAP";

const MODEL_OPTIONS = [
  "Agent default (claude-opus-5-5)",
  "deepseek-v3.2 (dashscope-intl/deepseek-v3.2)",
  "deepseek-v4-flash (dashscope-intl/deepseek-v4-flash)",
  "deepseek-v4-flash-0731 (dashscope-intl/deepseek-v4-flash-0731)",
  "deepseek-v4-pro (dashscope-intl/deepseek-v4-pro)",
  "deepseek-v4-pro-0813 (dashscope-intl/deepseek-v4-pro-0813)",
  "glm-5.1 (dashscope-intl/glm-5.1)",
  "glm-5.1-air (dashscope-intl/glm-5.1-air)",
  "kimi-k3-turbo (dashscope-intl/kimi-k3-turbo)",
  "qwen4-max-preview (dashscope-intl/qwen4-max-preview)",
];
const THINKING_OPTIONS = [
  "Agent default (high)",
  "auto",
  "off",
  "minimal",
  "low",
  "medium",
  "high",
];

const messages = Array.from({ length: 24 }, (_, index) => ({
  id: `message-${index}`,
  mine: index % 3 === 0,
  text:
    index % 3 === 0
      ? `semua agents mu sudah memiliki bundle knowledge yang optimal belum? seperti biasakan load skills dan memory terkait dan update skills dan memory tersebut (${index}).`
      : `Komentar terbaru meminta audit bundle knowledge 13 agent (termasuk Jono) dan menjadikan loop self-evolve (load skill+memory → kerja → update skill+memory) wajib. Aku audit bundle yang ada dulu, lalu tulis ulang (${index}).`,
}));

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function MobileBottomNavStub({ visible }: { visible: boolean }) {
  return (
    <nav
      data-testid="mobile-bottom-nav"
      className={cn(
        "fixed bottom-0 left-0 right-0 z-30 bg-border/50 transition-transform duration-200 ease-out dark:bg-muted md:hidden pb-(--sz-safe-bottom)",
        visible ? "translate-y-0" : "translate-y-full",
      )}
      aria-label="Mobile navigation"
    >
      <div className="grid h-16 grid-cols-5 px-1">
        {["Home", "Tasks", "New Task", "Agents", "Inbox"].map((label) => (
          <span
            key={label}
            className="flex min-w-0 flex-col items-center justify-center gap-1 text-(length:--text-nano) font-medium text-muted-foreground"
          >
            <span className="h-(--sz-18px) w-(--sz-18px) rounded-sm bg-muted-foreground/40" />
            <span className="truncate">{label}</span>
          </span>
        ))}
      </div>
    </nav>
  );
}

const params = new URLSearchParams(window.location.search);
const LEGACY_NAV = params.get("legacyNav") === "1";
const LEGACY_PICKER = params.get("legacyPicker") === "1";
const FOOTER_ROWS = params.get("footerRows") === "1";
const SAFE_AREA_PX = Number(params.get("safeArea") ?? "0");

if (SAFE_AREA_PX > 0) {
  const style = document.documentElement.style;
  style.setProperty("--sz-safe-bottom", `${SAFE_AREA_PX}px`);
  style.setProperty("--sz-calc-14", `calc(5rem + ${SAFE_AREA_PX}px)`);
  style.setProperty("--sz-calc-8", `calc(${SAFE_AREA_PX}px + 20px)`);
}

function useLegacyNavAutoHide(): boolean {
  const [visible, setVisible] = useState(true);
  const lastTop = useRef(0);
  useEffect(() => {
    const onScroll = () => {
      const top = window.scrollY || document.documentElement.scrollTop || 0;
      const delta = top - lastTop.current;
      lastTop.current = top;
      if (top <= 24) setVisible(true);
      else if (delta > 8) setVisible(false);
      else if (delta < -8) setVisible(true);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return visible;
}

function OverrideSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const [expanded, setExpanded] = useState<"model" | "thinking" | null>("model");
  const [model, setModel] = useState(MODEL_OPTIONS[0]!);
  const [thinking, setThinking] = useState(THINKING_OPTIONS[0]!);
  useMobileViewportInsets(open);
  if (!open) return null;
  const sections = [
    { key: "model" as const, label: "Model", value: model, options: MODEL_OPTIONS, set: setModel },
    { key: "thinking" as const, label: "OMP thinking override", value: thinking, options: THINKING_OPTIONS, set: setThinking },
  ];
  return (
    <div
      data-radix-popper-content-wrapper=""
      style={
        LEGACY_PICKER
          ? {
              position: "fixed",
              left: "1rem",
              right: "1rem",
              bottom: "var(--mobile-viewport-inset-bottom, 0px)",
              zIndex: 50,
            }
          : { position: "absolute", left: 0, top: 0, transform: "translate(0px, 0px)" }
      }
    >
      <div
        {...(LEGACY_PICKER ? {} : { "data-mobile-entity-picker": "" })}
        data-testid="task-model-override-panel"
        style={
          LEGACY_PICKER
            ? {
                maxHeight:
                  "calc(var(--mobile-viewport-height, 100dvh) - calc(var(--spacing) * 8))",
                overflowY: "auto",
              }
            : undefined
        }
        className="w-full max-w-(--sz-turn-status-popover) rounded-md border border-border bg-popover p-0 text-popover-foreground shadow-md sm:w-(--sz-280px)"
      >
        {LEGACY_PICKER ? null : (
          <MobilePickerSheetHeader
            title="Task model"
            value={model}
            onClose={() => onOpenChange(false)}
          />
        )}
        <div data-mobile-sheet-body="" className="flex min-w-0 flex-col">
          {sections.map((section) => {
            const isOpen = LEGACY_PICKER || expanded === section.key;
            return (
              <div
                key={section.key}
                data-testid={`task-model-override-section-${section.key}`}
                data-expanded={isOpen ? "true" : "false"}
                className={cn(
                  "flex min-w-0 flex-col gap-1 border-b border-border/60 p-2 last:border-b-0",
                  isOpen ? "min-h-0 flex-1" : "shrink-0",
                )}
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  data-testid={`task-model-override-toggle-${section.key}`}
                  onClick={() => setExpanded(isOpen ? null : section.key)}
                  className="flex min-w-0 flex-1 items-baseline justify-between gap-2 px-1 text-left"
                >
                  <span className="shrink-0 text-xs font-medium">{section.label}</span>
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    {section.value}
                  </span>
                </button>
                {isOpen ? (
                  <div
                    data-slot="entity-option-list"
                    className="min-h-0 flex-1 overflow-y-auto overscroll-contain max-sm:max-h-none sm:max-h-48"
                  >
                    {section.options.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => section.set(option)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
                      >
                        <span className="min-w-0 flex-1 truncate">{option}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        {FOOTER_ROWS ? (
          <div
            data-mobile-sheet-controls=""
            data-testid="task-model-override-footer"
            className="shrink-0 border-t border-border/60"
          >
            <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
              <span>Apply to subtasks</span>
              <span className="h-5 w-9 rounded-full bg-muted" />
            </div>
            <div className="flex items-center gap-2 px-3 pb-2 text-xs">
              <span className="flex-1 rounded-md border border-border px-2 py-1 text-center">New subtasks</span>
              <span className="flex-1 rounded-md border border-border px-2 py-1 text-center">New and existing</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Harness() {
  const modernNavVisible = useMobileNavAutoHide(TASK_PATH, COMPANY_PREFIX, true);
  const legacyNavVisible = useLegacyNavAutoHide();
  const navVisible = LEGACY_NAV ? legacyNavVisible : modernNavVisible;
  const [showComposer] = useState(true);
  const [draft, setDraft] = useState("");
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [assignee, setAssignee] = useState("jono");
  const [workspace, setWorkspace] = useState("main");
  const { dockRef, reserve } = useComposerDockReserve(showComposer);
  useMobileViewportInsets(true);

  useEffect(() => {
    document.body.style.overflow = "visible";
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "auto" });
  }, []);

  return (
    <div className="min-h-dvh w-full overflow-x-clip bg-background text-foreground">
      <TaskChatWindowScroll contentKey={`thread:${reserve}`} enabled />
      <div className="sticky top-0 z-20 bg-background/95 px-4 py-3 backdrop-blur">
        <p className="text-sm font-medium">Kelola Agents ZHA-99</p>
      </div>
      <main
        id="main-content"
        data-testid="mobile-main"
        style={
          {
            "--tc-composer-bottom":
              LEGACY_NAV && !navVisible
                ? "calc(env(safe-area-inset-bottom) + 8px)"
                : "var(--sz-calc-14)",
            paddingBottom:
              LEGACY_NAV && !navVisible
                ? "calc(env(safe-area-inset-bottom) + 8px)"
                : undefined,
          } as React.CSSProperties
        }
        className="flex-1 overflow-visible p-4 pb-(--sz-calc-14) outline-none"
      >
        <div data-testid="task-chat-thread" className="flex flex-col gap-3">
          {messages.map((message) => (
            <div
              key={message.id}
              data-testid={`message-${message.id}`}
              className={cn(
                "max-w-[85%] rounded-xl px-3 py-2 text-sm",
                message.mine
                  ? "self-end bg-primary text-primary-foreground"
                  : "self-start bg-muted",
              )}
            >
              {message.text}
            </div>
          ))}
          <div
            data-testid="thread-progress-row"
            className="flex items-center gap-2 rounded-md px-1 py-2 text-xs text-muted-foreground"
          >
            <span className="font-medium text-foreground">Working</span>
            <span>for 1 minute · ran 6 commands, called 9 tools</span>
          </div>
          <div
            data-testid="thread-last-row"
            className="flex items-center gap-2 rounded-md px-1 py-2 text-xs text-muted-foreground"
          >
            Thought through the task
          </div>
        </div>
        {showComposer ? (
          <>
            <div
              ref={dockRef}
              data-testid="task-chat-composer-dock"
              data-composer-reserve={reserve}
              className={composerDockClassName({ isMobile: true, streamlinedUiEnabled: true })}
            >
              <div className="relative isolate flex flex-col">
                <textarea
                  data-testid="composer-input"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={draft.split("\n").length}
                  placeholder="Message Jono (Head Director)…"
                  className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-base outline-none"
                />
                <div className="relative flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    data-testid="task-chat-composer-model-override"
                    onClick={() => setOverrideOpen((current) => !current)}
                    className="flex h-8 min-w-0 shrink items-center gap-1.5 rounded-md px-2.5 text-xs font-medium hover:bg-accent"
                  >
                    <span className="max-w-20 truncate">Auto mode</span>
                  </button>
                  <div data-testid="workspace-selector" className="contents">
                  <SearchableSelect
                    value={workspace}
                    onValueChange={(next) => setWorkspace(next)}
                    placeholder="Workspace"
                    triggerClassName="h-8 max-w-24"
                    groups={[
                      {
                        id: "workspaces",
                        label: "Workspaces",
                        options: [
                          { key: "main", value: "main", label: "main (paperclip-pro worktree, long label)" },
                          { key: "mobile", value: "mobile", label: "mobile-composer-rework (very long branch label here)" },
                        ],
                      },
                    ]}
                    />
                  </div>
                  <InlineEntitySelector
                    value={assignee}
                    onChange={setAssignee}
                    placeholder="Assignee"
                    noneLabel="Unassigned"
                    searchPlaceholder="Search agents…"
                    emptyMessage="No agents found."
                    triggerTestId="assignee-selector"
                    className="h-8 max-w-24 overflow-hidden"
                    renderTriggerValue={(option) => (
                      <span className="truncate">{option?.label ?? "Unassigned"}</span>
                    )}
                    options={[
                      { id: "jono", label: "Jono (Head Director, long descriptive label)" },
                      { id: "rina", label: "Rina (Staff Engineer, long descriptive label)" },
                    ]}
                  />
                </div>
              </div>
            </div>
            <div
              aria-hidden
              data-testid="task-chat-keyboard-spacer"
              className="shrink-0"
              style={{ height: "var(--mobile-viewport-inset-bottom, 0px)" }}
            />
          </>
        ) : null}
      </main>
      <OverrideSheet open={overrideOpen} onOpenChange={setOverrideOpen} />
      <MobileBottomNavStub visible={navVisible} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <MemoryRouter>
      <ThemeProvider>
        <Harness />
      </ThemeProvider>
    </MemoryRouter>
  </QueryClientProvider>,
);
