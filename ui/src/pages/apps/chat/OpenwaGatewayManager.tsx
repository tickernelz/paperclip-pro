import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import type { OpenwaGatewayAdminCallInput, OpenwaGatewayAdminResult } from "@tickernelz/wardmote-shared";
import { ApiError } from "@/api/client";
import { chatEndpointsApi } from "@/api/chatEndpoints";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/context/ToastContext";
import { copyTextToClipboard } from "@/lib/clipboard";
import { queryKeys } from "@/lib/queryKeys";
import { sanitizedSetupErrorMessage } from "./chat-setup-error";
import { FieldMessage, SettingsSection, openwaSelectClass } from "./openwa-fields";

export const OPENWA_QR_REFRESH_MS = 3_000;
const SESSION_REFRESH_MS = 10_000;
const KEY_ROLES = ["viewer", "operator", "admin"] as const;
const DEFAULT_WEBHOOK_EVENTS = "message.received, session.status";

export const OPENWA_ADMIN_KEY_CODES: ReadonlySet<string> = new Set(["openwa_admin_key_required", "openwa_admin_key_invalid"]);
const SESSION_NAME = /^[A-Za-z0-9._-]{1,64}$/;

export type OpenwaGatewayRun = (input: OpenwaGatewayAdminCallInput) => Promise<OpenwaGatewayAdminResult>;

export interface GatewaySession {
  id: string;
  name: string;
  status: string;
  phone?: string | null;
  pushName?: string | null;
  connectedAt?: string | null;
  createdAt?: string | null;
  lastError?: string | null;
}

interface GatewayKey {
  id: string;
  name: string;
  keyPrefix?: string;
  role?: string;
  allowedSessions?: string[] | null;
  isActive?: boolean;
  lastUsedAt?: string | null;
}

interface GatewayWebhook {
  id: string;
  url: string;
  events?: string[];
  active?: boolean;
}

interface GatewayPlugin {
  id: string;
  name?: string;
  ingressCapable?: boolean;
}

interface GatewayInstance {
  instanceId: string;
  sessionScope?: string | null;
  enabled?: boolean;
  ingressUrls?: string[];
}

type SessionAction = "SessionController_stop" | "SessionController_logout" | "SessionController_delete" | "restart";

const ACTION_LABEL: Record<SessionAction, string> = {
  SessionController_stop: "Stop",
  SessionController_logout: "Log out",
  SessionController_delete: "Delete",
  restart: "Restart",
};

function failureMessage(failure: unknown, fallback: string): string {
  return failure instanceof Error && failure.message ? failure.message : fallback;
}

const ENGINE_RUNNING_STATUSES: ReadonlySet<string> = new Set(["initializing", "qr_ready", "authenticating", "ready"]);

function gatewaySaid(failure: unknown, pattern: RegExp): boolean {
  return failure instanceof Error && pattern.test(failure.message);
}

export function openwaFailureCode(failure: unknown): string | null {
  const code = failure instanceof ApiError ? (failure.body as { code?: unknown } | null)?.code : null;
  return typeof code === "string" ? code : null;
}

export function openwaSessionNameError(name: string): string | undefined {
  return SESSION_NAME.test(name.trim()) ? undefined : "Use 1-64 letters, digits, dots, dashes or underscores";
}

/** Creates a gateway session and starts it so the gateway issues its first QR code. */
export async function createOpenwaSession(run: OpenwaGatewayRun, name: string): Promise<GatewaySession> {
  const created = record(await run({ operationId: "SessionController_create", args: { name: name.trim() } }));
  const session = { id: String(created.id), name: String(created.name ?? name.trim()), status: String(created.status ?? "created") };
  await run({ operationId: "SessionController_start", sessionId: session.id });
  return session;
}

function rows<T>(result: OpenwaGatewayAdminResult | undefined): T[] {
  return Array.isArray(result?.data) ? (result.data as T[]) : [];
}

function record(result: OpenwaGatewayAdminResult | undefined): Record<string, unknown> {
  return result?.data && typeof result.data === "object" && !Array.isArray(result.data) ? (result.data as Record<string, unknown>) : {};
}

function when(value: string | null | undefined): string | null {
  return value ? new Date(value).toLocaleString() : null;
}

function useGateway(endpointId: string) {
  const queryClient = useQueryClient();
  return {
    run: (input: OpenwaGatewayAdminCallInput) => chatEndpointsApi.runOpenwaGatewayAdmin(endpointId, input),
    refresh: () => queryClient.invalidateQueries({ queryKey: queryKeys.chatEndpoints.openwaGateway(endpointId) }),
  };
}

function useSessions(endpointId: string) {
  const { run } = useGateway(endpointId);
  return useQuery({
    queryKey: queryKeys.chatEndpoints.openwaGateway(endpointId, "sessions"),
    queryFn: () => run({ operationId: "SessionController_findAll" }),
    refetchInterval: SESSION_REFRESH_MS,
  });
}

/** Board-only management of the OpenWA gateway behind this channel: sessions, QR and pairing, API keys, webhooks and integrations. */
export function OpenwaGatewayManager({ endpointId, ownSessionId }: { endpointId: string; ownSessionId: string | null }) {
  return (
    <>
      <GatewaySessions endpointId={endpointId} ownSessionId={ownSessionId} />
      <GatewayApiKeys endpointId={endpointId} />
      <GatewayWebhooks endpointId={endpointId} />
      <GatewayIntegrations endpointId={endpointId} />
    </>
  );
}

function GatewaySessions({ endpointId, ownSessionId }: { endpointId: string; ownSessionId: string | null }) {
  const { run, refresh } = useGateway(endpointId);
  const sessions = useSessions(endpointId);
  const [creating, setCreating] = useState(false);
  const [connecting, setConnecting] = useState<GatewaySession | null>(null);
  const [configuring, setConfiguring] = useState<GatewaySession | null>(null);
  const [pending, setPending] = useState<{ session: GatewaySession; action: SessionAction } | null>(null);
  const [error, setError] = useState<string>();
  const start = useMutation({
    mutationFn: (session: GatewaySession) => run({ operationId: "SessionController_start", sessionId: session.id }),
    onSuccess: () => refresh(),
    onError: (failure) => setError(failureMessage(failure, "Couldn't start the session.")),
  });
  return (
    <SettingsSection
      title="WhatsApp sessions"
      description="Every session on this OpenWA gateway. Create a session, scan its QR or enter a pairing code, and start, stop, log out or delete it here instead of the OpenWA dashboard. Needs the channel's OpenWA admin key; every change is recorded in the audit log."
    >
      {sessions.isPending ? (
        <p className="text-sm text-ink-3">Loading sessions…</p>
      ) : sessions.isError && OPENWA_ADMIN_KEY_CODES.has(openwaFailureCode(sessions.error) ?? "") ? (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-bad">
            {failureMessage(sessions.error, "Managing sessions needs the OpenWA admin key.")}
          </p>
          <OpenwaAdminKeyField id="openwa-sessions-admin-key" endpointId={endpointId} configured={false} onSaved={() => void refresh()} />
        </div>
      ) : sessions.isError ? (
        <p role="alert" className="text-sm text-bad">
          {failureMessage(sessions.error, "Couldn't read sessions from the gateway.")}
        </p>
      ) : rows<GatewaySession>(sessions.data).length === 0 ? (
        <p className="text-sm text-ink-3">No sessions on this gateway.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {rows<GatewaySession>(sessions.data).map((session) => (
            <li key={session.id} aria-label={"Session " + session.name} className="space-y-2 py-2">
              <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-medium">{session.name}</span>
                {session.id === ownSessionId ? <span className="rounded bg-bg-3 px-1.5 text-xs">Agent session</span> : null}
                <span data-testid="session-status" className="text-xs text-ink-3">
                  {session.status}
                </span>
                <span className="text-xs text-ink-3">
                  {[session.pushName, session.phone, when(session.connectedAt) ?? when(session.createdAt)].filter(Boolean).join(" · ")}
                </span>
              </div>
              {session.lastError ? <p className="text-xs text-bad">{session.lastError}</p> : null}
              <div className="flex flex-wrap gap-1">
                {session.status !== "ready" ? (
                  <Button size="sm" variant="secondary" onClick={() => setConnecting(session)}>
                    Connect
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" disabled={start.isPending} onClick={() => start.mutate(session)}>
                  Start
                </Button>
                {(Object.keys(ACTION_LABEL) as SessionAction[]).map((action) => (
                  <Button key={action} size="sm" variant="ghost" onClick={() => setPending({ session, action })}>
                    {ACTION_LABEL[action]}
                  </Button>
                ))}
                <Button size="sm" variant="ghost" onClick={() => setConfiguring(session)}>
                  Settings
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <FieldMessage id="openwa-sessions" error={error} />
      <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
        New session
      </Button>
      {creating ? (
        <CreateSessionDialog
          endpointId={endpointId}
          onClose={() => setCreating(false)}
          onCreated={(session) => {
            setCreating(false);
            setConnecting(session);
          }}
        />
      ) : null}
      {connecting ? <ConnectSessionDialog endpointId={endpointId} session={connecting} onClose={() => setConnecting(null)} /> : null}
      {configuring ? <SessionConfigDialog endpointId={endpointId} session={configuring} onClose={() => setConfiguring(null)} /> : null}
      {pending ? (
        <SessionActionDialog
          endpointId={endpointId}
          session={pending.session}
          action={pending.action}
          own={pending.session.id === ownSessionId}
          onClose={() => setPending(null)}
        />
      ) : null}
    </SettingsSection>
  );
}

function CreateSessionDialog({ endpointId, onClose, onCreated }: { endpointId: string; onClose: () => void; onCreated: (session: GatewaySession) => void }) {
  const { run, refresh } = useGateway(endpointId);
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const create = useMutation({
    mutationFn: () => createOpenwaSession(run, name),
    onSuccess: async (session) => {
      await refresh();
      onCreated(session);
    },
    onError: (failure) => setError(failureMessage(failure, "Couldn't create the session.")),
  });
  const submit = () => {
    const invalid = openwaSessionNameError(name);
    setError(invalid);
    if (!invalid) create.mutate();
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent aria-label="New session">
        <DialogHeader>
          <DialogTitle>New WhatsApp session</DialogTitle>
          <DialogDescription>The gateway creates and starts the session, then shows its QR code. OpenWA 0.27.1 cannot rename a session later.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1">
          <label htmlFor="openwa-session-name" className="text-sm font-medium">
            Session name
          </label>
          <Input id="openwa-session-name" value={name} placeholder="sales" onChange={(event) => setName(event.target.value)} />
          <FieldMessage id="openwa-session-name" error={error} />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={create.isPending} onClick={submit}>
            {create.isPending ? "Creating…" : "Create session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Links WhatsApp to a gateway session: shows its QR (reloaded until the session is ready) and issues pairing codes. */
export function OpenwaSessionLinker({
  endpointId,
  run,
  session,
  onReady,
}: {
  endpointId: string;
  run: OpenwaGatewayRun;
  session: GatewaySession;
  onReady?: () => void;
}) {
  const [phone, setPhone] = useState("");
  const [pairingCode, setPairingCode] = useState<string>();
  const [error, setError] = useState<string>();
  const status = useQuery({
    queryKey: queryKeys.chatEndpoints.openwaGateway(endpointId, "session", session.id),
    queryFn: () => run({ operationId: "SessionController_findOne", sessionId: session.id }),
    refetchInterval: (query) => (record(query.state.data).status === "ready" ? false : OPENWA_QR_REFRESH_MS),
  });
  const current = record(status.data);
  const connected = current.status === "ready";
  const qr = useQuery({
    queryKey: queryKeys.chatEndpoints.openwaGateway(endpointId, "qr", session.id),
    queryFn: () => run({ operationId: "SessionController_getQRCode", sessionId: session.id }),
    enabled: !connected,
    refetchInterval: connected ? false : OPENWA_QR_REFRESH_MS,
    gcTime: 0,
  });
  const image = String(record(qr.data).qrCode ?? "");
  const start = useMutation({
    mutationFn: () =>
      run({ operationId: "SessionController_start", sessionId: session.id }).catch((failure: unknown) => {
        if (gatewaySaid(failure, /already start(ed|ing)/i)) return null;
        throw failure;
      }),
    onSuccess: () => {
      setError(undefined);
      void status.refetch();
      void qr.refetch();
    },
    onError: (failure) => setError(failureMessage(failure, "Couldn't start the session.")),
  });
  const startSession = start.mutate;
  const engineStopped =
    (typeof current.status === "string" && !ENGINE_RUNNING_STATUSES.has(current.status)) || gatewaySaid(qr.error, /not started/i);
  const startRequested = useRef(false);
  useEffect(() => {
    if (!engineStopped || startRequested.current) return;
    startRequested.current = true;
    startSession();
  }, [engineStopped, startSession]);
  const pairing = useMutation({
    mutationFn: () => run({ operationId: "SessionController_requestPairingCode", sessionId: session.id, args: { phoneNumber: phone.replace(/\D/g, "") } }),
    onSuccess: (result) => {
      setError(undefined);
      setPairingCode(String(record(result).pairingCode ?? ""));
    },
    onError: (failure) => setError(failureMessage(failure, "Couldn't get a pairing code.")),
  });
  const reportedReady = useRef(false);
  useEffect(() => {
    if (!connected || reportedReady.current) return;
    reportedReady.current = true;
    onReady?.();
  }, [connected, onReady]);
  return (
    <div className="space-y-3">
      <p role="status" className="text-sm">
        Status: {String(current.status ?? session.status).replaceAll("_", " ")}
      </p>
      {connected ? (
        <p className="text-sm font-medium">Connected{[current.pushName, current.phone].filter(Boolean).length ? " as " + [current.pushName, current.phone].filter(Boolean).join(" · ") : ""}.</p>
      ) : image.startsWith("data:image/") ? (
        <img src={image} alt="WhatsApp login QR code" className="mx-auto aspect-square w-full max-w-64 bg-white p-2" />
      ) : (
        <p className="text-sm text-ink-3">
          {start.isPending ? "Starting the session…" : qr.isError ? "Waiting for the gateway to issue a QR code…" : "Loading QR code…"}
        </p>
      )}
      {(engineStopped || start.isError) && !start.isPending && !connected ? (
        <Button size="sm" variant="secondary" onClick={() => startSession()}>
          Start session
        </Button>
      ) : null}
      {status.isError ? (
        <p role="alert" className="text-sm text-bad">
          {failureMessage(status.error, "Couldn't read the session status.")}
        </p>
      ) : null}
      {connected ? null : (
        <div className="grid gap-1">
          <label htmlFor={"openwa-pairing-phone-" + session.id} className="text-sm font-medium">
            Phone number for a pairing code
          </label>
          <div className="flex gap-2">
            <Input
              id={"openwa-pairing-phone-" + session.id}
              inputMode="tel"
              value={phone}
              placeholder="628123456789"
              onChange={(event) => setPhone(event.target.value)}
            />
            <Button variant="secondary" disabled={pairing.isPending || start.isPending || phone.replace(/\D/g, "").length < 8} onClick={() => pairing.mutate()}>
              Get code
            </Button>
          </div>
          {pairingCode ? (
            <p aria-label="Pairing code" className="font-mono text-lg tracking-widest">
              {pairingCode}
            </p>
          ) : null}
          <FieldMessage id={"openwa-pairing-phone-" + session.id} error={error} />
        </div>
      )}
    </div>
  );
}

/** Dialog around {@link OpenwaSessionLinker} for sessions on a connected channel. */
export function ConnectSessionDialog({ endpointId, session, onClose }: { endpointId: string; session: GatewaySession; onClose: () => void }) {
  const { run, refresh } = useGateway(endpointId);
  const [connected, setConnected] = useState(false);
  const close = () => {
    void refresh();
    onClose();
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent aria-label="Connect session">
        <DialogHeader>
          <DialogTitle>Connect {session.name}</DialogTitle>
          <DialogDescription>Open WhatsApp on the phone, go to Linked devices, then scan the QR code or choose "Link with phone number" and enter the pairing code.</DialogDescription>
        </DialogHeader>
        <OpenwaSessionLinker endpointId={endpointId} run={run} session={session} onReady={() => setConnected(true)} />
        <DialogFooter>
          <Button onClick={close}>{connected ? "Done" : "Close"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Saves or replaces the channel's OpenWA admin key; the server verifies it against the gateway before storing it. */
export function OpenwaAdminKeyField({
  id,
  endpointId,
  configured,
  onSaved,
}: {
  id: string;
  endpointId: string;
  configured: boolean | undefined;
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const [adminKey, setAdminKey] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (key: string) => chatEndpointsApi.setup(endpointId, { action: "reconnect", credentials: { adminApiKey: key } }),
    onSuccess: async (next) => {
      setAdminKey("");
      setKeyError(null);
      queryClient.setQueryData(queryKeys.chatEndpoints.detail(endpointId), next);
      await queryClient.invalidateQueries({ queryKey: queryKeys.chatEndpoints.openwaHealth(endpointId) });
      onSaved?.();
    },
    onError: (failure, key) => setKeyError(sanitizedSetupErrorMessage(failure, { adminApiKey: key })),
  });
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        Admin API key
      </label>
      <p className="text-xs text-ink-3">
        {configured === undefined ? "Checking whether a key is saved…" : configured ? "A key is saved. Enter a new one to replace it." : "No admin key is saved."}{" "}
        The admin key creates sessions and QR codes; the agent keeps its own key limited to this channel's session.
      </p>
      <div className="flex flex-wrap gap-2">
        <Input
          id={id}
          type="password"
          autoComplete="new-password"
          className="max-w-sm"
          value={adminKey}
          aria-invalid={keyError ? true : undefined}
          aria-describedby={keyError ? id + "-error" : undefined}
          onChange={(event) => setAdminKey(event.target.value)}
        />
        <Button size="sm" variant="secondary" disabled={save.isPending || !adminKey.trim()} onClick={() => save.mutate(adminKey.trim())}>
          {save.isPending ? "Verifying…" : configured ? "Replace admin key" : "Save admin key"}
        </Button>
      </div>
      <FieldMessage id={id} error={keyError ?? undefined} />
    </div>
  );
}

function SessionActionDialog({
  endpointId,
  session,
  action,
  own,
  onClose,
}: {
  endpointId: string;
  session: GatewaySession;
  action: SessionAction;
  own: boolean;
  onClose: () => void;
}) {
  const { run, refresh } = useGateway(endpointId);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string>();
  const confirmOwnSession = own ? true : undefined;
  const perform = useMutation({
    mutationFn: async () => {
      if (action !== "restart") return run({ operationId: action, sessionId: session.id, confirmOwnSession });
      await run({ operationId: "SessionController_stop", sessionId: session.id, confirmOwnSession });
      return run({ operationId: "SessionController_start", sessionId: session.id });
    },
    onSuccess: async () => {
      await refresh();
      onClose();
    },
    onError: (failure) => setError(failureMessage(failure, "The gateway refused the action.")),
  });
  const label = ACTION_LABEL[action];
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent aria-label={label + " session"}>
        <DialogHeader>
          <DialogTitle>
            {label} {session.name}?
          </DialogTitle>
          <DialogDescription>
            {action === "SessionController_delete"
              ? "The gateway deletes the session and its stored login. Linking the number again needs a new QR scan."
              : action === "SessionController_logout"
                ? "WhatsApp unlinks this device. Connecting again needs a new QR scan or pairing code."
                : "The session stops receiving and sending messages until it starts again."}
          </DialogDescription>
        </DialogHeader>
        {own ? (
          <div className="flex items-start gap-2 rounded-md border border-line bg-bg-3 p-2">
            <Checkbox id="openwa-own-session-ack" checked={acknowledged} onCheckedChange={(value) => setAcknowledged(value === true)} />
            <label htmlFor="openwa-own-session-ack" className="text-xs">
              This is the agent's own session. The agent stops answering on WhatsApp until it is connected again.
            </label>
          </div>
        ) : null}
        <FieldMessage id="openwa-session-action" error={error} />
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={perform.isPending || (own && !acknowledged)} onClick={() => perform.mutate()}>
            {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SessionConfigDialog({ endpointId, session, onClose }: { endpointId: string; session: GatewaySession; onClose: () => void }) {
  const { run } = useGateway(endpointId);
  const [draft, setDraft] = useState<{ autoRejectCalls: boolean; maxReconnectAttempts: string; reconnectBaseDelay: string } | null>(null);
  const [error, setError] = useState<string>();
  const config = useQuery({
    queryKey: queryKeys.chatEndpoints.openwaGateway(endpointId, "config", session.id),
    queryFn: () => run({ operationId: "SessionController_getConfig", sessionId: session.id }),
  });
  const loaded = record(config.data);
  const value = draft ?? {
    autoRejectCalls: loaded.autoRejectCalls === true,
    maxReconnectAttempts: loaded.maxReconnectAttempts == null ? "" : String(loaded.maxReconnectAttempts),
    reconnectBaseDelay: loaded.reconnectBaseDelay == null ? "" : String(loaded.reconnectBaseDelay),
  };
  const save = useMutation({
    mutationFn: () =>
      run({
        operationId: "SessionController_updateConfig",
        sessionId: session.id,
        args: {
          autoRejectCalls: value.autoRejectCalls,
          maxReconnectAttempts: value.maxReconnectAttempts === "" ? null : Number(value.maxReconnectAttempts),
          reconnectBaseDelay: value.reconnectBaseDelay === "" ? null : Number(value.reconnectBaseDelay),
        },
      }),
    onSuccess: onClose,
    onError: (failure) => setError(failureMessage(failure, "Couldn't save the session settings.")),
  });
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent aria-label="Session settings">
        <DialogHeader>
          <DialogTitle>{session.name} settings</DialogTitle>
          <DialogDescription>Settings the gateway exposes for a session. The session name cannot change after creation.</DialogDescription>
        </DialogHeader>
        {config.isPending ? (
          <p className="text-sm text-ink-3">Loading settings…</p>
        ) : (
          <div className="grid gap-3">
            <div className="flex items-center gap-2">
              <Checkbox id="openwa-auto-reject" checked={value.autoRejectCalls} onCheckedChange={(next) => setDraft({ ...value, autoRejectCalls: next === true })} />
              <label htmlFor="openwa-auto-reject" className="text-sm">
                Reject incoming calls automatically
              </label>
            </div>
            <label className="grid gap-1 text-sm">
              Reconnect attempts
              <Input inputMode="numeric" value={value.maxReconnectAttempts} onChange={(event) => setDraft({ ...value, maxReconnectAttempts: event.target.value })} />
            </label>
            <label className="grid gap-1 text-sm">
              Reconnect base delay (ms)
              <Input inputMode="numeric" value={value.reconnectBaseDelay} onChange={(event) => setDraft({ ...value, reconnectBaseDelay: event.target.value })} />
            </label>
          </div>
        )}
        <FieldMessage id="openwa-session-config" error={error} />
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || config.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RevealedSecret({ label, value, onDismiss }: { label: string; value: string; onDismiss: () => void }) {
  const { pushToast } = useToast();
  return (
    <div role="alert" className="space-y-2 rounded-md border border-line bg-bg-3 p-2">
      <p className="text-xs">{label} Wardmote does not store it and will not show it again.</p>
      <p className="break-all font-mono text-xs">{value}</p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            void copyTextToClipboard(value).then(
              () => pushToast({ title: "Copied", tone: "success" }),
              () => pushToast({ title: "Couldn't copy", body: "Select and copy it manually.", tone: "error" }),
            )
          }
        >
          <Copy className="size-4" />
          Copy
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Done
        </Button>
      </div>
    </div>
  );
}

function GatewayApiKeys({ endpointId }: { endpointId: string }) {
  const { run, refresh } = useGateway(endpointId);
  const sessions = useSessions(endpointId);
  const [name, setName] = useState("");
  const [role, setRole] = useState<(typeof KEY_ROLES)[number]>("operator");
  const [allowed, setAllowed] = useState<string[]>([]);
  const [revealed, setRevealed] = useState<string>();
  const [error, setError] = useState<string>();
  const keys = useQuery({
    queryKey: queryKeys.chatEndpoints.openwaGateway(endpointId, "keys"),
    queryFn: () => run({ operationId: "AuthController_findAll" }),
  });
  const create = useMutation({
    mutationFn: () => run({ operationId: "AuthController_create", args: { name: name.trim(), role, ...(allowed.length ? { allowedSessions: allowed } : {}) } }),
    onSuccess: async (result) => {
      setRevealed(String(record(result).apiKey ?? ""));
      setName("");
      setAllowed([]);
      await refresh();
    },
    onError: (failure) => setError(failureMessage(failure, "Couldn't create the key.")),
  });
  const change = useMutation({
    mutationFn: (input: { key: GatewayKey; operationId: "AuthController_revoke" | "AuthController_delete" }) => run({ operationId: input.operationId, args: { id: input.key.id } }),
    onSuccess: () => refresh(),
    onError: (failure) => setError(failureMessage(failure, "The gateway refused the change.")),
  });
  return (
    <SettingsSection title="OpenWA API keys" description="Keys other apps use to call this gateway. A new key is shown once, right after it is created.">
      {keys.isPending ? (
        <p className="text-sm text-ink-3">Loading keys…</p>
      ) : keys.isError ? (
        <p role="alert" className="text-sm text-bad">
          {failureMessage(keys.error, "Couldn't read keys from the gateway.")}
        </p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {rows<GatewayKey>(keys.data).map((key) => (
            <li key={key.id} aria-label={"Key " + key.name} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="font-medium">{key.name}</span>
              <span className="text-xs text-ink-3">
                {[key.role, key.keyPrefix ? key.keyPrefix + "…" : null, key.allowedSessions?.length ? key.allowedSessions.length + " sessions" : "all sessions", key.isActive === false ? "revoked" : "active", when(key.lastUsedAt)].filter(Boolean).join(" · ")}
              </span>
              <span className="ml-auto flex gap-1">
                {key.isActive === false ? null : (
                  <Button size="sm" variant="ghost" onClick={() => change.mutate({ key, operationId: "AuthController_revoke" })}>
                    Revoke
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => change.mutate({ key, operationId: "AuthController_delete" })}>
                  Delete
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {revealed ? <RevealedSecret label="New API key." value={revealed} onDismiss={() => setRevealed(undefined)} /> : null}
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <Input aria-label="Key name" placeholder="Key name" value={name} onChange={(event) => setName(event.target.value)} />
        <select aria-label="Key role" className={openwaSelectClass} value={role} onChange={(event) => setRole(event.target.value as (typeof KEY_ROLES)[number])}>
          {KEY_ROLES.map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </select>
        <Button size="sm" variant="secondary" disabled={create.isPending || !name.trim()} onClick={() => create.mutate()}>
          Create key
        </Button>
      </div>
      <div className="flex flex-wrap gap-3">
        {rows<GatewaySession>(sessions.data).map((session) => (
          <label key={session.id} className="flex items-center gap-1 text-xs">
            <Checkbox
              checked={allowed.includes(session.id)}
              onCheckedChange={(value) => setAllowed((current) => (value === true ? [...current, session.id] : current.filter((id) => id !== session.id)))}
            />
            {session.name}
          </label>
        ))}
      </div>
      <p className="text-xs text-ink-3">No session ticked means the key reaches every session.</p>
      <FieldMessage id="openwa-keys" error={error} />
    </SettingsSection>
  );
}

function GatewayWebhooks({ endpointId }: { endpointId: string }) {
  const { run, refresh } = useGateway(endpointId);
  const sessions = useSessions(endpointId);
  const [sessionId, setSessionId] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState(DEFAULT_WEBHOOK_EVENTS);
  const [secret, setSecret] = useState("");
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const hooks = useQuery({
    queryKey: queryKeys.chatEndpoints.openwaGateway(endpointId, "webhooks", sessionId),
    queryFn: () => run({ operationId: "WebhookController_findBySession", sessionId }),
    enabled: Boolean(sessionId),
  });
  const failures = useQuery({
    queryKey: queryKeys.chatEndpoints.openwaGateway(endpointId, "webhook-failures"),
    queryFn: () => run({ operationId: "WebhooksListController_deliveryFailures", args: { limit: 50 } }),
  });
  const done = async (message?: string) => {
    setNotice(message);
    setError(undefined);
    await refresh();
  };
  const fail = (failure: unknown) => setError(failureMessage(failure, "The gateway refused the change."));
  const create = useMutation({
    mutationFn: () =>
      run({
        operationId: "WebhookController_create",
        sessionId,
        args: { url: url.trim(), events: events.split(",").map((entry) => entry.trim()).filter(Boolean), ...(secret ? { secret } : {}) },
      }),
    onSuccess: async () => {
      setUrl("");
      setSecret("");
      await done("Webhook added.");
    },
    onError: fail,
  });
  const change = useMutation({
    mutationFn: (input: OpenwaGatewayAdminCallInput) => run(input),
    onSuccess: async (result) => {
      const data = record(result);
      await done(result.operationId === "WebhookController_test" ? (data.success === true ? "Test delivered (" + String(data.statusCode ?? "ok") + ")." : "Test failed: " + String(data.error ?? data.statusCode ?? "unknown")) : undefined);
    },
    onError: fail,
  });
  return (
    <SettingsSection title="OpenWA webhooks" description="Webhooks the gateway calls for a session's events, and deliveries that failed.">
      <select aria-label="Webhook session" className={openwaSelectClass} value={sessionId} onChange={(event) => setSessionId(event.target.value)}>
        <option value="">Choose a session</option>
        {rows<GatewaySession>(sessions.data).map((session) => (
          <option key={session.id} value={session.id}>
            {session.name}
          </option>
        ))}
      </select>
      {sessionId ? (
        <>
          <ul className="divide-y divide-line border-y border-line">
            {rows<GatewayWebhook>(hooks.data).map((hook) => (
              <li key={hook.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="min-w-0 break-all">{hook.url}</span>
                <span className="text-xs text-ink-3">{[hook.events?.join(", "), hook.active === false ? "paused" : "active"].filter(Boolean).join(" · ")}</span>
                <span className="ml-auto flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => change.mutate({ operationId: "WebhookController_test", sessionId, args: { id: hook.id } })}>
                    Test
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => change.mutate({ operationId: "WebhookController_update", sessionId, args: { id: hook.id, active: hook.active === false } })}>
                    {hook.active === false ? "Resume" : "Pause"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => change.mutate({ operationId: "WebhookController_delete", sessionId, args: { id: hook.id } })}>
                    Delete
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          <div className="grid gap-2">
            <Input aria-label="Webhook URL" placeholder="https://example.com/hooks/whatsapp" value={url} onChange={(event) => setUrl(event.target.value)} />
            <Input aria-label="Webhook events" value={events} onChange={(event) => setEvents(event.target.value)} />
            <Input aria-label="Webhook signing secret" type="password" placeholder="Signing secret (optional)" value={secret} onChange={(event) => setSecret(event.target.value)} />
            <Button size="sm" variant="secondary" disabled={create.isPending || !url.trim()} onClick={() => create.mutate()}>
              Add webhook
            </Button>
          </div>
        </>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>{rows(failures.data).length} failed deliveries</span>
        <Button
          size="sm"
          variant="ghost"
          disabled={rows(failures.data).length === 0}
          onClick={() => change.mutate({ operationId: "WebhooksListController_redriveDeliveryFailures", args: {} })}
        >
          Retry failed deliveries
        </Button>
      </div>
      {notice ? <p className="text-xs text-ink-3">{notice}</p> : null}
      <FieldMessage id="openwa-webhooks" error={error} />
    </SettingsSection>
  );
}

function GatewayIntegrations({ endpointId }: { endpointId: string }) {
  const { run, refresh } = useGateway(endpointId);
  const sessions = useSessions(endpointId);
  const [pluginId, setPluginId] = useState("");
  const [instanceId, setInstanceId] = useState("");
  const [scope, setScope] = useState("");
  const [revealed, setRevealed] = useState<string>();
  const [error, setError] = useState<string>();
  const plugins = useQuery({
    queryKey: queryKeys.chatEndpoints.openwaGateway(endpointId, "plugins"),
    queryFn: () => run({ operationId: "PluginsController_findAll" }),
  });
  const instances = useQuery({
    queryKey: queryKeys.chatEndpoints.openwaGateway(endpointId, "instances", pluginId),
    queryFn: () => run({ operationId: "IntegrationInstanceController_list", args: { pluginId } }),
    enabled: Boolean(pluginId),
  });
  const reveal = (result: OpenwaGatewayAdminResult) => {
    const data = record(result);
    const parts = [data.secret ? "secret: " + String(data.secret) : null, data.verifyToken ? "verify token: " + String(data.verifyToken) : null].filter(Boolean);
    setRevealed(parts.length ? parts.join("\n") : undefined);
  };
  const change = useMutation({
    mutationFn: (input: OpenwaGatewayAdminCallInput) => run(input),
    onSuccess: async (result) => {
      if (result.revealed) reveal(result);
      if (result.operationId === "IntegrationInstanceController_create") setInstanceId("");
      setError(undefined);
      await refresh();
    },
    onError: (failure) => setError(failureMessage(failure, "The gateway refused the change.")),
  });
  const ingress = rows<GatewayPlugin>(plugins.data).filter((plugin) => plugin.ingressCapable !== false);
  return (
    <SettingsSection title="OpenWA integrations" description="Integration instances of gateway plugins. A new or regenerated instance secret is shown once.">
      <select aria-label="Integration plugin" className={openwaSelectClass} value={pluginId} onChange={(event) => setPluginId(event.target.value)}>
        <option value="">Choose a plugin</option>
        {ingress.map((plugin) => (
          <option key={plugin.id} value={plugin.id}>
            {plugin.name ?? plugin.id}
          </option>
        ))}
      </select>
      {pluginId ? (
        <>
          <ul className="divide-y divide-line border-y border-line">
            {rows<GatewayInstance>(instances.data).map((instance) => {
              const args = { pluginId, instanceId: instance.instanceId };
              return (
                <li key={instance.instanceId} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="font-medium">{instance.instanceId}</span>
                  <span className="text-xs text-ink-3">{[instance.sessionScope ?? "all sessions", instance.enabled === false ? "disabled" : "enabled"].join(" · ")}</span>
                  <span className="ml-auto flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => change.mutate({ operationId: "IntegrationInstanceController_patch", args: { ...args, enabled: instance.enabled === false } })}>
                      {instance.enabled === false ? "Enable" : "Disable"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => change.mutate({ operationId: "IntegrationInstanceController_regenerate", args })}>
                      New secret
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => change.mutate({ operationId: "IntegrationInstanceController_remove", args })}>
                      Remove
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Input aria-label="Instance id" placeholder="Instance id" value={instanceId} onChange={(event) => setInstanceId(event.target.value)} />
            <select aria-label="Instance session" className={openwaSelectClass} value={scope} onChange={(event) => setScope(event.target.value)}>
              <option value="">All sessions</option>
              {rows<GatewaySession>(sessions.data).map((session) => (
                <option key={session.id} value={session.id}>
                  {session.name}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="secondary"
              disabled={change.isPending || !instanceId.trim()}
              onClick={() => change.mutate({ operationId: "IntegrationInstanceController_create", args: { pluginId, instanceId: instanceId.trim(), ...(scope ? { sessionScope: scope } : {}) } })}
            >
              Add instance
            </Button>
          </div>
        </>
      ) : null}
      {revealed ? <RevealedSecret label="Instance credentials." value={revealed} onDismiss={() => setRevealed(undefined)} /> : null}
      <FieldMessage id="openwa-integrations" error={error} />
    </SettingsSection>
  );
}
