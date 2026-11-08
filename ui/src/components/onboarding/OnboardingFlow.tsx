import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Clock, Copy, Folder, FileTerminal, Play, RefreshCw, X } from "lucide-react";
import {
  randomAgentAppearance,
  type OnboardingOmpStatus,
  type OnboardingRemoteOmpStatus,
} from "@tickernelz/wardmote-shared";
import { agentsApi } from "../../api/agents";
import { approvalsApi } from "../../api/approvals";
import { ApiError } from "../../api/client";
import { companiesApi } from "../../api/companies";
import { environmentsApi } from "../../api/environments";
import { issuesApi } from "../../api/issues";
import { onboardingOmpApi } from "../../api/onboardingOmp";
import { projectsApi } from "../../api/projects";
import { useCompany } from "../../context/CompanyContext";
import { useDialog } from "../../context/DialogContext";
import { useCloudInstance } from "../../hooks/useCloudInstance";
import { copyTextToClipboard } from "../../lib/clipboard";
import { buildNewAgentRuntimeConfig } from "../../lib/new-agent-runtime-config";
import { companyPrefixFromOnboardingPath, resolveRouteOnboardingOptions } from "../../lib/onboarding-route";
import { queryKeys } from "../../lib/queryKeys";
import { useLocation, useNavigate } from "../../lib/router";
import { cn } from "../../lib/utils";
import { MootMark } from "../MootMark";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogPortal, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import {
  FIRST_AGENT_NAME,
  FIRST_AGENT_ROLE,
  ONBOARDING_STEP_NAMES,
  PROVIDER_OPTIONS,
  checkView,
  companyNameForFolder,
  nextStepAfterCheck,
  nextStepAfterRemote,
  olderCopies,
  statusFailure,
  type StatusFailure,
  recommendedModelLabel,
  signedInProvider,
  taskTitle,
  type OnboardingStepIndex,
  type ProviderChoice,
} from "./onboarding-flow";

const BRAND = "Wardmote";
const POLL_MS = 2_000;
const OMP_STATUS_KEY = ["onboarding", "omp-status"] as const;

type CheckState = "ok" | "bad" | "warn" | "wait" | "run";
type CheckRow = { state: CheckState; label: string; value?: string | null };

const CHECK_ICONS: Record<CheckState, ReactNode> = {
  ok: <Check className="size-3.5" aria-hidden />,
  bad: <X className="size-3.5" aria-hidden />,
  warn: <AlertTriangle className="size-3.5" aria-hidden />,
  wait: <Clock className="size-3.5" aria-hidden />,
  run: <RefreshCw className="size-3.5 motion-safe:animate-spin" aria-hidden />,
};

const CHECK_TONES: Record<CheckState, string> = {
  ok: "bg-ok-soft text-ok",
  bad: "bg-bad-soft text-bad",
  warn: "bg-warn-soft text-warn",
  wait: "bg-bg-3 text-ink-3",
  run: "bg-run-soft text-run",
};

function Checks({ rows, label }: { rows: CheckRow[]; label: string }) {
  return (
    <section aria-label={label} className="rounded-lg border border-line-soft bg-bg-2 px-4 py-1">
      <ul>
        {rows.map((row) => (
          <li key={row.label} data-check={row.state} className="flex items-center gap-2.5 border-b border-line-soft py-2 text-(length:--t-13) last:border-b-0">
            <span className={cn("grid size-5.5 shrink-0 place-items-center rounded-full", CHECK_TONES[row.state])}>{CHECK_ICONS[row.state]}</span>
            <span className="min-w-0">{row.label}</span>
            {row.value ? <span className="ms-auto min-w-0 truncate font-mono text-xs text-ink-3">{row.value}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CommandBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col items-start gap-2">
      <code className="block w-full whitespace-pre-wrap break-all rounded-md border border-line-soft bg-bg-3 px-3 py-2.5 font-mono text-(length:--t-13)">{command}</code>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => {
          void copyTextToClipboard(command).then(() => setCopied(true));
        }}
      >
        {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
        {copied ? "Copied" : "Copy command"}
      </Button>
    </div>
  );
}

function Note({ tone, children }: { tone: "warn" | "info" | "bad"; children: ReactNode }) {
  const tones = { warn: "bg-warn-soft", info: "bg-run-soft", bad: "bg-bad-soft" } as const;
  return (
    <div role={tone === "bad" ? "alert" : "note"} className={cn("flex gap-2.5 rounded-md px-3 py-2.5 text-(length:--t-13)", tones[tone])}>
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  );
}

function Steps({ step }: { step: OnboardingStepIndex }) {
  return (
    <ol aria-label="Setup steps" className="flex flex-wrap items-center gap-1.5 text-xs text-ink-2">
      {ONBOARDING_STEP_NAMES.map((name, index) => (
        <li key={name} className="flex items-center gap-1.5" aria-current={index === step ? "step" : undefined}>
          {index > 0 ? <span aria-hidden className="h-px w-5.5 bg-line" /> : null}
          <span
            className={cn(
              "grid size-5 place-items-center rounded-full border border-line-strong text-(length:--text-micro) font-semibold",
              index < step && "border-ok bg-ok text-bg",
              index === step && "border-accent text-accent",
            )}
          >
            {index < step ? <Check className="size-3" aria-hidden /> : index + 1}
          </span>
          <span className={cn(index === step ? "font-semibold text-ink" : "max-sm:sr-only")}>{name}</span>
        </li>
      ))}
    </ol>
  );
}

function Heading({ title, lede }: { title: string; lede: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 id="onboarding-title" className="text-(length:--t-24) font-semibold tracking-tight sm:text-(length:--t-32) sm:leading-tight">{title}</h1>
      <p className="max-w-130 text-base text-ink-2">{lede}</p>
    </div>
  );
}

function SideText({ title, paragraphs }: { title: string; paragraphs: string[] }) {
  return (
    <>
      <h2 className="text-lg font-semibold">{title}</h2>
      {paragraphs.map((paragraph) => <p key={paragraph} className="text-sm text-ink-2">{paragraph}</p>)}
    </>
  );
}

const WHY_OMP = (
  <SideText
    title="Why OMP"
    paragraphs={[
      `${BRAND} runs every agent on OMP. OMP talks to the model and uses the tools; ${BRAND} assigns work, keeps the record and holds the settings.`,
      "You will not need to open OMP's own settings: models, thinking and tools are set here.",
    ]}
  />
);

function Actions({ children }: { children: ReactNode }) {
  return <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">{children}</div>;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.body as { error?: unknown } | null;
    if (body && typeof body.error === "string") return body.error;
  }
  return error instanceof Error ? error.message : String(error);
}

function OmpFilePicker({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (open: boolean) => void; onPick: (path: string) => void }) {
  const [dir, setDir] = useState<string | null>(null);
  const listing = useQuery({
    queryKey: ["onboarding", "omp-browse", dir],
    queryFn: () => onboardingOmpApi.browse(dir),
    enabled: open,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose omp</DialogTitle>
          <DialogDescription className="truncate font-mono text-xs">{listing.data?.path ?? "…"}</DialogDescription>
        </DialogHeader>
        <ul className="-mx-2 max-h-80 overflow-y-auto">
          {listing.data?.parent ? (
            <li>
              <button type="button" className="flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-start text-sm hover:bg-bg-3" onClick={() => setDir(listing.data?.parent ?? null)}>
                <Folder className="size-4 text-ink-3" aria-hidden />..
              </button>
            </li>
          ) : null}
          {listing.data?.entries.map((entry) => (
            <li key={entry.path}>
              <button
                type="button"
                className="flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-start text-sm hover:bg-bg-3"
                onClick={() => {
                  if (entry.kind === "directory") setDir(entry.path);
                  else {
                    onPick(entry.path);
                    onOpenChange(false);
                  }
                }}
              >
                {entry.kind === "directory" ? <Folder className="size-4 text-ink-3" aria-hidden /> : <FileTerminal className="size-4 text-accent" aria-hidden />}
                <span className="truncate">{entry.name}</span>
              </button>
            </li>
          ))}
          {listing.isError ? <li className="px-2 py-2 text-sm text-bad">{errorMessage(listing.error)}</li> : null}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function CheckOmpScreen({
  status,
  failure,
  command,
  onChooseCommand,
  onRemote,
  onRetry,
}: {
  status: OnboardingOmpStatus | undefined;
  failure: StatusFailure | null;
  command: string | null;
  onChooseCommand: (path: string) => void;
  onRemote: () => void;
  onRetry: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const versionRow = (state: OnboardingOmpStatus): CheckRow =>
    state.state === "ready"
      ? { state: "ok", label: `Version ${state.version}`, value: `needs ${state.minVersion} or newer` }
      : { state: "bad", label: state.version ? `Version ${state.version}` : "Version unknown", value: `needs ${state.minVersion}` };

  if (!status) {
    return (
      <>
        <Heading title="Install OMP" lede="Looking for OMP on this computer." />
        <Checks
          label="OMP checks"
          rows={[failure && !failure.retry
            ? { state: "bad", label: "Looking for omp", value: "stopped" }
            : { state: "run", label: "Looking for omp", value: "every 2 s" }]}
        />
        {failure ? <Note tone="bad">{failure.message}</Note> : null}
      </>
    );
  }
  const view = checkView(status);
  if (view === "old") {
    const copies = olderCopies(status);
    return (
      <>
        <Heading
          title="Update OMP"
          lede={status.version
            ? `OMP ${status.version} is older than ${status.minVersion}, so some settings set here would be ignored.`
            : `The version of OMP could not be read. ${BRAND} needs OMP ${status.minVersion} or newer.`}
        />
        <CommandBlock command={status.updateCommand} />
        <Checks label="OMP checks" rows={[{ state: "ok", label: "omp found", value: status.path }, versionRow(status)]} />
        {copies.length > 0 ? (
          <Note tone="warn">
            Two copies of omp are installed. The older one in {status.path} runs first. Remove it, or update it with the command above.
          </Note>
        ) : null}
      </>
    );
  }
  if (view === "offline") {
    return (
      <>
        <Heading title="You are offline" lede="Installing needs the internet once. Connect, or point to an omp you already copied here." />
        <Checks
          label="OMP checks"
          rows={[
            { state: "bad", label: "omp.sh not reachable", value: "3 tries" },
            command ? versionRow(status) : { state: "wait", label: "Version check" },
          ]}
        />
        <div className="flex flex-col gap-1.5">
          <span id="omp-path-label" className="text-sm font-medium">Path to omp</span>
          <Button type="button" variant="secondary" aria-labelledby="omp-path-label" className="justify-between font-normal" onClick={() => setPickerOpen(true)}>
            <span className={cn("truncate", command ? "font-mono text-xs" : "text-ink-3")}>{command ?? "Choose file"}</span>
            <Folder className="size-4" aria-hidden />
          </Button>
        </div>
        <OmpFilePicker open={pickerOpen} onOpenChange={setPickerOpen} onPick={onChooseCommand} />
        <Actions>
          <Button type="button" variant="secondary" onClick={onRetry}>
            <RefreshCw className="size-3.5" aria-hidden />Try again
          </Button>
        </Actions>
      </>
    );
  }
  return (
    <>
      <Heading title="Install OMP" lede="Run this in a terminal on this computer. This page moves on by itself." />
      <CommandBlock command={status.installCommand} />
      <p className="text-sm text-ink-2">
        {status.os.label} detected ·{" "}
        <a className="inline-flex min-h-6 items-center text-accent underline-offset-2 hover:underline" href="https://omp.sh" target="_blank" rel="noreferrer">Other ways</a>
      </p>
      <Checks
        label="OMP checks"
        rows={[
          status.state === "ready"
            ? { state: "ok", label: "omp found", value: status.path }
            : { state: "run", label: "Looking for omp", value: "every 2 s" },
          status.state === "ready" ? versionRow(status) : { state: "wait", label: `Version ${status.minVersion} or newer` },
          status.models.length > 0
            ? { state: "ok", label: `${status.models.length} models` }
            : { state: "wait", label: "At least one model" },
        ]}
      />
      {status.runtime === "local" ? (
        <Actions>
          <Button type="button" variant="ghost" onClick={onRemote}>Run agents on another machine</Button>
        </Actions>
      ) : null}
    </>
  );
}

function RemoteScreen({
  remote,
  pending,
  error,
  onCheck,
  onLocal,
}: {
  remote: OnboardingRemoteOmpStatus | null;
  pending: boolean;
  error: string | null;
  onCheck: (address: string) => void;
  onLocal: () => void;
}) {
  const [address, setAddress] = useState(remote?.address ?? "");
  const rows: CheckRow[] = remote
    ? [
        remote.connected
          ? { state: "ok", label: "Connected", value: remote.latencyMs !== null ? `${remote.latencyMs} ms` : null }
          : { state: "bad", label: "Not connected", value: remote.error },
        ...(remote.connected
          ? [
              remote.state === "missing"
                ? { state: "bad" as const, label: "omp not found there" }
                : remote.state === "ready"
                  ? { state: "ok" as const, label: `omp ${remote.version} found` }
                  : { state: "bad" as const, label: `omp ${remote.version ?? ""} is too old`.replace("  ", " "), value: "needs 18.1.16" },
              remote.modelCount > 0
                ? { state: "ok" as const, label: `${remote.modelCount} models signed in there` }
                : { state: "bad" as const, label: "No model signed in there", value: "next step" },
            ]
          : []),
      ]
    : [];
  return (
    <>
      <Heading title="Run agents on another machine" lede="OMP must be installed where agents run. We check it over SSH." />
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          onCheck(address.trim());
        }}
        id="onboarding-remote-form"
      >
        <label htmlFor="onboarding-ssh-address" className="text-sm font-medium">SSH address</label>
        <Input
          id="onboarding-ssh-address"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="user@host"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="onboarding-ssh-help"
        />
        <span id="onboarding-ssh-help" className="text-xs text-ink-3">Uses your SSH keys. The working folder is your home folder unless you change it later.</span>
      </form>
      {rows.length > 0 ? <Checks label="Remote checks" rows={rows} /> : null}
      {error ? <Note tone="bad">{error}</Note> : null}
      <Actions>
        <Button type="button" variant="ghost" onClick={onLocal}>Use this computer</Button>
        <span className="flex-1" />
        <Button type="submit" form="onboarding-remote-form" disabled={pending || address.trim().length === 0}>
          {pending ? "Checking…" : "Continue"}
        </Button>
      </Actions>
    </>
  );
}

function ConnectScreen({
  remote,
  bundled,
  onSignedIn,
}: {
  remote: OnboardingRemoteOmpStatus | null;
  bundled: boolean;
  onSignedIn: () => void;
}) {
  const [choice, setChoice] = useState<ProviderChoice>("anthropic");
  const [waiting, setWaiting] = useState(false);
  const login = useMutation({
    mutationFn: (provider: Exclude<ProviderChoice, "other">) => onboardingOmpApi.login(provider),
  });
  const selected = PROVIDER_OPTIONS.find((option) => option.id === choice)!;
  const runsElsewhere = remote !== null || bundled;
  useEffect(() => {
    if (!waiting && !runsElsewhere) return;
    const timer = window.setInterval(onSignedIn, POLL_MS);
    return () => window.clearInterval(timer);
  }, [waiting, runsElsewhere, onSignedIn]);
  const loginCommand = choice === "other" ? "omp login" : `omp login ${choice}`;

  function start() {
    if (choice === "other") {
      setWaiting(true);
      return;
    }
    const popup = window.open("about:blank", "_blank");
    login.mutate(choice, {
      onSuccess: (result) => {
        if (popup) popup.location.href = result.url;
        else window.open(result.url, "_blank", "noopener");
        setWaiting(true);
      },
      onError: () => popup?.close(),
    });
  }

  return (
    <>
      <Heading title="Connect a model" lede="OMP has no model signed in yet. Pick where your model comes from." />
      <div role="radiogroup" aria-label="Model provider" className="flex flex-col gap-2">
        {PROVIDER_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={choice === option.id}
            onClick={() => setChoice(option.id)}
            className={cn(
              "flex min-h-12 items-center gap-3 rounded-md border border-line-strong bg-bg-2 px-3.5 py-2.5 text-start",
              choice === option.id && "border-accent ring-1 ring-inset ring-accent",
            )}
          >
            <span className={cn("grid size-4 shrink-0 place-items-center rounded-full border border-line-strong", choice === option.id && "border-accent")}>
              {choice === option.id ? <span className="size-2 rounded-full bg-accent" /> : null}
            </span>
            <span className="flex flex-col">
              <b className="text-sm font-semibold">{option.name}</b>
              <span className="text-xs text-ink-2">{option.detail}</span>
            </span>
          </button>
        ))}
      </div>
      {remote ? (
        <>
          <p className="text-sm text-ink-2">Sign in on {remote.host}. This page moves on by itself.</p>
          <CommandBlock command={`ssh ${remote.username}@${remote.host}${remote.port !== 22 ? ` -p ${remote.port}` : ""} ${loginCommand}`} />
        </>
      ) : bundled ? (
        <>
          <p className="text-sm text-ink-2">Run this inside the container. This page moves on by itself.</p>
          <CommandBlock command={loginCommand} />
        </>
      ) : waiting ? (
        choice === "other"
          ? <Note tone="info">Add the server to OMP's models.yml in ~/.omp/agent. This page moves on by itself.</Note>
          : <Note tone="info">Finish signing in in the browser tab that opened. This page moves on by itself.</Note>
      ) : null}
      {login.isError ? <Note tone="bad">{errorMessage(login.error)}</Note> : null}
      {!runsElsewhere ? (
        <Actions>
          <span className="flex-1" />
          <Button type="button" onClick={start} disabled={login.isPending}>
            {choice === "other" ? "Continue" : `Sign in with ${selected.name}`}
          </Button>
        </Actions>
      ) : null}
    </>
  );
}

function TaskScreen({
  status,
  remote,
  pending,
  error,
  onStart,
}: {
  status: OnboardingOmpStatus | undefined;
  remote: OnboardingRemoteOmpStatus | null;
  pending: boolean;
  error: string | null;
  onStart: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const folder = remote ? remote.homeFolder : status?.projectFolder;
  const model = remote ? null : recommendedModelLabel(status);
  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim()) onStart(text.trim());
      }}
    >
      <Heading title="What should your first agent do?" lede={`${FIRST_AGENT_NAME} starts as soon as you press Start. You can rename it and change its setup later.`} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="onboarding-first-task" className="text-sm font-medium">First task</label>
        <Textarea
          id="onboarding-first-task"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={4}
          placeholder={folder ? `Read the README in ${folder} and list the three riskiest modules.` : undefined}
          autoFocus
        />
      </div>
      <section aria-label="First agent" className="flex flex-col gap-1.5 rounded-lg border border-line-soft bg-bg-2 px-4 py-3 text-sm">
        <div className="flex gap-2"><span className="w-21 shrink-0 text-ink-3">Agent</span>{FIRST_AGENT_NAME}, general assistant</div>
        <div className="flex gap-2"><span className="w-21 shrink-0 text-ink-3">Model</span>{model ? `${model} (recommended)` : "OMP default"}</div>
        <div className="flex min-w-0 gap-2"><span className="w-21 shrink-0 text-ink-3">Folder</span><span className="min-w-0 truncate font-mono text-xs leading-5">{folder ?? "~"}</span></div>
      </section>
      {error ? <Note tone="bad">{error}</Note> : null}
      <Actions>
        <span className="flex-1" />
        <Button type="submit" disabled={pending || text.trim().length === 0}>
          <Play className="size-3.5" aria-hidden />{pending ? "Starting…" : "Start"}
        </Button>
      </Actions>
    </form>
  );
}

export function OnboardingFlow() {
  const { onboardingOpen, onboardingOptions, closeOnboarding, onboardingRouteDismissed, setOnboardingRouteDismissed } = useDialog();
  const { companies, loading: companiesLoading } = useCompany();
  const location = useLocation();
  const cloudInstance = useCloudInstance();
  const companyPrefix = companyPrefixFromOnboardingPath(location.pathname);
  const routeOptions = companyPrefix && companiesLoading
    ? null
    : resolveRouteOnboardingOptions({ pathname: location.pathname, companyPrefix, companies, cloudManaged: Boolean(cloudInstance) });
  const open = onboardingOpen || (routeOptions !== null && !onboardingRouteDismissed);
  if (!open) return null;
  const companyId = (onboardingOpen ? onboardingOptions.companyId : routeOptions?.companyId) ?? null;
  return (
    <OnboardingFlowDialog
      companyId={companyId}
      onClose={() => {
        closeOnboarding();
        setOnboardingRouteDismissed(true);
      }}
    />
  );
}

function OnboardingFlowDialog({ companyId, onClose }: { companyId: string | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { setSelectedCompanyId } = useCompany();
  const [step, setStep] = useState<OnboardingStepIndex>(0);
  const [mode, setMode] = useState<"local" | "remote">("local");
  const [command, setCommand] = useState<string | null>(null);
  const [remote, setRemote] = useState<OnboardingRemoteOmpStatus | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: [...OMP_STATUS_KEY, command],
    queryFn: () => onboardingOmpApi.status({ command }),
    retry: (count, error) => (statusFailure(error as ApiError)?.retry ?? true) && count < 2,
    refetchInterval: (query) => {
      if (statusFailure(query.state.error as ApiError | null)?.retry === false) return false;
      return step === 2 && query.state.data ? false : POLL_MS;
    },
  });
  const status = statusQuery.data;
  const failure = statusFailure(statusQuery.error as ApiError | null);
  const networkQuery = useQuery({
    queryKey: [...OMP_STATUS_KEY, "network", command],
    queryFn: () => onboardingOmpApi.status({ command, network: true }),
    enabled: status?.state === "missing" && mode === "local",
    refetchInterval: 30_000,
  });
  const shownStatus = useMemo<OnboardingOmpStatus | undefined>(() => {
    if (!status) return undefined;
    if (status.state !== "missing") return status;
    return { ...status, network: networkQuery.data?.network ?? null };
  }, [status, networkQuery.data]);

  useEffect(() => {
    if (mode !== "local" || !status || step === 2) return;
    const next = nextStepAfterCheck(status);
    if (next !== null && next > step) setStep(next);
  }, [mode, status, step]);

  const remoteCheck = useMutation({
    mutationFn: (address: string) => onboardingOmpApi.remote(address),
    onSuccess: (result) => {
      setRemote(result);
      const next = nextStepAfterRemote(result);
      if (next !== null) setStep(next);
    },
  });

  const recheckRemote = useCallback(() => {
    if (!remote) {
      void queryClient.invalidateQueries({ queryKey: OMP_STATUS_KEY });
      return;
    }
    void onboardingOmpApi.remote(remote.address).then((result) => {
      setRemote(result);
      if (result.modelCount > 0) setStep(2);
    }).catch(() => {});
  }, [remote, queryClient]);

  const launch = useMutation({
    mutationFn: async (text: string) => {
      const folder = mode === "remote" ? remote?.homeFolder ?? null : status?.projectFolder ?? null;
      let targetCompanyId = companyId;
      if (!targetCompanyId) {
        const company = await companiesApi.create({ name: companyNameForFolder(mode === "remote" ? remote?.host : folder) });
        targetCompanyId = company.id;
        await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      }
      let defaultEnvironmentId: string | null = null;
      if (mode === "remote" && remote?.homeFolder) {
        const environment = await environmentsApi.create(targetCompanyId, {
          name: remote.host,
          driver: "ssh",
          config: { host: remote.host, port: remote.port, username: remote.username, remoteWorkspacePath: remote.homeFolder },
        });
        defaultEnvironmentId = environment.id;
      }
      const adapterConfig: Record<string, unknown> = {};
      if (mode === "local" && status?.recommendedModel) adapterConfig.model = status.recommendedModel;
      if (folder) adapterConfig.cwd = folder;
      if (command) adapterConfig.command = command;
      const hire = await agentsApi.hire(targetCompanyId, {
        name: FIRST_AGENT_NAME,
        role: FIRST_AGENT_ROLE,
        appearance: randomAgentAppearance(),
        adapterType: "omp_local",
        adapterConfig,
        onboardingFirstAgent: true,
        runtimeConfig: buildNewAgentRuntimeConfig(),
        ...(defaultEnvironmentId ? { defaultEnvironmentId } : {}),
      });
      if (hire.approval) await approvalsApi.approve(hire.approval.id, "Approved during onboarding first-agent setup.");
      const project = await projectsApi.create(targetCompanyId, {
        name: companyNameForFolder(folder),
        status: "in_progress",
        ...(mode === "local" && folder ? { workspace: { sourceType: "local_path", cwd: folder, isPrimary: true } } : {}),
      });
      const issue = await issuesApi.create(targetCompanyId, {
        title: taskTitle(text),
        description: text,
        status: "todo",
        assigneeAgentId: hire.agent.id,
        projectId: project.id,
      });
      return { companyId: targetCompanyId, issue };
    },
    onMutate: () => setLaunchError(null),
    onError: (error) => setLaunchError(errorMessage(error)),
    onSuccess: async ({ companyId: createdCompanyId, issue }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.companies.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(createdCompanyId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects.list(createdCompanyId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(createdCompanyId) }),
      ]);
      const companies = await companiesApi.list();
      const prefix = companies.find((company) => company.id === createdCompanyId)?.issuePrefix ?? null;
      setSelectedCompanyId(createdCompanyId, { source: "route_sync" });
      onClose();
      const ref = issue.identifier ?? issue.id;
      navigate(prefix ? `/${prefix}/issues/${ref}` : `/issues/${ref}`);
    },
  });

  const side = step === 1
    ? <SideText title="Skipped when OMP is ready" paragraphs={["If OMP already has a signed-in model on this machine, this step is skipped and the best model is picked for you."]} />
    : step === 2
      ? (
        <>
          <h2 className="text-lg font-semibold">{mode === "remote" ? `Found on ${remote?.host ?? "that machine"}` : "Found on this computer"}</h2>
          <Checks
            label="Found"
            rows={mode === "remote"
              ? [
                  { state: "ok", label: `OMP ${remote?.version ?? ""}`.trim() },
                  { state: "ok", label: `${remote?.modelCount ?? 0} models signed in` },
                  { state: "ok", label: "Working folder", value: remote?.homeFolder },
                ]
              : [
                  { state: "ok", label: `OMP ${status?.version ?? ""}`.trim() },
                  { state: "ok", label: `${signedInProvider(status) ?? "Model"} signed in`, value: "imported" },
                  { state: "ok", label: "Project folder", value: status?.projectFolder },
                ]}
          />
        </>
      )
      : WHY_OMP;

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogPortal>
        <div className="fixed inset-0 z-50 bg-bg" />
        <div
          data-testid="onboarding-flow"
          data-step={step}
          role="dialog"
          aria-modal="true"
          aria-labelledby="onboarding-title"
          className="fixed inset-0 z-50 grid overflow-y-auto lg:grid-cols-2"
          onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}
        >
          <main className="flex min-h-dvh min-w-0 flex-col gap-4.5 px-4 py-5 sm:px-8 sm:py-8 lg:px-14 lg:py-10">
            <div className="flex items-center gap-2.5">
              <MootMark className="size-6.5 shrink-0 text-ink" aria-hidden="true" />
              <b className="text-base font-semibold">{BRAND}</b>
            </div>
            <Steps step={step} />
            {step === 0 && mode === "local" ? (
              <CheckOmpScreen
                status={shownStatus}
                failure={failure}
                command={command}
                onChooseCommand={setCommand}
                onRemote={() => setMode("remote")}
                onRetry={() => void queryClient.invalidateQueries({ queryKey: OMP_STATUS_KEY })}
              />
            ) : null}
            {step === 0 && mode === "remote" ? (
              <RemoteScreen
                remote={remote}
                pending={remoteCheck.isPending}
                error={remoteCheck.isError ? errorMessage(remoteCheck.error) : null}
                onCheck={(address) => remoteCheck.mutate(address)}
                onLocal={() => {
                  setMode("local");
                  setRemote(null);
                }}
              />
            ) : null}
            {step === 1 ? <ConnectScreen remote={mode === "remote" ? remote : null} bundled={status?.runtime === "bundled"} onSignedIn={recheckRemote} /> : null}
            {step === 2 ? (
              <TaskScreen
                status={status}
                remote={mode === "remote" ? remote : null}
                pending={launch.isPending}
                error={launchError}
                onStart={(text) => launch.mutate(text)}
              />
            ) : null}
          </main>
          <aside className="hidden min-w-0 flex-col gap-4 border-s border-line-soft bg-bg-3 px-12 py-10 lg:flex">{side}</aside>
        </div>
      </DialogPortal>
    </Dialog>
  );
}
