import { useMutation } from "@tanstack/react-query";
import {
  localBrowserPermissionsForClient,
  type LocalBrowserPermissionDefinition,
  type LocalBrowserSession,
} from "@tickernelz/paperclip-pro-shared";
import { ApiError } from "@/api/client";
import { localBrowserApi } from "@/api/local-browser";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/timeAgo";

const SITE_ACCESS_TEXT = {
  all: "Every website",
  limited: "Only some websites",
  unknown: "Not reported yet",
} as const;

const UNSUPPORTED = "local_browser_unsupported";

interface PermissionEntry {
  id: string;
  label: string;
  required: boolean;
}

function entriesFor(
  ids: string[],
  catalog: LocalBrowserPermissionDefinition[],
  client: LocalBrowserSession["client"],
): PermissionEntry[] {
  const wanted = new Set(ids);
  const known = catalog
    .filter((permission) => wanted.has(permission.id))
    .map((permission) => ({
      id: permission.id,
      label: permission.label,
      required: permission[client] === "required",
    }));
  const knownIds = new Set(known.map((entry) => entry.id));
  const unknown = ids
    .filter((id) => !knownIds.has(id))
    .map((id) => ({ id, label: id, required: false }));
  return [...known, ...unknown];
}

function isUnsupported(error: unknown): boolean {
  if (error instanceof ApiError) {
    const code = (error.body as { code?: unknown } | null)?.code;
    if (code === UNSUPPORTED) return true;
  }
  return error instanceof Error && error.message.includes(UNSUPPORTED);
}

function failureText(error: unknown): string {
  if (isUnsupported(error)) {
    return "This extension version cannot open its permission page from Paperclip. Update the extension, then pair it again.";
  }
  const message = error instanceof Error ? error.message.replace(/^\[[a-z_]+\]\s*/, "") : "";
  return `Could not open the permission page.${message ? ` ${message}` : ""}`;
}

export function LocalBrowserSessionAccess({
  session,
  companyId,
}: {
  session: LocalBrowserSession;
  companyId: string;
}) {
  const openPermissions = useMutation({
    mutationFn: () => localBrowserApi.openPermissions(companyId, session.sessionId),
  });
  const capabilities = session.capabilities ?? [];
  const access = session.access;
  const catalog = localBrowserPermissionsForClient(session.client);
  const labelOf = new Map(catalog.map((permission) => [permission.id, permission.label]));
  const granted = access ? entriesFor(access.granted, catalog, session.client) : [];
  const missing = access ? entriesFor(access.missing, catalog, session.client) : [];
  const requiredMissing = missing.filter((entry) => entry.required).length;
  const needsAttention = Boolean(access) && (missing.length > 0 || access?.siteAccess === "limited");

  return (
    <div className="space-y-3">
      {capabilities.length > 0 ? (
        <ul aria-label="Extension capabilities" className="flex flex-wrap gap-1">
          {capabilities.map((capability) => (
            <li key={capability}>
              <Badge variant="outline" className="font-mono">
                {capability}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}

      <div role="group" aria-label="Permissions" className="space-y-3 rounded-md border border-border p-3">
        <h4 className="text-sm font-medium">Permissions</h4>
        {!access ? (
          <p className="text-sm text-muted-foreground">
            Update the extension to manage permissions here.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Site access:{" "}
              <span className="font-medium text-foreground">{SITE_ACCESS_TEXT[access.siteAccess]}</span>
            </p>
            {needsAttention ? (
              <div
                role="status"
                data-state="attention"
                className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200"
              >
                <p className="font-medium">
                  {missing.length > 0
                    ? `${missing.length} ${missing.length === 1 ? "permission is" : "permissions are"} missing${requiredMissing > 0 ? `, ${requiredMissing} required` : ""}.`
                    : "The extension can reach only some websites."}
                </p>
                <p>Open the extension and press Allow all.</p>
              </div>
            ) : null}
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Granted</p>
              {granted.length > 0 ? (
                <ul aria-label="Granted permissions" className="flex flex-wrap gap-1">
                  {granted.map((entry) => (
                    <li key={entry.id}>
                      <Badge variant="secondary" title={entry.id}>
                        {entry.label}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">None yet.</p>
              )}
            </div>
            {missing.length > 0 ? (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Missing</p>
                <ul aria-label="Missing permissions" className="flex flex-wrap gap-1">
                  {missing.map((entry) => (
                    <li key={entry.id}>
                      <Badge
                        variant="outline"
                        title={entry.id}
                        className="border-amber-500/40 text-amber-800 dark:text-amber-200"
                      >
                        {entry.label}
                        {entry.required ? " · required" : ""}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {access.pending.length > 0 ? (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Agents are waiting for</p>
                <ul aria-label="Pending permission requests" className="space-y-1">
                  {access.pending.map((request) => {
                    const when = new Date(request.at);
                    const known = !Number.isNaN(when.getTime());
                    return (
                      <li
                        key={`${request.permission}-${request.at}`}
                        className="text-sm text-muted-foreground"
                      >
                        <span className="font-medium text-foreground">
                          {labelOf.get(request.permission) ?? request.permission}
                        </span>
                        {request.reason ? ` · ${request.reason}` : ""}
                        {request.tool ? (
                          <>
                            {" · "}
                            <code className="font-mono text-xs">{request.tool}</code>
                          </>
                        ) : null}
                        {" · "}
                        <time dateTime={known ? when.toISOString() : undefined}>
                          {known ? timeAgo(when) : "time unknown"}
                        </time>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={openPermissions.isPending}
            onClick={() => openPermissions.mutate()}
          >
            Open permission page in browser
          </Button>
        </div>
        {openPermissions.isSuccess ? (
          <p role="status" className="text-sm text-muted-foreground">
            The permission page is open in {session.label}. Allow what agents need there.
          </p>
        ) : null}
        {openPermissions.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {failureText(openPermissions.error)}
          </p>
        ) : null}
      </div>
    </div>
  );
}
