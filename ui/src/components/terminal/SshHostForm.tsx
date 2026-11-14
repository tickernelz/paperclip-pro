import { useEffect, useId, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Copy, KeyRound, Loader2, ShieldQuestion, XCircle } from "lucide-react";
import type {
  SshConfigHostSettings,
  SshConnectionTestResult,
  SshKeyInfo,
  TerminalSshHost,
} from "@tickernelz/wardmote-shared";
import { terminalApi, terminalQueryKeys } from "@/api/terminal";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { NativeSelect } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { forgetTest, rememberTest } from "./ssh-host-memory";
import { terminalAccessErrorMessage } from "./terminal-access";

export type SshHostFormMode =
  | { kind: "add" }
  | { kind: "edit"; settings: SshConfigHostSettings }
  | { kind: "move"; saved: TerminalSshHost; settings: SshConfigHostSettings };

type KeyMode = "existing" | "generate" | "paste" | "default";

const ALIAS_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,62}$/;
const HOSTNAME_PATTERN = /^(?:[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?)(?:\.[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?)*$/;
const IPV6_PATTERN = /^(?=.*:)[0-9A-Fa-f:.]{2,45}$/;
const USER_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;
const KEY_NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;
const NAME_RULE = "Use letters, digits, dots, dashes or underscores.";

export function aliasFromName(name: string): string {
  const cleaned = name.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[^A-Za-z0-9_]+/, "").slice(0, 63);
  return cleaned || "host";
}

export function settingsFromSavedHost(host: TerminalSshHost): SshConfigHostSettings {
  const at = host.destination.lastIndexOf("@");
  return {
    alias: aliasFromName(host.name),
    hostName: at >= 0 ? host.destination.slice(at + 1) : host.destination,
    user: at >= 0 ? host.destination.slice(0, at) : null,
    port: host.port,
    identityFile: null,
    proxyJump: null,
    serverAliveInterval: null,
    serverAliveCountMax: null,
  };
}

function wholeNumber(value: string, min: number, max: number): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^[0-9]+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return parsed >= min && parsed <= max ? parsed : undefined;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  useEffect(() => {
    if (copied === "idle") return;
    const timer = window.setTimeout(() => setCopied("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      type="button"
      variant="secondary"
      size="xs"
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => setCopied("done"),
          () => setCopied("failed"),
        );
      }}
    >
      {copied === "done" ? <Check aria-hidden /> : <Copy aria-hidden />}
      <span aria-live="polite">{copied === "done" ? "Copied" : copied === "failed" ? "Copy failed" : label}</span>
    </Button>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-bad">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function PublicKeyBox({ keyInfo, highlight }: { keyInfo: SshKeyInfo; highlight: boolean }) {
  if (!keyInfo.publicKey) {
    return <p className="text-xs text-ink-3">No public key file next to this key, so it cannot be shown.</p>;
  }
  return (
    <div className={cn("flex flex-col gap-2 rounded-md border p-3", highlight ? "border-accent/40 bg-accent/5" : "border-line bg-bg-2")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-ink">
          {highlight ? "Add this public key to ~/.ssh/authorized_keys on the server" : "Public key"}
        </p>
        <CopyButton text={keyInfo.publicKey} label="Copy public key" />
      </div>
      <code className="block max-h-(--sz-64) overflow-auto break-all rounded-sm bg-bg px-2 py-1.5 font-mono text-xs text-ink-2">
        {keyInfo.publicKey}
      </code>
    </div>
  );
}

function TestResult({
  result,
  trusting,
  onTrust,
}: {
  result: SshConnectionTestResult;
  trusting: boolean;
  onTrust: () => void;
}) {
  const ok = result.status === "ok";
  const unknownKey = result.status === "host_key_unknown";
  const Icon = ok ? CheckCircle2 : unknownKey ? ShieldQuestion : XCircle;
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-md border p-3 text-sm",
        ok ? "border-ok/40 bg-ok-soft" : unknownKey ? "border-warn/40 bg-warn-soft" : "border-bad/40 bg-bad-soft",
      )}
      data-testid="ssh-test-result"
    >
      <p className="flex items-start gap-2 text-ink">
        <Icon className={cn("mt-0.5 size-4 shrink-0", ok ? "text-ok" : unknownKey ? "text-warn" : "text-bad")} aria-hidden />
        <span>{result.message}</span>
      </p>
      {unknownKey && result.hostKeys.length > 0 ? (
        <div className="flex flex-col gap-2 pl-6">
          <ul className="flex flex-col gap-1">
            {result.hostKeys.map((key) => (
              <li key={key.fingerprint} className="break-all font-mono text-xs text-ink-2">
                {key.type} {key.fingerprint}
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-3">
            Compare it with <code className="font-mono">ssh-keygen -lf /etc/ssh/ssh_host_*_key.pub</code> on the server.
          </p>
          <div>
            <Button type="button" size="xs" onClick={onTrust} disabled={trusting}>
              {trusting ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
              Trust this host and test again
            </Button>
          </div>
        </div>
      ) : null}
      {result.detail ? (
        <details className="pl-6 text-xs text-ink-3">
          <summary className="cursor-pointer select-none">ssh output</summary>
          <pre className="mt-1 whitespace-pre-wrap break-all font-mono">{result.detail}</pre>
        </details>
      ) : null}
    </div>
  );
}

export interface SshHostFormProps {
  companyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: SshHostFormMode;
  configHosts: TerminalSshHost[];
  onSaved: (settings: SshConfigHostSettings, openTerminal: boolean) => void;
  onRemoved?: (alias: string) => void;
}

export function SshHostForm({ companyId, open, onOpenChange, mode, configHosts, onSaved, onRemoved }: SshHostFormProps) {
  const queryClient = useQueryClient();
  const formId = useId();
  const initial = mode.kind === "add" ? null : mode.settings;
  const [alias, setAlias] = useState(initial?.alias ?? "");
  const [hostName, setHostName] = useState(initial?.hostName ?? "");
  const [user, setUser] = useState(initial?.user ?? "");
  const [port, setPort] = useState(initial?.port === null || initial?.port === undefined ? "" : String(initial.port));
  const [keyMode, setKeyMode] = useState<KeyMode>(mode.kind === "add" || initial?.identityFile ? "existing" : "default");
  const [identityFile, setIdentityFile] = useState(initial?.identityFile ?? "");
  const [newKeyName, setNewKeyName] = useState<string | null>(null);
  const [pastedKey, setPastedKey] = useState("");
  const [pastedName, setPastedName] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [proxyJump, setProxyJump] = useState(initial?.proxyJump ?? "");
  const [keepAlive, setKeepAlive] = useState(initial?.serverAliveInterval === null || initial?.serverAliveInterval === undefined ? "" : String(initial.serverAliveInterval));
  const [countMax, setCountMax] = useState(initial?.serverAliveCountMax === null || initial?.serverAliveCountMax === undefined ? "" : String(initial.serverAliveCountMax));
  const [advancedOpen, setAdvancedOpen] = useState(Boolean(initial?.proxyJump || initial?.serverAliveInterval || initial?.serverAliveCountMax));
  const [attempted, setAttempted] = useState(false);
  const [result, setResult] = useState<SshConnectionTestResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const keysQuery = useQuery({
    queryKey: terminalQueryKeys.sshKeys(companyId),
    queryFn: () => terminalApi.listKeys(companyId),
    enabled: open,
  });
  const keys = keysQuery.data?.keys ?? [];
  const selectedKey = keys.find((key) => key.path === identityFile) ?? null;
  const defaultKeyName = `wardmote_${aliasFromName(alias || "host")}`;
  const keyName = (keyMode === "paste" ? pastedName : newKeyName) ?? defaultKeyName;
  const otherAliases = new Set(
    configHosts.filter((host) => !(mode.kind === "edit" && host.name === mode.settings.alias)).map((host) => host.name.toLowerCase()),
  );

  const trimmedAlias = alias.trim();
  const trimmedHost = hostName.trim();
  const portValue = wholeNumber(port, 1, 65535);
  const keepAliveValue = wholeNumber(keepAlive, 0, 86400);
  const countMaxValue = wholeNumber(countMax, 1, 1000);
  const errors = {
    alias: !trimmedAlias
      ? "Enter a name, for example prod-web."
      : !ALIAS_PATTERN.test(trimmedAlias)
        ? NAME_RULE
        : otherAliases.has(trimmedAlias.toLowerCase())
          ? "A host with this name already exists."
          : null,
    hostName: !trimmedHost
      ? "Enter the server's host name or IP address."
      : HOSTNAME_PATTERN.test(trimmedHost) || IPV6_PATTERN.test(trimmedHost)
        ? null
        : "Enter a host name like example.com or an IP address.",
    user: user.trim() && !USER_PATTERN.test(user.trim()) ? NAME_RULE : null,
    port: portValue === undefined ? "Port must be a number from 1 to 65535." : null,
    key:
      keyMode === "existing" && !identityFile
        ? "Pick a key, or choose another option."
        : keyMode === "generate" || keyMode === "paste"
          ? "Create or save the key first."
          : null,
    keyName: !KEY_NAME_PATTERN.test(keyName) || keyName.endsWith(".pub") ? NAME_RULE : null,
    keepAlive: keepAliveValue === undefined ? "Use whole seconds from 0 to 86400." : null,
    countMax: countMaxValue === undefined ? "Use a whole number from 1 to 1000." : null,
  };
  const invalid = Boolean(errors.alias || errors.hostName || errors.user || errors.port || errors.key || errors.keepAlive || errors.countMax);
  const show = (field: keyof typeof errors, value: string) => (attempted || value.trim() ? errors[field] : null);

  const settings = (): SshConfigHostSettings => ({
    alias: trimmedAlias,
    hostName: trimmedHost,
    user: user.trim() || null,
    port: portValue ?? null,
    identityFile: keyMode === "existing" && identityFile ? identityFile : null,
    proxyJump: proxyJump || null,
    serverAliveInterval: keepAliveValue ?? null,
    serverAliveCountMax: countMaxValue ?? null,
  });

  const refreshKeys = () => queryClient.invalidateQueries({ queryKey: terminalQueryKeys.sshKeys(companyId) });

  const keyMutation = useMutation({
    mutationFn: (body: Parameters<typeof terminalApi.createKey>[1]) => terminalApi.createKey(companyId, body),
    onSuccess: async (created) => {
      setFormError(null);
      setPastedKey("");
      setCreatedKey(created.path);
      queryClient.setQueryData(terminalQueryKeys.sshKeys(companyId), (current: typeof keysQuery.data) =>
        current ? { ...current, keys: [...current.keys.filter((key) => key.path !== created.path), created] } : current,
      );
      setIdentityFile(created.path);
      setKeyMode("existing");
      await refreshKeys();
    },
    onError: (error) => setFormError(terminalAccessErrorMessage(error, "The key could not be saved.")),
  });

  const testMutation = useMutation({
    mutationFn: (input: SshConfigHostSettings) => terminalApi.testConnection(companyId, { host: input }),
    onSuccess: (tested, input) => {
      setFormError(null);
      setResult(tested);
      rememberTest(companyId, input.alias, tested.status);
    },
    onError: (error) => setFormError(terminalAccessErrorMessage(error, "The connection test could not run.")),
  });

  const trustMutation = useMutation({
    mutationFn: async (input: SshConfigHostSettings) => {
      await terminalApi.trustHostKey(companyId, {
        target: { host: input },
        fingerprints: (result?.hostKeys ?? []).map((key) => key.fingerprint),
      });
      return input;
    },
    onSuccess: (input) => testMutation.mutate(input),
    onError: (error) => setFormError(terminalAccessErrorMessage(error, "The host key could not be trusted.")),
  });

  const saveMutation = useMutation({
    mutationFn: async (input: { settings: SshConfigHostSettings; openTerminal: boolean }) => {
      if (mode.kind === "edit") await terminalApi.updateConfigHost(companyId, mode.settings.alias, input.settings);
      else if (mode.kind === "move") await terminalApi.moveSshHostToConfig(companyId, mode.saved.id, input.settings);
      else await terminalApi.addConfigHost(companyId, input.settings);
      return input;
    },
    onSuccess: async (input) => {
      setFormError(null);
      if (mode.kind === "edit" && mode.settings.alias !== input.settings.alias) forgetTest(companyId, mode.settings.alias);
      await queryClient.invalidateQueries({ queryKey: terminalQueryKeys.sshHosts(companyId) });
      onSaved(input.settings, input.openTerminal);
    },
    onError: (error) => setFormError(terminalAccessErrorMessage(error, "The host could not be saved.")),
  });

  const removeMutation = useMutation({
    mutationFn: (target: string) => terminalApi.removeConfigHost(companyId, target),
    onSuccess: async (_result, target) => {
      forgetTest(companyId, target);
      await queryClient.invalidateQueries({ queryKey: terminalQueryKeys.sshHosts(companyId) });
      onRemoved?.(target);
    },
    onError: (error) => setFormError(terminalAccessErrorMessage(error, "The host could not be removed.")),
  });

  const submit = (openTerminal: boolean) => {
    setAttempted(true);
    if (invalid) return;
    saveMutation.mutate({ settings: settings(), openTerminal });
  };

  const runTest = () => {
    setAttempted(true);
    if (invalid) return;
    setResult(null);
    testMutation.mutate(settings());
  };

  const busy = saveMutation.isPending || removeMutation.isPending;
  const title = mode.kind === "edit" ? `Edit ${mode.settings.alias}` : mode.kind === "move" ? `Move ${mode.saved.name} to ssh config` : "Add SSH host";
  const jumpChoices = configHosts.filter((host) => host.name !== trimmedAlias && (mode.kind !== "edit" || host.name !== mode.settings.alias));
  const fieldId = (name: string) => `${formId}-${name}`;
  const describedBy = (name: string, error: string | null) => (error ? `${fieldId(name)}-error` : undefined);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-(--sz-85vh) gap-0 overflow-y-auto p-0 sm:max-w-2xl" data-testid="ssh-host-form">
        <DialogHeader className="border-b border-line px-5 pt-5 pb-4 text-left">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Saved to ~/.ssh/config on the Wardmote server. Agents that run on this server can then use{" "}
            <code className="font-mono text-ink-2">ssh {trimmedAlias || "<name>"}</code>. Agents in a sandbox or on an SSH environment
            run elsewhere and do not see it.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5 px-5 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit(mode.kind !== "edit");
          }}
          noValidate
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={fieldId("alias")} label="Name" hint={<>Used as <code className="font-mono">ssh name</code>.</>} error={show("alias", alias)}>
              <Input
                id={fieldId("alias")}
                value={alias}
                onChange={(event) => setAlias(event.target.value)}
                placeholder="prod-web"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                aria-invalid={Boolean(show("alias", alias))}
                aria-describedby={describedBy("alias", show("alias", alias))}
              />
            </Field>
            <Field id={fieldId("host")} label="Host or IP address" error={show("hostName", hostName)}>
              <Input
                id={fieldId("host")}
                value={hostName}
                onChange={(event) => setHostName(event.target.value)}
                placeholder="203.0.113.10"
                autoComplete="off"
                spellCheck={false}
                inputMode="url"
                aria-invalid={Boolean(show("hostName", hostName))}
                aria-describedby={describedBy("host", show("hostName", hostName))}
              />
            </Field>
            <Field id={fieldId("user")} label="User" hint="Leave empty to use your local user name." error={show("user", user)}>
              <Input
                id={fieldId("user")}
                value={user}
                onChange={(event) => setUser(event.target.value)}
                placeholder="root"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={Boolean(show("user", user))}
                aria-describedby={describedBy("user", show("user", user))}
              />
            </Field>
            <Field id={fieldId("port")} label="Port" hint="Leave empty for 22." error={show("port", port)}>
              <Input
                id={fieldId("port")}
                value={port}
                onChange={(event) => setPort(event.target.value)}
                placeholder="22"
                inputMode="numeric"
                autoComplete="off"
                aria-invalid={Boolean(show("port", port))}
                aria-describedby={describedBy("port", show("port", port))}
              />
            </Field>
          </div>

          <fieldset className="flex min-w-0 flex-col gap-3">
            <legend className="mb-2 flex items-center gap-2 text-sm font-medium text-ink">
              <KeyRound className="size-4 text-ink-3" aria-hidden />
              Key
            </legend>
            <Segmented aria-label="How to sign in" className="flex w-full flex-wrap sm:w-fit">
              {(
                [
                  ["existing", "Key in ~/.ssh"],
                  ["generate", "Create new key"],
                  ["paste", "Paste a key"],
                  ["default", "ssh defaults"],
                ] as const
              ).map(([value, label]) => (
                <SegmentedItem key={value} selected={keyMode === value} onClick={() => setKeyMode(value)} className="flex-1 sm:flex-none">
                  {label}
                </SegmentedItem>
              ))}
            </Segmented>

            {keyMode === "existing" ? (
              <div className="flex flex-col gap-2">
                {keysQuery.isLoading ? (
                  <p className="text-sm text-ink-3">Loading keys…</p>
                ) : keysQuery.isError ? (
                  <p className="text-sm text-bad">{terminalAccessErrorMessage(keysQuery.error, "Keys could not be listed.")}</p>
                ) : keys.length === 0 ? (
                  <p className="text-sm text-ink-3">
                    No private keys in ~/.ssh yet.{" "}
                    <Button type="button" variant="link" size="xs" className="h-auto px-0" onClick={() => setKeyMode("generate")}>
                      Create one
                    </Button>
                  </p>
                ) : (
                  <Field id={fieldId("key")} label="Key file" error={attempted ? errors.key : null}>
                    <NativeSelect
                      id={fieldId("key")}
                      value={identityFile}
                      onChange={(event) => {
                        setIdentityFile(event.target.value);
                        setCreatedKey(null);
                      }}
                      aria-invalid={Boolean(attempted && errors.key)}
                    >
                      <option value="">Choose a key…</option>
                      {keys.map((key) => (
                        <option key={key.path} value={key.path}>
                          {key.name}
                          {key.type ? ` · ${key.type.replace(/^ssh-/, "")}` : ""}
                          {key.fingerprint ? ` · ${key.fingerprint.slice(7, 19)}…` : ""}
                          {key.encrypted ? " · passphrase" : ""}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                )}
                {selectedKey ? (
                  <>
                    {selectedKey.fingerprint ? (
                      <p className="break-all font-mono text-xs text-ink-3">{selectedKey.fingerprint}</p>
                    ) : null}
                    {selectedKey.encrypted ? (
                      <p className="flex items-start gap-2 rounded-md bg-warn-soft p-2 text-xs text-ink">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
                        This key has a passphrase. Agents can only use it while ssh-agent on the server holds it unlocked.
                      </p>
                    ) : null}
                    <PublicKeyBox keyInfo={selectedKey} highlight={createdKey === selectedKey.path} />
                  </>
                ) : null}
              </div>
            ) : null}

            {keyMode === "generate" ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <Field id={fieldId("new-key")} label="New key file name" error={errors.keyName} className="flex-1">
                  <Input
                    id={fieldId("new-key")}
                    value={keyName}
                    onChange={(event) => setNewKeyName(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={keyMutation.isPending || Boolean(errors.keyName)}
                  onClick={() => keyMutation.mutate({ mode: "generate", name: keyName, comment: `${aliasFromName(alias || "host")}@wardmote` })}
                >
                  {keyMutation.isPending ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <KeyRound aria-hidden />}
                  Create ed25519 key
                </Button>
              </div>
            ) : null}

            {keyMode === "paste" ? (
              <div className="flex flex-col gap-3">
                <Field id={fieldId("paste-name")} label="Save as" error={errors.keyName}>
                  <Input
                    id={fieldId("paste-name")}
                    value={keyName}
                    onChange={(event) => setPastedName(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>
                <Field
                  id={fieldId("paste-key")}
                  label="Private key"
                  hint="Stored as ~/.ssh/<name> with mode 600. Wardmote never shows it again."
                >
                  <Textarea
                    id={fieldId("paste-key")}
                    value={pastedKey}
                    onChange={(event) => setPastedKey(event.target.value)}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    className="min-h-32 font-mono text-xs md:text-xs"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={keyMutation.isPending || !pastedKey.trim() || Boolean(errors.keyName)}
                    onClick={() => keyMutation.mutate({ mode: "import", name: keyName, privateKey: pastedKey })}
                  >
                    {keyMutation.isPending ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
                    Save key
                  </Button>
                </div>
              </div>
            ) : null}

            {keyMode === "default" ? (
              <p className="text-sm text-ink-3">
                ssh tries the server's default keys and ssh-agent, as a plain <code className="font-mono">ssh</code> would.
              </p>
            ) : null}
            {attempted && errors.key && !(keyMode === "existing" && keys.length > 0) ? (
              <p className="text-xs text-bad">{errors.key}</p>
            ) : null}
          </fieldset>

          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="-ml-2 w-fit text-ink-2">
                <ChevronDown className={cn("transition-transform motion-reduce:transition-none", advancedOpen && "rotate-180")} aria-hidden />
                More options
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="grid gap-4 pt-3 sm:grid-cols-3">
              <Field id={fieldId("jump")} label="Connect via" hint="Reach this host through another host (ProxyJump).">
                <NativeSelect id={fieldId("jump")} value={proxyJump} onChange={(event) => setProxyJump(event.target.value)}>
                  <option value="">Direct</option>
                  {jumpChoices.map((host) => (
                    <option key={host.id} value={host.name}>
                      {host.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id={fieldId("keepalive")} label="Keep-alive (seconds)" hint="Ping the server so idle sessions stay open." error={show("keepAlive", keepAlive)}>
                <Input
                  id={fieldId("keepalive")}
                  value={keepAlive}
                  onChange={(event) => setKeepAlive(event.target.value)}
                  placeholder="30"
                  inputMode="numeric"
                  autoComplete="off"
                />
              </Field>
              <Field id={fieldId("countmax")} label="Missed pings before giving up" error={show("countMax", countMax)}>
                <Input
                  id={fieldId("countmax")}
                  value={countMax}
                  onChange={(event) => setCountMax(event.target.value)}
                  placeholder="3"
                  inputMode="numeric"
                  autoComplete="off"
                />
              </Field>
            </CollapsibleContent>
          </Collapsible>

          <div className="flex flex-col gap-3 border-t border-line pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="secondary" onClick={runTest} disabled={testMutation.isPending || trustMutation.isPending}>
                {testMutation.isPending ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
                {testMutation.isPending ? "Testing…" : "Test connection"}
              </Button>
              <p className="text-xs text-ink-3">Runs ssh from the server in batch mode. Nothing is saved.</p>
            </div>
            <div aria-live="polite">
              {result ? (
                <TestResult result={result} trusting={trustMutation.isPending || testMutation.isPending} onTrust={() => trustMutation.mutate(settings())} />
              ) : null}
            </div>
          </div>

          {formError ? (
            <p className="rounded-md border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad" role="alert">
              {formError}
            </p>
          ) : null}

          <DialogFooter className="gap-2 sm:items-center sm:justify-between">
            <div className="flex">
              {mode.kind === "edit" ? (
                <Button
                  type="button"
                  variant={confirmRemove ? "delete" : "danger"}
                  size="sm"
                  disabled={busy}
                  onClick={() => (confirmRemove ? removeMutation.mutate(mode.settings.alias) : setConfirmRemove(true))}
                >
                  {confirmRemove ? "Click again to remove" : "Remove host"}
                </Button>
              ) : null}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              {mode.kind === "edit" ? (
                <Button type="submit" disabled={busy}>
                  {saveMutation.isPending ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
                  Save changes
                </Button>
              ) : (
                <>
                  <Button type="button" variant="secondary" disabled={busy} onClick={() => submit(false)}>
                    Save
                  </Button>
                  <Button type="submit" disabled={busy}>
                    {saveMutation.isPending ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
                    Save and connect
                  </Button>
                </>
              )}
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
