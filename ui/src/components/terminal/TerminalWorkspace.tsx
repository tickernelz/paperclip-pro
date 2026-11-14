import { Fragment, useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Columns2, Plus, Server, SquareTerminal, X } from "lucide-react";
import type {
  CreateTerminalSessionRequest,
  SshConfigHostSettings,
  TerminalSession,
  TerminalSshHost,
} from "@tickernelz/wardmote-shared";
import { accessApi } from "@/api/access";
import { environmentsApi } from "@/api/environments";
import { terminalApi, terminalQueryKeys } from "@/api/terminal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable-panels";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { SshHostForm, settingsFromSavedHost, type SshHostFormMode } from "./SshHostForm";
import { SshHostPicker, environmentTargetKey, hostTargetKey, type SshPickerEnvironment } from "./SshHostPicker";
import { TerminalStartScreen } from "./TerminalStartScreen";
import { TerminalView } from "./TerminalView";
import { recentSshTargets, rememberSshTarget, rememberedTests } from "./ssh-host-memory";
import { canOpenLocalTerminal, terminalAccessErrorMessage } from "./terminal-access";

interface TerminalLayout {
  panes: string[];
  focused: number;
}

const MAX_PANES = 2;

function layoutKey(companyId: string) {
  return `wardmote:terminal-layout:v1:${companyId}`;
}

function titlesKey(companyId: string) {
  return `wardmote:terminal-titles:v1:${companyId}`;
}

function readJson(key: string): unknown {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
}

function readLayout(companyId: string): TerminalLayout {
  const raw = readJson(layoutKey(companyId)) as Partial<TerminalLayout> | null;
  const panes = Array.isArray(raw?.panes) ? raw.panes.filter((id): id is string => typeof id === "string").slice(0, MAX_PANES) : [];
  const focused = typeof raw?.focused === "number" && raw.focused >= 0 && raw.focused < panes.length ? raw.focused : 0;
  return { panes, focused };
}

function readTitles(companyId: string): Record<string, string> {
  const raw = readJson(titlesKey(companyId));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function reconcileLayout(layout: TerminalLayout, sessions: TerminalSession[]): TerminalLayout {
  const known = new Set(sessions.map((session) => session.id));
  const panes = layout.panes.filter((id, index) => known.has(id) && layout.panes.indexOf(id) === index);
  if (panes.length === 0 && sessions.length > 0) panes.push(sessions[0]!.id);
  const focused = Math.min(layout.focused, Math.max(0, panes.length - 1));
  return { panes, focused };
}

function sameLayout(left: TerminalLayout, right: TerminalLayout) {
  return left.focused === right.focused && left.panes.length === right.panes.length && left.panes.every((id, index) => id === right.panes[index]);
}

export function TerminalWorkspace({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();
  const sessionsKey = terminalQueryKeys.sessions(companyId);
  const [layout, setLayout] = useState<TerminalLayout>(() => readLayout(companyId));
  const [titles, setTitles] = useState<Record<string, string>>(() => readTitles(companyId));
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [form, setForm] = useState<{ mode: SshHostFormMode; key: number } | null>(null);
  const [recent, setRecent] = useState<string[]>(() => recentSshTargets(companyId));
  const [tests, setTests] = useState(() => rememberedTests(companyId));
  const boardAccessQuery = useQuery({
    queryKey: queryKeys.access.currentBoardAccess,
    queryFn: () => accessApi.getCurrentBoardAccess(),
  });
  const localAllowed = canOpenLocalTerminal(boardAccessQuery.data);

  const sessionsQuery = useQuery({
    queryKey: sessionsKey,
    queryFn: () => terminalApi.list(companyId),
  });
  const environmentsQuery = useQuery({
    queryKey: queryKeys.environments.list(companyId),
    queryFn: () => environmentsApi.list(companyId),
    enabled: sessionsQuery.isSuccess,
  });
  const sessions = useMemo(() => sessionsQuery.data ?? [], [sessionsQuery.data]);
  const sshEnvironments = useMemo(
    () => (environmentsQuery.data ?? []).filter((environment) => environment.driver === "ssh"),
    [environmentsQuery.data],
  );
  const sshHostsQuery = useQuery({
    queryKey: terminalQueryKeys.sshHosts(companyId),
    queryFn: () => terminalApi.listSshHosts(companyId),
    enabled: localAllowed,
  });
  const sshHosts = useMemo(() => sshHostsQuery.data?.hosts ?? [], [sshHostsQuery.data]);
  const sshConfigHosts = useMemo(() => sshHosts.filter((host) => host.source === "config"), [sshHosts]);
  const savedSshHosts = useMemo(() => sshHosts.filter((host) => host.source === "saved"), [sshHosts]);

  useEffect(() => {
    if (!sessionsQuery.isSuccess) return;
    setLayout((current) => {
      const next = reconcileLayout(current, sessions);
      return sameLayout(current, next) ? current : next;
    });
  }, [sessions, sessionsQuery.isSuccess]);

  useEffect(() => {
    writeJson(layoutKey(companyId), layout);
  }, [companyId, layout]);

  const upsertSession = useCallback((session: TerminalSession) => {
    queryClient.setQueryData<TerminalSession[]>(sessionsKey, (current = []) =>
      current.some((entry) => entry.id === session.id)
        ? current.map((entry) => (entry.id === session.id ? session : entry))
        : [...current, session],
    );
  }, [queryClient, sessionsKey]);

  const showInPane = useCallback((sessionId: string, pane?: number) => {
    setLayout((current) => {
      const existing = current.panes.indexOf(sessionId);
      if (existing >= 0) return { ...current, focused: existing };
      const target = pane ?? current.focused;
      const panes = [...current.panes];
      if (target >= panes.length) panes.push(sessionId);
      else panes[target] = sessionId;
      return { panes: panes.slice(0, MAX_PANES), focused: Math.min(target, MAX_PANES - 1) };
    });
  }, []);

  const createMutation = useMutation({
    mutationFn: (input: { body: CreateTerminalSessionRequest; pane?: number }) => terminalApi.create(companyId, input.body),
    onSuccess: (session, input) => {
      setActionError(null);
      upsertSession(session);
      showInPane(session.id, input.pane);
    },
    onError: (error) => setActionError(terminalAccessErrorMessage(error, "Could not open a terminal session.")),
  });

  const deleteMutation = useMutation({
    mutationFn: (sessionId: string) => terminalApi.remove(companyId, sessionId),
    onSuccess: (_result, sessionId) => {
      setActionError(null);
      queryClient.setQueryData<TerminalSession[]>(sessionsKey, (current = []) => current.filter((entry) => entry.id !== sessionId));
      setLayout((current) => {
        const panes = current.panes.filter((id) => id !== sessionId);
        return { panes, focused: Math.min(current.focused, Math.max(0, panes.length - 1)) };
      });
      setTitles((current) => {
        if (!(sessionId in current)) return current;
        const { [sessionId]: _removed, ...rest } = current;
        writeJson(titlesKey(companyId), rest);
        return rest;
      });
    },
    onError: (error) => setActionError(terminalAccessErrorMessage(error, "Could not close the terminal session.")),
  });

  const createLocal = (pane?: number) => createMutation.mutate({ body: { kind: "local" }, pane });
  const remember = (targetKey: string) => setRecent(rememberSshTarget(companyId, targetKey));
  const openEnvironment = (environment: SshPickerEnvironment) => {
    setPickerOpen(false);
    remember(environmentTargetKey(environment));
    createMutation.mutate({ body: { kind: "ssh", environmentId: environment.id, title: environment.name } });
  };
  const openHost = (host: TerminalSshHost) => {
    setPickerOpen(false);
    if (host.source === "config") remember(hostTargetKey(host));
    createMutation.mutate({ body: { kind: "local", sshHostId: host.id, title: host.name } });
  };
  const openPicker = () => {
    setTests(rememberedTests(companyId));
    setPickerOpen(true);
  };
  const openForm = (mode: SshHostFormMode) => {
    setPickerOpen(false);
    setForm({ mode, key: Date.now() });
  };
  const closeForm = () => {
    setForm(null);
    setTests(rememberedTests(companyId));
  };
  const onHostSaved = (settings: SshConfigHostSettings, openTerminal: boolean) => {
    closeForm();
    if (!openTerminal) {
      setPickerOpen(true);
      return;
    }
    const host: TerminalSshHost = {
      id: `config:${settings.alias}`,
      source: "config",
      name: settings.alias,
      destination: settings.user ? `${settings.user}@${settings.hostName}` : settings.hostName,
      port: settings.port,
    };
    openHost(host);
  };

  const moveAllMutation = useMutation({
    mutationFn: async (hosts: TerminalSshHost[]) => {
      const failures: string[] = [];
      for (const host of hosts) {
        try {
          await terminalApi.moveSshHostToConfig(companyId, host.id, settingsFromSavedHost(host));
        } catch (error) {
          failures.push(`${host.name}: ${terminalAccessErrorMessage(error, "could not be moved")}`);
        }
      }
      return failures;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: terminalQueryKeys.sshHosts(companyId) }),
    onSuccess: (failures) =>
      setActionError(failures.length === 0 ? null : `Some saved hosts were not moved. Open them one by one to fix: ${failures.join("; ")}`),
    onError: (error) => setActionError(terminalAccessErrorMessage(error, "Saved hosts could not be moved.")),
  });

  const toggleSplit = () => {
    if (layout.panes.length >= MAX_PANES) {
      const kept = layout.panes[layout.focused] ?? layout.panes[0]!;
      setLayout({ panes: [kept], focused: 0 });
      return;
    }
    const spare = sessions.find((session) => !layout.panes.includes(session.id));
    if (spare) showInPane(spare.id, layout.panes.length);
    else if (localAllowed) createLocal(layout.panes.length);
  };

  const titleOf = (session: TerminalSession) => titles[session.id] ?? session.title;

  const commitRename = () => {
    if (!renaming) return;
    const value = renaming.value.trim();
    setTitles((current) => {
      const { [renaming.id]: _previous, ...rest } = current;
      const next = value ? { ...rest, [renaming.id]: value } : rest;
      writeJson(titlesKey(companyId), next);
      return next;
    });
    setRenaming(null);
  };

  const onRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitRename();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setRenaming(null);
    }
  };

  if (sessionsQuery.isLoading) {
    return <p className="p-4 text-sm text-ink-3">Loading terminal sessions…</p>;
  }

  if (sessionsQuery.isError) {
    return (
      <div className="flex h-full min-h-(--sz-60vh) flex-col items-center justify-center gap-2 p-6 text-center" data-testid="terminal-access-error">
        <SquareTerminal className="size-6 text-ink-3" aria-hidden />
        <p className="text-sm font-medium text-ink">Terminal unavailable</p>
        <p className="max-w-md text-sm text-ink-3">
          {terminalAccessErrorMessage(sessionsQuery.error, "Terminal sessions could not be loaded.")}
        </p>
      </div>
    );
  }

  const focusedSessionId = layout.panes[layout.focused] ?? null;
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const creating = createMutation.isPending;

  return (
    <div className="flex h-full min-h-(--sz-60vh) flex-col overflow-hidden rounded-md border border-line" data-testid="terminal-workspace">
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1">
        <div role="tablist" aria-label="Terminal sessions" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {sessions.map((session) => {
            const selected = session.id === focusedSessionId;
            const visible = layout.panes.includes(session.id);
            const title = titleOf(session);
            return (
              <div
                key={session.id}
                className={cn(
                  "group flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs",
                  selected ? "border-focus bg-bg-3 text-ink" : visible ? "border-line text-ink" : "border-transparent text-ink-3 hover:bg-bg-3",
                )}
              >
                {session.kind === "ssh" || session.sshHost ? (
                  <Server className="size-3" aria-hidden />
                ) : (
                  <SquareTerminal className="size-3" aria-hidden />
                )}
                {renaming?.id === session.id ? (
                  <Input
                    autoFocus
                    value={renaming.value}
                    aria-label="Session title"
                    onChange={(event) => setRenaming({ id: session.id, value: event.target.value })}
                    onKeyDown={onRenameKeyDown}
                    onBlur={commitRename}
                    className="h-6 w-32 px-1 text-xs md:text-xs"
                  />
                ) : (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    title="Double-click to rename"
                    className="max-w-48 truncate outline-none focus-visible:underline"
                    onClick={() => showInPane(session.id)}
                    onDoubleClick={() => setRenaming({ id: session.id, value: title })}
                  >
                    {title}
                    {session.status === "exited" ? <span className="ml-1 text-ink-3">(ended)</span> : null}
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`Close ${title}`}
                  className="rounded-sm text-ink-3 hover:text-ink"
                  disabled={deleteMutation.isPending && deleteMutation.variables === session.id}
                  onClick={() => deleteMutation.mutate(session.id)}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
        {localAllowed ? (
          <Button type="button" variant="ghost" size="xs" onClick={() => createLocal()} disabled={creating}>
            <Plus aria-hidden />
            Local
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="xs" onClick={openPicker} disabled={creating} aria-haspopup="dialog">
          <Server aria-hidden />
          SSH
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={layout.panes.length >= MAX_PANES ? "Close split" : "Split terminal"}
          aria-pressed={layout.panes.length >= MAX_PANES}
          onClick={toggleSplit}
          disabled={creating || layout.panes.length === 0}
        >
          <Columns2 aria-hidden />
        </Button>
      </div>
      <SshHostPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        localAllowed={localAllowed}
        hosts={sshHosts}
        hostsLoading={localAllowed && sshHostsQuery.isLoading}
        hostsError={sshHostsQuery.isError ? terminalAccessErrorMessage(sshHostsQuery.error, "SSH hosts could not be loaded.") : null}
        configError={sshHostsQuery.data?.configError ?? null}
        environments={sshEnvironments}
        environmentsLoading={environmentsQuery.isLoading}
        recent={recent}
        tests={tests}
        busy={creating || moveAllMutation.isPending}
        onOpenHost={openHost}
        onOpenEnvironment={openEnvironment}
        onAddHost={() => openForm({ kind: "add" })}
        onEditHost={(host) => {
          if (host.settings) openForm({ kind: "edit", settings: host.settings });
        }}
        onMoveSaved={(host) => openForm({ kind: "move", saved: host, settings: settingsFromSavedHost(host) })}
        onMoveAllSaved={() => moveAllMutation.mutate(savedSshHosts)}
      />
      {form ? (
        <SshHostForm
          key={form.key}
          companyId={companyId}
          open
          onOpenChange={(open) => {
            if (!open) closeForm();
          }}
          mode={form.mode}
          configHosts={sshConfigHosts}
          onSaved={onHostSaved}
          onRemoved={() => {
            closeForm();
            setPickerOpen(true);
          }}
        />
      ) : null}
      {actionError ? (
        <p className="shrink-0 border-b border-line px-3 py-1 text-xs text-bad" role="alert">{actionError}</p>
      ) : null}
      {layout.panes.length === 0 ? (
        <TerminalStartScreen
          localAllowed={localAllowed}
          creating={creating}
          onLocal={() => createLocal()}
          onSsh={openPicker}
          recentHosts={recent
            .map((key) => sshConfigHosts.find((host) => hostTargetKey(host) === key) ?? null)
            .filter((host): host is TerminalSshHost => host !== null)
            .slice(0, 3)}
          onOpenHost={openHost}
        />
      ) : (
        <ResizablePanelGroup className="min-h-0 flex-1">
          {layout.panes.map((sessionId, index) => (
            <Fragment key={sessionId}>
              {index > 0 ? <ResizableHandle /> : null}
              <ResizablePanel id={`terminal-pane-${index}`} minSize="20%">
                <div
                  className={cn("h-full min-h-0", layout.panes.length > 1 && index === layout.focused && "ring-1 ring-inset ring-focus")}
                  onFocusCapture={() => setLayout((current) => (current.focused === index ? current : { ...current, focused: index }))}
                  onMouseDown={() => setLayout((current) => (current.focused === index ? current : { ...current, focused: index }))}
                  data-testid={`terminal-pane-${index}`}
                >
                  <TerminalView
                    companyId={companyId}
                    sessionId={sessionId}
                    active={index === layout.focused}
                    onSessionChange={(session) => {
                      if (sessionById.has(session.id)) upsertSession(session);
                    }}
                    onExit={(exit) => {
                      const session = sessionById.get(sessionId);
                      if (session) upsertSession({ ...session, status: "exited", exitCode: exit.exitCode });
                    }}
                  />
                </div>
              </ResizablePanel>
            </Fragment>
          ))}
        </ResizablePanelGroup>
      )}
    </div>
  );
}
