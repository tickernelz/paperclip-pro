import { useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, CircleHelp } from "lucide-react";
import type { OpenwaNumberMode } from "@tickernelz/paperclip-pro-shared";
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
            className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
  const [numberMode, setNumberMode] = useState<OpenwaNumberMode>(endpoint.policy?.numberMode ?? "agent_number");
  const [pacing, setPacing] = useState(endpoint.policy?.attestations.pacing ?? false);
  const [soleClient, setSoleClient] = useState(endpoint.policy?.attestations.soleClient ?? false);
  const inspection = useMutation({
    mutationFn: () =>
      chatEndpointsApi.inspectOpenwa(endpoint.id, {
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        ...(adminApiKey.trim() ? { adminApiKey: adminApiKey.trim() } : {}),
      }),
    onSuccess: (result) => {
      const eligible = result.sessions.filter((session) => session.eligible);
      const preferred = eligible.find((session) => session.sessionId === existingSessionId);
      setSessionId(preferred?.sessionId ?? (eligible.length === 1 ? eligible[0].sessionId : ""));
    },
  });
  const resetInspection = () => {
    inspection.reset();
    setSessionId("");
  };
  const result = inspection.data;
  const reuseSaved = repairing && !apiKey.trim();
  const ready = pacing && soleClient && (reuseSaved || (Boolean(result?.eligible) && Boolean(sessionId)));
  const connect = () =>
    onAction(
      repairing ? "reconnect" : "configure",
      reuseSaved
        ? {
            baseUrl: storedBaseUrl(endpoint),
            sessionId: existingSessionId,
            numberMode,
            pacing: String(pacing),
            soleClient: String(soleClient),
          }
        : {
            baseUrl: result!.baseUrl,
            apiKey: apiKey.trim(),
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
        <p className="text-sm text-muted-foreground">
          Connect {agentName} to one WhatsApp session on your self-hosted OpenWA gateway. Paperclip only reads the
          gateway during inspection; nothing is sent until an owner messages the number.
        </p>
        <p className="text-sm">
          <a className="underline" href={OPENWA_REPOSITORY_URL} target="_blank" rel="noreferrer">
            OpenWA documentation
          </a>
        </p>
      </div>
      {repairing && (
        <p className="text-sm text-muted-foreground">
          Reconnect keeps this gateway session. Leave the API key blank to reuse the saved keys.
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
          disabled={pending || inspection.isPending || Boolean(endpoint.providerAccountId)}
          onChange={(event) => {
            setBaseUrl(event.target.value);
            resetInspection();
          }}
        />
      </div>
      <div className="grid gap-2 text-sm font-medium">
        <FieldLabel
          htmlFor="openwa-api-key"
          label="Operator API key"
          help="In the OpenWA dashboard, open API Keys and create an operator key whose allowed sessions contain only this agent's session. Leave allowed chats empty: a chat-restricted key cannot receive live events."
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
      <details className="text-sm">
        <summary className="cursor-pointer font-medium">Advanced</summary>
        <div className="mt-3 grid gap-2 font-medium">
          <FieldLabel
            htmlFor="openwa-admin-api-key"
            label="Admin API key (optional)"
            help="An unscoped admin key. Only needed if you later enable gateway admin tools in Settings; leave it empty otherwise."
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
        </div>
      </details>
      <Button
        variant="outline"
        disabled={pending || inspection.isPending || !baseUrl.trim() || !apiKey.trim()}
        onClick={() => inspection.mutate()}
      >
        {inspection.isPending ? "Inspecting gateway…" : "Inspect gateway"}
      </Button>
      {inspection.isError && (
        <p role="alert" className="text-sm text-destructive">
          {sanitizedSetupErrorMessage(inspection.error, { apiKey, adminApiKey })}
        </p>
      )}
      {result && (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Gateway version</dt>
            <dd>{result.gatewayVersion ?? `Unknown (assuming ${result.pinnedVersion})`}</dd>
            <dt className="text-muted-foreground">Engine</dt>
            <dd>{result.engine ?? "Unknown"}</dd>
            <dt className="text-muted-foreground">Key role</dt>
            <dd>{result.keyRole}</dd>
            {result.adminKey && (
              <>
                <dt className="text-muted-foreground">Admin key</dt>
                <dd>{result.adminKey.role}</dd>
              </>
            )}
          </dl>
          {result.warnings.length > 0 && (
            <div role="status" className="space-y-1 rounded-lg border border-border bg-muted/30 p-4 text-sm">
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
            {!result.eligible && (
              <p role="alert" className="text-sm text-destructive">
                No session can be connected. Connect WhatsApp in the OpenWA dashboard or free the session from its other channel.
              </p>
            )}
            {result.sessions.map((session) => (
              <label key={session.sessionId} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="openwa-session"
                  value={session.sessionId}
                  checked={sessionId === session.sessionId}
                  disabled={!session.eligible || pending || (Boolean(existingSessionId) && existingSessionId !== session.sessionId)}
                  onChange={() => setSessionId(session.sessionId)}
                />
                <span>
                  {session.name}
                  {session.maskedNumber ? ` · ${session.maskedNumber}` : ""}
                  {session.pushName ? ` · ${session.pushName}` : ""}
                  {session.unavailableReason ? ` — ${session.unavailableReason}` : ""}
                </span>
              </label>
            ))}
          </fieldset>
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
                <span className="block text-muted-foreground">
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
                <span className="block text-muted-foreground">
                  The agent replies as you. Only chats you enable in Settings can trigger it, and its messages carry a
                  visible prefix so contacts know an assistant wrote them. Paperclip can read every chat this session can see.
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
                Paperclip is the only app sending as this session. Other bots, webhooks, or scripts on the same session
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
