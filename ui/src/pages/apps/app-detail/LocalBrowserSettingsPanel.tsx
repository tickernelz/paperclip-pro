import { useEffect, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  LocalBrowserPairingStartResult,
  LocalBrowserSession,
  LocalBrowserSettings,
  LocalBrowserTier,
  ToolConnection,
} from "@tickernelz/paperclip-pro-shared";
import { localBrowserApi } from "@/api/local-browser";
import { Download, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LocalBrowserViewer } from "@/components/local-browser/LocalBrowserViewer";
import { Label } from "@/components/ui/label";
import { RadioCardGroup } from "@/components/ui/radio-card";
import { Textarea } from "@/components/ui/textarea";

const PAIRING_POLL_MS = 2_000;

const TIER_OPTIONS = [
  {
    value: "refine",
    title: "Refine",
    description:
      "Snapshot, act, read, wait and screenshots, limited to the origins you allowlist.",
  },
  {
    value: "full",
    title: "Full power",
    description:
      "Every site the browser is signed into, plus JavaScript, storage, network, uploads and downloads.",
  },
];

const UNREACHABLE =
  "The Local Browser service did not answer. Pairing and settings need the Paperclip server, so nothing here was changed.";

function pairingExpiry(expiresAt: string): string {
  const when = new Date(expiresAt);
  return Number.isNaN(when.getTime()) ? expiresAt : when.toLocaleTimeString();
}

function sessionSubtitle(session: LocalBrowserSession): string {
  const tabs = session.tabs.length;
  const owner = session.ownerUserId ? ` · owner ${session.ownerUserId}` : "";
  return `${session.client} ${session.clientVersion} · ${tabs} ${tabs === 1 ? "tab" : "tabs"} · ${session.tier} tier${owner}`;
}

export function LocalBrowserSettingsPanel({ connection }: { connection: ToolConnection }) {
  const id = useId();
  const companyId = connection.companyId;
  const queryClient = useQueryClient();
  const [tier, setTier] = useState<LocalBrowserTier>("refine");
  const [origins, setOrigins] = useState("");
  const [pairing, setPairing] = useState<LocalBrowserPairingStartResult | null>(null);
  const [pairedSessionId, setPairedSessionId] = useState<string | null>(null);

  const sessions = useQuery({
    queryKey: ["local-browser-sessions", companyId],
    queryFn: () => localBrowserApi.sessions(companyId),
    retry: false,
    refetchInterval: 10_000,
  });
  const settings = useQuery({
    queryKey: ["local-browser-settings", companyId],
    queryFn: () => localBrowserApi.settings(companyId),
    retry: false,
  });

  useEffect(() => {
    if (!settings.data) return;
    setTier(settings.data.tier);
    setOrigins(settings.data.allowedOrigins.join("\n"));
  }, [settings.data]);

  const pairingStatus = useQuery({
    queryKey: ["local-browser-pairing", companyId, pairing?.code],
    queryFn: () => localBrowserApi.pairingStatus(companyId, pairing!.code),
    enabled: Boolean(pairing),
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.status === "pending" ? PAIRING_POLL_MS : false,
  });

  useEffect(() => {
    const result = pairingStatus.data;
    if (!result) return;
    if (result.status === "paired") {
      setPairedSessionId(result.sessionId ?? null);
      setPairing(null);
      void queryClient.invalidateQueries({ queryKey: ["local-browser-sessions", companyId] });
    }
  }, [pairingStatus.data, companyId, queryClient]);

  const startPairing = useMutation({
    mutationFn: () => localBrowserApi.startPairing(companyId, {}),
    onSuccess: (result) => {
      setPairedSessionId(null);
      setPairing(result);
    },
  });

  const saveSettings = useMutation({
    mutationFn: (next: LocalBrowserSettings) => localBrowserApi.saveSettings(companyId, next),
    onSuccess: (saved) => {
      setTier(saved.tier);
      setOrigins(saved.allowedOrigins.join("\n"));
      void queryClient.invalidateQueries({ queryKey: ["local-browser-settings", companyId] });
    },
  });

  const disconnect = useMutation({
    mutationFn: (sessionId: string) => localBrowserApi.disconnect(companyId, sessionId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["local-browser-sessions", companyId] }),
  });

  const allowedOrigins = origins
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const savedTier = settings.data?.tier ?? "refine";
  const savedOrigins = settings.data?.allowedOrigins ?? [];
  const dirty =
    tier !== savedTier ||
    allowedOrigins.length !== savedOrigins.length ||
    allowedOrigins.some((origin, index) => origin !== savedOrigins[index]);
  const pairingExpired = pairingStatus.data?.status === "expired";
  const pairingPending = Boolean(pairing) && !pairingExpired;
  const liveSessions = sessions.data?.sessions ?? [];
  const [watchedSessionId, setWatchedSessionId] = useState<string | null>(null);

  return (
    <section className="space-y-8" aria-labelledby={`${id}-title`}>
      <div className="space-y-2">
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          Local Browser
        </h2>
        <p className="text-sm text-muted-foreground">
          Agents work in the browser already open on your machine, with your logins. You watch the
          same tab and can take over at any time. Nothing is installed on the server, and Paperclip
          never stores your passwords.
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="font-medium">Install the extension</h3>
        <p className="text-sm text-muted-foreground">
          Download the extension for the browser you want Paperclip to drive. You install it once,
          then pair it from this page.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" asChild>
            <a href="/downloads/local-browser-chromium.zip" download>
              <Download aria-hidden="true" />
              Chrome, Edge or Brave (zip)
            </a>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a href="/downloads/local-browser-firefox.xpi" download>
              <Download aria-hidden="true" />
              Firefox (signed xpi)
            </a>
          </Button>
        </div>

        <div className="space-y-3 rounded-lg border border-border p-4">
          <h4 className="text-sm font-medium">Chrome, Edge or Brave</h4>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Download the zip and unzip it into a folder you will keep, for example Documents.</li>
            <li>Open <code className="font-mono text-xs">chrome://extensions</code>.</li>
            <li>Turn on <strong className="font-medium text-foreground">Developer mode</strong> in the top right corner.</li>
            <li>Click <strong className="font-medium text-foreground">Load unpacked</strong> and choose the unzipped folder that contains <code className="font-mono text-xs">manifest.json</code>.</li>
            <li>Pin the Paperclip extension to the toolbar so you can see its status.</li>
            <li>Come back to this page, start a pairing, then open the extension and paste the code.</li>
          </ol>
          <p className="text-xs text-muted-foreground">
            The zip stays installed where you unzipped it. Do not delete that folder, because the
            browser loads the extension from it on every start.
          </p>
        </div>

        <div className="space-y-3 rounded-lg border border-border p-4">
          <h4 className="text-sm font-medium">Firefox</h4>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Download the signed xpi file.</li>
            <li>Open <code className="font-mono text-xs">about:addons</code> and choose <strong className="font-medium text-foreground">Install Add-on From File</strong> from the gear menu.</li>
            <li>Select the xpi you downloaded and confirm the install.</li>
            <li>Come back to this page, start a pairing, then open the extension and paste the code.</li>
          </ol>
          <p className="text-xs text-muted-foreground">
            The xpi is signed by Mozilla, so it installs in release Firefox without a developer
            setting. Firefox may ask you to allow the connection to this Paperclip address the first
            time you pair.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="font-medium">Pairing</h3>
        {!pairing && (
          <p className="text-sm text-muted-foreground">
            {liveSessions.length > 0
              ? "Add another browser, or reconnect one you closed."
              : "No browser is paired yet. Install the extension, then pair it here. Each browser acts for the person who paired it, so agents pass its session id when several people pair one."}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={startPairing.isPending || pairingPending}
            onClick={() => startPairing.mutate()}
          >
            {pairingPending ? "Waiting for the extension" : "Pair a browser"}
          </Button>
          {pairingPending && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setPairing(null);
                startPairing.reset();
              }}
            >
              Cancel
            </Button>
          )}
        </div>
        {pairing && (
          <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-4">
            <p className="text-sm text-muted-foreground">
              Open the Local Browser extension and enter this code before{" "}
              {pairingExpiry(pairing.expiresAt)}.
            </p>
            <p className="font-mono text-2xl font-semibold tracking-widest">{pairing.code}</p>
            {pairing.connectUrls.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Or open the extension from a link:</p>
                <ul className="space-y-1">
                  {pairing.connectUrls.map((url) => (
                    <li key={url}>
                      <code className="break-all font-mono text-xs">{url}</code>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {pairingExpired && (
              <p role="alert" className="text-sm text-destructive">
                That code expired before a browser paired. Start a new pairing.
              </p>
            )}
          </div>
        )}
        {pairedSessionId && (
          <p role="status" className="text-sm text-muted-foreground">
            Browser paired. It now appears under live sessions.
          </p>
        )}
        {startPairing.isError && (
          <p role="alert" className="text-sm text-destructive">
            Could not start pairing. {UNREACHABLE}
          </p>
        )}
        {pairingStatus.isError && (
          <p role="alert" className="text-sm text-destructive">
            Could not read the pairing status. Reload this page to try again.
          </p>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="font-medium">Live sessions</h3>
        {sessions.isError && liveSessions.length > 0 ? (
          <p role="alert" className="text-sm text-destructive">
            Could not refresh the session list, so this may be out of date. {UNREACHABLE}{" "}
            <Button size="sm" variant="ghost" onClick={() => void sessions.refetch()}>
              Retry
            </Button>
          </p>
        ) : null}
        {sessions.isError && liveSessions.length === 0 ? (
          <p role="alert" className="text-sm text-destructive">
            {UNREACHABLE}{" "}
            <Button size="sm" variant="ghost" onClick={() => void sessions.refetch()}>
              Retry
            </Button>
          </p>
        ) : sessions.isLoading && liveSessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Checking paired browsers…</p>
        ) : liveSessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No browser is connected right now. A paired browser stays listed only while its
            extension is running, and agents get an empty list until one connects.
          </p>
        ) : (
          <ul className="space-y-2">
            {liveSessions.map((session) => (
              <li
                key={session.sessionId}
                className="space-y-3 rounded-lg border border-border p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      {session.label}
                      {session.profileName ? ` · ${session.profileName}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">{sessionSubtitle(session)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      aria-expanded={watchedSessionId === session.sessionId}
                      onClick={() =>
                        setWatchedSessionId((current) =>
                          current === session.sessionId ? null : session.sessionId,
                        )
                      }
                    >
                      <Monitor aria-hidden="true" />
                      {watchedSessionId === session.sessionId ? "Hide browser" : "Watch"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={disconnect.isPending}
                      onClick={() => disconnect.mutate(session.sessionId)}
                    >
                      Disconnect
                    </Button>
                  </div>
                </div>
                {watchedSessionId === session.sessionId ? (
                  <LocalBrowserViewer sessionId={session.sessionId} companyId={companyId} />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {disconnect.isError && (
          <p role="alert" className="text-sm text-destructive">
            Could not disconnect that browser. {UNREACHABLE}
          </p>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="font-medium">Access level</h3>
        <RadioCardGroup
          ariaLabel="Local Browser access level"
          value={tier}
          onValueChange={(next) => setTier(next === "full" ? "full" : "refine")}
          options={TIER_OPTIONS}
        />
        {tier === "full" && (
          <p role="note" className="text-sm text-destructive">
            Full power lets an agent read and change anything this browser is signed into: mail,
            banking, admin consoles, and any other account. The origin allowlist no longer applies.
            Choose it only while a task needs JavaScript, storage, network, uploads, or downloads,
            then return to refine.
          </p>
        )}
      </div>

      <div className="space-y-3">
        <Label htmlFor={`${id}-origins`}>Allowed origins</Label>
        <Textarea
          id={`${id}-origins`}
          value={origins}
          rows={4}
          spellCheck={false}
          disabled={tier === "full"}
          placeholder={"https://app.example.com\nhttps://*.example.com"}
          onChange={(event) => setOrigins(event.target.value)}
          className="font-mono text-xs"
        />
        <p className="text-sm text-muted-foreground">
          {tier === "full"
            ? "Full power ignores this list because every origin is reachable. Switch to refine to limit which sites agents can touch."
            : "One origin per line. Use * for any origin, or *.example.com to cover a domain and its subdomains. Refine tier refuses any page outside this list."}
        </p>
      </div>

      {settings.isError && (
        <p role="alert" className="text-sm text-destructive">
          Could not load the saved access level. {UNREACHABLE}{" "}
          <Button size="sm" variant="ghost" onClick={() => void settings.refetch()}>
            Retry
          </Button>
        </p>
      )}
      {saveSettings.isError && (
        <p role="alert" className="text-sm text-destructive">
          Could not save the access level. {UNREACHABLE}
        </p>
      )}
      {saveSettings.isSuccess && !dirty && (
        <p role="status" className="text-sm text-muted-foreground">
          Access level saved.
        </p>
      )}

      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={!settings.data || !dirty || saveSettings.isPending}
          onClick={() => saveSettings.mutate({ tier, allowedOrigins })}
        >
          Save access level
        </Button>
      </div>
    </section>
  );
}
