import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { ArrowRightLeft, Cloud, Pencil, Plus, Server } from "lucide-react";
import type { TerminalSshHost } from "@tickernelz/wardmote-shared";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Link } from "@/lib/router";
import { cn } from "@/lib/utils";
import type { RememberedTest } from "./ssh-host-memory";

export interface SshPickerEnvironment {
  id: string;
  name: string;
}

export interface SshHostPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  localAllowed: boolean;
  hosts: TerminalSshHost[];
  hostsLoading: boolean;
  hostsError: string | null;
  configError: string | null;
  environments: SshPickerEnvironment[];
  environmentsLoading: boolean;
  recent: string[];
  tests: Record<string, RememberedTest>;
  busy: boolean;
  onOpenHost: (host: TerminalSshHost) => void;
  onOpenEnvironment: (environment: SshPickerEnvironment) => void;
  onAddHost: () => void;
  onEditHost: (host: TerminalSshHost) => void;
  onMoveSaved: (host: TerminalSshHost) => void;
  onMoveAllSaved: () => void;
}

export function hostTargetKey(host: TerminalSshHost): string {
  return `host:${host.id}`;
}

export function environmentTargetKey(environment: SshPickerEnvironment): string {
  return `env:${environment.id}`;
}

const TEST_LABELS: Record<string, { label: string; tone: string }> = {
  ok: { label: "Connected", tone: "bg-ok" },
  host_key_unknown: { label: "Host not trusted yet", tone: "bg-warn" },
};

function TestDot({ test }: { test: RememberedTest | undefined }) {
  if (!test) return null;
  const known = TEST_LABELS[test.status] ?? { label: "Last test failed", tone: "bg-bad" };
  const when = new Date(test.at);
  const title = `${known.label} · tested ${Number.isNaN(when.getTime()) ? "" : when.toLocaleString()}`;
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs text-ink-3" title={title}>
      <span className={cn("size-2 rounded-full", known.tone)} aria-hidden />
      <span className="sr-only sm:not-sr-only">{known.label}</span>
    </span>
  );
}

function HostRow({
  icon,
  name,
  detail,
  badge,
  trailing,
  mono = true,
}: {
  icon: ReactNode;
  name: string;
  detail: string | null;
  mono?: boolean;
  badge?: string | null;
  trailing?: ReactNode;
}) {
  return (
    <>
      {icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-ink">{name}</span>
          {badge ? <span className="shrink-0 rounded-sm border border-line px-1 text-xs text-ink-3">{badge}</span> : null}
        </span>
        {detail ? <span className={cn("truncate text-xs text-ink-3", mono && "font-mono")}>{detail}</span> : null}
      </span>
      {trailing}
    </>
  );
}

function hostDetail(host: TerminalSshHost): string {
  return host.port === null ? host.destination : `${host.destination}:${host.port}`;
}

export function SshHostPicker(props: SshHostPickerProps) {
  const {
    open,
    onOpenChange,
    localAllowed,
    hosts,
    hostsLoading,
    hostsError,
    configError,
    environments,
    environmentsLoading,
    recent,
    tests,
    busy,
  } = props;
  const searchRef = useRef<HTMLInputElement>(null);
  const configHosts = hosts.filter((host) => host.source === "config");
  const savedHosts = hosts.filter((host) => host.source === "saved");
  const byKey = new Map<string, { kind: "host"; host: TerminalSshHost } | { kind: "env"; environment: SshPickerEnvironment }>();
  for (const host of configHosts) byKey.set(hostTargetKey(host), { kind: "host", host });
  for (const environment of environments) byKey.set(environmentTargetKey(environment), { kind: "env", environment });
  const recentEntries = recent.map((key) => ({ key, entry: byKey.get(key) })).filter((item) => item.entry !== undefined);
  const recentKeys = new Set(recentEntries.map((item) => item.key));
  const nothingYet = !hostsLoading && !environmentsLoading && configHosts.length === 0 && environments.length === 0 && savedHosts.length === 0;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "/" || event.target === searchRef.current) return;
    event.preventDefault();
    searchRef.current?.focus();
  };

  const configHostItem = (host: TerminalSshHost, keyPrefix: string) => {
    const editable = Boolean(host.managed && host.settings);
    return (
      <CommandItem
        key={`${keyPrefix}${host.id}`}
        value={`${keyPrefix}${host.id}`}
        keywords={[host.name, host.destination]}
        disabled={busy}
        onSelect={() => props.onOpenHost(host)}
        className="min-h-12 gap-3"
      >
        <HostRow
          icon={<Server aria-hidden />}
          name={host.name}
          detail={hostDetail(host)}
          badge={host.managed ? (editable ? null : "edited by hand") : "~/.ssh/config"}
          trailing={
            <>
              <TestDot test={tests[host.name]} />
              {editable ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Edit ${host.name}`}
                  title="Edit"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onEditHost(host);
                  }}
                >
                  <Pencil aria-hidden />
                </Button>
              ) : null}
            </>
          }
        />
      </CommandItem>
    );
  };

  const environmentItem = (environment: SshPickerEnvironment, keyPrefix: string) => (
    <CommandItem
      key={`${keyPrefix}${environment.id}`}
      value={`${keyPrefix}${environment.id}`}
      keywords={[environment.name, "environment"]}
      disabled={busy}
      onSelect={() => props.onOpenEnvironment(environment)}
      className="min-h-12 gap-3"
    >
      <HostRow icon={<Cloud aria-hidden />} name={environment.name} detail="SSH environment" mono={false} />
    </CommandItem>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-xl" onKeyDown={onKeyDown}>
        <DialogHeader className="border-b border-line px-4 pt-4 pb-3 text-left">
          <DialogTitle>Open an SSH terminal</DialogTitle>
          <DialogDescription>
            {localAllowed
              ? "Pick a host from the server's ~/.ssh/config or an SSH environment."
              : "Pick an SSH environment. Hosts in the server's ~/.ssh/config are for instance admins."}
          </DialogDescription>
        </DialogHeader>
        <Command loop className="rounded-none bg-bg">
          <CommandInput ref={searchRef} placeholder="Search hosts…  (press / to search)" aria-label="Search hosts" />
          <CommandList className="max-h-(--sz-70vh) min-h-(--sz-64)" aria-busy={hostsLoading || environmentsLoading}>
            {hostsLoading || environmentsLoading ? <p className="px-4 py-3 text-sm text-ink-3">Loading hosts…</p> : null}
            {hostsError ? (
              <p className="px-4 py-3 text-sm text-bad" role="alert">
                {hostsError}
              </p>
            ) : null}
            {configError ? <p className="px-4 py-2 text-xs text-ink-3">{configError}</p> : null}
            {nothingYet ? (
              <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
                <Server className="size-6 text-ink-3" aria-hidden />
                <p className="text-sm font-medium text-ink">No SSH hosts yet</p>
                <p className="max-w-sm text-sm text-ink-3">
                  {localAllowed
                    ? "Add a host once and it lands in ~/.ssh/config, ready for this terminal and for agents on this server."
                    : "Ask an instance admin to add an SSH environment you can use."}
                </p>
              </div>
            ) : (
              <CommandEmpty>
                <span className="text-ink-3">No host matches your search.</span>
              </CommandEmpty>
            )}
            {recentEntries.length > 0 ? (
              <CommandGroup heading="Recent">
                {recentEntries.map(({ entry }) =>
                  entry!.kind === "host" ? configHostItem(entry!.host, "recent-") : environmentItem(entry!.environment, "recent-"),
                )}
              </CommandGroup>
            ) : null}
            {configHosts.some((host) => !recentKeys.has(hostTargetKey(host))) ? (
              <CommandGroup heading="SSH hosts">
                {configHosts.filter((host) => !recentKeys.has(hostTargetKey(host))).map((host) => configHostItem(host, ""))}
              </CommandGroup>
            ) : null}
            {environments.some((environment) => !recentKeys.has(environmentTargetKey(environment))) ? (
              <CommandGroup heading="Environments">
                {environments
                  .filter((environment) => !recentKeys.has(environmentTargetKey(environment)))
                  .map((environment) => environmentItem(environment, ""))}
              </CommandGroup>
            ) : null}
            {savedHosts.length > 0 ? (
              <CommandGroup heading="Saved in Wardmote only (not visible to agents)">
                {savedHosts.map((host) => (
                  <CommandItem
                    key={host.id}
                    value={host.id}
                    keywords={[host.name, host.destination]}
                    disabled={busy}
                    onSelect={() => props.onOpenHost(host)}
                    className="min-h-12 gap-3"
                  >
                    <HostRow
                      icon={<Server aria-hidden />}
                      name={host.name}
                      detail={hostDetail(host)}
                      trailing={
                        <Button
                          type="button"
                          variant="secondary"
                          size="xs"
                          onClick={(event) => {
                            event.stopPropagation();
                            props.onMoveSaved(host);
                          }}
                        >
                          <ArrowRightLeft aria-hidden />
                          Move to ssh config
                        </Button>
                      }
                    />
                  </CommandItem>
                ))}
                {savedHosts.length > 1 ? (
                  <div className="flex justify-end px-2 pb-1">
                    <Button type="button" variant="link" size="xs" disabled={busy} onClick={props.onMoveAllSaved}>
                      Move all {savedHosts.length} to ssh config
                    </Button>
                  </div>
                ) : null}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
        <div className="flex flex-col gap-2 border-t border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-3">
            {localAllowed ? (
              <>
                <Link to="/company/settings/instance/environments" className="text-ink-2 underline underline-offset-2 hover:text-ink">
                  SSH environments
                </Link>{" "}
                connect with a key stored in Wardmote.
              </>
            ) : (
              "Only instance admins can add hosts."
            )}
          </p>
          {localAllowed ? (
            <Button type="button" size="sm" onClick={props.onAddHost} disabled={busy}>
              <Plus aria-hidden />
              Add host
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
