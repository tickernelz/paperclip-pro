import type { ReactNode } from "react";
import { Lock, Server, SquareTerminal } from "lucide-react";
import type { TerminalSshHost } from "@tickernelz/wardmote-shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface StartOptionProps {
  icon: ReactNode;
  title: string;
  description: string;
  note?: string | null;
  disabled?: boolean;
  onClick: () => void;
  testId: string;
}

function StartOption({ icon, title, description, note, disabled, onClick, testId }: StartOptionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-describedby={note ? `${testId}-note` : undefined}
      data-testid={testId}
      className={cn(
        "group flex min-h-36 flex-col items-start gap-3 rounded-lg border border-line bg-bg-2 p-5 text-left transition-colors motion-reduce:transition-none",
        "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        disabled ? "cursor-not-allowed opacity-70" : "hover:border-line-strong hover:bg-bg-3",
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-md border border-line bg-bg text-ink-2 group-hover:text-ink">
        {icon}
      </span>
      <span className="flex flex-col gap-1">
        <span className="text-base font-medium text-ink">{title}</span>
        <span className="text-sm text-ink-3">{description}</span>
      </span>
      {note ? (
        <span id={`${testId}-note`} className="mt-auto flex items-center gap-1.5 text-xs text-ink-3">
          <Lock className="size-3" aria-hidden />
          {note}
        </span>
      ) : null}
    </button>
  );
}

export interface TerminalStartScreenProps {
  localAllowed: boolean;
  creating: boolean;
  onLocal: () => void;
  onSsh: () => void;
  recentHosts: TerminalSshHost[];
  onOpenHost: (host: TerminalSshHost) => void;
}

export function TerminalStartScreen({ localAllowed, creating, onLocal, onSsh, recentHosts, onOpenHost }: TerminalStartScreenProps) {
  return (
    <div className="flex flex-1 items-start justify-center overflow-y-auto p-4 sm:items-center sm:p-8" data-testid="terminal-start">
      <div className="flex w-full max-w-2xl flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-ink">Open a terminal</h2>
          <p className="text-sm text-ink-3">Choose where the shell runs. You can open more later from the toolbar.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <StartOption
            testId="terminal-start-local"
            icon={<SquareTerminal className="size-5" aria-hidden />}
            title="Local terminal"
            description="A shell on the Wardmote server, as the user that runs Wardmote."
            note={localAllowed ? null : "Needs instance admin access."}
            disabled={!localAllowed || creating}
            onClick={onLocal}
          />
          <StartOption
            testId="terminal-start-ssh"
            icon={<Server className="size-5" aria-hidden />}
            title="SSH terminal"
            description={
              localAllowed
                ? "Connect to a host from ~/.ssh/config or an SSH environment, or add a new host."
                : "Connect to an SSH environment registered for this company."
            }
            disabled={creating}
            onClick={onSsh}
          />
        </div>
        {recentHosts.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-3">Recent</span>
            {recentHosts.map((host) => (
              <Button key={host.id} type="button" variant="secondary" size="xs" disabled={creating} onClick={() => onOpenHost(host)}>
                <Server aria-hidden />
                {host.name}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
