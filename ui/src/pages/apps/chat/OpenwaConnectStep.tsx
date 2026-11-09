import { useCallback, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, CircleHelp } from "lucide-react";
import type { OpenwaNumberMode } from "@tickernelz/wardmote-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SetupWizardFooter } from "@/components/SetupWizard";
import {
  chatEndpointsApi,
  type ChatEndpoint,
  type ChatEndpointSetupAction,
} from "@/api/chatEndpoints";
import { sanitizedSetupErrorMessage } from "./chat-setup-error";
import {
  createOpenwaSession,
  openwaSessionNameError,
  OpenwaSessionLinker,
  type GatewaySession,
  type OpenwaGatewayRun,
} from "./OpenwaGatewayManager";

export const OPENWA_REPOSITORY_URL = "https://github.com/rmyndharis/OpenWA";

function storedBaseUrl(endpoint: ChatEndpoint): string {
  const account = endpoint.providerAccountId ?? "";
  const separator = account.lastIndexOf("#");
  return separator > 0 ? account.slice(0, separator) : "";
}

function storedSessionId(endpoint: ChatEndpoint): string {
  const account = endpoint.providerAccountId ?? "";
  const separator = account.lastIndexOf("#");
  return separator > 0 ? account.slice(separator + 1) : "";
}

function FieldLabel({ htmlFor, label, help }: { htmlFor: string; label: string; help: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={htmlFor}>{label}</label>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Help with ${label.toLowerCase()}`}
            className="rounded-sm text-ink-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <CircleHelp className="size-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{help}</TooltipContent>
      </Tooltip>
    </div>
  );
}

export function OpenwaConnectStep({
  endpoint,
  agentName,
  repairing,
  pending,
  onAction,
  onSaveExit,
}: {
  endpoint: ChatEndpoint;
  agentName: string;
  repairing: boolean;
  pending: boolean;
  onAction(action: ChatEndpointSetupAction, values?: Record<string, string>): void;
  onSaveExit(): void;
}) {
  const existingSessionId = storedSessionId(endpoint);
  const [baseUrl, setBaseUrl] = useState(storedBaseUrl(endpoint));
  const [apiKey, setApiKey] = useState("");
  const [adminApiKey, setAdminApiKey] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [preferredSessionId, setPreferredSessionId] = useState("");
  const [linking, setLinking] = useState<GatewaySession | null>(null);
  const [creating, setCreating] = useState(false);
  const [sessionName, setSessionName] = useState("");
  const [sessionNameError, setSessionNameError] = useState<string>();
  const [numberMode, setNumberMode] = useState<OpenwaNumberMode>(endpoint.policy?.numberMode ?? "agent_number");
  const [pacing, setPacing] = useState(endpoint.policy?.attestations.pacing ?? false);
  const [soleClient, setSoleClient] = useState(endpoint.policy?.attestations.soleClient ?? false);
  const inspection = useMutation({
    mutationFn: () =>
      chatEndpointsApi.inspectOpenwa(endpoint.id, {
        baseUrl: baseUrl.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(adminApiKey.trim() ? { adminApiKey: adminApiKey.trim() } : {}),
      }),
    onSuccess: (result) => {
      const eligible = result.sessions.filter((session) => session.eligible);
      const preferred = eligible.find((session) => session.sessionId === (existingSessionId || preferredSessionId));
      setSessionId(preferred?.sessionId ?? (eligible.length === 1 ? eligible[0].sessionId : ""));
    },
  });
  const resetInspection = () => {
    inspection.reset();
    setSessionId("");
    setLinking(null);
    setCreating(false);
  };
  const result = inspection.data;
  const managementKey = adminApiKey.trim() || apiKey.trim();
  const run: OpenwaGatewayRun = (input) =>
    chatEndpointsApi.runOpenwaGatewayAdmin(endpoint.id, { ...input, connection: { baseUrl: result!.baseUrl, adminApiKey: managementKey } });
  const createSession = useMutation({
    mutationFn: () => createOpenwaSession(run, sessionName),
    onSuccess: (session) => {
      setCreating(false);
      setSessionName("");
      setLinking(session);
    },
  });
  const onLinked = useCallback(() => {
    if (!linking) return;
    setPreferredSessionId(linking.id);
    setLinking(null);
    inspection.mutate();
  }, [linking, inspection]);
  const submitSessionName = () => {
    const invalid = openwaSessionNameError(sessionName);
    setSessionNameError(invalid);
    if (!invalid) createSession.mutate();
  };
  const secrets = { apiKey, adminApiKey };
  const reuseSaved = repairing && !apiKey.trim();
  const ready = pacing && soleClient && (reuseSaved || (Boolean(result?.eligible) && Boolean(sessionId)));
  const connect = () =>
    onAction(
      repairing ? "reconnect" : "configure",
      reuseSaved
        ? {
            baseUrl: storedBaseUrl(endpoint),
            sessionId: existingSessionId,
            ...(adminApiKey.trim() ? { adminApiKey: adminApiKey.trim() } : {}),
            numberMode,
            pacing: String(pacing),
            soleClient: String(soleClient),
          }
        : {
            baseUrl: result!.baseUrl,
            ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
            ...(adminApiKey.trim() ? { adminApiKey: adminApiKey.trim() } : {}),
            sessionId,
            numberMode,
            pacing: String(pacing),
            soleClient: String(soleClient),
          },
    );
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h1 className="text-xl font-bold">Connect OpenWA</h1>
        <p className="text-sm text-ink-3">
          Connect {agentName} to one WhatsApp session on your self-hosted OpenWA gateway. You can create the session and
          scan its QR code here; nothing is sent until an owner messages the number.
        </p>
        <p className="text-sm">
          <a className="underline" href={OPENWA_REPOSITORY_URL} target="_blank" rel="noreferrer">
            OpenWA documentation
          </a>
        </p>
      </div>
      {repairing && (
        <p className="text-sm text-ink-3">
          Reconnect keeps this gateway session. Leave the keys blank to reuse the saved ones, or enter only the admin
          key to add or replace it.
        </p>
      )}
      <div className="grid gap-2 text-sm font-medium">
        <FieldLabel
          htmlFor="openwa-base-url"
          label="Gateway URL"
          help="The address of your OpenWA gateway, such as http://localhost:2785. Use only the origin, without /api."
        />
        <Input
          id="openwa-base-url"
          value={baseUrl}
          placeholder="http://localhost:2785"
          autoComplete="off"
          inputMode="url"
          disabled={pending || inspection.isPending || Boolean(endpoint.providerAccountId)}
          onChange={(event) => {
            setBaseUrl(event.target.value);
            resetInspection();
          }}
        />
      </div>
      <div className="grid gap-2 text-sm font-medium">
        <FieldLabel
          htmlFor="openwa-admin-api-key"
          label="Admin API key"
          help="OpenWA prints this key in its log the first time the gateway starts. It is stored encrypted and only used from this page and Settings."
        />
        <Input
          id="openwa-admin-api-key"
          type="password"
          value={adminApiKey}
          autoComplete="new-password"
          disabled={pending || inspection.isPending}
          onChange={(event) => {
            setAdminApiKey(event.target.value);
            resetInspection();
          }}
        />
        <p className="text-xs font-normal text-ink-3">
          The admin key lets Wardmote create the session and show its QR here, then give {agentName} its own operator key
          limited to that one session, while an operator key you paste below can only connect a session that is already linked.
        </p>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer font-medium">I only have an operator key</summary>
        <div className="mt-3 grid gap-2 font-medium">
          <FieldLabel
            htmlFor="openwa-api-key"
            label="Operator API key"
            help="An operator key whose allowed sessions contain only this agent's session. Leave allowed chats empty: a chat-restricted key cannot receive live events."
          />
          <Input
            id="openwa-api-key"
            type="password"
            value={apiKey}
            autoComplete="new-password"
            disabled={pending || inspection.isPending}
            onChange={(event) => {
              setApiKey(event.target.value);
              resetInspection();
            }}
          />
        </div>
      </details>
      <Button
        variant="secondary"
        disabled={pending || inspection.isPending || !baseUrl.trim() || (!apiKey.trim() && !adminApiKey.trim())}
        onClick={() => inspection.mutate()}
      >
        {inspection.isPending ? "Inspecting gateway…" : "Inspect gateway"}
      </Button>
      {inspection.isError && (
        <p role="alert" className="text-sm text-bad">
          {sanitizedSetupErrorMessage(inspection.error, secrets)}
        </p>
      )}
      {result && (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-ink-3">Gateway version</dt>
            <dd>{result.gatewayVersion ?? `Unknown (assuming ${result.pinnedVersion})`}</dd>
            <dt className="text-ink-3">Engine</dt>
            <dd>{result.engine ?? "Unknown"}</dd>
            <dt className="text-ink-3">Agent key</dt>
            <dd>{result.agentKeyMinted ? "New operator key for the chosen session" : result.keyRole}</dd>
          </dl>
          {result.warnings.length > 0 && (
            <div role="status" className="space-y-1 rounded-lg border border-line bg-bg-3/30 p-4 text-sm">
              {result.warnings.map((warning) => (
                <p key={warning} className="flex gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>{warning}</span>
                </p>
              ))}
            </div>
          )}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">WhatsApp session</legend>
            {result.sessions.length === 0 ? (
              <p className="text-sm text-ink-3">This gateway has no WhatsApp session yet. Create one below.</p>
            ) : result.eligible || linking ? null : result.canManageSessions ? (
              <p className="text-sm text-ink-3">No session is ready yet. Link WhatsApp to a session, or create a new one.</p>
            ) : (
              <p role="alert" className="text-sm text-bad">
                No session can be connected. Connect WhatsApp in the OpenWA dashboard or free the session from its other channel.
              </p>
            )}
            {result.sessions.map((session) => (
              <div key={session.sessionId} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="openwa-session"
                    value={session.sessionId}
                    checked={sessionId === session.sessionId}
                    disabled={!session.eligible || pending || (Boolean(existingSessionId) && existingSessionId !== session.sessionId)}
                    onChange={() => setSessionId(session.sessionId)}
                  />
                  <span className="min-w-0 break-words">
                    {session.name}
                    {session.maskedNumber ? ` · ${session.maskedNumber}` : ""}
                    {session.pushName ? ` · ${session.pushName}` : ""}
                    {session.unavailableReason ? ` — ${session.unavailableReason}` : ""}
                  </span>
                </label>
                {result.canManageSessions && session.status !== "ready" && linking?.id !== session.sessionId && !existingSessionId ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => {
                      setCreating(false);
                      setLinking({ id: session.sessionId, name: session.name, status: session.status });
                    }}
                  >
                    Link WhatsApp
                  </Button>
                ) : null}
              </div>
            ))}
          </fieldset>
          {result.canManageSessions && !existingSessionId && !linking && (
            creating ? (
              <div className="space-y-2 rounded-lg border border-line p-4">
                <label htmlFor="openwa-new-session-name" className="block text-sm font-medium">
                  New session name
                </label>
                <Input
                  id="openwa-new-session-name"
                  value={sessionName}
                  placeholder="pmo"
                  autoComplete="off"
                  disabled={createSession.isPending}
                  aria-invalid={sessionNameError ? true : undefined}
                  onChange={(event) => setSessionName(event.target.value)}
                />
                <p className="text-xs text-ink-3">Letters, digits, dots, dashes or underscores. OpenWA cannot rename a session later.</p>
                {(sessionNameError || createSession.isError) && (
                  <p role="alert" className="text-sm text-bad">
                    {sessionNameError ?? sanitizedSetupErrorMessage(createSession.error, secrets)}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={createSession.isPending} onClick={submitSessionName}>
                    {createSession.isPending ? "Creating session…" : "Create and show QR"}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={createSession.isPending} onClick={() => setCreating(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="secondary" disabled={pending} onClick={() => setCreating(true)}>
                Create new WhatsApp session
              </Button>
            )
          )}
          {linking && (
            <section aria-label={"Link " + linking.name} className="space-y-3 rounded-lg border border-line p-4">
              <div className="space-y-1">
                <h2 className="text-base font-semibold">Link WhatsApp to {linking.name}</h2>
                <p className="text-sm text-ink-3">
                  On the phone, open WhatsApp, go to Linked devices, then scan the QR code, or choose "Link with phone
                  number" and enter the pairing code. The session is selected as soon as it is ready.
                </p>
              </div>
              <OpenwaSessionLinker endpointId={endpoint.id} run={run} session={linking} onReady={onLinked} />
              <Button size="sm" variant="ghost" onClick={() => setLinking(null)}>
                Cancel
              </Button>
            </section>
          )}
        </div>
      )}
      {(result?.eligible || reuseSaved) && (
        <>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Whose number is this?</legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="openwa-number-mode"
                className="mt-1"
                checked={numberMode === "agent_number"}
                disabled={pending || reuseSaved}
                onChange={() => setNumberMode("agent_number")}
              />
              <span>
                <span className="font-medium">A number dedicated to {agentName}</span>
                <span className="block text-ink-3">
                  People message this number to reach the agent. Direct messages, mentions, and replies start work.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="openwa-number-mode"
                className="mt-1"
                checked={numberMode === "owner_number"}
                disabled={pending || reuseSaved}
                onChange={() => setNumberMode("owner_number")}
              />
              <span>
                <span className="font-medium">An owner&apos;s personal number</span>
                <span className="block text-ink-3">
                  The agent replies as you. Only chats you enable in Settings can trigger it, and its messages carry a
                  visible prefix so contacts know an assistant wrote them. Wardmote can read every chat this session can see.
                </span>
              </span>
            </label>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Before connecting, confirm</legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={pacing}
                disabled={pending}
                onChange={(event) => setPacing(event.target.checked)}
              />
              <span>
                Send pacing is turned on in the gateway (SEND_PACING_ENABLED). It spaces out outgoing messages to lower
                the risk of WhatsApp restricting the number.
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={soleClient}
                disabled={pending}
                onChange={(event) => setSoleClient(event.target.checked)}
              />
              <span>
                Wardmote is the only app sending as this session. Other bots, webhooks, or scripts on the same session
                could make the agent mistake their messages for yours.
              </span>
            </label>
          </fieldset>
        </>
      )}
      <SetupWizardFooter onSaveExit={onSaveExit} disabled={pending}>
        <Button disabled={pending || inspection.isPending || !ready} onClick={connect}>
          {pending ? "Connecting…" : repairing ? "Reconnect OpenWA" : "Connect session"}
        </Button>
      </SetupWizardFooter>
    </div>
  );
}
