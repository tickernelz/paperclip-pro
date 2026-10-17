import { useState } from "react";
import type { AgentRole } from "@tickernelz/paperclip-pro-shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/select";
import { InlineBanner } from "@/components/InlineBanner";
import {
  AGENT_ROLE_OPTIONS,
  CEO_ACCESS_WARNING,
  CEO_ROLE,
  agentRoleLabel,
  roleChangeTouchesCeo,
  useAgentRoleChange,
  type AgentRoleChangeResult,
  type AgentRoleTarget,
} from "@/components/agent-role/use-agent-role-change";

function agentCount(count: number): string {
  return `${count} agent${count === 1 ? "" : "s"}`;
}

export function BulkAgentRoleDialog({
  companyId,
  agents,
  open,
  onOpenChange,
}: {
  companyId: string;
  agents: AgentRoleTarget[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { changeRoles } = useAgentRoleChange(companyId);
  const [role, setRole] = useState<AgentRole | "">("");
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState<AgentRoleChangeResult[] | null>(null);

  const currentCeos = agents.filter((agent) => agent.role === CEO_ROLE);
  const touchesCeo = role !== "" && roleChangeTouchesCeo(agents.map((agent) => agent.role), role);
  const succeeded = results?.filter((entry) => entry.ok).length ?? 0;
  const failed = (results?.length ?? 0) - succeeded;

  const close = (next: boolean) => {
    if (applying) return;
    if (!next) {
      setRole("");
      setConfirming(false);
      setResults(null);
    }
    onOpenChange(next);
  };

  const apply = async () => {
    if (role === "") return;
    setApplying(true);
    try {
      setResults(await changeRoles(agents, role));
    } finally {
      setApplying(false);
      setConfirming(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-(--sz-85vh) overflow-y-auto sm:max-w-lg" data-testid="bulk-agent-role-dialog">
        <DialogHeader>
          <DialogTitle>Change role</DialogTitle>
          <DialogDescription data-testid="bulk-agent-role-count">
            Set one role on {agentCount(agents.length)}.
          </DialogDescription>
        </DialogHeader>

        {results ? (
          <div className="space-y-2" data-testid="bulk-agent-role-results">
            <InlineBanner tone={failed > 0 ? "warning" : "info"} compact>
              {succeeded} updated{failed > 0 ? `, ${failed} failed` : ""}.
            </InlineBanner>
            <ul className="space-y-1 text-sm">
              {results.map((entry) => (
                <li
                  key={entry.agentId}
                  className="flex items-start justify-between gap-2"
                  data-testid={`bulk-agent-role-result-${entry.agentId}`}
                  data-status={entry.ok ? "updated" : "failed"}
                >
                  <span className="truncate">{entry.name}</span>
                  {entry.ok ? (
                    <span className="text-right text-muted-foreground">{agentRoleLabel(entry.role)}</span>
                  ) : (
                    <span className="text-right text-xs text-destructive" role="alert">
                      {entry.message}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="block text-sm font-medium" htmlFor="bulk-agent-role-select">
                Role
              </label>
              <NativeSelect
                id="bulk-agent-role-select"
                data-testid="bulk-agent-role-select"
                value={role}
                disabled={applying}
                onChange={(event) => {
                  setRole(event.target.value as AgentRole | "");
                  setConfirming(false);
                }}
              >
                <option value="">Choose a role</option>
                {AGENT_ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {touchesCeo && (
              <div data-testid="bulk-agent-role-ceo-warning">
                <InlineBanner tone="warning" compact title={confirming ? "Confirm the CEO change" : "CEO access"}>
                  {CEO_ACCESS_WARNING}
                  {currentCeos.length > 0 && role !== CEO_ROLE
                    ? ` ${currentCeos.map((agent) => agent.name).join(", ")} will lose that access.`
                    : null}
                </InlineBanner>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)} disabled={applying}>
            {results ? "Close" : "Cancel"}
          </Button>
          {!results && (
            <Button
              data-testid="bulk-agent-role-submit"
              disabled={applying || role === "" || agents.length === 0}
              onClick={() => {
                if (touchesCeo && !confirming) {
                  setConfirming(true);
                  return;
                }
                void apply();
              }}
            >
              {applying
                ? "Applying…"
                : touchesCeo && !confirming
                  ? "Review change"
                  : `Apply to ${agentCount(agents.length)}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
