import { useEffect, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { AgentRole } from "@tickernelz/paperclip-pro-shared";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  AGENT_ROLE_OPTIONS,
  CEO_ACCESS_WARNING,
  CEO_ROLE,
  agentRoleLabel,
  roleChangeTouchesCeo,
  useAgentRoleChange,
  type AgentRoleTarget,
} from "./use-agent-role-change";

function keepRowStill(event: MouseEvent<HTMLElement>) {
  event.stopPropagation();
  if (event.currentTarget.contains(event.target as Node)) event.preventDefault();
}

function ceoConfirmTitle(name: string, nextRole: string): string {
  if (nextRole === CEO_ROLE) return `Make ${name} a CEO agent?`;
  return `Change ${name} from CEO to ${agentRoleLabel(nextRole)}?`;
}

export function RoleChangeConfirmDialog({
  agentName,
  nextRole,
  onConfirm,
  onCancel,
}: {
  agentName: string;
  nextRole: AgentRole | null;
  onConfirm: (role: AgentRole) => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog open={nextRole !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent data-testid="agent-role-confirm">
        <AlertDialogHeader>
          <AlertDialogTitle>{nextRole ? ceoConfirmTitle(agentName, nextRole) : null}</AlertDialogTitle>
          <AlertDialogDescription data-testid="agent-role-ceo-warning">
            {CEO_ACCESS_WARNING}
            {nextRole && nextRole !== CEO_ROLE ? ` ${agentName} will lose that access.` : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="agent-role-confirm-cancel">Cancel</AlertDialogCancel>
          <AlertDialogAction data-testid="agent-role-confirm-apply" onClick={() => nextRole && onConfirm(nextRole)}>
            Change role
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function AgentRoleEditor({
  agent,
  companyId,
  className,
}: {
  agent: AgentRoleTarget;
  companyId?: string | null;
  className?: string;
}) {
  const { changeRole } = useAgentRoleChange(companyId ?? agent.companyId);
  const [open, setOpen] = useState(false);
  const [pendingRole, setPendingRole] = useState<AgentRole | null>(null);
  const [savedRole, setSavedRole] = useState<AgentRole | null>(null);
  const [confirmRole, setConfirmRole] = useState<AgentRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSavedRole(null);
  }, [agent.role]);

  const currentRole = savedRole ?? agent.role;
  const shownRole = pendingRole ?? currentRole;
  const pending = pendingRole !== null;

  const save = async (role: AgentRole) => {
    setPendingRole(role);
    setError(null);
    const result = await changeRole(agent, role);
    setPendingRole(null);
    if (result.ok) setSavedRole(result.role);
    else setError(result.message);
  };

  const pick = (role: AgentRole) => {
    setOpen(false);
    if (role === currentRole) return;
    if (roleChangeTouchesCeo([currentRole], role)) {
      setConfirmRole(role);
      return;
    }
    void save(role);
  };

  const openOnEnter = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!pending) setOpen(true);
  };

  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5" onClick={keepRowStill}>
      <Popover open={open} onOpenChange={(next) => setOpen(pending ? false : next)}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex min-w-0 cursor-pointer items-center gap-1 rounded-sm px-1 -mx-1 text-left transition-colors hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-accent aria-busy:cursor-progress",
              className,
            )}
            aria-label={`Role for ${agent.name}: ${agentRoleLabel(shownRole)}`}
            aria-busy={pending || undefined}
            onKeyDown={openOnEnter}
            data-testid={`agent-role-${agent.id}`}
          >
            <span className="truncate">{agentRoleLabel(shownRole)}</span>
            {pending ? (
              <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
            ) : (
              <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-44 p-1">
          <div role="listbox" aria-label={`Role for ${agent.name}`} data-testid={`agent-role-options-${agent.id}`}>
            {AGENT_ROLE_OPTIONS.map((option) => {
              const selected = option.value === currentRole;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  data-testid={`agent-role-option-${agent.id}`}
                  data-value={option.value}
                  onClick={() => pick(option.value)}
                >
                  <span>{option.label}</span>
                  {selected ? <Check className="size-3.5 shrink-0" aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
      {error ? (
        <span className="truncate text-xs text-destructive" role="alert" title={error} data-testid={`agent-role-error-${agent.id}`}>
          {error}
        </span>
      ) : null}
      <RoleChangeConfirmDialog
        agentName={agent.name}
        nextRole={confirmRole}
        onCancel={() => setConfirmRole(null)}
        onConfirm={(role) => {
          setConfirmRole(null);
          void save(role);
        }}
      />
    </span>
  );
}
