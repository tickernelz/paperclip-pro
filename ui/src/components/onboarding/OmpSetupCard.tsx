import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { Check, ChevronRight, Copy, ExternalLink, Loader2, RefreshCw, SquareTerminal } from "lucide-react";
import { AGENT_FALLBACK_MODELS_MAX, type IssueRunModelOverrideOption } from "@tickernelz/paperclip-pro-shared";

import {
  ComboboxField,
  MODEL_SEARCH_PLACEHOLDER,
  ModelListCount,
  ModelListField,
} from "../../adapters/model-picker-fields";
import { cn } from "../../lib/utils";
import { CopyText } from "../CopyText";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { Skeleton } from "../ui/skeleton";
import type { OmpSetupStatus } from "./omp-setup";

/** Official OMP install commands, from the oh-my-pi README "Install" section. */
export const OMP_INSTALL_COMMANDS = [
  { platform: "macOS · Linux", command: "curl -fsSL https://omp.sh/install | sh" },
  { platform: "Any OS with Bun", command: "bun install -g @oh-my-pi/pi-coding-agent" },
  { platform: "Windows PowerShell", command: "irm https://omp.sh/install.ps1 | iex" },
] as const;

/** OMP's home page and documentation entry point. */
export const OMP_DOCS_URL = "https://omp.sh";

/** OMP's provider and model routing reference. */
export const OMP_PROVIDERS_DOCS_URL = "https://omp.sh/docs/providers";

const OMP_RECOMMENDATION = "Paperclip Pro is tuned for OMP: model fallback, live steering and thinking control.";

const disclosureTriggerClass =
  "group flex items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground outline-none focus-visible:ring-ring/50 focus-visible:ring-(length:--rad-3)";

function DisclosureChevron() {
  return (
    <ChevronRight
      aria-hidden
      className="size-4 shrink-0 transition-transform duration-(--motion-duration-fast) ease-(--motion-ease-standard) group-data-[state=open]:rotate-90"
    />
  );
}

function CommandRow({ label, command }: { label: string; command: string }) {
  return (
    <li className="space-y-1">
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 py-1 pl-2.5 pr-1">
        <code className="min-w-0 flex-1 break-all py-1 font-mono text-xs leading-relaxed text-foreground">{command}</code>
        <CopyText
          text={command}
          ariaLabel={`Copy command: ${command}`}
          title="Copy"
          className="grid size-7 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-accent"
        >
          <Copy aria-hidden className="size-3.5" />
        </CopyText>
      </div>
    </li>
  );
}

function GuideActions({
  docsHref,
  docsLabel,
  rechecking,
  onCheckAgain,
}: {
  docsHref: string;
  docsLabel: string;
  rechecking: boolean;
  onCheckAgain: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Button type="button" variant="outline" size="sm" onClick={onCheckAgain} disabled={rechecking}>
        {rechecking ? <Loader2 aria-hidden className="animate-spin" /> : <RefreshCw aria-hidden />}
        {rechecking ? "Checking…" : "Check again"}
      </Button>
      <a
        href={docsHref}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground underline decoration-muted-foreground/40 underline-offset-4 transition-colors hover:text-foreground outline-none focus-visible:ring-ring/50 focus-visible:ring-(length:--rad-3)"
      >
        {docsLabel}
        <ExternalLink aria-hidden className="size-3.5" />
      </a>
    </div>
  );
}

function GuideHeading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

function InstalledLine({ version }: { version: string | null }) {
  return (
    <p
      data-testid="omp-setup-installed"
      className="status-chip inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-(length:--text-micro) font-medium"
      style={{ "--sc": "var(--status-task-done)" } as CSSProperties}
    >
      <Check aria-hidden className="size-3.5" />
      {version ? `OMP ${version} installed` : "OMP installed"}
    </p>
  );
}

function InstallGuide({
  status,
  rechecking,
  onCheckAgain,
}: {
  status: Extract<OmpSetupStatus, { kind: "missing" | "broken" }>;
  rechecking: boolean;
  onCheckAgain: () => void;
}) {
  return (
    <div className="space-y-4" data-testid="omp-setup-install-guide">
      {status.kind === "missing" ? (
        <GuideHeading title="Install OMP to continue">
          Paperclip could not find the <code className="font-mono text-xs">omp</code> command. Run one of these in a
          terminal on the machine that runs your agents, then check again.
        </GuideHeading>
      ) : (
        <GuideHeading title="OMP is not working">
          Paperclip found <code className="font-mono text-xs">omp</code>, but it did not start: {status.reason}{" "}
          Reinstall it with one of these commands, then check again.
        </GuideHeading>
      )}
      <ul className="space-y-3">
        {OMP_INSTALL_COMMANDS.map((entry) => (
          <CommandRow key={entry.platform} label={entry.platform} command={entry.command} />
        ))}
      </ul>
      <p className="text-xs leading-relaxed text-muted-foreground">
        OMP keeps its settings, providers and sessions in <code className="font-mono">~/.omp/agent</code>.
      </p>
      <GuideActions docsHref={OMP_DOCS_URL} docsLabel="OMP docs" rechecking={rechecking} onCheckAgain={onCheckAgain} />
    </div>
  );
}

function ProviderGuide({
  version,
  rechecking,
  onCheckAgain,
}: {
  version: string | null;
  rechecking: boolean;
  onCheckAgain: () => void;
}) {
  return (
    <div className="space-y-4" data-testid="omp-setup-provider-guide">
      <InstalledLine version={version} />
      <GuideHeading title="Configure a provider in OMP">
        OMP is installed but lists no models yet. Sign in to a provider or add one, then check again.
      </GuideHeading>
      <ul className="space-y-3">
        <CommandRow label="Run OMP setup" command="omp setup" />
        <CommandRow label="Confirm OMP lists models" command="omp models" />
      </ul>
      <p className="text-xs leading-relaxed text-muted-foreground">
        You can also start <code className="font-mono">omp</code> and sign in with{" "}
        <code className="font-mono">/login</code>. Custom providers go in{" "}
        <code className="font-mono">~/.omp/agent/models.yml</code>.
      </p>
      <GuideActions
        docsHref={OMP_PROVIDERS_DOCS_URL}
        docsLabel="Provider guide"
        rechecking={rechecking}
        onCheckAgain={onCheckAgain}
      />
    </div>
  );
}

function ModelChoice({
  version,
  options,
  model,
  onModelChange,
  fallbackModels,
  onFallbackModelsChange,
  disablePortal,
}: {
  version: string | null;
  options: readonly IssueRunModelOverrideOption[];
  model: string;
  onModelChange: (value: string) => void;
  fallbackModels: readonly string[];
  onFallbackModelsChange: (next: string[]) => void;
  disablePortal?: boolean;
}) {
  const [fallbacksOpen, setFallbacksOpen] = useState(fallbackModels.length > 0);
  return (
    <div className="space-y-5" data-testid="omp-setup-model-choice">
      <InstalledLine version={version} />
      <div className="space-y-1.5">
        <span className="block text-sm font-medium text-foreground">
          Model
        </span>
        <ComboboxField
          value={model}
          options={options}
          onChange={onModelChange}
          label="Model"
          emptyLabel="Choose a model"
          searchPlaceholder={MODEL_SEARCH_PLACEHOLDER}
          disablePortal={disablePortal}
          testId="omp-setup-model"
        />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Required. Your agent runs on this model; the list comes from{" "}
          <code className="font-mono">omp models</code>.
        </p>
      </div>
      <Collapsible open={fallbacksOpen} onOpenChange={setFallbacksOpen}>
        <CollapsibleTrigger asChild>
          <button type="button" className={disclosureTriggerClass} data-testid="omp-setup-fallbacks-toggle">
            <DisclosureChevron />
            Add fallback models
            <span className="font-normal">· optional</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-1.5 pt-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-foreground">Fallback models</span>
            <ModelListCount count={fallbackModels.length} max={AGENT_FALLBACK_MODELS_MAX} />
          </div>
          <ModelListField
            value={fallbackModels}
            options={options}
            maxItems={AGENT_FALLBACK_MODELS_MAX}
            primary={model || null}
            onChange={onFallbackModelsChange}
            label="Fallback models"
            disablePortal={disablePortal}
            testId="omp-setup-fallbacks"
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Tried in order when the main model hits a rate limit, an upstream error or a refusal.
          </p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function CheckingBody() {
  return (
    <div className="space-y-3" data-testid="omp-setup-checking" aria-busy="true">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 aria-hidden className="size-4 animate-spin" />
        Checking whether OMP is installed…
      </p>
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-9 w-full" />
    </div>
  );
}

/** The connect step's primary choice: OMP, with its detection, setup guides and model picker. */
export function OmpSetupCard({
  selected,
  onSelect,
  status,
  rechecking,
  onCheckAgain,
  options,
  model,
  onModelChange,
  fallbackModels,
  onFallbackModelsChange,
  disablePortal,
}: {
  selected: boolean;
  onSelect: () => void;
  status: OmpSetupStatus;
  rechecking: boolean;
  onCheckAgain: () => void;
  options: readonly IssueRunModelOverrideOption[];
  model: string;
  onModelChange: (value: string) => void;
  fallbackModels: readonly string[];
  onFallbackModelsChange: (next: string[]) => void;
  disablePortal?: boolean;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      data-testid="omp-setup"
      className={cn(
        "rounded-md border bg-card transition-(--tp-border-color-background-color) duration-(--motion-duration-fast) ease-(--motion-ease-standard)",
        selected ? "border-foreground/40" : "border-border",
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={cn(
          "flex w-full items-start gap-3 rounded-md p-4 text-left outline-none focus-visible:ring-ring/50 focus-visible:ring-(length:--rad-3)",
          selected ? "cursor-default" : "cursor-pointer hover:bg-accent/40",
        )}
      >
        <span className="flex size-(--sz-30px) shrink-0 items-center justify-center rounded-md bg-foreground text-background">
          <SquareTerminal aria-hidden className="size-4" />
        </span>
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex flex-wrap items-center gap-2">
            <span id={titleId} className="text-sm font-semibold text-foreground">
              OMP
            </span>
            <Badge variant="secondary">Recommended</Badge>
          </span>
          <span className="block text-sm leading-relaxed text-muted-foreground">{OMP_RECOMMENDATION}</span>
        </span>
        <span
          aria-hidden
          className={cn(
            "mt-1 grid size-4 shrink-0 place-items-center rounded-full border",
            selected ? "border-foreground" : "border-border",
          )}
        >
          {selected ? <span className="size-2 rounded-full bg-foreground" /> : null}
        </span>
      </button>
      {selected ? (
        <div className="border-t border-border p-4" aria-live="polite">
          {status.kind === "checking" ? (
            <CheckingBody />
          ) : status.kind === "missing" || status.kind === "broken" ? (
            <InstallGuide status={status} rechecking={rechecking} onCheckAgain={onCheckAgain} />
          ) : status.kind === "no-models" ? (
            <ProviderGuide version={status.version} rechecking={rechecking} onCheckAgain={onCheckAgain} />
          ) : status.kind === "error" ? (
            <div className="space-y-4" data-testid="omp-setup-error">
              <GuideHeading title="Could not check for OMP">{status.message}</GuideHeading>
              <GuideActions docsHref={OMP_DOCS_URL} docsLabel="OMP docs" rechecking={rechecking} onCheckAgain={onCheckAgain} />
            </div>
          ) : (
            <ModelChoice
              version={status.version}
              options={options}
              model={model}
              onModelChange={onModelChange}
              fallbackModels={fallbackModels}
              onFallbackModelsChange={onFallbackModelsChange}
              disablePortal={disablePortal}
            />
          )}
        </div>
      ) : null}
    </section>
  );
}

/** Collapsed disclosure holding every adapter other than OMP. */
export function AnotherAdapterDisclosure({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <button type="button" className={disclosureTriggerClass} data-testid="another-adapter-toggle">
          <DisclosureChevron />
          Use another adapter
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-4" data-testid="another-adapter-content">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
